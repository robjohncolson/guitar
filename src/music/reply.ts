import { fireTime } from '../audio/timing';
import { hzToMidi, midiToHz } from './notes';
import type { Motif } from './motif';
import { planHarmony } from './harmony';
import type { ReplyMode } from './harmony';

export interface ReplyNote { midi: number; hz: number; at: number; fireAt: number; duration: number; velocity: number; kind?: 'echo' | 'harmony' | 'octave' }
interface PhraseNote { offset: number; hz: number; midi: number; duration: number; velocity: number }

/** A finite, monophonic performance. All three passes share the captured timing. */
export class PhraseReply {
  readonly notes: readonly PhraseNote[];
  readonly duration: number;
  readonly endAt: number;
  readonly kind: 'echo' | 'harmony' | 'octave';
  private cursor = 0;
  private soundingUntil = -Infinity;
  get scheduledAll(): boolean { return this.cursor >= this.notes.length*3; }
  constructor(readonly motif: Motif, readonly startAt: number, period: number, readonly mode: ReplyMode = 'echo') {
    const harmony = mode === 'harmony' ? planHarmony(motif,period) : undefined;
    this.kind = harmony?.kind ?? 'echo';
    this.duration = motif.beats*period;
    this.endAt = startAt+this.duration*3;
    const first = motif.notes[0].t;
    this.notes = Object.freeze(motif.notes.map((note,i) => {
      const offset = note.t-first;
      const next = i+1 < motif.notes.length ? Math.min(this.duration,motif.notes[i+1].t-first) : this.duration;
      const space = Math.max(0,next-offset-0.006);
      const midi = harmony?.midis[i] ?? hzToMidi(note.hz), hz = harmony ? midiToHz(midi) : note.hz;
      return Object.freeze({offset,hz,midi,velocity:(note.velocity ?? 0.75)*(harmony?.gain ?? 1),
        duration:Math.min(space,note.duration ?? space)});
    }));
  }
  takeDue(now: number, outputDelay: number, lookahead = 0.075): ReplyNote[] {
    const due: ReplyNote[] = [];
    while (!this.scheduledAll) {
      const index = this.cursor%this.notes.length, cycle = Math.floor(this.cursor/this.notes.length);
      const note = this.notes[index], at = this.startAt+cycle*this.duration+note.offset;
      if (at-outputDelay > now+lookahead) break;
      this.cursor++;
      const fireAt = fireTime(at,now,outputDelay);
      if (fireAt === null || fireAt < this.soundingUntil-1e-6) continue;
      const nextAt = index+1 < this.notes.length ? this.startAt+cycle*this.duration+this.notes[index+1].offset : this.startAt+(cycle+1)*this.duration;
      const duration = Math.min(note.duration,nextAt-outputDelay-fireAt-0.006);
      if (duration <= 0) continue;
      due.push({...note,at,fireAt,duration,kind:this.kind,velocity:note.velocity*(this.mode === 'harmony' && cycle === 2 ? 0.8 : 1)});
      this.soundingUntil = fireAt+duration+0.005;
    }
    return due;
  }
}
