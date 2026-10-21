# Gear maps

One file per instrument, describing what the console can reach: notes, parameters over MIDI, parameters over CV, and the knobs only a hand can turn. A gear map is the hardware equivalent of an instrument's `params` in the song format: the sound half of a track that happens to live in a box.

Nothing here is verified yet. Each file starts from the manual and is marked `"verified": false` until the numbers have been checked on the unit with a MIDI monitor and, for CV, a voltmeter or a scope. Build step 1 is filling these in.

## Shape

```json
{
  "id": "td-3",
  "name": "Behringer TD-3",
  "verified": false,
  "midi": {
    "channel": 1,
    "notes": true,
    "accent": "velocity >= 100",
    "clock": "in",
    "params": {
      "filter.cutoff": { "cc": 74, "range": [0, 127] }
    }
  },
  "cv": {
    "pitch": { "input": "CV IN", "volts_per_octave": 1 },
    "gate": { "input": "GATE IN" },
    "filter.cutoff": { "input": "FILTER IN", "range_volts": [0, 5] }
  },
  "manual": {
    "filter.resonance": "knob only",
    "params.decay": "knob only"
  },
  "sources": ["manual, MIDI implementation chart, page 12"]
}
```

- `params` keys use the song format's parameter paths where a parameter means the same thing (`filter.cutoff`, `mix.volume`), so a parameter lock written for the internal `analog` engine can be sent to a box that has the matching knob. Instrument-specific parameters use the box's own names under `params.`.
- `midi.params` entries name a `cc`, or `nrpn: [msb, lsb]`, or a `sysex` template. `range` is what the box accepts.
- `cv` entries name the panel input and its scale. The console turns a lock value (0..1) into volts through `range_volts`, or into a pitch through `volts_per_octave`.
- `manual` lists what cannot be reached, so the console can show it rather than silently drop it.

## Files to write first

- `rd-8.json`: drums. Notes per voice, accent, which voices have analog trigger outs. Unknown whether any CC is honoured.
- `td-3.json`: acid. Notes, slide and accent conventions, cutoff over CC (documented), CV and gate and filter CV in.
- `model-d.json`, `odyssey.json`: monos. Notes and glide over MIDI; filter, loudness, and pitch over CV. Expect `manual` to be long.
- The two polys, once their exact models are confirmed.
- `eurorack.json`: one entry per CV, gate, and clock output in use, with the module it feeds.
