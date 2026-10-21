# Review notes

An independent review agent read the engine, generator, and format during the first build session and confirmed twelve defects with reproduction scripts; all are fixed and covered by `engine/test/regressions.test.js` and `endless-techno/test/regressions.test.js`. These are the concerns it raised but did not confirm as defects, kept here so they are not forgotten.

- **Delay time jumps on tempo change.** `Delay.setTime` moves the read pointer instantly, a small discontinuity in the wet signal. A slewed length or crossfade would be safer.
- **Legato re-runs the attack.** A slide triggers the envelopes from their current level, so slid acid notes get a small attack bump instead of a 303-style held envelope. A deliberate choice is needed: keep, or hold the envelope on slides.
- **Choked tails on pads are audible.** Up to four release tails per track are kept; beyond that the oldest is faded in 3 ms. With long pad releases and retrigs that fade can be heard. A longer fade or a higher cap for long-release instruments would help.
- **Tables switch up to 16 samples early** because the table advances before the sub-block renders. Harmless.
- **Oscillator phase wraps once per sample**, so a frequency above the sample rate (extreme pitch commands) aliases rather than failing. Clamp the pitch if that matters.
- **Endless mode bookkeeping grows without bound**: step starts, rows, phrases, and chains accumulate (about 300k entries per 10 hours). Fine for now; trim behind the playhead if runs get very long.
- **Underrun has no guard.** If the player renders past its appended rows before the next row arrives, the late row's events all fire at once on the next block. The browser keeps two sections ahead; a warning or a hold would make the API safer.
- **Unused style fields.** `arrangement.breakdown.minGap`, `arrangement.energy.momentum`, and `energy.step` beyond jitter are accepted by the schema but not read by the arc planner. Remove them or make the planner honour them.
