import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { songToM8, readM8, OFS, N, TEMPLATE, SEQ, INS, KIND, MIDI_OFFSET, instrumentToM8, fxToM8, m8Name, envByte } from '../lib/m8s.js';

const example = (f) => JSON.parse(readFileSync(new URL(`../../format/examples/${f}`, import.meta.url), 'utf8'));

test('the template is an empty 6.6.2 song with the expected layout', () => {
  const t = readM8(readFileSync(TEMPLATE));
  assert.equal(t.version, '6.6.2');
  assert.equal(t.tempo, 120);
  assert.equal(t.song.length, 0);
  assert.equal(t.phrases.length, 0);
  assert.equal(t.chains.length, 0);
  assert.equal(t.instruments.length, 0);
  // Region sizes chain up to the documented offsets.
  assert.equal(OFS.song + N.rows * N.tracks, OFS.phrases);
  assert.equal(OFS.phrases + N.phrases * 16 * 9, OFS.chains);
  assert.equal(OFS.chains + N.chains * 32, OFS.tables);
  assert.equal(OFS.tables + N.tables * 16 * 8, OFS.instruments);
});

test('writer only touches the documented regions', () => {
  const template = readFileSync(TEMPLATE);
  const { bytes } = songToM8(example('minimal-techno-loop.json'));
  assert.equal(bytes.length, template.length);
  const allowed = [[OFS.transpose, OFS.name + 12], [OFS.song, OFS.instruments + N.instruments * 215]];
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === template[i]) continue;
    assert.ok(allowed.some(([a, b]) => i >= a && i < b), `byte 0x${i.toString(16)} changed outside the written regions`);
  }
});

test('header: name and tempo', () => {
  const song = example('minimal-techno-loop.json');
  const r = readM8(songToM8(song).bytes);
  assert.equal(r.name, 'MINIMAL TECH');
  assert.equal(Math.round(r.tempo * 100) / 100, 128);
  assert.equal(m8Name('hello, tracker!'), 'HELLO TRACKE');
});

test('song rows, chain expansion and silent fill keep tracks in step', () => {
  const song = example('minimal-techno-loop.json');
  const { bytes, report } = songToM8(song);
  const r = readM8(bytes);
  // Six format rows, none longer than 16 phrases, so six M8 rows.
  assert.equal(r.song.length, 6);
  assert.equal(report.songRows, 6);
  for (const row of r.song) {
    // Every used track has a chain, and all chains in a row have the same length.
    const lens = row.chains.slice(0, song.composition.tracks.length).map((c) => r.chains.find((x) => x.index === c).rows.length);
    assert.ok(lens.every((l) => l === lens[0]), `row ${row.row} lengths ${lens}`);
    assert.ok(row.chains.slice(song.composition.tracks.length).every((c) => c === null));
  }
  // Row 0: kick chain is 1 phrase, hats 1 phrase: 1-phrase chains. Row 2: bass has 4 phrases: 4-phrase chains.
  assert.equal(r.chains.find((x) => x.index === r.song[0].chains[0]).rows.length, 1);
  assert.equal(r.chains.find((x) => x.index === r.song[2].chains[0]).rows.length, 4);
  // Chain transpose of -2 on the stab's third phrase survives as a signed byte.
  const stabChain = r.chains.find((x) => x.index === r.song[2].chains[4]);
  assert.deepEqual(stabChain.rows.map((x) => x.transpose), [0, 0, -2, 3]);
});

test('a long format row splits into several equal M8 rows', () => {
  const steps = Array.from({ length: 16 }, () => null); steps[0] = { note: 'C4' };
  const song = {
    format: 'tracker-song/0.1', transport: { bpm: 120 },
    sound: { instruments: { x: { engine: 'analog' }, k: { engine: 'kick' } } },
    composition: {
      tracks: [{ id: 'a', instrument: 'x' }, { id: 'b', instrument: 'k' }],
      phrases: { p: { steps } },
      chains: { long: { rows: Array.from({ length: 20 }, (_, i) => ({ phrase: 'p', transpose: i })) }, short: { rows: [{ phrase: 'p' }] } },
      song: { rows: [{ a: 'long', b: 'short' }] },
    },
  };
  const r = readM8(songToM8(song).bytes);
  assert.equal(r.song.length, 2);
  const c0 = r.chains.find((x) => x.index === r.song[0].chains[0]);
  const c1 = r.chains.find((x) => x.index === r.song[1].chains[0]);
  assert.equal(c0.rows.length, 16); assert.equal(c1.rows.length, 4);
  assert.equal(c1.rows[3].transpose, 19);
  const b1 = r.chains.find((x) => x.index === r.song[1].chains[1]);
  assert.equal(b1.rows.length, 4);
});

