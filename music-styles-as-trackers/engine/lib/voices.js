/**
 * The synth engines. Each voice renders one note of one instrument into a stereo
 * buffer. Voices read live track controls (cutoff, pitch, ...) from `ctl` so step
 * commands take effect on the sounding note.
 */
import { Osc, SVF, ADSR, LFO, Noise, OnePole, cutoffHz, clamp, panGains, TWO_PI } from './dsp.js';
import { toFreq } from '@tracker/format';

const CTL_BLOCK = 16; // samples between modulation updates

/** Base class: envelope, filter, LFO, table, pitch glide. */
class Voice {
  constructor(inst, sampleRate, ctl) {
    this.inst = inst;
    this.sr = sampleRate;
    this.ctl = ctl; // live track controls
    this.filter = inst.filter || {};
    this.filterType = this.filter.type || 'lowpass';
    this.amp = new ADSR(sampleRate, { attack: 0.002, decay: 0.1, sustain: 1, release: 0.05, ...(inst.amp || {}) });
    this.fenv = new ADSR(sampleRate, { attack: 0.001, decay: 0.2, sustain: 0, release: 0.2, ...(this.filter.env || {}) });
    this.lfo = inst.lfo ? new LFO(sampleRate, inst.lfo.shape || 'sine', inst.lfo.rate ?? 1) : null;
    this.svfL = new SVF(sampleRate);
    this.svfR = new SVF(sampleRate);
    this.useFilter = this.filterType !== 'off' && (this.filter.cutoff !== undefined || this.filter.env || (inst.lfo && inst.lfo.target === 'cutoff'));
    this.midi = 60;
    this.pitch = 60;      // current (glided) pitch
    this.pitchTarget = 60;
    this.glideCoef = 1;   // 1 = instant
    this.vel = 1;
    this.accent = 0;
    this.done = true;
    this.table = null;
    this.tableTranspose = 0;
    this.tableVolume = 1;
    this.tableFx = null;
    this.ctr = 0;
    this.lfoValue = 0;
    this.stereo = false;
  }

  /** @param {object} o accent 0..1, slideFrom midi, slideSeconds, stepSamples, table def */
  noteOn(midi, vel = 1, o = {}) {
    this.midi = midi + (this.inst.transpose || 0);
    this.vel = vel;
    this.accent = o.accent || 0;
    this.done = false;
    const glide = o.slideSeconds ?? (o.legato ? (this.inst.params?.glide || 0) : 0);
    if (glide > 0 && o.slideFrom !== undefined) {
      this.pitch = o.slideFrom + (this.inst.transpose || 0);
      this.glideCoef = 1 - Math.exp(-5 / Math.max(1, glide * this.sr));
    } else {
      this.pitch = this.midi;
      this.glideCoef = 1;
    }
    this.pitchTarget = this.midi;
    this.amp.trigger(!o.legato);
    this.fenv.trigger(!o.legato);
    if (this.lfo && (this.inst.lfo.retrigger ?? true)) this.lfo.reset();
    if (o.table) this.startTable(o.table, o.stepSamples);
    else this.table = null;
    this.tableTranspose = 0; this.tableVolume = 1; this.tableFx = null;
    this.ctr = 0;
  }

  noteOff() { this.amp.gate(false); this.fenv.gate(false); }
  choke() { this.amp.choke(); }

  startTable(def, stepSamples) {
    const rate = def.rate ?? 4;
    this.table = { def, row: -1, samplesPerRow: Math.max(1, Math.round(stepSamples / rate)), counter: 0, ended: false };
    this.advanceTable(0);
  }

  advanceTable(n) {
    const t = this.table;
    if (!t || t.ended) return;
    t.counter += n;
    while (t.counter >= 0) {
      if (t.row === -1 || t.counter >= t.samplesPerRow) {
        if (t.row !== -1) t.counter -= t.samplesPerRow;
        t.row++;
        if (t.row >= t.def.rows.length) {
          if (t.def.loop ?? true) t.row = 0; else { t.ended = true; return; }
        }
        const r = t.def.rows[t.row];
        this.tableTranspose = r.transpose || 0;
        this.tableVolume = r.volume ?? 1;
        this.tableFx = r.fx || null;
        if (t.row === 0 && t.counter < 0) t.counter = 0;
      } else break;
    }
  }

