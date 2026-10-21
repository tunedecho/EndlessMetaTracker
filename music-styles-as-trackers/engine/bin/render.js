#!/usr/bin/env node
/**
 * Render a song to a WAV file.
 *   tracker-render song.json out.wav [--seconds N] [--loops N] [--rate 48000] [--mp3] [--report]
 * --mp3 also writes an MP3 next to the WAV using ffmpeg, if installed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { assertValid } from '@tracker/format';
import { renderSong, encodeWav, analyze } from '../lib/index.js';

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const has = (name) => args.includes(name);
const files = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && ['--seconds', '--loops', '--rate'].includes(args[i - 1])));
const [input, output] = files;
if (!input || !output) { console.error('usage: tracker-render song.json out.wav [--seconds N] [--loops N] [--rate 44100] [--mp3] [--report]'); process.exit(2); }

const song = assertValid(JSON.parse(readFileSync(input, 'utf8')), input);
const t0 = Date.now();
const r = renderSong(song, {
  sampleRate: parseInt(flag('--rate', '44100'), 10),
  maxSeconds: flag('--seconds') ? parseFloat(flag('--seconds')) : undefined,
  loops: parseInt(flag('--loops', '0'), 10),
});
writeFileSync(output, encodeWav(r.left, r.right, r.sampleRate));
const ms = Date.now() - t0;
console.log(`${output}: ${r.seconds.toFixed(1)}s rendered in ${(ms / 1000).toFixed(1)}s (${(r.seconds / (ms / 1000)).toFixed(1)}x realtime)`);
if (has('--report')) console.log(analyze.report(r.left, r.right, r.sampleRate));
if (has('--mp3')) {
  const mp3 = output.replace(/\.wav$/i, '') + '.mp3';
  const p = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', output, '-codec:a', 'libmp3lame', '-b:a', '160k', mp3]);
  if (p.status === 0) console.log(`${mp3}: written`); else console.error('ffmpeg failed:', p.stderr?.toString());
}
