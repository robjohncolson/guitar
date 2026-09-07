import { afterEach, expect, it, vi } from 'vitest';
const inference=vi.hoisted(()=>({infer:vi.fn()}));
vi.mock('../src/audio/ear',()=>({Ear:class {onsets={};load=async()=>{};receive=()=>{};resetCapture=()=>{};analyze=inference.infer;constructor(status:(s:string)=>void){status('CREPE ready (tiny)');}}}));
import { TrainerAudio } from '../src/trainer/audio';
import { lessons } from '../src/trainer/curriculum';
import { LoopEngine, loopFrames } from '../src/audio/loop-engine';
afterEach(()=>vi.unstubAllGlobals());
it('closes late microphone permission after Stop without starting transport or worklets',async()=>{
  const gain=()=>({gain:{value:0},connect(){return this;},disconnect(){}});
  vi.stubGlobal('AudioContext',class {currentTime=1;sampleRate=48000;outputLatency=.04;destination={};resume=async()=>{};createGain=gain;audioWorklet={addModule:vi.fn()};});
  let resolve!:(s:unknown)=>void;const stop=vi.fn();
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:()=>new Promise(r=>resolve=r)}});
  const audio=new TrainerAudio(),starting=audio.start(lessons[0],60,'practice');
  await vi.waitFor(()=>expect(resolve).toBeDefined());audio.stop();resolve({getTracks:()=>[{stop}]});await starting;
  expect(stop).toHaveBeenCalledOnce();expect(audio.plan).toBeUndefined();expect(audio.busy).toBe(false);expect(audio.micActive).toBe(false);
});
it('captures short lessons with a tail while preserving the original sixteen-beat default',()=>{
  const engine=new LoopEngine(1000);engine.command({type:'record',id:1,bpm:60,startFrame:0,beats:9},0);
  engine.process(0,new Float32Array(9100).fill(.1),new Float32Array(9100));
  expect(engine.take?.samples.length).toBe(9000);expect(loopFrames(1000,60)).toBe(16000);
  engine.command({type:'clear'},9100);engine.command({type:'record',id:2,bpm:60,startFrame:9200,beats:Infinity},9100);
  engine.process(9100,undefined,new Float32Array(100));expect(engine.take).toBeUndefined();
});
it('Stop during recorded-note analysis never publishes an abandoned take',async()=>{
  let resolve!:(pitch:{hz:number;confidence:number})=>void;
  inference.infer.mockImplementation(()=>new Promise(r=>resolve=r));
  const audio=new TrainerAudio(),onTake=vi.fn();audio.onTake=onTake;
  audio.context={currentTime:10,sampleRate:48000} as AudioContext;
  const samples=new Float32Array(444000);for(let i=24000;i<48000;i++)samples[i]=.2*Math.sin(2*Math.PI*110*i/48000);
  const internals=audio as any;
  internals.capture={id:1,from:.5,samples,copied:samples.length,ready:true,evidence:{result:()=>({attacks:[],coverage:1,clipped:0})}};
  internals.current={lesson:lessons[0],bpm:60,offset:0};
  audio.plan={kind:'practice',start:0,playAt:1,end:9,finish:9.65,period:1,support:0,events:[]};
  const completed=internals.complete();await vi.waitFor(()=>expect(resolve).toBeDefined());
  audio.stop();resolve({hz:110,confidence:.9});await completed;
  expect(onTake).not.toHaveBeenCalled();expect(audio.take).toBeUndefined();expect(audio.busy).toBe(false);expect(audio.plan).toBeUndefined();
});
