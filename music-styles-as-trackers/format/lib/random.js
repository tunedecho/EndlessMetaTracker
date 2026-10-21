/**
 * Seeded random numbers, so a style and a seed always give the same song.
 * Uses the mulberry32 generator: small, fast, good enough for music.
 */
export class Random {
  constructor(seed = 1) {
    this.seed = seed >>> 0;
    this.state = this.seed || 0x9e3779b9;
  }

  /** Uniform float in [0, 1). */
  next() {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  float(min, max) { return min + (max - min) * this.next(); }

  /** Integer in [min, max] inclusive. */
  int(min, max) { return Math.floor(this.float(min, max + 1)); }

  /** True with probability p. */
  chance(p) { return this.next() < p; }

  /** One element of an array. */
  pick(arr) {
    if (!arr.length) throw new Error('pick from empty array');
    return arr[this.int(0, arr.length - 1)];
  }

  /** One element, by weights: items as [value, weight]. */
  weighted(pairs) {
    const total = pairs.reduce((s, [, w]) => s + w, 0);
    let r = this.next() * total;
    for (const [v, w] of pairs) { r -= w; if (r < 0) return v; }
    return pairs[pairs.length - 1][0];
  }

  /** Fisher-Yates shuffle, returns a new array. */
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /**
   * Resolve a range spec from a style file: a number, or [min, max].
   * Integers stay integers when both bounds are integers and `int` is true.
   */
  range(spec, int = false) {
    if (spec === undefined || spec === null) return undefined;
    if (typeof spec === 'number') return spec;
    if (Array.isArray(spec) && spec.length === 2 && typeof spec[0] === 'number') {
      return int ? this.int(spec[0], spec[1]) : this.float(spec[0], spec[1]);
    }
    throw new Error(`bad range: ${JSON.stringify(spec)}`);
  }

  /** Resolve a choice spec: a value, or a list to pick from. */
  choice(spec) {
    if (Array.isArray(spec)) return this.pick(spec);
    return spec;
  }

  /** A child generator with an independent stream, derived from this one. */
  fork(label = '') {
    let h = 2166136261 ^ this.seed;
    for (const c of String(label)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    h ^= Math.floor(this.next() * 0xffffffff);
    return new Random(h >>> 0);
  }
}

/** Hash a string to a 32-bit seed. */
export function seedFromString(s) {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
