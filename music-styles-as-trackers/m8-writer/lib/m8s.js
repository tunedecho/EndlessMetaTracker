/**
 * Dirtywave M8 song file (.m8s) writer and reader.
 *
 * NOT TESTED ON A DEVICE. The layout comes from two community parsers
 * (AlexCharlton/m8-files and Twinside/m8-file-parser, both MIT) and from the
 * screenshots and command-mapping songs in their test suites. See
 * FORMAT-NOTES.md for every offset, the evidence behind it, and what is
 * still uncertain.
 *
 * Strategy: start from an empty song saved by firmware 6.6.2 (the template in
 * ../templates/, taken from m8-file-parser) and overwrite only the regions
 * whose layout is known: header name and tempo, song grid, phrases, chains,
 * tables, instruments. Everything else (mixer, effects, MIDI mappings, scales,
 * EQs, bookmarks, groove PPQN) keeps the template's defaults, which is the
 * same approach the Rust writer takes.
 */
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { toMidi } from '@tracker/format';

export const TEMPLATE = resolvePath(new URL('../templates/V6_6EMPTY.m8s', import.meta.url).pathname);
export const FILE_VERSION = '6.6.2';

/** Byte offsets, identical from file version 4.0 through 6.6. */
export const OFS = {
  version: 0x0a, // 2 bytes: lsb = minor<<4|patch, msb = major
  directory: 0x0e, // 128 bytes
  transpose: 0x8e,
  tempo: 0x8f, // float32 LE
  quantize: 0x93,
  name: 0x94, // 12 bytes
  grooves: 0xee, // 32 x 16
  song: 0x2ee, // 256 rows x 8 tracks
  phrases: 0xaee, // 255 x 16 steps x 9 bytes
  chains: 0x9a5e, // 255 x 16 steps x 2 bytes
  tables: 0xba3e, // 256 x 16 rows x 8 bytes
  instruments: 0x13a3e, // 128 x 215 bytes
};
export const N = { tracks: 8, rows: 256, phrases: 255, chains: 255, tables: 256, instruments: 128, steps: 16 };
const INSTRUMENT_SIZE = 215;
const STEP_SIZE = 9;
const TABLE_STEP_SIZE = 8;
const EMPTY = 0xff;
const NOTE_OFF = 0x80; // any note byte >= 0x80 displays as OFF in the community parsers
const TICKS_PER_STEP = 6; // the default groove (06 06)

/** M8 note byte = MIDI note - 36 (midi-m8 uses global transpose 36; C-4 on the M8 is byte 0x24). */
export const MIDI_OFFSET = 36;

/* Sequencer commands (index into the firmware 3+ command list, confirmed by phrase A0 of CMDMAPPING). */
export const SEQ = { ARP: 0x00, CHA: 0x01, DEL: 0x02, GRV: 0x03, HOP: 0x04, KIL: 0x05, RND: 0x06, RNL: 0x07, RET: 0x08, REP: 0x09, RMX: 0x0a, NTH: 0x0b, PSL: 0x0c, PBN: 0x0d, PVB: 0x0e, PVX: 0x0f, SCA: 0x10, SCG: 0x11, SED: 0x12, SNG: 0x13, TBL: 0x14, THO: 0x15, TIC: 0x16, TBX: 0x17, TPO: 0x18, TSP: 0x19, OFF: 0x1a };
/* Instrument commands live at 0x80 + index. These indices are the same for WAVSYNTH, MACROSYNTH and FMSYNTH. */
export const INS = { VOL: 0x80, PIT: 0x81, FIN: 0x82, CUT: 0x89, RES: 0x8a, AMP: 0x8b, LIM: 0x8c, PAN: 0x8d, DRY: 0x8e, SMX: 0x8f, SDL: 0x90, SRV: 0x91 };

export const KIND = { WAVSYNTH: 0, MACROSYNTH: 1, SAMPLER: 2, MIDIOUT: 3, FMSYNTH: 4, HYPERSYNTH: 5, EXTERNAL: 6, NONE: 0xff };
export const WAV_SHAPE = { PULSE12: 0, PULSE25: 1, PULSE50: 2, PULSE75: 3, SAW: 4, TRIANGLE: 5, SINE: 6, NOISE_PITCHED: 7, NOISE: 8 };
export const MACRO_SHAPE = { KICK: 34, CYMBAL: 35, SNARE: 36, FILTERED_NOISE: 41 };
export const FILTER = { off: 0, lowpass: 1, highpass: 2, bandpass: 3 };
/** Modulation destinations shared by the three synth types at these indices. */
export const DEST = { OFF: 0, VOLUME: 1, PITCH: 2, CUTOFF: 7, RES: 8, AMP: 9, PAN: 10 };
export const MOD_TYPE = { AHD: 0, ADSR: 1, DRUM: 2, LFO: 3, TRIG: 4, TRACKING: 5 };
export const LFO_SHAPE = { TRI: 0, SIN: 1, RAMP_DOWN: 2, RAMP_UP: 3, EXP_DN: 4, EXP_UP: 5, SQR_DN: 6, SQR_UP: 7, RANDOM: 8 };

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const u8 = (x) => clamp(Math.round(x), 0, 255);
const unit = (x) => u8((x ?? 0) * 255);
const signed = (x) => (x < 0 ? 256 + x : x) & 0xff;

