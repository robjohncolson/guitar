import { describe, expect, it } from 'vitest';
import { MotifListener } from '../src/music/motif';
import { hzToMidi, midiToHz, pitchClass } from '../src/music/notes';
const note = (t: number,midi: number) => ({t,hz:midiToHz(midi),midi,pitchClass:pitchClass(midi),cents:0,confidence:0.9,velocity:0.7});

describe('listening for a repeated musical phrase', () => {
  it('stays uncommitted through two passes, then recognizes the third without a setup bar', () => {
    const listener = new MotifListener(0.5);
    for (let pass=0;pass<3;pass++) {
      [57,60,64].forEach((midi,i) => listener.record(note(0.17+pass*2+i*0.5,midi)));
      listener.advance(0.17+(pass+1)*2);
      expect(Boolean(listener.motif)).toBe(pass === 2);
    }
    expect(listener.motif?.beats).toBe(4);
    expect(listener.motif?.notes.map(n => n.pitchClass)).toEqual([9,0,4]);
  });
  it.each([0.25,0.5,1.5])('tolerates human timing, tuning and octave differences at period %s', period => {
    const listener = new MotifListener(period);
    for (let pass=0;pass<3;pass++) [57,60,64,67].forEach((midi,i) =>
      listener.record(note((0.3+pass*4+i*0.8+(pass === 1 ? i*0.04 : 0))*period,midi+(pass === 1 ? 12 : 0)+0.08)));
    listener.advance(12.3*period);
    expect(listener.motif?.beats).toBeCloseTo(4);
  });
  it('does not mistake the same notes in a different order or rhythm for a repeated phrase', () => {
    const listener = new MotifListener(0.5);
    [[57,60,64],[60,57,64],[57,64,60]].forEach((phrase,pass) => phrase.forEach((midi,i) => listener.record(note(pass*2+i*0.5,midi))));
    listener.advance(6);
    expect(listener.motif).toBeUndefined();
    const rhythm = new MotifListener(0.5);
    [[0,0.5,1],[2,2.1,3.5],[4,4.7,5]].forEach(times => times.forEach((t,i) => rhythm.record(note(t,[57,60,64][i]))));
    rhythm.advance(6);
    expect(rhythm.motif).toBeUndefined();
  });
  it('does not treat isolated notes, a drone, or three phrases separated by long pauses as a commitment', () => {
    const listener = new MotifListener(0.5);
    for (let i=0;i<30;i++) listener.record(note(i*0.5,57));
    expect(listener.motif).toBeUndefined();
    const gaps = new MotifListener(0.5);
    for (let pass=0;pass<3;pass++) [57,60,64].forEach((midi,i) => gaps.record(note(pass*20+i*0.5,midi)));
    expect(gaps.motif).toBeUndefined();
  });
  it('finds a longer phrase after unrelated warmup notes and freezes it during improvisation', () => {
    const listener = new MotifListener(0.5);
    [61,63,58,66].forEach((midi,i) => listener.record(note(i*0.3,midi)));
    for (let pass=0;pass<3;pass++) [57,60,62,64,67,64].forEach((midi,i) => listener.record(note(2+pass*4+i*0.5,midi)));
    listener.advance(14);
    expect(listener.motif?.notes).toHaveLength(6);
    expect(listener.motif?.beats).toBe(8);
    const held = listener.motif;
    for (let i=0;i<30;i++) listener.record(note(15+i*0.2,70+i%3));
    expect(listener.motif).toBe(held);
  });
  it('uses agreement across three passes to discard one wrong pitch in a longer phrase', () => {
    const listener = new MotifListener(0.5);
    for (let pass=0;pass<3;pass++) [57,60,62,64,67].forEach((midi,i) => listener.record(note(pass*4+i*0.5,pass === 2 && i === 2 ? 63 : midi)));
    listener.advance(12);
    expect(listener.motif?.notes.map(n => Math.round(hzToMidi(n.hz)))).toEqual([57,60,62,64,67]);
  });
  it('waits through the closing rest of a five-beat loop and preserves internal and final gaps', () => {
    const listener = new MotifListener(0.5);
    for (let pass=0;pass<3;pass++) [0,0.5,1.5].forEach((offset,i) => listener.record({...note(pass*2.5+offset,[57,60,64][i]),duration:0.2}));
    listener.advance(7.3); expect(listener.motif).toBeUndefined();
    listener.advance(7.5);
    expect(listener.motif?.beats).toBe(5);
    expect(listener.motif?.rests).toHaveLength(3);
    expect(listener.motif?.rests?.at(-1)?.offset).toBeCloseTo(1.7);
    expect(listener.motif?.rests?.at(-1)?.duration).toBeCloseTo(0.8);
  });
  it.each(['missed','extra'])('recognizes a loop despite one %s attack in its middle performance', error => {
    const listener = new MotifListener(0.5);
    for (let pass=0;pass<3;pass++) [57,60,64,67].forEach((midi,i) => {
      if (!(pass === 1 && i === 0 && error === 'missed')) listener.record({...note(pass*3+i*0.5,midi),duration:0.2});
      if (pass === 1 && i === 1 && error === 'extra') listener.record({...note(pass*3+0.75,66),duration:0.1});
    });
    listener.advance(9);
    expect(listener.motif?.notes.map(n => n.midi)).toEqual([57,60,64,67]);
    expect(listener.motif?.beats).toBe(6);
  });
  it('does not call three different articulation/rest patterns the same loop', () => {
    const listener = new MotifListener(0.5);
    for (let pass=0;pass<3;pass++) [57,60,64].forEach((midi,i) => listener.record({...note(pass*3+i,midi),duration:[0.1,0.45,0.9][pass]}));
    listener.advance(9); expect(listener.motif).toBeUndefined();
  });
  it('supports a two-note idea and keeps the first new note arriving at the loop boundary', () => {
    const listener = new MotifListener(0.5);
    for (let pass=0;pass<3;pass++) [57,60].forEach((midi,i) => listener.record({...note(pass*1.5+i*0.5,midi),duration:0.2}));
    listener.record(note(4.5,64));
    expect(listener.motif?.beats).toBe(3); expect(listener.remainder.map(n => n.midi)).toEqual([64]);
  });
  it('does not find loops in a long stream of unrelated plucks', () => {
    const listener = new MotifListener(0.5); let seed = 91827, t = 0;
    const random = () => { seed = (Math.imul(seed,1664525)+1013904223) >>> 0; return seed/2**32; };
    for (let i=0;i<180;i++) {
      t += 0.18+random()*0.75;
      listener.record({...note(t,48+Math.floor(random()*24)),duration:0.06+random()*0.1});
      listener.advance(t+0.15);
      expect(listener.motif).toBeUndefined();
    }
  });
});
