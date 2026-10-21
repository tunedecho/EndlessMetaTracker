/**
 * Standard MIDI File export (format 1) and a small parser for round-trip tests.
 *
 * The timeline comes from `resolve()` in the shared format, so the MIDI file
 * follows the same row/chain/phrase semantics as the engine. Swing, tempo
 * commands, retrig, nudge, cut and OFF are all honoured.
 *
 * Why MIDI first: a .mid file can drive an M8 (or any synth) today through a
 * DAW or a hardware sequencer, with no dependence on the M8's binary format.
 * Sound design stays on the device, which is the trade-off recorded in the plan.
 */
import { resolve, stepSeconds, Random } from '@tracker/format';

export const PPQ = 480;
const DRUM_ENGINES = new Set(['kick', 'clap', 'hihat', 'noise']);

/** General MIDI drum notes for the drum engines. */
export const GM_DRUM_NOTES = { kick: 36, clap: 39, hihat: 42, hihatOpen: 46, noise: 49 };

/** CC numbers for the track commands that have a conventional MIDI mapping. */
export const CC = { cutoff: 74, resonance: 71, volume: 7, pan: 10 };

function vlq(n) {
  const bytes = [n & 0x7f];
  n >>>= 7;
  while (n > 0) { bytes.unshift((n & 0x7f) | 0x80); n >>>= 7; }
  return bytes;
}

function u32(n) { return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]; }
function u16(n) { return [(n >>> 8) & 0xff, n & 0xff]; }
function str(s) { return Array.from(Buffer.from(s, 'latin1')); }

/** Clamp a MIDI data byte. */
const b7 = (x) => Math.max(0, Math.min(127, Math.round(x)));

/**
 * Choose a GM drum note for a drum instrument. Open hats get the open-hat note.
 */
function drumNote(inst) {
  if (inst.engine === 'hihat') return inst.params?.open ? GM_DRUM_NOTES.hihatOpen : GM_DRUM_NOTES.hihat;
  return GM_DRUM_NOTES[inst.engine] ?? 38;
}

/**
 * Turn a song into a list of MIDI tracks, each a sorted list of timed messages.
 * Exposed for tests; `encodeMidi` serialises it.
 *
 * @param {object} song valid tracker-song/0.1
 * @param {{gmDrums?: boolean, loops?: number}} [opts]
 */
export function songToMidiEvents(song, opts = {}) {
  const gmDrums = opts.gmDrums ?? true;
  const resolved = resolve(song, { loops: opts.loops || 0 });
  const { transport, events, totalSteps } = resolved;
  const ticksPerStep = PPQ / transport.stepsPerBeat;
  const swing = transport.swing || 0;
  const stepTick = (s) => Math.round(s * ticksPerStep + (s % 2 === 1 ? swing * ticksPerStep : 0));

  // Channel assignment: drum tracks (default instrument is a drum engine, and GM drums on) share
  // channel 10 (index 9); other tracks take the remaining channels in order.
  const instruments = song.sound.instruments;
  const tracks = song.composition.tracks;
  const melodicChannels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
  let nextMelodic = 0;
  const channelOf = tracks.map((t) => {
    const inst = instruments[t.instrument];
    if (gmDrums && inst && DRUM_ENGINES.has(inst.engine)) return 9;
    const ch = melodicChannels[nextMelodic % melodicChannels.length];
    nextMelodic++;
    return ch;
  });

  // Tempo track (track 0 in a format-1 file): tempo changes and the time signature.
  const tempoTrack = [];
  const addTempo = (tick, bpm) => tempoTrack.push({ tick, type: 'tempo', bpm, order: 0 });
  addTempo(0, transport.bpm);
  tempoTrack.push({ tick: 0, type: 'timesig', num: 4, den: 4, order: 1 });
  tempoTrack.push({ tick: 0, type: 'trackName', text: song.meta?.title || 'Tracker Song', order: 2 });

  const rnd = new Random(song.meta?.seed ?? 1);
  const perTrack = tracks.map((t) => [{ tick: 0, type: 'trackName', text: t.name || t.id, order: 0 }]);
  const open = tracks.map(() => []); // notes sounding on each track: {note, channel}
  const closeAll = (ti, tick) => {
    for (const n of open[ti]) perTrack[ti].push({ tick, type: 'off', channel: n.channel, note: n.note, order: 1 });
    open[ti] = [];
  };

  for (const e of events) {
    const ti = e.track;
    const ch = channelOf[ti];
    const t0 = stepTick(e.step);
    const fx = e.fx || {};
    if (fx.tempo !== undefined) addTempo(t0, fx.tempo);
    for (const [name, cc] of Object.entries(CC)) {
      if (fx[name] === undefined) continue;
      const v = name === 'pan' ? (fx[name] + 1) * 63.5 : fx[name] * 127;
      perTrack[ti].push({ tick: t0, type: 'cc', channel: ch, cc, value: b7(v), order: 2 });
    }
    if (e.note === null || e.note === undefined) continue;
    if (e.note === 'OFF') { closeAll(ti, t0); continue; }
    if (fx.chance !== undefined && !rnd.chance(fx.chance)) continue;
    const inst = instruments[e.inst];
    if (!inst) continue;
    const isDrum = ch === 9;
    const note = b7(isDrum ? drumNote(inst) : e.note);
    const vel = b7(1 + (e.vel ?? 1) * (1 + (fx.accent || 0) * 0.3) * 126);
    const retrig = Math.max(1, fx.retrig || 1);
    const spacing = ticksPerStep / retrig;
    const nudge = (fx.nudge || 0) * ticksPerStep;
    for (let k = 0; k < retrig; k++) {
      const on = Math.round(t0 + nudge + k * spacing);
      closeAll(ti, on);
      perTrack[ti].push({ tick: on, type: 'on', channel: ch, note, velocity: k ? b7(vel * 0.85) : vel, order: 3 });
      open[ti].push({ note, channel: ch });
      const cutTicks = fx.cut !== undefined ? fx.cut * spacing : retrig > 1 ? spacing : isDrum ? ticksPerStep : null;
      if (cutTicks !== null) closeAll(ti, Math.round(on + cutTicks));
    }
  }
  // The end-of-track comes after the last note-off, which a nudged or swung note on the last step
  // can push past the nominal end.
  let endTick = stepTick(totalSteps);
  tracks.forEach((_, ti) => closeAll(ti, endTick));
  for (const t of perTrack) for (const e of t) endTick = Math.max(endTick, e.tick);
  tempoTrack.push({ tick: endTick, type: 'end', order: 9 });
  for (const t of perTrack) t.push({ tick: endTick, type: 'end', order: 9 });

  const sortEvents = (list) => list.sort((a, b) => a.tick - b.tick || a.order - b.order);
  return { tempoTrack: sortEvents(tempoTrack), tracks: perTrack.map(sortEvents), channelOf, ticksPerStep, endTick };
}