/** Seconds to an M8 envelope byte. Approximate: the device's curve is not documented. */
export function envByte(seconds) {
  if (seconds === undefined) return undefined;
  return u8(Math.sqrt(clamp(seconds, 0, 4) / 4) * 255);
}

/** Hz to an M8 LFO FREQ byte. Approximate. */
function lfoByte(hz) { return u8(clamp(hz, 0, 20) / 20 * 255); }

/** Song name: 12 chars, uppercase, letters digits space and a few symbols. */
export function m8Name(title) {
  return (title || 'SONG').toUpperCase().replace(/[^A-Z0-9 _.-]/g, '').slice(0, 12).trim() || 'SONG';
}

/* ------------------------------------------------------------- modulators */

function modBytes(m) {
  // 6 bytes: type<<4|dest, then 4 or 5 parameter bytes, padded with 0xff/0.
  const out = [EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY];
  // An unused slot: an AHD envelope with destination OFF, so it shapes nothing. (TEST-FILE's FM
  // instrument stores exactly this for its unused envelopes.)
  if (!m) return [0x00, 0xff, 0x00, 0x00, 0x80, 0xff];
  out[0] = ((m.type & 0x0f) << 4) | (m.dest & 0x0f);
  switch (m.type) {
    case MOD_TYPE.AHD: out[1] = m.amount; out[2] = m.attack; out[3] = m.hold; out[4] = m.decay; out[5] = EMPTY; break;
    case MOD_TYPE.ADSR: out[1] = m.amount; out[2] = m.attack; out[3] = m.decay; out[4] = m.sustain; out[5] = m.release; break;
    case MOD_TYPE.DRUM: out[1] = m.amount; out[2] = m.peak; out[3] = m.body; out[4] = m.decay; out[5] = EMPTY; break;
    case MOD_TYPE.LFO: out[1] = m.amount; out[2] = m.shape; out[3] = m.trigger ?? 0; out[4] = m.freq; out[5] = m.retrigger ?? EMPTY; break;
    default: break;
  }
  return out.map((x) => x ?? 0);
}

function readMod(b) {
  const type = b[0] >> 4, dest = b[0] & 0x0f;
  switch (type) {
    case MOD_TYPE.AHD: return { type, dest, amount: b[1], attack: b[2], hold: b[3], decay: b[4] };
    case MOD_TYPE.ADSR: return { type, dest, amount: b[1], attack: b[2], decay: b[3], sustain: b[4], release: b[5] };
    case MOD_TYPE.DRUM: return { type, dest, amount: b[1], peak: b[2], body: b[3], decay: b[4] };
    case MOD_TYPE.LFO: return { type, dest, amount: b[1], shape: b[2], trigger: b[3], freq: b[4], retrigger: b[5] };
    default: return { type, dest, raw: Array.from(b) };
  }
}

/* ------------------------------------------------------------ instruments */

/**
 * The common synth block: 10 bytes at `paramsOfs`, the EQ byte at 62, four
 * 6-byte modulators at 63..86. Offsets are from the instrument's first byte.
 */
function commonBlock(buf, base, c) {
  const p = base + c.paramsOfs;
  buf[p] = c.filterType; buf[p + 1] = c.cutoff; buf[p + 2] = c.res; buf[p + 3] = c.amp; buf[p + 4] = c.limit;
  buf[p + 5] = c.pan; buf[p + 6] = c.dry; buf[p + 7] = c.mfx; buf[p + 8] = c.delay; buf[p + 9] = c.reverb;
  buf[base + 62] = c.eq ?? EMPTY;
  const mods = c.mods || [];
  for (let i = 0; i < 4; i++) {
    const bytes = modBytes(mods[i]);
    for (let k = 0; k < 6; k++) buf[base + 63 + i * 6 + k] = bytes[k];
  }
}

function headerBlock(buf, base, kind, name, transposeOn, tableTick, pitch) {
  buf[base] = kind;
  const nm = m8Name(name).padEnd(12, '\0');
  for (let i = 0; i < 12; i++) buf[base + 1 + i] = nm.charCodeAt(i) || 0;
  buf[base + 13] = transposeOn ? 1 : 0;
  buf[base + 14] = tableTick;
  buf[base + 15] = 0x00; // "volume", not shown on the instrument screen; template value
  buf[base + 16] = signed(pitch || 0);
  buf[base + 17] = 0x80; // fine tune, centre
}

