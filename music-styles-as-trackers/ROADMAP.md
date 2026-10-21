# Roadmap

The four sub-projects depend on each other, so the order matters. Each phase is useful on its own. Boxes were ticked during the first overnight build session (see `PLAN.md`); notes say what was done and what remains.

## Phase 1: Tracker Song Format, from Endless Spa

Everything else speaks this format, so it comes first.

- [ ] Collect a few Endless Spa JSON exports in `format/examples/endless-spa/` (needs the user; none seen yet)
- [ ] Document their structure, and write the adapter from Endless Spa's JSON to the shared format
- [x] Draft a JSON Schema that holds both fixed songs and generative styles, using tracker structure: song, chains, phrases, instruments, tables (`format/schema/song.json`, `format/schema/style.json`, design in `format/SPEC.md`)
- [x] Write a validator, and check that the examples pass (`format/bin/validate.js`; three hand-written examples plus three generated previews pass)
- [x] Compare against what the M8 needs, and note the gaps (`format/SPEC.md`, `m8-writer/README.md`)

## Phase 2: Endless Techno

- [x] Choose the first kind of techno: hypnotic / minimal, with an acid line (`styles/hypnotic-techno.json`)
- [x] Write its compositional rules: tempo range, 16-step patterns and mutations, layering by energy per section, builds and breakdowns, polymeter (euclidean percussion over 12 to 16 steps)
- [x] Define the voice set: kick, clap, hats, ride, percussion, bass, acid line, stabs, pad, riser
- [x] Save everything in the shared format; Endless Spa's engine could not be reused because its code and exports were not available
- [ ] Listen to long runs and adjust until it holds attention without repeating (this session measured, it could not listen; previews are in `endless-techno/previews/`)

## Phase 3: M8 Song Writer

- [x] Check the state of community work on the M8 song file format, and the current firmware version (`m8-writer/FORMAT-NOTES.md`; file version 6.6.2)
- [x] Decide between writing song files directly and driving the M8 over MIDI first: both, MIDI export first (verified), song files second (unverified)
- [x] Map the shared format onto M8 chains, phrases, instruments, tables, and synth engines (`m8-writer/README.md` has the table)
- [ ] Generate a first song from Endless Techno and play it on the device (`endless-techno/previews/hypnotic-techno-m8-3.m8s` is ready to try; nothing has been tested on hardware)
- [x] Optionally read M8 songs back into the shared format (a reader for the regions the writer touches exists, for round-trip tests; a full importer does not)

## Phase 4: New Tracker Engine

Built early, against the plan's own advice, because every other phase needed something that makes sound and the session could not wait for a conversation. Reviewed decisions are in `PLAN.md`.

- [x] Choose where it runs first: an offline renderer in Node, and the same code in a browser page (`engine/`)
- [x] Build a small core with tight timing and good sound before adding features: sample-accurate sequencer, six synth engines, tables, delay, reverb, limiter; measured, not yet heard
- [ ] Port Endless Spa's voices as the first engine set (needs Endless Spa's parameters)
- [x] Load the shared format natively, including generative styles (the browser player generates and plays styles in the page)
- [x] Real-time streaming playback and live generation section by section (`engine/lib/player.js`, the browser's Endless mode, `endless-techno/bin/endless.js`)
- [ ] A tracker editing UI: phrase editing is in (the player's step editor: step through rows, edit notes, commands, and parameter locks on any instrument parameter, live playback, undo); editing the song grid and chains is not
- [ ] More ways to edit locks: ramps and draws across a range of steps, per-track parameter columns in the grid, recording slider moves while a row loops, copy and paste, editing in the cube
- [x] A sound editor: the synth playground (`engine/web/synth.html`)

## Ongoing: the meta-pattern

- [x] Add more styles to the library as the format matures (`styles/`: hypnotic techno, its M8-fitted variant, and an ambient style)
- [x] Try the smallest-definition test: `tracker-validate --stats` reports gzipped sizes; a complete style is 1.5 to 3 KB
- [ ] Explore building styles from stored example patterns instead of hand-written rules
- [x] Live control: energy up or down while playing (the Endless mode's − and + buttons nudge the next section)
