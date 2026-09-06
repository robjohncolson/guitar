import { SelfMask } from '../audio/self-mask';
import { MotifListener, sameMotif } from './motif';
import type { Motif } from './motif';
import { Touch } from './touch';
import type { NoteOn } from './notes';
import { PhraseReply } from './reply';
import type { ReplyNote } from './reply';

export class Companion {
  readonly mask = new SelfMask();
  readonly touch = new Touch();
  listener = new MotifListener(0.6);
  active?: PhraseReply;
  waiting?: Motif;
  lastPlayer?: NoteOn;
  lastReply?: ReplyNote;
  private lastAnswered?: Motif;
  private origin = 0;
  private period = 0.6;
  private listeningFrom = 0;
  private muted = false;
  get hasReplied(): boolean { return Boolean(this.lastAnswered); }
  reset(origin: number, period: number, listeningFrom = origin): void {
    this.origin = origin; this.period = period; this.listeningFrom = listeningFrom;
    this.listener = new MotifListener(period); this.active = undefined; this.waiting = undefined; this.lastAnswered = undefined; this.lastReply = undefined;
    // The room may still contain a recently stopped reply; retain its shortened masks.
  }
  alignPulse(origin: number, period: number): void {
    if (this.active || this.lastAnswered) throw new Error('Set the pulse before replies begin');
    const waiting = this.waiting && Object.freeze({...this.waiting,beats:this.waiting.beats*this.period/period});
    this.listener = this.listener.withPeriod(period);
    this.waiting = this.listener.motif ?? waiting;
    if (this.listener.motif) this.listener = new MotifListener(period);
    this.origin = origin; this.period = period;
  }
  accept(note: NoteOn): boolean {
    if (!Number.isFinite(note.t) || note.t < this.listeningFrom || !Number.isFinite(note.hz) || note.hz <= 0 || this.mask.drops(note)) return false;
    this.lastPlayer = {...note,velocity:note.velocity ?? this.touch.velocity(note.level)};
    this.listener.record(this.lastPlayer);
    const found = this.listener.motif;
    if (found) {
      const same = (other?: Motif) => other && sameMotif(found,other,this.period);
      if (!same(this.active?.motif) && !same(this.lastAnswered) && !same(this.waiting)) this.waiting = found;
      // Keep listening during playback, without letting old evidence trigger another reply.
      this.listener = new MotifListener(this.period);
    }
    return true;
  }
  finish(t: number, end: number): void { this.listener.finish(t,end); }
  setMuted(muted: boolean): void { this.muted = muted; }
  private startWaiting(now: number, outputDelay: number, earliest: number): void {
    if (!this.waiting) return;
    const bar = this.period*4;
    const startAt = this.origin+Math.ceil((Math.max(earliest,now+outputDelay+0.01)-this.origin)/bar-1e-9)*bar;
    this.active = new PhraseReply(this.waiting,startAt,this.period);
    this.lastAnswered = this.waiting; this.waiting = undefined;
  }
  takeDue(now: number, outputDelay: number, lookahead = 0.075): ReplyNote[] {
    if (this.active && now >= this.active.endAt) this.active = undefined;
    if (!this.muted && this.waiting) {
      if (!this.active) this.startWaiting(now,outputDelay,now);
      else if (this.active.scheduledAll && this.active.endAt-outputDelay <= now+lookahead) {
        this.startWaiting(now,outputDelay,this.active.endAt);
      }
    }
    if (this.muted) return [];
    return this.active?.takeDue(now,outputDelay,lookahead) ?? [];
  }
  scheduled(note: ReplyNote, outputDelay: number): void {
    this.lastReply = note;
    for (const octave of [-12,0,12]) this.mask.arm(note.fireAt+outputDelay,note.duration,note.midi+octave);
  }
}