/** Mix parameters shared by all mapped instruments. */
function mixOf(inst) {
  const m = inst.mix || {};
  return {
    amp: unit(m.drive ?? 0) >> 1, // AMP is overdrive on the M8; keep it modest
    limit: 0, // CLIP
    pan: u8(((m.pan ?? 0) + 1) * 127.5),
    dry: u8((m.volume ?? 0.8) * 0xc0 / 0.8),
    mfx: 0,
    delay: unit(m.delaySend ?? 0),
    reverb: unit(m.reverbSend ?? 0),
  };
}

function ampEnvMod(inst) {
  const a = inst.amp || {};
  return { type: MOD_TYPE.ADSR, dest: DEST.VOLUME, amount: 0xff, attack: envByte(a.attack ?? 0.002), decay: envByte(a.decay ?? 0.1), sustain: unit(a.sustain ?? 1), release: envByte(a.release ?? 0.05) };
}

function filterEnvMod(inst, warnings, id) {
  const f = inst.filter || {};
  if (!f.envAmount) return null;
  if (f.envAmount < 0) warnings.push(`${id}: negative filter envAmount is not representable; using its magnitude`);
  const e = f.env || {};
  return { type: MOD_TYPE.ADSR, dest: DEST.CUTOFF, amount: unit(Math.abs(f.envAmount)), attack: envByte(e.attack ?? 0.001), decay: envByte(e.decay ?? 0.2), sustain: unit(e.sustain ?? 0), release: envByte(e.release ?? 0.2) };
}

function lfoMod(inst, warnings, id) {
  const l = inst.lfo;
  if (!l) return null;
  const dest = { cutoff: DEST.CUTOFF, pitch: DEST.PITCH, volume: DEST.VOLUME, pan: DEST.PAN }[l.target];
  if (dest === undefined) { warnings.push(`${id}: LFO target ${l.target} has no M8 destination; LFO dropped`); return null; }
  const shape = { sine: LFO_SHAPE.SIN, triangle: LFO_SHAPE.TRI, saw: LFO_SHAPE.RAMP_DOWN, square: LFO_SHAPE.SQR_UP, random: LFO_SHAPE.RANDOM }[l.shape] ?? LFO_SHAPE.SIN;
  if (l.sync) warnings.push(`${id}: LFO sync (${l.sync} steps) approximated as a free-running rate`);
  const hz = l.sync ? 1 / (l.sync * 0.1171875) : (l.rate ?? 1);
  return { type: MOD_TYPE.LFO, dest, amount: unit(l.depth ?? 0.5), shape, trigger: (l.retrigger ?? true) ? 1 : 0, freq: lfoByte(hz), retrigger: 0 };
}

function wavShape(p, engine) {
  if (engine === 'noise') return WAV_SHAPE.NOISE;
  switch (p.wave) {
    case 'sine': return WAV_SHAPE.SINE;
    case 'triangle': return WAV_SHAPE.TRIANGLE;
    case 'square': return WAV_SHAPE.PULSE50;
    case 'pulse': { const pw = p.pulseWidth ?? 0.5; return pw < 0.19 ? WAV_SHAPE.PULSE12 : pw < 0.38 ? WAV_SHAPE.PULSE25 : pw < 0.63 ? WAV_SHAPE.PULSE50 : WAV_SHAPE.PULSE75; }
    case 'noise': return WAV_SHAPE.NOISE;
    default: return WAV_SHAPE.SAW;
  }
}

/**
 * Map one format instrument to M8 bytes. Returns {kind, bytes(215), transposeOn, notes}.
 * `pitchShift` is semitones added to the instrument PITCH so low notes fit the M8 range.
 */
