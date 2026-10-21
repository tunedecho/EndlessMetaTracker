/**
 * Editing a song in place, the way a tracker does: a step on screen belongs to
 * a phrase, so editing it changes that phrase everywhere it plays. These
 * helpers find where a step comes from, count where its phrase plays, write
 * steps, and copy a phrase so an edit stays in one place.
 */
import { transportOf, rowSteps } from './resolve.js';

/**
 * Where a step of a song row comes from.
 * @param {object} song
 * @param {number} rowIndex song row
 * @param {string} trackId
 * @param {number} step step within the row
 * @returns {{chain: string, chainRow: number, phrase: string, phraseStep: number, transpose: number} | null} null when the track is silent in this row or the chain has ended
 */
export function stepSource(song, rowIndex, trackId, step) {
  const row = song.composition.song.rows[rowIndex];
  const chainId = row?.[trackId];
  if (!chainId) return null;
  if (step < 0 || step >= rowSteps(song, row)) return null;
  const pl = transportOf(song).phraseLength;
  const chain = song.composition.chains[chainId];
  const within = step % (chain.rows.length * pl); // shorter chains repeat to fill the row
  const chainRow = Math.floor(within / pl);
  const { phrase, transpose = 0 } = chain.rows[chainRow];
  return { chain: chainId, chainRow, phrase, phraseStep: within % pl, transpose };
}

/** How many times a phrase plays in the song (each chain row it fills, counting repeats), or in one song row. */
export function phrasePlays(song, phraseId, onlyRow) {
  const pl = transportOf(song).phraseLength;
  const { chains } = song.composition;
  let n = 0;
  for (const [ri, row] of song.composition.song.rows.entries()) {
    if (onlyRow !== undefined && ri !== onlyRow) continue;
    const len = rowSteps(song, row);
    for (const chainId of Object.values(row)) {
      if (!chainId) continue;
      const rows = chains[chainId].rows;
      const cs = rows.length * pl;
      for (let offset = 0; offset < len; offset += cs) {
        rows.forEach((r, i) => { if (r.phrase === phraseId && offset + i * pl < len) n++; });
      }
    }
  }
  return n;
}

/** Read one phrase step (null when empty). */
export function getStep(song, phraseId, step) {
  return song.composition.phrases[phraseId].steps[step] ?? null;
}

/**
 * Write one phrase step. `cell` null empties it. Returns the previous value, for undo.
 */
export function setStep(song, phraseId, step, cell) {
  const steps = song.composition.phrases[phraseId].steps;
  const prev = steps[step] ?? null;
  while (steps.length <= step) steps.push(null);
  steps[step] = cell && Object.keys(cell).length ? cell : null;
  return prev;
}

/** An id not yet used in `map`, from `base`. */
function freshId(map, base) {
  for (let i = 2; ; i++) if (!map[`${base}_${i}`]) return `${base}_${i}`;
}

/**
 * Make the phrase at one place of the song its own: copy the chain for this
 * song row and track, and copy the phrase into that chain row. Other song
 * rows and other chain rows keep the original; if the chain repeats to fill
 * this row, its repeats share the copy. Returns the new {chain, phrase} ids.
 */
export function makeUnique(song, rowIndex, trackId, chainRow) {
  const { chains, phrases, song: grid } = song.composition;
  const row = grid.rows[rowIndex];
  const oldChain = chains[row[trackId]];
  const chain = freshId(chains, row[trackId]);
  chains[chain] = JSON.parse(JSON.stringify(oldChain));
  row[trackId] = chain;
  const oldPhrase = chains[chain].rows[chainRow].phrase;
  const phrase = freshId(phrases, oldPhrase);
  phrases[phrase] = JSON.parse(JSON.stringify(phrases[oldPhrase]));
  chains[chain].rows[chainRow].phrase = phrase;
  return { chain, phrase };
}
