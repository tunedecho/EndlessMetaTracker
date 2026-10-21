# Tracker Engine

A tracker engine that plays Tracker Song Format documents. Phase 4 in `../ROADMAP.md`, built early because every other phase needed something that makes sound. The idea is in `../docs/ideas/new-tracker-engine.md`.

Plain JavaScript modules with no build step and no dependencies, so the same code renders files in Node and plays in a web page.

## Use

```sh
# render a song to WAV (and MP3 with ffmpeg), print a measurement report
node bin/render.js ../format/examples/minimal-techno-loop.json out.wav --mp3 --report

# measure a song: per-section band levels and each track's octave-band spectrum
node bin/analyze.js ../endless-techno/previews/hypnotic-techno-3.json --seconds 200

# browser player and step editor: the whole-row grid, live playback, editing, in-page generation
npm run web      # then open http://localhost:8080/engine/web/ (synth playground: synth.html, parameter cube: cube.html)
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
| `web/` | The browser player and step editor. The grid shows every step of a song row, banded by phrase with each track's phrase id and transpose. Songs play live in an AudioWorklet (`synth-worklet.js`) from any row, or loop one row; only the grid scrolls, so the macros and scope stay in reach, and **follow playhead** (F) chooses whether playback moves the grid; edits reach the player as a new composition and are heard the next time their row is appended. The cursor steps through rows and plays each step; edit mode writes notes, OFFs, velocities, instruments, and commands into the phrase behind the step, with undo; the step panel's **All parameters** section locks any instrument parameter on the step's note (a slider per parameter, built from the schema; ◆ in the grid marks a locked step), and **Make unique here** copies a shared phrase first (`format/lib/edit.js`). A Web Worker renders WAVs and generates songs. **Endless** mode is a song that grows: the worker writes one section a bar before the last one ends, the page adds it as a new row, and it streams live like any song, so the grid, editing, follow, the weirdness macros (on rows not yet played), and the energy − and + all reach the very next section; JSON saves the run so far |
| `web/weird.js`, `web/knob.js` | Weirdness macros in the player: knobs for chaos (random parameter locks), drift (a few parameters per track wander over time), glitch (retrig, nudge, slide, cut), octaves, space (delay and reverb throws), thin (chance), and ghosts (quiet extra notes), plus depth. They build a weird copy of the song and never touch the original: ` or the weird/original button flips between them, reroll picks a new seed, surprise me sets random knobs, and bake makes the copy the song (undoable). Choices are hashed from the seed and position, so turning a knob up only adds. Scope: the whole song, this row, this track, or both; vary repeats gives each bar its own copy of its phrases |
| `web/synth.html` | The synth playground: pick any instrument from a song or style, change every parameter with controls built from the format's schema, play it from the computer keyboard (tracker layout) or the on-screen keys, repeat a note at the song's tempo, and copy the instrument JSON back out. Audio runs in an AudioWorklet (`synth-worklet.js`) on the same `Player`, using its live-play methods `noteOn`, `noteOff`, and `updateInstrument` |
| `web/cube.html` | The parameter cube: the tracker grid with a third axis. Tracks run across, steps run down, and every parameter shaping each step runs into the screen: the note and velocity, note commands, the track's persisting commands, and every instrument parameter, with track commands overriding the instrument as the player applies them (`cube-data.js`). Box size and brightness is the value; colour is the parameter group; values changed since the track's previous step glow. Orbit, preset views (the front view is the tracker table), slices by group or single parameter, a changes-only filter, hover for values, and live playback with a sweeping playhead. Opens on the player's song through its link. The one page with a library: three.js 0.160.0 from jsDelivr |

Timing: step boundaries are computed in samples before rendering, events fire at their exact sample, and blocks are split at event boundaries. Swing delays every second step. One voice per track with up to four releasing voices behind it, so a new note cuts the old one's gate but lets its release ring.

Levels: every track has 6 dB of headroom before the mix bus, the master limiter catches peaks, and a 6-minute generated techno song renders with no clipped samples. Rendering runs about 5x realtime for a full techno mix and 50x for a single voice.

## Tests

`npm test` checks oscillator range and filter stability at full resonance, envelope behaviour, the step grid under swing and tempo changes, kick onsets on the grid, retrig and nudge timing, pitch by zero-crossing count, table transposes, slides, track commands changing a playing note, loop repetition, WAV round-trips, and that every example renders without clipping.

## Decisions and next steps

- **Offline first, streaming second.** A renderer that writes files is the smallest core that can be verified without listening. The streaming Player grew out of it, and the browser now runs it in an AudioWorklet that appends song rows half a second before they are due, for songs and endless runs alike, so there is no gap and the effect tails continue. Live changes land at the next row; appending phrase by phrase would bring that down to a bar.
- **Engines are parameter sets.** Every engine's parameters are in the format's schema, so a sound is data. A sampler engine is the obvious missing one for drums.
- **Edits are heard a row later.** The live player appends a whole song row about half a second before it is due, so an edit to the row now playing is heard the next time that row comes round (at once when looping a row). Appending phrase by phrase would cut that to a bar. Track commands from earlier rows are not applied when playback starts mid-song.
- **Not built:** editing the song grid and chains (the step editor edits phrases), MIDI input, plugin or hardware targets. The idea doc asks where it should run first; this says browser for playing and editing, with the offline renderer for batch work.
