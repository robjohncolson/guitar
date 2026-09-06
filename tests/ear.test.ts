import { describe, expect, it } from 'vitest';
import { binCents, normalize, postprocess } from '../src/audio/crepe';
import { OnsetDetector } from '../src/audio/onset';
import { FrameBuffer } from '../src/audio/frame-buffer';
import { AttackDetector } from '../src/audio/attack';
import { Grid } from '../src/audio/grid';
import { SelfMask } from '../src/audio/self-mask';
import type { NoteEnd } from '../src/music/notes';

describe('CREPE official contract', () => {
  it('reconstructs a known bin to within 1%', () => {
    const bins = new Float32Array(360); bins[140] = 0.9;
    const result = postprocess(bins);
    expect(result.hz).toBeCloseTo(10 * 2 ** (binCents(140) / 1200), 5);
    expect(result.confidence).toBeCloseTo(0.9);
  });
  it('uses only the local weighted neighborhood and guards silence', () => {
    const bins = new Float32Array(360); bins[140] = 1; bins[141] = 0.5; bins[10] = 0.8;
    expect(postprocess(bins).hz).toBeCloseTo(10 * 2 ** ((binCents(140) + binCents(141) * 0.5) / 1.5 / 1200));
    expect(postprocess(new Float32Array(360)).hz).toBe(0);
    expect(normalize(new Float32Array(1024)).every(x => x === 0)).toBe(true);
  });
  it('normalizes DC offset to zero mean and unit RMS', () => {
    const result = normalize(Float32Array.from({ length: 1024 }, (_, i) => 3 + Math.sin(i)));
    expect(result.reduce((a,b) => a+b,0)/1024).toBeCloseTo(0, 5);
    expect(Math.sqrt(result.reduce((a,b) => a+b*b,0)/1024)).toBeCloseTo(1, 5);
  });
});
describe('capture and attacks', () => {
  it('captures attack strength before CREPE normalization', () => {
    const detector = new OnsetDetector();
    const pluck = (t: number, rms: number) => {
      detector.attack(t);
      for (const offset of [0,0.02,0.04]) detector.process(t+offset,{hz:220,confidence:0.9},rms);
      return detector.process(t+0.06,{hz:220,confidence:0.9},rms)!;
    };
    const soft = pluck(0,0.01), loud = pluck(0.5,0.08);
    expect(loud.hz).toBe(soft.hz); expect(loud.level).toBeCloseTo(soft.level!*8);
  });
  it('ends notes at the release, tolerates brief pitch dropouts, and emits no sustain attacks', () => {
    const ends: NoteEnd[] = [], detector = new OnsetDetector(note => ends.push(note));
    let count = 0;
    for (let i=0;i<50;i++) {
      const voiced = i !== 10 && i < 30;
      if (detector.process(i*0.02,{hz:voiced ? 220 : 0,confidence:voiced ? 0.9 : 0},i < 30 ? 0.02 : 0)) count++;
    }
    expect(count).toBe(1); expect(ends).toEqual([{t:0,end:0.6}]);
  });
  it('a new settled attack ends the previous note at its original timestamp', () => {
    const ends: NoteEnd[] = [], detector = new OnsetDetector(note => ends.push(note));
    for (let i=0;i<40;i++) {
      if (i === 20) detector.attack(0.4);
      detector.process(i*0.02,{hz:220,confidence:0.9},0.02);
    }
    expect(ends).toEqual([{t:0,end:0.4}]);
    detector.reset(0.8); expect(ends[1]).toEqual({t:0.4,end:0.8});
  });
  it.each([44100, 48000])('resamples %i Hz to overlapping 1024-sample frames at 20 ms hops', rate => {
    const capture = new FrameBuffer(rate);
    const input = Float32Array.from({length: rate / 5}, (_, i) => Math.sin(2*Math.PI*220*i/rate));
    const frames = capture.push(input, 0);
    expect(frames.length).toBeGreaterThanOrEqual(7);
    expect(frames[0].samples.length).toBe(1024);
    expect(frames[1].t-frames[0].t).toBeCloseTo(0.02, 4);
    expect(frames[0].rms).toBeCloseTo(Math.SQRT1_2, 1);
  });
  it('a sustained voiced note occupies one slot, then a new pluck emits one more', () => {
    const detector = new OnsetDetector(), grid = new Grid(0, 0.5);
    const notes = [];
    for (let i=0;i<100;i++) {
      if (i === 50) detector.attack(1);
      const note = detector.process(i * 0.02, { hz: 220, confidence: 0.9 },0.02);
      if (note) { notes.push(note); grid.claimPlayer(note.t); }
    }
    expect(notes).toHaveLength(2);
    expect(grid.slot(0).occupancy).toBe('player'); expect(grid.slot(1).occupancy).toBe('empty'); expect(grid.slot(2).occupancy).toBe('player');
  });
  it('waits 60 ms for the median and debounces attacks', () => {
    const detector = new OnsetDetector(); detector.attack(0); detector.attack(0.02);
    expect(detector.process(0, {hz: 219, confidence: 0.8},0.02)).toBeNull();
    detector.process(0.02, {hz: 220, confidence: 0.8},0.02); detector.process(0.04, {hz: 221, confidence: 0.8},0.02);
    expect(detector.process(0.06, {hz: 220, confidence: 0.8},0.02)?.hz).toBe(220);
  });
  it('keeps long confidence gaps and octave blips in ringing audio out of the attack/rest sequence', () => {
    const ends: NoteEnd[] = [], detector = new OnsetDetector(note => ends.push(note));
    const notes = [];
    for (let i=0;i<60;i++) {
      const confidence = i >= 10 && i < 25 ? 0.1 : 0.9;
      const hz = i === 30 || i === 31 ? 440 : 220;
      const note = detector.process(i*0.02,{hz,confidence},0.02);
      if (note) notes.push(note);
    }
    expect(notes).toHaveLength(1); expect(ends).toEqual([]);
    for (let i=60;i<68;i++) detector.process(i*0.02,{hz:0,confidence:0},0);
    expect(ends).toEqual([{t:0,end:1.2}]);
  });
  it('requires agreeing pitch observations and merges a second transient within 90 ms', () => {
    const detector = new OnsetDetector(); detector.attack(0);
    const emitted = [];
    for (let i=0;i<12;i++) {
      if (i === 4) detector.attack(0.08);
      const note = detector.process(i*0.02,{hz:i === 0 ? 440 : 220,confidence:0.9},0.02);
      if (note) emitted.push(note);
    }
    expect(emitted).toHaveLength(1); expect(emitted[0].hz).toBe(220);
    const unstable = new OnsetDetector(); unstable.attack(0);
    for (let i=0;i<10;i++) expect(unstable.process(i*0.02,{hz:[220,330,440][i%3],confidence:0.9},0.02)).toBeNull();
  });
  it('a masked reply cannot split the player sustain or invent a rest', () => {
    const ends: NoteEnd[] = [], detector = new OnsetDetector(note => ends.push(note)), mask = new SelfMask();
    detector.accepts = note => !mask.drops(note);
    mask.arm(0.4,0.3,64);
    const notes = [];
    for (let i=0;i<60;i++) {
      if (i === 20) detector.attack(0.4);
      const output = i >= 20 && i < 35, quiet = i >= 50;
      const note = detector.process(i*0.02,{hz:output ? 329.6276 : 220,confidence:0.9},quiet ? 0 : 0.02);
      if (note) notes.push(note);
    }
    expect(notes).toHaveLength(1); expect(notes[0].hz).toBe(220);
    expect(ends).toEqual([{t:0,end:1}]);
  });
  it('keeps a short rest when pitch inference skips its frames', () => {
    const ends: NoteEnd[] = [], detector = new OnsetDetector(note => ends.push(note));
    for (let i=0;i<=4;i++) detector.process(i*0.02,{hz:220,confidence:0.9},0.02);
    for (let i=5;i<=16;i++) detector.observeLevel(i*0.02,i<10 ? 0.02 : 0);
    // A delayed older result cannot rewrite the newer energy evidence.
    detector.process(0.16,{hz:220,confidence:0.9},0.02);
    expect(ends).toEqual([{t:0,end:0.2}]);
    detector.attack(0.36);
    for (let i=18;i<=23;i++) detector.process(i*0.02,{hz:261.63,confidence:0.9},0.02);
    detector.reset(0.6);
    expect(ends.at(-1)).toEqual({t:0.36,end:0.6});
  });
  it.each([82.41,220,329.63])('finds individual %s Hz plucks without retriggering on a modulated decay', hz => {
    const rate = 48000, detector = new AttackDetector(rate), attacks: number[] = [];
    for (let block=0;block<rate*3;block+=128) {
      const input = Float32Array.from({length:128},(_,i) => {
        const t = (block+i)/rate, age = t%1;
        const envelope = Math.min(1,age/0.006)*Math.exp(-age*4);
        return envelope*(1+0.15*Math.sin(t*35))*0.15*(Math.sin(2*Math.PI*hz*t)+0.3*Math.sin(4*Math.PI*hz*t));
      });
      if (detector.process(input,block/rate)) attacks.push(block/rate);
    }
    expect(attacks).toHaveLength(3);
    attacks.forEach((t,i) => expect(Math.abs(t-i)).toBeLessThan(0.025));
  });
});
