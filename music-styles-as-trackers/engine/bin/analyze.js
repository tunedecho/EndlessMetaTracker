#!/usr/bin/env node
/**
 * Measure a song the way a session without ears can: per-section band levels
 * and the octave-band spectrum of each track soloed.
 *   tracker-analyze song.json [--at SECONDS] [--seconds N]
 * --at picks the moment for the solo spectra (default: the loudest section's start).
 */
import { readFileSync } from 'node:fs';
import { assertValid } from '@tracker/format';
import { renderSong, analyze } from '../lib/index.js';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const file = args.find((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
if (!file) { console.error('usage: tracker-analyze song.json [--at SECONDS] [--seconds N]'); process.exit(2); }
const song = assertValid(JSON.parse(readFileSync(file, 'utf8')), file);
const maxSeconds = flag('--seconds') ? parseFloat(flag('--seconds')) : undefined;

const r = renderSong(song, { maxSeconds, tailSeconds: 0 });
const sr = r.sampleRate;
console.log(`${song.meta?.title ?? file}: ${r.seconds.toFixed(1)}s`, analyze.report(r.left, r.right, sr));

// Per-section band levels.
console.log('\nsections (dB): low <150 Hz, mid, high >2.5 kHz');
let loudest = { rms: 0, start: 0 };
for (const row of r.resolved.rows) {
  const s = Math.round(row.startSample), e = Math.min(r.left.length, Math.round(row.startSample + row.samples));
  if (s >= r.left.length) break;
  const seg = r.left.subarray(s, e);
  const b = analyze.bandBalance(seg, sr, 150, 2500);
  const total = analyze.rms(seg);
  if (total > loudest.rms) loudest = { rms: total, start: s / sr };
  const dB = (f) => Math.round(analyze.db(total * Math.sqrt(f)));
  const layers = Object.keys(song.composition.song.rows[row.row]).join(' ');
  console.log(`${String(row.row).padStart(3)} ${(row.name ?? '').padEnd(9)} e=${(row.energy ?? 0).toFixed(2)} ${String(row.steps / r.resolved.transport.phraseLength).padStart(3)} bars  low ${String(dB(b.low)).padStart(4)} mid ${String(dB(b.mid)).padStart(4)} high ${String(dB(b.high)).padStart(4)}  ${layers}`);
}

// Octave-band spectrum (dB, relative) of the mix and of each track soloed, at one moment.
const at = flag('--at') ? parseFloat(flag('--at')) : loudest.start;
const EDGES = [0, 60, 120, 250, 500, 1000, 2000, 4000, 8000, 22050];
function spectrum(buf, start, frames = 16) {
  const N = 4096; const acc = new Float64Array(N / 2);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let f = 0; f < frames; f++) {
    const off = start + f * N;
    for (let i = 0; i < N; i++) { re[i] = (buf[off + i] || 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)); im[i] = 0; }
    for (let i = 1, j = 0; i < N; i++) { let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
    for (let len = 2; len <= N; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      for (let i = 0; i < N; i += len) for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(ang * k), s = Math.sin(ang * k);
        const xr = re[i + k + len / 2] * c - im[i + k + len / 2] * s, xi = re[i + k + len / 2] * s + im[i + k + len / 2] * c;
        re[i + k + len / 2] = re[i + k] - xr; im[i + k + len / 2] = im[i + k] - xi; re[i + k] += xr; im[i + k] += xi;
      }
    }
    for (let i = 0; i < N / 2; i++) acc[i] += re[i] * re[i] + im[i] * im[i];
  }
  return EDGES.slice(0, -1).map((lo, b) => { let e = 0; for (let i = Math.floor((lo * N) / sr); i < Math.floor((EDGES[b + 1] * N) / sr); i++) e += acc[i]; return Math.round(10 * Math.log10(e / frames + 1e-12)); });
}
console.log(`\noctave bands at ${at.toFixed(1)}s (dB): ${EDGES.slice(0, -1).map((lo, i) => `${lo}-${EDGES[i + 1]}`).join('  ')}`);
const fmt = (name, sp) => console.log(`${name.padEnd(10)} ${sp.map((v) => String(v).padStart(5)).join('    ')}`);
fmt('mix', spectrum(r.left, Math.round(at * sr)));
for (const t of song.composition.tracks) {
  const solo = structuredClone(song);
  for (const u of solo.composition.tracks) if (u.id !== t.id) u.mute = true;
  const rs = renderSong(solo, { maxSeconds: at + 2, tailSeconds: 0 });
  fmt(t.id, spectrum(rs.left, Math.round(at * sr)));
}
