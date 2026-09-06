import { expect, it, vi, afterEach } from 'vitest';
import { AudioLooper } from '../src/audio/looper';

afterEach(()=>vi.unstubAllGlobals());
const fakeContext=()=>({currentTime:1,sampleRate:48000,outputLatency:.04,audioWorklet:{addModule:vi.fn(async()=>{})},
  createGain:()=>({gain:{value:0,cancelScheduledValues:vi.fn(),setValueAtTime:vi.fn(),setTargetAtTime:vi.fn()},connect:vi.fn()}),
  createMediaStreamSource:()=>({connect:vi.fn(),disconnect:vi.fn()}),destination:{}});
function setup() {
  const messages:unknown[]=[], port={postMessage:(command:unknown)=>messages.push(command),onmessage:undefined as undefined|((event:{data:unknown})=>void)};
  vi.stubGlobal('AudioWorkletNode',class {port=port;connect(destination:unknown){return destination;}});
  const context=fakeContext(), synth={click:vi.fn(),setMutes:vi.fn()}, looper=new AudioLooper(context as unknown as AudioContext,synth);
  return {context,synth,looper,messages,port};
}
it('releases a microphone granted after Stop and never arms a recording',async()=>{
  const {looper,messages}=setup(); let resolve!:(stream:unknown)=>void;
  const stop=vi.fn(); vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:()=>new Promise(r=>resolve=r)}});
  const starting=looper.record(120,'headphones'); await Promise.resolve(); await Promise.resolve();
  looper.stop(); resolve({getTracks:()=>[{stop}]}); await starting;
  expect(stop).toHaveBeenCalledOnce(); expect(looper.running).toBe(false);
  expect(messages.some((m:any)=>m.type==='record')).toBe(false);
});
it('arms a native-rate four-bar take with count-in and output-latency scheduling',async()=>{
  const {looper,messages,context,synth,port}=setup(), stop=vi.fn();
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:vi.fn(async()=>({getTracks:()=>[{stop}]}))}});
  await looper.record(40,'headphones');
  expect(looper.view()).toMatchObject({state:'Count in',beat:4});
  const command:any=messages.find((m:any)=>m.type==='record');
  expect(command.startFrame/48000).toBeCloseTo(7.15); expect(looper.recording?.take.samples.length).toBe(1152000);
  context.currentTime=1.1; looper.tick(); expect(synth.click.mock.calls[0][0]).toBeCloseTo(1.15); expect(synth.click.mock.calls[0][1]).toBe(true);
  port.onmessage?.({data:{type:'chunk',id:command.id,offset:0,samples:new Float32Array([.25,.5])}});
  port.onmessage?.({data:{type:'take',id:command.id,bpm:40,length:1152000,startFrame:command.startFrame+1152000,levelGain:1.6}});
  expect(looper.take?.samples[1]).toBe(.5); expect(looper.take?.levelGain).toBe(1.6); expect(stop).toHaveBeenCalledOnce();
  looper.stop(); expect(looper.take?.samples[1]).toBe(.5); expect(looper.take?.levelGain).toBe(1.6);
});
it('ignores late capture messages after Stop instead of replacing the old take',async()=>{
  const {looper,port}=setup(); vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}});
  looper.take={id:9,bpm:120,samples:new Float32Array([.4]),levelGain:2}; await looper.record(120,'speakers'); const id=looper.recording!.id;
  looper.stop(); port.onmessage?.({data:{type:'take',id,bpm:120,length:384000,startFrame:1,levelGain:16}});
  expect(looper.take.id).toBe(9); expect(looper.running).toBe(false);
  expect(looper.take.levelGain).toBe(2);
});
