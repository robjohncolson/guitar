import { median } from '../audio/tap-tempo';
import { centsOffset, hzToMidi, pitchClass } from './notes';
import type { NoteOn } from './notes';

export interface Rest { readonly offset: number; readonly duration: number }
export interface Motif { readonly notes: readonly NoteOn[]; readonly beats: number; readonly rests?: readonly Rest[]; readonly completedAt?: number }
const pc = (note: NoteOn) => pitchClass(hzToMidi(note.hz));
interface Match { cost: number; notes: (NoteOn | undefined)[] }

/** Align by pitch AND elapsed time. A single missed/extra attack need not shift the whole phrase. */
function align(seed: readonly NoteOn[], other: readonly NoteOn[], start: number, otherStart: number, period: number): Match | undefined {
  const n = seed.length, m = other.length, budget = n >= 3 ? 1 : 0;
  const costs = Array.from({length:n+1},() => Array(m+1).fill(Infinity) as number[]);
  const moves = Array.from({length:n+1},() => Array(m+1).fill('') as string[]);
  costs[0][0] = 0;
  const relax = (i: number,j: number,cost: number,move: string) => {
    if (cost < costs[i][j]) { costs[i][j] = cost; moves[i][j] = move; }
  };
  for (let i=0;i<=n;i++) for (let j=0;j<=m;j++) {
    const cost = costs[i][j];
    if (cost > budget) continue;
    if (i<n) relax(i+1,j,cost+1,'skip');
    if (j<m) relax(i,j+1,cost+1,'extra');
    if (i>=n || j>=m) continue;
    const a = seed[i], b = other[j], offset = a.t-start;
    if (Math.abs(offset-(b.t-otherStart)) > Math.min(0.085,period*0.18)+Math.abs(offset)*0.035) continue;
    // A known muted gap must agree; absent pitch confidence alone never creates a rest.
    if (a.duration !== undefined && b.duration !== undefined &&
      Math.abs(a.duration-b.duration) > Math.max(0.09,period*0.22,Math.min(a.duration,b.duration)*0.3)) continue;
    const wrong = pc(a) !== pc(b);
    if (wrong && n<5) continue;
    relax(i+1,j+1,cost+(wrong ? 1 : 0),'match');
  }
  if (costs[n][m] > budget) return;
  const notes: (NoteOn | undefined)[] = Array(n).fill(undefined);
  let i=n,j=m;
  while (i || j) {
    const move = moves[i][j];
    if (move === 'match') { notes[i-1] = other[j-1]; i--; j--; }
    else if (move === 'skip') i--;
    else if (move === 'extra') j--;
    else return;
  }
  return {cost:costs[n][m],notes};
}

export function phraseRests(notes: readonly NoteOn[], duration: number): readonly Rest[] {
  if (!notes.length) return [];
  const start = notes[0].t, rests: Rest[] = [];
  notes.forEach((note,i) => {
    if (note.duration === undefined) return;
    const end = note.t-start+note.duration, next = i+1<notes.length ? notes[i+1].t-start : duration;
    if (next-end > 0.04) rests.push(Object.freeze({offset:end,duration:next-end}));
  });
  return Object.freeze(rests);
}

