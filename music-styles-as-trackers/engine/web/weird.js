/**
 * Weirdness macros: knobs that inject parameter locks, commands, and ghost
 * notes into a song. The original is never touched; `weird()` returns a new
 * song, so a player can flip between the two and bake the weird one when it
 * is worth keeping.
 *
 * Every choice comes from a hash of the seed and where it lands, not from a
 * running random stream, so turning a knob up only adds: the notes hit at 30%
 * are still hit, the same way, at 60%. A new seed rerolls everything.
 *
 * With `vary` on, each affected song row gets its own copy of every phrase it
 * plays, so repeats of a shared phrase come out different. Off, the macros
 * write into the shared phrases and every repeat gets the same weirdness.
 */
import { rowSteps, toMidi } from '../../format/lib/core.js';
import { leafParams, deref } from './params.js';

export const MACROS = {
  chaos: 'random parameter locks on random notes',
  drift: 'a few parameters per track wander slowly over time',
  glitch: 'retrigs, nudges, slides, and cuts',
  octaves: 'notes jump by octaves and fifths',
  space: 'delay and reverb throws',
  thin: 'notes play only by chance',
  ghosts: 'quiet extra notes in the gaps',
};

/** Parameters drift prefers, when the instrument has them: the ones that move a sound without breaking it. */
const DRIFTERS = ['filter.cutoff', 'filter.resonance', 'filter.envAmount', 'amp.decay', 'amp.release', 'mix.pan', 'mix.drive', 'mix.delaySend', 'params.detune2', 'params.pulseWidth', 'params.unisonDetune', 'params.index', 'params.ratio', 'params.feedback', 'params.tone', 'params.metallic', 'params.decay', 'params.pitchDecay', 'params.tail'];
const JUMPS = [12, -12, 12, 24, 7, -5, -12, 19];
const RETRIGS = [2, 3, 4, 6];

/** A stable number in [0, 1) for a string: FNV-1a with a final mix. */
export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Smooth noise in [0, 1] along steps: hashed knots every `period` steps, cosine-blended. */
function wander(key, step, period) {
  const k = Math.floor(step / period), f = step / period - k;
  const a = hash(`${key}|${k}`), b = hash(`${key}|${k + 1}`);
  const t = (1 - Math.cos(f * Math.PI)) / 2;
  return a + (b - a) * t;
}

