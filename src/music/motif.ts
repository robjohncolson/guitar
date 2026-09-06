import { median } from '../audio/tap-tempo';
import { centsOffset, hzToMidi, pitchClass } from './notes';
import type { NoteOn } from './notes';

export interface Motif { readonly notes: readonly NoteOn[]; readonly beats: number }
const pc = (note: NoteOn) => pitchClass(hzToMidi(note.hz));

/** Recognize consecutive performances of a phrase, independently of where beat one fell. */
export class MotifListener {
  private history: NoteOn[] = [];
  private found?: Motif;
  repetitions = 0;
  get motif(): Motif | undefined { return this.found; }
  constructor(readonly period: number) {}
  reconsider(): void { this.found = undefined; }
  finish(t: number, end: number): void {
    const note = this.history.find(note => note.t === t);
    if (note && Number.isFinite(end) && end > t) note.duration = end-t;
  }
  record(note: NoteOn): void {
    if (this.found || !Number.isFinite(note.t) || !Number.isFinite(note.hz) || note.hz <= 0) return;
    if (this.history.length && note.t <= this.history[this.history.length-1].t) return;
    this.history.push({...note});
    this.history = this.history.filter(previous => note.t-previous.t <= 64*this.period).slice(-96);
    this.repetitions = this.history.length >= 3 ? 1 : 0;
    // Prefer the shortest complete recurring idea, not a collection of repeated pitch classes.
    for (const passes of [3,2] as const) {
      for (let length=3;length<=Math.min(24,Math.floor(this.history.length/passes));length++) {
        const notes = this.history.slice(-length*passes);
        const blocks = Array.from({length:passes},(_,i) => notes.slice(i*length,(i+1)*length));
        const cycles = blocks.slice(1).map((block,i) => (block[0].t-blocks[i][0].t)/this.period);
        const beats = median(cycles);
        if (beats < 1 || beats > 16 || cycles.some(cycle => Math.abs(cycle-beats) > Math.max(0.25,beats*0.12))) continue;
        const first = blocks[0];
        if (new Set(first.map(pc)).size < 2) continue;
        const matches = blocks.slice(1).every(block => {
          const wrong = block.filter((note,i) => pc(note) !== pc(first[i])).length;
          if (wrong > (length >= 5 ? 1 : 0)) return false;
          return block.every((note,i) => {
            const offset = (note.t-block[0].t)/this.period;
            const expected = (first[i].t-first[0].t)/this.period;
            return Math.abs(offset-expected) <= 0.22+expected*0.04;
          });
        });
        if (!matches) continue;
        this.repetitions = passes;
        if (passes === 2) return;
        const last = blocks[2];
        const consensus = last.map((note,i) => {
          const column = blocks.map(block => block[i]);
          const winner = column.map(pc).sort((a,b) => column.filter(n => pc(n) === b).length-column.filter(n => pc(n) === a).length)[0];
          const agreed = column.filter(n => pc(n) === winner);
          const hz = median(agreed.map(n => n.hz)), midi = hzToMidi(hz);
          const durations = agreed.flatMap(n => n.duration === undefined ? [] : [n.duration]);
          return Object.freeze({...note,hz,midi:Math.round(midi),cents:centsOffset(midi),pitchClass:winner,
            velocity:median(agreed.map(n => n.velocity ?? 0.75)),duration:durations.length ? median(durations) : undefined});
        });
        this.found = Object.freeze({notes:Object.freeze(consensus),beats});
        return;
      }
    }
  }
}

/** Continuing a phrase from its second note is still the same idea, not a fresh reply. */
export function sameMotif(a: Motif, b: Motif, period: number): boolean {
  if (a.notes.length !== b.notes.length || Math.abs(a.beats-b.beats) > Math.max(0.25,a.beats*0.12)) return false;
  // Rhythm identity uses normalized cyclic onset gaps; absolute start time is irrelevant.
  const gaps = (motif: Motif) => {
    const offsets = motif.notes.map(note => note.t-motif.notes[0].t);
    return offsets.map((offset,i) => i+1 < offsets.length ? offsets[i+1]-offset : motif.beats*period-offset);
  };
  const aGaps = gaps(a), bGaps = gaps(b);
  return a.notes.some((_,rotation) => b.notes.every((note,i) => {
    const j = (i+rotation)%a.notes.length;
    return pc(note) === pc(a.notes[j]) && Math.abs(aGaps[j]-bGaps[i]) <= Math.max(period*0.22,aGaps[j]*0.12);
  }));
}
