import { SelfMask } from '../audio/self-mask';
import { fireTime } from '../audio/timing';
import { MotifListener } from './motif';
import { chooseHarmony } from './harmony';
import type { Harmony } from './harmony';
import { Touch } from './touch';
import { midiToHz } from './notes';
import type { NoteOn } from './notes';

export interface HarmonyNote { midi: number; hz: number; at: number; fireAt: number; duration: number; velocity: number }
export interface Accompaniment { readonly harmony: Harmony; readonly startAt: number; readonly duration: number; readonly bars: number }

export class Companion {
  readonly mask = new SelfMask();
  readonly touch = new Touch();
  listener = new MotifListener(0.6);
  active?: Accompaniment;
  lastPlayer?: NoteOn;
  unclear = false;
  private origin = 0;
  private period = 0.6;
  private listeningFrom = 0;
  private cycle = 0;
  private muted = false;
  reset(origin: number, period: number, listeningFrom = origin): void {
    this.origin = origin; this.period = period; this.listeningFrom = listeningFrom;
    this.listener = new MotifListener(period); this.active = undefined; this.unclear = false; this.cycle = 0;
    // Keep masks while the room still contains a chord that was just stopped.
  }
  accept(note: NoteOn): boolean {
    if (!Number.isFinite(note.t) || note.t < this.listeningFrom || !Number.isFinite(note.hz) || note.hz <= 0 || this.mask.drops(note)) return false;
    this.lastPlayer = {...note,velocity:note.velocity ?? this.touch.velocity(note.level)};
    if (!this.active) {
      if (this.unclear) this.listener.reconsider();
      this.listener.record(this.lastPlayer);
      this.unclear = Boolean(this.listener.motif && !chooseHarmony(this.listener.motif.notes));
    }
    return true;
  }
  setMuted(muted: boolean): void { this.muted = muted; }
  takeDue(now: number, outputDelay: number, lookahead = 0.075): HarmonyNote[] {
    if (!this.active && this.listener.motif) {
      const harmony = chooseHarmony(this.listener.motif.notes);
      if (harmony) {
        const bars = Math.max(1,Math.min(4,Math.round(this.listener.motif.beats/4)));
        const bar = this.period*4;
        const startAt = this.origin+(Math.floor((now+outputDelay+0.01-this.origin)/bar)+1)*bar;
        this.active = Object.freeze({harmony,bars,startAt,duration:bars*bar});
      }
    }
    const phrase = this.active;
    if (!phrase || this.muted) return [];
    this.cycle = Math.max(this.cycle,Math.max(0,Math.floor((now+outputDelay-0.015-phrase.startAt)/phrase.duration)));
    while (true) {
      const at = phrase.startAt+this.cycle*phrase.duration;
      if (at-outputDelay > now+lookahead) return [];
      this.cycle++;
      const fireAt = fireTime(at,now,outputDelay);
      if (fireAt === null) continue;
      return phrase.harmony.midis.map(midi => ({midi,hz:midiToHz(midi),at,fireAt,
        duration:Math.max(0.2,phrase.duration-0.15),velocity:phrase.harmony.velocity/Math.sqrt(phrase.harmony.midis.length)}));
    }
  }
  scheduled(note: HarmonyNote, outputDelay: number): void {
    // CREPE can report an octave of one chord voice; mask those known output pitches too.
    for (const octave of [-12,0,12]) this.mask.arm(note.fireAt+outputDelay,note.duration,note.midi+octave);
  }
}
