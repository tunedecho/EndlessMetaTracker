import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, validate } from '@tracker/format';
import { renderSong } from '../lib/index.js';
import { weird, MACROS } from '../web/weird.js';

const defs = JSON.parse(readFileSync(new URL('../../format/schema/song.json', import.meta.url), 'utf8')).$defs;
const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const loop = load('../../format/examples/minimal-techno-loop.json');
const all = (v) => Object.fromEntries(Object.keys(MACROS).map((k) => [k, v]));
/** Where locks landed, as "row:track:step" keys. */
const locked = (song) => new Set(resolve(song).events.filter((e) => e.lock).map((e) => `${e.row}:${e.trackId}:${e.step}`));

test('weird: with every knob at zero the song comes back as it was', () => {
  assert.equal(weird(loop, defs, { amounts: all(0) }), loop);
});

test('weird: full weirdness still makes a valid song, renders cleanly, and leaves the original alone', () => {
  const before = JSON.stringify(loop);
  for (const song of [loop, load('../../endless-techno/previews/hypnotic-techno-3.json')]) {
    const w = weird(song, defs, { seed: 7, amounts: all(1), depth: 1, rows: [0, Math.min(3, song.composition.song.rows.length)] });
    assert.deepEqual(validate(w).errors, []);
  }
  assert.equal(JSON.stringify(loop), before);
  const r = renderSong(weird(loop, defs, { seed: 3, amounts: all(0.7), depth: 0.8 }), { tailSeconds: 0.5 });
  let peak = 0;
  for (const v of r.left) { assert.ok(Number.isFinite(v)); peak = Math.max(peak, Math.abs(v)); }
  assert.ok(peak > 0.05 && peak <= 1);
});

test('weird: turning a knob up only adds, and the seed decides the rest', () => {
  const low = locked(weird(loop, defs, { seed: 5, amounts: { chaos: 0.3 } }));
  const high = locked(weird(loop, defs, { seed: 5, amounts: { chaos: 0.7 } }));
  assert.ok(low.size > 0 && high.size > low.size);
  for (const k of low) assert.ok(high.has(k), `${k} stays locked as chaos rises`);
  const again = JSON.stringify(weird(loop, defs, { seed: 5, amounts: { chaos: 0.3 } }));
  assert.equal(again, JSON.stringify(weird(loop, defs, { seed: 5, amounts: { chaos: 0.3 } })));
  assert.notEqual(again, JSON.stringify(weird(loop, defs, { seed: 6, amounts: { chaos: 0.3 } })));
});

test('weird: vary gives repeats of a shared phrase their own weirdness; scope keeps it in place', () => {
  const varied = weird(loop, defs, { seed: 2, amounts: { drift: 1 }, depth: 1, vary: true });
  // Drift wanders along time, so the bass on bar 0 and bar 2 of row 2 differ when each bar has its own phrase.
  const ev = resolve(varied).events.filter((e) => e.row === 2 && e.trackId === 'bass' && e.lock);
  assert.ok(new Set(ev.map((e) => JSON.stringify(e.lock))).size > 1);
  const shared = weird(loop, defs, { seed: 2, amounts: { chaos: 1 }, vary: false });
  assert.deepEqual(Object.keys(shared.composition.phrases).sort(), Object.keys(loop.composition.phrases).sort());
  const scoped = weird(loop, defs, { seed: 2, amounts: { chaos: 1 }, rows: [2, 3], tracks: ['bass'] });
  for (const k of locked(scoped)) assert.match(k, /^2:bass:/);
  assert.ok(locked(scoped).size > 0);
});

test('weird: ghosts add quiet notes and thin adds chance', () => {
  const notes = (s) => resolve(s).events.filter((e) => typeof e.note === 'number');
  const g = weird(loop, defs, { seed: 1, amounts: { ghosts: 1 } });
  const extra = notes(g).length - notes(loop).length;
  assert.ok(extra > 0);
  assert.ok(notes(g).filter((e) => e.vel < 0.4).length >= extra);
  const t = weird(loop, defs, { seed: 1, amounts: { thin: 1 } });
  assert.ok(notes(t).every((e) => e.fx.chance !== undefined));
});
