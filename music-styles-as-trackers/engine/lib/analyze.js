/**
 * Measurements on rendered audio, so a session without ears can still check
 * that a render is loud enough, not clipping, has events where the song says,
 * and has energy in the bands the instruments should fill.
 */
import { SVF } from './dsp.js';

export function peak(buf) { let p = 0; for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > p) p = a; } return p; }
export function rms(buf, start = 0, end = buf.length) { let s = 0; for (let i = start; i < end; i++) s += buf[i] * buf[i]; return Math.sqrt(s / Math.max(1, end - start)); }
export function db(x) { return 20 * Math.log10(Math.max(1e-9, x)); }

/** RMS in frames of `frameSeconds`. */
export function envelope(buf, sampleRate, frameSeconds = 0.01) {
  const n = Math.max(1, Math.round(frameSeconds * sampleRate));
  const out = new Float32Array(Math.ceil(buf.length / n));
  for (let f = 0; f < out.length; f++) out[f] = rms(buf, f * n, Math.min(buf.length, (f + 1) * n));
  return out;
}

/**
 * Onset times in seconds: frames where the energy rises sharply above the recent level.
 * Good enough to confirm that drum hits land on the grid.
 */
export function onsets(buf, sampleRate, { frameSeconds = 0.005, ratio = 2.5, minGap = 0.04, floor = 0.01 } = {}) {
  const env = envelope(buf, sampleRate, frameSeconds);
  const out = [];
  let last = -Infinity;
  let avg = 0;
  for (let f = 1; f < env.length; f++) {
    const t = f * frameSeconds;
    if (env[f] > floor && env[f] > ratio * avg && env[f] > env[f - 1] * 1.3 && t - last >= minGap) { out.push(t); last = t; }
    avg = avg * 0.85 + env[f] * 0.15;
  }
  return out;
}

/** RMS energy below `lowHz`, between, and above `highHz`, as a fraction of the total. */
export function bandBalance(buf, sampleRate, lowHz = 150, highHz = 4000) {
  const lo = new SVF(sampleRate); lo.set(lowHz, 0);
  const hi = new SVF(sampleRate); hi.set(highHz, 0);
  let l = 0, m = 0, h = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    lo.process(x); const low = lo.low;
    hi.process(x); const high = hi.high;
    const mid = x - low - high;
    l += low * low; m += mid * mid; h += high * high;
  }
  const t = l + m + h || 1;
  return { low: l / t, mid: m / t, high: h / t };
}

/** Fraction of samples at or near full scale: clipping indicator. */
export function clipRatio(buf, threshold = 0.999) {
  let c = 0; for (let i = 0; i < buf.length; i++) if (Math.abs(buf[i]) >= threshold) c++;
  return c / buf.length;
}

export function report(left, right, sampleRate) {
  const mono = new Float32Array(left.length);
  for (let i = 0; i < left.length; i++) mono[i] = (left[i] + right[i]) * 0.5;
  const bands = bandBalance(mono, sampleRate);
  return {
    seconds: Math.round(left.length / sampleRate * 100) / 100,
    peakDb: Math.round(db(Math.max(peak(left), peak(right))) * 10) / 10,
    rmsDb: Math.round(db(rms(mono)) * 10) / 10,
    clip: Math.round(clipRatio(left) * 1e5) / 1e5,
    low: Math.round(bands.low * 100) / 100,
    mid: Math.round(bands.mid * 100) / 100,
    high: Math.round(bands.high * 100) / 100,
    onsets: onsets(mono, sampleRate).length,
  };
}
