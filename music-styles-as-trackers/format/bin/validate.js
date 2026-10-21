#!/usr/bin/env node
/**
 * Validate tracker song and style files.
 *   tracker-validate file.json [more.json ...]
 * Exits 1 if any file fails. Prints stats for valid songs with --stats.
 */
import { readFileSync } from 'node:fs';
import { validate, songStats, sizeOf } from '../lib/index.js';

const args = process.argv.slice(2);
const stats = args.includes('--stats');
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.error('usage: tracker-validate [--stats] file.json ...');
  process.exit(2);
}
let failed = 0;
for (const file of files) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.log(`FAIL ${file}: ${e.message}`);
    failed++;
    continue;
  }
  const r = validate(doc);
  if (r.ok) {
    let extra = '';
    if (stats) {
      const s = r.kind === 'song' ? songStats(doc) : sizeOf(doc);
      extra = ' ' + Object.entries(s).map(([k, v]) => `${k}=${v}`).join(' ');
    }
    console.log(`ok   ${file} (${r.kind})${extra}`);
  } else {
    failed++;
    console.log(`FAIL ${file} (${r.kind})`);
    for (const e of r.errors) console.log(`     ${e}`);
  }
}
process.exit(failed ? 1 : 0);
