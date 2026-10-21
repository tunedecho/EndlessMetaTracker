#!/usr/bin/env node
/**
 * Generate a fixed song from a style.
 *   tracker-generate style.json [--seed N] [--minutes M] [--out song.json] [--render out.wav] [--mp3] [--stats]
 * --render needs @tracker/engine (in this repo). Without --out the song is printed to stdout.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { generateSong } from '../lib/index.js';
import { songStats } from '@tracker/format';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const has = (n) => args.includes(n);
const styleFile = args.find((a, i) => !a.startsWith('--') && (i === 0 || !['--seed', '--minutes', '--out', '--render'].includes(args[i - 1])));
if (!styleFile) { console.error('usage: tracker-generate style.json [--seed N] [--minutes M] [--out song.json] [--render out.wav] [--mp3] [--stats]'); process.exit(2); }

const style = JSON.parse(readFileSync(styleFile, 'utf8'));
const seed = flag('--seed') !== undefined ? parseInt(flag('--seed'), 10) : Math.floor(Math.random() * 1e9);
const minutes = flag('--minutes') !== undefined ? parseFloat(flag('--minutes')) : undefined;
const song = generateSong(style, { seed, minutes });
const out = flag('--out');
if (out) { writeFileSync(out, JSON.stringify(song, null, 1)); console.error(`${out}: seed ${seed}, ${song.meta.notes}`); }
else if (!flag('--render')) process.stdout.write(JSON.stringify(song, null, 1));
if (has('--stats')) console.error(songStats(song));
if (flag('--render')) {
  const { renderSong, encodeWav, analyze } = await import('@tracker/engine');
  const t0 = Date.now();
  const r = renderSong(song);
  const wav = flag('--render');
  writeFileSync(wav, encodeWav(r.left, r.right, r.sampleRate));
  console.error(`${wav}: ${r.seconds.toFixed(1)}s in ${((Date.now() - t0) / 1000).toFixed(1)}s`, analyze.report(r.left, r.right, r.sampleRate));
  if (has('--mp3')) {
    const { spawnSync } = await import('node:child_process');
    const mp3 = wav.replace(/\.wav$/i, '') + '.mp3';
    const p = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '160k', mp3]);
    console.error(p.status === 0 ? `${mp3}: written` : `ffmpeg failed: ${p.stderr}`);
  }
}
