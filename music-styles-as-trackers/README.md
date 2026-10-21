# Music Styles as Tracker Systems

Expressing whole musical styles as tracker systems: data that fully defines both the composition (notes, patterns, structure, generative rules) and every synth voice needed to make the sounds.

This repo started from five ideas captured in the Idea Console (`docs/ideas/`). The parent idea frames the pattern, and four sub-projects each build one piece of it. All four now have working code.

## Background

- **Endless Spa.** A synthesizer that composes spa music and plays it on its own synth voices. Every composition and voice parameter downloads as structured JSON.
- **A 4k demoscene tracker.** Sam's software for music and video effects compositions in as little as 4 kilobytes.
- **The Dirtywave M8.** A tracker where a song and all its sounds are fully defined inside one system.

## What is here

| Folder | Project | State |
|---|---|---|
| `format/` | Tracker Song Format: the shared JSON schema, validator, library, examples, spec | Working. v0.1 |
| `styles/` | The style library: complete generative styles as data | Three styles |
| `endless-techno/` | The generator that turns a style and a seed into a song, with previews | Working |
| `engine/` | The tracker engine: six synth engines, effects, sequencer, offline renderer, browser player | Working, unheard |
| `m8-writer/` | MIDI export and a Dirtywave M8 song file writer | MIDI verified; `.m8s` untested on hardware |

Plain JavaScript, Node 22, no build step, no dependencies beyond the validator's Ajv.

## Try it

```sh
npm install
npm test                      # 60 tests across the four packages
npm run validate              # check every example and style
npm run demo                  # generate, render, and export everything into demo-out/
npm run web                   # browser player at http://localhost:8080/engine/web/

# generate a six-minute techno track from seed 42 and render it
node endless-techno/bin/generate.js styles/hypnotic-techno.json --seed 42 --minutes 6 --out song.json --render song.wav --mp3

# export it for the M8 (needs the 8-track variant style) and as MIDI
node endless-techno/bin/generate.js styles/hypnotic-techno-m8.json --seed 42 --out song.json
node m8-writer/bin/to-m8s.js song.json song.m8s
node m8-writer/bin/to-midi.js song.json song.mid
```

Listen first: `endless-techno/previews/` has two full generated techno tracks and one ambient piece as MP3, with their JSON, MIDI, and an `.m8s` file.

## How the pieces fit

```
styles/*.json  ──generate──▶  song.json  ──render──▶  wav / mp3   (engine, Node or browser)
 (style format)   (seed)     (song format)  ──export──▶  .mid / .m8s (m8-writer)
```

A **song** is two halves: `sound` (instruments as parameter sets, tables, master bus) and `composition` (tracks, phrases, chains, a song grid). A **style** has the same sound half plus layers with generator rules, an arrangement model, and mutation rules. The generator writes songs; the engine and exporters only ever see songs. `format/SPEC.md` explains the design.

## Where to read

- `PLAN.md`: the decisions made in the first build session, and its end-of-session status.
- `ROADMAP.md`: the phases, with what is done and what remains.
- `docs/ideas/`: the five original ideas, with their open questions.
- `CLAUDE.md`: conventions for Claude sessions working in this repo.
