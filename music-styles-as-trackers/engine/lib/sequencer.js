/**
 * Sequencer and renderer. Turns a song into sample-accurate note and control
 * events, runs the voices, mixes through the master bus, and returns audio.
 *
 * Timing: step boundaries are computed in samples from the tempo, with swing
 * delaying every second step. Tempo commands change the step length from the
 * step they land on. Events are processed at their exact sample, so rendering
 * is deterministic apart from the noise sources.
 */
import { resolve, stepSeconds, Random } from '@tracker/format';
import { createVoice } from './voices.js';
import { Master } from './effects.js';
import { drive as driveShape, panGains, clamp } from './dsp.js';

const BLOCK = 128;
const MAX_RELEASING = 4;
const HEADROOM = 0.5; // -6 dB per track, so a full mix of eight tracks sums without clipping

/**
 * Compute the start sample of every step and the step length at each step.
 * @returns {{starts: Float64Array, lengths: Float64Array, seconds: number}}
 */
export function stepGrid(resolved, sampleRate) {
  const { totalSteps, transport, events } = resolved;
  const tempoAt = new Map();
  for (const e of events) if (e.fx && e.fx.tempo !== undefined) tempoAt.set(e.step, e.fx.tempo);
  const starts = new Float64Array(totalSteps + 1);
  const lengths = new Float64Array(totalSteps + 1);
  let bpm = transport.bpm;
  let t = 0;
  const swing = transport.swing || 0;
  for (let s = 0; s <= totalSteps; s++) {
    if (tempoAt.has(s)) bpm = tempoAt.get(s);
    const L = stepSeconds(bpm, transport.stepsPerBeat) * sampleRate;
    lengths[s] = L;
    starts[s] = t + (s % 2 === 1 ? swing * L : 0);
    t += L;
  }
  return { starts, lengths, seconds: t / sampleRate };
}

/**
 * Expand the resolved timeline into sample-stamped events.
 * Kinds: ctl (track command), on, off.
 */
export function schedule(song, resolved, sampleRate, seed = 1) {
  const grid = stepGrid(resolved, sampleRate);
  const rnd = new Random(seed);
  const out = [];
  const lastNote = new Map(); // track -> midi, for slides
  for (const e of resolved.events) {
    const t0 = grid.starts[e.step];
    const L = grid.lengths[e.step];
    const fx = e.fx || {};
    const ctl = {};
    for (const k of ['volume', 'cutoff', 'resonance', 'pan', 'delaySend', 'reverbSend', 'drive', 'pitch']) if (fx[k] !== undefined) ctl[k] = fx[k];
    if (Object.keys(ctl).length) out.push({ t: t0, pri: 0, kind: 'ctl', track: e.track, ctl });
    if (e.note === null || e.note === undefined) continue;
    if (e.note === 'OFF') { out.push({ t: t0, pri: 1, kind: 'off', track: e.track }); continue; }
    if (fx.chance !== undefined && !rnd.chance(fx.chance)) continue;
    const nudge = (fx.nudge || 0) * L;
    const retrig = Math.max(1, fx.retrig || 1);
    const spacing = L / retrig;
    const slideFrom = lastNote.get(e.track);
    for (let k = 0; k < retrig; k++) {
      const t = t0 + nudge + k * spacing;
      out.push({
        t, pri: 2, kind: 'on', track: e.track, note: e.note, inst: e.inst, vel: e.vel * (k > 0 ? 0.85 : 1),
        accent: fx.accent || 0,
        slide: fx.slide !== undefined && slideFrom !== undefined ? { from: slideFrom, seconds: fx.slide * L / sampleRate } : null,
        table: fx.table || null,
        stepSamples: L,
        step: e.step,
      });
      if (fx.cut !== undefined) out.push({ t: t + fx.cut * spacing, pri: 1, kind: 'off', track: e.track });
    }
    lastNote.set(e.track, e.note);
  }
  out.sort((a, b) => a.t - b.t || a.pri - b.pri);
  return { events: out, grid };
}

class Track {
  constructor(def, index) {
    this.def = def;
    this.index = index;
    this.ctl = {};
    this.current = null;
    this.releasing = [];
    this.bufL = new Float32Array(BLOCK);
    this.bufR = new Float32Array(BLOCK);
  }
}

