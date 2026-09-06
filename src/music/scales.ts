import { mod } from '../audio/grid';
import { noteNames } from './notes';
import type { NoteOn } from './notes';

export const templates = {
  'major': [0, 2, 4, 5, 7, 9, 11],
  'natural minor': [0, 2, 3, 5, 7, 8, 10],
  'major pentatonic': [0, 2, 4, 7, 9],
  'minor pentatonic': [0, 3, 5, 7, 10],
  'blues': [0, 3, 5, 6, 7, 10],
  'dorian': [0, 2, 3, 5, 7, 9, 10],
  'mixolydian': [0, 2, 4, 5, 7, 9, 10],
} as const;
export type ScaleId = keyof typeof templates;
export interface Scale { tonic: number; id: ScaleId; pitchClasses: number[] }
export interface ScaleGuess extends Scale { score: number; confidence: number }
export const makeScale = (tonic: number, id: ScaleId): Scale => ({ tonic, id, pitchClasses: templates[id].map(n => mod(n + tonic, 12)) });
export const scaleLabel = (scale: Scale) => `${noteNames[scale.tonic]} ${scale.id}`;

export function guessScale(histogram: ArrayLike<number>): ScaleGuess | null {
  const total = Array.from(histogram).reduce((a, b) => a + b, 0);
  if (total < 1e-6) return null;
  const candidates: ScaleGuess[] = [];
  for (let tonic = 0; tonic < 12; tonic++) for (const id of Object.keys(templates) as ScaleId[]) {
    const scale = makeScale(tonic, id);
    const inMass = scale.pitchClasses.reduce((sum, pc) => sum + histogram[pc], 0);
    const score = inMass - 0.6 * (total - inMass) + 0.3 * histogram[tonic] + 0.15 * histogram[mod(tonic + 7, 12)];
    candidates.push({ ...scale, score, confidence: 0 });
  }
  // Scores remain literal. Prefer the most specific template only when scores tie.
  candidates.sort((a, b) => Math.abs(b.score - a.score) > 1e-9 ? b.score - a.score :
    a.pitchClasses.length - b.pitchClasses.length || Number(b.id === 'minor pentatonic') - Number(a.id === 'minor pentatonic'));
  let best = candidates[0];
  if (best.id === 'major pentatonic') {
    const relative = candidates.find(s => s.id === 'minor pentatonic' && s.tonic === mod(best.tonic + 9, 12))!;
    if (best.score - relative.score <= Math.abs(best.score) * 0.05) best = relative;
  }
  const second = candidates.find(candidate => candidate !== best)!;
  return { ...best, confidence: Math.max(0, Math.min(1, (best.score - second.score) / Math.max(best.score, 1e-9))) };
}

export class ScaleTracker {
  readonly histogram = new Float64Array(12);
  onsetCount = 0;
  locked: Scale | null = null;
  private lastTime?: number;
  decay(t: number): void {
    if (this.lastTime !== undefined) {
      const factor = 2 ** (-Math.max(0, t - this.lastTime) / 4);
      for (let i = 0; i < 12; i++) this.histogram[i] *= factor;
    }
    this.lastTime = Math.max(t, this.lastTime ?? t);
  }
  add(note: NoteOn, onGrid: boolean): boolean {
    this.decay(note.t);
    if (Math.abs(note.cents) > 40) return false;
    this.histogram[note.pitchClass] += onGrid ? 1 : 0.4;
    this.onsetCount++;
    return true;
  }
  get guess(): ScaleGuess | null { return guessScale(this.histogram); }
  get active(): Scale | null { return this.locked ?? this.guess; }
  get ready(): boolean { return this.onsetCount >= 6 && (this.locked !== null || (this.guess?.confidence ?? 0) >= 0.25); }
  toggleLock(): void {
    if (this.locked) this.locked = null;
    else { const guess = this.guess; if (guess) this.locked = { tonic: guess.tonic, id: guess.id, pitchClasses: [...guess.pitchClasses] }; }
  }
}
