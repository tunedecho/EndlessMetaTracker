# M8 Song Writer

Turns a Tracker Song Format document into something the Dirtywave M8 can play. Phase 3 in `../ROADMAP.md`; the idea is in `../docs/ideas/m8-song-writer.md`.

Two outputs, in the order the plan recommends:

1. **Standard MIDI File** (`tracker-to-midi`). Works today with any DAW, hardware sequencer, or the M8 over MIDI. Verified with an independent MIDI library.
2. **M8 song file** `.m8s` (`tracker-to-m8s`). A complete song with its instruments, chains, phrases and tables, written in the firmware 6.6 file format. **Not tested on a device.** It has been verified only by reading it back with the community reference parser.

## Usage

```
node m8-writer/bin/to-midi.js song.json out.mid [--no-gm-drums] [--loops N]
node m8-writer/bin/to-m8s.js  song.json out.m8s [--dump]
```

From code:

```js
import { encodeMidi, songToM8, readM8 } from '@tracker/m8-writer';
const mid = encodeMidi(song);                      // Buffer
const { bytes, warnings, report } = songToM8(song); // Buffer plus what could not be mapped
```

## MIDI export

- Format 1, 480 pulses per quarter note. Track 0 holds the tempo map and the title; one MIDI track per song track, named after it.
- Timing follows the shared format's row semantics exactly (it uses the same `resolve()` as the engine). Swing delays odd steps. `tempo` commands become tempo events.
- Notes last until the next note or `OFF` on the track, or `cut`; drum notes last one step. `retrig` and `nudge` move notes within the step. `chance` is resolved with the song's seed.
- Tracks whose default instrument is a drum engine (`kick`, `clap`, `hihat`, `noise`) go to channel 10 with General MIDI drum notes (36, 39, 42 or 46 for open hats, 49). `--no-gm-drums` gives every track its own channel and keeps the written pitches.
- Track commands become controllers: `cutoff` CC 74, `resonance` CC 71, `volume` CC 7, `pan` CC 10.

## M8 song file

Targets **file version 6.6.2** (firmware 6.6.x, the current release as of October 2026). The writer starts from an empty song saved by that firmware (`templates/V6_6EMPTY.m8s`, from the MIT-licensed [m8-file-parser](https://github.com/Twinside/m8-file-parser) test suite) and overwrites the header name and tempo, the song grid, chains, phrases, tables and instruments. Mixer, effects, MIDI settings, scales, EQs and the newer per-row data keep the template's defaults. `FORMAT-NOTES.md` has the byte layout and its evidence.

### Mapping

| Format | M8 | Notes |
|---|---|---|
| Song row | One or more M8 song rows | A row lasts its longest chain; shorter chains repeat to fill it; tracks with no chain get a silent chain, so all 8 tracks stay in step. Rows longer than 16 phrases split into several M8 rows. |
| Track | M8 track 1 to 8 | More than 8 tracks is an error. |
| Chain | Chain | Transpose written as a signed byte. |
| Phrase | Phrase | One M8 phrase per (phrase, track default instrument), because the M8 step carries the instrument number. Notes are MIDI minus 36 (C-4 on the M8 is byte 0x24). Velocity 1 is left empty (instrument default); other velocities become 00..FE. |
| Instrument `analog` | WAVSYNTH | Wave to shape (saw, pulse widths, triangle, sine). Second oscillator, sub and unison are dropped with a warning. |
| Instrument `noise` | WAVSYNTH, NOISE shape | |
| Instrument `fm` | FMSYNTH, algorithm `[A>B]+[C>D]` | A modulates B with the ratio and index; C and D are silent. |
| Instrument `kick` / `hihat` / `clap` | MACROSYNTH KICK / CYMBAL / FILTERED NOISE | Approximations. A decay-only volume envelope from the engine's decay. |
| Filter | FILTER, CUTOFF, RES | `off`, `lowpass`, `highpass`, `bandpass` map to types 0..3. |
| Amp envelope | ENV1: ADSR on VOLUME | Times mapped by an approximate curve. |
| Filter envelope | ENV2: ADSR on CUTOFF | Negative amounts use their magnitude. |
| LFO | ENV3: LFO | Targets cutoff, pitch, volume, pan. Rate mapping is approximate. |
| Mix | PAN, DRY, DEL, REV, AMP (drive) | |
| Instrument table | Table with the instrument's number | Rows per step become TBL.TIC ticks. Short loops are tiled; non-looping tables hold their last row with HOP. |
| Step `table` command | TBL xx with a table at 0x80+ | |
| Notes below MIDI 36 | Instrument PITCH -12 (or -24) and notes raised | The M8's lowest note is MIDI 36. |
| `cutoff`, `resonance`, `volume`, `pan`, `delaySend`, `reverbSend` | CUT, RES, VOL, PAN, SDL, SRV | |
| `nudge`, `cut`, `slide`, `tempo`, `retrig`, `chance` | DEL, OFF, PSL, TPO, RET, CHA | Values in ticks (6 per step). RET and CHA value semantics are unverified. |
| `accent` | Folded into velocity | |
| `pitch`, swing, loop point | Dropped with a warning | |
| Parameter locks (`lock`) | Dropped with a warning | The M8 has no per-step locks; a few could become step commands, but those persist on the track and locks do not |

More than three commands on a step keeps the first three.

### What is untested

Everything about the `.m8s` output on real hardware:

- Whether firmware 6.6 accepts the file at all (the template is a real 6.6.2 save, so the header and the untouched regions are genuine).
- The note byte for OFF (`0x80`), the velocity scale, chain and table transpose as signed bytes.
- Command value semantics for RET and CHA, and the tick units for DEL, OFF, PSL.
- Envelope and LFO byte curves, MACROSYNTH timbre/color meanings, the FM level scale.
- Table HOP tricks for loop control.

What *is* verified: the reference parser (`m8-file-parser` 0.7.0, Rust, which covers firmware 4.0 to 6.6) reads every generated file back with the intended song, chains, phrases, commands, tables and instruments, and a byte comparison shows the writer changes nothing outside the documented regions.

### How to try it on an M8

Back up the SD card. Copy the `.m8s` into `/Songs/`. Load it from the M8's file browser. If it loads, check the instrument screens against the mapping table above and listen to each track alone. Report what differs so the writer can be corrected: the uncertain items above are the first suspects.

## Recommendation

MIDI first, as planned. A MIDI file through a DAW or the M8's MIDI input proves the composition half immediately. The `.m8s` path is the real goal because it carries the instruments, and it is ready for a device test; once one file loads and sounds right, the remaining mapping work is tuning parameter curves, not format archaeology.

## Reading M8 songs back

`readM8()` reads the regions the writer writes (header, song, chains, phrases, tables, instruments) into plain objects. A full M8-to-format importer, so hand-made M8 songs can become style examples, is the natural next step; the reader is its foundation.

## Tests

```
cd m8-writer && node --test "test/**/*.test.js"
```

MIDI: tick arithmetic, swing, channel assignment, note ends, retrig/nudge, CCs, tempo events, and a parser round-trip on every example song. M8: template layout, region isolation, header, row expansion and silent fill, phrase contents, fx mapping, instrument and table mapping, refusal of unmappable songs.
