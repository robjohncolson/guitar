import { SelfMask } from '../audio/self-mask';
import { fireTime } from '../audio/timing';
import { hzToMidi } from './notes';
import type { NoteOn } from './notes';

export interface RepeatNote {
  sourceTime: number;
  at: number;
  hz: number;
  midi: number;
  duration: number;
}
export interface ScheduledRepeat extends RepeatNote { fireAt: number }
export const validBpm = (value: number) => Number.isFinite(value) && value >= 40 && value <= 240;

export class Repeater {
  readonly mask = new SelfMask();
  private queue: RepeatNote[] = [];
  private muted = false;
  bpm = 100;
  onsetCount = 0;
  repeatCount = 0;
  lastPlayer?: NoteOn;
  lastRepeat?: RepeatNote;
  get pending(): number { return this.queue.length; }
  get next(): RepeatNote | undefined { return this.queue[0]; }
  get delay(): number { return 120 / this.bpm; }

  setTempo(bpm: number): void {
    if (!validBpm(bpm)) throw new Error('BPM must be between 40 and 240');
    this.bpm = bpm;
    this.clear();
  }
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.clear();
  }
  accept(note: NoteOn, repeat = true): boolean {
    if (!Number.isFinite(note.t) || !Number.isFinite(note.hz) || note.hz <= 0 || this.mask.drops(note)) return false;
    this.lastPlayer = note;
    this.onsetCount++;
    if (this.muted || !repeat) return true;
    this.queue.push({ sourceTime: note.t, at: note.t + this.delay, hz: note.hz,
      midi: hzToMidi(note.hz), duration: Math.min(0.45, 0.55 * 60 / this.bpm) });
    this.queue.sort((a,b) => a.at-b.at);
    return true;
  }
  takeDue(now: number, outputDelay: number, lookahead = 0.075): ScheduledRepeat[] {
    const due: ScheduledRepeat[] = [];
    while (this.queue.length && this.queue[0].at-outputDelay <= now+lookahead) {
      const note = this.queue.shift()!;
      const fireAt = fireTime(note.at,now,outputDelay);
      if (fireAt !== null) due.push({...note,fireAt});
    }
    return due;
  }
  scheduled(note: ScheduledRepeat, outputDelay: number): void {
    // Mask the audible window, including a permitted immediate (slightly late) start.
    this.mask.arm(note.fireAt+outputDelay,note.duration,note.midi);
    this.lastRepeat = note;
    this.repeatCount++;
  }
  clear(): void {
    this.queue = [];
    this.lastRepeat = undefined;
    // Keep the short existing masks: the room may still contain a stopped echo.
  }
}
