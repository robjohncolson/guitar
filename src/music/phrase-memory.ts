import { fireTime } from '../audio/timing';
import { hzToMidi } from './notes';
import type { NoteOn } from './notes';
import type { ScheduledRepeat } from './repeater';

export type MemoryBars = 1 | 2 | 4;
export const isMemoryBars = (value: unknown): value is MemoryBars => value === 1 || value === 2 || value === 4;
interface PhraseNote { beat: number; hz: number; sourceTime: number }
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
  get active(): FrozenPhrase | undefined { return this.phrase; }
  private get barDuration(): number { return this.period * 4; }

  reset(origin: number, period: number, listeningFrom = origin): void {
    this.origin = origin; this.period = period; this.listeningFrom = listeningFrom;
    this.history = []; this.clear();
  }
  record(note: NoteOn): void {
    if (note.t < this.listeningFrom || !Number.isFinite(note.t) || !Number.isFinite(note.hz) || note.hz <= 0) return;
    this.history.push({...note});
    this.history.sort((a,b) => a.t-b.t);
    this.prune(note.t);
  }
  private completedEnd(now: number): number {
    return this.origin + Math.max(0,Math.floor((now-this.origin)/this.barDuration+1e-9))*this.barDuration;
  }
  prune(now: number): void {
    const oldest = this.completedEnd(now)-4*this.barDuration;
    this.history = this.history.filter(note => note.t >= oldest);
  }
  availableBars(now: number): number {
    return Math.max(0,Math.min(4,Math.floor((this.completedEnd(now)-this.listeningFrom)/this.barDuration+1e-9)));
  }
  private recent(bars: MemoryBars, now: number): NoteOn[] {
    const end = this.completedEnd(now), start = end-bars*this.barDuration;
    return this.history.filter(note => note.t >= start && note.t < end);
  }
  noteCount(bars: MemoryBars, now: number): number { return this.recent(bars,now).length; }
  canRemember(bars: MemoryBars, now: number): boolean {
    return this.availableBars(now) >= bars && this.noteCount(bars,now) > 0;
  }
  remember(bars: MemoryBars, now: number, outputDelay: number): boolean {
    if (!isMemoryBars(bars) || this.phrase || !this.canRemember(bars,now)) return false;
    const duration = bars*this.barDuration;
    const sourceStart = this.completedEnd(now)-duration;
    // Use the next downbeat that can still be sent to the output device on time.
    const startBar = Math.floor((now+outputDelay+0.01-this.origin)/this.barDuration)+1;
    const notes = this.recent(bars,now).map(note => Object.freeze({
      beat:(note.t-sourceStart)/this.period, hz:note.hz, sourceTime:note.t,
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
        duration:Math.min(0.45,0.55*this.period,cycleStart+phrase.duration-at)});
    }
    return due;
  }
}
