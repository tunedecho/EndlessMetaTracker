# Tracker Engine

A tracker engine that plays Tracker Song Format documents. Phase 4 in `../ROADMAP.md`, built early because every other phase needed something that makes sound. The idea is in `../docs/ideas/new-tracker-engine.md`.

Plain JavaScript modules with no build step and no dependencies, so the same code renders files in Node and plays in a web page.

## Use

```sh
# render a song to WAV (and MP3 with ffmpeg), print a measurement report
node bin/render.js ../format/examples/minimal-techno-loop.json out.wav --mp3 --report

# measure a song: per-section band levels and each track's octave-band spectrum
node bin/analyze.js ../endless-techno/previews/hypnotic-techno-3.json --seconds 200

# browser player with the pattern grid, a playhead, and in-page generation
npm run web      # then open http://localhost:8080/engine/web/
```

From code:

```js
import { renderSong, encodeWav, analyze } from '@tracker/engine';
const r = renderSong(song, { sampleRate: 44100 });   // {left, right, sampleRate, grid, seconds}
writeFileSync('out.wav', encodeWav(r.left, r.right, r.sampleRate));
console.log(analyze.report(r.left, r.right, r.sampleRate));
```

## What is inside

| File | Contents |
|---|---|
| `lib/dsp.js` | PolyBLEP oscillators (sine, triangle, saw, square, pulse), a TPT state-variable filter, ADSR, LFO, white/pink/brown noise, soft clip, drive, equal-power pan |
| `lib/voices.js` | The six engines: `analog` (two oscillators, sub, noise, unison up to 7 with stereo spread, glide), `fm` (two operators, feedback, modulator envelope), `kick`, `clap`, `hihat` (six-oscillator metallic cluster plus noise), `noise`. All share filter, amp envelope, LFO, tables, and live track controls |
| `lib/effects.js` | Tempo-synced stereo delay with ping-pong and damping, Freeverb-style reverb with predelay, master highpass, peak limiter with soft clip |
| `lib/sequencer.js` | Step grid from tempo and swing (sample-accurate; tempo commands change the grid), event scheduling (retrig, nudge, cut, slide, chance, tables), and `renderSong`, which drives a Player over a whole song |
| `lib/player.js` | The streaming `Player`: rows are appended over time (`appendRow`) and audio is pulled in blocks (`render(n)`); voices, delay, and reverb carry across rows. This is what endless mode runs on |
| `lib/wav.js` | 16-bit WAV encode and decode, browser-safe |
| `lib/analyze.js` | Measurements for sessions without ears: peak, RMS, clipping, band balance, onset detection |
| `web/` | The browser player: renders in a Web Worker, plays through Web Audio, shows rows and the phrase grid with a playhead, generates songs in the page, downloads WAVs, and has an **Endless** mode that streams generated sections gaplessly with live energy up/down |

Timing: step boundaries are computed in samples before rendering, events fire at their exact sample, and blocks are split at event boundaries. Swing delays every second step. One voice per track with up to four releasing voices behind it, so a new note cuts the old one's gate but lets its release ring.

Levels: every track has 6 dB of headroom before the mix bus, the master limiter catches peaks, and a 6-minute generated techno song renders with no clipped samples. Rendering runs about 5x realtime for a full techno mix and 50x for a single voice.

## Tests

`npm test` checks oscillator range and filter stability at full resonance, envelope behaviour, the step grid under swing and tempo changes, kick onsets on the grid, retrig and nudge timing, pitch by zero-crossing count, table transposes, slides, track commands changing a playing note, loop repetition, WAV round-trips, and that every example renders without clipping.

## Decisions and next steps

- **Offline first, streaming second.** A renderer that writes files is the smallest core that can be verified without listening. The streaming Player grew out of it: the browser's endless mode renders each generated section in a worker a little ahead of playback and schedules the buffers back to back, so there is no gap and the effect tails continue. An AudioWorklet version would cut latency for live control from "next section" to "next step"; it is not needed yet.
- **Engines are parameter sets.** Every engine's parameters are in the format's schema, so a sound is data. A sampler engine is the obvious missing one for drums.
- **Not built:** a tracker editing UI, MIDI input, plugin or hardware targets. The idea doc asks where it should run first; this says browser for playing and editing, with the offline renderer for batch work.