  /** Effective cutoff 0..1 from instrument, track control, table, envelope, LFO. */
  cutoffUnits() {
    let c = this.tableFx?.cutoff ?? this.ctl.cutoff ?? this.filter.cutoff ?? 1;
    if (this.filter.envAmount) c += this.filter.envAmount * this.fenv.level * (1 + this.accent);
    if (this.lfo && this.inst.lfo.target === 'cutoff') c += this.lfoValue * this.inst.lfo.depth * 0.5;
    if (this.filter.keyTrack) c += (this.pitch - 60) / 60 * this.filter.keyTrack * 0.5;
    return clamp(c, 0, 1);
  }

  resonance() { return this.tableFx?.resonance ?? this.ctl.resonance ?? this.filter.resonance ?? 0; }

  /** Per-block modulation update: LFO, glide, filter coefficients, table. */
  updateControls(n, stepSamples) {
    if (this.lfo) {
      if (this.inst.lfo.sync) this.lfo.rate = this.sr / (this.inst.lfo.sync * stepSamples);
      this.lfoValue = this.lfo.next();
      // advance the LFO phase for the rest of the block
      this.lfo.phase += (this.lfo.rate / this.sr) * (n - 1);
      if (this.lfo.phase >= 1) this.lfo.phase -= Math.floor(this.lfo.phase);
    }
    if (this.glideCoef < 1) {
      this.pitch += (this.pitchTarget - this.pitch) * (1 - Math.pow(1 - this.glideCoef, n));
      if (Math.abs(this.pitch - this.pitchTarget) < 0.001) { this.pitch = this.pitchTarget; this.glideCoef = 1; }
    } else this.pitch = this.pitchTarget;
    if (this.useFilter) {
      const hz = cutoffHz(this.cutoffUnits());
      const res = this.resonance();
      this.svfL.set(hz, res);
      if (this.stereo) this.svfR.set(hz, res);
    }
    this.advanceTable(n);
  }

  /** Pitch in MIDI including everything but the oscillator's own detune. */
  midiNow() {
    let p = this.pitch + this.tableTranspose + (this.ctl.pitch || 0) + (this.tableFx?.pitch || 0);
    if (this.lfo && this.inst.lfo.target === 'pitch') p += this.lfoValue * this.inst.lfo.depth * 12;
    return p;
  }

  /** Gain from velocity, accent, table, LFO. */
  gainNow() {
    let g = this.vel * (1 + this.accent * 0.5) * this.tableVolume;
    if (this.lfo && this.inst.lfo.target === 'volume') g *= 1 - (this.lfoValue * 0.5 + 0.5) * this.inst.lfo.depth;
    return g;
  }

  /** Render `count` samples, adding into L/R at `start`. Subclasses implement `sample()`. */
  render(L, R, start, count, stepSamples) {
    let i = 0;
    while (i < count) {
      const n = Math.min(CTL_BLOCK, count - i);
      this.updateControls(n, stepSamples);
      const gain = this.gainNow();
      this.prepareBlock();
      for (let k = 0; k < n; k++) {
        const env = this.amp.next();
        this.fenv.next();
        if (this.amp.done) { this.done = true; return; }
        const idx = start + i + k;
        this.sampleInto(L, R, idx, env * gain);
      }
      i += n;
    }
  }

  prepareBlock() {}
  sampleInto() {}
}

/* ---------------------------------------------------------------- analog */

const UNISON_PANS = { 1: [0], 2: [-1, 1], 3: [-1, 0, 1], 4: [-1, -0.33, 0.33, 1], 5: [-1, -0.5, 0, 0.5, 1], 6: [-1, -0.6, -0.2, 0.2, 0.6, 1], 7: [-1, -0.66, -0.33, 0, 0.33, 0.66, 1] };

