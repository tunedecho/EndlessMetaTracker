/**
 * Generator primitives. Each takes its spec, a seeded Random, the musical
 * context (scale, phrase length) and returns a function `bar(index) -> steps`,
 * so patterns longer or shorter than a phrase can run across bars (polymeter)
 * and so a generator can be asked for the same phrase again.
 */
import { degreeToMidi, toMidi, toName } from '../../format/lib/core.js';

/**
 * Euclidean rhythm: k hits spread as evenly as possible over n steps.
 * Bresenham's line algorithm gives the same patterns as Bjorklund's, up to rotation.
 */
export function euclid(k, n) {
  const out = [];
  let prev = -1;
  for (let i = 0; i < n; i++) {
    const v = Math.floor((i * k) / n);
    out.push(k > 0 && v !== prev);
    prev = v;
  }
  return out;
}

/** Resolve a noteChoice to MIDI: a name, a scale degree, or a list. */
export function resolveNote(spec, rnd, ctx, octave) {
  const v = Array.isArray(spec) ? rnd.pick(spec) : spec;
  if (typeof v === 'number') return degreeToMidi(v, ctx.root, ctx.intervals, octave ?? 3);
  if (typeof v === 'string' && /^[A-Ga-g][#b]?-?[0-9]$/.test(v)) return toMidi(v);
  return toMidi('C3');
}

function hit(note, vel, fx) {
  const s = { note: toName(note) };
  if (vel !== undefined && vel < 1) s.vel = Math.round(vel * 100) / 100;
  if (fx && Object.keys(fx).length) s.fx = { ...fx };
  return s;
}

function velOf(rnd, spec, def = 1) { const v = rnd.range(spec); return v === undefined ? def : Math.max(0.05, Math.min(1, v)); }

/** Apply a gate: write OFF `gate` steps after each hit where the slot is empty. */
function applyGate(steps, gate) {
  if (!gate) return steps;
  const n = steps.length;
  for (let i = 0; i < n; i++) {
    if (!steps[i] || steps[i].note === undefined || steps[i].note === 'OFF') continue;
    const off = i + Math.max(1, Math.round(gate));
    if (off < n && !steps[off]) steps[off] = { note: 'OFF' };
  }
  return steps;
}

/** Characters of a pattern string to steps. */
function fromPattern(pat, offset, n, note, rnd, spec, fx) {
  const steps = Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const c = pat[(i + offset) % pat.length];
    if (c === '.') continue;
    const vel = c === 'X' ? 1 : c === 'o' ? velOf(rnd, spec.ghost, 0.4) : velOf(rnd, spec.velocity, 1);
    const f = { ...(fx || {}) };
    if (c === 'X') f.accent = 1;
    steps[i] = hit(note, vel, f);
  }
  return steps;
}

export const GENERATORS = {
  pattern(spec, rnd, ctx) {
    const pat = rnd.pick(spec.patterns);
    const note = resolveNote(spec.note ?? 'C3', rnd, ctx);
    const gate = rnd.range(spec.gate);
    const fn = (bar) => applyGate(fromPattern(pat, (bar * ctx.phraseLength) % pat.length, ctx.phraseLength, note, rnd, spec, spec.fx), gate);
    fn.period = Math.min(16, lcm(pat.length, ctx.phraseLength) / ctx.phraseLength);
    return fn;
  },

  euclid(spec, rnd, ctx) {
    const length = rnd.range(spec.length ?? ctx.phraseLength, true);
    const hits = Math.min(length, rnd.range(spec.hits, true));
    const rotate = rnd.range(spec.rotate ?? 0, true);
    const base = euclid(hits, length);
    const pat = base.map((_, i) => base[(i + rotate) % length]);
    const note = resolveNote(spec.note ?? 'C3', rnd, ctx);
    const accentEvery = rnd.range(spec.accentEvery, true);
    const gate = rnd.range(spec.gate);
    const fn = (bar) => {
      const steps = Array(ctx.phraseLength).fill(null);
      let hitIndex = 0;
      for (let i = 0; i < ctx.phraseLength; i++) {
        const idx = (bar * ctx.phraseLength + i) % length;
        if (!pat[idx]) continue;
        const accent = accentEvery && hitIndex % accentEvery === 0;
        steps[i] = hit(note, accent ? 1 : velOf(rnd, spec.velocity, 0.85), accent ? { ...(spec.fx || {}), accent: 1 } : spec.fx);
        hitIndex++;
      }
      return applyGate(steps, gate);
    };
    fn.period = Math.min(16, lcm(length, ctx.phraseLength) / ctx.phraseLength);
    return fn;
  },

  prob(spec, rnd, ctx) {
    const density = rnd.range(spec.density ?? 1);
    const note = resolveNote(spec.note ?? 'C3', rnd, ctx);
    const gate = rnd.range(spec.gate);
    return () => {
      const steps = Array(ctx.phraseLength).fill(null);
      for (let i = 0; i < ctx.phraseLength; i++) {
        const p = spec.steps[i % spec.steps.length] * density;
        if (rnd.chance(p)) steps[i] = hit(note, velOf(rnd, spec.velocity, 0.8) * (0.85 + 0.15 * Math.min(1, p)), spec.fx);
      }
      return applyGate(steps, gate);
    };
  },

  melodic(spec, rnd, ctx) {
    const octave = spec.octave ?? 2;
    const degrees = spec.degrees ?? [0];
    const weighted = degrees.map((d) => (Array.isArray(d) ? d : [d, 1]));
    const gate = rnd.range(spec.gate);
    let rhythmFn;
    if (typeof spec.rhythm === 'string' || Array.isArray(spec.rhythm)) {
      const pat = typeof spec.rhythm === 'string' ? spec.rhythm : rnd.pick(spec.rhythm);
      rhythmFn = (bar, i) => pat[(bar * ctx.phraseLength + i) % pat.length] !== '.';
    } else {
      const density = rnd.range(spec.rhythm.density);
      const onBeats = rnd.range(spec.rhythm.onBeats ?? 1);
      rhythmFn = (bar, i) => rnd.chance(Math.min(1, density * (i % ctx.stepsPerBeat === 0 ? onBeats : 1)));
    }
    let lastDeg = weighted[0][0];
    return (bar) => {
      const steps = Array(ctx.phraseLength).fill(null);
      let prev = null;
      for (let i = 0; i < ctx.phraseLength; i++) {
        if (!rhythmFn(bar, i)) continue;
        let deg;
        if (prev !== null && rnd.chance(spec.repeat ?? 0)) deg = lastDeg;
        else if (rnd.chance(spec.walk ?? 0)) {
          const idx = Math.max(0, weighted.findIndex(([d]) => d === lastDeg));
          const j = Math.max(0, Math.min(weighted.length - 1, idx + (rnd.chance(0.5) ? 1 : -1)));
          deg = weighted[j][0];
        } else deg = rnd.weighted(weighted);
        lastDeg = deg;
        let midi = degreeToMidi(deg, ctx.root, ctx.intervals, octave);
        if (rnd.chance(spec.octaveJump ?? 0)) midi += 12;
        const fx = { ...(spec.fx || {}) };
        if (prev !== null && rnd.chance(spec.slide ?? 0)) fx.slide = 0.6;
        if (rnd.chance(spec.accent ?? 0)) fx.accent = 1;
        steps[i] = hit(midi, velOf(rnd, spec.velocity, 0.9), fx);
        prev = midi;
      }
      return applyGate(steps, gate);
    };
  },

  /**
   * Chords return one step list per voice: `bar(index) -> steps[]` where each
   * entry is a voice. The caller writes each voice to its own track.
   */
  chords(spec, rnd, ctx) {
    const barsPerChord = Math.max(1, rnd.range(spec.barsPerChord ?? 4, true));
    const octave = spec.octave ?? 3;
    const rhythm = spec.rhythm || 'x' + '.'.repeat(ctx.phraseLength - 1);
    const gate = rnd.range(spec.gate);
    const strum = spec.strum || 0;
    const voices = Math.max(...spec.progression.map((c) => c.length));
    const fn = (bar) => {
      const chord = spec.progression[Math.floor(bar / barsPerChord) % spec.progression.length];
      const out = [];
      for (let v = 0; v < voices; v++) {
        const steps = Array(ctx.phraseLength).fill(null);
        const deg = chord[v % chord.length];
        for (let i = 0; i < ctx.phraseLength; i++) {
          if (rhythm[i % rhythm.length] === '.') continue;
          const fx = { ...(spec.fx || {}) };
          if (strum && v > 0) fx.nudge = Math.min(0.95, strum * v);
          steps[i] = hit(degreeToMidi(deg, ctx.root, ctx.intervals, octave), velOf(rnd, spec.velocity, 0.8), fx);
        }
        out.push(applyGate(steps, gate));
      }
      return out;
    };
    fn.period = spec.progression.length * barsPerChord;
    return fn;
  },
};

function gcd(a, b) { return b ? gcd(b, a % b) : a; }
const lcm = (a, b) => (a * b) / gcd(a, b);

/**
 * Build a generator: a function `bar(index) -> steps` with a `.period`
 * property, the number of bars after which its output repeats (so callers can
 * memoise bars and polymeter still runs across bars).
 */
export function makeGenerator(spec, rnd, ctx) {
  const g = GENERATORS[spec.type];
  if (!g) throw new Error(`unknown generator type: ${spec.type}`);
  const fn = g(spec, rnd, ctx);
  if (fn.period === undefined) fn.period = 4;
  return fn;
}
