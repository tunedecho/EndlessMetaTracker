import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateSong, euclid, planSections, chooseLayers, mutate, OPS } from '../lib/index.js';
import { validate, Random, resolve, songStats } from '@tracker/format';

const style = JSON.parse(readFileSync(new URL('../styles/hypnotic-techno.json', import.meta.url), 'utf8'));

test('the style validates', () => {
  const r = validate(style);
  assert.ok(r.ok, r.errors.join('; '));
});

test('euclidean rhythms are evenly spread', () => {
  assert.deepEqual(euclid(4, 16).map((x) => (x ? 'x' : '.')).join(''), 'x...x...x...x...');
  assert.equal(euclid(5, 8).filter(Boolean).length, 5);
  assert.equal(euclid(3, 8).map((x) => (x ? 'x' : '.')).join(''), 'x..x..x.');
  assert.equal(euclid(0, 4).filter(Boolean).length, 0);
});

test('generation is deterministic per seed and differs across seeds', () => {
  const a = generateSong(style, { seed: 7, minutes: 2 });
  const b = generateSong(style, { seed: 7, minutes: 2 });
  const c = generateSong(style, { seed: 8, minutes: 2 });
  delete a.meta.created; delete b.meta.created; delete c.meta.created;
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.composition, c.composition);
});

test('generated songs validate, are the requested length, and have an arc', () => {
  for (const seed of [1, 2, 3, 11, 99]) {
    const song = generateSong(style, { seed, minutes: 5 });
    const r = validate(song);
    assert.ok(r.ok, `seed ${seed}: ${r.errors.join('; ')}`);
    const stats = songStats(song);
    assert.ok(stats.seconds > 4 * 60 && stats.seconds < 6.5 * 60, `seed ${seed}: ${stats.seconds}s`);
    const kinds = song.composition.song.sections.map((s) => s.name);
    assert.equal(kinds[0], 'intro');
    assert.equal(kinds[kinds.length - 1], 'outro');
    assert.ok(kinds.includes('drop'), `seed ${seed}: no drop in ${kinds}`);
    const energies = song.composition.song.sections.map((s) => s.energy);
    assert.ok(Math.max(...energies) >= 0.85 && Math.min(...energies) <= 0.3, `seed ${seed}: energy range ${energies}`);
    // Within M8 limits for a five-minute song.
    assert.ok(Object.keys(song.composition.phrases).length <= 255, `seed ${seed}: too many phrases`);
    assert.ok(Object.keys(song.composition.chains).length <= 255, `seed ${seed}: too many chains`);
  }
});

test('the kick plays four to the floor in every section where it is present', () => {
  const song = generateSong(style, { seed: 5, minutes: 4 });
  const r = resolve(song);
  const kickTrack = song.composition.tracks.findIndex((t) => t.id === 'kick');
  for (const row of r.rows) {
    const rowObj = song.composition.song.rows[row.row];
    if (!rowObj.kick) continue;
    const kicks = r.events.filter((e) => e.track === kickTrack && e.note !== null && e.note !== 'OFF' && e.step >= row.step && e.step < row.step + row.steps);
    // Allow a dropped last bar (the fill), otherwise one kick every four steps.
    assert.ok(kicks.length >= (row.steps / 4) - 4, `row ${row.row}: ${kicks.length} kicks in ${row.steps} steps`);
    for (const k of kicks) assert.equal((k.step - row.step) % 4, 0, `off-grid kick at ${k.step}`);
  }
});

test('breakdowns drop the kick and keep something', () => {
  for (const seed of [1, 2, 3, 4]) {
    const song = generateSong(style, { seed, minutes: 6 });
    const rows = song.composition.song.rows;
    song.composition.song.sections.forEach((sec, i) => {
      if (sec.name !== 'breakdown') return;
      assert.ok(!rows[i].kick, `seed ${seed}: kick in breakdown row ${i}`);
      assert.ok(Object.keys(rows[i]).length >= 1);
      const chain = song.composition.chains[Object.values(rows[i])[0]];
      const steps = chain.rows.flatMap((r) => song.composition.phrases[r.phrase].steps);
      assert.ok(steps.some((s) => s && s.note !== undefined && s.note !== 'OFF'), `seed ${seed}: silent breakdown`);
    });
  }
});

test('section planner covers the bar budget and starts low', () => {
  const rnd = new Random(3); rnd.bpm = 128;
  const secs = planSections(style, rnd, 6);
  const bars = secs.reduce((s, x) => s + x.bars, 0);
  assert.ok(Math.abs(bars - 192) < 24, `bars ${bars}`);
  assert.ok(secs[0].energy < 0.35);
  const present = chooseLayers(style, secs, rnd);
  assert.equal(present.length, secs.length);
});

test('mutations keep the step count and change something', () => {
  const rnd = new Random(1);
  const ctx = { intervals: [0, 2, 3, 5, 7, 8, 10] };
  const steps = Array(16).fill(null); [0, 4, 8, 12].forEach((i) => { steps[i] = { note: 'C2' }; });
  for (const op of Object.keys(OPS)) {
    const out = OPS[op](steps, rnd, ctx);
    assert.equal(out.length, 16, op);
  }
  const m = mutate(steps, rnd, ctx, { ops: ['rotate'], strength: 0 });
  assert.notDeepEqual(m, steps);
});