export class AnalogVoice extends Voice {
  constructor(inst, sr, ctl) {
    super(inst, sr, ctl);
    const p = inst.params || {};
    this.p = p;
    this.unison = clamp(p.unison || 1, 1, 7);
    this.stereo = this.unison > 1 && (p.unisonSpread || 0) > 0;
    this.osc1 = [];
    this.osc2 = [];
    for (let u = 0; u < this.unison; u++) {
      this.osc1.push(new Osc(sr, p.wave || 'saw', Math.random()));
      this.osc2.push(new Osc(sr, p.wave2 || 'saw', Math.random()));
    }
    for (const o of this.osc1) o.pw = p.pulseWidth ?? 0.5;
    for (const o of this.osc2) o.pw = p.pulseWidth ?? 0.5;
    this.sub = (p.sub || 0) > 0 ? new Osc(sr, 'square') : null;
    this.noise = (p.noise || 0) > 0 ? new Noise('white') : null;
    const pans = UNISON_PANS[this.unison];
    const spread = p.unisonSpread || 0;
    this.gains = pans.map((pn) => panGains(pn * spread));
    this.detunes = pans.map((pn, i) => (this.unison === 1 ? 0 : pn * (p.unisonDetune || 0) / 100 * (i % 2 ? 1 : 0.8)));
    this.norm = 1 / Math.sqrt(this.unison);
  }

  prepareBlock() {
    const m = this.midiNow();
    this.f1 = this.detunes.map((d) => toFreq(m + d));
    this.f2 = this.detunes.map((d) => toFreq(m + d + (this.p.detune2 || 0)));
    this.fsub = toFreq(m - 12);
    if (this.lfo && this.inst.lfo.target === 'pulseWidth') {
      const pw = clamp((this.p.pulseWidth ?? 0.5) + this.lfoValue * this.inst.lfo.depth * 0.45, 0.05, 0.95);
      for (const o of this.osc1) o.pw = pw;
    }
  }

  sampleInto(L, R, idx, g) {
    const mix2 = this.p.mix2 || 0;
    if (this.stereo) {
      let l = 0, r = 0;
      for (let u = 0; u < this.unison; u++) {
        let s = this.osc1[u].next(this.f1[u]);
        if (mix2 > 0) s = s * (1 - mix2 * 0.5) + this.osc2[u].next(this.f2[u]) * mix2;
        l += s * this.gains[u][0];
        r += s * this.gains[u][1];
      }
      l *= this.norm; r *= this.norm;
      if (this.sub) { const sb = this.sub.next(this.fsub) * this.p.sub; l += sb; r += sb; }
      if (this.noise) { const nz = this.noise.next() * this.p.noise; l += nz; r += nz; }
      if (this.useFilter) { l = this.svfL.run(l, this.filterType); r = this.svfR.run(r, this.filterType); }
      L[idx] += l * g; R[idx] += r * g;
    } else {
      let s = 0;
      for (let u = 0; u < this.unison; u++) {
        let v = this.osc1[u].next(this.f1[u]);
        if (mix2 > 0) v = v * (1 - mix2 * 0.5) + this.osc2[u].next(this.f2[u]) * mix2;
        s += v;
      }
      s *= this.norm;
      if (this.sub) s += this.sub.next(this.fsub) * this.p.sub;
      if (this.noise) s += this.noise.next() * this.p.noise;
      if (this.useFilter) s = this.svfL.run(s, this.filterType);
      s *= g;
      L[idx] += s; R[idx] += s;
    }
  }
}

/* -------------------------------------------------------------------- fm */

