/**
 * Arrangement: an energy walk over sections, each a number of bars and a kind
 * (intro, groove, build, breakdown, drop, outro). Layers are chosen per section
 * by their energy range, presence, and the breakdown rules.
 */

/**
 * Split a bar budget into sections of allowed lengths. The last section may be
 * shorter so the total matches, but never under 4 bars.
 */
function splitBars(total, choices, rnd) {
  const out = [];
  let left = total;
  while (left > 0) {
    const fit = choices.filter((c) => c <= left);
    let n = fit.length ? rnd.pick(fit) : left;
    if (left - n > 0 && left - n < 4) n = left;
    out.push(n);
    left -= n;
  }
  return out;
}

const jitter = (rnd, e, amount) => e + rnd.float(-amount, amount);

/**
 * Plan sections as one or more arcs: rise, peak, breakdown, build, drop, fall.
 * One arc is about four minutes; longer songs get more arcs, so an endless run
 * keeps breathing instead of wandering.
 * @returns {{kind:string, bars:number, energy:number}[]}
 */
export function planSections(style, rnd, minutes) {
  const a = style.arrangement;
  const beatsPerBar = (style.transport.phraseLength ?? 16) / (style.transport.stepsPerBeat ?? 4);
  const targetBars = Math.max(16, Math.round((minutes * rnd.bpm) / beatsPerBar));
  const e = a.energy || {};
  const min = e.min ?? 0.1, max = e.max ?? 1;
  const jit = Array.isArray(e.step) ? Math.min(0.1, (e.step[1] - e.step[0]) / 4) : 0.05;
  const clampE = (x) => Math.max(min, Math.min(max, x));
  const sections = [];
  const push = (kind, bars, energy) => sections.push({ kind, bars, energy: Math.round(clampE(energy) * 100) / 100 });

  const introBars = a.intro ? rnd.range(a.intro.bars ?? 16, true) : 0;
  const outroBars = a.outro ? rnd.range(a.outro.bars ?? 16, true) : 0;
  const body = Math.max(16, targetBars - introBars - outroBars);
  const arcBars = Math.round((4 * rnd.bpm) / beatsPerBar); // about four minutes
  const arcs = Math.max(1, Math.round(body / arcBars));
  const perArc = Math.floor(body / arcs / 4) * 4;

  let energy = rnd.range(e.start ?? 0.2);
  if (a.intro) push('intro', introBars, rnd.range(a.intro.energy ?? energy));

  for (let arc = 0; arc < arcs; arc++) {
    const first = arc === 0;
    const hasBreak = a.breakdown && rnd.chance(a.breakdown.chance ?? 0.5) || (a.breakdown && arc > 0);
    // Bar budgets for the phases of this arc.
    const riseBars = Math.round(perArc * (first ? 0.35 : 0.25) / 4) * 4;
    const breakBars = hasBreak ? Math.round(rnd.range(a.breakdown.bars ?? 16, true) / 4) * 4 : 0;
    const buildBars = hasBreak ? Math.max(4, Math.round(breakBars / 2 / 4) * 4) : 0;
    const peakBars = Math.max(8, Math.round((perArc * 0.3 - breakBars - buildBars) / 4) * 4);
    const fallBars = Math.max(8, perArc - riseBars - breakBars - buildBars - peakBars);

    // Rise: energy climbs from where we are to the peak.
    const riseSecs = splitBars(riseBars, a.sectionBars, rnd);
    const startE = first ? energy : Math.max(min, energy);
    riseSecs.forEach((bars, i) => {
      const t = (i + 1) / riseSecs.length;
      const target = jitter(rnd, startE + (0.8 - startE) * t, jit);
      const kind = target > energy + 0.15 ? 'build' : 'groove';
      push(kind, bars, target);
      energy = sections[sections.length - 1].energy;
    });
    // First peak.
    for (const bars of splitBars(Math.max(8, Math.round(peakBars / 2 / 4) * 4), a.sectionBars, rnd)) {
      push('drop', bars, jitter(rnd, 0.9, 0.08));
    }
    energy = sections[sections.length - 1].energy;
    // Breakdown, build, drop.
    if (hasBreak) {
      push('breakdown', breakBars, rnd.range(a.breakdown.energy ?? 0.2));
      push('build', buildBars, 0.5);
      for (const bars of splitBars(Math.max(8, peakBars - Math.round(peakBars / 2 / 4) * 4), a.sectionBars, rnd)) push('drop', bars, jitter(rnd, 0.95, 0.05));
    } else {
      for (const bars of splitBars(Math.max(8, peakBars - Math.round(peakBars / 2 / 4) * 4), a.sectionBars, rnd)) push('groove', bars, jitter(rnd, 0.85, 0.08));
    }
    energy = sections[sections.length - 1].energy;
    // Fall: step down toward the next arc's start or the outro.
    const fallSecs = splitBars(fallBars, a.sectionBars, rnd);
    const endE = arc === arcs - 1 ? Math.max(min, (a.outro ? rnd.range(a.outro.energy ?? 0.2) : 0.3) + 0.15) : rnd.float(0.35, 0.5);
    fallSecs.forEach((bars, i) => {
      const t = (i + 1) / fallSecs.length;
      push('groove', bars, jitter(rnd, energy + (endE - energy) * t, jit));
    });
    energy = sections[sections.length - 1].energy;
  }
  if (a.outro) push('outro', outroBars, rnd.range(a.outro.energy ?? 0.15));
  return sections;
}

