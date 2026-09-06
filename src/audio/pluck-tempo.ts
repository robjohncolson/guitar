import { median } from './tap-tempo';

export interface PulseEstimate { readonly bpm: number; readonly origin: number }
interface Candidate extends PulseEstimate { score: number }
const divisions = [0.5,1,1.5,2,3,4];
const cost = [0.22,0,0.12,0.2,0.26,0.32];

/** One-shot pulse estimate from accepted guitar attacks; never follows an active reply. */
export class PluckTempo {
  private times: number[] = [];
  private previous?: Candidate;
  private agreements = 0;
  pulse?: PulseEstimate;
  get attacks(): number { return this.times.length; }
  reset(): void { this.times = []; this.previous = undefined; this.agreements = 0; this.pulse = undefined; }
  record(t: number): PulseEstimate | undefined {
    if (this.pulse) return this.pulse;
    if (!Number.isFinite(t) || t < 0) return;
    const last = this.times.at(-1);
    if (last !== undefined && t-last < 0.08) return;
    if (last !== undefined && t-last > 3) this.reset();
    this.times = [...this.times,t].filter(time => t-time <= 24).slice(-24);
    if (this.times.length < 6 || t-this.times[0] < 1.5) return;
    const candidates: Candidate[] = [];
    for (let bpm=40;bpm<=240;bpm++) {
      const candidate = this.evaluate(60/bpm);
      if (candidate) candidates.push(candidate);
    }
    candidates.sort((a,b) => a.score-b.score);
    const best = candidates[0];
    const alternative = best && candidates.find(candidate => Math.abs(candidate.bpm/best.bpm-1) > 0.08);
    if (!best || (alternative && alternative.score-best.score < 0.025)) {
      this.previous = undefined; this.agreements = 0; return;
    }
    this.agreements = this.previous && Math.abs(best.bpm/this.previous.bpm-1) < 0.03 ? this.agreements+1 : 1;
    this.previous = best;
    if (this.times.length >= 8 && this.agreements >= 3) this.pulse = Object.freeze({bpm:Math.round(best.bpm),origin:best.origin});
    return this.pulse;
  }
  private evaluate(period: number): Candidate | undefined {
    const first = this.times[0];
    const points = this.times.map(t => ({t,beat:Math.round((t-first)/period*2)/2}));
    let good = points.filter(point => Math.abs(point.t-first-point.beat*period) <= period*0.1+0.008);
    if (good.length < Math.ceil(points.length*0.875)) return;
    // Fit the pulse over the whole window, rather than accumulating each pluck's jitter.
    const meanBeat = good.reduce((sum,p) => sum+p.beat,0)/good.length;
    const meanTime = good.reduce((sum,p) => sum+p.t,0)/good.length;
    const variance = good.reduce((sum,p) => sum+(p.beat-meanBeat)**2,0);
    if (!variance) return;
    period = good.reduce((sum,p) => sum+(p.beat-meanBeat)*(p.t-meanTime),0)/variance;
    const bpm = 60/period;
    if (!Number.isFinite(bpm) || bpm < 39.5 || bpm > 240.5) return;
    const origin = meanTime-meanBeat*period;
    good = points.filter(point => Math.abs(point.t-origin-point.beat*period) <= period*0.1+0.008);
    if (good.length < Math.ceil(points.length*0.875)) return;
    const intervals = this.times.slice(1).map((t,i) => (t-this.times[i])/period);
    let matched = 0, complexity = 0;
    for (const interval of intervals) {
      const index = divisions.reduce((best,division,i) => Math.abs(division-interval) < Math.abs(divisions[best]-interval) ? i : best,0);
      if (Math.abs(divisions[index]-interval) <= 0.12) { matched++; complexity += cost[index]; }
    }
    if (matched < Math.ceil(intervals.length*0.8)) return;
    const error = median(good.map(point => Math.abs(point.t-origin-point.beat*period)/period));
    // Prefer simple beat/subdivision patterns with a mild comfortable-tempo bias.
    const score = error*2+(1-matched/intervals.length)*0.5+complexity/matched+0.16*Math.abs(Math.log2(bpm/110));
    return {bpm:Math.max(40,Math.min(240,bpm)),origin,score};
  }
}
