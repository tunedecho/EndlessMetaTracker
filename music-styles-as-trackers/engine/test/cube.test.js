import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from '@tracker/format';
import { cubeModel, SOURCE } from '../web/cube-data.js';

const defs = JSON.parse(readFileSync(new URL('../../format/schema/song.json', import.meta.url), 'utf8')).$defs;
const song = JSON.parse(readFileSync(new URL('../../format/examples/minimal-techno-loop.json', import.meta.url), 'utf8'));

test('cube: one cell per written step, with the note and the instrument behind it', () => {
  const m = cubeModel(song, defs);
  const written = resolve(song).events.filter((e) => e.phrase !== null);
  assert.equal(m.cells.length, written.length);
  const lane = (key) => m.lanes.findIndex((l) => l.key === key);
  const kickTrack = m.tracks.findIndex((t) => t.id === 'kick');
  const kick = m.cells.find((c) => c.track === kickTrack && c.kind === 'note');
  const inst = song.sound.instruments[kick.inst];
  assert.equal(inst.engine, 'kick');
  assert.equal(kick.raw[lane('kick:params.pitchStart')], inst.params.pitchStart);
  assert.ok(Number.isNaN(kick.value[lane('analog:params.wave')]), 'other engines\' parameters do not apply');
  for (const v of m.cells.flatMap((c) => [...c.value])) assert.ok(Number.isNaN(v) || (v >= 0 && v <= 1));
});

test('cube: a track command overrides the instrument from its step on', () => {
  const m = cubeModel(song, defs);
  const cutoff = m.lanes.findIndex((l) => l.key === 'filter.cutoff');
  const first = m.cells.findIndex((c) => c.source[cutoff] === SOURCE.command);
  assert.ok(first >= 0, 'the example sets cutoff with a command');
  const c = m.cells[first];
  const ev = resolve(song).events.find((e) => e.track === c.track && e.step === c.step && e.fx.cutoff !== undefined);
  assert.equal(c.raw[cutoff], ev.fx.cutoff);
  const later = m.cells.slice(first + 1).find((x) => x.track === c.track && x.kind === 'note');
  if (later) assert.equal(later.source[cutoff], SOURCE.command, 'it persists on the track');
});

test('cube: a row range keeps state from earlier rows and counts steps from the range start', () => {
  const all = cubeModel(song, defs);
  const part = cubeModel(song, defs, { from: 2, to: 3 });
  assert.equal(part.steps, part.rows[0].steps);
  assert.ok(part.cells.every((c) => c.row === 2 && c.step >= 0 && c.step < part.steps));
  const same = all.cells.find((c) => c.row === 2 && c.kind === 'note');
  const mine = part.cells.find((c) => c.track === same.track && c.rowStep === same.rowStep);
  assert.deepEqual([...mine.raw.keys()].map((i) => mine.raw[i]), [...same.raw.keys()].map((i) => same.raw[i]));
});

test('cube: a parameter lock shows on its note only, over a track command', () => {
  const s = JSON.parse(JSON.stringify(song));
  const m0 = cubeModel(s, defs);
  const cutoff = m0.lanes.findIndex((l) => l.key === 'filter.cutoff');
  const c = m0.cells.find((x) => x.kind === 'note' && x.source[cutoff] === SOURCE.command);
  s.composition.phrases[c.phrase].steps[c.phraseStep].lock = { 'filter.cutoff': 0.11 };
  const m = cubeModel(s, defs);
  const same = m.cells.filter((x) => x.phrase === c.phrase && x.phraseStep === c.phraseStep && x.kind === 'note');
  for (const x of same) { assert.equal(x.source[cutoff], SOURCE.lock); assert.equal(x.raw[cutoff], 0.11); }
  const next = m.cells.find((x) => x.track === c.track && x.step > c.step && x.kind === 'note' && !(x.phrase === c.phrase && x.phraseStep === c.phraseStep));
  assert.notEqual(next.source[cutoff], SOURCE.lock);
});
