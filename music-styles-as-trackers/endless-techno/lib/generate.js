/**
 * Style + seed -> fixed song.
 *
 * The song is built one section at a time. Each present layer gets a chain of
 * `bars` phrases produced by its generator; identical phrases and chains are
 * interned so repetitive music stays small. Mutations accumulate per layer, so
 * a layer that re-enters later has drifted. Fills touch the last bar, and
 * automation writes parameter moves into the first step of each bar.
 */
import { Random, modeIntervals, checkStyleReferences, checkSongReferences } from '../../format/lib/core.js';
import { makeGenerator } from './generators.js';
import { mutate, fillSteps } from './mutate.js';
import { planSections, chooseLayers } from './arrange.js';

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

/**
 * @param {object} style tracker-style/0.1
 * @param {{seed?: number, minutes?: number, title?: string}} [opts]
 * @returns {object} tracker-song/0.1
 */
export function generateSong(style, opts = {}) {
  if (style.format !== 'tracker-style/0.1') throw new Error(`not a tracker-style/0.1 document: ${style.format}`);
  const styleProblems = checkStyleReferences(style);
  if (styleProblems.length) throw new Error(`style has broken references:\n  ${styleProblems.join('\n  ')}`);
  const seed = opts.seed ?? 1;
  const rnd = new Random(seed);
  const stepsPerBeat = style.transport.stepsPerBeat ?? 4;
  const phraseLength = style.transport.phraseLength ?? 16;
  const bpm = Math.round(rnd.range(style.transport.bpm) * 10) / 10;
  const swing = Math.round((rnd.range(style.transport.swing ?? 0) || 0) * 1000) / 1000;
  rnd.bpm = bpm;

  const root = rnd.choice(style.scale?.root ?? 'A');
  let mode = style.scale?.mode ?? 'minor';
  if (Array.isArray(mode) && typeof mode[0] === 'string') mode = rnd.pick(mode);
  const intervals = modeIntervals(mode);
  const ctx = { root, intervals, phraseLength, stepsPerBeat, modeName: typeof mode === 'string' ? mode : 'custom' };

  // Sound half, with per-seed variations.
  const sound = structuredClone(style.sound);
  for (const [instId, paths] of Object.entries(style.variations || {})) {
    for (const [path, range] of Object.entries(paths)) {
      const v = rnd.range(range);
      setPath(sound.instruments[instId], path, Math.round(v * 1000) / 1000);
    }
  }

  const minutes = opts.minutes ?? rnd.range(style.arrangement.minutes ?? 5);
  const sections = planSections(style, rnd, minutes);
  const present = chooseLayers(style, sections, rnd);

  const phrases = {};
  const phraseIndex = new Map(); // JSON -> id
  const chains = {};
  const chainIndex = new Map();
  const tracks = [];
  const trackIndex = new Map();
  const counters = {};
  const nextId = (prefix) => { counters[prefix] = (counters[prefix] || 0) + 1; return `${prefix}${counters[prefix]}`; };

  const internPhrase = (layerId, steps) => {
    const key = JSON.stringify(steps);
    if (phraseIndex.has(key)) return phraseIndex.get(key);
    const id = nextId(`${layerId}_`);
    phrases[id] = { steps };
    phraseIndex.set(key, id);
    return id;
  };
  const internChain = (layerId, rows) => {
    const key = JSON.stringify(rows);
    if (chainIndex.has(key)) return chainIndex.get(key);
    const id = nextId(`${layerId}_c`);
    chains[id] = { rows };
    chainIndex.set(key, id);
    return id;
  };
  const ensureTrack = (id, instrument) => {
    if (!trackIndex.has(id)) { trackIndex.set(id, tracks.length); tracks.push({ id, instrument }); }
    return tracks[trackIndex.get(id)];
  };

  const states = new Map();
  const stateOf = (layer) => {
    if (states.has(layer.id)) return states.get(layer.id);
    const lrnd = rnd.fork(layer.id);
    const variants = Math.max(1, lrnd.range(layer.variants ?? 2, true));
    const gens = Array.from({ length: variants }, (_, i) => makeGenerator(layer.generator, lrnd.fork(`v${i}`), ctx));
    const st = { lrnd, gens, period: periodOf(layer.generator, phraseLength), memo: new Map(), mutations: [], lastSection: -1 };
    states.set(layer.id, st);
    return st;
  };

  const barSteps = (layer, st, vi, bar) => {
    const key = `${vi}:${bar % st.period}`;
    if (!st.memo.has(key)) st.memo.set(key, st.gens[vi](bar % st.period));
    let steps = st.memo.get(key);
    const isChord = Array.isArray(steps[0]);
    const apply = (s) => {
      let out = s;
      for (const seed of st.mutations) out = mutate(out, new Random(seed), ctx, style.mutation || {});
      return out;
    };
    return isChord ? steps.map(apply) : apply(steps);
  };

  const rows = [];
  const sectionMeta = [];
  let prevSec = null;
  sections.forEach((sec, si) => {
    const row = {};
    for (const layer of style.layers) {
      if (!present[si].has(layer.id)) continue;
      const st = stateOf(layer);
      const m = layer.mutable === false ? null : style.mutation;
      if (m && st.lastSection >= 0 && st.lastSection !== si - 1 + 0 && rnd.chance(m.chance ?? 0)) st.mutations.push(rnd.int(1, 2 ** 31));
      else if (m && st.lastSection === si - 1 && rnd.chance((m.chance ?? 0) * 0.5)) st.mutations.push(rnd.int(1, 2 ** 31));
      if (st.mutations.length > 4) st.mutations.shift();
      st.lastSection = si;

      const bars = Math.max(1, Math.min(sec.bars, layer.chainBars ? rnd.range(layer.chainBars, true) : sec.bars));
      const doFill = layer.fill && rnd.chance(layer.fill.chance ?? 0.5) && bars === sec.bars && sec.kind !== 'outro';
      let autos = (layer.automation || []).filter((a) => autoApplies(a.when, sec, prevSec)).map((a) => ({ ...a, from: rnd.range(a.from), to: rnd.range(a.to) }));
      // Track commands persist, so a layer with automation resets to its instrument's own value when none applies.
      if (layer.automation && !autos.length) {
        const inst = sound.instruments[layer.instrument];
        const base = (p) => (p === 'cutoff' || p === 'resonance' ? inst.filter?.[p] : inst.mix?.[p]);
        autos = layer.automation.filter((a) => base(a.param) !== undefined).map((a) => ({ param: a.param, from: base(a.param), to: base(a.param) }));
        autos = autos.filter((a, i) => autos.findIndex((b) => b.param === a.param) === i);
      }
      const pointEvery = Math.max(1, Math.floor(bars / 4));
      const voiceRows = [];
      for (let b = 0; b < bars; b++) {
        const vi = st.gens.length > 1 && b % 4 === 3 && rnd.chance(0.5) ? 1 + ((b >> 2) % (st.gens.length - 1)) : 0;
        let steps = barSteps(layer, st, vi, b);
        const perVoice = Array.isArray(steps[0]) ? steps : [steps];
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
          const trackId = perVoice.length > 1 ? `${layer.track}${v + 1}` : layer.track;
          const track = ensureTrack(trackId, layer.instrument);
          if (track.instrument !== layer.instrument) s = s.map((x) => (x && x.note !== undefined && x.note !== 'OFF' ? { ...x, inst: layer.instrument } : x));
          (voiceRows[v] ||= []).push({ phrase: internPhrase(layer.id, s) });
        });
      }
      voiceRows.forEach((vr, v) => {
        const trackId = voiceRows.length > 1 ? `${layer.track}${v + 1}` : layer.track;
        if (layer.voices && v >= layer.voices) return;
        row[trackId] = internChain(layer.id, vr);
      });
    }
    if (Object.keys(row).length === 0) {
      // A silent section still needs a length: hold it with an empty chain on the first track.
      const t = tracks[0] || ensureTrack(style.layers[0].track, style.layers[0].instrument);
      const empty = internPhrase('rest', Array(phraseLength).fill(null));
      row[t.id] = internChain('rest', Array(sec.bars).fill({ phrase: empty }));
    }
    rows.push(row);
    sectionMeta.push({ row: si, name: sec.kind, energy: Math.round(sec.energy * 100) / 100 });
    prevSec = sec;
  });

  const song = {
    format: 'tracker-song/0.1',
    meta: {
      title: opts.title ?? `${style.meta?.title ?? style.id} ${seed}`,
      style: style.id,
      seed,
      generator: VERSION,
      created: new Date().toISOString(),
      notes: `${Math.round(minutes * 10) / 10} min, ${bpm} bpm, ${root} ${ctx.modeName}, ${sections.length} sections`,
    },
    transport: { bpm, stepsPerBeat, phraseLength, swing },
    sound,
    composition: { tracks, phrases, chains, song: { rows, sections: sectionMeta } },
  };
  const problems = checkSongReferences(song);
  if (problems.length) throw new Error(`generator produced an invalid song:\n  ${problems.slice(0, 10).join('\n  ')}`);
  return song;
}

export { VERSION };
