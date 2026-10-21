# Endless Techno

Generative techno as data. A **style** is a JSON file in the Tracker Style Format: a full sound half (instruments, tables, master bus) plus layers with generator rules, an arrangement model, and mutation rules. The **generator** turns a style and a seed into a fixed song in the Tracker Song Format, which the engine renders and the M8 writer exports.

Phase 2 of `../ROADMAP.md`. The idea is in `../docs/ideas/endless-techno.md`.

## Use

```sh
# a six-minute song from seed 42, saved as JSON and rendered to WAV and MP3
node bin/generate.js styles/hypnotic-techno.json --seed 42 --minutes 6 --out song.json --render song.wav --mp3

# print stats: tracks, phrases, chains, bars, bytes
node bin/generate.js styles/hypnotic-techno.json --seed 42 --stats --out song.json

# validate a style or a song
node ../format/bin/validate.js styles/hypnotic-techno.json song.json
```

Every song records its `meta.seed`, `meta.style`, and `meta.generator`, so a song can be regenerated or a seed shared.

## The first style: hypnotic techno

Chosen because it is loop-based with slow evolution, which is what a tracker does well, and because its voice set is small. Around 126 to 132 bpm, minor, phrygian, or dorian on a root drawn per seed.

| Layer | Role | Generator | Enters at energy |
|---|---|---|---|
| kick | four to the floor | fixed pattern | 0.12 (always; may drop out for the last bar before a change) |
| hats | off-beat 16ths | per-step probabilities, 3 variants | 0.3 |
| ohat | open hat on the off-beat | fixed pattern | 0.45 |
| clap | 2 and 4 | fixed pattern, denser fills | 0.35 |
| ride | 8ths | fixed pattern | 0.65 |
| perc | FM blip | euclidean, 3 to 5 hits over 12 to 16 steps (polymeter) | 0.4 |
| bass | root-heavy line | melodic: weighted scale degrees, walk, repeat, slides | 0.25 |
| acid | squelchy lead | melodic: random rhythm, octave jumps, slides, accents; filter opens on rising sections | 0.55 |
| stab | detuned chord stab via a table | fixed patterns | 0.5 to 0.9 |
| pad | three-voice chords, 8 bars each | chord progression i, VI, iv, VII | up to 0.6 |
| riser | filtered noise sweep | one long note, cutoff and volume automation | build sections only |

## How the generator reads a style

1. **Seed everything.** Tempo, swing, root, mode, and the per-instrument `variations` (for example the acid's cutoff and resonance) are drawn once from the seed.
2. **Plan sections** (`lib/arrange.js`). The song is one or more arcs of about four minutes: a rise (energy climbs), a first peak, a breakdown, a short build, the drop, and a fall. Longer songs get more arcs, so an endless run keeps breathing. Section lengths come from `arrangement.sectionBars`. Each section gets a kind (intro, groove, build, breakdown, drop, outro) and an energy from 0 to 1.
3. **Choose layers per section.** A layer is a candidate when the section energy is inside its range. Layers already playing stay if they can; newcomers enter up to `maxLayerChange` per section (drops and intros may add everything, builds a little more than grooves). Breakdowns use the `keep` and `drop` lists. A section that falls in energy loses at least one layer.
4. **Write phrases and chains** (`lib/generate.js`). Each present layer gets a chain of one phrase per bar from its generator. Identical phrases and chains are interned, so a kick pattern that never changes is one phrase. Generators with a period (pattern strings, euclidean lengths) run across bars for polymeter; random generators repeat every four bars.
5. **Drift.** When a layer continues or re-enters, it may pick up a mutation (rotate, drop, add, swap, velocity) that applies from then on, for up to four accumulated mutations. `mutable: false` protects the kick and other fixed parts.
6. **Fills and automation.** The last bar before a section change may get retrigs, extra hits, or a dropped kick. Automation writes parameter moves (cutoff, volume) into the first step of each bar across a section, and resets to the instrument's own value when no automation applies.

Generator types are documented in `../format/schema/style.json` (`pattern`, `euclid`, `prob`, `melodic`, `chords`).

## Listening checks done without ears

This session could not listen. It checked that generated songs validate, fall within the requested length, contain a drop and a low-energy section, keep the kick on the grid, keep breakdowns kick-free but not silent, and render with no clipping; and it measured per-section band energy to confirm the arrangement is audible (the high band rises some 30 dB from intro to full mix in the renders). The first real listening pass is the user's.

## Open questions, now with answers

- *Which kind of techno first?* Hypnotic / minimal, as above.
- *How much of Endless Spa can be reused?* Unknown until its exports are seen. The style file carries its own sound half, so any engine that can read the sound half can play it.
- *Should listeners steer it live?* The energy model makes this easy: a live "energy up / down" control is one extra input to `chooseLayers`. Not built yet.

## Next

- More styles in this folder: acid techno (acid line leads), Detroit (chords and strings), dub techno (chord stabs through long delays).
- A second variant generator for drums from stored example patterns, as the parent idea suggests.
- A live mode in the engine that generates sections on the fly instead of a fixed song.
