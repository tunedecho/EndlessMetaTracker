# Music Styles as Tracker Systems

Expressing whole musical styles as tracker systems: data that fully defines both the composition (notes, patterns, structure, generative rules) and every synth voice needed to make the sounds.

This repo starts from five ideas captured in the Idea Console. The parent idea frames the pattern, and four sub-projects each build one piece of it.

## Background

- **Endless Spa.** A synthesizer that composes spa music and plays it on its own synth voices. Every composition and voice parameter downloads as structured JSON.
- **A 4k demoscene tracker.** Sam's software for music and video effects compositions in as little as 4 kilobytes.
- **The Dirtywave M8.** A tracker where a song and all its sounds are fully defined inside one system.

## Sub-projects

| Folder | Project | What it does |
|---|---|---|
| `format/` | Tracker Song Format | The shared JSON format and validator that every other project uses. |
| `endless-techno/` | Endless Techno | Endless Spa's structure applied to generative techno. |
| `m8-writer/` | M8 Song Writer | Turns songs and styles into complete M8 songs with their instruments. |
| `engine/` | New Tracker Engine | A new tracker in the spirit of the M8, with rewritten synth engines. |

## Where to read

- `ROADMAP.md`: the order to build things in, and why.
- `docs/ideas/`: the five original ideas, with their open questions and notes. `docs/ideas/json/` keeps the original records.
- `CLAUDE.md`: conventions for Claude sessions working in this repo.
