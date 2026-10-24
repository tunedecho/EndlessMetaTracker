/**
 * Streaming player: the same voices, effects, and scheduling as the offline
 * renderer, but rows are appended over time and audio is pulled in blocks.
 * This is what an endless mode needs: the generator hands over one section at
 * a time, and voices, delay, and reverb carry across section boundaries.
 *
 * A Player is built from a song header (transport, sound, tracks). Rows refer
 * to phrases and chains by id, so they are passed with each row (or once, if
 * they do not change). Tracks may be added later; they are append-only.
 */
import { resolve, Random, applyLock, commandForPath } from '../../format/lib/core.js';
import { createVoice } from './voices.js';
import { Master } from './effects.js';
import { drive as driveShape, panGains, clamp } from './dsp.js';
import { schedule } from './sequencer.js';

const BLOCK = 128;
const MAX_RELEASING = 4;
const HEADROOM = 0.5; // -6 dB per track, so a full mix of eight tracks sums without clipping

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Make `target` equal to `src`, keeping the identity of nested objects both share. JSON copies, since audio worklets lack structuredClone. */
function assignInPlace(target, src) {
  for (const k of Object.keys(target)) if (!(k in src)) delete target[k];
  for (const [k, v] of Object.entries(src)) {
    if (isObj(v) && isObj(target[k])) assignInPlace(target[k], v);
    else target[k] = isObj(v) || Array.isArray(v) ? JSON.parse(JSON.stringify(v)) : v;
  }
}

class Track {
  constructor(def) {
    this.def = def;
    this.ctl = {};
    this.current = null;
    this.chord = [];      // the other voices of a sounding chord (current plays its lowest note)
    this.releasing = [];
    this.bufL = new Float32Array(BLOCK);
    this.bufR = new Float32Array(BLOCK);
  }
}

export class Player {
  /**
   * @param {{transport: object, sound: object, composition?: {tracks: object[]}}} song header; composition.tracks may be empty
   * @param {{sampleRate?: number, seed?: number, createVoice?: Function, busEffects?: object, muted?: string[]}} [opts] createVoice(inst, sampleRate, ctl, {track, player, lock})
   *   (chord: the voice's place in a chord step, 0 for the lowest or only note)
   *   replaces the built-in engines, for hosts that bring their own voices (SynthLand's web tracker plays its
   *   synth plugins this way); it returns an object with the voice interface: noteOn, noteOff, choke, render, done, and ctl
   *   (the `ctl` it was given, which the mixer reads for the track's live volume, pan and sends);
   *   busEffects {delay?, reverb?, chain?, group?} replaces the master's delay and reverb returns, adds a chain
   *   before its limiter (see Master in effects.js), and group(name, L, R, count) processes each group bus;
   *   muted lists track ids that render silently (setMuted changes them live)
   */
  constructor(song, opts = {}) {
    this.sampleRate = opts.sampleRate || 44100;
    this.createVoice = opts.createVoice || createVoice;
    this.transport = { stepsPerBeat: 4, phraseLength: 16, swing: 0, ...song.transport };
    this.bpm = this.transport.bpm;
    this.sound = song.sound;
    this.seed = opts.seed ?? song.meta?.seed ?? 1;
    this.tracks = [];
    this.trackIndex = new Map();
    this.addTracks(song.composition?.tracks || []);
    const stepLen = (60 / this.bpm / this.transport.stepsPerBeat) * this.sampleRate;
    this.master = new Master(this.sampleRate, this.sound.master, stepLen, opts.busEffects);
    // Group buses: a track whose instrument names a bus (mix.bus) is summed apart and handed to the host's
    // busEffects.group(name, L, R, count) before it joins the mix (a compressor per group, say).
    this.groupFx = opts.busEffects?.group || null;
    // Muted tracks (by id) still render, so their voices keep time, but add nothing to the mix or the sends.
    this.muted = new Set(opts.muted || []);
    this.groups = new Map(); // bus name -> { L, R, used }
    this.dry = { L: new Float32Array(BLOCK), R: new Float32Array(BLOCK) };
    this.dly = { L: new Float32Array(BLOCK), R: new Float32Array(BLOCK) };
    this.rev = { L: new Float32Array(BLOCK), R: new Float32Array(BLOCK) };
    this.events = [];      // pending, sample-stamped, sorted
    this.ei = 0;
    this.pos = 0;          // samples rendered so far
    this.rowStart = 0;     // sample where the next row begins
    this.stepBase = 0;     // steps appended so far
    this.stepStarts = [];  // absolute sample of each step start
    this.stepLengths = [];
    this.rows = [];        // {row, step, steps, startSample, samples, name, energy}
    this.prevRow = null;
    this.rowCount = 0;
    this.currentStepLen = stepLen;
    this.stepCursor = 0;
    this.lastNote = new Map(); // track index -> last midi note, so slides work across rows
  }

