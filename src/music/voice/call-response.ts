import { mod } from '../../audio/grid';
import type { NoteOn } from '../notes';
import type { Scale } from '../scales';
import type { VoiceContext, VoiceNote } from './types';
import { eligible } from './density';
import { snapClass } from './harmony';
export interface CallNote { beat: number; note: NoteOn }
export function responsePattern(call: CallNote[], scale: Scale): Map<number, number> {
  const result = new Map<number, number>();
  if (call.length < 2) return result;
  const ordered = [...call].sort((a,b) => a.note.t-b.note.t);
  const occupied = new Set(ordered.map(event => event.beat));
  const holes = [0,1,2,3].filter(beat => !occupied.has(beat));
  if (!holes.length) { result.set(0,scale.tonic); return result; }
  let reversed = ordered.map(event => snapClass(event.note.pitchClass, scale)).reverse();
  if (new Set(reversed).size === 1) reversed = reversed.map(pc => {
    const degree = scale.pitchClasses.indexOf(pc);
    return scale.pitchClasses[mod(scale.pitchClasses.length-degree,scale.pitchClasses.length)];
  });
  holes.forEach((beat,i) => result.set(beat,reversed[i % reversed.length]));
  return result;
}

export class CallResponse {
  private bars = new Map<number, CallNote[]>();
  private currentBar = -Infinity;
  private responseBar = -Infinity;
  private restBar = -Infinity;
  private pattern = new Map<number, number>();
  record(index: number, note: NoteOn): void {
    const bar = Math.floor(index/4);
    if (bar === this.responseBar || bar === this.restBar) return;
    const notes = this.bars.get(bar) ?? [];
    notes.push({beat:mod(index,4),note}); this.bars.set(bar,notes);
    for (const key of this.bars.keys()) if (key < bar-4) this.bars.delete(key);
  }
  decide(context: VoiceContext): VoiceNote | null {
    const bar = Math.floor(context.slot.index / 4);
    if (bar !== this.currentBar) {
      this.currentBar = bar; this.pattern = new Map();
      if (bar !== this.restBar && bar-1 !== this.responseBar && bar-1 !== this.restBar) {
        const call = this.bars.get(bar-1) ?? [];
        if (call.length >= 2) {
          this.responseBar = bar;
          this.pattern = responsePattern(call,context.scale);
          if (context.density === 'shy') this.restBar = bar+1;
        }
      }
    }
    if (bar !== this.responseBar || bar === this.restBar || !eligible(context)) return null;
    const pc = this.pattern.get(mod(context.slot.index,4));
    if (pc === undefined) return null;
    const choices = Array.from({length:24},(_,i) => i+55).filter(midi => mod(midi,12) === pc);
    choices.sort((a,b) => Math.abs(a-67)-Math.abs(b-67));
    return { midi:choices[0],duration:(context.slot.endTime-context.slot.startTime)*0.55 };
  }
  reset(): void { this.bars.clear(); this.currentBar = this.responseBar = this.restBar = -Infinity; this.pattern.clear(); }
}