export function instrumentToM8(id, inst, { pitchShift = 0, warnings = [] } = {}) {
  const buf = new Uint8Array(INSTRUMENT_SIZE).fill(EMPTY);
  const f = inst.filter || {};
  const p = inst.params || {};
  const common = {
    filterType: FILTER[f.type || (f.cutoff !== undefined ? 'lowpass' : 'off')] ?? 0,
    cutoff: f.cutoff !== undefined ? unit(f.cutoff) : 0xff,
    res: unit(f.resonance ?? 0),
    ...mixOf(inst),
    eq: EMPTY,
    mods: [ampEnvMod(inst), filterEnvMod(inst, warnings, id), lfoMod(inst, warnings, id), null],
  };
  const tableTick = inst.table ? Math.max(1, Math.round(TICKS_PER_STEP / (inst.tableRate ?? 4))) : 1;
  let kind, notes;
  switch (inst.engine) {
    case 'analog':
    case 'noise': {
      kind = KIND.WAVSYNTH;
      headerBlock(buf, 0, kind, inst.name || id, inst.engine === 'analog', tableTick, (inst.transpose || 0) + pitchShift);
      buf[18] = wavShape(p, inst.engine);
      buf[19] = 0x20; buf[20] = 0x20; buf[21] = 0x00; buf[22] = 0x00; // size, mult, warp, scan: template-like defaults
      common.paramsOfs = 23;
      if (inst.engine === 'analog' && (p.unison || 1) > 1) warnings.push(`${id}: unison ${p.unison} is not representable on WAVSYNTH (HYPERSYNTH swarm would be closer); exported as a single oscillator`);
      if (p.wave2 && (p.mix2 || 0) > 0) warnings.push(`${id}: second oscillator dropped (WAVSYNTH has one)`);
      if (p.sub) warnings.push(`${id}: sub oscillator dropped`);
      notes = `WAVSYNTH shape ${buf[18]}`;
      break;
    }
    case 'fm': {
      kind = KIND.FMSYNTH;
      headerBlock(buf, 0, kind, inst.name || id, true, tableTick, (inst.transpose || 0) + pitchShift);
      buf[18] = 0x07; // [A>B]+[C>D]: A modulates B; C and D are silent
      buf[19] = 0; buf[20] = 0; buf[21] = 0; buf[22] = 0; // all SIN
      const ratio = p.ratio ?? 2;
      const ratios = [[Math.floor(ratio), Math.round((ratio % 1) * 100)], [1, 0], [1, 0], [1, 0]];
      for (let i = 0; i < 4; i++) { buf[23 + i * 2] = u8(ratios[i][0]); buf[24 + i * 2] = u8(ratios[i][1]); }
      const index = p.index ?? 2;
      const levels = [[u8(index / 8 * 255), unit(p.feedback ?? 0)], [0x80, 0], [0, 0], [0, 0]];
      for (let i = 0; i < 4; i++) { buf[31 + i * 2] = levels[i][0]; buf[32 + i * 2] = levels[i][1]; }
      for (let i = 0; i < 4; i++) { buf[39 + i] = 0; buf[43 + i] = 0; } // mod routing off
      buf[47] = 0; buf[48] = 0; buf[49] = 0; buf[50] = 0; // MOD1..4
      common.paramsOfs = 51;
      if (p.modEnvAmount) warnings.push(`${id}: FM modulator envelope approximated by a static index`);
      notes = `FMSYNTH algo 07, A ratio ${ratio}`;
      break;
    }
    case 'kick':
    case 'clap':
    case 'hihat': {
      kind = KIND.MACROSYNTH;
      headerBlock(buf, 0, kind, inst.name || id, false, tableTick, pitchShift);
      const shape = inst.engine === 'kick' ? MACRO_SHAPE.KICK : inst.engine === 'hihat' ? MACRO_SHAPE.CYMBAL : MACRO_SHAPE.FILTERED_NOISE;
      buf[18] = shape;
      if (inst.engine === 'kick') { buf[19] = unit(clamp((p.pitchDecay ?? 0.05) / 0.2, 0, 1)); buf[20] = unit(p.tone ?? 0.3); }
      else if (inst.engine === 'hihat') { buf[19] = unit(p.tone ?? 0.6); buf[20] = unit(p.metallic ?? 0.5); }
      else { buf[19] = unit(p.tone ?? 0.5); buf[20] = 0x80; }
      buf[21] = 0; buf[22] = 0; // degrade, redux
      common.paramsOfs = 23;
      // Drums: a decay-only volume envelope from the engine's own decay parameter.
      const decay = inst.amp?.decay ?? (inst.engine === 'kick' ? p.body ?? 0.4 : inst.engine === 'hihat' ? p.decay ?? (p.open ? 0.35 : 0.06) : p.tail ?? 0.15);
      common.mods[0] = { type: MOD_TYPE.AHD, dest: DEST.VOLUME, amount: 0xff, attack: 0, hold: 0, decay: envByte(decay) };
      notes = `MACROSYNTH shape ${shape} (approximation of ${inst.engine})`;
      break;
    }
    default:
      throw new Error(`${id}: engine ${inst.engine} cannot be mapped`);
  }
  commonBlock(buf, 0, common);
  return { kind, bytes: buf, notes };
}

/* ------------------------------------------------------------------ steps */

