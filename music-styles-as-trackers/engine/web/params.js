/**
 * Instrument parameters as the format's schema describes them: resolving
 * references, mapping a value to 0..1 and back the way a control should, and
 * listing every parameter an instrument can have. Shared by the synth
 * playground (controls) and the cube (lanes).
 */

/** Resolve a `$ref` against the schema's $defs; `ref` is the definition's name, or null. */
export function deref(defs, raw) {
  if (!raw.$ref) return { node: raw, ref: null };
  const ref = raw.$ref.split('/').pop();
  const { $ref, ...rest } = raw;
  return { node: { ...defs[ref], ...rest }, ref };
}

/** Mapping between a value and 0..1: linear, cubic for times and rates (fine control near zero), log for wide positive ranges. */
export function scaleFor(node, ref, key) {
  const integer = node.type === 'integer';
  let min = node.minimum ?? 0, max = node.maximum;
  let kind = 'lin';
  if (ref === 'seconds') { max = 10; kind = 'pow'; }
  else if (key === 'rate') kind = 'pow';
  else if (key === 'sync') { min = 0.25; max = 64; kind = 'log'; }
  else if (!integer && min > 0 && max / min >= 20) kind = 'log';
  const to = kind === 'log' ? (v) => Math.log(v / min) / Math.log(max / min)
    : kind === 'pow' ? (v) => Math.cbrt((v - min) / (max - min))
    : (v) => (v - min) / (max - min);
  const from = kind === 'log' ? (x) => min * Math.pow(max / min, x)
    : kind === 'pow' ? (x) => min + (max - min) * x * x * x
    : (x) => min + (max - min) * x;
  const round = integer ? Math.round : (v) => Number(v.toPrecision(3));
  const rest = node.default ?? (min < 0 && max > 0 ? 0 : min);
  return { integer, min, max, to, from, round, rest, hardMin: node.minimum ?? node.exclusiveMinimum ?? -Infinity, hardMax: node.maximum ?? Infinity };
}

/**
 * Every leaf parameter under a schema node, in schema order: numbers,
 * enums, and booleans, with their path, description, and a `norm` to 0..1.
 */
export function leafParams(defs, schemaNode, path = []) {
  const out = [];
  for (const [key, raw] of Object.entries(schemaNode.properties || {})) {
    const { node, ref } = deref(defs, raw);
    const p = [...path, key];
    if (node.type === 'object' && node.properties) out.push(...leafParams(defs, node, p));
    else if (node.enum) out.push({ path: p, description: node.description, kind: 'enum', options: node.enum, norm: (v) => (node.enum.length > 1 ? node.enum.indexOf(v) / (node.enum.length - 1) : 1) });
    else if (node.type === 'boolean') out.push({ path: p, description: node.description, kind: 'bool', norm: (v) => (v ? 1 : 0) });
    else if (node.type === 'number' || node.type === 'integer') {
      const sc = scaleFor(node, ref, key);
      out.push({ path: p, description: node.description, kind: 'number', default: node.default, norm: (v) => Math.min(1, Math.max(0, sc.to(Math.min(sc.max, v)))) });
    }
  }
  return out;
}
