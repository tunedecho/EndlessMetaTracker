import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { toMidi, toName, toFreq, degreeToMidi, MODES, Random, resolve, songSteps, validate, timelineSeconds, checkSongReferences, stepSource, phrasePlays, getStep, setStep, makeUnique } from '../lib/index.js';

const here = new URL('.', import.meta.url).pathname;
const load = (f) => JSON.parse(readFileSync(new URL(`../examples/${f}`, import.meta.url), 'utf8'));

test('note names round-trip', () => {
  assert.equal(toMidi('C4'), 60);
  assert.equal(toMidi('A4'), 69);
  assert.equal(toMidi('F#3'), 54);
  assert.equal(toMidi('Bb2'), 46);
  assert.equal(toMidi('C-1'), 0);
  assert.equal(toMidi(72), 72);
  assert.equal(toMidi('OFF'), 'OFF');
  assert.equal(toName(61), 'C#4');
  assert.equal(toName(toMidi('G2')), 'G2');
  assert.ok(Math.abs(toFreq(69) - 440) < 1e-9);
  assert.ok(Math.abs(toFreq(57) - 220) < 1e-9);
});

test('scale degrees wrap by octave', () => {
  assert.equal(degreeToMidi(0, 'A', MODES.minor, 2), toMidi('A2'));
  assert.equal(degreeToMidi(2, 'A', MODES.minor, 2), toMidi('C3'));
  assert.equal(degreeToMidi(7, 'A', MODES.minor, 2), toMidi('A3'));
  assert.equal(degreeToMidi(-1, 'A', MODES.minor, 2), toMidi('G2'));
});

test('seeded random is deterministic and well spread', () => {
  const a = new Random(42), b = new Random(42), c = new Random(43);
  const sa = Array.from({ length: 5 }, () => a.next());
  const sb = Array.from({ length: 5 }, () => b.next());
  const sc = Array.from({ length: 5 }, () => c.next());
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  const r = new Random(7);
  const counts = [0, 0, 0, 0];
  for (let i = 0; i < 4000; i++) counts[r.int(0, 3)]++;
  for (const n of counts) assert.ok(n > 850 && n < 1150, `bucket ${n}`);
  assert.equal(r.range(5), 5);
  const v = r.range([2, 4], true);
  assert.ok(Number.isInteger(v) && v >= 2 && v <= 4);
});

test('every example validates', () => {
  for (const f of readdirSync(new URL('../examples/', import.meta.url))) {
    if (!f.endsWith('.json')) continue;
    const r = validate(load(f));
    assert.ok(r.ok, `${f}: ${r.errors.join('; ')}`);
  }
});

test('validator rejects broken references and bad shapes', () => {
  const song = load('hello-tracker.json');
  song.composition.chains.c0.rows[0].phrase = 'nope';
  assert.ok(checkSongReferences(song).some((p) => p.includes('unknown phrase')));
  const bad = load('hello-tracker.json');
  bad.sound.instruments.bass.params.wave = 'sawtoothy';
  const r = validate(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('wave')));
  const wrongLen = load('hello-tracker.json');
  wrongLen.composition.phrases.p0.steps.push(null);
  assert.ok(checkSongReferences(wrongLen).some((p) => p.includes('phraseLength')));
});

test('resolve flattens rows, repeats short chains, and applies transposes', () => {
  const song = load('minimal-techno-loop.json');
  const r = resolve(song);
  assert.equal(r.totalSteps, songSteps(song));
  assert.equal(r.rows.length, 6);
  // Row 0: kick chain is 1 phrase, hats chain is 1 phrase: 16 steps.
  assert.equal(r.rows[0].steps, 16);
  // Row 2: bass chain has 4 phrases, so the row is 64 steps and the kick repeats 4 times = 16 kicks.
  assert.equal(r.rows[2].steps, 64);
  const kicksRow2 = r.events.filter((e) => e.row === 2 && e.trackId === 'kick' && e.note !== null);
  assert.equal(kicksRow2.length, 16);
  // Stab chain row 3 is transposed -2: A3 (57) becomes 55.
  const stabs = r.events.filter((e) => e.row === 2 && e.trackId === 'stab' && e.note !== null && e.note !== 'OFF');
  const thirdPhrase = stabs.filter((e) => e.step >= r.rows[2].step + 32 && e.step < r.rows[2].step + 48);
  assert.deepEqual(thirdPhrase.map((e) => e.note), [55, 55]);
  // Events are sorted by step.
  for (let i = 1; i < r.events.length; i++) assert.ok(r.events[i].step >= r.events[i - 1].step);
  // Step with a different instrument keeps it.
  const ohat = r.events.find((e) => e.inst === 'ohat');
  assert.ok(ohat);
  assert.ok(Math.abs(timelineSeconds(r) - 288 * 60 / 128 / 4) < 1e-9);
});

