/**
 * Style + seed -> song, one section at a time.
 *
 * A Session holds everything that persists while a style plays: the seeded
 * random stream, the scale, the varied sound half, the phrase and chain pools,
 * and each layer's generators and accumulated mutations. `generateSong` runs a
 * session over a planned arrangement and assembles a fixed song. An endless
 * run calls `session.next()` forever: it plans arcs lazily, and the caller
 * (the streaming player) gets a new row each time.
 */
import { Random, modeIntervals, checkStyleReferences, checkSongReferences } from '../../format/lib/core.js';
import { makeGenerator } from './generators.js';
import { mutate, fillSteps } from './mutate.js';
import { planSections, chooseLayersFor } from './arrange.js';

const VERSION = 'endless-techno/0.1';

function gcd(a, b) { return b ? gcd(b, a % b) : a; }
function lcm(a, b) { return (a * b) / gcd(a, b); }

/** Bars until a generator's output repeats, used to memoise bars. */
function periodOf(spec, pl) {
  switch (spec.type) {
    case 'pattern': return Math.min(8, lcm(Math.max(...spec.patterns.map((p) => p.length)), pl) / pl);
    case 'euclid': {
      const len = typeof spec.length === 'number' ? spec.length : Array.isArray(spec.length) ? spec.length[1] : pl;
      return Math.min(8, lcm(len, pl) / pl);
    }
    case 'chords': {
      const bpc = typeof spec.barsPerChord === 'number' ? spec.barsPerChord : Array.isArray(spec.barsPerChord) ? spec.barsPerChord[1] : 4;
      return spec.progression.length * bpc;
    }
    default: return 4;
  }
}

function setPath(obj, path, value) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) { if (o[parts[i]] === undefined) o[parts[i]] = {}; o = o[parts[i]]; }
  o[parts[parts.length - 1]] = value;
}

function autoApplies(when, sec, prev) {
  switch (when ?? 'rising') {
    case 'always': return true;
    case 'build': return sec.kind === 'build';
    case 'breakdown': return sec.kind === 'breakdown';
    case 'peak': return sec.kind === 'drop' || sec.energy >= 0.85;
    case 'rising': return prev ? sec.energy > prev.energy + 0.05 : false;
    case 'falling': return prev ? sec.energy < prev.energy - 0.05 : false;
    default: return false;
  }
}

export class Session {
  /**
   * @param {object} style tracker-style/0.1
   * @param {{seed?: number}} [opts]
   */
  constructor(style, opts = {}) {
    if (style.format !== 'tracker-style/0.1') throw new Error(`not a tracker-style/0.1 document: ${style.format}`);
    const styleProblems = checkStyleReferences(style);
    if (styleProblems.length) throw new Error(`style has broken references:\n  ${styleProblems.join('\n  ')}`);
    this.style = style;
    this.seed = opts.seed ?? 1;
    const rnd = (this.rnd = new Random(this.seed));
    this.stepsPerBeat = style.transport.stepsPerBeat ?? 4;
    this.phraseLength = style.transport.phraseLength ?? 16;
    this.bpm = Math.round(rnd.range(style.transport.bpm) * 10) / 10;
    this.swing = Math.round((rnd.range(style.transport.swing ?? 0) || 0) * 1000) / 1000;
    rnd.bpm = this.bpm;

    const root = rnd.choice(style.scale?.root ?? 'A');
    let mode = style.scale?.mode ?? 'minor';
    if (Array.isArray(mode) && typeof mode[0] === 'string') mode = rnd.pick(mode);
    this.ctx = { root, intervals: modeIntervals(mode), phraseLength: this.phraseLength, stepsPerBeat: this.stepsPerBeat, modeName: typeof mode === 'string' ? mode : 'custom' };

    // Sound half, with per-seed variations.
    this.sound = structuredClone(style.sound);
    for (const [instId, paths] of Object.entries(style.variations || {})) {
      for (const [path, range] of Object.entries(paths)) {
        setPath(this.sound.instruments[instId], path, Math.round(rnd.range(range) * 1000) / 1000);
      }
    }

    this.phrases = {};
    this.chains = {};
    this.tracks = [];
    this.trackIndex = new Map();
    this.phraseIndex = new Map();
    this.chainIndex = new Map();
    this.counters = {};
    this.states = new Map();
    this.rows = [];
    this.sectionMeta = [];
    this.prevSec = null;
    this.present = new Set();
    this.queue = [];        // planned sections not yet written
    this.arcs = 0;
    this.newPhraseIds = [];
    this.newChainIds = [];
  }