/** Map a step's fx map to up to three M8 commands. Returns [[cmd, val], ...] and pushes warnings. */
export function fxToM8(fx, { tableIndex, warnings, where, tempoWarned }) {
  const out = [];
  const add = (cmd, val) => out.push([cmd, u8(val)]);
  for (const [k, v] of Object.entries(fx || {})) {
    switch (k) {
      case 'cutoff': add(INS.CUT, v * 255); break;
      case 'resonance': add(INS.RES, v * 255); break;
      case 'volume': add(INS.VOL, v * 255); break;
      case 'pan': add(INS.PAN, (v + 1) * 127.5); break;
      case 'delaySend': add(INS.SDL, v * 255); break;
      case 'reverbSend': add(INS.SRV, v * 255); break;
      case 'retrig': add(SEQ.RET, Math.max(1, Math.round(TICKS_PER_STEP / v))); break; // value semantics uncertain, see notes
      case 'nudge': add(SEQ.DEL, v * TICKS_PER_STEP); break;
      case 'slide': add(SEQ.PSL, Math.max(1, v * TICKS_PER_STEP)); break;
      case 'chance': add(SEQ.CHA, v * 255); break; // value semantics uncertain, see notes
      case 'cut': add(SEQ.OFF, v * TICKS_PER_STEP); break;
      case 'tempo': if (v > 255) { warnings.push(`${where}: tempo ${v} exceeds TPO's 255 limit`); } else add(SEQ.TPO, v); break;
      case 'table': { const t = tableIndex(v); if (t !== undefined) add(SEQ.TBL, t); break; }
      case 'accent': break; // folded into velocity by the caller
      case 'pitch': warnings.push(`${where}: pitch command has no clean M8 equivalent; dropped`); break;
      default: warnings.push(`${where}: unknown command ${k}; dropped`);
    }
  }
  if (out.length > 3) { warnings.push(`${where}: ${out.length} commands, the M8 keeps 3`); out.length = 3; }
  return out;
}

/* ------------------------------------------------------------- the writer */

/**
 * Convert a song to M8 bytes.
 * @param {object} song valid tracker-song/0.1
 * @param {{template?: Buffer}} [opts]
 * @returns {{bytes: Buffer, warnings: string[], report: object}}
 */
