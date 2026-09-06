import { median } from '../audio/tap-tempo';

/** Compare accepted attacks with recent playing, so microphone distance needs no slider. */
export class Touch {
  private levels: number[] = [];
  velocity(level?: number): number {
    if (level === undefined || !Number.isFinite(level) || level <= 0) return 0.75;
    const reference = this.levels.length ? median(this.levels) : level;
    const velocity = Math.max(0.25,Math.min(1,0.75*Math.sqrt(level/reference)));
    this.levels.push(level);
    if (this.levels.length > 24) this.levels.shift();
    return velocity;
  }
  reset(): void { this.levels = []; }
}