  get transport() { return { bpm: this.bpm, stepsPerBeat: this.stepsPerBeat, phraseLength: this.phraseLength, swing: this.swing }; }

  nextId(prefix) { this.counters[prefix] = (this.counters[prefix] || 0) + 1; return `${prefix}${this.counters[prefix]}`; }

  internPhrase(prefix, steps) {
    const key = JSON.stringify(steps);
    if (this.phraseIndex.has(key)) return this.phraseIndex.get(key);
    const id = this.nextId(`${prefix}_`);
    this.phrases[id] = { steps };
    this.phraseIndex.set(key, id);
    this.newPhraseIds.push(id);
    return id;
  }

  internChain(prefix, rows) {
    const key = JSON.stringify(rows);
    if (this.chainIndex.has(key)) return this.chainIndex.get(key);
    const id = this.nextId(`${prefix}_c`);
    this.chains[id] = { rows };
    this.chainIndex.set(key, id);
    this.newChainIds.push(id);
    return id;
  }

  ensureTrack(id, instrument) {
    if (!this.trackIndex.has(id)) { this.trackIndex.set(id, this.tracks.length); this.tracks.push({ id, instrument }); }
    return this.tracks[this.trackIndex.get(id)];
  }

  stateOf(layer) {
    if (this.states.has(layer.id)) return this.states.get(layer.id);
    const lrnd = this.rnd.fork(layer.id);
    const variants = Math.max(1, lrnd.range(layer.variants ?? 2, true));
    const gens = Array.from({ length: variants }, (_, i) => makeGenerator(layer.generator, lrnd.fork(`v${i}`), this.ctx));
    const st = { lrnd, gens, period: periodOf(layer.generator, this.phraseLength), memo: new Map(), mutations: [], lastSection: -1 };
    this.states.set(layer.id, st);
    return st;
  }

  barSteps(st, vi, bar) {
    const key = `${vi}:${bar % st.period}`;
    if (!st.memo.has(key)) st.memo.set(key, st.gens[vi](bar % st.period));
    const steps = st.memo.get(key);
    const apply = (s) => {
      let out = s;
      for (const seed of st.mutations) out = mutate(out, new Random(seed), this.ctx, this.style.mutation || {});
      return out;
    };
    return Array.isArray(steps[0]) ? steps.map(apply) : apply(steps);
  }