export class FMVoice extends Voice {
  constructor(inst, sr, ctl) {
    super(inst, sr, ctl);
    const p = inst.params || {};
    this.p = p;
    this.phC = 0; this.phM = 0; this.prevMod = 0;
    this.menv = new ADSR(sr, { attack: 0.001, decay: 0.3, sustain: 0, release: 0.2, ...(p.modEnv || {}) });
    this.carrierTri = p.carrierWave === 'triangle';
  }
  noteOn(midi, vel, o) { super.noteOn(midi, vel, o); this.menv.trigger(!o?.legato); this.phC = 0; this.phM = 0; }
  noteOff() { super.noteOff(); this.menv.gate(false); }
  prepareBlock() {
    const f = toFreq(this.midiNow());
    this.incC = f / this.sr;
    this.incM = f * (this.p.ratio ?? 2) / this.sr;
  }
  sampleInto(L, R, idx, g) {
    const index = (this.p.index ?? 2) + (this.p.modEnvAmount ?? 0) * this.menv.next() + this.accent * 1.5;
    const fb = (this.p.feedback || 0) * 0.9;
    const mod = Math.sin(TWO_PI * this.phM + fb * this.prevMod);
    this.prevMod = mod;
    const ph = TWO_PI * this.phC + index * mod;
    let s = this.carrierTri ? (2 / Math.PI) * Math.asin(Math.sin(ph)) : Math.sin(ph);
    this.phC += this.incC; if (this.phC >= 1) this.phC -= 1;
    this.phM += this.incM; if (this.phM >= 1) this.phM -= 1;
    if (this.useFilter) s = this.svfL.run(s, this.filterType);
    s *= g;
    L[idx] += s; R[idx] += s;
  }
}

/* ------------------------------------------------------------------ kick */

export class KickVoice extends Voice {
  constructor(inst, sr, ctl) {
    super(inst, sr, ctl);
    const p = inst.params || {};
    this.p = p;
    this.ph = 0;
    this.t = 0;
    this.click = new OnePole(sr, 3000);
    if (!inst.amp) this.amp.set({ attack: 0.0005, decay: p.body ?? 0.4, sustain: 0, release: 0.02 });
  }
  noteOn(midi, vel, o) {
    super.noteOn(midi, vel, o);
    this.ph = 0; this.t = 0;
  }
  sampleInto(L, R, idx, g) {
    const p = this.p;
    const start = p.pitchStart ?? 160, end = p.pitchEnd ?? 50, dec = Math.max(0.005, p.pitchDecay ?? 0.05);
    const t = this.t;
    const f = (end + (start - end) * Math.exp(-t / dec)) * Math.pow(2, (this.midiNow() - 60) / 12 * 0.0);
    this.ph += f / this.sr; if (this.ph >= 1) this.ph -= 1;
    let s = Math.sin(TWO_PI * this.ph);
    const tone = p.tone || 0;
    if (tone > 0) { const d = 1 + tone * 8; s = Math.tanh(s * d) / Math.tanh(d); }
    if (p.click && t < 0.004) {
      const n = (Math.random() * 2 - 1) * (1 - t / 0.004);
      s += this.click.hp(n) * p.click * 1.5;
    }
    this.t += 1 / this.sr;
    if (this.useFilter) s = this.svfL.run(s, this.filterType);
    s *= g;
    L[idx] += s; R[idx] += s;
  }
}

/* ------------------------------------------------------------------ clap */

export class ClapVoice extends Voice {
  constructor(inst, sr, ctl) {
    super(inst, sr, ctl);
    const p = inst.params || {};
    this.p = p;
    this.bpL = new SVF(sr); this.bpR = new SVF(sr);
    const hz = 400 * Math.pow(10, (p.tone ?? 0.5));
    this.bpL.set(hz, 0.6); this.bpR.set(hz * 1.03, 0.6);
    this.t = 0;
    this.stereo = true;
    this.useFilter = this.useFilter && !!inst.filter?.cutoff;
    if (!inst.amp) this.amp.set({ attack: 0.0005, decay: 1.5, sustain: 0, release: 0.01 });
  }
  noteOn(midi, vel, o) { super.noteOn(midi, vel, o); this.t = 0; }
  sampleInto(L, R, idx, g) {
    const p = this.p;
    const bursts = p.bursts ?? 3, spacing = p.spacing ?? 0.011, tail = p.tail ?? 0.15;
    const t = this.t;
    let env;
    const burstIdx = Math.floor(t / spacing);
    if (burstIdx < bursts - 1) env = Math.exp(-(t - burstIdx * spacing) / 0.006);
    else env = Math.exp(-(t - (bursts - 1) * spacing) / (tail * 0.35));
    const w = p.width ?? 0.3;
    const n1 = Math.random() * 2 - 1, n2 = Math.random() * 2 - 1;
    let l = this.bpL.bp(n1), r = this.bpR.bp(n1 * (1 - w) + n2 * w);
    l *= env * g * 2; r *= env * g * 2;
    if (this.useFilter) { l = this.svfL.run(l, this.filterType); r = this.svfR.run(r, this.filterType); }
    this.t += 1 / this.sr;
    L[idx] += l; R[idx] += r;
    if (env < 1e-4 && burstIdx >= bursts - 1) this.amp.gate(false);
  }
}

