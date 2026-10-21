# Tracker Song Format

The shared JSON format: schema, validator, helper library, and examples. Phase 1 in `../ROADMAP.md`. Read `SPEC.md` for the design and `schema/song.json` and `schema/style.json` for the exact contract.

```sh
node bin/validate.js --stats examples/*.json ../styles/*.json   # validate, print sizes
```

```js
import { validate, resolve, toMidi, Random, songStats } from '@tracker/format';
```

- `lib/core.js` is browser-safe (notes, seeded random, song flattening, reference checks).
- `lib/validate.js` adds JSON Schema validation with Ajv; `lib/stats.js` adds counts and gzipped sizes.
- `examples/` holds three hand-written songs that double as engine test material.
