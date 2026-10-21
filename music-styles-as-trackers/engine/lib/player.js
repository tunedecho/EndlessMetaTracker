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
import { resolve, Random } from '../../format/lib/core.js';
import { createVoice } from './voices.js';
import { Master } from './effects.js';
import { drive as driveShape, panGains, clamp } from './dsp.js';
import { schedule } from './sequencer.js';

const BLOCK = 128;
const MAX_RELEASING = 4;
const HEADROOM = 0.5; // -6 dB per track, so a full mix of eight tracks sums without clipping

class Track {
  constructor(def) {
    this.def = def;
    this.ctl = {};
    this.current = null;
    this.releasing = [];
    this.bufL = new Float32Array(BLOCK);
    this.bufR = new Float32Array(BLOCK);
  }
}

export class Player {
  /**
   * @param {{transport: object, sound: object, composition?: {tracks: object[]}}} song header; composition.tracks may be empty
   * @param {{sampleRate?: number, seed?: number}} [opts]
   */
  constructor(song, opts = {}) {
    this.sampleRate = opts.sampleRate || 44100;
    this.transport = { stepsPerBeat: 4, phraseLength: 16, swing: 0, ...song.transport };
    this.bpm = this.transport.bpm;
    this.sound = song.sound;
    this.seed = opts.seed ?? song.meta?.seed ?? 1;
    this.tracks = [];
    this.trackIndex = new Map();
    this.addTracks(song.composition?.tracks || []);
    const stepLen = (60 / this.bpm / this.transport.stepsPerBeat) * this.sampleRate;
    this.master = new Master(this.sampleRate, this.sound.master, stepLen);
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

  /** Add tracks (append-only; existing ids are kept). */
  addTracks(defs) {
    for (const def of defs) {
      if (this.trackIndex.has(def.id)) continue;
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

  applyEvent(ev) {
    const tr = this.tracks[ev.track];
    if (!tr) return;
    if (ev.kind === 'ctl') { Object.assign(tr.ctl, ev.ctl); return; }
    if (ev.kind === 'off') { if (tr.current) tr.current.noteOff(); return; }
    const inst = this.sound.instruments[ev.inst];
    if (!inst) return;
    const tables = this.sound.tables || {};
    const tableDef = ev.table ? tables[ev.table] : inst.table ? tables[inst.table] : null;
    const sounding = tr.current && !tr.current.done && tr.current.inst === inst;
    // Legato: a slide command, or a glide instrument whose previous note was not released (no OFF between).
    const glide = inst.params?.glide > 0 && sounding && tr.current.amp.stage !== 'release' && tr.current.amp.stage !== 'idle';
    if (sounding && (ev.slide || glide)) {
      const from = ev.slide ? ev.slide.from : tr.current.midi - (inst.transpose || 0);
      const seconds = ev.slide ? ev.slide.seconds : inst.params.glide;
      tr.current.noteOn(ev.note, ev.vel, { accent: ev.accent, slideFrom: from, slideSeconds: seconds, legato: true, table: tableDef, stepSamples: ev.stepSamples });
      return;
    }
    if (tr.current && !tr.current.done) {
      tr.current.noteOff();
      tr.releasing.push(tr.current);
      // Too many tails: choke the oldest, but keep rendering them until they are done (no hard cuts).
      for (let i = 0; i < tr.releasing.length - MAX_RELEASING; i++) tr.releasing[i].choke();
    }
    const v = createVoice(inst, this.sampleRate, tr.ctl);
    v.inst = inst;
    v.mix = inst.mix || {};
    v.noteOn(ev.note, ev.vel, {
      accent: ev.accent,
      slideFrom: ev.slide ? ev.slide.from : undefined,
      slideSeconds: ev.slide ? ev.slide.seconds : undefined,
      table: tableDef,
      stepSamples: ev.stepSamples,
    });
    tr.current = v;
  }

  renderVoice(tr, v, count) {
    const { dry, dly, rev } = this;
    tr.bufL.fill(0, 0, count); tr.bufR.fill(0, 0, count);
    v.render(tr.bufL, tr.bufR, 0, count, this.currentStepLen);
    const m = v.mix;
    const c = tr.ctl;
    const vol = (c.volume ?? m.volume ?? 0.8) * (tr.def.volume ?? 1);
    const pan = clamp((c.pan ?? m.pan ?? 0) + (tr.def.pan ?? 0), -1, 1);
    const drv = c.drive ?? m.drive ?? 0;
    const ds = c.delaySend ?? m.delaySend ?? 0;
    const rs = c.reverbSend ?? m.reverbSend ?? 0;
    const [gl, gr] = panGains(pan);
    const gL = vol * gl * 1.414 * HEADROOM, gR = vol * gr * 1.414 * HEADROOM;
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
      for (const tr of this.tracks) {
        if (tr.current) {
          if (tr.current.done) tr.current = null;
          else this.renderVoice(tr, tr.current, count);
        }
        if (tr.releasing.length) {
          for (const v of tr.releasing) if (!v.done) this.renderVoice(tr, v, count);
          tr.releasing = tr.releasing.filter((v) => !v.done);
        }
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