function encodeTrack(events) {
  const out = [];
  let last = 0;
  for (const e of events) {
    out.push(...vlq(Math.max(0, e.tick - last)));
    last = e.tick;
    switch (e.type) {
      case 'tempo': { const us = Math.round(60000000 / e.bpm); out.push(0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff); break; }
      case 'timesig': out.push(0xff, 0x58, 0x04, e.num, Math.log2(e.den), 24, 8); break;
      case 'trackName': { const s = str(e.text); out.push(0xff, 0x03, ...vlq(s.length), ...s); break; }
      case 'on': out.push(0x90 | e.channel, e.note, e.velocity); break;
      case 'off': out.push(0x80 | e.channel, e.note, 0); break;
      case 'cc': out.push(0xb0 | e.channel, e.cc, e.value); break;
      case 'end': out.push(0xff, 0x2f, 0x00); break;
      default: throw new Error(`unknown event ${e.type}`);
    }
  }
  return Buffer.from([...str('MTrk'), ...u32(out.length), ...out]);
}

/** Encode a song as a format-1 Standard MIDI File. Returns a Buffer. */
export function encodeMidi(song, opts = {}) {
  const m = songToMidiEvents(song, opts);
  const chunks = [encodeTrack(m.tempoTrack), ...m.tracks.map(encodeTrack)];
  const header = Buffer.from([...str('MThd'), ...u32(6), ...u16(1), ...u16(chunks.length), ...u16(PPQ)]);
  return Buffer.concat([header, ...chunks]);
}

/**
 * Minimal SMF parser: enough to read back what `encodeMidi` writes (and most
 * simple files). Returns {format, ppq, tracks: [[{tick, type, ...}]]}.
 */
export function parseMidi(buf) {
  let pos = 0;
  const readStr = (n) => { const s = buf.toString('latin1', pos, pos + n); pos += n; return s; };
  const readU32 = () => { const v = buf.readUInt32BE(pos); pos += 4; return v; };
  const readU16 = () => { const v = buf.readUInt16BE(pos); pos += 2; return v; };
  const readVlq = () => { let v = 0, b; do { b = buf[pos++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
  if (readStr(4) !== 'MThd') throw new Error('not a MIDI file');
  const hlen = readU32();
  const format = readU16(); const ntracks = readU16(); const ppq = readU16();
  pos += hlen - 6;
  const tracks = [];
  for (let t = 0; t < ntracks; t++) {
    if (readStr(4) !== 'MTrk') throw new Error('bad track chunk');
    const len = readU32();
    const end = pos + len;
    const events = [];
    let tick = 0, status = 0;
    while (pos < end) {
      tick += readVlq();
      let b = buf[pos];
      if (b & 0x80) { status = b; pos++; }
      if (status === 0xff) {
        const type = buf[pos++]; const n = readVlq(); const data = buf.subarray(pos, pos + n); pos += n;
        if (type === 0x51) events.push({ tick, type: 'tempo', bpm: 60000000 / ((data[0] << 16) | (data[1] << 8) | data[2]) });
        else if (type === 0x03) events.push({ tick, type: 'trackName', text: data.toString('latin1') });
        else if (type === 0x2f) events.push({ tick, type: 'end' });
        else if (type === 0x58) events.push({ tick, type: 'timesig', num: data[0], den: 2 ** data[1] });
        else events.push({ tick, type: 'meta', meta: type });
      } else if (status === 0xf0 || status === 0xf7) { const n = readVlq(); pos += n; }
      else {
        const kind = status & 0xf0, channel = status & 0x0f;
        const d1 = buf[pos++];
        const d2 = kind === 0xc0 || kind === 0xd0 ? undefined : buf[pos++];
        if (kind === 0x90 && d2 > 0) events.push({ tick, type: 'on', channel, note: d1, velocity: d2 });
        else if (kind === 0x80 || kind === 0x90) events.push({ tick, type: 'off', channel, note: d1 });
        else if (kind === 0xb0) events.push({ tick, type: 'cc', channel, cc: d1, value: d2 });
        else events.push({ tick, type: 'other', status, d1, d2 });
      }
    }
    pos = end;
    tracks.push(events);
  }
  return { format, ppq, tracks };
}