  /** Write one section as a song row. Returns {row, meta}. */
  writeSection(sec, si, present) {
    const { style, rnd, ctx, sound, tracks } = this;
    const row = {};
    const pending = {};
    for (const layer of style.layers) {
      if (!present.has(layer.id)) continue;
      const st = this.stateOf(layer);
      const m = layer.mutable === false ? null : style.mutation;
      if (m && st.lastSection >= 0 && st.lastSection !== si - 1 && rnd.chance(m.chance ?? 0)) st.mutations.push(rnd.int(1, 2 ** 31));
      else if (m && st.lastSection === si - 1 && rnd.chance((m.chance ?? 0) * 0.5)) st.mutations.push(rnd.int(1, 2 ** 31));
      if (st.mutations.length > 4) st.mutations.shift();
      st.lastSection = si;

      const bars = Math.max(1, Math.min(sec.bars, layer.chainBars ? rnd.range(layer.chainBars, true) : sec.bars));
      const doFill = layer.fill && rnd.chance(layer.fill.chance ?? 0.5) && bars === sec.bars && sec.kind !== 'outro';
      let autos = (layer.automation || []).filter((a) => autoApplies(a.when, sec, this.prevSec)).map((a) => ({ ...a, from: rnd.range(a.from), to: rnd.range(a.to) }));
      // Track commands persist, so a layer with automation resets to its instrument's own value when none applies.
      if (layer.automation && !autos.length) {
        const inst = sound.instruments[layer.instrument];
        const base = (p) => (p === 'cutoff' || p === 'resonance' ? inst.filter?.[p] : inst.mix?.[p]);
        autos = layer.automation.filter((a) => base(a.param) !== undefined).map((a) => ({ param: a.param, from: base(a.param), to: base(a.param) }));
        autos = autos.filter((a, i) => autos.findIndex((b) => b.param === a.param) === i);
      }
      const pointEvery = Math.max(1, Math.floor(bars / 4));
      const voiceBars = [];
      for (let b = 0; b < bars; b++) {
        const vi = st.gens.length > 1 && b % 4 === 3 && rnd.chance(0.5) ? 1 + ((b >> 2) % (st.gens.length - 1)) : 0;
        const steps = this.barSteps(st, vi, b);
        const perVoice = (Array.isArray(steps[0]) ? steps : [steps]).slice(0, layer.voices ?? Infinity);
        perVoice.forEach((voiceSteps, v) => {
          let s = voiceSteps.slice();
          if (doFill && b === bars - 1) s = fillSteps(s, rnd, layer.fill, ctx);
          if (autos.length && b % pointEvery === 0) {
            const t = bars > 1 ? b / (bars - 1) : 1;
            const fx = {};
            for (const a of autos) {
              const tt = a.curve === 'exp' ? t * t : t;
              fx[a.param] = Math.round((a.from + (a.to - a.from) * tt) * 1000) / 1000;
            }
            s[0] = s[0] ? { ...s[0], fx: { ...(s[0].fx || {}), ...fx } } : { fx };
          }
          (voiceBars[v] ||= []).push(s);
        });
      }
      voiceBars.forEach((vb, v) => {
        const trackId = voiceBars.length > 1 ? `${layer.track}${v + 1}` : layer.track;
        this.ensureTrack(trackId, layer.instrument);
        (pending[trackId] ||= []).push({ layer, bars: vb });
      });
    }
    // One chain per track. Layers that share a track are merged bar by bar:
    // the earlier layer's steps win, the later layer fills the empty steps.
    for (const [trackId, entries] of Object.entries(pending)) {
      const track = tracks[this.trackIndex.get(trackId)];
      const len = Math.max(...entries.map((e) => e.bars.length));
      const chainRows = [];
      for (let b = 0; b < len; b++) {
        let merged = null;
        for (const { layer, bars: lb } of entries) {
          let src = lb[b % lb.length];
          if (track.instrument !== layer.instrument) src = src.map((x) => (x && x.note !== undefined && x.note !== 'OFF' ? { ...x, inst: layer.instrument } : x));
          if (!merged) { merged = src.slice(); continue; }
          for (let i = 0; i < merged.length; i++) if (!merged[i] && src[i]) merged[i] = src[i];
        }
        chainRows.push({ phrase: this.internPhrase(entries.map((e) => e.layer.id).join('_'), merged) });
      }
      row[trackId] = this.internChain(entries.map((e) => e.layer.id).join('_'), chainRows);
    }
    if (Object.keys(row).length === 0) {
      // A silent section still needs a length: hold it with an empty chain on the first track.
      const t = tracks[0] || this.ensureTrack(style.layers[0].track, style.layers[0].instrument);
      const empty = this.internPhrase('rest', Array(this.phraseLength).fill(null));
      row[t.id] = this.internChain('rest', Array(sec.bars).fill({ phrase: empty }));
    }
    const meta = { row: si, name: sec.kind, energy: Math.round(sec.energy * 100) / 100 };
    this.rows.push(row);
    this.sectionMeta.push(meta);
    this.prevSec = sec;
    return { row, meta };
  }

