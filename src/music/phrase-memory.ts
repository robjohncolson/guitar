import { fireTime } from '../audio/timing';
import { hzToMidi } from './notes';
import type { NoteOn } from './notes';
import type { ScheduledRepeat } from './repeater';

export type MemoryBars = 1 | 2 | 4;
export const isMemoryBars = (value: unknown): value is MemoryBars => value === 1 || value === 2 || value === 4;
interface PhraseNote { beat: number; hz: number; sourceTime: number; velocity: number; duration: number }
interface Candidate { sourceEnd: number; notes: NoteOn[] }
export interface FrozenPhrase {
  readonly bars: MemoryBars;
  readonly startAt: number;
  readonly duration: number;
  readonly notes: readonly PhraseNote[];
}

export class PhraseMemory {
  private history: NoteOn[] = [];
  private origin = 0;
  private period = 0.6;
  private listeningFrom = 0;
  private cycle = 0;
  private cursor = 0;
  private muted = false;
  private phrase?: FrozenPhrase;
  private candidates = new Map<MemoryBars,Candidate>();
  get active(): FrozenPhrase | undefined { return this.phrase; }
  private get barDuration(): number { return this.period * 4; }

  reset(origin: number, period: number, listeningFrom = origin): void {
    this.origin = origin; this.period = period; this.listeningFrom = listeningFrom;
    this.history = []; this.candidates.clear(); this.clear();
  }
  record(note: NoteOn): void {
    if (note.t < this.listeningFrom || !Number.isFinite(note.t) || !Number.isFinite(note.hz) || note.hz <= 0) return;
    const recorded = {...note};
    this.history.push(recorded);
    // An attack just before the downbeat may settle after that bar was saved.
    for (const [bars,candidate] of this.candidates) {
      if (note.t >= candidate.sourceEnd-bars*this.barDuration && note.t < candidate.sourceEnd) {
        candidate.notes.push(recorded); candidate.notes.sort((a,b) => a.t-b.t);
      }
    }
    this.history.sort((a,b) => a.t-b.t);
    this.prune(note.t);
  }
  finish(t: number, end: number): void {
    if (!Number.isFinite(end) || end < t) return;
    // Candidates share history records until Remember makes the immutable copy.
    for (const note of new Set([...this.history,...[...this.candidates.values()].flatMap(candidate => candidate.notes)])) {
      if (note.t === t) note.duration = Math.max(0.04,end-t);
    }
  }
  private completedEnd(now: number): number {
    return this.origin + Math.max(0,Math.floor((now-this.origin)/this.barDuration+1e-9))*this.barDuration;
  }
  prune(now: number): void {
    this.refresh(now);
    const oldest = this.completedEnd(now)-4*this.barDuration;
    this.history = this.history.filter(note => note.t >= oldest);
  }
  availableBars(now: number): number {
    return Math.max(0,Math.min(4,Math.floor((this.completedEnd(now)-this.listeningFrom)/this.barDuration+1e-9)));
  }
  private refresh(now: number): void {
    const completedEnd = this.completedEnd(now);
    const latest = this.history.filter(note => note.t < completedEnd).at(-1);
    if (!latest) return;
    const firstFullStart = this.origin+Math.ceil((this.listeningFrom-this.origin)/this.barDuration-1e-9)*this.barDuration;
    const lastPlayedEnd = this.origin+(Math.floor((latest.t-this.origin)/this.barDuration)+1)*this.barDuration;
    for (const bars of [1,2,4] as const) {
      const sourceEnd = Math.max(firstFullStart+bars*this.barDuration,lastPlayedEnd);
      if (sourceEnd > completedEnd || sourceEnd <= (this.candidates.get(bars)?.sourceEnd ?? -Infinity)) continue;
      const notes = this.history.filter(note => note.t >= sourceEnd-bars*this.barDuration && note.t < sourceEnd);
      if (notes.length) this.candidates.set(bars,{sourceEnd,notes});
    }
  }
  noteCount(bars: MemoryBars, now: number): number { this.refresh(now); return this.candidates.get(bars)?.notes.length ?? 0; }
  held(bars: MemoryBars, now: number): boolean {
    this.refresh(now);
    const candidate = this.candidates.get(bars);
    return Boolean(candidate && candidate.sourceEnd < this.completedEnd(now));
  }
  canRemember(bars: MemoryBars, now: number): boolean {
    return this.availableBars(now) >= bars && this.noteCount(bars,now) > 0;
  }
  remember(bars: MemoryBars, now: number, outputDelay: number): boolean {
    if (!isMemoryBars(bars) || this.phrase || !this.canRemember(bars,now)) return false;
    const duration = bars*this.barDuration;
    const candidate = this.candidates.get(bars)!;
    const sourceStart = candidate.sourceEnd-duration;
    // Use the next downbeat that can still be sent to the output device on time.
    const startBar = Math.floor((now+outputDelay+0.01-this.origin)/this.barDuration)+1;
    const notes = candidate.notes.map((note,index) => Object.freeze({
      beat:(note.t-sourceStart)/this.period, hz:note.hz, sourceTime:note.t,
      velocity:note.velocity ?? 0.75,
      duration:Math.min(note.duration ?? Infinity,(candidate.notes[index+1]?.t ?? candidate.sourceEnd)-note.t),
    }));
    this.phrase = Object.freeze({bars,startAt:this.origin+startBar*this.barDuration,duration,notes:Object.freeze(notes)});
    this.cycle = 0; this.cursor = 0;
    return true;
  }
  setMuted(muted: boolean): void { this.muted = muted; }
  clear(): void { this.phrase = undefined; this.cycle = 0; this.cursor = 0; }
  takeDue(now: number, outputDelay: number, lookahead = 0.075): ScheduledRepeat[] {
    const phrase = this.phrase;
    if (!phrase || this.muted) return [];
    // Jump over elapsed cycles after a suspended/background tab without a catch-up burst.
    const currentCycle = Math.max(0,Math.floor((now+outputDelay-0.015-phrase.startAt)/phrase.duration));
    if (this.cycle < currentCycle) { this.cycle = currentCycle; this.cursor = 0; }
    const due: ScheduledRepeat[] = [];
    while (true) {
      const note = phrase.notes[this.cursor];
      const cycleStart = phrase.startAt+this.cycle*phrase.duration;
      const at = cycleStart+note.beat*this.period;
      if (at-outputDelay > now+lookahead) break;
      this.cursor++;
      if (this.cursor === phrase.notes.length) { this.cursor = 0; this.cycle++; }
      const fireAt = fireTime(at,now,outputDelay);
      if (fireAt === null) continue;
      due.push({sourceTime:note.sourceTime,at,fireAt,hz:note.hz,midi:hzToMidi(note.hz),
        velocity:note.velocity,duration:Math.min(note.duration,cycleStart+phrase.duration-at)});
    }
    return due;
  }
}
