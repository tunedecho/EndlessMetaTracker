import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderSong, stepGrid, schedule, encodeWav, decodeWav, analyze, Osc, SVF, ADSR, Player } from '../lib/index.js';
import { resolve } from '@tracker/format';

const SR = 44100;
const example = (f) => JSON.parse(readFileSync(new URL(`../../format/examples/${f}`, import.meta.url), 'utf8'));

/** A one-track song from a step list, for focused tests. */
function mini({ bpm = 120, swing = 0, inst, steps, rows = 1, tables, phraseLength = 16, loop }) {
  const transport = { bpm, swing, phraseLength };
  if (loop !== undefined) transport.loop = loop;
  return {
    format: 'tracker-song/0.1', transport,
    sound: { instruments: { x: inst }, tables, master: { volume: 1, limiter: false } },
    composition: {
      tracks: [{ id: 't', instrument: 'x' }],
      phrases: { p: { steps } },
      chains: { c: { rows: [{ phrase: 'p' }] } },
      song: { rows: Array.from({ length: rows }, () => ({ t: 'c' })) },
    },
  };
}
const KICK = { engine: 'kick', params: { pitchStart: 150, pitchEnd: 50, pitchDecay: 0.03, body: 0.15 }, mix: { volume: 1 } };
const SINE = { engine: 'analog', params: { wave: 'sine' }, amp: { attack: 0.001, decay: 0.01, sustain: 1, release: 0.01 }, mix: { volume: 1 } };
const rest = (n) => Array.from({ length: n }, () => null);

/** Estimate frequency by zero crossings over a window. */
function freqOf(buf, sr, start, end) {
  start = Math.round(start); end = Math.round(end);
  let z = 0;
  for (let i = start + 1; i < end; i++) if (buf[i - 1] < 0 && buf[i] >= 0) z++;
  return z / ((end - start) / sr);
}

test('oscillators stay in range and the filter is stable at full resonance', () => {
  for (const shape of ['sine', 'saw', 'square', 'pulse', 'triangle']) {
    const o = new Osc(SR, shape);
    let max = 0;
    for (let i = 0; i < 20000; i++) max = Math.max(max, Math.abs(o.next(440)));
    assert.ok(max <= 1.2, `${shape} peak ${max}`);
  }
  const f = new SVF(SR); f.set(2000, 1);
  const o = new Osc(SR, 'saw');
  let max = 0;
  for (let i = 0; i < SR; i++) { const y = f.lp(o.next(110)); assert.ok(Number.isFinite(y)); max = Math.max(max, Math.abs(y)); }
  assert.ok(max < 30, `resonant peak ${max}`);
});

test('envelope reaches sustain and releases to silence', () => {
  const e = new ADSR(SR, { attack: 0.01, decay: 0.05, sustain: 0.5, release: 0.05 });
  e.trigger();
  let v = 0;
  for (let i = 0; i < SR * 0.1; i++) v = e.next();
  assert.ok(Math.abs(v - 0.5) < 0.01, `sustain ${v}`);
  e.gate(false);
  for (let i = 0; i < SR * 0.2; i++) v = e.next();
  assert.ok(e.done && v === 0);
});

test('step grid follows tempo and swing', () => {
  const song = mini({ bpm: 120, inst: KICK, steps: rest(16) });
  const g = stepGrid(resolve(song), SR);
  const L = 60 / 120 / 4 * SR;
  assert.ok(Math.abs(g.lengths[0] - L) < 1e-9);
  assert.ok(Math.abs(g.starts[4] - 4 * L) < 1e-9);
  const swung = mini({ bpm: 120, swing: 0.25, inst: KICK, steps: rest(16) });
  const gs = stepGrid(resolve(swung), SR);
  assert.ok(Math.abs(gs.starts[1] - 1.25 * L) < 1e-9);
  assert.ok(Math.abs(gs.starts[2] - 2 * L) < 1e-9);
});

test('tempo command changes step length from that step', () => {
  const steps = rest(16); steps[0] = { note: 'C3' }; steps[8] = { note: 'C3', fx: { tempo: 60 } };
  const g = stepGrid(resolve(mini({ bpm: 120, inst: KICK, steps })), SR);
  assert.ok(Math.abs(g.lengths[7] - 60 / 120 / 4 * SR) < 1e-9);
  assert.ok(Math.abs(g.lengths[8] - 60 / 60 / 4 * SR) < 1e-9);
});

