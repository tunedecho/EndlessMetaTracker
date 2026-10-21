/**
 * Jamming: building a song a track and a set at a time instead of generating
 * it whole. A set is a song row. Tracks come from the layers of the style
 * library (a kick, a bass line, a pad), written in the jam's key; each keeps
 * its recipe (style, layer, seed) in `meta.jam`, so it can be reseeded later,
 * even after the song is saved and loaded again. Saving a set copies the row
 * into a new one with its own chains and phrases, so the saved set stays as
 * it was while the jam goes on.
 *
 * Every function changes the song in place; the caller takes an undo
 * snapshot first.
 */
import { rowSteps, toMidi, toName } from '../../format/lib/core.js';
import { generateLayer } from '../../endless-techno/lib/generate.js';

export const MAX_TRACKS = 16; // the format's limit

const clone = (v) => JSON.parse(JSON.stringify(v));
const rows = (song) => song.composition.song.rows;
const pl = (song) => song.transport.phraseLength ?? 16;

/** An id not yet used: `base` itself, else base2, base3, ... */
function freshId(taken, base) {
  if (!taken(base)) return base;
  for (let i = 2; ; i++) if (!taken(`${base}${i}`)) return `${base}${i}`;
}

/** A starting key for a song with no jam yet: the pitch class of its first note, minor. */
export function guessKey(song) {
  for (const ph of Object.values(song.composition.phrases)) {
    const s = ph.steps.find((x) => x && x.note !== undefined && x.note !== 'OFF');
    if (s) return { root: toName(toMidi(s.note)).replace(/-?\d+$/, ''), mode: 'minor' };
  }
  return { root: 'A', mode: 'minor' };
}

/** The jam's settings, created on first use. */
export function jamOf(song) {
  song.meta ||= {};
  song.meta.jam ||= { ...guessKey(song), recipes: {} };
  return song.meta.jam;
}

/** Bars in a song row (0 for an empty set). */
export const rowBars = (song, r) => rowSteps(song, rows(song)[r]) / pl(song);

/** Bring a style's instrument (and its table) into the song, reusing an identical one. */
function importInstrument(song, style, instId) {
  const def = clone(style.sound.instruments[instId]);
  const { instruments } = song.sound;
  if (def.table) {
    song.sound.tables ||= {};
    const table = style.sound.tables[def.table];
    const same = (id) => JSON.stringify(song.sound.tables[id]) === JSON.stringify(table);
    const tid = same(def.table) ? def.table : freshId((id) => song.sound.tables[id] && !same(id), def.table);
    song.sound.tables[tid] = clone(table);
    def.table = tid;
  }
  const same = (id) => JSON.stringify(instruments[id]) === JSON.stringify(def);
  const id = same(instId) ? instId : freshId((x) => instruments[x] && !same(x), instId);
  instruments[id] = def;
  return id;
}

/** Write bars of steps as new phrases and a chain for a track; returns the chain id. */
function writeChain(song, trackId, bars) {
  const { phrases, chains } = song.composition;
  const chainRows = bars.map((steps) => {
    const id = freshId((x) => phrases[x], `${trackId}_j`); // trackId_j, trackId_j2, ...
    phrases[id] = { steps: steps.map((s) => (s ? clone(s) : null)) };
    return { phrase: id };
  });
  const cid = freshId((x) => chains[x], `${trackId}_jc`);
  chains[cid] = { rows: chainRows };
  return cid;
}

/** Drop chains no row plays and phrases no chain plays, among the ids given. */
function prune(song, chainIds, phraseIds) {
  const { chains, phrases } = song.composition;
  const usedChains = new Set(rows(song).flatMap((r) => Object.values(r)));
  for (const id of chainIds) if (!usedChains.has(id)) delete chains[id];
  const usedPhrases = new Set(Object.values(chains).flatMap((c) => c.rows.map((x) => x.phrase)));
  for (const id of phraseIds) if (!usedPhrases.has(id)) delete phrases[id];
}

/**
 * Add a style layer to set `r` as new tracks (one per voice; a three-voice pad
 * is three tracks), as long as the set (or `bars` for an empty one).
 * Returns the new track ids.
 */
export function addLayer(song, r, style, layerId, { seed = 1, bars = 4 } = {}) {
  const jam = jamOf(song);
  const len = rowBars(song, r) || bars;
  const gen = generateLayer(style, layerId, { seed, bars: len, root: jam.root, mode: jam.mode });
  const { tracks } = song.composition;
  if (tracks.length + gen.voices.length > MAX_TRACKS) throw new Error(`a song can have ${MAX_TRACKS} tracks; this would make ${tracks.length + gen.voices.length}`);
  const inst = importInstrument(song, style, gen.instrument);
  const ids = [];
  gen.voices.forEach((bars, v) => {
    const id = freshId((x) => tracks.some((t) => t.id === x), gen.voices.length > 1 ? `${layerId}${v + 1}` : layerId);
    tracks.push({ id, instrument: inst });
    rows(song)[r][id] = writeChain(song, id, bars);
    ids.push(id);
  });
  for (const [v, id] of ids.entries()) jam.recipes[id] = { style: style.id, layer: layerId, seed, voice: v, group: ids[0] };
  return ids;
}

