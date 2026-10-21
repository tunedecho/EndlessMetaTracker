/**
 * Note names, MIDI numbers, frequencies, and scales.
 * C4 is MIDI 60. Names accept sharps (#) and flats (b), e.g. "F#3", "Bb2", "C-1".
 */

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PITCH_CLASS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** @type {Record<string, number[]>} semitone intervals from the root */
export const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  minorPentatonic: [0, 3, 5, 7, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  blues: [0, 3, 5, 6, 7, 10],
  wholeTone: [0, 2, 4, 6, 8, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  phrygianDominant: [0, 1, 4, 5, 7, 8, 10],
  hirajoshi: [0, 2, 3, 7, 8],
  insen: [0, 1, 5, 7, 10],
};

/** Parse a pitch class name like "F#" or "Bb" to 0..11. */
export function pitchClass(name) {
  const m = /^([A-Ga-g])([#b]?)$/.exec(name);
  if (!m) throw new Error(`bad pitch class: ${name}`);
  let pc = PITCH_CLASS[m[1].toUpperCase()];
  if (m[2] === '#') pc += 1;
  if (m[2] === 'b') pc -= 1;
  return (pc + 12) % 12;
}

/** Note name or number to MIDI number. Returns 'OFF' for "OFF". */
export function toMidi(note) {
  if (typeof note === 'number') return note;
  if (note === 'OFF') return 'OFF';
  const m = /^([A-Ga-g])([#b]?)(-?[0-9])$/.exec(note);
  if (!m) throw new Error(`bad note: ${note}`);
  const pc = pitchClass(m[1] + m[2]);
  const octave = parseInt(m[3], 10);
  return (octave + 1) * 12 + pc;
}

/** MIDI number to a name like "C4". */
export function toName(midi) {
  if (midi === 'OFF') return 'OFF';
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${NAMES[pc]}${octave}`;
}

/** MIDI number (fractional allowed) to Hz, A4 = 440. */
export function toFreq(midi, a4 = 440) {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Resolve a scale degree to a MIDI number.
 * Degree 0 is the root, degrees beyond the scale length wrap up an octave,
 * negative degrees go down.
 */
export function degreeToMidi(degree, root, intervals, octave = 3) {
  const n = intervals.length;
  const oct = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  const rootPc = typeof root === 'number' ? root : pitchClass(root);
  return (octave + 1) * 12 + rootPc + intervals[idx] + oct * 12;
}

/** Normalise a mode spec: a name or an interval list. */
export function modeIntervals(mode) {
  if (Array.isArray(mode)) return mode;
  const m = MODES[mode];
  if (!m) throw new Error(`unknown mode: ${mode}`);
  return m;
}
