/** Canonical piece model. Written bars are stored once; playOrder unrolls repeats. Ticks are exact integers. */
export const PPQ = 480;
export type Hand = 'L' | 'R';
export interface ScoreNote {
  id: number; bar: number; tick: number; dur: number; midi: number; hand: Hand; staff: number; voice: string;
  /** Printed or authored fingering, 1 (thumb) to 5. */
  finger?: number;
}
export interface Harmony { tick: number; symbol: string }
export interface ScoreBar {
  index: number; number: number; ticks: number; num: number; den: number; key: number; start: number;
  repeatStart?: boolean; repeatEnd?: number; ending?: number[]; marks?: string[]; harmony: Harmony[];
  /** Eighths are played long-short (swing): an off-beat eighth sounds two thirds of the way through the beat. */
  swing?: boolean;
}
export interface Section { name: string; from: number; to: number; note?: string }
export interface VoiceDef { name: string; staff: number; hand: Hand }
export interface ScoreMeta {
  title: string; composer: string; arranger?: string; source: string; licence: string; redistributable: boolean;
  /** Who checked the note text against what: none, checks (compiler only), sources (independent comparison), owner (listened). */
  verified: 'none' | 'checks' | 'sources' | 'owner';
}
export interface Score {
  meta: ScoreMeta; ppq: number; key: number; mode?: 'major' | 'minor';
  tempo: { bpm: number; text: string }; bars: ScoreBar[]; notes: ScoreNote[];
  /** Bar indices in performance order. */
  playOrder: number[]; sections: Section[]; voices: VoiceDef[];
}

export const NAMES_SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const NAMES_FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
export const mod12 = (n: number) => ((Math.round(n) % 12) + 12) % 12;
/** Spell with the key's accidentals: flats for flat keys, sharps otherwise. */
export const pcName = (pc: number, key = 0) => (key < 0 ? NAMES_FLAT : NAMES_SHARP)[mod12(pc)];
export const noteName = (midi: number, key = 0) => `${pcName(midi, key)}${Math.floor(Math.round(midi) / 12) - 1}`;
export const beatsOf = (bar: ScoreBar, ppq = PPQ) => bar.ticks / ppq;
export const barByNumber = (score: Score, number: number) => score.bars.find(b => b.number === number);
export const isBlack = (midi: number) => [1, 3, 6, 8, 10].includes(mod12(midi));

/** Key signature in fifths to a tonic name, e.g. 2 -> D major or B minor. */
export function keyName(fifths: number, mode: 'major' | 'minor' = 'major'): string {
  const major = mod12(fifths * 7), tonic = mode === 'major' ? major : mod12(major + 9);
  return `${pcName(tonic, fifths)} ${mode}`;
}

/** Notes sounding in written bars [from, to] (bar indices), optionally one hand. */
export function notesIn(score: Score, from: number, to: number, hands: Hand[] = ['L', 'R']): ScoreNote[] {
  return score.notes.filter(n => n.bar >= from && n.bar <= to && hands.includes(n.hand));
}

/** Within a swung bar, a position exactly halfway through a beat sounds at two thirds of it; everything else is unchanged. */
export function performedBeat(bar: ScoreBar, tick: number, ppq = PPQ): number {
  const beat = tick / ppq;
  if (!bar.swing) return beat;
  const whole = Math.floor(beat + 1e-9), part = beat - whole;
  return Math.abs(part - 0.5) < 1e-9 ? whole + 2 / 3 : beat;
}
/** Absolute written tick of a note. */
export const absTick = (score: Score, note: ScoreNote) => score.bars[note.bar].start + note.tick;

/** Simultaneous onsets per hand: the shapes a hand must grab. */
export interface Vertical { bar: number; tick: number; hand: Hand; notes: ScoreNote[] }
export function verticals(notes: ScoreNote[]): Vertical[] {
  const map = new Map<string, Vertical>();
  for (const note of notes) {
    const key = `${note.bar}:${note.tick}:${note.hand}`;
    const v = map.get(key) ?? { bar: note.bar, tick: note.tick, hand: note.hand, notes: [] };
    v.notes.push(note); map.set(key, v);
  }
  return [...map.values()].map(v => ({ ...v, notes: v.notes.sort((a, b) => a.midi - b.midi) }))
    .sort((a, b) => a.bar - b.bar || a.tick - b.tick || (a.hand === 'L' ? -1 : 1));
}
