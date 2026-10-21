/** Regression tests for defects found by an independent review of the first build. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSong, Player, analyze, schedule } from '../lib/index.js';
import { resolve } from '@tracker/format';

const SR = 44100;
const rest = (n) => Array.from({ length: n }, () => null);
function mini({ bpm = 120, swing = 0, inst, steps, rows = 1, phraseLength = 16, loop, phrases }) {
  const transport = { bpm, swing, phraseLength };
  if (loop !== undefined) transport.loop = loop;
  return {
    format: 'tracker-song/0.1', transport,
    sound: { instruments: { x: inst }, master: { volume: 1, limiter: false } },
    composition: {
      tracks: [{ id: 't', instrument: 'x' }],
      phrases: phrases || { p: { steps } },
      chains: { c: { rows: [{ phrase: 'p' }] } },
      song: { rows: Array.from({ length: rows }, () => ({ t: 'c' })) },
    },
  };
}
const SINE = { engine: 'analog', params: { wave: 'sine' }, amp: { attack: 0.001, decay: 0.01, sustain: 1, release: 0.01 }, mix: { volume: 1 } };
const KICK = { engine: 'kick', params: { pitchStart: 150, pitchEnd: 50, pitchDecay: 0.03, body: 0.15 }, mix: { volume: 1 } };
function freqOf(buf, start, end) {
  start = Math.round(start); end = Math.round(end);
  let z = 0; for (let i = start + 1; i < end; i++) if (buf[i - 1] < 0 && buf[i] >= 0) z++;
  return z / ((end - start) / SR);
}

test('a late event at the end of a row does not delay the next row', () => {
  const phrases = { a: { steps: rest(16) }, b: { steps: rest(16) } };
  phrases.a.steps[15] = { note: 'C3', fx: { nudge: 0.9 } };
  phrases.b.steps[0] = { note: 'C3' };
  const song = mini({ bpm: 120, swing: 0.25, inst: KICK, phrases });
  song.composition.chains = { ca: { rows: [{ phrase: 'a' }] }, cb: { rows: [{ phrase: 'b' }] } };
  song.composition.song.rows = [{ t: 'ca' }, { t: 'cb' }];
  const p = new Player(song, { sampleRate: SR });
  p.appendRow(song.composition.song.rows[0], song.composition);
  p.appendRow(song.composition.song.rows[1], song.composition);
  for (let i = 1; i < p.events.length; i++) assert.ok(p.events[i].t >= p.events[i - 1].t, 'events sorted');
  const L = 60 / 120 / 4 * SR;
  const ons = p.events.filter((e) => e.kind === 'on').map((e) => e.t / L);
  assert.ok(ons.some((t) => Math.abs(t - 16) < 1e-9), `row-1 kick scheduled at 16: ${ons.map((t) => t.toFixed(3))}`);
  assert.ok(ons.some((t) => Math.abs(t - 16.15) < 1e-9), 'nudged swung note lands at 16.15');
  // And the render has sound right at the row boundary, not 0.15 steps later.
  const r = renderSong(song, { tailSeconds: 0.2 });
  const before = analyze.rms(r.left, Math.round(16 * L - 300), Math.round(16 * L - 20));
  const after = analyze.rms(r.left, Math.round(16 * L + 20), Math.round(16 * L + 300));
  assert.ok(after > before * 3, `energy rises at the boundary: ${before} -> ${after}`);
});

test('evicted release tails are faded, not cut', () => {
  const inst = { ...SINE, amp: { attack: 0.001, decay: 0.01, sustain: 1, release: 0.5 } };
  const steps = rest(16); steps[0] = { note: 'A2', fx: { retrig: 8 } }; steps[1] = { note: 'OFF' };
  const r = renderSong(mini({ bpm: 120, inst, steps }), { tailSeconds: 1 });
  let maxJump = 0;
  for (let i = 1; i < SR; i++) maxJump = Math.max(maxJump, Math.abs(r.left[i] - r.left[i - 1]));
  assert.ok(maxJump < 0.12, `max sample jump ${maxJump}`);
});

test('the song end releases sustaining notes so the tail decays', () => {
  const inst = { ...SINE, amp: { attack: 0.001, decay: 0.01, sustain: 1, release: 0.3 } };
  const steps = rest(16); steps[0] = { note: 'A2' };
  const r = renderSong(mini({ bpm: 120, inst, steps }), { tailSeconds: 2 });
  const last = analyze.rms(r.left, r.left.length - 2205, r.left.length);
  assert.ok(last < 1e-3, `rms in the last 50 ms ${last}`);
});

test('an LFO without depth is silent modulation, not NaN', () => {
  for (const target of ['cutoff', 'pitch', 'volume']) {
    const inst = { ...SINE, filter: { cutoff: 0.5 }, lfo: { shape: 'sine', rate: 2, target } };
    const steps = rest(16); steps[0] = { note: 'A3' };
    const r = renderSong(mini({ bpm: 120, inst, steps }), { tailSeconds: 0 });
    assert.ok(r.left.every(Number.isFinite), `${target}: NaN`);
    assert.ok(analyze.rms(r.left) > 0.01);
  }
});

test('a partial amp on a drum engine still decays to silence', () => {
  const inst = { engine: 'kick', params: { pitchStart: 150, pitchEnd: 50 }, amp: { decay: 0.3 }, mix: { volume: 1 } };
  const steps = rest(16); steps[0] = { note: 'C3' };
  const r = renderSong(mini({ bpm: 120, inst, steps }), { tailSeconds: 2 });
  assert.ok(analyze.rms(r.left, SR * 3, SR * 3.5) < 1e-3);
});

test('params.glide makes notes without a gap glide', () => {
  const inst = { ...SINE, params: { wave: 'sine', glide: 0.5 } };
  const steps = rest(16); steps[0] = { note: 'A3' }; steps[4] = { note: 'A4' };
  const r = renderSong(mini({ bpm: 60, inst, steps }), { tailSeconds: 0 });
  const mid = freqOf(r.left, SR * 1.05, SR * 1.15);
  assert.ok(mid > 250 && mid < 420, `mid-glide ${mid}`);
});

test('odd phrase lengths with swing keep rows the right length', () => {
  const song = mini({ bpm: 120, swing: 0.25, inst: KICK, steps: rest(15), phraseLength: 15, rows: 2 });
  const p = new Player(song, { sampleRate: SR });
  const info = p.appendRow(song.composition.song.rows[0], song.composition);
  assert.ok(Math.abs(info.samples - 15 * 60 / 120 / 4 * SR) < 1e-6);
});

test('slides work across a row boundary in the player', () => {
  const phrases = { a: { steps: rest(16) }, b: { steps: rest(16) } };
  phrases.a.steps[0] = { note: 'A3' }; phrases.b.steps[0] = { note: 'A4', fx: { slide: 1 } };
  const song = mini({ bpm: 120, inst: SINE, steps: null, phrases });
  song.composition.chains = { ca: { rows: [{ phrase: 'a' }] }, cb: { rows: [{ phrase: 'b' }] } };
  song.composition.song.rows = [{ t: 'ca' }, { t: 'cb' }];
  const p = new Player(song, { sampleRate: SR });
  p.appendRow(song.composition.song.rows[0], song.composition);
  p.appendRow(song.composition.song.rows[1], song.composition);
  const on = p.events.filter((e) => e.kind === 'on');
  assert.ok(on[1].slide && on[1].slide.from === 57, 'slide from the previous row\'s note');
});

test('resolve emits OFF for a track that is absent after a loop jump', () => {
  const phrases = { a: { steps: rest(16) }, b: { steps: rest(16) } };
  phrases.b.steps[0] = { note: 'C3' };
  const song = {
    format: 'tracker-song/0.1', transport: { bpm: 120, loop: 0 },
    sound: { instruments: { x: SINE } },
    composition: { tracks: [{ id: 't', instrument: 'x' }, { id: 'u', instrument: 'x' }], phrases, chains: { ca: { rows: [{ phrase: 'a' }] }, cb: { rows: [{ phrase: 'b' }] } }, song: { rows: [{ t: 'ca' }, { t: 'ca', u: 'cb' }] } },
  };
  const r = resolve(song, { loops: 1 });
  assert.ok(r.events.some((e) => e.trackId === 'u' && e.note === 'OFF' && e.step === 32), 'OFF at loop re-entry');
});