/* ----------------------------------------------------------------- hihat */

const HAT_RATIOS = [1, 1.4826, 1.8, 2.546, 2.63, 3.897]; // from the 808's six square oscillators

export class HihatVoice extends Voice {
  constructor(inst, sr, ctl) {
    super(inst, sr, ctl);
    const p = inst.params || {};
    this.p = p;
    this.oscs = HAT_RATIOS.map(() => new Osc(sr, 'square', Math.random()));
    this.hp = new SVF(sr);
    this.hp.set(2500 * Math.pow(4.8, p.tone ?? 0.6), 0.2);
    this.bp = new SVF(sr);
    this.bp.set(7000, 0.3);
    this.t = 0;
    this.decay = p.decay ?? (p.open ? 0.35 : 0.06);
    this.useFilter = this.useFilter && !!inst.filter?.cutoff;
    if (!inst.amp) this.amp.set({ attack: 0.0003, decay: 2, sustain: 0, release: 0.004 });
  }
  noteOn(midi, vel, o) { super.noteOn(midi, vel, o); this.t = 0; }
  sampleInto(L, R, idx, g) {
    const p = this.p;
    const metallic = p.metallic ?? 0.5;
    let m = 0;
    const base = 320 * Math.pow(2, (this.midiNow() - 60) / 12 * 0.0);
    for (let i = 0; i < 6; i++) m += this.oscs[i].next(base * HAT_RATIOS[i]);
    m = this.bp.bp(m / 6) * 2.5;
    const n = Math.random() * 2 - 1;
    let s = m * metallic + n * (1 - metallic);
    s = this.hp.hp(s);
    const env = Math.exp(-this.t / (this.decay * 0.33));
    this.t += 1 / this.sr;
    s *= env * g * 3.2;
    if (this.useFilter) s = this.svfL.run(s, this.filterType);
    L[idx] += s; R[idx] += s;
    if (env < 2e-4) this.amp.gate(false);
  }
}

/* ----------------------------------------------------------------- noise */

export class NoiseVoice extends Voice {
  constructor(inst, sr, ctl) {
    super(inst, sr, ctl);
    const p = inst.params || {};
    this.nL = new Noise(p.color || 'white');
    this.nR = p.stereo ? new Noise(p.color || 'white') : null;
    this.stereo = !!p.stereo;
  }
  sampleInto(L, R, idx, g) {
    let l = this.nL.next() * 2.5;
    let r = this.nR ? this.nR.next() * 2.5 : l;
    if (this.useFilter) { l = this.svfL.run(l, this.filterType); r = this.nR ? this.svfR.run(r, this.filterType) : l; }
    L[idx] += l * g; R[idx] += r * g;
  }
}

export const ENGINES = {
  analog: AnalogVoice,
  fm: FMVoice,
  kick: KickVoice,
  clap: ClapVoice,
  hihat: HihatVoice,
  noise: NoiseVoice,
};

export function createVoice(inst, sampleRate, ctl) {
  const E = ENGINES[inst.engine];
  if (!E) throw new Error(`unknown engine: ${inst.engine}`);
  return new E(inst, sampleRate, ctl);
}
