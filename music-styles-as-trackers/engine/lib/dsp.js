/**
 * Building blocks: oscillators, filters, envelopes, noise, shaping.
 * Everything here is per-sample and allocation-free in the hot path.
 */

export const TWO_PI = Math.PI * 2;

/** Cutoff 0..1 to Hz, exponential from 20 Hz to 20 kHz. */
export function cutoffHz(u) {
  const c = u < 0 ? 0 : u > 1 ? 1 : u;
  return 20 * Math.pow(1000, c);
}

export function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

/** Fast soft clip: tanh-like without the transcendental. */
export function softClip(x) {
  if (x > 3) return 1;
  if (x < -3) return -1;
  return x * (27 + x * x) / (27 + 9 * x * x);
}

/** PolyBLEP correction for a discontinuity at phase t (0..1) with increment dt. */
function polyBlep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

/**
 * Band-limited oscillator. Call `next(freq)` once per sample.
 * Shapes: sine, triangle, saw, square, pulse (uses `pw`), noise.
 */
export class Osc {
  constructor(sampleRate, shape = 'saw', phase = 0) {
    this.sr = sampleRate;
    this.shape = shape;
    this.phase = phase;
    this.pw = 0.5;
    this.tri = 0; // leaky integrator state for triangle
  }

  next(freq) {
    const dt = freq / this.sr;
    let t = this.phase;
    let out;
    switch (this.shape) {
      case 'sine':
        out = Math.sin(TWO_PI * t);
        break;
      case 'saw':
        out = 2 * t - 1 - polyBlep(t, dt);
        break;
      case 'square': {
        out = t < 0.5 ? 1 : -1;
        out += polyBlep(t, dt);
        out -= polyBlep((t + 0.5) % 1, dt);
        break;
      }
      case 'pulse': {
        const pw = clamp(this.pw, 0.05, 0.95);
        out = t < pw ? 1 : -1;
        out += polyBlep(t, dt);
        out -= polyBlep((t + 1 - pw) % 1, dt);
        break;
      }
      case 'triangle': {
        // Integrate a band-limited square; the leak keeps DC out.
        let sq = t < 0.5 ? 1 : -1;
        sq += polyBlep(t, dt);
        sq -= polyBlep((t + 0.5) % 1, dt);
        this.tri = (1 - dt * 2) * this.tri + sq * dt * 4;
        out = clamp(this.tri, -1, 1);
        break;
      }
      case 'noise':
        out = Math.random() * 2 - 1;
        break;
      default:
        out = 0;
    }
    t += dt;
    if (t >= 1) t -= 1;
    this.phase = t;
    return out;
  }
}

/**
 * State-variable filter (TPT form, Simper). Stable at any cutoff and resonance,
 * modulated per sample without zipper noise.
 */
export class SVF {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.ic1 = 0; this.ic2 = 0;
    this.g = 0; this.k = 1; this.a1 = 0; this.a2 = 0; this.a3 = 0;
    this.set(1000, 0);
  }

  /** @param {number} hz cutoff @param {number} res 0..1 */
  set(hz, res) {
    const f = clamp(hz, 10, this.sr * 0.45);
    this.g = Math.tan(Math.PI * f / this.sr);
    this.k = 2 - 1.96 * clamp(res, 0, 1);
    this.a1 = 1 / (1 + this.g * (this.g + this.k));
    this.a2 = this.g * this.a1;
    this.a3 = this.g * this.a2;
  }

  /** Returns [low, band, high] for input v0; use `lp/bp/hp` helpers for one. */
  process(v0) {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.low = v2; this.band = v1; this.high = v0 - this.k * v1 - v2;
    return v2;
  }

  lp(x) { this.process(x); return this.low; }
  hp(x) { this.process(x); return this.high; }
  bp(x) { this.process(x); return this.band * this.k; }

  run(x, type) {
    this.process(x);
    if (type === 'highpass') return this.high;
    if (type === 'bandpass') return this.band * this.k;
    return this.low;
  }

  reset() { this.ic1 = 0; this.ic2 = 0; }
}

/** One-pole lowpass; coefficient from a cutoff in Hz. */
export class OnePole {
  constructor(sampleRate, hz = 1000) { this.sr = sampleRate; this.z = 0; this.set(hz); }
  set(hz) { this.a = 1 - Math.exp(-TWO_PI * clamp(hz, 1, this.sr * 0.49) / this.sr); }
  lp(x) { this.z += this.a * (x - this.z); return this.z; }
  hp(x) { return x - this.lp(x); }
}

/**
 * ADSR envelope. Attack is linear, decay and release are exponential.
 * Times in seconds. `gate(false)` starts the release. `done` when silent.
 */