  /** Release every track at the end of the appended rows, so the tail decays instead of cutting. */
  end() {
    for (let ti = 0; ti < this.tracks.length; ti++) this.events.push({ t: this.rowStart, pri: 1, kind: 'off', track: ti });
    const tail = this.events.splice(this.ei);
    tail.sort((a, b) => a.t - b.t || a.pri - b.pri);
    this.events.push(...tail);
  }

  /**
   * Add tracks (append-only). A track already here takes the new definition, so a changed default
   * instrument, volume, or pan is heard from the next appended row (a live player appends a bar at a time).
   */
  addTracks(defs) {
    for (const def of defs) {
      const known = this.trackIndex.get(def.id);
      if (known !== undefined) { this.tracks[known].def = def; continue; }
      this.trackIndex.set(def.id, this.tracks.length);
      this.tracks.push(new Track(def));
    }
  }

  /** Samples appended but not yet rendered. */
  get queued() { return this.rowStart - this.pos; }

  /**
   * Append one song row. Returns where it sits in the stream.
   * @param {object} row {trackId: chainId}
   * @param {{phrases: object, chains: object, tracks?: object[]}} comp phrases and chains the row refers to
   * @param {{name?: string, energy?: number}} [meta]
   */
  appendRow(row, comp, meta = {}) {
    if (comp.tracks) this.addTracks(comp.tracks);
    const mini = {
      format: 'tracker-song/0.1',
      transport: { ...this.transport, bpm: this.bpm, loop: undefined },
      sound: this.sound,
      composition: { tracks: this.tracks.map((t) => t.def), phrases: comp.phrases, chains: comp.chains, song: { rows: [row] } },
    };
    delete mini.transport.loop;
    const resolved = resolve(mini);
    const { events, grid } = schedule(mini, resolved, this.sampleRate, (this.seed + this.rowCount * 7919) >>> 0, this.lastNote);
    const steps = resolved.totalSteps;
    const samples = grid.starts[steps];
    // Tracks that leave the grid are released at the row start.
    if (this.prevRow) {
      for (const [trackId, chainId] of Object.entries(this.prevRow)) {
        if (!chainId || row[trackId]) continue;
        const ti = this.trackIndex.get(trackId);
        if (ti !== undefined) this.events.push({ t: this.rowStart, pri: 1, kind: 'off', track: ti });
      }
    }
    for (const e of events) { e.t += this.rowStart; this.events.push(e); }
    // A nudged, cut, or swung note on the last step can land past the row end, so keep the pending tail sorted.
    const tail = this.events.splice(this.ei);
    tail.sort((a, b) => a.t - b.t || a.pri - b.pri);
    this.events.push(...tail);
    for (let s = 0; s < steps; s++) { this.stepStarts.push(this.rowStart + grid.starts[s]); this.stepLengths.push(grid.lengths[s]); }
    // Carry the tempo forward if the row changed it.
    for (const e of resolved.events) if (e.fx && e.fx.tempo !== undefined) this.bpm = e.fx.tempo;
    const info = { row: this.rowCount, step: this.stepBase, steps, startSample: this.rowStart, samples, name: meta.name, energy: meta.energy };
    this.rows.push(info);
    this.rowStart += samples;
    this.stepBase += steps;
    this.prevRow = row;
    this.rowCount++;
    return info;
  }

  /** Live play, for a keyboard: start a note on a track now (at the next rendered sample), with optional parameter locks. */
  noteOn(track, inst, note, vel = 1, lock = null) {
    this.applyEvent({ kind: 'on', track, inst, note, vel, accent: 0, slide: null, table: null, lock, stepSamples: this.currentStepLen });
  }

  /** Live play: release whatever the track is playing. */
  noteOff(track) { this.applyEvent({ kind: 'off', track }); }

  /** Drop every event not yet played and release every track, so only tails remain. */
  stop() {
    this.events.length = this.ei;
    for (let ti = 0; ti < this.tracks.length; ti++) this.noteOff(ti);
    this.rowStart = this.pos;
  }

  /**
   * Replace an instrument's definition in place, so a sounding voice picks up
   * every parameter it reads per block (filter, mix, levels, FM index, ...).
   * Parameters a voice reads only at note start apply from the next note.
   */
  updateInstrument(id, def) {
    const cur = this.sound.instruments[id];
    if (!cur) { this.sound.instruments[id] = JSON.parse(JSON.stringify(def)); return; }
    assignInPlace(cur, def);
  }

