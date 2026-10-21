# Music Styles as Tracker Systems

> The meta-pattern: express a whole musical style as a tracker system that fully defines both its compositions (notes, patterns, structure, generative rules) and every synth voice needed to make the sounds, all as structured data.

- **Slug:** music-styles-as-trackers
- **Status:** seed
- **Tags:** music, tracker, generative
- **Created:** 2026-10-21
- **Updated:** 2026-10-21

## What

An umbrella idea tying together several systems that share one pattern: a complete piece of music, or a complete generative style, is defined entirely in terms of its composition and its sound parameters.

- **Endless Spa.** A synthesizer the user made. It composes the relaxing music heard in spas and plays it on synth voices within its own ecosystem. Every parameter of the composition and of the voices is described and can be downloaded as structured JSON.
- **Sam's 4k tracker.** The user's friend Sam made demoscene tracker software in the spirit of the 90s scene, for making musical and video effects compositions in as little as 4 kilobytes.
- **The Dirtywave M8.** A tracker that runs several defined synth voices and takes note events and other programmed events to generate songs. A composition and all its sounds are completely defined within the M8 system.

The meta-pattern is to express whole musical styles in this way: tracker systems that detail the notes of compositions as well as all of the synthesizer voices needed to make the sounds.

## Why

When composition and sound are both fully specified as data, a style becomes something you can inspect, generate from, share, version, and compare. One shared structure would let a style written for one system, such as Endless Spa, move to another, such as the M8, and let new styles be built from the same parts.

## How

The work splits into four projects that can be done separately, plus this idea as the frame that connects them:

1. **Endless Techno.** Extend Endless Spa to a new style with its own compositional principles and synth voices. The first proof that the pattern carries across styles.
2. **Tracker Song Format.** A shared, documented JSON format that separates composition from sound, so every other project speaks the same language.
3. **M8 Song Writer.** Write whole songs, including their instruments, for the M8 tracker.
4. **New Tracker Engine.** A much expanded tracker in the spirit of the M8, with rewritten synth engines.

Further directions for the meta-pattern itself:

- **A library of styles.** Spa and techno first, then others such as ambient, dub, chiptune, or the 90s demoscene sound, each defined by its compositional rules, arrangement habits, and voice set.
- **How small can a style be?** Sam's 4k work suggests a useful test: the smallest complete definition that still produces recognizable music in a style.
- **Styles from examples.** Instead of writing rules by hand, a style could be built from stored example patterns and recombined when generating. This echoes the instance-based models in the user's research.

## Open questions

- Which sub-project comes first? Endless Techno builds directly on working code.
- Should Sam be involved, for example by sharing the 4k tracker's format or co-designing the song format?
- Is the end goal making music, building tools for others, or studying musical style itself?

## Notes

- 2026-10-21: Captured from chat. The user made Endless Spa, a synthesizer that composes and plays spa music, with every composition and voice parameter downloadable as JSON. Related: their friend Sam's 90s-scene demo tracker for music and video effects in as little as 4k, and the Dirtywave M8 tracker, where a composition and its sounds are fully defined within the system. The user wants to extend Endless Spa to Endless Techno, write whole songs for the M8, possibly greatly expand the M8 idea with rewritten synth engines, and consider the meta-pattern of expressing whole musical styles as tracker systems. Split into this parent idea and four sub-ideas.

## Links

- [Sub-idea: Endless Techno](endless-techno.md)
- [Sub-idea: Tracker Song Format](tracker-song-format.md)
- [Sub-idea: M8 Song Writer](m8-song-writer.md)
- [Sub-idea: New Tracker Engine](new-tracker-engine.md)
- Related: Natural MPE Pairings (in the Idea Console as `natural-mpe-pairings`)