const matches = (list, layer) => list && list.some((x) => x === layer.id || x === layer.role);

/**
 * Choose the layers present in each section.
 * @returns {Set<string>[]} layer ids per section
 */
const ROLE_ORDER = ['kick', 'bass', 'hats', 'snare', 'perc', 'chords', 'lead', 'pad', 'fx'];

export function chooseLayers(style, sections, rnd) {
  const a = style.arrangement;
  const maxChange = a.maxLayerChange ?? 3;
  const byId = new Map(style.layers.map((l) => [l.id, l]));
  const result = [];
  let prev = new Set();
  sections.forEach((sec, si) => {
    const next = new Set();
    const candidates = [];
    for (const layer of style.layers) {
      const [lo, hi] = layer.energy ?? [0, 1];
      if (layer.sections && !layer.sections.includes(sec.kind)) continue;
      const inRange = sec.energy >= lo - 0.02 && sec.energy <= hi + 0.02;
      if (sec.kind === 'breakdown' && a.breakdown) {
        if (matches(a.breakdown.drop, layer)) continue;
        if (a.breakdown.keep) { if (!matches(a.breakdown.keep, layer)) continue; }
        else if (!inRange) continue;
      } else if (!inRange) continue;
      candidates.push(layer);
    }
    const candidateIds = new Set(candidates.map((l) => l.id));
    // Keep what was playing if still a candidate.
    for (const id of prev) if (candidateIds.has(id)) next.add(id);
    const removed = [...prev].filter((id) => !candidateIds.has(id)).length;
    // Budget for newcomers: drops and intros open everything; builds ramp; grooves change little.
    const budget = sec.kind === 'drop' || sec.kind === 'intro' || sec.kind === 'breakdown' || si === 0 ? 99 : sec.kind === 'build' ? Math.max(3, maxChange) : maxChange;
    let changes = sec.kind === 'breakdown' ? 0 : removed;
    let newcomers = rnd.shuffle(candidates.filter((l) => !prev.has(l.id)));
    if (sec.kind === 'build' || sec.kind === 'intro') newcomers.sort((x, y) => ROLE_ORDER.indexOf(x.role) - ROLE_ORDER.indexOf(y.role));
    newcomers.sort((x, y) => (y.always ? 1 : 0) - (x.always ? 1 : 0));
    for (const layer of newcomers) {
      if (layer.always) { next.add(layer.id); continue; }
      if (changes >= budget) continue;
      if (rnd.chance(layer.presence ?? 1)) { next.add(layer.id); changes++; }
    }
    // A section where the energy fell should lose something, to be audible.
    if (si > 0 && sec.energy < sections[si - 1].energy - 0.1 && removed === 0 && sec.kind !== 'breakdown') {
      const droppable = [...next].filter((id) => !byId.get(id).always);
      if (droppable.length) next.delete(rnd.pick(droppable));
    }
    // Never leave a section nearly empty when there are candidates to play.
    const unused = candidates.filter((l) => !next.has(l.id) && !l.sections);
    while (next.size < 2 && unused.length) next.add(unused.splice(rnd.int(0, unused.length - 1), 1)[0].id);
    result.push(next);
    prev = next;
  });
  return result;
}
