/**
 * Facts about a song that help a human and a generator: counts, lengths, and the
 * smallest-definition measurement (how many bytes a complete definition takes).
 */
import { gzipSync } from 'node:zlib';
import { songSteps, transportOf } from './resolve.js';

export function songStats(song) {
  const t = transportOf(song);
  const steps = songSteps(song);
  const beats = steps / t.stepsPerBeat;
  const seconds = beats * 60 / t.bpm;
  const c = song.composition;
  let notes = 0;
  for (const p of Object.values(c.phrases)) for (const s of p.steps) if (s && s.note !== undefined && s.note !== 'OFF') notes++;
  return {
    title: song.meta?.title,
    bpm: t.bpm,
    tracks: c.tracks.length,
    instruments: Object.keys(song.sound.instruments).length,
    phrases: Object.keys(c.phrases).length,
    chains: Object.keys(c.chains).length,
    rows: c.song.rows.length,
    steps,
    bars: steps / t.phraseLength,
    seconds: Math.round(seconds * 10) / 10,
    notesInPhrases: notes,
    ...sizeOf(song),
  };
}

/** Bytes of the JSON, minified and gzipped: the smallest-definition test. */
export function sizeOf(doc) {
  const json = JSON.stringify(doc);
  return { bytes: Buffer.byteLength(json), gzipBytes: gzipSync(Buffer.from(json), { level: 9 }).length };
}