/** The tracks reseeded together with `trackId`: the other voices of its layer, in this set. */
export function groupOf(song, r, trackId) {
  const recipes = jamOf(song).recipes;
  const g = recipes[trackId]?.group;
  if (!g) return [trackId];
  return Object.keys(rows(song)[r]).filter((id) => recipes[id]?.group === g);
}

/**
 * A new take on a track (and the other voices of its layer) in set `r`: new
 * notes from `layerId` of `style` with `seed`, in the jam's key. The track
 * keeps its own instrument. Other sets keep their notes.
 */
export function reseed(song, r, trackId, style, layerId, seed) {
  const jam = jamOf(song);
  const row = rows(song)[r];
  const group = groupOf(song, r, trackId);
  const len = rowBars(song, r) || 1;
  const gen = generateLayer(style, layerId, { seed, bars: len, root: jam.root, mode: jam.mode });
  const old = group.map((id) => row[id]).filter(Boolean);
  const oldPhrases = old.flatMap((c) => song.composition.chains[c].rows.map((x) => x.phrase));
  group.forEach((id, i) => {
    const prev = jam.recipes[id];
    const voice = Math.min(prev?.layer === layerId ? prev.voice ?? i : i, gen.voices.length - 1);
    row[id] = writeChain(song, id, gen.voices[voice]);
    jam.recipes[id] = { style: style.id, layer: layerId, seed, voice, group: group[0] };
  });
  prune(song, old, oldPhrases);
}

/** Take a track out of set `r` (the track stays in the song for other sets). */
export function removeFromSet(song, r, trackId) {
  const row = rows(song)[r];
  const chain = row[trackId];
  delete row[trackId];
  if (chain) prune(song, [chain], song.composition.chains[chain].rows.map((x) => x.phrase));
}

/** Shift section labels when rows move: every section at or after `from` moves by `by`. */
function shiftSections(song, from, by) {
  for (const s of song.composition.song.sections || []) if (s.row >= from) s.row += by;
}

export function setName(song, r, name) {
  const sections = (song.composition.song.sections ||= []);
  const s = sections.find((x) => x.row === r);
  if (s) s.name = name;
  else sections.push({ row: r, name });
  sections.sort((a, b) => a.row - b.row);
}

export const nameOf = (song, r) => song.composition.song.sections?.find((x) => x.row === r)?.name;

/**
 * Keep set `r` as it is and start a copy of it right after: the copy gets its
 * own chains and phrases, so jamming on it never changes the saved set.
 * Returns the copy's row index.
 */
export function saveSet(song, r, name) {
  const { chains, phrases } = song.composition;
  const copy = {};
  for (const [trackId, chainId] of Object.entries(rows(song)[r])) {
    if (!chainId) continue;
    const chain = clone(chains[chainId]);
    for (const cr of chain.rows) {
      const id = freshId((x) => phrases[x], `${cr.phrase}_s`);
      phrases[id] = clone(phrases[cr.phrase]);
      cr.phrase = id;
    }
    const cid = freshId((x) => chains[x], `${chainId}_s`);
    chains[cid] = chain;
    copy[trackId] = cid;
  }
  shiftSections(song, r + 1, 1);
  rows(song).splice(r + 1, 0, copy);
  if (name) setName(song, r, name);
  setName(song, r + 1, `${nameOf(song, r) ?? `set ${r}`} +`);
  return r + 1;
}

/** A new empty set right after `r`; returns its index. */
export function newSet(song, r) {
  shiftSections(song, r + 1, 1);
  rows(song).splice(r + 1, 0, {});
  setName(song, r + 1, `set ${r + 1}`);
  return r + 1;
}

/** Remove set `r` (a song keeps at least one). */
export function deleteSet(song, r) {
  if (rows(song).length <= 1) throw new Error('a song needs at least one set');
  const row = rows(song)[r];
  const chainIds = Object.values(row).filter(Boolean);
  const phraseIds = chainIds.flatMap((c) => song.composition.chains[c].rows.map((x) => x.phrase));
  const sections = song.composition.song.sections || [];
  song.composition.song.sections = sections.filter((s) => s.row !== r);
  shiftSections(song, r + 1, -1);
  rows(song).splice(r, 1);
  prune(song, chainIds, phraseIds);
  if (song.transport.loop !== undefined && song.transport.loop >= rows(song).length) delete song.transport.loop;
}
