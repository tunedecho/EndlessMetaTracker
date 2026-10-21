#!/usr/bin/env node
/**
 * Export a song to a Standard MIDI File.
 *   tracker-to-midi song.json out.mid [--no-gm-drums] [--loops N]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { assertValid } from '@tracker/format';
import { encodeMidi, songToMidiEvents } from '../lib/midi.js';

const args = process.argv.slice(2);
const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--loops');
const [input, output] = files;
if (!input || !output) { console.error('usage: tracker-to-midi song.json out.mid [--no-gm-drums] [--loops N]'); process.exit(2); }
const loopsIdx = args.indexOf('--loops');
const opts = { gmDrums: !args.includes('--no-gm-drums'), loops: loopsIdx >= 0 ? parseInt(args[loopsIdx + 1], 10) : 0 };
const song = assertValid(JSON.parse(readFileSync(input, 'utf8')), input);
writeFileSync(output, encodeMidi(song, opts));
const m = songToMidiEvents(song, opts);
const notes = m.tracks.reduce((n, t) => n + t.filter((e) => e.type === 'on').length, 0);
console.log(`${output}: ${m.tracks.length} tracks, ${notes} notes, ${m.endTick / 480} beats; channels ${m.channelOf.map((c) => c + 1).join(',')}`);