/**
 * Render a song to stereo float buffers.
 * @param {object} song valid tracker-song/0.1
 * @param {object} [opts]
 * @param {number} [opts.sampleRate=44100]
 * @param {number} [opts.maxSeconds] stop after this long (the tail is cut)
 * @param {number} [opts.loops=0] times to repeat the loop region
 * @param {number} [opts.tailSeconds=2] silence appended for releases and reverb
 * @param {(fraction:number)=>void} [opts.onProgress]
 * @returns {{left: Float32Array, right: Float32Array, sampleRate: number, grid: object, seconds: number}}
 */
export function renderSong(song, opts = {}) {
  const sampleRate = opts.sampleRate || 44100;
  const resolved = resolve(song, { loops: opts.loops || 0 });
  const { events, grid } = schedule(song, resolved, sampleRate, song.meta?.seed ?? 1);
  const tail = opts.tailSeconds ?? 2;
  let total = Math.ceil(grid.seconds * sampleRate) + Math.round(tail * sampleRate);
  if (opts.maxSeconds) total = Math.min(total, Math.round(opts.maxSeconds * sampleRate));
  const left = new Float32Array(total);
  const right = new Float32Array(total);

  const tracks = song.composition.tracks.map((t, i) => new Track(t, i));
  const instruments = song.sound.instruments;
  const tables = song.sound.tables || {};
  const master = new Master(sampleRate, song.sound.master, grid.lengths[0]);
  const dry = { L: new Float32Array(BLOCK), R: new Float32Array(BLOCK) };
  const dly = { L: new Float32Array(BLOCK), R: new Float32Array(BLOCK) };
  const rev = { L: new Float32Array(BLOCK), R: new Float32Array(BLOCK) };

  let ei = 0;
  let pos = 0;
  let currentStepLen = grid.lengths[0];
  let stepCursor = 0;

  const applyEvent = (ev) => {
    const tr = tracks[ev.track];
    if (ev.kind === 'ctl') { Object.assign(tr.ctl, ev.ctl); return; }
    if (ev.kind === 'off') { if (tr.current) tr.current.noteOff(); return; }
    const inst = instruments[ev.inst];
    if (!inst) return;
    const tableDef = ev.table ? tables[ev.table] : inst.table ? tables[inst.table] : null;
    const legato = !!ev.slide && tr.current && !tr.current.done && tr.current.inst === inst;
    if (legato) {
      tr.current.noteOn(ev.note, ev.vel, { accent: ev.accent, slideFrom: ev.slide.from, slideSeconds: ev.slide.seconds, legato: true, table: tableDef, stepSamples: ev.stepSamples });
      return;
    }
    if (tr.current && !tr.current.done) {
      tr.current.noteOff();
      tr.releasing.push(tr.current);
      while (tr.releasing.length > MAX_RELEASING) tr.releasing.shift().choke();
    }
    const v = createVoice(inst, sampleRate, tr.ctl);
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
  };

  const renderVoice = (tr, v, count) => {
    tr.bufL.fill(0, 0, count); tr.bufR.fill(0, 0, count);
    v.render(tr.bufL, tr.bufR, 0, count, currentStepLen);
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
  };

  while (pos < total) {
    // Advance to any events at or before pos.
    while (ei < events.length && events[ei].t <= pos) applyEvent(events[ei++]);
    // Track the current step length for tables and synced LFOs.
    while (stepCursor < resolved.totalSteps && grid.starts[stepCursor + 1] <= pos) stepCursor++;
    currentStepLen = grid.lengths[Math.min(stepCursor, grid.lengths.length - 1)];
    if (currentStepLen !== master.lastStep) { master.setStep(currentStepLen); master.lastStep = currentStepLen; }

    let count = Math.min(BLOCK, total - pos);
    if (ei < events.length) count = Math.min(count, Math.max(1, Math.ceil(events[ei].t) - pos));

    dry.L.fill(0, 0, count); dry.R.fill(0, 0, count);
    dly.L.fill(0, 0, count); dly.R.fill(0, 0, count);
    rev.L.fill(0, 0, count); rev.R.fill(0, 0, count);

    for (const tr of tracks) {
      if (tr.current) {
        if (tr.current.done) tr.current = null;
        else renderVoice(tr, tr.current, count);
      }
      if (tr.releasing.length) {
        for (const v of tr.releasing) if (!v.done) renderVoice(tr, v, count);
        tr.releasing = tr.releasing.filter((v) => !v.done);
      }
    }
    master.process(dry, dly, rev, left, right, pos, count);
    pos += count;
    if (opts.onProgress && (pos & 0xffff) < count) opts.onProgress(pos / total);
  }
  return { left, right, sampleRate, grid, seconds: total / sampleRate, resolved };
}