test('kicks land on the grid', () => {
  const steps = rest(16); for (const s of [0, 4, 8, 12]) steps[s] = { note: 'C3' };
  const song = mini({ bpm: 120, inst: KICK, steps, rows: 2 });
  const r = renderSong(song, { tailSeconds: 0.5 });
  const on = analyze.onsets(r.left, SR, { frameSeconds: 0.002, minGap: 0.1 });
  assert.equal(on.length, 8, `onsets ${on.join(',')}`);
  on.forEach((t, i) => assert.ok(Math.abs(t - i * 0.5) < 0.01, `onset ${i} at ${t}`));
});

test('retrig and nudge split and shift a step', () => {
  const steps = rest(16); steps[0] = { note: 'C3', fx: { retrig: 4 } }; steps[8] = { note: 'C3', fx: { nudge: 0.5 } };
  const song = mini({ bpm: 120, inst: KICK, steps });
  const { events } = schedule(song, resolve(song), SR);
  const ons = events.filter((e) => e.kind === 'on').map((e) => e.t / SR);
  assert.equal(ons.length, 5);
  assert.ok(Math.abs(ons[1] - 0.125 / 4) < 1e-9);
  assert.ok(Math.abs(ons[4] - (1 + 0.0625)) < 1e-9);
});

test('a sine plays at the right pitch, tables transpose it, OFF ends it', () => {
  const steps = rest(16); steps[0] = { note: 'A3' }; steps[8] = { note: 'OFF' };
  const r = renderSong(mini({ bpm: 120, inst: SINE, steps }), { tailSeconds: 0.5 });
  const f = freqOf(r.left, SR, SR * 0.1, SR * 0.9);
  assert.ok(Math.abs(f - 220) < 2, `freq ${f}`);
  assert.ok(analyze.rms(r.left, SR * 1.2, SR * 1.9) < 1e-3, 'silent after OFF');

  const tables = { up: { rate: 0.25, loop: false, rows: [{ transpose: 0 }, { transpose: 12 }] } };
  const steps2 = rest(16); steps2[0] = { note: 'A3', fx: { table: 'up' } };
  const r2 = renderSong(mini({ bpm: 120, inst: SINE, steps: steps2, tables }), { tailSeconds: 0.5 });
  const f1 = freqOf(r2.left, SR, SR * 0.05, SR * 0.45);
  const f2 = freqOf(r2.left, SR, SR * 0.55, SR * 0.95);
  assert.ok(Math.abs(f1 - 220) < 3, `row0 ${f1}`);
  assert.ok(Math.abs(f2 - 440) < 4, `row1 ${f2}`);
});

test('slide glides between pitches', () => {
  const inst = { ...SINE, params: { wave: 'sine', glide: 0 } };
  const steps = rest(16); steps[0] = { note: 'A3' }; steps[4] = { note: 'A4', fx: { slide: 1 } };
  const r = renderSong(mini({ bpm: 60, inst, steps }), { tailSeconds: 0.2 });
  const before = freqOf(r.left, SR, SR * 0.2, SR * 0.9);
  const mid = freqOf(r.left, SR, SR * 1.0, SR * 1.1);
  const after = freqOf(r.left, SR, SR * 2.5, SR * 3.5);
  assert.ok(Math.abs(before - 220) < 3);
  assert.ok(mid > 240 && mid < 430, `mid-slide ${mid}`);
  assert.ok(Math.abs(after - 440) < 5, `after ${after}`);
});

test('track commands change the sound of the playing note', () => {
  const inst = { engine: 'analog', params: { wave: 'saw' }, filter: { cutoff: 0.9 }, amp: { sustain: 1, release: 0.01 }, mix: { volume: 1 } };
  const steps = rest(16); steps[0] = { note: 'C2' }; steps[8] = { fx: { cutoff: 0.15 } };
  const r = renderSong(mini({ bpm: 120, inst, steps }), { tailSeconds: 0 });
  const open = analyze.bandBalance(r.left.slice(SR * 0.2, SR * 0.9), SR, 150, 2000);
  const closed = analyze.bandBalance(r.left.slice(SR * 1.2, SR * 1.9), SR, 150, 2000);
  assert.ok(closed.high < open.high * 0.3, `high ${open.high} -> ${closed.high}`);
});

test('every example renders without clipping and with energy', () => {
  for (const f of ['hello-tracker.json', 'minimal-techno-loop.json', 'ambient-drift.json']) {
    const r = renderSong(example(f), { maxSeconds: 12, tailSeconds: 0 });
    const rep = analyze.report(r.left, r.right, SR);
    assert.ok(rep.clip < 0.001, `${f} clip ${rep.clip}`);
    assert.ok(rep.rmsDb > -30, `${f} rms ${rep.rmsDb}`);
    assert.ok(rep.peakDb <= 0);
  }
});

