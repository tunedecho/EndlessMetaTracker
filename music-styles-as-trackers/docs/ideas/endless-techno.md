# Endless Techno

> Extend Endless Spa into a generative techno system with its own compositional principles and synth voices, but the same overall structure and fully downloadable JSON definition.

- **Slug:** endless-techno
- **Status:** seed
- **Tags:** music, tracker, generative
- **Created:** 2026-10-21
- **Updated:** 2026-10-21

## What

A sibling to Endless Spa that composes and plays techno endlessly. The overall structure and pattern match Endless Spa and the M8 tracker, but the compositional principles and synth voices are new and specific to the style. Every parameter can be downloaded as structured JSON, as in Endless Spa.

## Why

It is the first test of whether the Endless Spa structure generalizes. Techno is a good contrast to spa music: rhythmic, repetitive, and built from layered patterns that change slowly, which suits a tracker-style engine.

## How

Early thoughts, to refine in a workshop:

- **Compositional principles to encode.**
  - A steady four-on-the-floor kick, typically somewhere around 120 to 135 beats per minute.
  - Patterns of 16 steps that repeat, varied by small mutations.
  - Arrangement by adding and removing layers every 8, 16, or 32 bars, with breakdowns and builds.
  - Tension and release through filter sweeps, rising effects, and drops.
  - Off-beat hats, clap or snare on the second and fourth beats, and polymeter, where patterns of different lengths drift against each other.
- **Voice set.** Kick, clap, open and closed hats, percussion, bass, an acid line in the style of a resonant squelchy bass synth, stabs, and pads. Each is a synth voice with its full parameter set in the JSON.
- **Endless arrangement.** A long-form engine that never quite repeats: it moves between energy levels, swaps layers in and out, and evolves sounds slowly.
- **Shared structure.** Reuse Endless Spa's architecture and save in the shared Tracker Song Format, so pieces can later be exported to the M8.

## Open questions

- Which kind of techno first: minimal, Detroit, acid, hypnotic, or something else?
- How much of Endless Spa's code and voices can be reused directly?
- Should listeners be able to steer it live, for example energy up or down, or more acid?

## Notes

- 2026-10-21: Captured as a sub-idea of Music Styles as Tracker Systems. The user wants to extend Endless Spa to endless techno, with different compositional principles and synth voices but the same overall structure as Endless Spa and the M8 tracker.

## Links

- [Part of: Music Styles as Tracker Systems](music-styles-as-trackers.md)
- [Uses: Tracker Song Format](tracker-song-format.md)
- [Could export to: M8 Song Writer](m8-song-writer.md)
