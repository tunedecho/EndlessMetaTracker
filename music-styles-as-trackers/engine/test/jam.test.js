import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, validate } from '@tracker/format';
import { addLayer, reseed, saveSet, newSet, deleteSet, removeFromSet, jamOf, rowBars, nameOf, groupOf } from '../web/jam.js';

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const techno = load('../../styles/hypnotic-techno.json');
const hello = () => load('../../format/examples/hello-tracker.json');
const notesOn = (song, trackId, row) => resolve(song).events.filter((e) => e.trackId === trackId && e.row === row && typeof e.note === 'number').map((e) => `${e.step}:${e.note}`).join(' ');

test('jam: add tracks from style layers to a set, in the jam key, and the song stays valid', () => {
  const s = hello();
  assert.equal(jamOf(s).root, 'C', 'the key starts from the first note');
  const [kick] = addLayer(s, 0, techno, 'kick', { seed: 3 });
  const pads = addLayer(s, 0, techno, 'pad', { seed: 3 });
  assert.equal(kick, 'kick');
  assert.equal(pads.length, 3, 'a three-voice pad is three tracks');
  assert.deepEqual(validate(s).errors, []);
  assert.ok(notesOn(s, 'kick', 0).length > 0);
  assert.equal(s.sound.instruments.kick.engine, 'kick');
  assert.deepEqual(groupOf(s, 0, pads[1]), pads);
  assert.equal(s.meta.jam.recipes.kick.layer, 'kick');
  // The set keeps its length: hello tracker is one bar.
  assert.equal(rowBars(s, 0), 1);
});

test('jam: reseeding gives new notes, keeps the sound, and repeats for the same seed', () => {
  const s = hello();
  const before = notesOn(s, 'bass', 0);
  reseed(s, 0, 'bass', techno, 'bass', 11);
  const a = notesOn(s, 'bass', 0);
  assert.notEqual(a, before);
  assert.equal(s.composition.tracks.find((t) => t.id === 'bass').instrument, 'bass', 'hello tracker keeps its own saw bass');
  reseed(s, 0, 'bass', techno, 'bass', 12);
  reseed(s, 0, 'bass', techno, 'bass', 11);
  assert.equal(notesOn(s, 'bass', 0), a);
  assert.deepEqual(validate(s).errors, []);
  // Old takes do not pile up.
  assert.ok(Object.keys(s.composition.phrases).length <= 2);
});

test('jam: a saved set stays as it was while the jam goes on in the copy', () => {
  const s = hello();
  addLayer(s, 0, techno, 'hats', { seed: 2 });
  const next = saveSet(s, 0, 'intro');
  assert.equal(next, 1);
  assert.equal(nameOf(s, 0), 'intro');
  const saved = notesOn(s, 'bass', 0) + '|' + notesOn(s, 'hats', 0);
  reseed(s, 1, 'bass', techno, 'bass', 99);
  addLayer(s, 1, techno, 'clap', { seed: 2 });
  removeFromSet(s, 1, 'hats');
  assert.equal(notesOn(s, 'bass', 0) + '|' + notesOn(s, 'hats', 0), saved);
  assert.equal(notesOn(s, 'hats', 1), '');
  assert.deepEqual(validate(s).errors, []);
});

test('jam: empty sets, deleting sets, and the track limit', () => {
  const s = hello();
  const e = newSet(s, 0);
  assert.equal(rowBars(s, e), 0);
  addLayer(s, e, techno, 'acid', { seed: 1, bars: 2 });
  assert.equal(rowBars(s, e), 2);
  assert.deepEqual(validate(s).errors, []);
  const n = s.composition.song.rows.length;
  deleteSet(s, 0);
  assert.equal(s.composition.song.rows.length, n - 1);
  assert.equal(nameOf(s, 0), 'set 1', 'section names move with their rows');
  while (s.composition.song.rows.length > 1) deleteSet(s, 1);
  assert.throws(() => deleteSet(s, 0), /at least one/);
  assert.equal(rowBars(s, 0), 2, 'the acid set is what is left');
  for (let i = 0; i < 12; i++) addLayer(s, 0, techno, 'perc', { seed: i });
  assert.throws(() => addLayer(s, 0, techno, 'pad', { seed: 1 }), /16 tracks/);
});
