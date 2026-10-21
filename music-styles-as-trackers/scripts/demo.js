#!/usr/bin/env node
/**
 * One command that exercises the whole chain:
 * validate the examples and styles, generate a song from each style, render
 * the generated songs and the examples to WAV (and MP3 if ffmpeg exists),
 * export MIDI and .m8s, and print stats. Output goes to ./demo-out/.
 *   npm run demo            (seed 3, two minutes per style)
 *   npm run demo -- --seed 42 --minutes 5
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { validate, songStats } from '../format/lib/index.js';
import { generateSong } from '../endless-techno/lib/index.js';
import { renderSong, encodeWav, analyze } from '../engine/lib/index.js';
import { encodeMidi } from '../m8-writer/lib/midi.js';
import { songToM8 } from '../m8-writer/lib/m8s.js';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const seed = parseInt(flag('--seed', '3'), 10);
const minutes = parseFloat(flag('--minutes', '2'));
const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'demo-out');
mkdirSync(out, { recursive: true });
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

const render = (song, name) => {
  const t0 = Date.now();
  const r = renderSong(song);
  const wav = join(out, `${name}.wav`);
  writeFileSync(wav, encodeWav(r.left, r.right, r.sampleRate));
  const rep = analyze.report(r.left, r.right, r.sampleRate);
  console.log(`  ${name}.wav  ${rep.seconds}s  peak ${rep.peakDb} dB  rms ${rep.rmsDb} dB  clip ${rep.clip}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  if (hasFfmpeg) spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '128k', join(out, `${name}.mp3`)]);
};
const exportAll = (song, name) => {
  writeFileSync(join(out, `${name}.mid`), encodeMidi(song));
  try {
    const m8 = songToM8(song);
    writeFileSync(join(out, `${name}.m8s`), m8.bytes);
    for (const w of m8.warnings ?? []) console.log(`    m8s: ${w}`);
  } catch (e) {
    console.log(`    m8s: not written (${e.message})`);
  }
};

console.log('examples');
for (const f of readdirSync(join(root, 'format/examples')).filter((f) => f.endsWith('.json'))) {
  const song = JSON.parse(readFileSync(join(root, 'format/examples', f), 'utf8'));
  const v = validate(song);
  if (!v.ok) { console.log(`  ${f}: INVALID ${v.errors[0]}`); continue; }
  const name = f.replace(/\.json$/, '');
  render(song, name);
  exportAll(song, name);
}
console.log('styles');
for (const f of readdirSync(join(root, 'styles')).filter((f) => f.endsWith('.json'))) {
  const style = JSON.parse(readFileSync(join(root, 'styles', f), 'utf8'));
  const v = validate(style);
  if (!v.ok) { console.log(`  ${f}: INVALID ${v.errors[0]}`); continue; }
  const song = generateSong(style, { seed, minutes });
  const name = `${style.id}-${seed}`;
  writeFileSync(join(out, `${name}.json`), JSON.stringify(song, null, 1));
  const s = songStats(song);
  console.log(`  ${name}.json  ${s.bars} bars, ${s.phrases} phrases, ${s.chains} chains, ${s.gzipBytes} bytes gzipped`);
  render(song, name);
  exportAll(song, name);
}
console.log(`done: ${out}`);
