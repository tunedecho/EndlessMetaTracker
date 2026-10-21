#!/usr/bin/env node
/**
 * Write a Dirtywave M8 song file from a tracker song.
 *   tracker-to-m8s song.json out.m8s [--dump]
 * UNTESTED ON A DEVICE. Copy the result to the SD card's Songs folder at your own risk,
 * and back up the card first.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { assertValid } from '@tracker/format';
import { songToM8, readM8, FILE_VERSION } from '../lib/m8s.js';

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));
const [input, output] = files;
if (!input || !output) { console.error('usage: tracker-to-m8s song.json out.m8s [--dump]'); process.exit(2); }
const song = assertValid(JSON.parse(readFileSync(input, 'utf8')), input);
const { bytes, warnings, report } = songToM8(song);
writeFileSync(output, bytes);
console.log(`${output}: M8 song "${report.name}" in file version ${FILE_VERSION}, ${report.songRows} song rows, ${report.chains} chains, ${report.phrases} phrases, ${report.instruments.length} instruments`);
for (const i of report.instruments) console.log(`  instrument ${i.index.toString(16).padStart(2, '0')} ${i.id}: ${i.m8}`);
for (const w of warnings) console.log(`  warning: ${w}`);
console.log('NOT TESTED ON A DEVICE: this file follows community documentation of the format. Back up your SD card before trying it.');
if (args.includes('--dump')) console.log(JSON.stringify(readM8(bytes), null, 1).slice(0, 4000));
