export type Occupancy = 'empty' | 'player' | 'companion';
export interface Slot { index: number; startTime: number; endTime: number; occupancy: Occupancy }
export const mod = (n: number, d: number) => ((n % d) + d) % d;

export class Grid {
  private slots = new Map<number, Slot>();
  constructor(public t0: number, public period: number) {}
  indexAt(t: number): number { return Math.floor((t - this.t0) / this.period); }
  slot(index: number): Slot {
    let slot = this.slots.get(index);
    if (!slot) {
      slot = { index, startTime: this.t0 + index * this.period, endTime: this.t0 + (index + 1) * this.period, occupancy: 'empty' };
      this.slots.set(index, slot);
    }
    return slot;
  }
  onsetIndex(t: number): number {
    const relative = (t - this.t0) / this.period;
    // Nearest beat resolves the grace ambiguity in favor of the §15 timing examples.
    return Math.round(relative);
  }
  claimPlayer(t: number): Slot {
    const slot = this.slot(this.onsetIndex(t));
    slot.occupancy = 'player';
    return slot;
  }
  maintain(t: number): void {
    const index = this.indexAt(t);
    for (let i = index - 12; i <= index + 12; i++) this.slot(i);
    for (const key of this.slots.keys()) if (key < index - 16 || key > index + 20) this.slots.delete(key);
  }
}
