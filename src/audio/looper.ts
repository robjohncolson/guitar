import workletUrl from './looper.worklet.ts?worker&url';
import { microphoneConstraints, outputDelay, type OutputMode } from './context';
import { loopFrameAt, loopFrames, nextLoopBoundary, type LoopCommand, type LoopEvent, type LoopTake } from './loop-engine';
import { fireTime } from './timing';
import type { Synth } from './synth';

interface Recording { id:number;startFrame:number;endFrame:number;take:LoopTake;complete:boolean;countIn:boolean }
interface Clock { from:number;origin:number;period:number }

/** Controls a sample-clock worklet. UI/timer delays cannot extend a recording or its loop. */
export class AudioLooper {
  take?:LoopTake;
  previous?:LoopTake;
  recording?:Recording;
  busy=false;
  running=false;
  error='';
  clickMuted=false;
  soften=false;
  private volume=.22;
  private muted=false;
  private node?:AudioWorkletNode;
  private gain?:GainNode;
  private stream?:MediaStream;
  private source?:MediaStreamAudioSourceNode;
  private mode:OutputMode='speakers';
  private generation=0;
  private sequence=0;
  private origin=0;
  private clocks:Clock[]=[];
  private clicked=new Set<number>();
  private swap?:{take:LoopTake;frame:number};
  constructor(readonly context:AudioContext,readonly synth:Pick<Synth,'click'|'setMutes'>) {}
  get pendingUndo():boolean { return Boolean(this.swap); }
  get micActive():boolean { return Boolean(this.stream); }
  private send(command:LoopCommand):void { this.node?.port.postMessage(command); }
  private async graph():Promise<void> {
    if(this.node) return;
    await this.context.audioWorklet.addModule(workletUrl);
    this.node=new AudioWorkletNode(this.context,'guitar-looper',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});
    this.gain=this.context.createGain(); this.gain.gain.value=0;
    this.node.connect(this.gain).connect(this.context.destination);
    this.node.port.onmessage=event=>this.receive(event.data as LoopEvent);
  }
  private releaseMic():void { this.source?.disconnect(); this.source=undefined; this.stream?.getTracks().forEach(track=>track.stop()); this.stream=undefined; }
  private async acquire(mode:OutputMode,generation:number):Promise<boolean> {
    if(this.stream && this.mode===mode) return true;
    const stream=await navigator.mediaDevices.getUserMedia(microphoneConstraints(mode));
    if(generation!==this.generation) { stream.getTracks().forEach(track=>track.stop()); return false; }
    try {
      const source=this.context.createMediaStreamSource(stream); source.connect(this.node!);
      this.releaseMic(); this.source=source; this.stream=stream; this.mode=mode; return true;
    } catch(error) { stream.getTracks().forEach(track=>track.stop()); throw error; }
  }
  async record(bpm:number,mode:OutputMode):Promise<void> {
    if(this.busy || this.recording || this.swap) return;
    const generation=++this.generation; this.busy=true; this.error='';
    try {
      await this.graph(); if(generation!==this.generation) return;
      if(!await this.acquire(mode,generation)) return;
      const rate=this.context.sampleRate, delay=outputDelay(this.context), earliest=this.context.currentTime+delay+.15;
      const replacing=this.running && this.take;
      const start=replacing ? nextLoopBoundary(this.origin/rate+delay,this.take!.samples.length/rate,earliest) : earliest+4*60/bpm;
      const startFrame=loopFrameAt(start,delay,rate), length=loopFrames(rate,bpm), id=++this.sequence;
      this.recording={id,startFrame,endFrame:startFrame+length,take:{id,bpm,samples:new Float32Array(length),levelGain:1},complete:false,countIn:!replacing};
      const clock={from:startFrame,origin:startFrame,period:length/16};
      if(replacing) this.clocks=[...this.clocks.filter(c=>c.from<startFrame),clock];
      else { clock.from=clock.origin=startFrame-Math.round(length/4); this.clocks=[clock]; this.clicked.clear(); }
      this.send({type:'record',id,bpm,startFrame}); this.running=true; this.refreshGains();
    } catch(error) { if(generation===this.generation) this.error=error instanceof Error ? error.message : String(error); }
    finally { if(generation===this.generation) this.busy=false; }
  }
  async play(mode:OutputMode):Promise<void> {
    if(this.busy || this.running || !this.take) return;
    const generation=++this.generation; this.busy=true; this.error='';
    try {
      await this.graph(); if(generation!==this.generation) return;
      if(this.soften && mode==='headphones' && !await this.acquire(mode,generation)) return;
      this.mode=mode;
      this.origin=loopFrameAt(this.context.currentTime+outputDelay(this.context)+.15,outputDelay(this.context),this.context.sampleRate);
      this.send({type:'play',startFrame:this.origin});
      this.clocks=[{from:this.origin,origin:this.origin,period:this.take.samples.length/16}]; this.clicked.clear();
      this.running=true; this.refreshGains();
    } catch(error) { if(generation===this.generation) this.error=error instanceof Error ? error.message : String(error); }
    finally { if(generation===this.generation) this.busy=false; }
  }
  undo():void {
    if(!this.previous || this.recording || this.busy || this.swap) return;
    const rate=this.context.sampleRate, earliest=(this.context.currentTime+.15)*rate;
    const frame=Math.round(this.running ? nextLoopBoundary(this.origin,this.take!.samples.length,earliest) : earliest);
    this.swap={take:this.previous,frame}; this.send({type:'undo',startFrame:frame});
    if(this.running) this.clocks=[...this.clocks.filter(c=>c.from<frame),{from:frame,origin:frame,period:this.previous.samples.length/16}];
  }
  stop():void {
    this.generation++; this.busy=false; this.running=false; this.recording=undefined; this.swap=undefined;
    this.clocks=[]; this.clicked.clear(); this.send({type:'stop',keepId:this.take?.id ?? null}); this.releaseMic();
    this.synth.setMutes(true,true); this.refreshGains();
  }
  clear():void { this.stop(); this.send({type:'clear'}); this.take=undefined; this.previous=undefined; this.error=''; }
  private receive(event:LoopEvent):void {
    if(event.type==='chunk' && this.recording?.id===event.id) this.recording.take.samples.set(event.samples,event.offset);
    if(event.type==='take' && this.recording?.id===event.id) {
      this.recording.take.levelGain=event.levelGain;
      this.previous=this.take; this.take=this.recording.take; this.recording.complete=true; this.origin=event.startFrame;
      if(!this.soften || this.mode!=='headphones') this.releaseMic();
    }
    if(event.type==='playing' && this.swap?.frame===event.startFrame && this.swap.take.id===event.id) {
      this.take=this.swap.take; this.previous=undefined; this.origin=event.startFrame; this.swap=undefined;
    }
    if(event.type==='error') { this.stop(); this.error=event.message; }
  }
  setVolume(volume:number,muted:boolean):void { this.volume=volume; this.muted=muted; this.refreshGains(); }
  private refreshGains():void {
    if(this.gain) {
      const gain=this.gain.gain, now=this.context.currentTime;
      gain.cancelScheduledValues(now);
      if(!this.running) gain.setValueAtTime(0,now);
      else gain.setTargetAtTime(this.muted ? 0 : this.volume*2,now,.015);
    }
    this.node?.port.postMessage({type:'soften',enabled:this.soften && this.mode==='headphones'});
  }
  async configureInput(mode:OutputMode,soften:boolean):Promise<void> {
    if(this.recording || this.busy) return;
    const generation=++this.generation; this.mode=mode; this.soften=soften; this.refreshGains();
    if(!this.running || !soften || mode!=='headphones') { this.releaseMic(); return; }
    this.busy=true;
    try { await this.acquire(mode,generation); }
    catch(error) { if(generation===this.generation) this.error=error instanceof Error ? error.message : String(error); }
    finally { if(generation===this.generation) this.busy=false; }
  }
  /** Metronome only; capture/playback boundaries are enforced inside the worklet. */
  tick():void {
    if(!this.running) return;
    const now=this.context.currentTime, rate=this.context.sampleRate, delay=outputDelay(this.context);
    if(this.recording?.complete && now>=this.recording.endFrame/rate+delay) this.recording=undefined;
    this.synth.setMutes(true,this.clickMuted);
    for(let c=0;c<this.clocks.length;c++) {
      const clock=this.clocks[c], until=this.clocks[c+1]?.from ?? Infinity;
      const first=Math.floor((now*rate-clock.origin)/clock.period);
      for(let beat=first;beat<=first+2;beat++) {
        const frame=Math.round(clock.origin+beat*clock.period);
        if(frame<clock.from || frame>=until || frame/rate>now+.075 || this.clicked.has(frame)) continue;
        this.clicked.add(frame); const fire=fireTime(frame/rate+delay,now,delay);
        if(fire!==null) this.synth.click(fire,beat%4===0);
      }
    }
    for(const frame of this.clicked) if(frame<(now-2)*rate) this.clicked.delete(frame);
    while(this.clocks.length>1 && this.clocks[1].from<(now-1)*rate) this.clocks.shift();
  }
  view():{state:string;bar:number;progress:number;beat:number;recording:boolean} {
    const frame=(this.context.currentTime-outputDelay(this.context))*this.context.sampleRate;
    if(this.recording) {
      const plan=this.recording, period=plan.take.samples.length/16;
      if(frame<plan.startFrame) {
        const progress=!plan.countIn && this.take ? Math.max(0,((frame-this.origin)%this.take.samples.length)/this.take.samples.length) : 0;
        return {state:plan.countIn ? 'Count in' : 'Replace at loop start',bar:plan.countIn ? -1 : Math.floor(progress*4),progress,beat:Math.min(plan.countIn ? 4 : 16,Math.max(1,Math.ceil((plan.startFrame-frame)/period))),recording:false};
      }
      const progress=Math.max(0,Math.min(1,(frame-plan.startFrame)/plan.take.samples.length));
      return {state:'Recording',bar:Math.min(3,Math.floor(progress*4)),progress,beat:Math.floor((frame-plan.startFrame)/period)%4+1,recording:true};
    }
    const progress=this.running && this.take ? Math.max(0,((frame-this.origin)%this.take.samples.length)/this.take.samples.length) : 0;
    return {state:this.running ? 'Looping' : this.take ? 'Stopped · take saved' : 'Ready to record',bar:this.running ? Math.floor(progress*4) : -1,progress,beat:Math.floor(progress*16)%4+1,recording:false};
  }
}