/** Items ordered by a key computed once per item. */
const shuffled = (items, key) => items.map((x) => [key(x), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);

const getPath = (o, path) => path.reduce((v, k) => (v == null ? undefined : v[k]), o);

/** The parameters a macro may lock on an instrument: its engine's, the filter, envelope, LFO, and sends. */
function lockable(defs, engine) {
  const props = defs.instrument.properties;
  return [
    ...leafParams(defs, defs[`params.${engine}`], ['params']),
    ...leafParams(defs, props.filter, ['filter']),
    ...leafParams(defs, deref(defs, props.amp).node, ['amp']),
    ...leafParams(defs, props.lfo, ['lfo']).filter((p) => p.path[1] !== 'sync'),
    ...leafParams(defs, props.mix, ['mix']).filter((p) => p.path[1] !== 'volume'), // keep levels sane
  ];
}

/** A value for parameter `p`, moved from the instrument's own value toward `target` (0..1 of its range) by `amount`. */
function moved(p, inst, target, amount, pick) {
  const own = getPath(inst, p.path);
  if (p.kind === 'number') {
    const sc = p.scale;
    const from = p.norm(own ?? sc.rest);
    const n = Math.min(1, Math.max(0, from + (target - from) * amount));
    let v = sc.round(sc.from(n));
    v = Math.min(sc.hardMax, Math.max(sc.hardMin, v));
    if (p.exclusiveMinimum !== undefined && v <= p.exclusiveMinimum) return undefined;
    return v;
  }
  if (pick >= amount) return undefined; // switching a wave or a filter type is a big step: only at high depth
  const options = p.kind === 'bool' ? [true, false] : p.options;
  return options[Math.floor(target * options.length) % options.length];
}

/**
 * A weird copy of the song.
 * @param {object} song
 * @param {object} defs the song schema's $defs
 * @param {{seed?: number, amounts?: Record<string, number>, depth?: number, rows?: [number, number], tracks?: string[], vary?: boolean}} opts
 *   amounts: 0..1 per macro in MACROS; depth: how far locks move from the instrument (0..1);
 *   rows: [from, to) song rows to touch (default all); tracks: track ids to touch (default all)
 */
export function weird(song, defs, opts = {}) {
  const { seed = 1, amounts = {}, depth = 0.5, vary = true } = opts;
  const a = (k) => Math.max(0, Math.min(1, amounts[k] || 0));
  if (!Object.keys(MACROS).some((k) => a(k) > 0)) return song;
  const out = JSON.parse(JSON.stringify(song));
  const comp = out.composition;
  const pl = out.transport.phraseLength ?? 16;
  const [from, to] = opts.rows ?? [0, comp.song.rows.length];
  const only = opts.tracks ? new Set(opts.tracks) : null;
  const trackOf = new Map(comp.tracks.map((t) => [t.id, t]));
  const h = (...parts) => hash(`${seed}|${parts.join('|')}`);

  // Places to work on: one per phrase occurrence when varying, one per phrase otherwise.
  const places = [];
  const seen = new Set();
  const replaced = { chains: new Set(), phrases: new Set() };
  let start = 0;
  comp.song.rows.forEach((row, r) => {
    const len = rowSteps(song, song.composition.song.rows[r]);
    if (r >= from && r < to) {
      for (const [trackId, chainId] of Object.entries(row)) {
        if (!chainId || (only && !only.has(trackId))) continue;
        const chain = song.composition.chains[chainId];
        const bars = Math.ceil(len / pl);
        if (vary && bars <= 64) {
          const rows = [];
          for (let b = 0; b < bars; b++) {
            const cr = chain.rows[b % chain.rows.length];
            replaced.phrases.add(cr.phrase);
            const id = `${cr.phrase}.w${r}.${b}`;
            comp.phrases[id] = JSON.parse(JSON.stringify(song.composition.phrases[cr.phrase]));
            rows.push(cr.transpose ? { phrase: id, transpose: cr.transpose } : { phrase: id });
            places.push({ phrase: id, key: `${r}.${trackId}.${b}`, track: trackId, step: start + b * pl });
          }
          const cid = `${chainId}.w${r}`;
          comp.chains[cid] = { rows };
          row[trackId] = cid;
          replaced.chains.add(chainId);
        } else {
          for (const cr of chain.rows) {
            if (seen.has(cr.phrase)) continue;
            seen.add(cr.phrase);
            places.push({ phrase: cr.phrase, key: cr.phrase, track: trackId, step: start });
          }
        }
      }
    }
    start += len;
  });

  // Copies replaced some chains and phrases everywhere they played; drop those now unused.
  const usedChains = new Set(comp.song.rows.flatMap((row) => Object.values(row)));
  for (const id of replaced.chains) if (!usedChains.has(id)) delete comp.chains[id];
  const usedPhrases = new Set(Object.values(comp.chains).flatMap((c) => c.rows.map((x) => x.phrase)));
  for (const id of replaced.phrases) if (!usedPhrases.has(id)) delete comp.phrases[id];

  const drifting = new Map(); // track and engine -> the parameters drift moves, in order
  const cache = new Map();
  const paramsFor = (engine) => { if (!cache.has(engine)) cache.set(engine, lockable(defs, engine)); return cache.get(engine); };

  for (const place of places) {
    const steps = comp.phrases[place.phrase].steps;
    let prev = null;
    for (let s = 0; s < pl; s++) {
      const key = `${place.key}.${s}`;
      const cell = steps[s];
      const isNote = cell && cell.note !== undefined && cell.note !== 'OFF';
      if (!isNote) {
        // Ghosts: a quiet copy of the last note, in an empty step.
        if (!cell && prev && h('ghost', key) < a('ghosts') * 0.5) {
          steps[s] = { note: prev.note, vel: Number((0.12 + 0.25 * h('ghostvel', key)).toFixed(2)) };
          if (prev.inst) steps[s].inst = prev.inst;
        }
        if (cell?.note === 'OFF') prev = null;
        continue;
      }
      prev = cell;
      const instId = cell.inst ?? trackOf.get(place.track)?.instrument;
      const inst = out.sound.instruments[instId];
      if (!inst) continue;
      const params = paramsFor(inst.engine);
      const lock = {};
      const fx = { ...cell.fx };

      if (a('drift') > 0) {
        // The same few parameters on every note of a track, wandering with time.
        const pool = params.filter((p) => DRIFTERS.includes(p.path.join('.')));
        const list = pool.length ? pool : params.filter((p) => p.kind === 'number');
        const pickKey = `${place.track}|${inst.engine}`;
        if (!drifting.has(pickKey)) drifting.set(pickKey, shuffled(list, (p) => h('drift-pick', place.track, p.path.join('.'))));
        const chosen = drifting.get(pickKey).slice(0, 1 + Math.floor(a('drift') * 3));
        for (const p of chosen) {
          const name = p.path.join('.');
          const period = 16 * (1 + Math.floor(h('drift-period', place.track, name) * 6));
          const own = p.norm(getPath(inst, p.path) ?? p.scale?.rest ?? 0);
          const target = own + (wander(`${seed}|${place.track}|${name}`, place.step + s, period) - 0.5) * 2;
          const v = moved(p, inst, Math.min(1, Math.max(0, target)), Math.min(1, depth * 0.5 + a('drift') * 0.5), 0);
          if (v !== undefined) lock[name] = v;
        }
      }
      if (h('chaos', key) < a('chaos')) {
        const count = 1 + Math.floor(h('chaos-n', key) * (1 + a('chaos') * 4));
        const chosen = shuffled(params, (p) => h('chaos-pick', key, p.path.join('.'))).slice(0, count);
        for (const p of chosen) {
          const name = p.path.join('.');
          const v = moved(p, inst, h('chaos-v', key, name), depth, h('chaos-switch', key, name));
          if (v !== undefined) lock[name] = v;
        }
      }
      if (h('space', key) < a('space')) {
        lock['mix.delaySend'] = Number((0.4 + 0.6 * h('space-d', key)).toFixed(2));
        lock['mix.reverbSend'] = Number((0.5 + 0.5 * h('space-r', key)).toFixed(2));
      }
      if (h('octave', key) < a('octaves')) {
        const jump = JUMPS[Math.floor(h('octave-j', key) * JUMPS.length)];
        const base = inst.transpose || 0;
        const note = toMidi(cell.note);
        const t = Math.max(-48, Math.min(48, base + jump));
        if (note + t >= 0 && note + t <= 127) lock.transpose = t;
      }
      if (h('glitch', key) < a('glitch')) {
        const kind = Math.floor(h('glitch-k', key) * 4);
        const g = h('glitch-v', key);
        if (kind === 0) fx.retrig = RETRIGS[Math.floor(g * RETRIGS.length)];
        else if (kind === 1) fx.nudge = Number((0.2 + 0.5 * g).toFixed(2));
        else if (kind === 2) fx.slide = Number((0.3 + 0.6 * g).toFixed(2));
        else fx.cut = Number((0.2 + 0.5 * g).toFixed(2));
      }
      if (h('thin', key) < a('thin')) fx.chance = Number((0.25 + 0.5 * h('thin-c', key)).toFixed(2));

      // What the song already locks stays: the macros fill around it.
      if (Object.keys(lock).length) cell.lock = { ...lock, ...cell.lock };
      if (Object.keys(fx).length) cell.fx = fx;
    }
  }
  return out;
}
