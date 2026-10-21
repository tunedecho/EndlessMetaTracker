# Tracker Song Format

> A shared, documented JSON format that fully describes a piece or a generative style by separating composition (notes, patterns, structure, rules) from sound (synth voices and their parameters).

- **Slug:** tracker-song-format
- **Status:** seed
- **Tags:** music, tracker, generative
- **Created:** 2026-10-21
- **Updated:** 2026-10-21

## What

The common language for the other projects: one structured format that can describe Endless Spa pieces, Endless Techno, and M8 songs, and is small and precise enough for a 4k-style compact version.

## Why

Endless Spa already exports full JSON. Turning that into a documented format that other systems share is what lets a style move between systems, and makes the meta-pattern concrete.

## How

Early thoughts, to refine in a workshop:

- **Two halves.** A composition half (tempo, sections, patterns, note and parameter events, and for generative pieces the rules that produce them) and a sound half (each voice's engine type and every parameter value).
- **Fixed songs and generative styles.** The same format should hold a finished song, where every event is written out, and a style, where rules generate events. A generated song could be saved as a fixed song.
- **Tracker vocabulary.** Borrow the familiar tracker structure, a song made of chains of phrases, plus instruments and tables, so it maps naturally onto the M8 and similar trackers.
- **A schema with validation.** Publish a JSON Schema and a validator, so files from any of the systems can be checked.
- **Start from what exists.** Begin with Endless Spa's current JSON and generalize it, rather than designing from scratch.

## Open questions

- How different is Endless Spa's current JSON from what the M8 needs?
- Should the generative rules be data, such as probabilities and grammars, or small scripts?
- Should it also cover video effects, as Sam's 4k tracker does?

## Notes

- 2026-10-21: Captured as a sub-idea of Music Styles as Tracker Systems: the shared format that lets the other projects exchange compositions and voices.

## Links

- [Part of: Music Styles as Tracker Systems](music-styles-as-trackers.md)
- [Used by: Endless Techno](endless-techno.md)
- [Used by: M8 Song Writer](m8-song-writer.md)
- [Used by: New Tracker Engine](new-tracker-engine.md)
