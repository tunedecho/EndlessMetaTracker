/**
 * The tracker grid with a third axis: for every step of every track, every
 * parameter that shapes what plays there. A lane is one parameter; a cell is
 * one step on one track with a value in each lane.
 *
 * Values follow the engine's rules: track commands (cutoff, volume, ...)
 * persist on the track and override the instrument's own setting until
 * changed, note commands (accent, retrig, ...) act on one step, and an
 * instrument parameter that is not set falls back to the engine default.
 */
import { resolve } from '../../format/lib/core.js';
import { leafParams } from './params.js';

/** Track commands that set an instrument parameter, as the player applies them. */
const TRACK_SETS = { cutoff: ['filter', 'cutoff'], resonance: ['filter', 'resonance'], volume: ['mix', 'volume'], pan: ['mix', 'pan'], drive: ['mix', 'drive'], delaySend: ['mix', 'delaySend'], reverbSend: ['mix', 'reverbSend'] };
const STEP_COMMANDS = ['accent', 'retrig', 'nudge', 'slide', 'cut', 'chance'];

/** Where a lane's value came from. */
export const SOURCE = { none: 0, set: 1, unset: 2, command: 3 };

export const GROUPS = {
  note: 'the note: pitch and velocity',
  step: 'note commands on this step',
  track: 'track pitch offset (a persisting command)',
  instrument: 'which engine, and its transpose',
  params: 'engine parameters',
  filter: 'filter and its envelope',
  amp: 'amplitude envelope',
  lfo: 'LFO',
  mix: 'level, pan, drive, sends',
};

const getPath = (o, path) => path.reduce((v, k) => (v == null ? undefined : v[k]), o);

/**
 * Build the cube for song rows [from, to).
 * @param {object} song a tracker-song/0.1 document
 * @param {object} defs the song schema's $defs
 * @returns {{tracks: object[], lanes: object[], cells: object[], steps: number, rows: object[], pitch: {min: number, max: number}}}
 */
