# M8 Song Writer

> Write whole songs, including all their instruments, for the Dirtywave M8 tracker, from a style definition or a conversation with Claude.

- **Slug:** m8-song-writer
- **Status:** seed
- **Tags:** music, tracker, generative
- **Created:** 2026-10-21
- **Updated:** 2026-10-21

## What

A tool that produces complete songs for the M8: the notes and patterns, plus the instruments that make the sounds, ready to load and play.

## Why

The M8 already fully defines a song and its sounds inside one system. Generating M8 songs from a style definition, for example from Endless Techno, turns styles into music on a real instrument the user can then play, perform, and edit by hand.

## How

Early thoughts, to refine in a workshop:

- **Two ways in.** Write M8 song and instrument files directly, or drive the M8 live over MIDI. Writing files gives complete songs with their instruments. MIDI is simpler but leaves sound design on the device.
- **The file format.** M8 song files are a binary format. Community projects have documented and parsed it; check how complete and current that work is before relying on it, and test every generated file on the device.
- **Map from the shared format.** Translate the Tracker Song Format into M8 terms: song, chains, phrases, instruments, and tables, and the M8's own synth engines and their parameters.
- **Claude as co-writer.** Describe a song in words, and Claude writes it in the shared format, which is then converted for the M8.
- **Round trip.** Reading M8 files back into the shared format would let hand-made M8 songs become examples for a style.

## Open questions

- Write song files directly, or drive the M8 over MIDI first?
- Which M8 hardware and firmware version should it target?
- Which style should the first generated M8 song be?

## Notes

- 2026-10-21: Captured as a sub-idea of Music Styles as Tracker Systems. The user wants to be able to write whole songs for the M8 tracker.

## Links

- [Part of: Music Styles as Tracker Systems](music-styles-as-trackers.md)
- [Uses: Tracker Song Format](tracker-song-format.md)
- [Source style: Endless Techno](endless-techno.md)
