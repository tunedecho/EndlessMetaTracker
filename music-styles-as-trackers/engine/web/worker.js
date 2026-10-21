/**
 * Renders songs and runs the generator off the main thread.
 *
 * Messages in:
 *   {type:'render', song}                          whole-song render
 *   {type:'generate', style, seed, minutes}        fixed song from a style
 *   {type:'endless-start', style, seed}            begin an endless session
 *   {type:'endless-next', energy}                  write the next section
 * Messages out:
 *   {type:'progress', value} | {type:'rendered', ...} | {type:'generated', song}
 *   {type:'endless-ready', header}                 the song header: transport, sound, no rows yet
 *   {type:'endless-section', row, section, index, tracks, phrases, chains}   one new row, with the phrases and chains it introduced
 *   {type:'error', message}
 */
import { renderSong } from '../lib/sequencer.js';
import { generateSong, Session } from '../../endless-techno/lib/generate.js';

let session = null;

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
      self.postMessage({ type: 'endless-ready', header: session.header() });
    } else if (m.type === 'endless-next') {
      if (!session) throw new Error('no endless session');
      // Only the writing happens here; the page adds the section to its song and plays it live.
      self.postMessage({ type: 'endless-section', ...session.next({ energy: m.energy || 0 }) });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};