test('wav round-trips', () => {
  const l = new Float32Array([0, 0.5, -0.5, 1]); const r = new Float32Array([0.25, 0, 0, -1]);
  const d = decodeWav(encodeWav(l, r, 22050));
  assert.equal(d.sampleRate, 22050);
  assert.ok(Math.abs(d.channels[0][1] - 0.5) < 1e-3);
  assert.ok(Math.abs(d.channels[1][3] + 1) < 1e-3);
});

test('loop repeats the region', () => {
  const steps = rest(16); steps[0] = { note: 'C3' };
  const song = mini({ bpm: 120, inst: KICK, steps, rows: 2, loop: 1 });
  const once = renderSong(song, { tailSeconds: 0 });
  const twice = renderSong(song, { loops: 1, tailSeconds: 0 });
  assert.equal(twice.left.length, once.left.length + 2 * SR);
});

test('live play: a held note sounds until noteOff, and instrument edits reach it', () => {
  const SAW = { engine: 'analog', params: { wave: 'saw' }, filter: { cutoff: 0.9 }, amp: { attack: 0.001, sustain: 1, release: 0.01 }, mix: { volume: 1 } };
  const p = new Player({ transport: { bpm: 120 }, sound: { instruments: { x: SAW }, master: { volume: 1, limiter: false } }, composition: { tracks: [{ id: 'v0' }] } }, { sampleRate: SR });
  const rms = (b) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);
  p.noteOn(0, 'x', 48);
  const open = rms(p.render(SR / 4).left);
  p.updateInstrument('x', { ...SAW, filter: { cutoff: 0.05 } });
  p.render(SR / 50);
  const closed = rms(p.render(SR / 4).left);
  assert.ok(open > 0.05, `open ${open}`);
  assert.ok(closed < open / 4, `the filter closed on the held note: ${closed} vs ${open}`);
  p.noteOff(0);
  p.render(SR / 10);
  assert.ok(rms(p.render(SR / 10).left) < 1e-4, 'silent after release');
});

test('a host can bring its own voices through createVoice', () => {
  const calls = [];
  const factory = (inst, sr, ctl, where) => {
    calls.push({ engine: inst.engine, track: where.track, sr });
    // A 441 Hz square (the master high-passes DC) with the voice interface: ctl (kept for the mixer), noteOn, noteOff, choke, render, done.
    return {
      ctl, done: true, midi: 0, amp: { stage: 'idle' }, n: 0,
      noteOn(midi) { this.midi = midi; this.done = false; this.amp.stage = 'sustain'; },
      noteOff() { this.done = true; this.amp.stage = 'release'; },
      choke() { this.done = true; },
      render(L, R, start, count) { for (let i = 0; i < count; i++) { const v = (this.n++ % 100) < 50 ? 0.25 : -0.25; L[start + i] += v; R[start + i] += v; } },
    };
  };
  const ext = { engine: 'external', mix: { volume: 1 } };
  const steps = rest(16);
  steps[0] = { note: 'C3' };
  steps[8] = { note: 'OFF' };
  const r = renderSong(mini({ bpm: 120, inst: ext, steps }), { tailSeconds: 0, createVoice: factory });
  assert.deepEqual(calls.map((c) => [c.engine, c.track, c.sr]), [['external', 0, SR]]);
  const step = SR / 8; // 120 bpm, four steps a beat
  const level = (i) => { const a = Math.round(i * step), b = a + Math.round(step / 2); let m = 0; for (let k = a; k < b; k++) m = Math.max(m, Math.abs(r.left[k])); return m; };
  assert.ok(level(2) > 0.05, `the external voice sounds: ${level(2)}`);
  assert.ok(level(12) < 1e-6, `and stops at OFF: ${level(12)}`);
});

