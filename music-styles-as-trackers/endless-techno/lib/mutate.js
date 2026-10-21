/**
 * Mutations: small changes to a phrase so a layer drifts over a long run
 * instead of looping identically. Each op returns a new step list.
 */
import { toMidi, toName } from '@tracker/format';

const isHit = (s) => s && s.note !== undefined && s.note !== 'OFF';

export const OPS = {
  rotate(steps, rnd) {
    const n = steps.length;
    const by = rnd.pick([-2, -1, 1, 2]);
    return steps.map((_, i) => steps[((i - by) % n + n) % n]);
  },
  drop(steps, rnd) {
    const idx = steps.map((s, i) => (isHit(s) ? i : -1)).filter((i) => i >= 0);
    if (idx.length <= 1) return steps;
    const out = steps.slice();
    out[rnd.pick(idx)] = null;
    return out;
  },
  add(steps, rnd) {
    const hits = steps.filter(isHit);
    const empty = steps.map((s, i) => (s ? -1 : i)).filter((i) => i >= 0);
    if (!hits.length || !empty.length) return steps;
    const out = steps.slice();
    const src = rnd.pick(hits);
    out[rnd.pick(empty)] = { ...src, vel: Math.round(((src.vel ?? 1) * 0.8) * 100) / 100 };
    return out;
  },
  transpose(steps, rnd, ctx) {
    const by = rnd.pick(ctx.intervals.filter((i) => i > 0 && i <= 7));
    const dir = rnd.chance(0.5) ? 1 : -1;
    return steps.map((s) => (isHit(s) ? { ...s, note: toName(toMidi(s.note) + by * dir) } : s));
  },
  swap(steps, rnd) {
    const idx = steps.map((s, i) => (isHit(s) ? i : -1)).filter((i) => i >= 0);
    if (idx.length < 2) return steps;
    const out = steps.slice();
    const a = rnd.pick(idx), b = rnd.pick(idx);
    [out[a], out[b]] = [out[b], out[a]];
    return out;
  },
  velocity(steps, rnd) {
    return steps.map((s) => (isHit(s) ? { ...s, vel: Math.round(Math.max(0.2, Math.min(1, (s.vel ?? 1) * rnd.float(0.8, 1.15))) * 100) / 100 } : s));
  },
};

/** Apply one or more random ops from the allowed list. */
export function mutate(steps, rnd, ctx, { ops = Object.keys(OPS), strength = 0.5 } = {}) {
  const allowed = ops.filter((o) => OPS[o]);
  if (!allowed.length) return steps;
  const count = 1 + (rnd.chance(strength) ? 1 : 0);
  let out = steps;
  for (let i = 0; i < count; i++) out = OPS[rnd.pick(allowed)](out, rnd, ctx);
  return out;
}

/** Fill variants for the last bar of a section. */
export function fillSteps(steps, rnd, fill, ctx) {
  if (fill.drop) return Array(steps.length).fill(null);
  let out = steps.slice();
  if (fill.retrig) {
    const beat = ctx.stepsPerBeat;
    const n = rnd.range(fill.retrig, true);
    for (let i = out.length - beat; i < out.length; i++) {
      if (isHit(out[i])) out[i] = { ...out[i], fx: { ...(out[i].fx || {}), retrig: n } };
      else if (!out[i] && rnd.chance(0.5)) {
        const src = out.find(isHit);
        if (src) out[i] = { ...src, vel: 0.7, fx: { ...(src.fx || {}), retrig: n } };
      }
    }
  }
  if (fill.density && fill.density !== 1) {
    const factor = rnd.range(fill.density);
    const src = out.find(isHit);
    if (src) for (let i = 0; i < out.length; i++) {
      if (!out[i] && rnd.chance(Math.max(0, factor - 1) * 0.35)) out[i] = { ...src, vel: Math.round((src.vel ?? 1) * 0.75 * 100) / 100 };
      else if (isHit(out[i]) && factor < 1 && rnd.chance(1 - factor)) out[i] = null;
    }
  }
  return out;
}
