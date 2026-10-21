# Music Styles as Tracker Systems

A repo for expressing musical styles as tracker systems that fully define both composition and sound as data. Read `README.md` for the overview, `ROADMAP.md` for the build order, and `PLAN.md` for decisions already made.

## Layout

```
format/          Tracker Song Format: JSON Schemas, validator, library, examples, SPEC.md (Phase 1)
styles/          the style library: generative styles as data, one JSON file each
endless-techno/  the generator (style + seed -> song), previews of generated songs (Phase 2)
m8-writer/       MIDI export and the Dirtywave M8 .m8s writer (Phase 3)
engine/          the tracker engine: synth voices, effects, sequencer, WAV renderer, browser player (Phase 4)
scripts/         demo.js (generate, render, export everything), serve.js (static server for the player)
docs/ideas/      the original ideas from the Idea Console, as markdown and JSON
```

npm workspaces; plain ES modules; `npm test` runs every package's `node --test` suite.

## Conventions

- The shared format in `format/` is the contract between projects. Change it deliberately, update the schema, `SPEC.md`, and examples together, and keep `npm run validate` passing.
- Keep composition and sound separate in every file: what is played, and what plays it.
- Engines and generators import `format/lib/core.js` (browser-safe). Only tools import `format/lib/index.js`, which pulls in Ajv and Node modules.
- Start from Endless Spa's existing JSON when it is available. Ask the user for real exports instead of inventing their structure; the format has an adapter slot for them, not a guess.
- Anything generated for the M8 must be tested on the device or its official tooling before it is called working. The `.m8s` writer follows community documentation and has not been tested on hardware.
- This session cannot listen. Check renders by measurement (`engine/lib/analyze.js`, spectrograms via ffmpeg) and say so; leave listening verdicts to the user.
- The ideas in `docs/ideas/` record intent and open questions. When a decision answers one of those questions, note it in `ROADMAP.md`, `PLAN.md`, or the relevant project's README.
