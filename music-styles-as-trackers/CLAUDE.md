# Music Styles as Tracker Systems

A repo for expressing musical styles as tracker systems that fully define both composition and sound as data. Read `README.md` for the overview and `ROADMAP.md` for the build order.

## Layout

```
format/          Tracker Song Format: JSON Schema, validator, examples (Phase 1)
endless-techno/  generative techno style built on the shared format (Phase 2)
m8-writer/       converts songs and styles to Dirtywave M8 songs (Phase 3)
engine/          new tracker engine with rewritten synth engines (Phase 4)
docs/ideas/      the original ideas from the Idea Console, as markdown and JSON
```

## Conventions

- The shared format in `format/` is the contract between projects. Change it deliberately, update the schema and examples together, and keep the validator passing on every example.
- Keep composition and sound separate in every file: what is played, and what plays it.
- Start from Endless Spa's existing JSON. Ask the user for real exports instead of inventing their structure.
- Anything generated for the M8 must be tested on the device or its official tooling before it is called working. The M8 file format comes from community documentation, which may be incomplete.
- Before building the new engine, confirm the plan with the user. It is the largest project and depends on the earlier phases.
- The ideas in `docs/ideas/` record intent and open questions. When a decision answers one of those questions, note it in `ROADMAP.md` or the relevant project's README.
