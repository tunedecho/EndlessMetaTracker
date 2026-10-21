# Tracker Song Format v0.1

A JSON document that fully describes a piece of music: what is played and what plays it. The schema is in `schema/song.json`; generative styles use `schema/style.json`. This file explains the ideas behind them.

## Two halves

```
{
  "format": "tracker-song/0.1",
  "meta":        { title, author, style, seed, ... },
  "transport":   { bpm, stepsPerBeat, phraseLength, swing, loop },
  "sound":       { instruments, tables, master },      <- what plays
  "composition": { tracks, phrases, chains, song },     <- what is played
  "style":       (optional) the generative style it came from
}
```

The two halves never reference each other except by instrument id. Swap `sound` for a different instrument set and the song still plays; swap `composition` and the sounds are reused. That separation is the whole point of the format, and it is what will let a style written for one engine move to another.

## The composition half: tracker vocabulary

The structure is the one M8 and LSDJ users already know.

- **Step.** One slot in a phrase. It can hold a note, a velocity, an instrument override, and commands (`fx`). `null` is an empty step.
- **Phrase.** `phraseLength` steps (16 by default, four to a beat). The smallest unit of pattern.
- **Chain.** A list of phrases, each with an optional transpose. The unit of arrangement for one track.
- **Track.** A lane that plays one chain at a time, through one voice. A track has a default instrument.
- **Song.** A grid of rows. Each row assigns a chain to some tracks.

**Row timing.** A song row lasts as long as its longest chain. Shorter chains repeat to fill the row. Tracks absent from a row are silent for that row. This keeps all tracks in step at every row boundary, which is what a generator wants: one row per section. (The M8 lets tracks drift independently; the M8 writer expands rows so each track's chain is the row's full length, which gives identical timing on the device.)

**Notes.** `"C4"` is MIDI 60. Names allow `#` and `b`. A number is a MIDI note. `"OFF"` releases the track's note. A step with `fx` and no note is a command-only step.

**Commands.** `fx` is a map from command name to value. Track commands (`cutoff`, `resonance`, `volume`, `pan`, `drive`, `delaySend`, `reverbSend`, `pitch`) persist on the track until changed. Note commands (`retrig`, `nudge`, `slide`, `accent`, `cut`, `chance`, `table`) affect only that step. `tempo` is global. Values are 0..1 unless the schema says otherwise; `cutoff` is exponential from 20 Hz to 20 kHz.

**Tables.** A short list of rows, each with a transpose, volume, and commands, that runs each time a note on the instrument starts, at `rate` rows per step. Tables make arpeggios, pitch drops, and filter movement without writing them into every phrase.

## The sound half: engines as parameter sets

An instrument is `{ engine, params, filter, amp, lfo, mix, table }`. The common sections (filter, amplitude envelope, LFO, mixer, table) are the same for every engine. `params` is specific to the engine and validated per engine in the schema. The engines in v0.1:

| Engine | What it is | Main params |
|---|---|---|
| `analog` | Subtractive synth: two oscillators, sub, noise, unison | wave, wave2, mix2, detune2, sub, unison, unisonDetune, glide |
| `fm` | Two-operator FM with feedback and a modulator envelope | ratio, index, feedback, modEnv, modEnvAmount |
| `kick` | Sine with a pitch sweep, click, and waveshaping | pitchStart, pitchEnd, pitchDecay, click, tone, body |
| `clap` | Noise bursts through a bandpass | bursts, spacing, tone, tail, width |
| `hihat` | Square cluster plus noise, highpassed | tone, metallic, decay, open |
| `noise` | Coloured noise | color, stereo |

The master bus has a tempo-synced delay, a reverb, a highpass, and a limiter. Every parameter is a plain number, so a sound can be inspected, diffed, randomised within ranges, and mapped to another engine's nearest parameter.

## Generative styles

A style (`tracker-style/0.1`) has the same `sound` half as a song, and instead of phrases it has **layers**, each with a **generator**, plus an **arrangement** model and **mutation** rules. A generator turns a style and a seed into a fixed song whose `meta.seed` and `meta.style` record where it came from. See `../endless-techno/README.md` for how the generator reads it.

The rules are data, not scripts: named generator types (`pattern`, `euclid`, `prob`, `melodic`, `chords`) with parameters, ranges written as `[min, max]`, and choices written as lists. A style should be readable by a musician without running it.

## Sizes

`tracker-validate --stats` prints the byte count of a song minified and gzipped. This is the smallest-definition test from the project idea: how small a complete style or song can be and still sound like itself. The hand-written examples are 400 to 1400 bytes gzipped.

## Where Endless Spa fits

Endless Spa's exports have not been seen by this format's author. The intended path is an adapter: `format/adapters/endless-spa.js` that reads an export and writes a `tracker-song/0.1` document, mapping its voices onto the nearest engine and its composition onto phrases and chains. Until real exports are in `format/examples/endless-spa/`, nothing here claims to match them.

## Gaps against the M8

Noted for the M8 writer:

- The M8 has 8 tracks and one voice per track; this format allows 16 tracks and a release tail per track.
- M8 instruments (Wavsynth, Macrosynth, FM, Sampler, MIDI, Hypersynth, External) do not map one-to-one. `analog` is closest to Wavsynth or Hypersynth; `fm` to FMSynth; the drum engines need samples or FM approximations.
- M8 effects commands are per-instrument and per-step with three slots. This format's `fx` map allows any number; the writer keeps the first three.
- The M8 has no `chance` on fixed songs; a style's `chance` is resolved by the generator before export.
