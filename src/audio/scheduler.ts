import { Grid, mod } from './grid';
import { outputDelay } from './context';
import { Synth } from './synth';
import type { Partner } from '../music/partner';

export function fireTime(slotTime: number, now: number, delay: number): number | null {
  const fireAt = slotTime - delay;
  if (now - fireAt > 0.015) return null;
  return Math.max(now, fireAt);
}

export class Scheduler {
  private clicked = new Set<number>();
  private decided = new Set<number>();
  companionMuted = false;
  constructor(public grid: Grid, readonly synth: Synth, readonly partner?: Partner) {}
  tick(): void {
    const context = this.synth.context;
    const now = context.currentTime;
    const delay = outputDelay(context);
    this.grid.maintain(now);
    const first = this.grid.indexAt(now + delay) - 1;
    for (let i = first; i <= first + 3; i++) {
      const slot = this.grid.slot(i);
      if (i < 0 || slot.startTime - delay > now + 0.075 || this.clicked.has(i)) continue;
      this.clicked.add(i);
      const time = fireTime(slot.startTime, now, delay);
      if (time !== null) this.synth.click(time, mod(i, 4) === 0);
    }
    for (const i of this.clicked) if (i < first - 16) this.clicked.delete(i);
    for (let i = first; i <= first + 3; i++) {
      const slot = this.grid.slot(i);
      if (i < 0 || slot.startTime - delay > now + 0.008 || this.decided.has(i)) continue;
      this.decided.add(i);
      const time = fireTime(slot.startTime, now, delay);
      if (time === null || this.companionMuted || !this.partner) continue;
      const note = this.partner.decide(i, now);
      if (!note) continue;
      this.synth.note(note.midi, time, note.duration, this.partner.role);
      this.partner.scheduled(i, note);
    }
    for (const i of this.decided) if (i < first - 16) this.decided.delete(i);
  }
}
