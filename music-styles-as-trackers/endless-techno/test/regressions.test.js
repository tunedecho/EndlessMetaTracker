/** Regression tests for generator defects found by an independent review. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateSong, makeGenerator, planSections } from '../lib/index.js';
import { Random } from '@tracker/format';

const load = (f) => JSON.parse(readFileSync(new URL(`../../styles/${f}`, import.meta.url), 'utf8'));
const ctx = { root: 'A', intervals: [0, 2, 3, 5, 7, 8, 10], phraseLength: 16, stepsPerBeat: 4 };

test('generators report their true period so polymeter runs across bars', () => {
  const e = makeGenerator({ type: 'euclid', hits: 5, length: 12, note: 'C3' }, new Random(1), ctx);
  assert.equal(e.period, 3);
  assert.notDeepEqual(e(0), e(1));
  const p = makeGenerator({ type: 'pattern', patterns: ['x..x..'] }, new Random(1), ctx);
  assert.equal(p.period, 3);
  const c = makeGenerator({ type: 'chords', progression: [[0], [3]], barsPerChord: 2 }, new Random(1), ctx);
  assert.equal(c.period, 4);
});

test('automation reaches its final value on the last bar', () => {
  const style = load('hypnotic-techno.json');
  for (const seed of [3, 4, 5]) {
    const song = generateSong(style, { seed, minutes: 6 });
    const riserRows = song.composition.song.rows.map((r, i) => [r, i]).filter(([r]) => r.riser);
    assert.ok(riserRows.length > 0, `seed ${seed}: no riser rows`);
    for (const [r] of riserRows) {
      const chain = song.composition.chains[r.riser];
      const last = song.composition.phrases[chain.rows[chain.rows.length - 1].phrase].steps[0];
      assert.equal(last?.fx?.cutoff, 0.85, `seed ${seed}: last riser cutoff ${last?.fx?.cutoff}`);
    }
  }
});

test('layers sharing a track keep both notes and commands, and automation resets afterwards', () => {
  const style = load('hypnotic-techno-m8.json');
  const song = generateSong(style, { seed: 1, minutes: 6 });
  const { rows, sections } = song.composition.song;
  let sawRiser = false, sawReset = false;
  rows.forEach((row, i) => {
    if (!row.ride) return;
    const chain = song.composition.chains[row.ride];
    const steps = chain.rows.flatMap((cr) => song.composition.phrases[cr.phrase].steps);
    const riserNotes = steps.filter((s) => s && s.inst === 'riser' || (s && s.note && song.composition.tracks.find((t) => t.id === 'ride').instrument === 'riser' && !s.inst)).length;
    const cutoffs = steps.filter((s) => s?.fx?.cutoff !== undefined).map((s) => s.fx.cutoff);
    if (sections[i].name === 'build') { assert.ok(riserNotes >= 1, `row ${i}: riser lost in merge`); assert.ok(cutoffs.length >= 2, `row ${i}: automation lost`); sawRiser = true; }
    else if (cutoffs.length) { assert.ok(cutoffs.every((c) => c === 1), `row ${i}: stale automation ${cutoffs}`); sawReset = true; }
  });
  assert.ok(sawRiser && sawReset);
});

test('the planner needs no monkey-patched tempo and never plans a zero-bar section', () => {
  const style = load('hypnotic-techno.json');
  const secs = planSections(style, new Random(2), 6, 128);
  assert.ok(secs.every((s) => s.bars >= 4), secs.map((s) => s.bars).join(','));
  assert.throws(() => planSections(style, new Random(2), 6));
});
