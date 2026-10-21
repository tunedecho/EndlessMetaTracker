import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Session } from '../lib/index.js';
import { Player, analyze } from '../../engine/lib/index.js';
import { validate } from '@tracker/format';

const style = JSON.parse(readFileSync(new URL('../../styles/hypnotic-techno.json', import.meta.url), 'utf8'));

test('a session yields sections forever and they assemble into a valid song', () => {
  const s = new Session(style, { seed: 9 });
  const kinds = [];
  for (let i = 0; i < 40; i++) {
    const r = s.next(i % 7 === 3 ? { energy: 0.3 } : {});
    assert.ok(Object.keys(r.row).length >= 1);
    assert.equal(r.index, i);
    kinds.push(r.section.kind);
    for (const id of Object.values(r.row)) assert.ok(s.chains[id], `row refers to unknown chain ${id}`);
  }
  assert.equal(kinds[0], 'intro');
  assert.ok(!kinds.includes('outro'), 'endless runs have no outro');
  assert.ok(kinds.filter((k) => k === 'drop').length >= 3, `arcs keep coming: ${kinds.join(',')}`);
  const song = s.toSong();
  const v = validate(song);
  assert.ok(v.ok, v.errors.join('; '));
});

test('an energy nudge raises the section energy', () => {
  const a = new Session(style, { seed: 21 });
  const b = new Session(style, { seed: 21 });
  for (let i = 0; i < 3; i++) { a.next(); b.next(); }
  const ra = a.next();
  const rb = b.next({ energy: 0.5 });
  assert.ok(rb.section.energy > ra.section.energy);
  // The layer set follows the energy: at full energy the pad (energy <= 0.6) must be gone.
  assert.ok(!Object.keys(rb.row).some((t) => t.startsWith('pad')) || rb.section.energy <= 0.62);
});

test('the streaming player renders appended sections across their boundary', () => {
  const s = new Session(style, { seed: 4 });
  const player = new Player(s.header(), { sampleRate: 22050 });
  const first = s.next();
  const info1 = player.appendRow(first.row, { phrases: s.phrases, chains: s.chains, tracks: first.tracks }, first.section);
  const second = s.next();
  const info2 = player.appendRow(second.row, { phrases: s.phrases, chains: s.chains, tracks: second.tracks }, second.section);
  assert.equal(info2.startSample, info1.startSample + info1.samples);
  // Render a window straddling the boundary and make sure there is sound on both sides, without clipping.
  const span = Math.min(info2.startSample + 22050, player.rowStart);
  const { left } = player.render(Math.round(span));
  const before = analyze.rms(left, Math.round(info2.startSample - 11025), Math.round(info2.startSample));
  const after = analyze.rms(left, Math.round(info2.startSample), Math.round(info2.startSample + 11025));
  assert.ok(before > 0.005 && after > 0.005, `rms ${before} ${after}`);
  assert.ok(analyze.clipRatio(left) < 0.001);
  // The player keeps rendering (tails, then silence) past the appended rows.
  const { left: tail } = player.render(4096);
  assert.equal(tail.length, 4096);
});
