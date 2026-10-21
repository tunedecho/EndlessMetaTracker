/**
 * Audio worklet for live play, on the same Player, voices, and master bus as
 * the renderer. Two players share the output:
 *
 * - a keyboard player with no rows, played note by note (the synth
 *   playground, and step audition in the tracker player);
 * - a song player that streams song rows as they come due, so edits to the
 *   composition are heard the next time a row is appended.
 *
 * Messages in:
 *   {type:'load', sound, bpm, stepsPerBeat, voices?}   rebuild the keyboard player (new sound or master)
 *   {type:'update', id, inst}                 change an instrument in place
 *   {type:'on', voice, id, note, vel, lock?}  start a note on a voice (track), with optional parameter locks
 *   {type:'off', voice}                       release a voice
 *   {type:'repeat', id, note, every, gate}    retrigger a note every `every` steps (every 0 stops)
 *   {type:'play', song, row, loop}            stream a song from a row; loop repeats that row
 *   {type:'composition', composition}         use this composition for rows appended from now on
 *   {type:'stop'}                             stop the song, letting tails ring
 * Messages out:
 *   {type:'pos', row, step}                   the song row and step now playing, about 30 times a second
 *   {type:'ended'}                            the song played to its end
 */
import { Player } from '../lib/player.js';

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
      this.song = { player: new Player(header, { sampleRate }), comp: song.composition, next: m.row, loop: !!m.loop, loopTarget: song.transport.loop, segs: [], ended: false, stopAt: -1 };
      return;
    }
    if (m.type === 'composition') { if (this.song) this.song.comp = m.composition; return; }
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

  /** Append the next song row; at the end, jump to the loop row or finish. */
  appendNext(s) {
    const rows = s.comp.song.rows;
    if (s.next >= rows.length) {
      if (s.loopTarget !== undefined && s.loopTarget < rows.length) s.next = s.loopTarget;
      else { s.player.end(); s.ended = true; return; }
    }
    const r = s.next;
    const sec = (s.comp.song.sections || []).find((x) => x.row === r);
    const info = s.player.appendRow(rows[r], s.comp, { name: sec?.name, energy: sec?.energy });
    if (info.steps) s.segs.push({ row: r, step: info.step, steps: info.steps });
    else if (s.loop) { s.player.end(); s.ended = true; } // an empty row has nothing to loop
    if (!s.loop) s.next++;
  }

  process(_, outputs) {
    const out = outputs[0];
    if (out.length < 2) return true;
    const n = out[0].length;
    const s = this.song;
    if (s) {
      const p = s.player;
      for (let k = 0; k < 64 && s.stopAt < 0 && !s.ended && p.queued < LOOKAHEAD * sampleRate; k++) this.appendNext(s);
      p.render(n, out[0], out[1]);
      if (s.stopAt < 0 && currentTime - this.lastPost > 0.03) {
        this.lastPost = currentTime;
        while (s.segs.length > 1 && s.segs[1].step <= p.stepCursor) s.segs.shift();
        const seg = s.segs[0];
        if (seg) this.port.postMessage({ type: 'pos', row: seg.row, step: Math.min(p.stepCursor - seg.step, seg.steps - 1) });
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
