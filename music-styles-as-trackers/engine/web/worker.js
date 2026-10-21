/**
 * Renders songs and runs the generator off the main thread.
 * Messages in: {type:'render', song, maxSeconds} | {type:'generate', style, seed, minutes}
 * Messages out: {type:'progress', value} | {type:'rendered', left, right, sampleRate, starts, rows} | {type:'generated', song} | {type:'error', message}
 */
import { renderSong } from '../lib/sequencer.js';
import { generateSong } from '../../endless-techno/lib/generate.js';

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'generate') {
      const song = generateSong(m.style, { seed: m.seed, minutes: m.minutes });
      self.postMessage({ type: 'generated', song });
    } else if (m.type === 'render') {
      let last = 0;
      const r = renderSong(m.song, { maxSeconds: m.maxSeconds, onProgress: (v) => { if (v - last > 0.02) { last = v; self.postMessage({ type: 'progress', value: v }); } } });
      self.postMessage({ type: 'rendered', left: r.left, right: r.right, sampleRate: r.sampleRate, starts: r.grid.starts, rows: r.resolved.rows }, [r.left.buffer, r.right.buffer, r.grid.starts.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};
