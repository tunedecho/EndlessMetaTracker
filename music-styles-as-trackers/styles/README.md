# Style Library

Each file here is a complete musical style as data, in the Tracker Style Format (`../format/schema/style.json`): the sound half (every instrument and its parameters, tables, the master bus) and the generative half (layers with generator rules, an arrangement model, mutation rules). The generator in `../endless-techno/` turns any of them into a fixed song:

```sh
node endless-techno/bin/generate.js styles/<style>.json --seed 42 --minutes 6 --out song.json --render song.wav --mp3
```

| Style | Character | Tempo | Layers | Size (gzipped) |
|---|---|---|---|---|
| `hypnotic-techno.json` | Loop-based techno with a slowly evolving arrangement, acid line, stabs, pad breakdowns | 126 to 132 | 11 | about 2 KB |
| `ambient-drift.json` | Slow, consonant drones, pads, bells and plucks in the spirit of spa music | 60 to 72 | 6 | about 1.5 KB |

Both are built from the same vocabulary, which is the point of the meta-pattern: a style is a small, readable, diffable file, and the same generator, engine, and exporters play all of them.

## The smallest-definition test

`node format/bin/validate.js --stats styles/*.json` prints each style's size minified and gzipped. A complete generative style currently costs between one and three kilobytes, which is within sight of the 4 KB demoscene target from the project idea. The generator and engine code are not counted; a 4k entry would need those to be tiny as well.

## Writing a style

1. Copy the closest existing style.
2. Design the sound half first: instruments as parameter sets. Render single notes with the engine to hear them (`format/examples/` shows the vocabulary).
3. Add layers: one per musical role, with an energy range that says when it belongs, and a generator. `pattern` for fixed parts, `euclid` for polymetric percussion, `prob` for hats, `melodic` for basslines and leads, `chords` for pads and stabs across several tracks.
4. Set the arrangement: section lengths, energy bounds, whether breakdowns happen, how many layers may change per section.
5. Validate, generate a few seeds, render, listen, adjust. Keep `variations` for the parameters that should differ per seed.

Ideas for next styles: acid techno (the acid line leads from the start), dub techno (chord stabs through long delays, swing), Detroit (chords and strings), chiptune (pulse waves, arpeggio tables, fast tempo).
