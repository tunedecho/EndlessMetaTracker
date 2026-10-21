/**
 * Parameter locks: a step can set any instrument parameter for its own note,
 * by dotted path ("filter.cutoff", "amp.decay", "params.unison"). The note
 * plays as if the instrument had those values; the next note is back to the
 * instrument. A lock is more specific than a track command, so it wins over
 * one for that note.
 */

/** Track commands and the instrument parameter each one overrides. */
export const TRACK_COMMAND_PATHS = {
  cutoff: 'filter.cutoff',
  resonance: 'filter.resonance',
  volume: 'mix.volume',
  pan: 'mix.pan',
  drive: 'mix.drive',
  delaySend: 'mix.delaySend',
  reverbSend: 'mix.reverbSend',
};

const COMMAND_FOR_PATH = Object.fromEntries(Object.entries(TRACK_COMMAND_PATHS).map(([k, p]) => [p, k]));

/** The track command a lock path stands in for, if any. */
export const commandForPath = (path) => COMMAND_FOR_PATH[path];

/** An instrument with a step's locks applied; the original is untouched. */
export function applyLock(inst, lock) {
  const out = JSON.parse(JSON.stringify(inst));
  for (const [path, value] of Object.entries(lock || {})) {
    const keys = path.split('.');
    let o = out;
    for (const k of keys.slice(0, -1)) {
      if (o[k] == null || typeof o[k] !== 'object') o[k] = {};
      o = o[k];
    }
    o[keys.at(-1)] = value;
  }
  return out;
}

/** The instruments that can play each phrase's notes by default: the default instrument of every track whose chains use it. */
export function phraseInstruments(song) {
  const { tracks, chains, song: grid } = song.composition;
  const byTrack = new Map(tracks.map((t) => [t.id, t.instrument]));
  const out = new Map();
  for (const row of grid.rows) {
    for (const [trackId, chainId] of Object.entries(row)) {
      const inst = byTrack.get(trackId);
      if (!chainId || !inst || !chains[chainId]) continue;
      for (const r of chains[chainId].rows) {
        if (!out.has(r.phrase)) out.set(r.phrase, new Set());
        out.get(r.phrase).add(inst);
      }
    }
  }
  return out;
}
