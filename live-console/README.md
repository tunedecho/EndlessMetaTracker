# Live Console

A tracker console that composes endless techno, plays the outboard gear and plugins from one place, lives inside Ableton Live, and is above all fun to play live.

This folder is the plan and, in time, the code. It is a separate project in the same repository: it reuses the generator, the song format, and the ideas of [`../music-styles-as-trackers/`](../music-styles-as-trackers/README.md) but shares no code with it until a piece is deliberately ported. The seed idea is [`docs/ideas/live-console.md`](../music-styles-as-trackers/docs/ideas/live-console.md); this file supersedes its build order.

## What it is

1. The compositional engine of the current tracker: generative styles, sections and arcs, endless mode with live energy control, jamming a song together a track at a time, parameter locks, the weirdness macros.
2. Every track plays a **destination**: a hardware synth over MIDI, a Eurorack voice over CV and gate, a plugin inside Live, or the tracker's own synth engines.
3. Ableton Live is the host. It owns the clock, the routing, and the recording; every instrument lands in its own lane and takes are kept.
4. Played live, with one hand, mid-set: fast, never finicky, and rock solid in timing.

Composition and sound stay separate, as in the format: what is played is the tracker's business; what plays it is a destination with a map. Swapping a hardware poly for a plugin changes nothing in the composition.

## What already exists

Built in `music-styles-as-trackers/` and ready to reuse:

| Need in the plan | What exists | Where |
|---|---|---|
| "Add a track, generate it" | The jam panel: add any style layer as a track, reseed it, save sets as rows; recipes kept in the song | `engine/web/jam.js`, `generateLayer` in `endless-techno/lib/generate.js` |
| Sections, arcs, endless mode, energy control | The `Session` generator and the player's Endless mode | `endless-techno/lib/`, `engine/web/app.js` |
| Hardware parameters as parameter locks | Per-note locks on any instrument parameter, validated against the instrument's schema | `format/lib/locks.js`, `format/SPEC.md` |
| Commands at section boundaries | The live player streams one bar at a time, so a command can land within a bar, not a section | `engine/web/synth-worklet.js` |
| Curated randomness, "weirdness" | Seven macro knobs that inject locks, commands, and ghost notes, with instant A/B against the original | `engine/web/weird.js` |
| MIDI output of a song | The MIDI file writer (notes, CCs for track commands, tempo) | `m8-writer/lib/midi.js` |
| Everything as data | Songs, styles, and now jam recipes and locks are plain JSON with a schema | `format/schema/` |

What does not exist: real-time MIDI output, CV output, MIDI input, any sync with a DAW, gear maps, the personal library, and the conversational layer.

## What the gear can actually do

The plan's "per-synth MIDI CC maps, so hardware parameters become parameter locks" assumes each synth exposes its knobs over MIDI. For most of the listed gear that is not so. Checked on 2026-10-21 from manufacturer and third-party sources (see Sources); confirm each against its manual and a MIDI monitor before relying on it.

| Instrument | Notes over MIDI | Parameters over MIDI | Other control |
|---|---|---|---|
| Behringer RD-8 | Yes | Unknown; no implementation chart found. Treat as notes, accent, and clock until tested | Analog triggers out on some voices, sync in and out |
| Behringer TD-3 | Yes | Filter cutoff over CC is documented; resonance and the rest are not | CV, gate, filter CV in |
| Behringer Model D | Yes | Reviewers of Behringer's analog line report no parameter CC at all (notes, glide, pitch bend). Settings are SysEx | Full CV and gate patch points: filter, loudness, oscillator pitch |
| Behringer Odyssey | Yes | Same: notes, glide, pitch bend, sequencer transport; no parameter CC found | CV, gate, filter and pitch CV in |
| Six-voice Oberheim-style poly | Yes | Depends on the exact model: an Oberheim OB-6 maps most of its panel to CC and NRPN; a Behringer UB-Xa does not. Confirm the model | — |
| Arturia poly | Yes | Depends on the model (a PolyBrute or MiniFreak maps the panel to CC; confirm) | — |
| Eurorack | — | — | CV, gate, clock: this is the whole interface |
| Plugins in Live | Yes | Every parameter, through Live's device API or the plugin's own automation | — |

