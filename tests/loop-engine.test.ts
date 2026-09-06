import { expect, it } from 'vitest';
import { LoopEngine, loopFrames, loopFrameAt, nextLoopBoundary, type LoopEvent } from '../src/audio/loop-engine';

const rate = 1000;
function run(engine:LoopEngine,from:number,to:number,input=(frame:number)=>Math.sin(frame*0.07)):Float32Array {
  const result = new Float32Array(to-from);
  for (let frame=from;frame<to;frame+=128) {
    const length=Math.min(128,to-frame), output=new Float32Array(length);
    engine.process(frame,Float32Array.from({length},(_,i)=>input(frame+i)),output); result.set(output,frame-from);
  }
  return result;
}
it('records exactly sixteen beats after a scheduled count-in, preserving audio and silence',()=>{
  const events:LoopEvent[]=[], engine=new LoopEngine(rate,event=>events.push(event));
  engine.command({type:'record',id:1,bpm:120,startFrame:2000},0);
  const input=(frame:number)=>frame<4000 ? Math.sin(frame*.07) : 0;
  const output=run(engine,0,18000,input);
  expect(engine.take?.samples).toHaveLength(8000);
  expect(engine.take?.samples[100]).toBeCloseTo(input(2100));
  expect(engine.take?.samples[4000]).toBe(0);
  expect(output.slice(0,10000).every(n=>n===0)).toBe(true);
  expect(output[10100]).toBeCloseTo(input(2100));
  expect(events.filter(e=>e.type==='take')).toEqual([{type:'take',id:1,bpm:120,length:8000,startFrame:10000}]);
  const chunks=events.filter(e=>e.type==='chunk'); expect(chunks.map(c=>c.samples.length)).toEqual([4096,3904]);
});
it('loops indefinitely without accumulating timing drift and fades both seam edges',()=>{
  const engine=new LoopEngine(rate); engine.command({type:'record',id:1,bpm:240,startFrame:1000},0);
  const output=run(engine,0,33000,()=>.7);
  expect(output[5000]).toBe(0); expect(output[8999]).toBe(0); expect(output[9000]).toBe(0);
  for(let pass=1;pass<7;pass++) expect(output.slice(5000+pass*4000,9000+pass*4000)).toEqual(output.slice(5000,9000));
  expect(output[5100]).toBeCloseTo(.7);
});
it('replaces only at the boundary, silences the old take during capture, then supports one Undo',()=>{
  const engine=new LoopEngine(rate); engine.command({type:'record',id:1,bpm:240,startFrame:0},0); run(engine,0,4500,()=>.2);
  engine.command({type:'record',id:2,bpm:120,startFrame:8000},4500);
  const output=run(engine,4500,17000,()=>.6);
  expect(output[100]).toBeCloseTo(.2); expect(output.slice(3500,11500).every(n=>n===0)).toBe(true);
  expect(output[11600]).toBeCloseTo(.6); expect(engine.previous?.id).toBe(1);
  engine.command({type:'undo',startFrame:24000},17000); run(engine,17000,25000);
  expect(engine.take?.id).toBe(1); expect(engine.take?.bpm).toBe(240); expect(engine.previous).toBeUndefined();
  expect(engine.origin).toBe(24000);
});
it('Stop cancels partial replacement, keeps the complete take, and Play starts at its beginning',()=>{
  const engine=new LoopEngine(rate); engine.command({type:'record',id:1,bpm:240,startFrame:0},0); run(engine,0,4500,()=>.2);
  engine.command({type:'record',id:2,bpm:240,startFrame:8000},4500); run(engine,4500,8500,()=>.8);
  engine.command({type:'stop'},8500); expect(run(engine,8500,9000).every(n=>n===0)).toBe(true); expect(engine.take?.id).toBe(1);
  engine.command({type:'play',startFrame:9200},9000); const played=run(engine,9000,9500);
  expect(played[200]).toBe(0); expect(played[210]).toBeCloseTo(.2);
  engine.command({type:'clear'},9500); expect(engine.take).toBeUndefined(); expect(engine.previous).toBeUndefined();
});
it('Undo while stopped restores without starting playback',()=>{
  const engine=new LoopEngine(rate);
  engine.command({type:'record',id:1,bpm:240,startFrame:0},0); run(engine,0,4100);
  engine.command({type:'record',id:2,bpm:240,startFrame:8000},4100); run(engine,4100,12100);
  engine.command({type:'stop'},12100); engine.command({type:'undo',startFrame:12200},12100);
  expect(run(engine,12100,13000).every(n=>n===0)).toBe(true); expect(engine.take?.id).toBe(1);
});
it('supports slow-tempo four-bar audio beyond the diagnostic twenty-second cap',()=>{
  expect(loopFrames(48000,40)).toBe(1152000);
  expect(loopFrames(44100,137)).toBe(Math.round(44100*960/137));
  expect(loopFrameAt(5,.04,48000)).toBe(238080);
  expect(nextLoopBoundary(4,8,12)).toBe(12); expect(nextLoopBoundary(4,8,12.001)).toBe(20);
});
it('rejects a late command without overwriting the saved take',()=>{
  const events:LoopEvent[]=[], engine=new LoopEngine(rate,e=>events.push(e));
  engine.command({type:'record',id:1,bpm:120,startFrame:0},100);
  expect(events[0].type).toBe('error'); expect(engine.take).toBeUndefined();
});
it('Stop at completion preserves the last acknowledged take and its Undo history',()=>{
  const engine=new LoopEngine(rate);
  engine.command({type:'record',id:1,bpm:240,startFrame:0},0); run(engine,0,4100,()=>.1);
  engine.command({type:'record',id:2,bpm:240,startFrame:8000},4100); run(engine,4100,12100,()=>.2);
  engine.command({type:'record',id:3,bpm:240,startFrame:16000},12100); run(engine,12100,20001,()=>.3);
  engine.command({type:'stop',keepId:2},20001);
  expect(engine.take?.id).toBe(2); expect(engine.previous?.id).toBe(1);
  engine.command({type:'undo',startFrame:20100},20001); run(engine,20001,20101);
  engine.command({type:'stop',keepId:2},20101); expect(engine.take?.id).toBe(2); expect(engine.previous?.id).toBe(1);
});