/** A rolling listener with no bar boundary. Three whole cycles must agree, including their gaps. */
export class MotifListener {
  private history: NoteOn[] = [];
  private periods: number[] = [];
  private found?: Motif;
  private checkedAt = -Infinity;
  repetitions = 0;
  get motif(): Motif | undefined { return this.found; }
  get remainder(): readonly NoteOn[] { return this.found ? this.history.filter(note => note.t >= this.found!.completedAt!-0.035) : []; }
  constructor(readonly period: number) {}
  finish(t: number, end: number): void {
    const note = this.history.find(note => note.t === t);
    if (note && Number.isFinite(end) && end > t) { note.duration = end-t; this.checkedAt = -Infinity; }
  }
  record(note: NoteOn): void {
    if (this.found || !Number.isFinite(note.t) || !Number.isFinite(note.hz) || note.hz <= 0) return;
    if (this.history.length && note.t <= this.history.at(-1)!.t) return;
    this.history.push({...note});
    this.history = this.history.filter(previous => note.t-previous.t <= 64*this.period).slice(-96);
    this.repetitions = this.history.length >= 2 ? 1 : 0;
    const lags: number[] = [], width = this.period*0.12;
    for (let i=0;i<this.history.length;i++) for (let j=i+1;j<this.history.length;j++) {
      const duration = this.history[j].t-this.history[i].t;
      if (duration < this.period || duration > 16*this.period || pc(this.history[i]) !== pc(this.history[j])) continue;
      lags.push(duration);
    }
    const clusters: number[][] = [];
    for (const lag of lags.sort((a,b) => a-b)) {
      if (!clusters.length || lag-clusters.at(-1)!.at(-1)! > width+1e-9) clusters.push([]);
      clusters.at(-1)!.push(lag);
    }
    this.periods = clusters.filter(values => values.length >= 2).map(median);
    this.checkedAt = -Infinity;
    this.advance(note.t);
  }
  advance(now: number): void {
    if (this.found || now-this.checkedAt < 0.035) return;
    this.checkedAt = now;
    let best: {motif:Motif; score:number} | undefined;
    for (const duration of this.periods) for (const anchor of this.history) {
      const origin = anchor.t, end = origin+duration*3;
      if (end > now+1e-6 || now-end > Math.max(0.3,this.period*0.5)) continue;
      const tolerance = Math.min(0.035,this.period*0.07);
      const blocks = [0,1,2].map(pass => this.history.filter(note =>
        note.t >= origin+pass*duration-tolerance && note.t < origin+(pass+1)*duration-tolerance));
      if (blocks.some(block => block.length < 2 || block.length > 25)) continue;
      for (let seedIndex=0;seedIndex<3;seedIndex++) {
        const seed = blocks[seedIndex];
        if (seed.length > 24 || new Set(seed.map(pc)).size < 2) continue;
        const matches = blocks.map((block,i) => align(seed,block,origin+seedIndex*duration,origin+i*duration,this.period));
        if (matches.some(match => !match)) continue;
        const notes: NoteOn[] = [];
        seed.forEach((_,i) => {
          const column = matches.flatMap((match,pass) => match!.notes[i] ? [{note:match!.notes[i]!,pass}] : []);
          const winner = column.map(value => pc(value.note)).sort((a,b) => column.filter(value => pc(value.note) === b).length-column.filter(value => pc(value.note) === a).length)[0];
          const agreed = column.filter(value => pc(value.note) === winner);
          if (agreed.length < 2) return; // A one-off extra attack is not part of the loop.
          const hz = median(agreed.map(value => value.note.hz)), midi = hzToMidi(hz);
          const offset = median(agreed.map(value => value.note.t-origin-value.pass*duration));
          const durations = agreed.flatMap(value => value.note.duration === undefined ? [] : [value.note.duration]);
          notes.push({...agreed.at(-1)!.note,t:origin+2*duration+offset,hz,midi:Math.round(midi),cents:centsOffset(midi),pitchClass:winner,
            velocity:median(agreed.map(value => value.note.velocity ?? 0.75)),duration:durations.length ? median(durations) : undefined});
        });
        if (notes.length < 2 || new Set(notes.map(pc)).size < 2) continue;
        notes.forEach((note,i) => {
          if (note.duration !== undefined) note.duration = Math.min(note.duration,i+1<notes.length ? notes[i+1].t-note.t : duration-(note.t-notes[0].t));
          Object.freeze(note);
        });
        const motif = Object.freeze({notes:Object.freeze(notes),beats:duration/this.period,rests:phraseRests(notes,duration),completedAt:end});
        const score = matches.reduce((sum,match) => sum+match!.cost,0)+duration/this.period*0.001;
        if (!best || score < best.score) best = {motif,score};
      }
    }
    if (best) { this.found = best.motif; this.repetitions = 3; }
  }
}

/** Continuing a phrase from another note is still the same idea. Include articulation when known. */
export function sameMotif(a: Motif, b: Motif, period: number): boolean {
  if (a.notes.length !== b.notes.length || Math.abs(a.beats-b.beats) > Math.max(0.25,a.beats*0.12)) return false;
  const gaps = (motif: Motif) => motif.notes.map((note,i) => i+1<motif.notes.length ? motif.notes[i+1].t-note.t : motif.beats*period-(note.t-motif.notes[0].t));
  const aGaps = gaps(a), bGaps = gaps(b);
  return a.notes.some((_,rotation) => b.notes.every((note,i) => {
    const j = (i+rotation)%a.notes.length, other = a.notes[j];
    return pc(note) === pc(other) && Math.abs(aGaps[j]-bGaps[i]) <= Math.max(period*0.22,aGaps[j]*0.12) &&
      (note.duration === undefined || other.duration === undefined || Math.abs(note.duration-other.duration) <= Math.max(0.09,period*0.22,Math.min(note.duration,other.duration)*0.3));
  }));
}
