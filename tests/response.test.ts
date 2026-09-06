import { expect, it } from 'vitest';
import { Response } from '../src/music/response';
import { Scheduler } from '../src/audio/scheduler';
import type { Synth } from '../src/audio/synth';
import { Grid } from '../src/audio/grid';
import { Companion } from '../src/music/companion';
import { midiToHz } from '../src/music/notes';

it('busy attacks soften the loop further, then a pause restores it at the same beat-relative pace', () => {
  for (const period of [0.25,0.5,1.5]) {
    const response = new Response(); expect(response.gain(0,period)).toBe(1);
    response.attack(0,period); const single = response.gain(0,period);
    response.attack(period/2,period); response.attack(period,period); response.attack(period*1.5,period);
    expect(response.gain(period*1.5,period)).toBe(0.4);
    expect(single).toBeGreaterThan(0.4);
    expect(response.gain(period*5,period)).toBeGreaterThan(0.9);
    expect(response.gain(period*12,period)).toBeGreaterThan(0.999);
    response.reset(); expect(response.gain(0,period)).toBe(1);
  }
});
it('the scheduler stays silent until recognition, then sends one phrase note with optional response', () => {
  const companion = new Companion(); companion.reset(0,0.5);
  const played: number[][] = [], gains: number[] = [];
  const context = {currentTime:0,outputLatency:0};
  const synth = {context,setResponse:(gain:number) => gains.push(gain),click:() => {},note:(...args:number[]) => played.push(args)} as unknown as Synth;
  const scheduler = new Scheduler(new Grid(0,0.5),synth,companion);
  scheduler.tick(); expect(gains.at(-1)).toBe(1); expect(played).toEqual([]);
  for (let pass=0;pass<3;pass++) [57,60,64].forEach((midi,i) => companion.accept({t:pass*2+i*0.5,hz:midiToHz(midi),midi,pitchClass:0,cents:0,confidence:0.9}));
  context.currentTime = 5.1; scheduler.tick();
  context.currentTime = 6; scheduler.response.attack(6,0.5); scheduler.tick();
  expect(gains.at(-1)).toBeLessThan(1); expect(played).toHaveLength(1); expect(played[0][1]).toBe(6);
  expect(played[0][2]).toBeLessThan(0.5);
  scheduler.responsive = false; scheduler.tick(); expect(gains.at(-1)).toBe(1);
  scheduler.responsive = true; companion.reset(0,0.5); scheduler.tick(); expect(gains.at(-1)).toBe(1);
});