  applyEvent(ev) {
    const tr = this.tracks[ev.track];
    if (!tr) return;
    if (ev.kind === 'ctl') { Object.assign(tr.ctl, ev.ctl); return; }
    if (ev.kind === 'off') { if (tr.current) tr.current.noteOff(); for (const v of tr.chord) v.noteOff(); return; }
    const base = this.sound.instruments[ev.inst];
    if (!base) return;
    const inst = ev.lock ? applyLock(base, ev.lock) : base;
    const tables = this.sound.tables || {};
    const tableDef = ev.table ? tables[ev.table] : inst.table ? tables[inst.table] : null;
    // A chord: the lowest note on the track's main voice, the others on voices beside it, all on one instrument.
    const extra = ev.chord && ev.chord.length > 1 ? ev.chord.slice(1) : [];
    const limit = MAX_RELEASING * (1 + extra.length);
    const sounding = tr.current && !tr.current.done && tr.current.instId === ev.inst;
    // Legato: a slide command, or a glide instrument whose previous note was not released (no OFF between).
    const glide = inst.params?.glide > 0 && sounding && tr.current.amp.stage !== 'release' && tr.current.amp.stage !== 'idle';
    if (sounding && (ev.slide || glide)) {
      const from = ev.slide ? ev.slide.from : tr.current.midi - (inst.transpose || 0);
      const seconds = ev.slide ? ev.slide.seconds : inst.params.glide;
      tr.current.noteOn(ev.note, ev.vel, { accent: ev.accent, slideFrom: from, slideSeconds: seconds, legato: true, table: tableDef, stepSamples: ev.stepSamples });
      // Chord voices slide too, each from the note it was playing; a chord that grew gets new voices, one that
      // shrank releases the rest.
      const keep = [];
      extra.forEach((n, i) => {
        const v = tr.chord[i];
        if (v && !v.done) { v.noteOn(n, ev.vel, { accent: ev.accent, slideFrom: v.midi - (inst.transpose || 0), slideSeconds: seconds, legato: true, table: tableDef, stepSamples: ev.stepSamples }); keep.push(v); }
        else keep.push(this.startVoice(tr, inst, ev, tableDef, tr.ctl, n, i + 1));
      });
      for (const v of tr.chord.slice(extra.length)) if (!v.done) { v.noteOff(); tr.releasing.push(v); }
      tr.chord = keep;
      return;
    }
    if (tr.current && !tr.current.done) {
      tr.current.noteOff();
      tr.releasing.push(tr.current);
    }
    for (const v of tr.chord) if (!v.done) { v.noteOff(); tr.releasing.push(v); }
    tr.chord = [];
    // Too many tails: choke the oldest, but keep rendering them until they are done (no hard cuts).
    for (let i = 0; i < tr.releasing.length - limit; i++) tr.releasing[i].choke();
    // A lock on a parameter a track command also sets wins for this note: the voice sees the
    // track's controls through a layer holding the locked values.
    let ctl = tr.ctl;
    if (ev.lock) {
      ctl = Object.create(tr.ctl);
      for (const [path, value] of Object.entries(ev.lock)) { const cmd = commandForPath(path); if (cmd) ctl[cmd] = value; }
    }
    tr.current = this.startVoice(tr, inst, ev, tableDef, ctl, ev.note, 0, ev.slide);
    tr.chord = extra.map((n, i) => this.startVoice(tr, inst, ev, tableDef, ctl, n, i + 1));
  }

  /** Make and start one voice for an event: chord is its place in a chord (0: the lowest, or the only note). */
  startVoice(tr, inst, ev, tableDef, ctl, note, chord, slide = null) {
    const v = this.createVoice(inst, this.sampleRate, ctl, { track: ev.track, player: this, lock: ev.lock || null, chord });
    v.inst = inst;
    v.instId = ev.inst;
    v.mix = inst.mix || {};
    v.noteOn(note, ev.vel, {
      accent: ev.accent,
      slideFrom: slide ? slide.from + (note - ev.note) : undefined,
      slideSeconds: slide ? slide.seconds : undefined,
      table: tableDef,
      stepSamples: ev.stepSamples,
    });
    return v;
  }

  /** Mute exactly these tracks (ids), from the next rendered sample: a live mute and solo for a player. */
  setMuted(ids) { this.muted = new Set(ids || []); }

