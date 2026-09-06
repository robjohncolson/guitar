import { LoopEngine, type LoopCommand } from './loop-engine';

declare const sampleRate:number;
declare const currentFrame:number;
declare class AudioWorkletProcessor { readonly port:MessagePort }
declare function registerProcessor(name:string,processor:typeof AudioWorkletProcessor):void;

class Looper extends AudioWorkletProcessor {
  private engine = new LoopEngine(sampleRate,event=>{
    this.port.postMessage(event,event.type === 'chunk' ? [event.samples.buffer as ArrayBuffer] : []);
  });
  private soften = false;
  private gain = 1;
  private frame?:number;
  constructor() {
    super();
    this.port.onmessage = event => {
      if (event.data.type === 'soften') this.soften = event.data.enabled === true;
      else this.engine.command(event.data as LoopCommand,this.frame ?? currentFrame);
    };
  }
  process(inputs:Float32Array[][],outputs:Float32Array[][]):boolean {
    const input=inputs[0]?.[0], output=outputs[0][0];
    // Anchor to the context, then count rendered samples. A transient repeated
    // currentFrame reading must not overwrite a block or punch a hole in a take.
    const frame=this.frame ?? currentFrame;
    this.engine.process(frame,input,output); this.frame=frame+output.length;
    let power=0; if(input) for(const sample of input) power+=sample*sample;
    const target=this.soften && input && Math.sqrt(power/input.length)>.012 ? .55 : 1;
    const step=1-Math.exp(-1/(sampleRate*(target<this.gain ? .08 : .35)));
    for(let i=0;i<output.length;i++) { this.gain+=(target-this.gain)*step; output[i]*=this.gain; }
    return true;
  }
}
registerProcessor('guitar-looper',Looper);
