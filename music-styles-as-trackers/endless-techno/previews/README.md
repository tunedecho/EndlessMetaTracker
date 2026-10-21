# Previews

Generated songs, committed so there is something to hear and to try on a device without running anything. Regenerate any of them with the seed in its file name:

```sh
node endless-techno/bin/generate.js styles/hypnotic-techno.json --seed 3 --minutes 6 --out x.json --render x.wav --mp3
```

| File | What |
|---|---|
| `hypnotic-techno-3.mp3`, `-7.mp3` | Two six-minute techno tracks from the hypnotic techno style, with their song JSON |
| `hypnotic-techno-3.mid` | The same song as a Standard MIDI File (GM drums on channel 10) |
| `hypnotic-techno-m8-3.json`, `.m8s`, `.mid` | The eight-track M8 variant of seed 3; the `.m8s` is untested on hardware, back up the SD card first |
| `ambient-drift-1.mp3` | A five-minute piece from the ambient style |

MP3s are 112 kbps; the WAVs are not committed.
