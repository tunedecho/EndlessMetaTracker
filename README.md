# Endless Meta Tracker

Music styles as tracker systems: composition and sound as data, a generator that writes songs from styles, an engine that plays them, and exporters for MIDI and the Dirtywave M8.

The project lives in [`music-styles-as-trackers/`](music-styles-as-trackers/README.md).

A second, separate project is planned in [`live-console/`](live-console/README.md): the same compositional engine as a console that plays outboard gear and plugins from inside Ableton Live.

```sh
cd music-styles-as-trackers
npm install && npm test
npm run web     # player, step editor, and generator at http://localhost:8080/engine/web/
                # synth playground at http://localhost:8080/engine/web/synth.html
                # parameter cube at http://localhost:8080/engine/web/cube.html
```