export function cubeModel(song, defs, { from = 0, to = song.composition.song.rows.length } = {}) {
  const resolved = resolve(song);
  const rows = resolved.rows.filter((r) => r.row >= from && r.row < to);
  const base = rows[0]?.step ?? 0;
  const steps = rows.reduce((s, r) => s + r.steps, 0);
  const tracks = song.composition.tracks;
  const instruments = song.sound.instruments;

  // Lanes: note, step commands, track pitch, then instrument parameters, engine parameters for each engine in use.
  const lanes = [
    { key: 'pitch', label: 'pitch', group: 'note', description: 'MIDI note, with chain transpose' },
    { key: 'vel', label: 'velocity', group: 'note', description: 'Step velocity' },
    ...STEP_COMMANDS.map((k) => ({ key: `fx.${k}`, label: k, group: 'step', description: defs.fx.properties[k].description, fx: k })),
    { key: 'fx.table', label: 'table', group: 'step', description: 'A table runs for this note (step or instrument)' },
    { key: 'track.pitch', label: 'pitch offset', group: 'track', description: defs.fx.properties.pitch.description },
  ];
  const used = new Set();
  for (const e of resolved.events) if (e.inst && instruments[e.inst]) used.add(instruments[e.inst].engine);
  for (const t of tracks) if (t.instrument && instruments[t.instrument]) used.add(instruments[t.instrument].engine);
  const common = leafParams(defs, defs.instrument).filter((p) => p.path[0] !== 'name');
  const order = ['instrument', 'params', 'filter', 'amp', 'lfo', 'mix'];
  const instLanes = [];
  for (const p of common) instLanes.push({ ...p, key: p.path.join('.'), label: p.path.join('.'), group: ['filter', 'amp', 'lfo', 'mix'].includes(p.path[0]) ? p.path[0] : 'instrument' });
  for (const engine of defs.instrument.properties.engine.enum) {
    if (!used.has(engine)) continue;
    for (const p of leafParams(defs, defs[`params.${engine}`], ['params'])) {
      instLanes.push({ ...p, key: `${engine}:${p.path.join('.')}`, label: `${engine}.${p.path.slice(1).join('.')}`, group: 'params', engine });
    }
  }
  instLanes.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  lanes.push(...instLanes);
  for (const [cmd, path] of Object.entries(TRACK_SETS)) lanes.find((l) => l.key === path.join('.')).command = cmd;
  const L = lanes.length;
  const laneIndex = new Map(lanes.map((l, i) => [l.key, i]));
  const tableLane = laneIndex.get('fx.table'), offsetLane = laneIndex.get('track.pitch');

  // Walk the whole song so persisting track commands from earlier rows count.
  const state = tracks.map((t) => ({ ctl: {}, inst: t.instrument ?? null, prev: null }));
  const cells = [];
  let pmin = Infinity, pmax = -Infinity;
  for (const e of resolved.events) {
    const st = state[e.track];
    const fx = e.fx || {};
    for (const k of Object.keys(TRACK_SETS).concat('pitch')) if (fx[k] !== undefined) st.ctl[k] = fx[k];
    if (typeof e.note === 'number' && e.inst) st.inst = e.inst;
    if (e.row < from || e.row >= to) continue;
    const kind = e.note === 'OFF' ? 'off' : typeof e.note === 'number' ? 'note' : 'cmd';
    // The implicit OFF a track gets when it leaves the grid is not a step anyone wrote.
    if (kind === 'off' && e.phrase === null) continue;
    const cell = { track: e.track, step: e.step - base, row: e.row, rowStep: e.step - resolved.rows[e.row].step, kind, inst: st.inst, phrase: e.phrase, phraseStep: e.phraseStep,
      value: new Float32Array(L).fill(NaN), raw: new Array(L), source: new Uint8Array(L), changed: new Uint8Array(L) };
    if (kind !== 'off') {
      const inst = instruments[st.inst];
      if (kind === 'note') {
        cell.raw[0] = e.note; cell.source[0] = SOURCE.set; pmin = Math.min(pmin, e.note); pmax = Math.max(pmax, e.note);
        cell.raw[1] = e.vel; cell.value[1] = e.vel; cell.source[1] = SOURCE.set;
        for (const k of STEP_COMMANDS) {
          const i = laneIndex.get(`fx.${k}`);
          cell.raw[i] = fx[k] ?? null;
          cell.value[i] = fx[k] === undefined ? 0 : k === 'retrig' ? (fx[k] - 1) / 15 : fx[k];
          cell.source[i] = fx[k] === undefined ? SOURCE.unset : SOURCE.set;
        }
        const table = fx.table ?? inst?.table;
        cell.raw[tableLane] = table ?? null; cell.value[tableLane] = table ? 1 : 0; cell.source[tableLane] = table ? SOURCE.set : SOURCE.unset;
      }
      const off = st.ctl.pitch;
      cell.raw[offsetLane] = off ?? 0; cell.value[offsetLane] = ((off ?? 0) + 48) / 96; cell.source[offsetLane] = off === undefined ? SOURCE.unset : SOURCE.command;
      for (let i = 0; i < L; i++) {
        const lane = lanes[i];
        if (!lane.path || !inst) continue;
        if (lane.engine && lane.engine !== inst.engine) continue;
        let v = getPath(inst, lane.path), src = SOURCE.set;
        if (lane.command && st.ctl[lane.command] !== undefined) { v = st.ctl[lane.command]; src = SOURCE.command; }
        if (v === undefined) { v = lane.default; src = SOURCE.unset; }
        cell.raw[i] = v ?? null;
        cell.source[i] = src;
        cell.value[i] = v === undefined ? NaN : lane.norm(v);
      }
      if (st.prev) for (let i = 0; i < L; i++) if (cell.source[i] && st.prev.source[i] && cell.raw[i] !== st.prev.raw[i]) cell.changed[i] = 1;
      st.prev = cell;
    }
    cells.push(cell);
  }
  // Pitch spreads over the range the song uses, so melodies are visible.
  for (const c of cells) if (c.kind === 'note') c.value[0] = pmax > pmin ? (c.raw[0] - pmin) / (pmax - pmin) : 0.5;
  return {
    tracks, lanes, cells, steps,
    rows: rows.map((r) => ({ row: r.row, step: r.step - base, steps: r.steps, name: r.name })),
    pitch: { min: pmin, max: pmax },
    phraseLength: resolved.transport.phraseLength, stepsPerBeat: resolved.transport.stepsPerBeat,
  };
}
