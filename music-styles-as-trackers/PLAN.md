# Overnight Build Plan

Written at the start of an autonomous overnight session. Records the decisions made without the user, so they can be reviewed and reversed. Each decision answers an open question from `docs/ideas/`.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Language and runtime | Plain ES-module JavaScript on Node 22, no build step, JSDoc types | Runs unchanged in Node and the browser, so the same synth code renders files offline and plays in a web page. No toolchain to break. |
| Repo shape | npm workspaces: `format/`, `endless-techno/`, `engine/`, `m8-writer/` | Matches the four sub-projects. Each is its own package that others import. |
| Format without Endless Spa exports | Design v0.1 from tracker principles now; add an Endless Spa adapter when exports arrive | No exports are available tonight. `CLAUDE.md` says not to invent their structure, so the format does not claim to be Endless Spa's. The import path is left open in `format/SPEC.md`. |
| Generative rules: data or scripts? | Data. A style is JSON: layers, named generator primitives with parameters, an arrangement model, mutation rules | Keeps styles inspectable, diffable, and small. Scripts can come later as another generator type. |
| First techno | Hypnotic / minimal techno, with an acid line as an optional layer | Loop-based with slow evolution, which suits a tracker engine, and the voice set is small. |
| M8: files or MIDI first? | Both. Standard MIDI File export first (safe, testable); `.m8s` writer second, built from community documentation and marked untested | MIDI can drive the M8 today via any DAW. Song files are the real goal but cannot be verified without the device. |
| Engine target | Headless offline renderer first (Node, writes WAV), then a browser player reusing the same code | "Tight timing and good sound before features." Offline rendering is sample-accurate by construction, and it lets this session verify output. |
| Synth engine set | `analog` (subtractive, unison), `fm` (2-op), `kick`, `clap`, `hihat`, `noise` | Enough for techno and ambient pads. Each is a documented parameter set in the format, which is the "sound half" contract. |

## Order of work

1. Scaffolding and this plan.
2. `format/`: JSON Schema, helper library (notes, seeded random, song flattening), validator CLI, examples, `SPEC.md`, tests.
3. `engine/`: synth engines, sequencer, effects, WAV renderer, CLI; render every example and check the audio numerically.
4. `endless-techno/`: style definition as data, generator CLI, rendered previews.
5. `m8-writer/`: MIDI export, `.m8s` writer, mapping notes, gap list.
6. A second style (ambient, in the spirit of spa music) to test that the format generalizes.
7. Browser player page.
8. Docs: roadmap checkboxes, READMEs, decision notes.

## What this session cannot do

- Listen. Audio is checked by measurement (levels, spectra, event timing), not by ear.
- Test on an M8. Nothing generated for the M8 is called working.
- See Endless Spa's real JSON. The format is designed to be adaptable, not to match it.
