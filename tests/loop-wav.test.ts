import { expect, it } from 'vitest';
import { loopWav } from '../src/audio/loop-wav';
import { parseSettings, defaults } from '../src/ui/settings';

it('exports the full native-rate four-bar take with playback fades and exact PCM length',()=>{
  const samples=new Float32Array(48000*24).fill(.5), bytes=loopWav(samples,48000,1), view=new DataView(bytes.buffer);
  expect(bytes.length).toBe(44+48000*24*2); expect(view.getUint32(24,true)).toBe(48000);
  expect(view.getUint16(22,true)).toBe(1); expect(view.getUint32(40,true)).toBe(samples.length*2);
  expect(view.getInt16(44,true)).toBe(0); expect(view.getInt16(bytes.length-2,true)).toBe(0);
  expect(view.getInt16(44+1000*2,true)).toBe(16384); expect(samples[0]).toBe(.5);
});
it('exports the same louder accents and rests without clipping or changing the source',()=>{
  const samples=new Float32Array(1000); samples[100]=.1; samples[200]=-.1; samples[300]=.025;
  const view=new DataView(loopWav(samples,1000,8).buffer);
  expect(view.getInt16(44+100*2,true)).toBe(Math.round(.8*32767));
  expect(view.getInt16(44+200*2,true)).toBe(Math.round(-.8*32767));
  expect(view.getInt16(44+300*2,true)).toBe(Math.round(.2*32767));
  expect(view.getInt16(44+400*2,true)).toBe(0);
  expect(samples[100]).toBeCloseTo(.1);
});
it('persists Looper preferences independently and never parses recorded audio as preferences',()=>{
  expect(defaults.appMode).toBe('partner'); expect(defaults.loopClickMuted).toBe(false); expect(defaults.loopSoften).toBe(false);
  const saved=parseSettings(JSON.stringify({appMode:'looper',loopClickMuted:true,loopMuted:true,loopSoften:true,clickMuted:false,loop:{samples:[1,2,3]}}));
  expect(saved).toMatchObject({appMode:'looper',loopClickMuted:true,loopMuted:true,loopSoften:true,clickMuted:false});
  expect(saved).not.toHaveProperty('loop'); expect(parseSettings('{"appMode":"invalid"}').appMode).toBe('partner');
});
