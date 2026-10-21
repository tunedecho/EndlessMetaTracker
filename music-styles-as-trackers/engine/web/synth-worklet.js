/**
 * Audio worklet for the synth playground: a streaming Player with no rows,
 * played live from the keyboard. Same voices and master bus as the renderer.
 *
 * Messages in:
 *   {type:'load', sound, bpm, stepsPerBeat}   rebuild the player (new sound or master)
 *   {type:'update', id, inst}                 change an instrument in place
 *   {type:'on', voice, id, note, vel}         start a note on a voice (track)
 *   {type:'off', voice}                       release a voice
 *   {type:'repeat', id, note, every, gate}    retrigger a note every `every` steps (every 0 stops)
 */
import { Player } from '../lib/player.js';

const VOICES = 9; // eight for the keyboard, the last for repeat

class SynthProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.player = null;
    this.repeat = null;
    this.port.onmessage = (e) => this.message(e.data);
  }

  message(m) {
    if (m.type === 'load') {
      const tracks = Array.from({ length: VOICES }, (_, i) => ({ id: `v${i}` }));
      this.player = new Player({ transport: { bpm: m.bpm, stepsPerBeat: m.stepsPerBeat || 4 }, sound: m.sound, composition: { tracks } }, { sampleRate });
      if (this.repeat) this.repeat.next = 0;
      return;
    }
    const p = this.player;
    if (!p) return;
    if (m.type === 'update') p.updateInstrument(m.id, m.inst);
    else if (m.type === 'on') p.noteOn(m.voice, m.id, m.note, m.vel ?? 1);
    else if (m.type === 'off') p.noteOff(m.voice);
    else if (m.type === 'repeat') {
      if (!m.every) { if (this.repeat) p.noteOff(VOICES - 1); this.repeat = null; }
      else this.repeat = { ...m, next: this.repeat ? this.repeat.next : p.pos, off: Infinity };
    }
  }

  process(_, outputs) {
    const out = outputs[0];
    const p = this.player;
    if (!p || out.length < 2) return true;
    const n = out[0].length;
    const r = this.repeat;
    if (r) {
      const step = p.currentStepLen;
      if (p.pos >= r.off) { p.noteOff(VOICES - 1); r.off = Infinity; }
      if (p.pos >= r.next) {
        p.noteOn(VOICES - 1, r.id, r.note, 1);
        r.off = p.pos + r.every * step * r.gate;
        r.next = Math.max(r.next + r.every * step, p.pos);
      }
    }
    p.render(n, out[0], out[1]);
    return true;
  }
}

registerProcessor('synth', SynthProcessor);
