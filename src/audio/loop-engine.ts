import { validBpm } from './tap-tempo';
import { loopLevelGain } from './loop-level';

export interface LoopTake { id:number; bpm:number; samples:Float32Array; levelGain:number }
export type LoopCommand =
  | {type:'record';id:number;bpm:number;startFrame:number;beats?:number}
  | {type:'play' | 'undo';startFrame:number}
  | {type:'stop';keepId?:number|null}
  | {type:'clear'};
export type LoopEvent =
  | {type:'chunk';id:number;offset:number;samples:Float32Array}
  | {type:'take';id:number;bpm:number;length:number;startFrame:number;levelGain:number}
  | {type:'playing';id:number;startFrame:number}
  | {type:'error';message:string};

export const loopFrames = (rate:number,bpm:number,beats=16) => Math.round(rate*beats*60/bpm);
export const edgeGain = (index:number,length:number,rate:number) => Math.max(0,Math.min(1,index/(rate*0.003),(length-1-index)/(rate*0.003)));
/** Translate an audible clock boundary to the sample clock used by the worklet. */
export const loopFrameAt = (audibleTime:number,delay:number,rate:number) => Math.round((audibleTime-delay)*rate);
export const nextLoopBoundary = (origin:number,length:number,earliest:number) => origin+Math.max(0,Math.ceil((earliest-origin)/length-1e-9))*length;

/** Native-rate capture and playback; process() alone advances musical boundaries. */
export class LoopEngine {
  take?:LoopTake;
  previous?:LoopTake;
  playing = false;
  origin = 0;
  private record?: {take:LoopTake;start:number;copied:number;peak:number};
  private transition?: {type:'play'|'undo';frame:number};
  private rollback?: {take?:LoopTake;previous?:LoopTake};
  constructor(readonly rate:number,readonly emit:(event:LoopEvent)=>void = ()=>{}) {}
  command(command:LoopCommand,now:number): void {
    if ('startFrame' in command && (!Number.isSafeInteger(command.startFrame) || command.startFrame < now)) {
      this.emit({type:'error',message:'The recording boundary was missed. Try again.'}); return;
    }
    if (command.type === 'record') {
      if (!validBpm(command.bpm) || this.record) return;
      const beats=command.beats ?? 16;
      if(!Number.isFinite(beats) || beats<1 || beats>32) {this.emit({type:'error',message:'Recording length must be between 1 and 32 beats.'});return;}
      this.rollback=undefined;
      this.transition = undefined;
      this.record = {take:{id:command.id,bpm:command.bpm,samples:new Float32Array(loopFrames(this.rate,command.bpm,beats)),levelGain:1},start:command.startFrame,copied:0,peak:0};
    } else if (command.type === 'play' || command.type === 'undo') {
      if (this.record || !(command.type === 'undo' ? this.previous : this.take)) return;
      this.rollback=undefined;
      this.transition = {type:command.type,frame:command.startFrame};
    } else {
      this.record = undefined; this.transition = undefined; this.playing = false;
      // Stop may arrive before the UI receives a just-completed take or Undo.
      if(command.type==='stop' && 'keepId' in command && (this.take?.id ?? null)!==command.keepId && (this.rollback?.take?.id ?? null)===command.keepId) {
        this.take=this.rollback?.take; this.previous=this.rollback?.previous;
      }
      this.rollback=undefined;
      if (command.type === 'clear') { this.take = undefined; this.previous = undefined; }
    }
  }
  private transitionAt(frame:number): void {
    if (!this.transition || frame < this.transition.frame) return;
    const transition = this.transition; this.transition = undefined;
    const resume = this.playing || transition.type === 'play';
    if (transition.type === 'undo') { this.rollback={take:this.take,previous:this.previous}; this.take = this.previous; this.previous = undefined; }
    this.origin = transition.frame; this.playing = resume;
    this.emit({type:'playing',id:this.take!.id,startFrame:this.origin});
  }
  process(firstFrame:number,input:Float32Array|undefined,output:Float32Array): void {
    for (let i=0;i<output.length;i++) {
      const frame = firstFrame+i;
      this.transitionAt(frame);
      const recording = this.record;
      if (recording && frame >= recording.start) {
        this.playing = false;
        const index = frame-recording.start;
        if (index < recording.take.samples.length) {
          const sample = input?.[i] ?? 0;
          recording.take.samples[index] = Number.isFinite(sample) ? sample : 0;
          recording.peak = Math.max(recording.peak,Math.abs(recording.take.samples[index]));
          // Send bounded chunks for the local waveform/export; never clone a whole take on the audio thread.
          if (index+1-recording.copied >= 4096 || index+1 === recording.take.samples.length) {
            this.emit({type:'chunk',id:recording.take.id,offset:recording.copied,samples:recording.take.samples.slice(recording.copied,index+1)});
            recording.copied = index+1;
          }
        } else {
          // Peak was measured incrementally; no scan or delay at the playback boundary.
          recording.take.levelGain = loopLevelGain(recording.peak);
          this.rollback={take:this.take,previous:this.previous};
          this.previous = this.take; this.take = recording.take; this.record = undefined;
          this.origin = recording.start+this.take.samples.length; this.playing = true;
          this.emit({type:'take',id:this.take.id,bpm:this.take.bpm,length:this.take.samples.length,startFrame:this.origin,levelGain:this.take.levelGain});
        }
      }
      output[i] = 0;
      if (this.playing && this.take && frame >= this.origin) {
        const index = (frame-this.origin)%this.take.samples.length;
        output[i] = this.take.samples[index]*this.take.levelGain*edgeGain(index,this.take.samples.length,this.rate);
      }
    }
  }
}
