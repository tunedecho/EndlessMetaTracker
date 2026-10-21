/**
 * Referential checks that a JSON Schema cannot express: every chain names a
 * real phrase, every step a real instrument, and so on. Pure JavaScript with no
 * dependencies, so generators can run them in the browser.
 */

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

