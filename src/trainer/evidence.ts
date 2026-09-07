import type { NoteOn, NoteEnd } from '../music/notes';
import type { CaptureMessage } from '../audio/worklet-grabber';
import type { Attack, Evidence } from './grader';
/** Bounded evidence from the actual mic, independent of expected lesson pitches. */
export class TakeEvidence {
  private raw:number[]=[];
  private notes:NoteOn[]=[];
  private levels:{t:number;rms:number}[]=[];
  private ends:NoteEnd[]=[];
  constructor(readonly start:number,readonly duration:number) {}
  receive(message:CaptureMessage):void {
    if(message.t<this.start-.4 || message.t>this.start+this.duration+.5) return;
    if(message.type==='attack') {if(this.raw.length<256)this.raw.push(message.t);}
    else if(this.levels.length<3000) this.levels.push({t:message.t,rms:message.rms});
  }
  note(note:NoteOn):void {if(note.t>=this.start-.4 && note.t<=this.start+this.duration+.4 && this.notes.length<256)this.notes.push({...note});}
  finish(end:NoteEnd):void {if(this.ends.length<256)this.ends.push(end);}
  result(samples:Float32Array,expectedSamples:number,receivedSamples:number,interrupted=false):Evidence {
    const attacks:Attack[]=[];
    for(const note of this.notes) {
      const end=this.ends.find(e=>Math.abs(e.t-note.t)<.001);
      attacks.push({t:note.t-this.start,midi:note.midi+note.cents/100,confidence:note.confidence,duration:note.duration ?? (end ? end.end-note.t : undefined),level:note.level});
    }
    for(const t of this.raw) {
      if(attacks.some(a=>Math.abs(a.t+this.start-t)<.09)) continue;
      // A click's short transient must not become a guitar attack. Require energy beyond its tail.
      if(this.levels.some(f=>f.t>=t+.04 && f.t<=t+.1 && f.rms>.004)) attacks.push({t:t-this.start});
    }
    let clipped=0; for(const sample of samples) if(Math.abs(sample)>=.999)clipped++;
    return {attacks:attacks.sort((a,b)=>a.t-b.t),coverage:expectedSamples ? Math.min(1,receivedSamples/expectedSamples) : 0,clipped:clipped/Math.max(1,samples.length),interrupted};
  }
}
