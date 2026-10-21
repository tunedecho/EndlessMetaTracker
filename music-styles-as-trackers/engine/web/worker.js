/**
 * Renders songs and runs the generator off the main thread.
 *
 * Messages in:
 *   {type:'render', song}                          whole-song render
 *   {type:'generate', style, seed, minutes}        fixed song from a style
 *   {type:'endless-start', style, seed}            begin an endless session
 *   {type:'endless-next', energy}                  write and render the next section
 * Messages out:
 *   {type:'progress', value} | {type:'rendered', ...} | {type:'generated', song}
 *   {type:'section', index, section, startSample, samples, sampleRate, left, right, tracks, events, steps, stepStarts}
 *   {type:'error', message}
 */
import { renderSong } from '../lib/sequencer.js';
import { Player } from '../lib/player.js';
import { generateSong, Session } from '../../endless-techno/lib/generate.js';
import { resolve } from '../../format/lib/core.js';

let session = null, player = null;

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'generate') {
      self.postMessage({ type: 'generated', song: generateSong(m.style, { seed: m.seed, minutes: m.minutes }) });
    } else if (m.type === 'render') {
      let last = 0;
      const r = renderSong(m.song, { maxSeconds: m.maxSeconds, onProgress: (v) => { if (v - last > 0.02) { last = v; self.postMessage({ type: 'progress', value: v }); } } });
      self.postMessage({ type: 'rendered', left: r.left, right: r.right, sampleRate: r.sampleRate, starts: r.grid.starts, rows: r.resolved.rows }, [r.left.buffer, r.right.buffer, r.grid.starts.buffer]);
    } else if (m.type === 'endless-start') {
      session = new Session(m.style, { seed: m.seed });
      player = new Player(session.header(), { sampleRate: 44100, seed: m.seed });
      self.postMessage({ type: 'endless-ready', bpm: session.bpm, title: session.header().meta.title });
    } else if (m.type === 'endless-next') {
      if (!session) throw new Error('no endless session');
      const r = session.next({ energy: m.energy || 0 });
      const comp = { phrases: session.phrases, chains: session.chains, tracks: r.tracks };
      const info = player.appendRow(r.row, comp, r.section);
      const n = Math.round(info.samples);
      const { left, right } = player.render(n);
      // Events of this row, relative to its first step, for the grid display.
      const mini = { format: 'tracker-song/0.1', transport: { ...player.transport, bpm: session.bpm }, sound: session.sound, composition: { tracks: r.tracks, phrases: session.phrases, chains: session.chains, song: { rows: [r.row] } } };
      const events = resolve(mini).events.filter((ev) => ev.step < player.transport.phraseLength).map((ev) => ({ step: ev.step, track: ev.track, note: ev.note, vel: ev.vel, fx: ev.fx }));
      const stepStarts = Float64Array.from(player.stepStarts.slice(info.step, info.step + info.steps).map((s) => s - info.startSample));
      self.postMessage({ type: 'section', index: r.index, section: r.section, row: r.row, startSample: info.startSample, samples: n, sampleRate: player.sampleRate, left, right, tracks: r.tracks, events, steps: info.steps, stepStarts }, [left.buffer, right.buffer, stepStarts.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};
