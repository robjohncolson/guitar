import { expect, it } from 'vitest';
import { planHarmony } from '../src/music/harmony';
import { midiToHz, pitchClass } from '../src/music/notes';
const phrase = (midis:number[],offsets = midis.map((_,i)=>i*0.5),duration = 0.2,beats = 5) => ({beats,notes:midis.map((midi,i) =>
  ({t:offsets[i],hz:midiToHz(midi),midi,pitchClass:pitchClass(midi),cents:0,confidence:0.9,velocity:0.6,duration}))});

it('answers A-C-E with C-E-G, using both minor and major thirds', () => {
  const source = phrase([57,60,64],[0,0.5,1.5]), plan = planHarmony(source,0.5);
  expect(plan.kind).toBe('harmony'); expect(plan.midis).toEqual([60,64,67]);
  expect(source.notes.map(note=>note.midi)).toEqual([57,60,64]);
});
it.each(Array.from({length:12},(_,i)=>i))('recognizes major and minor phrase colors after transposition %s', transpose => {
  for (const third of [3,4]) {
    const plan = planHarmony(phrase([48+transpose,48+transpose+third,55+transpose]),0.5);
    expect(plan.kind).toBe('harmony');
    expect(plan.midis.some((midi,i)=>pitchClass(midi) !== pitchClass([48+transpose,48+transpose+third,55+transpose][i]))).toBe(true);
    expect(plan.midis.every(midi => midi>=48 && midi<=84)).toBe(true);
  }
});
it('uses a softer octave reply for two-note, ambiguous, and chromatic evidence', () => {
  for (const pitches of [[57,64],[60,62,64],[60,61,62,63]]) {
    const plan = planHarmony(phrase(pitches),0.5);
    expect(plan.kind).toBe('octave'); expect(plan.midis).toEqual(pitches.map(midi=>midi+12));
    expect(plan.gain).toBeLessThan(planHarmony(phrase([57,60,64]),0.5).gain);
  }
});
it('preserves the guitar tuning and chooses a line once', () => {
  const source = phrase([57.12,60.12,64.12]);
  const plan = planHarmony(source,0.5);
  plan.midis.forEach(midi=>expect(midi-Math.round(midi)).toBeCloseTo(0.12));
  expect(planHarmony(source,0.5)).toEqual(plan);
  expect(Object.isFrozen(plan.midis)).toBe(true);
});
it('smooths octave leaps into a comfortable connected register', () => {
  const plan = planHarmony(phrase([45,72,52,69,60,76]),0.5);
  expect(plan.kind).toBe('harmony');
  plan.midis.slice(1).forEach((midi,i)=>expect(Math.abs(midi-plan.midis[i])).toBeLessThanOrEqual(9));
});
it('accounts for the guitar sounding at the half-beat landing, including note tails', () => {
  const source = phrase([57,60,64,65],[0,0.5,1,1.25],0.5,4);
  const plan = planHarmony(source,0.5);
  expect(plan.kind).toBe('harmony');
  // A blind third above E would be G, rubbing against the F that starts when it lands.
  expect(pitchClass(plan.midis[2])).not.toBe(7);
  expect([0,3,4,7,8,9]).toContain((pitchClass(plan.midis[2])-5+12)%12);
  const rested = {...source,notes:source.notes.map((note,i)=>({...note,duration:i===3 ? 0.02 : 0.1}))};
  expect(planHarmony(rested,0.5).midis).not.toEqual(plan.midis);
});