  /**
   * Endless mode: write the next section, planning a new arc when the queue
   * runs out. `opts.energy` nudges the planned energy of this section (for a
   * live "more" or "less" control).
   * @returns {{row: object, section: {kind:string, bars:number, energy:number}, index: number, tracks: object[], phrases: object, chains: object}}
   */
  next(opts = {}) {
    if (!this.queue.length) {
      const arcStyle = this.arcs === 0 ? this.style : { ...this.style, arrangement: { ...this.style.arrangement, intro: undefined, outro: undefined } };
      const planned = planSections(arcStyle, this.rnd, 4);
      this.queue.push(...(this.arcs === 0 ? planned.filter((s) => s.kind !== 'outro') : planned));
      this.arcs++;
    }
    const sec = { ...this.queue.shift() };
    if (opts.energy) {
      const { min = 0.1, max = 1 } = this.style.arrangement.energy || {};
      sec.energy = Math.round(Math.max(min, Math.min(max, sec.energy + opts.energy)) * 100) / 100;
      if (sec.kind === 'breakdown' && sec.energy > 0.5) sec.kind = 'groove';
    }
    const si = this.rows.length;
    this.present = chooseLayersFor(this.style, sec, this.present, this.prevSec, this.rnd, si === 0);
    this.newPhraseIds = []; this.newChainIds = [];
    const { row, meta } = this.writeSection(sec, si, this.present);
    const phrases = Object.fromEntries(this.newPhraseIds.map((id) => [id, this.phrases[id]]));
    const chains = Object.fromEntries(this.newChainIds.map((id) => [id, this.chains[id]]));
    return { row, section: { kind: sec.kind, bars: sec.bars, energy: meta.energy }, index: si, tracks: this.tracks.slice(), phrases, chains };
  }

  /** The song header a streaming player needs before the first row. */
  header(title) {
    return {
      format: 'tracker-song/0.1',
      meta: { title: title ?? `${this.style.meta?.title ?? this.style.id} ${this.seed}`, style: this.style.id, seed: this.seed, generator: VERSION },
      transport: this.transport,
      sound: this.sound,
      composition: { tracks: this.tracks.slice(), phrases: {}, chains: {}, song: { rows: [] } },
    };
  }

  /** Assemble everything written so far into a fixed song. */
  toSong(opts = {}) {
    const song = {
      ...this.header(opts.title),
      meta: {
        title: opts.title ?? `${this.style.meta?.title ?? this.style.id} ${this.seed}`,
        style: this.style.id,
        seed: this.seed,
        generator: VERSION,
        created: new Date().toISOString(),
        notes: `${opts.minutes !== undefined ? Math.round(opts.minutes * 10) / 10 + ' min, ' : ''}${this.bpm} bpm, ${this.ctx.root} ${this.ctx.modeName}, ${this.rows.length} sections`,
      },
      composition: { tracks: this.tracks.slice(), phrases: this.phrases, chains: this.chains, song: { rows: this.rows.slice(), sections: this.sectionMeta.slice() } },
    };
    const problems = checkSongReferences(song);
    if (problems.length) throw new Error(`generator produced an invalid song:\n  ${problems.slice(0, 10).join('\n  ')}`);
    return song;
  }
}

/**
 * @param {object} style tracker-style/0.1
 * @param {{seed?: number, minutes?: number, title?: string}} [opts]
 * @returns {object} tracker-song/0.1
 */
export function generateSong(style, opts = {}) {
  const session = new Session(style, { seed: opts.seed ?? 1 });
  const minutes = opts.minutes ?? session.rnd.range(style.arrangement.minutes ?? 5);
  const sections = planSections(style, session.rnd, minutes);
  let present = new Set();
  sections.forEach((sec, si) => {
    present = chooseLayersFor(style, sec, present, si > 0 ? sections[si - 1] : null, session.rnd, si === 0);
    session.writeSection(sec, si, present);
  });
  return session.toSong({ title: opts.title, minutes });
}

export { VERSION };
