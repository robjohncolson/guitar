import grabberUrl from '../audio/grabber.worklet.ts?worker&url';
import recorderUrl from '../audio/looper.worklet.ts?worker&url';
import { enableContext, microphoneConstraints, outputDelay, type OutputMode } from '../audio/context';
import { Ear } from '../audio/ear';
import { Synth } from '../audio/synth';
import { edgeGain, type LoopEvent } from '../audio/loop-engine';
import { loopLevelGain } from '../audio/loop-level';
import { loopWav } from '../audio/loop-wav';
import type { CaptureMessage } from '../audio/worklet-grabber';
import type { Lesson } from './curriculum';
import { TakeEvidence } from './evidence';
import { analyzeTake } from './analyze';
import { calibrate, pipOnsets, type Calibration } from './calibration';
import { grade, type Grade } from './grader';
import { planSession, type SessionKind, type SessionPlan, type SoundEvent } from './session';

export interface TrainerTake {id:number;lesson:string;bpm:number;support:number;kind:SessionKind;offset:number;calibrated?:boolean;samples:Float32Array;rate:number;levelGain:number;result?:Grade;attacks:ReturnType<TakeEvidence['result']>['attacks']}
interface Capture {id:number;from:number;samples:Float32Array;copied:number;ready:boolean;evidence:TakeEvidence}
export class TrainerAudio {
  context?:AudioContext;
  model='CREPE loading'; pitch=0; confidence=0; error=''; busy=false; analysis='';
  plan?:SessionPlan; take?:TrainerTake; previous?:TrainerTake;
  mode:OutputMode='headphones'; volume=.5; click=true; deviceKey='';
  onTake:(take:TrainerTake)=>void=()=>{};
  onCalibration:(result:Calibration)=>void=()=>{};
  private synth?:Synth;
  private ear:Ear;
  private loading:Promise<void>;
  private stream?:MediaStream;
  private source?:MediaStreamAudioSourceNode;
  private grabber?:AudioWorkletNode;
  private recorder?:AudioWorkletNode;
  private silent?:GainNode;
  private playback?:AudioBufferSourceNode;
  private playbackGain?:GainNode;
  private pips:OscillatorNode[]=[];
  private generation=0;
  private sequence=0;
  private capture?:Capture;
  private current?:{lesson:Lesson;bpm:number;offset:number};
  private eventIndex=0;
  private lastTick=0;
  private interrupted=false;
  private modules=false;
  constructor() {
    this.ear=new Ear(text=>this.model=text,pitch=>{this.pitch=pitch.hz;this.confidence=pitch.confidence;},note=>this.capture?.evidence.note(note),undefined,end=>this.capture?.evidence.finish(end));
    this.loading=this.ear.load();
  }
  get micActive():boolean {return Boolean(this.stream);}
  get playing():boolean {return Boolean(this.playback);}
  get now():number {return this.context?.currentTime ?? 0;}
  private closeMic():void {
    this.source?.disconnect();this.source=undefined;
    this.stream?.getTracks().forEach(track=>track.stop());this.stream=undefined;
    this.grabber?.disconnect();this.grabber?.port.close();this.grabber=undefined;
    this.recorder?.disconnect();this.recorder?.port.close();this.recorder=undefined;
    this.silent?.disconnect();this.silent=undefined;
  }
  stop():void {
    this.generation++; this.busy=false;this.analysis='';this.plan=undefined;this.capture=undefined;this.current=undefined;
    this.closeMic();this.ear.resetCapture(this.now);this.synth?.panic();
    for(const pip of this.pips)try{pip.stop();}catch{/* Already ended. */}this.pips=[];
    try{this.playback?.stop();}catch{/* Already ended. */}this.playback=undefined;this.playbackGain?.disconnect();this.playbackGain=undefined;
  }
  private async microphone(generation:number):Promise<boolean> {
    const context=this.context!;
    const stream=await navigator.mediaDevices.getUserMedia(microphoneConstraints(this.mode));
    try {
      if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());return false;}
      if(!this.modules){await context.audioWorklet.addModule(grabberUrl);await context.audioWorklet.addModule(recorderUrl);this.modules=true;}
      if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());return false;}
      this.stream=stream;
      const device=stream.getAudioTracks()[0]?.getSettings().deviceId ?? 'default';
      this.deviceKey=`${device}|${context.sampleRate}|${this.mode}`;
      this.grabber=new AudioWorkletNode(context,'guitar-grabber');
      this.recorder=new AudioWorkletNode(context,'guitar-looper',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});
      this.silent=context.createGain();this.silent.gain.value=0;
      this.grabber.connect(this.silent);this.recorder.connect(this.silent);this.silent.connect(context.destination);
      this.source=context.createMediaStreamSource(stream);this.source.connect(this.grabber);this.source.connect(this.recorder);
      this.grabber.port.onmessage=event=>{
        if(generation!==this.generation)return;
        const message=event.data as CaptureMessage;
        this.capture?.evidence.receive(message);
        // No guide-tone inference or credit: only the playing window goes to CREPE.
        if(this.plan && this.plan.kind!=='calibration' && message.t>=this.plan.playAt-.15 && message.t<=this.plan.end+.5)this.ear.receive(message);
      };
      this.recorder.port.onmessage=event=>{if(generation===this.generation)this.receive(event.data as LoopEvent);};
      this.grabber.onprocessorerror=this.recorder.onprocessorerror=()=>{this.error='The audio processor stopped. Please start a new take.';this.stop();};
      stream.getAudioTracks().forEach(track=>track.addEventListener('ended',()=>{if(this.stream===stream){this.error='The microphone disconnected. Please start a new take.';this.stop();}}));
      return true;
    }catch(error){stream.getTracks().forEach(t=>t.stop());throw error;}
  }
  async start(lesson:Lesson,bpm:number,kind:SessionKind,support=0,offset=0,demonstrate=false):Promise<void> {
    this.stop();this.error='';this.busy=true;const generation=this.generation;
    try {
      this.context=await enableContext(this.context);if(generation!==this.generation)return;
      this.synth ??=new Synth(this.context);this.synth.volume=this.volume;this.synth.setMutes(false,false);
      if(kind!=='demo') {
        await this.loading;if(generation!==this.generation)return;
        if(kind==='practice' && !this.model.startsWith('CREPE ready'))throw new Error('CREPE is not ready. Retry after reloading; graded training requires the real pitch model.');
        if(!await this.microphone(generation))return;
      }
      this.ear.resetCapture(this.now);
      this.plan=planSession(lesson,bpm,this.now+outputDelay(this.context),kind,support,demonstrate);
      this.current={lesson,bpm,offset};this.eventIndex=0;this.lastTick=this.now;this.interrupted=false;
      if(kind!=='demo') {
        const plan=this.plan, rate=this.context.sampleRate,from=plan.playAt-(kind==='calibration' ? .25 : .5),until=plan.end+.75;
        const length=Math.round((until-from)*rate), id=++this.sequence;
        this.capture={id,from,samples:new Float32Array(length),copied:0,ready:false,evidence:new TakeEvidence(plan.playAt,plan.end-plan.playAt)};
        this.recorder!.port.postMessage({type:'record',id,bpm,beats:(until-from)*bpm/60,startFrame:Math.round(from*rate)});
      }
    }catch(error){if(generation===this.generation){this.stop();this.error=error instanceof Error ? error.message : String(error);}}
    finally{if(generation===this.generation)this.busy=false;}
  }
  private receive(event:LoopEvent):void {
    const capture=this.capture;if(!capture)return;
    if(event.type==='error'){this.error=event.message;this.stop();return;}
    if(event.type==='chunk' && event.id===capture.id) {
      if(event.offset!==capture.copied || event.offset+event.samples.length>capture.samples.length){this.interrupted=true;return;}
      capture.samples.set(event.samples,event.offset);capture.copied+=event.samples.length;
    }
    if(event.type==='take' && event.id===capture.id){capture.ready=true;this.recorder?.port.postMessage({type:'stop'});}
  }
  private sound(event:SoundEvent):void {
    const context=this.context!, at=event.at-outputDelay(context);
    if(event.kind==='click'){if(this.click || event.at<this.plan!.playAt)this.synth!.click(Math.max(context.currentTime,at),Boolean(event.accent));return;}
    if(event.kind==='note'){this.synth!.note(event.midi!,Math.max(context.currentTime,at),event.length,event.accent ? .85 : .65);return;}
    const oscillator=context.createOscillator(),gain=context.createGain();oscillator.frequency.value=1000;
    gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(.25,at+.001);gain.gain.linearRampToValueAtTime(0,at+.009);
    oscillator.connect(gain).connect(context.destination);oscillator.start(at);oscillator.stop(at+.011);this.pips.push(oscillator);
    oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();this.pips=this.pips.filter(p=>p!==oscillator);};
  }
  tick():void {
    const plan=this.plan, context=this.context;if(!plan || !context)return;
    if(context.state!=='running'){this.error='Audio paused. Start again when you are ready.';this.stop();return;}
    const now=context.currentTime;
    if(now-this.lastTick>.25)this.interrupted=true;this.lastTick=now;
    while(this.eventIndex<plan.events.length && plan.events[this.eventIndex].at-outputDelay(context)<=now+.12){
      const event=plan.events[this.eventIndex++];
      if(event.at-outputDelay(context)<now-.03){this.interrupted=true;continue;}this.sound(event);
    }
    if(now<plan.finish)return;
    if(plan.kind==='demo'){this.plan=undefined;this.synth?.panic();return;}
    // Native capture includes release/latency tail. A stalled port eventually fails visibly.
    if(!this.capture?.ready && now<plan.end+2)return;
    void this.complete();
  }
  private async complete():Promise<void> {
    const capture=this.capture!,plan=this.plan!,current=this.current!,context=this.context!;
    const generation=this.generation;
    this.plan=undefined;this.busy=true;this.analysis='Checking the recorded notes…';
    this.ear.resetCapture(this.now);
    if(plan.kind==='calibration') {
      const observed=pipOnsets(capture.samples,context.sampleRate).map(t=>t+capture.from);
      const expected=plan.events.map(e=>e.at-outputDelay(context));
      const result=calibrate(expected,observed,outputDelay(context));this.stop();this.onCalibration(result);return;
    }
    const evidence=capture.evidence.result(capture.samples,capture.samples.length,capture.copied,this.interrupted || !capture.ready);
    this.closeMic();
    try {
      if(plan.kind==='practice')evidence.attacks=await analyzeTake(capture.samples,context.sampleRate,plan.playAt-capture.from,plan.end-plan.playAt,frame=>this.ear.analyze(frame),()=>generation===this.generation,(done,total)=>this.analysis=`Checking note ${done} of ${total}…`,current.lesson.rhythmOnly);
    }catch(error){if(generation===this.generation){this.stop();this.error=error instanceof Error ? error.message : String(error);}return;}
    if(generation!==this.generation)return;
    const result=plan.kind==='practice' ? grade(current.lesson,current.bpm,evidence,current.offset) : undefined;
    const length=Math.round(current.lesson.beats*plan.period*context.sampleRate),from=Math.round((plan.playAt+current.offset-capture.from)*context.sampleRate);
    const samples=capture.samples.slice(Math.max(0,from),Math.max(0,from)+length);
    let peak=0;for(const sample of samples)peak=Math.max(peak,Math.abs(sample));
    const take:TrainerTake={id:capture.id,lesson:current.lesson.id,bpm:current.bpm,support:plan.support,kind:plan.kind,offset:current.offset,samples,rate:context.sampleRate,levelGain:loopLevelGain(peak),result,attacks:evidence.attacks};
    this.stop();this.previous=this.take;this.take=take;this.onTake(take);
  }
  async playTake(take=this.take,loop=false):Promise<void> {
    if(!take)return;this.stop();const generation=this.generation;
    this.context=await enableContext(this.context);if(generation!==this.generation)return;
    const context=this.context,buffer=context.createBuffer(1,take.samples.length,take.rate),data=buffer.getChannelData(0);
    for(let i=0;i<data.length;i++)data[i]=take.samples[i]*take.levelGain*edgeGain(i,data.length,take.rate);
    const player=context.createBufferSource(),gain=context.createGain();player.buffer=buffer;player.loop=loop;gain.gain.value=this.volume;
    player.connect(gain).connect(context.destination);this.playback=player;this.playbackGain=gain;
    player.onended=()=>{player.disconnect();gain.disconnect();if(this.playback===player){this.playback=undefined;this.playbackGain=undefined;}};player.start();
  }
  setVolume(value:number):void {this.volume=Math.max(0,Math.min(1,value));if(this.synth){this.synth.volume=this.volume;this.synth.setMutes(false,false);}this.playbackGain?.gain.setTargetAtTime(this.volume,this.now,.02);}
  wav(take=this.take):Uint8Array<ArrayBuffer>|undefined {return take ? loopWav(take.samples,take.rate,take.levelGain) : undefined;}
}
