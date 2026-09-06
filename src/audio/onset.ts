import { median } from './tap-tempo';
import { centsOffset, hzToMidi, pitchClass } from '../music/notes';
import type { NoteOn, NoteEnd } from '../music/notes';
import type { Pitch } from './crepe';

export class OnsetDetector {
  threshold = 0.5;
  private pending?: { t: number; pitches: number[]; confidences: number[]; levels: number[] };
  private sounding?: number;
  private lastAttack = -Infinity;
  private lastHz = 0;
  private voiced = false;
  private unvoicedSince?: number;
  constructor(readonly ended: (note: NoteEnd) => void = () => {}) {}
  private finish(end: number): void {
    if (this.sounding === undefined) return;
    this.ended({t:this.sounding,end:Math.max(this.sounding+0.04,end)});
    this.sounding = undefined;
  }
  attack(t: number): void {
    if (t - this.lastAttack < 0.04 || this.pending) return;
    this.lastAttack = t;
    this.pending = { t, pitches: [], confidences: [], levels: [] };
  }
  process(t: number, pitch: Pitch, rms = 0): NoteOn | null {
    const voiced = pitch.confidence >= this.threshold && pitch.hz >= 70 && pitch.hz <= 1400;
    if (voiced) {
      const jump = this.lastHz > 0 && Math.abs(1200 * Math.log2(pitch.hz / this.lastHz)) > 90;
      if (!this.voiced || jump) this.attack(t);
      this.lastHz = pitch.hz; this.voiced = true; this.unvoicedSince = undefined;
    } else {
      this.unvoicedSince ??= t;
      if (t - this.unvoicedSince >= 0.08 - 1e-6) {
        this.voiced = false; this.lastHz = 0; this.finish(this.unvoicedSince);
      }
    }
    const pending = this.pending;
    if (!pending || t < pending.t) return null;
    if (voiced) {
      pending.pitches.push(pitch.hz); pending.confidences.push(pitch.confidence);
      if (Number.isFinite(rms) && rms > 0) pending.levels.push(rms);
    }
    if (t - pending.t < 0.06 - 1e-6) return null;
    this.pending = undefined;
    if (!pending.pitches.length) return null;
    const hz = median(pending.pitches), midi = hzToMidi(hz);
    this.finish(pending.t); this.sounding = pending.t;
    return { t: pending.t, hz, midi: Math.round(midi), pitchClass: pitchClass(midi), cents: centsOffset(midi), confidence: median(pending.confidences),
      level:pending.levels.length ? median(pending.levels) : undefined };
  }
  reset(now?: number): void {
    if (now !== undefined) this.finish(now);
    this.sounding = undefined; this.pending = undefined; this.lastHz = 0; this.voiced = false;
    this.lastAttack = -Infinity; this.unvoicedSince = undefined;
  }
}
