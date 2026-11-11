import { mod12, pcName, type Hand } from './score';
import { toEvents, type Exercise, type XNote } from './exercise';

/**
 * Standard fingerings, one octave ascending (descend in reverse). RH: per-degree pattern, then the top note.
 * LH: the bottom note, then the per-degree pattern. Cross-checked against UNC Pembroke, University of Miami and
 * R. T. Kelley charts; every scale keeps the thumb off black keys. Fingering is advisory in every syllabus.
 */
const MAJOR: Record<string, [string, string]> = {
  C: ['12312345', '54321321'], G: ['12312345', '54321321'], D: ['12312345', '54321321'], A: ['12312345', '54321321'],
  E: ['12312345', '54321321'], B: ['12312345', '43214321'], 'F#': ['23412312', '43213214'], Db: ['23123412', '32143213'],
  Ab: ['34123123', '32143213'], Eb: ['31234123', '32143213'], Bb: ['41231234', '32143213'], F: ['12341234', '54321321'],
};
const MINOR: Record<string, [string, string]> = {
  A: ['12312345', '54321321'], E: ['12312345', '54321321'], B: ['12312345', '43214321'], 'F#': ['34123123', '43213214'],
  'C#': ['34123123', '32143213'], 'G#': ['34123123', '32143213'], Eb: ['31234123', '21432132'], Bb: ['41231234', '21321432'],
  F: ['12341234', '54321321'], C: ['12312345', '54321321'], G: ['12312345', '54321321'], D: ['12312345', '54321321'],
};
/** Root-position arpeggios over two octaves (seven notes). */
const ARPEGGIO_MAJOR: Record<string, [string, string]> = {
  C: ['1231235', '5421421'], G: ['1231235', '5421421'], F: ['1231235', '5421421'], D: ['1231235', '5321321'], A: ['1231235', '5321321'],
  E: ['1231235', '5321321'], B: ['1231235', '5321321'], 'F#': ['1231235', '5321321'], Db: ['2124124', '2142142'], Ab: ['2124124', '2142142'],
  Eb: ['2124124', '2142142'], Bb: ['2124124', '3213213'],
};
const ARPEGGIO_MINOR: Record<string, [string, string]> = {
  A: ['1231235', '5421421'], E: ['1231235', '5421421'], D: ['1231235', '5421421'], G: ['1231235', '5421421'], C: ['1231235', '5421421'],
  F: ['1231235', '5421421'], B: ['1231235', '5421421'], Eb: ['1231235', '5421421'], 'F#': ['2124124', '2142142'], 'C#': ['2124124', '2142142'],
  'G#': ['2124124', '2142142'], Bb: ['2312312', '3213213'],
};
const MAJOR_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
export const SCALES: Record<'major' | 'harmonic' | 'natural', number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11], harmonic: [0, 2, 3, 5, 7, 8, 11], natural: [0, 2, 3, 5, 7, 8, 10],
};
export type DrillMode = keyof typeof SCALES;
export interface DrillSpec { kind: 'scale' | 'arpeggio' | 'cadence'; tonic: number; mode: DrillMode; hands: Hand[]; octaves: 1 | 2 }

export const keyLabel = (tonic: number, mode: DrillMode) => `${(mode === 'major' ? MAJOR_NAMES : MINOR_NAMES)[mod12(tonic)].replace('#', '♯').replace(/b$/, '♭')} ${mode === 'major' ? 'major' : mode === 'harmonic' ? 'harmonic minor' : 'natural minor'}`;
export const keySignatureOf = (tonic: number, mode: DrillMode) => {
  const major = mode === 'major' ? mod12(tonic) : mod12(tonic + 3);
  return [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5][major];
};
/** Lowest tonic at or above C4 for the right hand, an octave lower for the left. */
const startFor = (tonic: number, hand: Hand) => 60 + mod12(tonic) - (hand === 'L' ? 12 : 0);

