import { expect, it, vi } from 'vitest';
import { analyzeTake, pitchFrame } from '../src/trainer/analyze';
const rate=48000;
function recording(plucks:{at:number;length:number}[]):Float32Array {
  const samples=new Float32Array(rate*3);
  for(const {at,length} of plucks)for(let i=0;i<length*rate;i++)samples[Math.round(at*rate)+i]=.2*Math.sin(2*Math.PI*110*i/rate);
  return samples;
}
it('resamples the stored signal to the exact CREPE window, padding edges',()=>{
  const samples=recording([{at:.25,length:.5}]),frame=pitchFrame(samples,rate,.4);
  expect(frame).toHaveLength(1024);expect(frame[512]).toBeCloseTo(samples[Math.round(.4*rate)],6);
  expect(pitchFrame(samples,rate,0).slice(0,512).every(v=>v===0)).toBe(true);
});
it('retains native attack times and deliberate quiet releases even with slow inference',async()=>{
  const infer=vi.fn(async()=>{await new Promise(r=>setTimeout(r,2));return {hz:110,confidence:.8};});
  const attacks=await analyzeTake(recording([{at:.25,length:.4},{at:1.25,length:.7}]),rate,.25,2,infer);
  expect(attacks).toHaveLength(2);expect(attacks[0].t).toBeCloseTo(0,2);expect(attacks[1].t).toBeCloseTo(1,2);
  expect(attacks[0].midi).toBeCloseTo(45,5);expect(attacks[0].duration).toBeCloseTo(.4,1);expect(attacks[1].duration).toBeCloseTo(.7,1);
  expect(infer).toHaveBeenCalledTimes(4);
});
it('does not turn unclear or conflicting pitches into correct notes',async()=>{
  const samples=recording([{at:.25,length:.5}]);
  const unclear=await analyzeTake(samples,rate,.25,2,async()=>({hz:110,confidence:.3}));expect(unclear[0].midi).toBeUndefined();
  let i=0;const conflicting=await analyzeTake(samples,rate,.25,2,async()=>({hz:[110,165,220,330][i++],confidence:.9}));
  expect(conflicting[0].midi).toBeUndefined();expect(conflicting[0].confidence).toBeUndefined();
});
it('rejects short click bleed, keeps rhythmic strums, and avoids pitch claims for them',async()=>{
  const infer=vi.fn(async()=>({hz:110,confidence:.9}));
  const attacks=await analyzeTake(recording([{at:.25,length:.009},{at:1.25,length:.15}]),rate,.25,2,infer,undefined,undefined,true);
  expect(attacks).toHaveLength(1);expect(attacks[0].t).toBeCloseTo(1,2);expect(attacks[0].midi).toBeUndefined();expect(infer).not.toHaveBeenCalled();
});
it('discards an analysis cancelled while a pitch read is pending',async()=>{
  let alive=true;const attacks=await analyzeTake(recording([{at:.25,length:.5}]),rate,.25,2,async()=>{alive=false;return {hz:110,confidence:.9};},()=>alive);
  expect(attacks).toEqual([]);
});
it('does not credit long reverberant metronome pips as muted strums',async()=>{
  const samples=new Float32Array(rate*3);
  for(const [at,hz] of [[.25,1000],[1.25,1300]])for(let i=0;i<rate*.25;i++)samples[Math.round(at*rate)+i]=.2*Math.sin(2*Math.PI*hz*i/rate)*Math.exp(-i/(rate*.12));
  const attacks=await analyzeTake(samples,rate,.25,2,async()=>({hz:0,confidence:0}),undefined,undefined,true);
  expect(attacks).toEqual([]);
});
