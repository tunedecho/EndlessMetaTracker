/**
 * Audio worklet for live play, on the same Player, voices, and master bus as
 * the renderer. Two players share the output:
 *
 * - a keyboard player with no rows, played note by note (the synth
 *   playground, and step audition in the tracker player);
 * - a song player that streams songs a bar at a time, half a second before
 *   each bar is due, so edits to the composition (and macros) are heard
 *   within about a bar.
 *
 * Messages in:
 *   {type:'load', sound, bpm, stepsPerBeat, voices?}   rebuild the keyboard player (new sound or master)
 *   {type:'update', id, inst}                 change an instrument in place
 *   {type:'on', voice, id, note, vel, lock?}  start a note on a voice (track), with optional parameter locks
 *   {type:'off', voice}                       release a voice
 *   {type:'repeat', id, note, every, gate}    retrigger a note every `every` steps (every 0 stops)
 *   {type:'play', song, row, loop, endless}   stream a song from a row; loop repeats that row; endless waits for more rows instead of ending
 *   {type:'composition', composition}         use this composition for rows appended from now on
 *   {type:'sound', sound}                     use these instruments and tables from the next note (a jam adds instruments)
 *   {type:'stop'}                             stop the song, letting tails ring
 * Messages out:
 *   {type:'pos', row, step}                   the song row and step now playing, about 30 times a second
 *   {type:'ended'}                            the song played to its end
 */
import { Player } from '../lib/player.js';
import { rowSteps } from '../../format/lib/core.js';

const VOICES = 9; // default: eight for the keyboard, the last for repeat
const LOOKAHEAD = 0.5; // seconds of song appended ahead of playback
const TAIL = 4; // seconds a stopped song keeps rendering its tails

class SynthProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.player = null;
    this.repeat = null;
    this.voices = VOICES;
    this.song = null;
    this.keysL = new Float32Array(128);
    this.keysR = new Float32Array(128);
    this.lastPost = 0;
    this.port.onmessage = (e) => this.message(e.data);
  }

  message(m) {
    if (m.type === 'load') {
      this.voices = m.voices || VOICES;
      const tracks = Array.from({ length: this.voices }, (_, i) => ({ id: `v${i}` }));
      this.player = new Player({ transport: { bpm: m.bpm, stepsPerBeat: m.stepsPerBeat || 4 }, sound: m.sound, composition: { tracks } }, { sampleRate });
      if (this.repeat) this.repeat.next = 0;
      return;
    }
    if (m.type === 'play') {
      const { song } = m;
      const header = { meta: song.meta, transport: song.transport, sound: song.sound, composition: { tracks: song.composition.tracks } };
      this.song = { player: new Player(header, { sampleRate }), comp: song.composition, next: m.row, bar: 0, loop: !!m.loop, endless: !!m.endless, loopTarget: song.transport.loop, segs: [], ended: false, stopAt: -1 };
      return;
    }
    if (m.type === 'composition') { if (this.song) this.song.comp = m.composition; return; }
    if (m.type === 'sound') {
      for (const p of [this.song?.player, this.player]) if (p) { p.sound.instruments = m.sound.instruments; p.sound.tables = m.sound.tables || {}; }
      return;
    }
    if (m.type === 'stop') {
      const s = this.song;
      if (s && s.stopAt < 0) { s.player.stop(); s.stopAt = s.player.pos; }
      return;
    }
    const p = this.player;
    if (!p) return;
    if (m.type === 'update') p.updateInstrument(m.id, m.inst);
    else if (m.type === 'on') p.noteOn(m.voice, m.id, m.note, m.vel ?? 1, m.lock || null);
    else if (m.type === 'off') p.noteOff(m.voice);
    else if (m.type === 'repeat') {
      if (!m.every) { if (this.repeat) p.noteOff(this.voices - 1); this.repeat = null; }
      else this.repeat = { ...m, next: this.repeat ? this.repeat.next : p.pos, off: Infinity };
    }
  }

  /**
   * Append the next bar of the song: at the end of a row, the next row (or the
   * same one when looping); at the end of the song, the loop row, a wait for
   * more rows (endless), or the end. Returns false when it appended nothing.
   */
  appendNext(s) {
    const rows = s.comp.song.rows;
    if (s.next >= rows.length) {
      if (s.endless) return false; // the page adds rows as it writes them
      if (s.loopTarget !== undefined && s.loopTarget < rows.length) { s.next = s.loopTarget; s.bar = 0; }
      else { s.player.end(); s.ended = true; return false; }
    }
    const r = s.next;
    const row = rows[r];
    const pl = s.player.transport.phraseLength;
    const bars = rowSteps({ transport: s.player.transport, composition: s.comp }, row) / pl;
    if (!bars) { // an empty row has nothing to play
      if (s.loop) { s.player.end(); s.ended = true; return false; }
      s.next++; s.bar = 0;
      return true;
    }
    // One bar of the row: each track plays the phrase its chain has at this bar (shorter chains repeat).
    const b = s.bar;
    const barRow = {}, chains = {};
    for (const [trackId, chainId] of Object.entries(row)) {
      if (!chainId) continue;
      const chain = s.comp.chains[chainId];
      chains[`bar.${trackId}`] = { rows: [chain.rows[b % chain.rows.length]] };
      barRow[trackId] = `bar.${trackId}`;
    }
    const sec = b === 0 ? (s.comp.song.sections || []).find((x) => x.row === r) : null;
    const info = s.player.appendRow(barRow, { tracks: s.comp.tracks, phrases: s.comp.phrases, chains }, { name: sec?.name, energy: sec?.energy });
    s.segs.push({ row: r, step: info.step, steps: info.steps, offset: b * pl, rowSteps: bars * pl });
    if (++s.bar >= bars) { s.bar = 0; if (!s.loop) s.next++; }
    return true;
  }

  process(_, outputs) {
    const out = outputs[0];
    if (out.length < 2) return true;
    const n = out[0].length;
    const s = this.song;
    if (s) {
      const p = s.player;
      for (let k = 0; k < 64 && s.stopAt < 0 && !s.ended && p.queued < LOOKAHEAD * sampleRate; k++) if (!this.appendNext(s)) break;
      p.render(n, out[0], out[1]);
      if (s.stopAt < 0 && currentTime - this.lastPost > 0.03) {
        this.lastPost = currentTime;
        while (s.segs.length > 1 && s.segs[1].step <= p.stepCursor) s.segs.shift();
        const seg = s.segs[0];
        if (seg) this.port.postMessage({ type: 'pos', row: seg.row, step: Math.min(seg.offset + p.stepCursor - seg.step, seg.rowSteps - 1) });
      }
      if (s.ended && s.stopAt < 0 && p.pos >= p.rowStart) { s.stopAt = p.pos; this.port.postMessage({ type: 'ended' }); }
      if (s.stopAt >= 0 && p.pos > s.stopAt + TAIL * sampleRate) this.song = null;
    }
    const p = this.player;
    if (!p) return true;
    const r = this.repeat;
    if (r) {
      const step = p.currentStepLen;
      if (p.pos >= r.off) { p.noteOff(this.voices - 1); r.off = Infinity; }
      if (p.pos >= r.next) {
        p.noteOn(this.voices - 1, r.id, r.note, 1);
        r.off = p.pos + r.every * step * r.gate;
        r.next = Math.max(r.next + r.every * step, p.pos);
      }
    }
    if (this.keysL.length < n) { this.keysL = new Float32Array(n); this.keysR = new Float32Array(n); }
    p.render(n, this.keysL, this.keysR);
    for (let i = 0; i < n; i++) { out[0][i] += this.keysL[i]; out[1][i] += this.keysR[i]; }
    return true;
  }
}

registerProcessor('synth', SynthProcessor);
