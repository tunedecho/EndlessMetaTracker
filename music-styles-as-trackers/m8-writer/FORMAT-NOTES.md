# M8 song file format notes

What this writer relies on, where it comes from, and what is still unknown. Dirtywave has not published the format; everything here is community reverse engineering.

## Sources

- [Twinside/m8-file-parser](https://github.com/Twinside/m8-file-parser) 0.7.0 (Rust, MIT, updated September 2026, "covers firmware 4.0 to 6.6"). Successor of [AlexCharlton/m8-files](https://github.com/AlexCharlton/m8-files) 0.3.1. Its `src/songs.rs`, `src/instruments/*.rs`, `src/fx.rs` give the offsets below. Its `examples/songs/` holds empty songs saved by each firmware (`V4EMPTY`, `V5EMPTY`, `V6EMPTY`, `V6_2EMPTY`, `V6_6EMPTY`) and a command-mapping song with screenshots of every instrument screen next to the bytes.
- [AlexCharlton/midi-m8](https://github.com/AlexCharlton/midi-m8): converts M8 songs to MIDI; its `global_transpose: 36` gives the note offset, and it reads chain transpose as `i8`.
- [whitlockjc/m8-js](https://github.com/whitlockjc/m8-js): the original JavaScript reverse engineering both Rust crates credit.
- Firmware state: Dirtywave's OS 6.6.2 changelog is dated August 2026 (via a September 2026 blog post). The official manual PDF (version 6.0.0) could not be fetched from this session's network.

## File layout (file versions 4.0 through 6.6)

| Offset | Size | Content |
|---|---|---|
| 0x00 | 10 | `M8VERSION\0` |
| 0x0A | 2 | version: byte 0 = `minor << 4 | patch`, byte 1 = major. 6.6.2 is `62 06`. |
| 0x0C | 2 | `00 00` (the Rust writer writes `00 10` for new files; the template keeps `00 00`) |
| 0x0E | 128 | directory string, `/Songs/` |
| 0x8E | 1 | transpose |
| 0x8F | 4 | tempo, float32 little-endian |
| 0x93 | 1 | quantize |
| 0x94 | 12 | song name |
| 0xA0 | 27 | MIDI settings |
| 0xBB | 1 | key |
| 0xBC | 18 | unknown |
| 0xCE | 32 | mixer settings |
| 0xEE | 512 | 32 grooves x 16 bytes |
| 0x2EE | 2048 | song: 256 rows x 8 tracks, chain number or 0xFF |
| 0xAEE | 36720 | 255 phrases x 16 steps x 9 bytes |
| 0x9A5E | 8160 | 255 chains x 16 steps x 2 bytes |
| 0xBA3E | 32768 | 256 tables x 16 rows x 8 bytes |
| 0x13A3E | 27520 | 128 instruments x 215 bytes |
| 0x1A5BE | 3 | unknown |
| 0x1A5C1 | | effects settings |
| 0x1A5FE | 896 | 128 MIDI mappings x 7 bytes |
| 0x1A97E | 256 | song bookmarks bit mask |
| 0x1AA7E | | 16 scales |
| 0x1AD5E | | EQs: 32 (4.0) or 128 (5.0+) plus 4, 32 bytes each |
| 0x1B6A6 | 32 | groove PPQN (6.5+) |
| 0x1B6C6 | 256 | row bookmarks (6.6+) |

File sizes: 110566 (4.0), 112294 (4.2 to 6.2), 112582 (6.6).

The region sizes chain exactly (song end = phrases start, and so on); the tests assert this.

### Phrase step, 9 bytes

`note, velocity, instrument, fx1 cmd, fx1 val, fx2 cmd, fx2 val, fx3 cmd, fx3 val`. 0xFF means empty for note, velocity, instrument and command. Note 0x24 displays as C-4 (confirmed by the command-mapping phrase 00 screenshot); midi-m8 adds 36 to get the MIDI note. A note byte >= 0x80 displays as OFF in the parsers; the exact byte the M8 writes for OFF is **unconfirmed**, this writer uses 0x80.

### Chain step, 2 bytes

`phrase, transpose`. Phrase 0xFF is empty. Transpose is a signed byte (midi-m8 reads it as `i8`).

### Table row, 8 bytes

`transpose, velocity, fx1 cmd, fx1 val, fx2 cmd, fx2 val, fx3 cmd, fx3 val`. Empty row: transpose 0, velocity 0xFF, commands 0xFF. Table N is instrument N's table; 0x80 to 0xFF are free tables.

### Instrument, 215 bytes

| Offset | Content |
|---|---|
| 0 | kind: 0 WAVSYNTH, 1 MACROSYNTH, 2 SAMPLER, 3 MIDIOUT, 4 FMSYNTH, 5 HYPERSYNTH, 6 EXTERNAL, 0xFF none |
| 1 | name, 12 bytes |
| 13 | bit 0: transpose on (eq number lived in the upper bits before 5.0) |
| 14 | TBL.TIC |
| 15 | "volume" (not on the instrument screen; always 0 in the samples) |
| 16 | PITCH (signed) |
| 17 | FINE, 0x80 centre |
| 18.. | engine specific, see below |
| params | 10 bytes: FILTER, CUTOFF, RES, AMP, LIM, PAN, DRY, MFX (chorus before 6.2), DEL, REV |
| 36 | a byte the 6.6 parser calls `shape`; 0xFF in every sample. Not written. |
| 62 | EQ number (5.0+), 0xFF none |
| 63 | 4 modulators x 6 bytes |

Engine bytes:

- WAVSYNTH and MACROSYNTH: 18 shape, 19..22 four parameters (SIZE MULT WARP SCAN, or TIMBRE COLOR DEGRADE REDUX); params at 23. Confirmed against `instr00.png` (shape 0x45, SIZE F0, MULT E0, WARP D0, SCAN C0, FILTER 01, CUTOFF A0, RES 90, AMP 80, LIM 01, PAN 80, DRY C0, CHO 60, DEL 50, REV 40).
- FMSYNTH: 18 ALGO, 19..22 operator shapes, 23..30 ratio integer and ratio hundredths per operator, 31..38 level and feedback per operator, 39..42 mod A routing, 43..46 mod B routing, 47..50 MOD1..4; params at 51. Confirmed against `instr30.png` (ALGO 03, ratios 05.00 05.25 01.50 02.75, LEV/FB 80/10 80/20 80/30 80/50, MOD 10 20 30 40, FILTER 06, CUTOFF AF, RES 30, AMP 70, LIM 07, PAN 80, DRY A0, CHO 80, DEL 90, REV A0).
- WAVSYNTH shapes: 0 PULSE12, 1 PULSE25, 2 PULSE50, 3 PULSE75, 4 SAW, 5 TRIANGLE, 6 SINE, 7 NOISE PITCHED, 8 NOISE, 9+ wavetables.
- MACROSYNTH shapes (Braids models): 34 KICK, 35 CYMBAL, 36 SNARE, 41 FILTERED NOISE.
- FM algorithms: 0 `A>B>C>D` ... 7 `[A>B]+[C>D]` ... 11 `A+B+C+D`.

Modulator, 6 bytes: byte 0 = `type << 4 | destination`. Types: 0 AHD (amount, attack, hold, decay), 1 ADSR (amount, attack, decay, sustain, release), 2 DRUM (amount, peak, body, decay), 3 LFO (amount, shape, trigger mode, freq, retrigger), 4 TRIG, 5 TRACKING. Destinations for WAVSYNTH/MACROSYNTH/FMSYNTH: 0 OFF, 1 VOLUME, 2 PITCH, 3..6 engine specific, 7 CUTOFF, 8 RES, 9 AMP, 10 PAN, 11..14 MOD AMT/RATE/BOTH/BINV. LFO shapes: 0 TRI, 1 SIN, 2 RAMP DOWN, 3 RAMP UP, 4 EXP DN, 5 EXP UP, 6 SQR DN, 7 SQR UP, 8 RANDOM, 9 DRUNK, 10+ triggered variants. Unused slot in the samples: `00 FF 00 00 80 FF` (AHD, destination OFF).

### Commands

Sequencer commands (firmware 3+ numbering, confirmed by the phrase A0 screenshot): 00 ARP, 01 CHA, 02 DEL, 03 GRV, 04 HOP, 05 KIL, 06 RND, 07 RNL, 08 RET, 09 REP, 0A RMX, 0B NTH, 0C PSL, 0D PBN, 0E PVB, 0F PVX, 10 SCA, 11 SCG, 12 SED, 13 SNG, 14 TBL, 15 THO, 16 TIC, 17 TBX, 18 TPO, 19 TSP, 1A OFF. Mixer commands follow from 1B (VMV) to 4D (6.2 list).

Instrument commands are `0x80 + index` into the instrument's own list. For WAVSYNTH, MACROSYNTH and FMSYNTH the shared positions are 80 VOL, 81 PIT, 82 FIN, 88 FIL/FLT, 89 CUT, 8A RES, 8B AMP, 8C LIM, 8D PAN, 8E DRY, 8F SCH/SMX, 90 SDL, 91 SRV. Positions 83..87 are engine specific (OSC SIZ MUL WRP MIR / OSC TBR COL DEG RED / ALG FM1 FM2 FM3 FM4). Modulator commands start at 0x92, five per modulator.

## Open questions

1. **Will firmware 6.6 load the file?** The template is a genuine 6.6.2 save and only documented regions change, so the risk is in the values, not the structure. Untested.
2. **OFF note byte.** 0x80 assumed.
3. **RET value.** Written as the tick interval (6 / retrig count) in the low byte. The manual's `x`/`y` nibble semantics are unverified.
4. **CHA value.** Written as probability x 255. The manual may define it as a nibble pair.
5. **DEL, OFF, PSL units.** Assumed ticks with 6 ticks per step (the default groove is `06 06`).
6. **Velocity scale.** 00..FE written; FF means "use the instrument's default". Whether FE equals full volume is unverified.
7. **Envelope and LFO byte curves.** `envByte(seconds) = sqrt(seconds / 4) * 255` is a guess shaped to put 0.1 s near 0x28 and 1 s near 0x80.
8. **MACROSYNTH timbre and color** for the drum models: mapped from the engine's most related parameters.
9. **Table loop control with HOP.** Tiled when 16 is a multiple of the row count; otherwise HOP on the first unused row (may sound for one tick); HOP to self on the last row for non-looping tables.
10. **Byte 36 of an instrument** (`shape` in the 6.6 parser) is left at 0xFF.
11. **Instrument "volume" byte 15** left at 0.
12. **Swing** could become an M8 groove (`GRV`); not done.
13. **Chains longer than the M8's 255 and phrases beyond 255** raise errors; long generated songs may hit these limits and need phrase deduplication beyond what the writer does now (it already shares identical phrase/instrument pairs and identical chains).