So parameter locks on hardware come in three flavours, and the gear map has to say which:

- **CC or NRPN**: a parameter with a MIDI number (the polys, the TD-3's cutoff, every plugin).
- **CV**: a parameter with a voltage input on the panel (the monos' filters and pitch, all of Eurorack), driven from a DC-coupled interface or a MIDI-to-CV module.
- **None**: a knob only a hand can turn. The console shows it as a value to set by hand and never pretends to lock it.

This changes the first live test: the TD-3's acid line gets its cutoff locks over CC, the Model D gets its filter from a CV lane, and the RD-8 gets notes and accents only until its CC behaviour is measured.

## How it lives inside Live

**Decision for the first spike: a Max for Live device.** Live 12 bundles Max 9, and Max 9 has a `v8` object that runs modern JavaScript on the engine behind Chrome and Node; Node for Max is there as a second path for anything that needs Node itself. That means the generator and the format (plain ES modules, no dependencies) can run inside the device with little or no porting. Max for Live also gives transport and tempo from Live, MIDI routing to tracks, CV output through CV Tools, and recording, which are exactly the finicky parts the console should not own.

Requirements that follow:

- **Live 12 Suite** (Max for Live is Suite-only; Max 9 does not run on Live 11).
- **A DC-coupled audio interface** for CV from Live: AC-coupled outputs filter out sustained voltages. Ableton lists interfaces with DC-coupled outputs as the ones that can send CV; several Expert Sleepers, MOTU, and UAD Apollo models qualify. Eurorack levels are hotter than line level, so CV never goes near the speakers.
- **Per-studio config**: a file naming the Live tracks, MIDI ports and channels, CV outputs, and gear maps, so a session starts in one click.

Routes considered and set aside, with the reason:

- **VST3 or CLAP plugin with MIDI out.** Tight timing and host-independent, but it needs a C++ or Rust build, a plugin's MIDI-out routing in Live is clumsy, and CV would still need Live's help. Keep for later if the Max route proves too slow for the JavaScript engine.
- **External app synced over Ableton Link and MIDI clock.** Link is a C++ library with Node bindings; there is no browser build, and MIDI clock alone drifts. Live would also not own the recording. The browser tracker as it stands could send MIDI through Web MIDI in Chrome, which is a cheap way to hear the generator on the TD-3 before the Max device exists, but not the destination.

## Timing and input

- The console follows Live's transport and tempo, starts and stops with it, and places every event on Live's grid in samples, not in UI time.
- Live MIDI input is recorded with its exact timing. The format's `nudge` only delays a note (0 to 1 of a step), so played-in parts that land early cannot be represented yet. The format needs a signed offset, or notes stored with a time in ticks alongside the step, before the personal library can keep feel intact. Decide this with the library's storage question.
- The audition loop (randomise, listen, again) is already instant in the browser; in the console it must stay under a bar.

## The personal library

Parts the user keeps: melodies, bass lines, chord changes, drum patterns. Store each as tracker phrases in the shared format (so the generator, the validator, and the M8 writer already read them), tagged with the destination and the key it was played in, plus a derived abstract form (scale degrees and rhythm) so a part can be re-targeted to another key or instrument. Generation then draws from the library, the built-in defaults, or a blend, with the weirdness macros on top. This is the "styles from examples" line of the parent idea, made concrete.

## Talking to it

Speech or text to Claude, mid-set, becomes a structured command the console applies: at the next bar for fills and locks, at the next section for arrangement. The vocabulary maps onto what the generator already has: energy nudges, section kinds (breakdown, build, drop), add and remove a layer, fills, automation moves, macro knobs, and library picks. The same commands are buttons, so the console works without speech, and a command log makes a set reproducible.

## Build order

1. **Gear facts first.** For each box, read the manual's MIDI implementation chart and test with a MIDI monitor: which notes, CCs, NRPNs, and SysEx it takes; which CV inputs it has. Write the result into `gear/` (see [gear/README.md](gear/README.md)). Confirm the two "which model?" synths. This decides how much of the plan's parameter-lock idea survives on hardware.
2. **The one-day spike: Max for Live and `v8`.** A device that loads `format/lib/core.js` and the generator unchanged, follows Live's transport, and sends a generated acid line to the TD-3 on the grid, with cutoff over CC. Measure jitter against Live's own MIDI clip. If `v8` cannot keep up, try Node for Max, then the plugin route.
3. **Destinations in the data.** Add `destination` to a track (MIDI port and channel, CV outputs, plugin device, or internal engine) and a `gear` map to the sound half, as a schema extension the browser tracker ignores. Keep it in `live-console/` until it is stable, then propose it for the shared format.
4. **Tracks to hardware.** Add a track, generate, assign, hear it on the gear, record it in Live. The jam panel's operations, driving destinations instead of the internal engine.
5. **Live input and the audition loop.** Exact timing in; the format change for early notes; randomise-listen-again under a bar.
6. **The personal library** and generation from it.
7. **The conversational layer**, buttons first, speech second.
8. **A full rehearsal** with the first live test setup: RD-8 on drums, TD-3 on acid, one poly on pads, everything recorded in Live, endless mode running, energy control and "add drum fills" working by voice. Fix what is finicky.

## Open questions

- CV from Live (CV Tools over a DC-coupled interface) or from a MIDI-to-CV module driven by the console? Which gives tighter timing on the Eurorack, and which is simpler to set up at a gig?
- How are gear maps authored: by hand from the manuals, imported from community maps (Ctrlr panels, MIDI Quest profiles), or MIDI-learned from the hardware? Probably by hand for the first three, since the maps are short.
- Where do the mono synths' filter sweeps come from when the box has no CC: a CV lane from Live, a MIDI-to-CV module, or a hand on the knob (with the console just showing the target)?
- How much of the browser tracker carries over? The format and the generator do; the synth voices become one destination among many; the web UI becomes the model for the device's UI but is not the device.

## Sources

Checked 2026-10-21. Gear facts are second-hand until measured on the units.

- Behringer analog synths' MIDI: notes, glide, pitch bend, transport, no parameter CC: [Gearnews on the Ctrlr patch saver](https://www.gearnews.com/ctrlr-patch-saver-vst-plugin-for-behringer-odyssey-poly-d-neutron-pro-1-k2-and-model-d); Poly D cannot be controlled by CC: [Gearspace](https://gearspace.com/threads/behringer-poly-d.1307812/); Model D settings are SysEx: [Synthtopia](https://www.synthtopia.com/?p=95708)
- TD-3 cutoff over MIDI CC: [Thomann](https://www.thomannmusic.com/behringer_td_3_mo.htm); Elektronauts on "cutoff but that's about it": [Elektronauts](https://elektronauts.com/t/behringer-td-3-mo-modded-out/156829)
- RD-8: no implementation chart found; [MPC Forums thread](https://www.mpc-forums.com/viewtopic.php?p=1784906) asks the same question
- Odyssey firmware notes (MIDI thru): [Behringer release notes](https://cdn.mediavalet.com/aunsw/musictribe/JYvRvUjRok2j8zumjb_L9w/PbwKtYOuD0arHgUBN4q-gA/Original/Release-Notes_BE_0722-AAB_ODYSSEY_v1-2-0_2022-11-03_Rev-1.pdf)
- Max 9 `v8` object and Node for Max: [Sound On Sound review](https://www.soundonsound.com/reviews/cycling-74-max-9), [Cycling '74 Max 9](https://cycling74.com/ja/products/max-9), [Max 9.0.6 notes](https://cycling74.com/forums/max-906-released)
- Live 12 bundles Max 9; Max 9 needs Live 12; Max for Live is Suite-only: [Ableton: recommended Max versions](https://help.ableton.com/hc/en-us/articles/209772305), [Building Max Devices pack](https://www.ableton.com/fr/packs/building-max-devices/)
- CV Tools needs a DC-coupled interface: [Ableton: CV Tools FAQ](https://help.ableton.com/hc/en-us/articles/360004966139), [Ableton: CV-enabled hardware with Live](https://help.ableton.com/hc/en-us/articles/360005621939)
- Ableton Link is a C++ library with Node bindings, no browser build: [abletonlink on npm](https://www.npmjs.com/package/abletonlink), [Ableton: Link FAQ](https://help.ableton.com/hc/articles/209776125)
