/**
 * Master bus effects: tempo-synced stereo delay, Freeverb-style reverb,
 * master highpass, and a peak limiter with a soft clip after it.
 */
import { OnePole, SVF, softClip, clamp } from './dsp.js';

export class Delay {
  constructor(sampleRate, def, stepSamples) {
    this.sr = sampleRate;
    this.def = def;
    this.pingPong = !!def.pingPong;
    this.feedback = def.feedback ?? 0.4;
    this.level = def.level ?? 0.5;
    this.setTime(stepSamples);
    const max = Math.ceil(16 * stepSamples) + 2;
    this.bufL = new Float32Array(Math.max(max, this.len + 2));
    this.bufR = new Float32Array(this.bufL.length);
    this.pos = 0;
    this.dampL = new OnePole(sampleRate, 20000 * Math.pow(0.08, def.damping ?? 0.4));
    this.dampR = new OnePole(sampleRate, 20000 * Math.pow(0.08, def.damping ?? 0.4));
  }
  setTime(stepSamples) {
    this.len = Math.max(1, Math.round((this.def.time ?? 6) * stepSamples));
    if (this.bufL && this.len + 2 > this.bufL.length) this.len = this.bufL.length - 2;
  }
  /** Process one sample of send input; returns [outL, outR] wet signal. */
  process(inL, inR) {
    const rp = (this.pos - this.len + this.bufL.length) % this.bufL.length;
    const dl = this.bufL[rp], dr = this.bufR[rp];
    let fbL, fbR;
    if (this.pingPong) { fbL = this.dampL.lp(dr) * this.feedback; fbR = this.dampR.lp(dl) * this.feedback; }
    else { fbL = this.dampL.lp(dl) * this.feedback; fbR = this.dampR.lp(dr) * this.feedback; }
    this.bufL[this.pos] = (this.pingPong ? inL + inR : inL) * 0.7 + fbL;
    this.bufR[this.pos] = (this.pingPong ? 0 : inR) * 0.7 + fbR;
    this.pos = (this.pos + 1) % this.bufL.length;
    return [dl * this.level, dr * this.level];
  }
}

/* Freeverb tunings, for 44.1 kHz; scaled to the sample rate. */
const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASSES = [556, 441, 341, 225];
const SPREAD = 23;

class Comb {
  constructor(len, feedback, damp) {
    this.buf = new Float32Array(len); this.pos = 0; this.store = 0;
    this.feedback = feedback; this.damp1 = damp; this.damp2 = 1 - damp;
  }
  process(x) {
    const out = this.buf[this.pos];
    this.store = out * this.damp2 + this.store * this.damp1;
    this.buf[this.pos] = x + this.store * this.feedback;
    if (++this.pos >= this.buf.length) this.pos = 0;
    return out;
  }
}
class Allpass {
  constructor(len) { this.buf = new Float32Array(len); this.pos = 0; }
  process(x) {
    const b = this.buf[this.pos];
    const out = -x + b;
    this.buf[this.pos] = x + b * 0.5;
    if (++this.pos >= this.buf.length) this.pos = 0;
    return out;
  }
}

export class Reverb {
  constructor(sampleRate, def) {
    const scale = sampleRate / 44100;
    const size = def.size ?? 0.5;
    const fb = 0.7 + 0.28 * size;
    const damp = (def.damping ?? 0.5) * 0.4 + 0.05;
    this.combsL = COMBS.map((n) => new Comb(Math.round(n * scale), fb, damp));
    this.combsR = COMBS.map((n) => new Comb(Math.round((n + SPREAD) * scale), fb, damp));
    this.apL = ALLPASSES.map((n) => new Allpass(Math.round(n * scale)));
    this.apR = ALLPASSES.map((n) => new Allpass(Math.round((n + SPREAD) * scale)));
    this.level = def.level ?? 0.3;
    const pre = Math.round((def.predelay || 0) * sampleRate);
    this.pre = pre > 0 ? { bufL: new Float32Array(pre), bufR: new Float32Array(pre), pos: 0 } : null;
    this.hp = new SVF(sampleRate); this.hp.set(120, 0);
  }
  process(inL, inR) {
    let x = (inL + inR) * 0.5;
    x = this.hp.hp(x);
    if (this.pre) {
      const p = this.pre;
      const d = p.bufL[p.pos];
      p.bufL[p.pos] = x;
      if (++p.pos >= p.bufL.length) p.pos = 0;
      x = d;
    }
    x *= 0.015;
    let l = 0, r = 0;
    for (let i = 0; i < 8; i++) { l += this.combsL[i].process(x); r += this.combsR[i].process(x); }
    for (let i = 0; i < 4; i++) { l = this.apL[i].process(l); r = this.apR[i].process(r); }
    return [l * this.level * 3, r * this.level * 3];
  }
}

/** Peak limiter: instant attack, exponential release, then a soft clip for anything left. */
export class Limiter {
  constructor(sampleRate, ceiling = 0.95, releaseSeconds = 0.08) {
    this.ceiling = ceiling;
    this.gain = 1;
    this.releaseCoef = 1 - Math.exp(-1 / (releaseSeconds * sampleRate));
  }
  process(l, r) {
    const peak = Math.max(Math.abs(l), Math.abs(r));
    const want = peak > this.ceiling ? this.ceiling / peak : 1;
    if (want < this.gain) this.gain = want;
    else this.gain += (1 - this.gain) * this.releaseCoef;
    return [softClip(l * this.gain), softClip(r * this.gain)];
  }
}

export class Master {
  constructor(sampleRate, def = {}, stepSamples) {
    this.volume = def.volume ?? 0.85;
    this.delay = def.delay ? new Delay(sampleRate, def.delay, stepSamples) : null;
    this.reverb = def.reverb ? new Reverb(sampleRate, def.reverb) : null;
    this.hp = def.highpass ? new SVF(sampleRate) : null;
    if (this.hp) this.hp.set(def.highpass, 0.1);
    this.hpR = def.highpass ? new SVF(sampleRate) : null;
    if (this.hpR) this.hpR.set(def.highpass, 0.1);
    this.limiter = (def.limiter ?? true) ? new Limiter(sampleRate) : null;
    this.dc = [new OnePole(sampleRate, 8), new OnePole(sampleRate, 8)];
  }
  setStep(stepSamples) { if (this.delay) this.delay.setTime(stepSamples); }
  /**
   * Mix dry and send buses into out buffers, in place, for one block.
   * dry, dly, rev: {L, R} Float32Arrays (block-sized). Writes into outL/outR at offset.
   */
  process(dry, dly, rev, outL, outR, offset, count) {
    for (let i = 0; i < count; i++) {
      let l = dry.L[i], r = dry.R[i];
      if (this.delay) { const [a, b] = this.delay.process(dly.L[i], dly.R[i]); l += a; r += b; }
      if (this.reverb) { const [a, b] = this.reverb.process(rev.L[i], rev.R[i]); l += a; r += b; }
      l = this.dc[0].hp(l); r = this.dc[1].hp(r);
      if (this.hp) { l = this.hp.hp(l); r = this.hpR.hp(r); }
      l *= this.volume; r *= this.volume;
      if (this.limiter) { const [a, b] = this.limiter.process(l, r); l = a; r = b; }
      outL[offset + i] = clamp(l, -1, 1);
      outR[offset + i] = clamp(r, -1, 1);
    }
  }
}