export function songToM8(song, opts = {}) {
  const warnings = [];
  const template = opts.template || readFileSync(TEMPLATE);
  const buf = Buffer.from(template);
  const c = song.composition;
  const pl = song.transport.phraseLength ?? 16;
  if (pl !== 16) throw new Error(`M8 phrases have 16 steps; this song uses ${pl}`);
  if (c.tracks.length > N.tracks) throw new Error(`the M8 has ${N.tracks} tracks; this song has ${c.tracks.length}`);
  if (c.tracks.length === 0) throw new Error('song has no tracks');

  // Header
  const name = m8Name(song.meta?.title);
  for (let i = 0; i < 12; i++) buf[OFS.name + i] = i < name.length ? name.charCodeAt(i) : 0;
  buf.writeFloatLE(song.transport.bpm, OFS.tempo);
  buf[OFS.transpose] = 0;
  if (song.transport.swing) warnings.push(`swing ${song.transport.swing} is not exported; an M8 groove could express it`);
  if (song.transport.loop !== undefined) warnings.push('loop point is not exported; the M8 loops the whole song');

  // Instruments. Notes below the M8's floor (MIDI 36) move the instrument's PITCH down and the notes up.
  const instIds = Object.keys(song.sound.instruments);
  if (instIds.length > N.instruments) throw new Error(`too many instruments (${instIds.length} > ${N.instruments})`);
  const instIndex = new Map(instIds.map((id, i) => [id, i]));
  const lowest = new Map();
  for (const ph of Object.values(c.phrases)) for (const s of ph.steps) {
    if (!s || s.note === undefined || s.note === 'OFF') continue;
    const m = toMidi(s.note);
    const id = s.inst; // track default resolved below
    if (id) lowest.set(id, Math.min(lowest.get(id) ?? 999, m));
  }
  for (const t of c.tracks) if (t.instrument) {
    // Every note without an explicit instrument on this track belongs to the track's default.
    for (const row of c.song.rows) {
      const chainId = row[t.id]; if (!chainId) continue;
      for (const r of c.chains[chainId].rows) for (const s of c.phrases[r.phrase].steps) {
        if (!s || s.note === undefined || s.note === 'OFF' || s.inst) continue;
        const m = toMidi(s.note) + (r.transpose || 0);
        lowest.set(t.instrument, Math.min(lowest.get(t.instrument) ?? 999, m));
      }
    }
  }
  const pitchShift = new Map();
  for (const [id, low] of lowest) {
    const need = low < MIDI_OFFSET ? Math.ceil((MIDI_OFFSET - low) / 12) * 12 : 0;
    if (need) { pitchShift.set(id, need); warnings.push(`${id}: notes down to ${low} are below the M8 range; instrument PITCH set to -${need} and its notes raised ${need}`); }
  }
  const tableIds = Object.keys(song.sound.tables || {});
  const instrumentReport = [];
  for (const [id, inst] of Object.entries(song.sound.instruments)) {
    const i = instIndex.get(id);
    const tableDef = inst.table ? song.sound.tables[inst.table] : null;
    const m = instrumentToM8(id, { ...inst, tableRate: tableDef?.rate }, { pitchShift: -(pitchShift.get(id) || 0), warnings });
    buf.set(m.bytes, OFS.instruments + i * INSTRUMENT_SIZE);
    instrumentReport.push({ id, index: i, m8: m.notes });
    if (tableDef) writeTable(buf, i, tableDef, warnings, `instrument ${id} table ${inst.table}`, tableIds);
  }
  // Tables named by step commands go in the free range 0x80.. (each gets one slot).
  const stepTableIndex = new Map();
  let nextFree = 0x80;
  const tableIndex = (tid) => {
    if (!song.sound.tables?.[tid]) { warnings.push(`unknown table ${tid}`); return undefined; }
    if (!stepTableIndex.has(tid)) {
      if (nextFree >= N.tables) { warnings.push(`out of table slots for ${tid}`); return undefined; }
      stepTableIndex.set(tid, nextFree);
      writeTable(buf, nextFree, song.sound.tables[tid], warnings, `table ${tid}`, tableIds);
      nextFree++;
    }
    return stepTableIndex.get(tid);
  };

  // Phrases: one M8 phrase per (format phrase, chain transpose, track default instrument) because the
  // M8 step carries the instrument number and the chain transpose is applied by the M8 itself.
  // Transposes stay in the chain; only the instrument varies, so the key is phrase + default instrument.
  const phraseSlots = new Map(); // key -> index
  let nextPhrase = 0;
  const silentPhrase = () => {
    if (!phraseSlots.has('\0silent')) { phraseSlots.set('\0silent', nextPhrase); clearPhrase(buf, nextPhrase); nextPhrase++; }
    return phraseSlots.get('\0silent');
  };
  const phraseFor = (phraseId, defaultInst) => {
    const key = `${phraseId}\0${defaultInst || ''}`;
    if (phraseSlots.has(key)) return phraseSlots.get(key);
    if (nextPhrase >= N.phrases) throw new Error(`more than ${N.phrases} phrases needed`);
    const idx = nextPhrase++;
    phraseSlots.set(key, idx);
    writePhrase(buf, idx, c.phrases[phraseId], defaultInst, { instIndex, pitchShift, tableIndex, warnings, where: `phrase ${phraseId}` });
    return idx;
  };

  // Chains and song rows. A format row lasts its longest chain; shorter chains repeat. M8 chains hold
  // 16 phrases, so a long row becomes several consecutive M8 rows with equal-length chains in every track.
  const chainSlots = new Map();
  let nextChain = 0;
  const chainFor = (entries) => {
    const key = entries.map((e) => `${e.phrase}:${e.transpose}`).join(',');
    if (chainSlots.has(key)) return chainSlots.get(key);
    if (nextChain >= N.chains) throw new Error(`more than ${N.chains} chains needed`);
    const idx = nextChain++;
    chainSlots.set(key, idx);
    const base = OFS.chains + idx * 32;
    for (let i = 0; i < 16; i++) {
      const e = entries[i];
      buf[base + i * 2] = e ? e.phrase : EMPTY;
      buf[base + i * 2 + 1] = e ? signed(e.transpose) : 0;
    }
    return idx;
  };
  const songRows = []; // arrays of 8 chain ids
  for (const [ri, row] of c.song.rows.entries()) {
    let rowLen = 0;
    for (const chainId of Object.values(row)) if (chainId) rowLen = Math.max(rowLen, c.chains[chainId].rows.length);
    if (rowLen === 0) continue;
    const perTrack = c.tracks.map((t) => {
      const chainId = row[t.id];
      const entries = [];
      if (chainId) {
        const rows = c.chains[chainId].rows;
        for (let k = 0; k < rowLen; k++) {
          const r = rows[k % rows.length];
          entries.push({ phrase: phraseFor(r.phrase, t.instrument), transpose: r.transpose || 0 });
        }
      } else {
        for (let k = 0; k < rowLen; k++) entries.push({ phrase: silentPhrase(), transpose: 0 });
      }
      return entries;
    });
    for (let off = 0; off < rowLen; off += 16) {
      const m8row = new Array(N.tracks).fill(EMPTY);
      perTrack.forEach((entries, ti) => { m8row[ti] = chainFor(entries.slice(off, off + 16)); });
      songRows.push(m8row);
      if (songRows.length > N.rows) throw new Error(`song needs more than ${N.rows} M8 rows (format row ${ri})`);
    }
  }
  for (let r = 0; r < N.rows; r++) for (let t = 0; t < N.tracks; t++) buf[OFS.song + r * N.tracks + t] = r < songRows.length ? songRows[r][t] : EMPTY;

  return {
    bytes: buf,
    warnings,
    report: {
      name, version: FILE_VERSION, tempo: song.transport.bpm,
      tracks: c.tracks.map((t) => t.id), songRows: songRows.length, phrases: nextPhrase, chains: nextChain,
      instruments: instrumentReport, stepTables: Object.fromEntries(stepTableIndex),
    },
  };
}

