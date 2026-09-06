import { expect, it } from 'vitest';
import { Response } from '../src/music/response';
import { Scheduler } from '../src/audio/scheduler';
import type { Synth } from '../src/audio/synth';
import { Grid } from '../src/audio/grid';
import { Repeater } from '../src/music/repeater';
import { PhraseMemory } from '../src/music/phrase-memory';

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
it('the scheduler applies response only to a loop and sends the captured expression to the synth', () => {
  const memory = new PhraseMemory(); memory.reset(0,0.5);
  const repeater = new Repeater();
  const note = {t:0,hz:220,midi:57,pitchClass:9,cents:0,confidence:0.9,velocity:0.4,duration:0.15};
  memory.record(note);
  const played: number[][] = [], gains: number[] = [];
  const synth = {context:{currentTime:4,outputLatency:0},setResponse:(gain:number) => gains.push(gain),click:() => {},note:(...args:number[]) => played.push(args)} as unknown as Synth;
  const scheduler = new Scheduler(new Grid(0,0.5),synth,repeater,memory);
  scheduler.response.attack(4,0.5); scheduler.tick(); expect(gains.at(-1)).toBe(1);
  memory.remember(1,2.1,0); scheduler.tick();
  expect(gains.at(-1)).toBeLessThan(1); expect(played[0]).toEqual([57,4,0.15,0.4]);
  scheduler.responsive = false; scheduler.tick(); expect(gains.at(-1)).toBe(1);
  scheduler.responsive = true; memory.clear(); scheduler.tick(); expect(gains.at(-1)).toBe(1);
});
