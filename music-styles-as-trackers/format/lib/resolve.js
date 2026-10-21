/**
 * Flatten a song into a timeline of events.
 *
 * Song rows are synchronised: a row lasts as long as its longest chain, and
 * shorter chains repeat to fill it. Within a chain, phrases play in order.
 * The result is what a player, a renderer, or an exporter needs: every note
 * and command with an absolute step index, plus the row and phrase boundaries.
 */
import { toMidi } from './notes.js';

export const DEFAULTS = { stepsPerBeat: 4, phraseLength: 16, swing: 0 };

/** Transport with defaults filled in. */
export function transportOf(song) {
  return { ...DEFAULTS, ...song.transport };
}

/** Length of a chain in steps. */
export function chainSteps(song, chainId) {
  const chain = song.composition.chains[chainId];
  if (!chain) throw new Error(`unknown chain: ${chainId}`);
  const pl = transportOf(song).phraseLength;
  return chain.rows.length * pl;
}

/** Length of a song row in steps: its longest chain. */
export function rowSteps(song, row) {
  let max = 0;
  for (const chainId of Object.values(row)) {
    if (chainId) max = Math.max(max, chainSteps(song, chainId));
  }
  return max;
}

/** Total song length in steps, ignoring loop. */
export function songSteps(song) {
  return song.composition.song.rows.reduce((s, row) => s + rowSteps(song, row), 0);
}

/** Seconds per step at a tempo. */
export function stepSeconds(bpm, stepsPerBeat) {
  return 60 / bpm / stepsPerBeat;
}

/**
 * @typedef {object} Event
 * @property {number} step absolute step index from song start
 * @property {number} track index into composition.tracks
 * @property {string} trackId
 * @property {number|'OFF'|null} note MIDI number, 'OFF', or null for a command-only step
 * @property {string|null} inst instrument id (null when no note)
 * @property {number} vel 0..1
 * @property {object} fx command map, possibly empty
 * @property {number} row song row index
 * @property {string} chain chain id
 * @property {string} phrase phrase id
 * @property {number} phraseStep step within the phrase
 */

/**
 * Flatten the song.
 * @param {object} song a valid tracker-song/0.1 document
 * @param {{maxSteps?: number, loops?: number}} [opts] limit the timeline; loops repeats the loop region
 * @returns {{events: Event[], totalSteps: number, rows: {row:number, step:number, steps:number, name?:string, energy?:number}[], phrases: {step:number, track:number, phrase:string, chain:string}[], transport: object}}
 */
export function resolve(song, opts = {}) {
  const transport = transportOf(song);
  const pl = transport.phraseLength;
  const { tracks, phrases, chains } = song.composition;
  const songRows = song.composition.song.rows;
  const sections = new Map((song.composition.song.sections || []).map((s) => [s.row, s]));
  const trackIndex = new Map(tracks.map((t, i) => [t.id, i]));

  const events = [];
  const rows = [];
  const phraseMarks = [];
  let step = 0;
  const maxSteps = opts.maxSteps ?? Infinity;
  const loopTarget = transport.loop;
  let loopsLeft = opts.loops ?? 0;

  let r = 0;
  let prevRow = null; // the row that actually preceded, also across a loop jump
  while (r < songRows.length && step < maxSteps) {
    const row = songRows[r];
    const len = rowSteps(song, row);
    const section = sections.get(r);
    rows.push({ row: r, step, steps: len, name: section?.name, energy: section?.energy });

    // Tracks absent from a row are silent: release whatever they were playing.
    if (prevRow) {
      for (const [trackId, chainId] of Object.entries(prevRow)) {
        if (!chainId || row[trackId]) continue;
        const ti = trackIndex.get(trackId);
        if (ti === undefined || tracks[ti].mute) continue;
        events.push({ step, track: ti, trackId, note: 'OFF', inst: tracks[ti].instrument ?? null, vel: 1, fx: {}, row: r, chain: chainId, phrase: null, phraseStep: 0 });
      }
    }

    for (const [trackId, chainId] of Object.entries(row)) {
      if (!chainId) continue;
      const ti = trackIndex.get(trackId);
      if (ti === undefined) throw new Error(`song row ${r} names unknown track: ${trackId}`);
      if (tracks[ti].mute) continue;
      const chain = chains[chainId];
      if (!chain) throw new Error(`song row ${r} names unknown chain: ${chainId}`);
      const defaultInst = tracks[ti].instrument ?? null;
      const cs = chain.rows.length * pl;
      // Repeat the chain to fill the row.
      for (let offset = 0; offset < len; offset += cs) {
        for (let ci = 0; ci < chain.rows.length; ci++) {
          const { phrase: phraseId, transpose = 0 } = chain.rows[ci];
          const phrase = phrases[phraseId];
          if (!phrase) throw new Error(`chain ${chainId} names unknown phrase: ${phraseId}`);
          const base = step + offset + ci * pl;
          if (base >= step + len) break;
          phraseMarks.push({ step: base, track: ti, phrase: phraseId, chain: chainId });
          for (let s = 0; s < pl; s++) {
            const cell = phrase.steps[s];
            if (!cell) continue;
            const abs = base + s;
            if (abs >= step + len || abs >= maxSteps) break;
            let note = null;
            if (cell.note !== undefined) {
              note = toMidi(cell.note);
              if (note !== 'OFF') note += transpose;
            }
            events.push({
              step: abs,
              track: ti,
              trackId,
              note,
              inst: note !== null && note !== 'OFF' ? (cell.inst ?? defaultInst) : (cell.inst ?? defaultInst),
              vel: cell.vel ?? 1,
              fx: cell.fx ?? {},
              row: r,
              chain: chainId,
              phrase: phraseId,
              phraseStep: s,
            });
          }
        }
      }
    }
    step += len;
    prevRow = row;
    r++;
    if (r >= songRows.length && loopTarget !== undefined && loopsLeft > 0) {
      loopsLeft--;
      r = loopTarget;
    }
  }

  events.sort((a, b) => a.step - b.step || a.track - b.track);
  return { events, totalSteps: Math.min(step, maxSteps), rows, phrases: phraseMarks, transport };
}

/** Seconds for a flattened timeline, honouring tempo commands. */
export function timelineSeconds(resolved) {
  const { events, totalSteps, transport } = resolved;
  let bpm = transport.bpm;
  let t = 0;
  let lastStep = 0;
  for (const e of events) {
    if (e.fx.tempo !== undefined) {
      t += (e.step - lastStep) * stepSeconds(bpm, transport.stepsPerBeat);
      lastStep = e.step;
      bpm = e.fx.tempo;
    }
  }
  t += (totalSteps - lastStep) * stepSeconds(bpm, transport.stepsPerBeat);
  return t;
}