function clearPhrase(buf, idx) {
  const base = OFS.phrases + idx * 16 * STEP_SIZE;
  for (let s = 0; s < 16; s++) {
    const o = base + s * STEP_SIZE;
    buf[o] = EMPTY; buf[o + 1] = EMPTY; buf[o + 2] = EMPTY;
    for (let f = 0; f < 3; f++) { buf[o + 3 + f * 2] = EMPTY; buf[o + 4 + f * 2] = 0; }
  }
}

function writePhrase(buf, idx, phrase, defaultInst, ctx) {
  clearPhrase(buf, idx);
  const base = OFS.phrases + idx * 16 * STEP_SIZE;
  for (let s = 0; s < 16; s++) {
    const cell = phrase.steps[s];
    if (!cell) continue;
    const o = base + s * STEP_SIZE;
    const instId = cell.inst ?? defaultInst;
    if (cell.lock) ctx.warnings.push(`${ctx.where}[${s}]: parameter locks (${Object.keys(cell.lock).join(', ')}) dropped; the M8 has no per-step locks`);
    if (cell.note !== undefined) {
      if (cell.note === 'OFF') buf[o] = NOTE_OFF;
      else {
        const midi = toMidi(cell.note) + (ctx.pitchShift.get(instId) || 0);
        const m8 = midi - MIDI_OFFSET;
        if (m8 < 0 || m8 > 127) ctx.warnings.push(`${ctx.where}[${s}]: note ${cell.note} outside the M8 range after shifting`);
        buf[o] = u8(clamp(m8, 0, 127));
        if (instId === undefined) ctx.warnings.push(`${ctx.where}[${s}]: note without an instrument`);
        else buf[o + 2] = ctx.instIndex.get(instId) ?? EMPTY;
        const accent = cell.fx?.accent || 0;
        const vel = (cell.vel ?? 1) * (1 + accent * 0.3);
        if (cell.vel !== undefined || accent) buf[o + 1] = u8(clamp(vel, 0, 1) * 0xfe);
      }
    }
    const fx = fxToM8(cell.fx, { tableIndex: ctx.tableIndex, warnings: ctx.warnings, where: `${ctx.where}[${s}]` });
    fx.forEach(([cmd, val], f) => { buf[o + 3 + f * 2] = cmd; buf[o + 4 + f * 2] = val; });
  }
}

function writeTable(buf, idx, table, warnings, where, tableIds) {
  const base = OFS.tables + idx * 16 * TABLE_STEP_SIZE;
  const rows = table.rows;
  const n = rows.length;
  if (n > 16) warnings.push(`${where}: ${n} rows, the M8 keeps 16`);
  const loop = table.loop ?? true;
  const tile = loop && n < 16 && 16 % n === 0;
  for (let r = 0; r < 16; r++) {
    const o = base + r * TABLE_STEP_SIZE;
    buf[o] = 0; buf[o + 1] = EMPTY;
    for (let f = 0; f < 3; f++) { buf[o + 2 + f * 2] = EMPTY; buf[o + 3 + f * 2] = 0; }
    const src = r < n ? rows[r] : tile ? rows[r % n] : null;
    if (!src) continue;
    buf[o] = signed(src.transpose || 0);
    if (src.volume !== undefined) buf[o + 1] = u8(src.volume * 0xfe);
    const fx = fxToM8(src.fx, { tableIndex: () => undefined, warnings, where: `${where}[${r}]` });
    fx.forEach(([cmd, val], f) => { buf[o + 2 + f * 2] = cmd; buf[o + 3 + f * 2] = val; });
  }
  // Loop control with HOP. Uncertain: see FORMAT-NOTES.md.
  if (!loop && n <= 16) {
    const last = Math.min(n, 16) - 1;
    setTableFx(buf, base, last, SEQ.HOP, last); // hold the last row
  } else if (loop && n < 16 && !tile) {
    setTableFx(buf, base, n, SEQ.HOP, 0); // jump back from the first unused row
    warnings.push(`${where}: ${n} rows loop via HOP on row ${n}; that row may sound for one tick`);
  }
}

