import type { NoteOn } from '../music/notes';
import { hzToMidi } from '../music/notes';
export interface MaskWindow { start: number; end: number; midi: number }
export class SelfMask {
  private windows: MaskWindow[] = [];
  arm(start: number, duration: number, midi: number): void {
    this.windows.push({start, end: start + duration + 0.08, midi});
    this.prune(start - 2);
  }
  drops(note: Pick<NoteOn, 't' | 'hz'>): boolean {
    return this.windows.some(window => note.t >= window.start - 0.005 && note.t <= window.end && Math.abs(hzToMidi(note.hz) - window.midi) * 100 <= 50);
  }
  active(t: number): boolean { return this.windows.some(window => t >= window.start && t <= window.end); }
  prune(now: number): void { this.windows = this.windows.filter(window => window.end >= now); }
  release(audibleEnd: number): void {
    this.windows = this.windows.filter(window => window.start <= audibleEnd && window.end >= audibleEnd-0.08)
      .map(window => ({...window,end:Math.min(window.end,audibleEnd+0.08)}));
  }
  clear(): void { this.windows = []; }
}
