/**
 * Sequencer and renderer. Turns a song into sample-accurate note and control
 * events, runs the voices, mixes through the master bus, and returns audio.
 *
 * Timing: step boundaries are computed in samples from the tempo, with swing
 * delaying every second step. Tempo commands change the step length from the
 * step they land on. Events are processed at their exact sample, so rendering
 * is deterministic apart from the noise sources.
 */
import { resolve, stepSeconds, Random } from '../../format/lib/core.js';
import { Player } from './player.js';


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
    starts[s] = t + (s % 2 === 1 && s < totalSteps ? swing * L : 0);
    t += L;
  }
  return { starts, lengths, seconds: t / sampleRate };
}

/**
 * Expand the resolved timeline into sample-stamped events.
 * Kinds: ctl (track command), on, off.
 */
export function schedule(song, resolved, sampleRate, seed = 1, lastNote = new Map()) {
  const grid = stepGrid(resolved, sampleRate);
  const rnd = new Random(seed);
  const out = [];
  // lastNote: track -> midi, for slides; a caller may pass one that persists across rows
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
        t, pri: 2, kind: 'on', track: e.track, note: e.note, chord: e.chord || null, inst: e.inst, vel: e.vel * (k > 0 ? 0.85 : 1),
        accent: fx.accent || 0,
        slide: fx.slide !== undefined && slideFrom !== undefined ? { from: slideFrom, seconds: fx.slide * L / sampleRate } : null,
        table: fx.table || null,
        lock: e.lock || null,
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

/**
 * Render a song to stereo float buffers. Builds a Player, appends every row
 * (repeating the loop region if asked), and renders the whole stream.
 * @param {object} song valid tracker-song/0.1
 * @param {object} [opts]
 * @param {number} [opts.sampleRate=44100]
 * @param {number} [opts.maxSeconds] stop after this long (the tail is cut)
 * @param {number} [opts.loops=0] times to repeat the loop region
 * @param {number} [opts.tailSeconds=2] silence appended for releases and reverb
 * @param {(fraction:number)=>void} [opts.onProgress]
 * @returns {{left: Float32Array, right: Float32Array, sampleRate: number, grid: {starts: Float64Array, lengths: Float64Array}, seconds: number, resolved: {rows: object[], transport: object}}}
 */
export function renderSong(song, opts = {}) {
  const sampleRate = opts.sampleRate || 44100;
  const player = new Player(song, { sampleRate, seed: song.meta?.seed ?? 1, createVoice: opts.createVoice, busEffects: opts.busEffects });
  const comp = song.composition;
  const sections = new Map((comp.song.sections || []).map((s) => [s.row, s]));
  const rows = comp.song.rows;
  const order = [];
  for (let r = 0; r < rows.length; r++) order.push(r);
  if (song.transport.loop !== undefined) for (let k = 0; k < (opts.loops || 0); k++) for (let r = song.transport.loop; r < rows.length; r++) order.push(r);
  for (const r of order) {
    const sec = sections.get(r);
    player.appendRow(rows[r], comp, { name: sec?.name, energy: sec?.energy });
  }
  player.end();
  const tail = opts.tailSeconds ?? 2;
  let total = Math.ceil(player.rowStart) + Math.round(tail * sampleRate);
  if (opts.maxSeconds) total = Math.min(total, Math.round(opts.maxSeconds * sampleRate));
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  const chunk = 65536;
  for (let p = 0; p < total; p += chunk) {
    const n = Math.min(chunk, total - p);
    player.render(n, left, right, p);
    if (opts.onProgress) opts.onProgress((p + n) / total);
  }
  const starts = Float64Array.from(player.stepStarts.concat([player.rowStart]));
  const lengths = Float64Array.from(player.stepLengths.concat([player.currentStepLen]));
  return {
    left, right, sampleRate, seconds: total / sampleRate,
    grid: { starts, lengths },
    resolved: { rows: player.rows, transport: player.transport, totalSteps: player.stepBase },
  };
}