function setTableFx(buf, base, row, cmd, val) {
  const o = base + row * TABLE_STEP_SIZE;
  for (let f = 0; f < 3; f++) {
    if (buf[o + 2 + f * 2] === EMPTY) { buf[o + 2 + f * 2] = cmd; buf[o + 3 + f * 2] = val; return; }
  }
}

/* ------------------------------------------------------------- the reader */

/** Read back the regions this module writes. Used by the round-trip tests and the CLI's --dump. */
export function readM8(buf) {
  const lsb = buf[OFS.version], msb = buf[OFS.version + 1];
  const version = `${msb & 0x0f}.${(lsb >> 4) & 0x0f}.${lsb & 0x0f}`;
  const name = buf.toString('latin1', OFS.name, OFS.name + 12).replace(/[\0\xff].*$/, '');
  const tempo = buf.readFloatLE(OFS.tempo);
  const song = [];
  for (let r = 0; r < N.rows; r++) {
    const row = Array.from(buf.subarray(OFS.song + r * 8, OFS.song + r * 8 + 8));
    if (row.some((x) => x !== EMPTY)) song.push({ row: r, chains: row.map((x) => (x === EMPTY ? null : x)) });
  }
  const chains = [];
  for (let i = 0; i < N.chains; i++) {
    const base = OFS.chains + i * 32;
    const rows = [];
    for (let s = 0; s < 16; s++) if (buf[base + s * 2] !== EMPTY) rows.push({ phrase: buf[base + s * 2], transpose: buf[base + s * 2 + 1] > 127 ? buf[base + s * 2 + 1] - 256 : buf[base + s * 2 + 1] });
    if (rows.length) chains.push({ index: i, rows });
  }
  const phrases = [];
  for (let i = 0; i < N.phrases; i++) {
    const base = OFS.phrases + i * 16 * STEP_SIZE;
    const steps = [];
    let any = false;
    for (let s = 0; s < 16; s++) {
      const o = base + s * STEP_SIZE;
      const note = buf[o], vel = buf[o + 1], inst = buf[o + 2];
      const fx = [];
      for (let f = 0; f < 3; f++) if (buf[o + 3 + f * 2] !== EMPTY) fx.push([buf[o + 3 + f * 2], buf[o + 4 + f * 2]]);
      if (note === EMPTY && vel === EMPTY && inst === EMPTY && !fx.length) { steps.push(null); continue; }
      any = true;
      steps.push({ note: note === EMPTY ? null : note >= 0x80 ? 'OFF' : note, vel: vel === EMPTY ? null : vel, inst: inst === EMPTY ? null : inst, fx });
    }
    if (any) phrases.push({ index: i, steps });
  }
  const tables = [];
  for (let i = 0; i < N.tables; i++) {
    const base = OFS.tables + i * 16 * TABLE_STEP_SIZE;
    const rows = [];
    let any = false;
    for (let r = 0; r < 16; r++) {
      const o = base + r * TABLE_STEP_SIZE;
      const tr = buf[o] > 127 ? buf[o] - 256 : buf[o];
      const vel = buf[o + 1];
      const fx = [];
      for (let f = 0; f < 3; f++) if (buf[o + 2 + f * 2] !== EMPTY) fx.push([buf[o + 2 + f * 2], buf[o + 3 + f * 2]]);
      if (tr !== 0 || vel !== EMPTY || fx.length) any = true;
      rows.push({ transpose: tr, vel: vel === EMPTY ? null : vel, fx });
    }
    if (any) tables.push({ index: i, rows });
  }
  const instruments = [];
  for (let i = 0; i < N.instruments; i++) {
    const base = OFS.instruments + i * INSTRUMENT_SIZE;
    const kind = buf[base];
    if (kind === EMPTY) continue;
    const b = buf.subarray(base, base + INSTRUMENT_SIZE);
    const paramsOfs = kind === KIND.FMSYNTH ? 51 : 23;
    instruments.push({
      index: i, kind, name: b.toString('latin1', 1, 13).replace(/[\0\xff].*$/, ''), transposeOn: b[13] === 1, tableTick: b[14],
      pitch: b[16] > 127 ? b[16] - 256 : b[16], fine: b[17],
      engine: Array.from(b.subarray(18, paramsOfs)),
      filterType: b[paramsOfs], cutoff: b[paramsOfs + 1], res: b[paramsOfs + 2], amp: b[paramsOfs + 3], limit: b[paramsOfs + 4],
      pan: b[paramsOfs + 5], dry: b[paramsOfs + 6], mfx: b[paramsOfs + 7], delay: b[paramsOfs + 8], reverb: b[paramsOfs + 9],
      eq: b[62], mods: [0, 1, 2, 3].map((k) => readMod(b.subarray(63 + k * 6, 69 + k * 6))),
    });
  }
  return { version, name, tempo, song, chains, phrases, tables, instruments, size: buf.length };
}
