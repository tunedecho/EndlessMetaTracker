# Live Console: a tracker that runs the outboard gear inside Ableton Live

> A central console, in the spirit of the current tracker, that composes endless techno, drives every piece of outboard gear and plugin from one place, records into Ableton Live, and is above all fun to play live.

- **Slug:** live-console
- **Status:** seed, captured from conversation on 2026-10-21
- **Tags:** music, tracker, generative, live, hardware, ableton
- **Likely home:** a new repo. This file is the hand-off. It reuses ideas and, where useful, code from `music-styles-as-trackers/`.

## What

A software control centre that:

1. Keeps the compositional engine of the current tracker (endless techno first; other genres later, one at a time).
2. Runs all the outboard gear and any plugin instruments from the tracker's tracks, over MIDI and CV.
3. Lives inside Ableton Live, which records every lane and captures takes.
4. Is played live: fast, never finicky, with the tracker itself rock solid.

## The gear it must drive

| Instrument | Control | Notes |
|---|---|---|
| Behringer RD-8 (808 clone) | MIDI | drums |
| Oberheim OB-X style six-voice | MIDI | confirm the exact model |
| Arturia poly synth | MIDI | confirm the model |
| Behringer Model D | MIDI, CV | mono |
| Behringer Odyssey | MIDI, CV | mono |
| Behringer TD-3 (303 clone) | MIDI, CV | acid line |
| Eurorack system | CV, gate, clock | CV out from the DAW or a MIDI-to-CV module |
| Plugin instruments in Live | internal | treated exactly like hardware destinations |
| Fender Rhodes, OP-XY | not under tracker control | played by hand; can still be recorded alongside |

**Per-synth MIDI CC maps.** For each MIDI-controlled instrument, a map from every parameter to its CC (or NRPN or SysEx where needed), so the tracker can treat hardware parameters as parameter locks, the same way it treats its own synth parameters today. The map is the hardware equivalent of an instrument's `params` in the shared format: a sound half that happens to live in a box.

## What to keep from the current tracker

- **Add a track, generate it.** Add a track, generate hats; add a track, generate a bass line; add a track, generate pads. Each new track is assigned to a destination (a synth, a plugin, a CV output).
- **Sections and arcs.** Generate an intro, an outro, the next groove; size sections by the number of voices per instrument type that matter for the track.
- **Randomize from curated defaults.** "Randomize this track" pulls from interesting compositional defaults for bass lines, melodies, chord changes, and drum patterns, not from white noise.
- **Endless mode with live energy control.** The streaming, section-by-section generation already built.
- **Everything as data.** Songs, styles, and now gear maps and the personal library are all files that can be inspected, versioned, and shared.

## New: play it in, keep it, learn from it

- **Live MIDI input.** Play parts in from MIDI controllers. Capture timing exactly, including notes that are off the clock or off the grid. Do not quantise away the feel.
- **Audition loops.** Randomize a bass line, listen, randomize again, until one lands. The loop must be instant.
- **A personal library.** Melodies, bass lines, chord changes, and drum patterns that get kept. Over time it becomes a corpus of the user's own choices.
- **Generate from the library.** The generator can draw from the library instead of, or blended with, the built-in defaults, with randomness injected on top. This is the "styles from examples" direction from the parent idea, made concrete.

## New: Ableton Live as the host

- The console is the control centre; Live is where the audio lands. Each hardware instrument records into its own lane; takes are captured in Live.
- Candidates for how the console lives inside Live, to be decided: a Max for Live device (tightest integration: transport, clock, MIDI routing, CV via CV Tools), a plugin (VST3 or CLAP) with MIDI output, or an external app synced over Ableton Link and MIDI clock. The Max for Live route is the likely first try because it removes the finicky parts: clock, routing, and recording are Live's job.
- Sync requirements: the tracker follows Live's transport and tempo, starts and stops with it, and stays sample-tight on the grid while still passing through off-grid timing from live input.

## New: talk to it while playing

- A conversational layer: speak or type to Claude mid-performance. "Create a breakdown." "Rising fill into the next drop." "Add drum fills now." "More acid."
- The request becomes a structured command (JSON) that the endless generator applies at the next section boundary, or immediately where that makes sense (fills).
- Suggested commands can be surfaced as buttons too, so the same vocabulary works with or without speech.
- The command vocabulary should map onto the generator's existing model: energy nudges, section kinds (breakdown, build, drop), layer add and remove, fills, automation moves, and library picks.

## Principles

- **Fun to play live comes first.** Every feature is judged by whether it is usable mid-set with one hand.
- **Rock solid.** Timing, sync, and MIDI output must not glitch. Test on the real gear early and often.
- **Not finicky.** Setup is a config file per studio; a session starts in one click.
- **Composition and sound stay separate.** What is played is in the tracker; what plays it is a destination with a map. Swapping the OB-X for a plugin should change nothing in the composition.

## Open questions

- Max for Live, plugin, or external app with Link? What does each cost in latency, setup, and robustness?
- CV: from Live (CV Tools over a DC-coupled interface) or from a MIDI-to-CV module driven by the console? Which gives tighter timing for the Eurorack?
- How are MIDI CC maps authored? By hand per synth, imported from existing community maps, or learned by MIDI-learn from the hardware?
- How does the personal library store a part: as tracker phrases in the shared format, with the destination and gear map attached, or as abstract musical material (degrees, rhythms) that can be re-targeted?
- How much of the current JavaScript engine carries over? The generator and the format do; the synth voices become one destination among many.
- What is the first live test? Suggested: RD-8 on drums, TD-3 on acid, one poly on pads, everything recorded into Live, endless mode running, energy control and "add drum fills" working by voice.

## Suggested build order (to revisit in the new repo)

1. Confirm the gear list and write the first three MIDI CC maps (RD-8, TD-3, the six-voice poly).
2. Decide the Live integration route with a one-day spike of each candidate: can it follow transport and send tight MIDI to one synth?
3. Port the generator and the format; add "destination" to a track and "gear map" to the sound half.
4. Tracks to hardware: add a track, generate, assign, hear it on the gear, record it in Live.
5. Live MIDI input with exact timing, and the audition loop.
6. The personal library, and generation from it.
7. The conversational command layer.
8. Rehearse a full live set with it; fix what is finicky.

## Links

- [Part of: Music Styles as Tracker Systems](music-styles-as-trackers.md)
- [Builds on: Endless Techno](endless-techno.md)
- [Builds on: New Tracker Engine](new-tracker-engine.md)
- [Uses: Tracker Song Format](tracker-song-format.md)
- Related: M8 Song Writer (hardware as a destination is the same idea, generalised)
