/**
 * Validation: JSON Schema via Ajv, plus the referential checks a schema cannot express
 * (every chain names a real phrase, every step a real instrument, and so on).
 */
import { createRequire } from 'node:module';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const require = createRequire(import.meta.url);
const songSchema = require('../schema/song.json');
const styleSchema = require('../schema/style.json');

let ajv;
function getAjv() {
  if (ajv) return ajv;
  ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
  addFormats(ajv);
  // Register under the relative ids used by $ref so cross-file refs resolve.
  ajv.addSchema(songSchema);
  ajv.addSchema(styleSchema);
  return ajv;
}

function formatErrors(errors) {
  return (errors || []).map((e) => `${e.instancePath || '/'} ${e.message}${e.params?.allowedValues ? ' (' + e.params.allowedValues.join(', ') + ')' : ''}`);
}

/** Checks that need the whole document. Returns a list of problems. */
export function checkSongReferences(song) {
  const problems = [];
  const { instruments, tables = {} } = song.sound;
  const { tracks, phrases, chains, song: grid } = song.composition;
  const pl = song.transport.phraseLength ?? 16;
  const trackIds = new Set();
  tracks.forEach((t, i) => {
    if (trackIds.has(t.id)) problems.push(`tracks[${i}]: duplicate track id ${t.id}`);
    trackIds.add(t.id);
    if (t.instrument && !instruments[t.instrument]) problems.push(`tracks[${i}]: unknown instrument ${t.instrument}`);
  });
  for (const [id, inst] of Object.entries(instruments)) {
    if (inst.table && !tables[inst.table]) problems.push(`instruments.${id}: unknown table ${inst.table}`);
  }
  for (const [id, phrase] of Object.entries(phrases)) {
    if (phrase.steps.length !== pl) problems.push(`phrases.${id}: has ${phrase.steps.length} steps, transport.phraseLength is ${pl}`);
    phrase.steps.forEach((s, i) => {
      if (!s) return;
      if (s.inst && !instruments[s.inst]) problems.push(`phrases.${id}[${i}]: unknown instrument ${s.inst}`);
      if (s.fx?.table && !tables[s.fx.table]) problems.push(`phrases.${id}[${i}]: unknown table ${s.fx.table}`);
    });
  }
  for (const [id, chain] of Object.entries(chains)) {
    chain.rows.forEach((r, i) => {
      if (!phrases[r.phrase]) problems.push(`chains.${id}[${i}]: unknown phrase ${r.phrase}`);
    });
  }
  grid.rows.forEach((row, i) => {
    for (const [trackId, chainId] of Object.entries(row)) {
      if (!trackIds.has(trackId)) problems.push(`song.rows[${i}]: unknown track ${trackId}`);
      if (chainId && !chains[chainId]) problems.push(`song.rows[${i}].${trackId}: unknown chain ${chainId}`);
    }
  });
  if (song.transport.loop !== undefined && song.transport.loop >= grid.rows.length) problems.push(`transport.loop ${song.transport.loop} is past the last row`);
  // A note with no instrument anywhere is silent; flag it.
  tracks.forEach((t) => {
    if (t.instrument) return;
    for (const row of grid.rows) {
      const chainId = row[t.id];
      if (!chainId || !chains[chainId]) continue;
      for (const r of chains[chainId].rows) {
        const ph = phrases[r.phrase];
        if (!ph) continue;
        ph.steps.forEach((s, i) => {
          if (s && s.note !== undefined && s.note !== 'OFF' && !s.inst) problems.push(`phrases.${r.phrase}[${i}]: note on track ${t.id} has no instrument (track has no default)`);
        });
      }
    }
  });
  return problems;
}

export function checkStyleReferences(style) {
  const problems = [];
  const { instruments, tables = {} } = style.sound;
  const layerIds = new Set();
  style.layers.forEach((l, i) => {
    if (layerIds.has(l.id)) problems.push(`layers[${i}]: duplicate layer id ${l.id}`);
    layerIds.add(l.id);
    if (!instruments[l.instrument]) problems.push(`layers[${i}] (${l.id}): unknown instrument ${l.instrument}`);
    if (l.generator?.fx?.table && !tables[l.generator.fx.table]) problems.push(`layers[${i}] (${l.id}): unknown table ${l.generator.fx.table}`);
  });
  for (const id of Object.keys(style.variations || {})) {
    if (!instruments[id]) problems.push(`variations.${id}: unknown instrument`);
  }
  for (const [id, inst] of Object.entries(instruments)) {
    if (inst.table && !tables[inst.table]) problems.push(`instruments.${id}: unknown table ${inst.table}`);
  }
  return problems;
}

/**
 * Validate a song or a style document.
 * @returns {{ok: boolean, kind: 'song'|'style'|'unknown', errors: string[]}}
 */
export function validate(doc) {
  const kind = doc?.format === 'tracker-song/0.1' ? 'song' : doc?.format === 'tracker-style/0.1' ? 'style' : 'unknown';
  if (kind === 'unknown') return { ok: false, kind, errors: [`unknown format: ${doc?.format}`] };
  const v = getAjv().getSchema(kind === 'song' ? songSchema.$id : styleSchema.$id);
  const errors = [];
  if (!v(doc)) errors.push(...formatErrors(v.errors));
  else errors.push(...(kind === 'song' ? checkSongReferences(doc) : checkStyleReferences(doc)));
  return { ok: errors.length === 0, kind, errors };
}

/** Throw on an invalid document. */
export function assertValid(doc, label = 'document') {
  const r = validate(doc);
  if (!r.ok) throw new Error(`${label} is not a valid ${r.kind}:\n  ${r.errors.join('\n  ')}`);
  return doc;
}
