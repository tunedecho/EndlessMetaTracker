/**
 * Validation: JSON Schema via Ajv, plus the referential checks a schema cannot express
 * (every chain names a real phrase, every step a real instrument, and so on).
 */
import { createRequire } from 'node:module';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { checkSongReferences, checkStyleReferences } from './refs.js';

export { checkSongReferences, checkStyleReferences };

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
