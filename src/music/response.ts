/** A few close attacks invite the loop to make space; rests let it return. */
export class Response {
  private last = -Infinity;
  private activity = 0;
  private amount(now: number, period: number): number {
    const rest = Math.max(0,now-this.last-period*0.75);
    return this.activity*Math.exp(-rest/(period*1.25));
  }
  attack(t: number, period: number): void {
    if (!Number.isFinite(t) || t < this.last) return;
    this.activity = Math.min(1,this.amount(t,period)+0.3); this.last = t;
  }
  gain(now: number, period: number): number { return 1-0.6*this.amount(now,period); }
  reset(): void { this.last = -Infinity; this.activity = 0; }
}
