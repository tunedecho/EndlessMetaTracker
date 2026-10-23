import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeMidi, parseMidi, songToMidiEvents, PPQ } from '../lib/midi.js';

const example = (f) => JSON.parse(readFileSync(new URL(`../../format/examples/${f}`, import.meta.url), 'utf8'));
const rest = (n) => Array.from({ length: n }, () => null);
function mini({ bpm = 120, swing = 0, steps, inst = { engine: 'analog', params: { wave: 'saw' } } }) {
  return {
    format: 'tracker-song/0.1', transport: { bpm, swing },
    sound: { instruments: { x: inst } },
    composition: { tracks: [{ id: 't', instrument: 'x' }], phrases: { p: { steps } }, chains: { c: { rows: [{ phrase: 'p' }] } }, song: { rows: [{ t: 'c' }] } },
  };
}

test('header, ppq and track count', () => {
  const song = example('minimal-techno-loop.json');
  const m = parseMidi(encodeMidi(song));
  assert.equal(m.format, 1);
  assert.equal(m.ppq, PPQ);
  assert.equal(m.tracks.length, song.composition.tracks.length + 1);
  assert.equal(m.tracks[0].find((e) => e.type === 'tempo').bpm, 128);
  assert.equal(m.tracks[1].find((e) => e.type === 'trackName').text, 'kick');
});

test('one step is PPQ / stepsPerBeat ticks, swing delays odd steps', () => {
  const steps = rest(16); steps[0] = { note: 'C3' }; steps[1] = { note: 'D3' }; steps[4] = { note: 'E3' };
  const m = songToMidiEvents(mini({ steps }));
  const ons = m.tracks[0].filter((e) => e.type === 'on');
  assert.deepEqual(ons.map((e) => e.tick), [0, 120, 480]);
  const swung = songToMidiEvents(mini({ steps, swing: 0.25 }));
  assert.deepEqual(swung.tracks[0].filter((e) => e.type === 'on').map((e) => e.tick), [0, 150, 480]);
});

test('drums go to channel 10 with GM notes, melodic tracks take channels 1 and 2', () => {
  const song = example('minimal-techno-loop.json');
  const m = songToMidiEvents(song);
  assert.deepEqual(m.channelOf, [9, 9, 9, 0, 1]);
  const kick = m.tracks[0].find((e) => e.type === 'on');
  assert.equal(kick.note, 36);
  const hats = m.tracks[2].filter((e) => e.type === 'on').map((e) => e.note);
  assert.ok(hats.includes(42) && hats.includes(46));
  const noGm = songToMidiEvents(song, { gmDrums: false });
  assert.deepEqual(noGm.channelOf, [0, 1, 2, 3, 4]);
});

test('notes end at the next note, at OFF, at cut, and drums after one step', () => {
  const steps = rest(16); steps[0] = { note: 'C3' }; steps[4] = { note: 'OFF' }; steps[8] = { note: 'D3', fx: { cut: 0.5 } }; steps[12] = { note: 'E3' }; steps[13] = { note: 'F3' };
  const t = songToMidiEvents(mini({ steps })).tracks[0];
  const offs = t.filter((e) => e.type === 'off').map((e) => [e.note, e.tick]);
  assert.deepEqual(offs, [[48, 480], [50, 1020], [52, 1560], [53, 1920]]);
  const drum = rest(16); drum[0] = { note: 'C3' };
  const d = songToMidiEvents(mini({ steps: drum, inst: { engine: 'kick' } })).tracks[0];
  assert.equal(d.find((e) => e.type === 'off').tick, 120);
});

test('retrig and nudge', () => {
  const steps = rest(16); steps[0] = { note: 'C3', fx: { retrig: 4 } }; steps[8] = { note: 'C3', fx: { nudge: 0.5 } };
  const t = songToMidiEvents(mini({ steps })).tracks[0];
  assert.deepEqual(t.filter((e) => e.type === 'on').map((e) => e.tick), [0, 30, 60, 90, 1020]);
});

test('track commands become CCs and tempo commands become tempo events', () => {
  const steps = rest(16); steps[0] = { note: 'C3', fx: { cutoff: 0.5, pan: 1, tempo: 90 } };
  const m = songToMidiEvents(mini({ steps }));
  const ccs = m.tracks[0].filter((e) => e.type === 'cc').map((e) => [e.cc, e.value]);
  assert.deepEqual(ccs, [[74, 64], [10, 127]]);
  assert.deepEqual(m.tempoTrack.filter((e) => e.type === 'tempo').map((e) => e.bpm), [120, 90]);
});

test('round trip through the parser keeps every note', () => {
  for (const f of ['hello-tracker.json', 'minimal-techno-loop.json', 'ambient-drift.json']) {
    const song = example(f);
    const m = songToMidiEvents(song);
    const parsed = parseMidi(encodeMidi(song));
    m.tracks.forEach((t, i) => {
      const want = t.filter((e) => e.type === 'on').map((e) => `${e.tick}:${e.channel}:${e.note}:${e.velocity}`);
      const got = parsed.tracks[i + 1].filter((e) => e.type === 'on').map((e) => `${e.tick}:${e.channel}:${e.note}:${e.velocity}`);
      assert.deepEqual(got, want, `${f} track ${i}`);
    });
    assert.ok(parsed.tracks.every((t) => t[t.length - 1].type === 'end'));
  }
});

test('a chord step writes every note, and all of them end at the next note', () => {
  const steps = rest(16);
  steps[0] = { note: ['A3', 'C4', 'E4'] };
  steps[4] = { note: 'G3' };
  const t = songToMidiEvents(mini({ steps })).tracks[0];
  const on = (tick) => t.filter((e) => e.type === 'on' && e.tick === tick).map((e) => e.note).sort((a, b) => a - b);
  assert.deepEqual(on(0), [57, 60, 64]);
  const step = PPQ / 4;
  const offs = t.filter((e) => e.type === 'off' && e.tick === 4 * step).map((e) => e.note).sort((a, b) => a - b);
  assert.deepEqual(offs, [57, 60, 64]);
});
