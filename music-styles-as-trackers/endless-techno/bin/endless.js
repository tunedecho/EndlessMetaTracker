#!/usr/bin/env node
/**
 * Endless mode in Node: stream sections from a style through the player and
 * write the result to WAV, for as many minutes as asked. An optional energy
 * script nudges sections: "+0.3@4,-0.4@9" means +0.3 on section 4 and -0.4 on 9.
 *   node bin/endless.js ../styles/hypnotic-techno.json --seed 5 --minutes 12 --out run.wav [--energy "+0.3@4"]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Session } from '../lib/index.js';
import { Player, encodeWav, analyze } from '@tracker/engine';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const styleFile = args.find((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
if (!styleFile || !flag('--out')) { console.error('usage: endless style.json --out run.wav [--seed N] [--minutes M] [--energy "+0.3@4,-0.4@9"] [--rate 44100]'); process.exit(2); }
const style = JSON.parse(readFileSync(styleFile, 'utf8'));
const seed = parseInt(flag('--seed', '1'), 10);
const minutes = parseFloat(flag('--minutes', '10'));
const sampleRate = parseInt(flag('--rate', '44100'), 10);
const nudges = new Map((flag('--energy', '') || '').split(',').filter(Boolean).map((s) => { const [v, at] = s.split('@'); return [parseInt(at, 10), parseFloat(v)]; }));

const session = new Session(style, { seed });
const player = new Player(session.header(), { sampleRate, seed });
const target = minutes * 60 * sampleRate;
const chunks = [];
let rendered = 0;
const t0 = Date.now();
while (rendered < target) {
  const r = session.next({ energy: nudges.get(session.rows.length) || 0 });
  const info = player.appendRow(r.row, { phrases: session.phrases, chains: session.chains, tracks: r.tracks }, r.section);
  const n = Math.min(Math.round(info.samples), target - rendered);
  const { left, right } = player.render(n);
  chunks.push([left, right]);
  rendered += n;
  const bars = info.steps / player.transport.phraseLength;
  console.error(`${String(r.index).padStart(3)} ${r.section.kind.padEnd(9)} e=${r.section.energy.toFixed(2)} ${String(bars).padStart(2)} bars  ${Object.keys(r.row).join(' ')}`);
}
const left = new Float32Array(rendered), right = new Float32Array(rendered);
let o = 0;
for (const [l, r] of chunks) { left.set(l, o); right.set(r, o); o += l.length; }
writeFileSync(flag('--out'), encodeWav(left, right, sampleRate));
console.error(`${flag('--out')}: ${(rendered / sampleRate / 60).toFixed(1)} min in ${((Date.now() - t0) / 1000).toFixed(0)}s`, analyze.report(left, right, sampleRate));