export function fingering(spec: DrillSpec, hand: Hand): string {
  const table = spec.kind === 'arpeggio' ? (spec.mode === 'major' ? ARPEGGIO_MAJOR : ARPEGGIO_MINOR) : spec.mode === 'major' ? MAJOR : MINOR;
  const name = (spec.mode === 'major' ? MAJOR_NAMES : MINOR_NAMES)[mod12(spec.tonic)];
  return (table[name] ?? table[spec.mode === 'major' ? 'C' : 'A'])[hand === 'R' ? 0 : 1];
}

function scaleLine(spec: DrillSpec, hand: Hand): { midi: number; finger: number }[] {
  const steps = SCALES[spec.mode], base = startFor(spec.tonic, hand), finger = fingering(spec, hand);
  const up: { midi: number; finger: number }[] = [];
  for (let i = 0; i <= 7 * spec.octaves; i++) {
    const midi = base + 12 * Math.floor(i / 7) + steps[i % 7];
    const f = hand === 'R' ? (i === 7 * spec.octaves ? finger[7] : finger[i % 7]) : i === 0 ? finger[0] : finger[i % 7 === 0 ? 7 : i % 7];
    up.push({ midi, finger: Number(f) });
  }
  return [...up, ...up.slice(0, -1).reverse()];
}

function arpeggioLine(spec: DrillSpec, hand: Hand): { midi: number; finger: number }[] {
  const third = spec.mode === 'major' ? 4 : 3, base = startFor(spec.tonic, hand), finger = fingering(spec, hand);
  const up = [0, third, 7, 12, 12 + third, 19, 24].map((step, i) => ({ midi: base + step, finger: Number(finger[i]) }));
  return [...up, ...up.slice(0, -1).reverse()];
}

/** Scales and arpeggios run up and back in even notes; a cadence is I, IV, V, I in close position over the roots. */
export function drillExercise(spec: DrillSpec, id: string, title: string): Exercise {
  const notes: (XNote & { beat: number })[] = [];
  const keySig = keySignatureOf(spec.tonic, spec.mode);
  let beats = 16;
  if (spec.kind === 'cadence') {
    const minor = spec.mode !== 'major', root = startFor(spec.tonic, 'R');
    const chords = [[0, minor ? 3 : 4, 7], [0, 5, minor ? 8 : 9], [-1, 2, 7], [0, minor ? 3 : 4, 7]];
    const fingers = [[1, 3, 5], [1, 2, 5], [1, 2, 5], [1, 3, 5]], bass = [0, 5, 7, 0].map(s => startFor(spec.tonic, 'L') + (s === 5 || s === 7 ? s - 12 : s));
    chords.forEach((chord, i) => {
      if (spec.hands.includes('R')) chord.forEach((s, j) => notes.push({ beat: i * 2, midi: root + s, hand: 'R', dur: 2, finger: fingers[i][j] }));
      if (spec.hands.includes('L')) notes.push({ beat: i * 2, midi: bass[i], hand: 'L', dur: 2 });
    });
    beats = 8;
  } else {
    for (const hand of spec.hands) {
      const line = spec.kind === 'scale' ? scaleLine(spec, hand) : arpeggioLine(spec, hand);
      const step = spec.kind === 'scale' && spec.octaves === 1 ? 1 : 0.5;
      line.forEach((n, i) => notes.push({ beat: i * step, midi: n.midi, hand, dur: i === line.length - 1 ? (spec.kind === 'arpeggio' ? 2 : step === 1 ? 2 : 1.5) : step, finger: n.finger }));
      beats = spec.kind === 'arpeggio' ? 8 : 16;
    }
  }
  const bars = Array.from({ length: beats / 4 }, (_, i) => ({ beat: i * 4, number: i + 1 }));
  const chordSymbols = spec.kind === 'cadence' ? (spec.mode === 'major' ? ['I', 'IV', 'V', 'I'] : ['i', 'iv', 'V', 'i']).map((symbol, i) => ({ beat: i * 2, symbol })) : [];
  return { id, title, instrument: 'piano', beatsPerBar: 4, beats, keySig, events: toEvents(notes), bars, chords: chordSymbols };
}

export const tonicName = (tonic: number, mode: DrillMode) => pcName(tonic, keySignatureOf(tonic, mode));
