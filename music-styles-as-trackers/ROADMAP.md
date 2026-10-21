# Roadmap

The four sub-projects depend on each other, so the order matters. Each phase is useful on its own.

## Phase 1: Tracker Song Format, from Endless Spa

Everything else speaks this format, so it comes first. Start from Endless Spa's existing JSON rather than designing from scratch.

- [ ] Collect a few Endless Spa JSON exports in `format/examples/`
- [ ] Document their structure, and split it into a composition half and a sound half
- [ ] Draft a JSON Schema that holds both fixed songs and generative styles, using tracker structure: song, chains, phrases, instruments, tables
- [ ] Write a validator, and check that the Endless Spa examples pass
- [ ] Compare against what the M8 needs, and note the gaps

## Phase 2: Endless Techno

The first proof that the pattern carries across styles.

- [ ] Choose the first kind of techno, such as minimal, acid, Detroit, or hypnotic
- [ ] Write its compositional rules: tempo range, 16-step patterns and mutations, layering every 8 to 32 bars, builds and breakdowns, polymeter
- [ ] Define the voice set: kick, clap, hats, percussion, bass, acid line, stabs, pads
- [ ] Reuse Endless Spa's engine where possible, and save everything in the shared format
- [ ] Listen to long runs and adjust until it holds attention without repeating

## Phase 3: M8 Song Writer

Puts the styles onto a real instrument.

- [ ] Check the state of community work on the M8 song file format, and the current firmware version
- [ ] Decide between writing song files directly and driving the M8 over MIDI first
- [ ] Map the shared format onto M8 chains, phrases, instruments, tables, and synth engines
- [ ] Generate a first song from Endless Techno and play it on the device
- [ ] Optionally read M8 songs back into the shared format

## Phase 4: New Tracker Engine

The largest project. Start it once the format and at least one style are solid.

- [ ] Choose where it runs first: desktop app, browser, plugin, or hardware
- [ ] Build a small core with tight timing and good sound before adding features
- [ ] Port Endless Spa's voices as the first engine set, then add techno voices
- [ ] Load the shared format natively, including generative styles

## Ongoing: the meta-pattern

- [ ] Add more styles to the library as the format matures
- [ ] Try the smallest-definition test: how compact can a complete style be and still sound like itself?
- [ ] Explore building styles from stored example patterns instead of hand-written rules