export class ADSR {
  constructor(sampleRate, { attack = 0.001, decay = 0.1, sustain = 1, release = 0.05 } = {}) {
    this.sr = sampleRate;
    this.set({ attack, decay, sustain, release });
    this.level = 0;
    this.stage = 'idle';
    this.done = true;
  }

  set({ attack = 0.001, decay = 0.1, sustain = 1, release = 0.05 }) {
    this.attackInc = 1 / Math.max(1, attack * this.sr);
    this.decayCoef = 1 - Math.exp(-4.6 / Math.max(1, decay * this.sr));
    this.releaseCoef = 1 - Math.exp(-4.6 / Math.max(1, release * this.sr));
    this.sustain = sustain;
  }

  trigger(retrigger = true) {
    this.stage = 'attack';
    this.done = false;
    if (retrigger) this.level = 0;
  }

  gate(on) { if (!on && this.stage !== 'idle') this.stage = 'release'; }

  /** Jump to release with a very fast coefficient (choke). */
  choke(seconds = 0.003) {
    this.stage = 'release';
    this.releaseCoef = 1 - Math.exp(-4.6 / Math.max(1, seconds * this.sr));
  }

  next() {
    switch (this.stage) {
      case 'attack':
        this.level += this.attackInc;
        if (this.level >= 1) { this.level = 1; this.stage = 'decay'; }
        break;
      case 'decay':
        this.level += (this.sustain - this.level) * this.decayCoef;
        if (this.level - this.sustain < 1e-4) { this.level = this.sustain; this.stage = 'sustain'; }
        break;
      case 'sustain':
        this.level = this.sustain;
        if (this.sustain <= 1e-4) { this.stage = 'idle'; this.done = true; this.level = 0; }
        break;
      case 'release':
        this.level += (0 - this.level) * this.releaseCoef;
        if (this.level < 1e-4) { this.level = 0; this.stage = 'idle'; this.done = true; }
        break;
      default:
        this.level = 0;
    }
    return this.level;
  }
}

/** Low-frequency oscillator in 0..1 units, bipolar output -1..1. */
export class LFO {
  constructor(sampleRate, shape = 'sine', rateHz = 1) {
    this.sr = sampleRate; this.shape = shape; this.phase = 0; this.rate = rateHz;
    this.held = 0; this.lastIdx = -1;
  }
  reset() { this.phase = 0; }
  next() {
    const t = this.phase;
    let out;
    switch (this.shape) {
      case 'triangle': out = 4 * Math.abs(t - 0.5) - 1; break;
      case 'saw': out = 2 * t - 1; break;
      case 'square': out = t < 0.5 ? 1 : -1; break;
      case 'random': {
        const idx = Math.floor(t * 2);
        if (idx !== this.lastIdx) { this.held = Math.random() * 2 - 1; this.lastIdx = idx; }
        out = this.held; break;
      }
      default: out = Math.sin(TWO_PI * t);
    }
    this.phase += this.rate / this.sr;
    if (this.phase >= 1) { this.phase -= 1; this.lastIdx = -1; }
    return out;
  }
}

/** Seedless noise sources. Pink via Paul Kellet's filter, brown via a leaky integrator. */
export class Noise {
  constructor(color = 'white') {
    this.color = color;
    this.b0 = 0; this.b1 = 0; this.b2 = 0; this.b3 = 0; this.b4 = 0; this.b5 = 0; this.b6 = 0;
    this.brown = 0;
  }
  next() {
    const w = Math.random() * 2 - 1;
    if (this.color === 'white') return w;
    if (this.color === 'brown') {
      this.brown = (this.brown + 0.02 * w) / 1.02;
      return this.brown * 3.5;
    }
    this.b0 = 0.99886 * this.b0 + w * 0.0555179;
    this.b1 = 0.99332 * this.b1 + w * 0.0750759;
    this.b2 = 0.96900 * this.b2 + w * 0.1538520;
    this.b3 = 0.86650 * this.b3 + w * 0.3104856;
    this.b4 = 0.55000 * this.b4 + w * 0.5329522;
    this.b5 = -0.7616 * this.b5 - w * 0.0168980;
    const pink = this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + w * 0.5362;
    this.b6 = w * 0.115926;
    return pink * 0.11;
  }
}

/** Equal-power pan: returns [gainL, gainR] for pan -1..1. */
export function panGains(pan) {
  const p = (clamp(pan, -1, 1) + 1) * 0.25 * Math.PI;
  return [Math.cos(p), Math.sin(p)];
}

/** Drive 0..1: waveshaping with gain compensation. */
export function drive(x, amount) {
  if (amount <= 0) return x;
  const g = 1 + amount * 9;
  return softClip(x * g) / Math.sqrt(g);
}
