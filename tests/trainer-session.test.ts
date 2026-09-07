import { expect, it } from 'vitest';
import { planSession } from '../src/trainer/session';
import { lessons } from '../src/trainer/curriculum';
import { calibrate, pipOnsets } from '../src/trainer/calibration';
import { TakeEvidence } from '../src/trainer/evidence';
it('separates demo, count-in and scoring and fades guidance without changing the phrase clock',()=>{
  const plan=planSession(lessons[0],60,10,'practice',2,true);
  expect(plan.events.filter(e=>e.kind==='note').every(e=>e.at+e.length<plan.playAt)).toBe(true);
  expect(plan.events.filter(e=>e.kind==='click' && e.at<plan.playAt)).toHaveLength(4);
  expect(plan.events.filter(e=>e.kind==='click' && e.at>=plan.playAt)).toHaveLength(2);
  expect(plan.end-plan.playAt).toBe(8);
  const dense=planSession(lessons[0],60,10,'practice',0,true);expect(dense.playAt).toBe(plan.playAt);expect(dense.end).toBe(plan.end);
});
it('measures the audio path from repeated known pips, rejecting ambiguous or absent signals',()=>{
  const rate=16000,expected=Array.from({length:8},(_,i)=>.5+i*.6),samples=new Float32Array(rate*6);
  for(const t of expected) for(let i=0;i<rate*.009;i++)samples[Math.round((t+.14)*rate)+i]=.2*Math.sin(2*Math.PI*1000*i/rate)*Math.min(1,i/(rate*.001),(.009-i/rate)/.002);
  const detected=pipOnsets(samples,rate),result=calibrate(expected,detected,.04);
  expect(detected.length).toBe(8);expect(result.ok).toBe(true);expect(result.offset).toBeCloseTo(.1,2);
  expect(calibrate(expected,[],.04).ok).toBe(false);expect(calibrate(expected,expected.slice(0,3),.04).ok).toBe(false);
  expect(pipOnsets(new Float32Array(rate*6),rate)).toEqual([]);
});
it('keeps pitch evidence tied to recorded attacks and release times despite delayed inference',()=>{
  const evidence=new TakeEvidence(10,8);
  evidence.receive({type:'attack',t:10.1});evidence.receive({type:'attack',t:12});
  evidence.receive({type:'frame',t:12.06,rms:.1,samples:new Float32Array(1024)});
  evidence.finish({t:10.1,end:10.8});
  evidence.note({t:10.1,hz:110,midi:45,pitchClass:9,cents:0,confidence:.9});
  const result=evidence.result(new Float32Array(100),100,100);
  expect(result.attacks).toHaveLength(2);expect(result.attacks[0].duration).toBeCloseTo(.7);expect(result.attacks[0].t).toBeCloseTo(.1);expect(result.attacks[1].midi).toBeUndefined();
});