test('phrase steps: note offset, OFF, velocity, instrument, commands', () => {
  const song = example('minimal-techno-loop.json');
  const { bytes } = songToM8(song);
  const r = readM8(bytes);
  // The stabSweep phrase: A3 (57) with cutoff command, then command-only steps, then OFF at 15.
  const sweep = r.phrases.find((p) => p.steps[15]?.note === 'OFF' && p.steps[0]?.fx.some(([c]) => c === INS.CUT));
  assert.ok(sweep, 'stabSweep phrase found');
  assert.equal(sweep.steps[0].note, 57 - MIDI_OFFSET);
  assert.equal(sweep.steps[0].inst, 5);
  assert.deepEqual(sweep.steps[0].fx, [[INS.CUT, Math.round(0.25 * 255)]]);
  assert.equal(sweep.steps[4].note, null);
  assert.deepEqual(sweep.steps[4].fx, [[INS.CUT, Math.round(0.4 * 255)]]);
  // The bass is shifted up an octave because A1 is below the M8 floor, and the instrument pitch is -12.
  const bass = r.instruments.find((i) => i.name === 'BASS');
  assert.equal(bass.pitch, -12);
  const bassPhrase = r.phrases.find((p) => p.steps[2]?.inst === bass.index);
  assert.equal(bassPhrase.steps[2].note, 33 + 12 - MIDI_OFFSET);
  // Velocity 0.7 becomes a byte; velocity 1 stays empty (instrument default).
  const kick = r.phrases.find((p) => p.steps[0]?.inst === 0 && p.steps[4]?.inst === 0);
  assert.equal(kick.steps[0].vel, null);
  assert.equal(bassPhrase.steps[7].vel, Math.round(0.7 * 0xfe));
});

test('fx mapping', () => {
  const w = [];
  const fx = fxToM8({ cutoff: 0.5, retrig: 2, nudge: 0.5, pitch: 3 }, { tableIndex: () => 0x80, warnings: w, where: 'x' });
  assert.deepEqual(fx, [[INS.CUT, 128], [SEQ.RET, 3], [SEQ.DEL, 3]]);
  assert.ok(w.some((m) => m.includes('pitch')));
  const many = fxToM8({ cutoff: 1, resonance: 1, volume: 1, pan: 0 }, { tableIndex: () => 0, warnings: w, where: 'y' });
  assert.equal(many.length, 3);
  assert.ok(w.some((m) => m.includes('the M8 keeps 3')));
});

test('instruments: kinds, filter, mix, envelopes, tables', () => {
  const song = example('minimal-techno-loop.json');
  const r = readM8(songToM8(song).bytes);
  const byName = Object.fromEntries(r.instruments.map((i) => [i.name, i]));
  assert.equal(byName.KICK.kind, KIND.MACROSYNTH);
  assert.equal(byName.BASS.kind, KIND.WAVSYNTH);
  assert.equal(byName.BASS.filterType, 1);
  assert.equal(byName.BASS.cutoff, Math.round(0.3 * 255));
  assert.equal(byName.BASS.transposeOn, true);
  assert.equal(byName.KICK.transposeOn, false);
  assert.equal(byName.STAB.delay, Math.round(0.4 * 255));
  // Amp envelope is an ADSR on VOLUME; filter envelope an ADSR on CUTOFF.
  assert.equal(byName.BASS.mods[0].type, 1); assert.equal(byName.BASS.mods[0].dest, 1);
  assert.equal(byName.BASS.mods[1].type, 1); assert.equal(byName.BASS.mods[1].dest, 7);
  assert.equal(byName.BASS.mods[0].sustain, Math.round(0.3 * 255));
  // The stab's instrument table lands at the instrument's own index, with transposes and a tiled loop.
  const stabTable = r.tables.find((t) => t.index === byName.STAB.index);
  assert.ok(stabTable);
  assert.deepEqual(stabTable.rows.slice(0, 8).map((x) => x.transpose), [0, 3, 7, 10, 0, 3, 7, 10]);
  assert.equal(byName.STAB.tableTick, 1);
  // Ambient example: FM bell and a non-looping table held with HOP.
  const amb = readM8(songToM8(example('ambient-drift.json')).bytes);
  const bell = amb.instruments.find((i) => i.name === 'BELL');
  assert.equal(bell.kind, KIND.FMSYNTH);
  assert.equal(bell.engine[0], 7);
  assert.deepEqual(bell.engine.slice(5, 7), [3, 50]); // ratio 3.50
  const arp = amb.tables.find((t) => t.index === bell.index);
  assert.deepEqual(arp.rows.slice(0, 4).map((x) => x.transpose), [0, 7, 12, 19]);
  assert.deepEqual(arp.rows[3].fx, [[SEQ.HOP, 3]]);
  assert.equal(bell.tableTick, 6);
});

test('every example converts, and an unmappable song is refused', () => {
  for (const f of ['hello-tracker.json', 'minimal-techno-loop.json', 'ambient-drift.json']) {
    const { bytes } = songToM8(example(f));
    assert.equal(readM8(bytes).version, '6.6.2');
  }
  const big = example('hello-tracker.json');
  big.composition.tracks = Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, instrument: 'bass' }));
  assert.throws(() => songToM8(big), /8 tracks/);
  assert.equal(envByte(0), 0);
  assert.equal(envByte(4), 255);
  const w = [];
  instrumentToM8('n', { engine: 'noise', params: { color: 'pink' } }, { warnings: w });
  assert.equal(w.length, 0);
});
