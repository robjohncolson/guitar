/** Short-window energy flux: a ringing waveform's individual cycles are not plucks. */
export class AttackDetector {
  private energy: Float64Array;
  private high: Float64Array;
  private index = 0;
  private energySum = 0;
  private highSum = 0;
  private previous = 0;
  private energyAverage = 0.0005;
  private highAverage = 0.0005;
  private lastAttack = -Infinity;
  constructor(readonly rate: number) {
    this.energy = new Float64Array(Math.ceil(rate*0.012)); this.high = new Float64Array(this.energy.length);
  }
  process(input: Float32Array, t: number): boolean {
    for (const sample of input) {
      const energy = sample*sample, high = (sample-this.previous)**2; this.previous = sample;
      this.energySum += energy-this.energy[this.index]; this.highSum += high-this.high[this.index];
      this.energy[this.index] = energy; this.high[this.index] = high;
      this.index = (this.index+1)%this.energy.length;
    }
    const energy = Math.sqrt(Math.max(0,this.energySum)/this.energy.length);
    const high = Math.sqrt(Math.max(0,this.highSum)/this.high.length);
    const attack = t-this.lastAttack >= 0.09 && energy > 0.003 &&
      (energy > this.energyAverage*2.5 || high > Math.max(0.002,this.highAverage*2.8));
    const keep = Math.exp(-input.length/(this.rate*0.04));
    this.energyAverage = this.energyAverage*keep+energy*(1-keep);
    this.highAverage = this.highAverage*keep+high*(1-keep);
    if (attack) this.lastAttack = t;
    return attack;
  }
}
