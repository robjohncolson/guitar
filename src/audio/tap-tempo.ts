export const validBpm = (value: number) => Number.isFinite(value) && value >= 40 && value <= 240;
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length ? (sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2) : 0;
}

export class TapTempo {
  taps: number[] = [];
  bpm: number | null = null;
  t0 = 0;
  tap(seconds: number): number | null {
    if (this.taps.length && seconds - this.taps.at(-1)! > 3) this.taps = [];
    this.taps.push(seconds);
    this.taps = this.taps.slice(-9);
    if (this.taps.length < 4) return null;
    const intervals = this.taps.slice(1).map((t, i) => t - this.taps[i]);
    const mid = median(intervals);
    const good = intervals.filter(t => t > 0 && t >= 0.5 * mid && t <= 1.5 * mid);
    if (!good.length) return null;
    const estimate = Math.max(40, Math.min(240, 60 / (good.reduce((a, b) => a + b, 0) / good.length)));
    this.bpm = this.bpm === null ? estimate : this.bpm * 0.7 + estimate * 0.3;
    this.t0 = seconds;
    return this.bpm;
  }
  reset(): void { this.taps = []; this.bpm = null; this.t0 = 0; }
}