test('resolve honours maxSteps and loops', () => {
  const song = load('hello-tracker.json');
  assert.equal(resolve(song, { maxSteps: 20 }).totalSteps, 20);
  song.transport.loop = 0;
  const looped = resolve(song, { loops: 2 });
  assert.equal(looped.totalSteps, 32 * 3);
});

test('stepSource finds the phrase step behind every resolved note', () => {
  const songs = ['hello-tracker.json', 'minimal-techno-loop.json', 'ambient-drift.json'].map(load);
  songs.push(JSON.parse(readFileSync(new URL('../../endless-techno/previews/hypnotic-techno-3.json', import.meta.url), 'utf8')));
  for (const song of songs) {
    const r = resolve(song);
    let checked = 0;
    for (const e of r.events) {
      if (e.phrase === null) continue;
      const src = stepSource(song, e.row, e.trackId, e.step - r.rows[e.row].step);
      assert.equal(src.phrase, e.phrase);
      assert.equal(src.phraseStep, e.phraseStep);
      const cell = getStep(song, src.phrase, src.phraseStep);
      if (typeof e.note === 'number') assert.equal(toMidi(cell.note) + src.transpose, e.note);
      checked++;
    }
    assert.ok(checked > 0);
  }
});

test('editing a shared phrase changes every place it plays; makeUnique keeps the edit in one row', () => {
  const song = load('minimal-techno-loop.json');
  const { rows } = song.composition.song;
  const ri = rows.findIndex((row) => row.kick);
  const first = stepSource(song, ri, 'kick', 0);
  const plays = phrasePlays(song, first.phrase);
  assert.ok(plays > 1, 'the kick phrase is shared');
  const before = resolve(song).events.filter((e) => e.trackId === 'kick' && typeof e.note === 'number').length;

  const prev = setStep(song, first.phrase, first.phraseStep, null);
  const after = resolve(song).events.filter((e) => e.trackId === 'kick' && typeof e.note === 'number').length;
  assert.equal(before - after, plays, 'one note fewer per play of the phrase');
  setStep(song, first.phrase, first.phraseStep, prev);
  assert.ok(song.composition.phrases[first.phrase].steps.length >= 1);

  const ids = makeUnique(song, ri, 'kick', first.chainRow);
  assert.equal(stepSource(song, ri, 'kick', 0).phrase, ids.phrase);
  assert.equal(phrasePlays(song, ids.phrase), phrasePlays(song, ids.phrase, ri), 'the copy plays only in this row');
  assert.equal(phrasePlays(song, first.phrase), plays - phrasePlays(song, ids.phrase));
  setStep(song, ids.phrase, first.phraseStep, null);
  const local = resolve(song).events.filter((e) => e.trackId === 'kick' && typeof e.note === 'number').length;
  assert.equal(before - local, phrasePlays(song, ids.phrase), 'only the copy lost its note');
  assert.deepEqual(validate(song).errors, []);
});

test('parameter locks: valid ones pass, and each lock is checked against the instrument that plays it', () => {
  const song = load('minimal-techno-loop.json');
  const bass = Object.keys(song.composition.phrases).find((k) => k.startsWith('bass'));
  const steps = song.composition.phrases[bass].steps;
  const i = steps.findIndex((s) => s && s.note);
  steps[i].lock = { 'filter.cutoff': 0.6, 'amp.decay': 0.4, 'params.unison': 3 };
  assert.deepEqual(validate(song).errors, []);
  assert.equal(resolve(song).events.find((e) => e.phrase === bass && e.phraseStep === i).lock['amp.decay'], 0.4);
  steps[i].lock = { 'filter.cutoff': 3 };
  assert.match(validate(song).errors.join('\n'), /lock on \w+: \/filter\/cutoff must be <= 1/);
  steps[i].lock = { 'params.pitchStart': 100 };
  assert.match(validate(song).errors.join('\n'), /additional properties: pitchStart/, 'a kick parameter on an analog instrument');
  steps[i].lock = { engine: 'fm' };
  assert.ok(validate(song).errors.length, 'the engine cannot be locked');
});