  /** The block buffers of a group bus, cleared for this block on first use. */
  groupBus(name, count) {
    let g = this.groups.get(name);
    if (!g) { g = { L: new Float32Array(BLOCK), R: new Float32Array(BLOCK), used: false }; this.groups.set(name, g); }
    if (!g.used) { g.L.fill(0, 0, count); g.R.fill(0, 0, count); g.used = true; }
    return g;
  }

  renderVoice(tr, v, count) {
    const { dly, rev } = this;
    tr.bufL.fill(0, 0, count); tr.bufR.fill(0, 0, count);
    v.render(tr.bufL, tr.bufR, 0, count, this.currentStepLen);
    const m = v.mix;
    const c = v.ctl;
    const vol = this.muted.has(tr.def.id) ? 0 : (c.volume ?? m.volume ?? 0.8) * (tr.def.volume ?? 1);
    const pan = clamp((c.pan ?? m.pan ?? 0) + (tr.def.pan ?? 0), -1, 1);
    const drv = c.drive ?? m.drive ?? 0;
    const ds = c.delaySend ?? m.delaySend ?? 0;
    const rs = c.reverbSend ?? m.reverbSend ?? 0;
    const [gl, gr] = panGains(pan);
    const gL = vol * gl * 1.414 * HEADROOM, gR = vol * gr * 1.414 * HEADROOM;
    // Its dry signal goes to its group bus when it has one (sends stay pre-bus, from the track).
    const dry = this.groupFx && m.bus ? this.groupBus(m.bus, count) : this.dry;
    for (let i = 0; i < count; i++) {
      let l = tr.bufL[i], r = tr.bufR[i];
      if (drv > 0) { l = driveShape(l, drv); r = driveShape(r, drv); }
      l *= gL; r *= gR;
      dry.L[i] += l; dry.R[i] += r;
      if (ds > 0) { dly.L[i] += l * ds; dly.R[i] += r * ds; }
      if (rs > 0) { rev.L[i] += l * rs; rev.R[i] += r * rs; }
    }
  }

  /**
   * Render `n` samples into left/right (allocated if not given), advancing the stream.
   * Past the appended rows it renders tails and silence.
   */
  render(n, left = new Float32Array(n), right = new Float32Array(n), offset = 0) {
    const { events, dry, dly, rev } = this;
    const end = this.pos + n;
    let out = offset;
    while (this.pos < end) {
      while (this.ei < events.length && events[this.ei].t <= this.pos) this.applyEvent(events[this.ei++]);
      while (this.stepCursor + 1 < this.stepStarts.length && this.stepStarts[this.stepCursor + 1] <= this.pos) this.stepCursor++;
      if (this.stepLengths.length) this.currentStepLen = this.stepLengths[Math.min(this.stepCursor, this.stepLengths.length - 1)];
      if (this.currentStepLen !== this.master.lastStep) { this.master.setStep(this.currentStepLen); this.master.lastStep = this.currentStepLen; }
      let count = Math.min(BLOCK, end - this.pos);
      if (this.ei < events.length) count = Math.min(count, Math.max(1, Math.ceil(events[this.ei].t) - this.pos));
      dry.L.fill(0, 0, count); dry.R.fill(0, 0, count);
      dly.L.fill(0, 0, count); dly.R.fill(0, 0, count);
      rev.L.fill(0, 0, count); rev.R.fill(0, 0, count);
      for (const g of this.groups.values()) g.used = false;
      for (const tr of this.tracks) {
        if (tr.current) {
          if (tr.current.done) tr.current = null;
          else this.renderVoice(tr, tr.current, count);
        }
        if (tr.chord.length) {
          for (const v of tr.chord) if (!v.done) this.renderVoice(tr, v, count);
          tr.chord = tr.chord.filter((v) => !v.done);
        }
        if (tr.releasing.length) {
          for (const v of tr.releasing) if (!v.done) this.renderVoice(tr, v, count);
          tr.releasing = tr.releasing.filter((v) => !v.done);
        }
      }
      // Every known group bus is processed each block (silent ones too, so its effect keeps time) and joins the mix.
      for (const [name, g] of this.groups) {
        if (!g.used) { g.L.fill(0, 0, count); g.R.fill(0, 0, count); }
        this.groupFx(name, g.L, g.R, count);
        for (let i = 0; i < count; i++) { dry.L[i] += g.L[i]; dry.R[i] += g.R[i]; }
      }
      this.master.process(dry, dly, rev, left, right, out, count);
      this.pos += count;
      out += count;
    }
    // Drop consumed events now and then so an endless run does not grow without bound.
    if (this.ei > 4096) { this.events = this.events.slice(this.ei); this.ei = 0; }
    return { left, right };
  }
}