test('a track switched to another instrument plays it from the next appended row', () => {
  const SINE = { engine: 'analog', params: { wave: 'sine' }, amp: { attack: 0.001, sustain: 1, release: 0.005 }, mix: { volume: 1 } };
  const steps = rest(16);
  steps[0] = { note: 'C3' };
  const song = mini({ bpm: 120, inst: SINE, steps });
  song.sound.instruments.quiet = { ...SINE, mix: { volume: 0.05 } };
  const p = new Player(song, { sampleRate: SR });
  const comp = song.composition;
  const bar = SR * 2; // 16 steps at 120 bpm
  const level = (b) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);
  p.appendRow(comp.song.rows[0], comp);
  const loud = level(p.render(bar).left.subarray(0, SR / 4));
  const switched = { ...comp, tracks: comp.tracks.map((t) => ({ ...t, instrument: 'quiet' })) };
  p.appendRow(comp.song.rows[0], switched);
  const soft = level(p.render(bar).left.subarray(0, SR / 4));
  assert.ok(soft < loud / 5, `the second bar plays the new instrument: ${soft} vs ${loud}`);
});

test('a host can replace the reverb return and add a master chain', () => {
  const SAW = { engine: 'analog', params: { wave: 'saw' }, amp: { attack: 0.001, sustain: 1, release: 0.01 }, mix: { volume: 1, reverbSend: 1 } };
  const steps = rest(16);
  steps[0] = { note: 'C3' };
  steps[2] = { note: 'OFF' };
  const song = mini({ bpm: 120, inst: SAW, steps });
  song.sound.master.reverb = { size: 0.9, level: 0.5 };
  const tail = (r) => { let s = 0; for (let i = SR; i < 2 * SR; i++) s += r.left[i] * r.left[i]; return Math.sqrt(s / SR); };
  const built = renderSong(song, { tailSeconds: 0 });
  const calls = { reverb: 0, chain: 0 };
  const silentReverb = (L, R, n) => { calls.reverb++; L.fill(0, 0, n); R.fill(0, 0, n); return true; };
  const halve = (L, R, n) => { calls.chain++; for (let i = 0; i < n; i++) { L[i] *= 0.5; R[i] *= 0.5; } return true; };
  const replaced = renderSong(song, { tailSeconds: 0, busEffects: { reverb: silentReverb } });
  assert.ok(tail(built) > 1e-3, `the built-in reverb rings after the note: ${tail(built)}`);
  assert.ok(tail(replaced) < 1e-6, `a host reverb that returns silence replaces it: ${tail(replaced)}`);
  // Voices start at random phases (Math.random), so compare two renders with it seeded alike.
  const seeded = (fn) => { const real = Math.random; let x = 1; Math.random = () => ((x = (x * 16807) % 2147483647) / 2147483647); try { return fn(); } finally { Math.random = real; } };
  const plain = seeded(() => renderSong(song, { tailSeconds: 0 }));
  const declined = seeded(() => renderSong(song, { tailSeconds: 0, busEffects: { reverb: () => false } }));
  assert.ok(declined.left.every((v, i) => v === plain.left[i]), 'returning false keeps the built-in reverb, sample for sample');
  const chained = renderSong(song, { tailSeconds: 0, busEffects: { reverb: silentReverb, chain: halve } });
  const peak = (r) => r.left.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  assert.ok(Math.abs(peak(chained) / peak(replaced) - 0.5) < 0.05, `the chain runs before the master volume: ${peak(chained)} vs ${peak(replaced)}`);
  assert.ok(calls.reverb > 0 && calls.chain > 0);
});

test('a parameter lock shapes its own note only, and wins over a track command', () => {
  const SAW = { engine: 'analog', params: { wave: 'saw' }, filter: { cutoff: 0.9 }, amp: { attack: 0.001, sustain: 1, release: 0.005 }, mix: { volume: 1 } };
  const steps = rest(16);
  steps[0] = { note: 'C3', fx: { cutoff: 0.9 } };
  steps[4] = { note: 'C3', lock: { 'filter.cutoff': 0.05 } }; // dark, despite the track command
  steps[8] = { note: 'C3' };                                   // back to the command's value
  const r = renderSong(mini({ bpm: 120, inst: SAW, steps }), { tailSeconds: 0 });
  const step = r.grid.starts[1] - r.grid.starts[0];
  const rms = (s) => { const a = Math.round(r.grid.starts[s] + step * 0.3), b = Math.round(r.grid.starts[s] + step * 0.9); let e = 0; for (let i = a; i < b; i++) e += r.left[i] ** 2; return Math.sqrt(e / (b - a)); };
  const open = rms(0), locked = rms(4), after = rms(8);
  assert.ok(locked < open / 4, `locked note is dark: ${locked} vs ${open}`);
  assert.ok(Math.abs(after - open) / open < 0.2, `the next note is back: ${after} vs ${open}`);
  assert.equal(SAW.filter.cutoff, 0.9, 'the instrument itself is untouched');
});
