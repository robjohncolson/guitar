import { describe, expect, it } from 'vitest';
import { chooseHarmony } from '../src/music/harmony';
import { Companion } from '../src/music/companion';
import { midiToHz, pitchClass } from '../src/music/notes';
const note = (t: number,midi: number) => ({t,hz:midiToHz(midi),midi,pitchClass:pitchClass(midi),cents:0,confidence:0.9,velocity:0.7});
const phrase = (midis: number[]) => midis.map((midi,i) => note(i*0.5,midi));
function established(): Companion {
  const partner = new Companion(); partner.reset(0,0.5);
  for (let pass=0;pass<3;pass++) [57,60,64].forEach((midi,i) => partner.accept(note(pass*2+i*0.5,midi)));
  return partner;
}

describe('harmonic judgement', () => {
  it.each([[ [57,60,64],'Am'],[[60,64,67],'C'],[[57,60,62,64,67],'Am7'],[[60,62,64,67,69],'C6']] as const)('supports %j with %s', (midis,label) => {
    const harmony = chooseHarmony(phrase([...midis]));
    expect(harmony?.label).toBe(label);
    expect(harmony?.midis.every(midi => midis.some(source => pitchClass(source) === pitchClass(midi)))).toBe(true);
    expect(harmony!.midis.every(midi => midi >= 40 && midi <= 76)).toBe(true);
  });
  it('keeps listening when a third/fifth is missing or the notes do not establish a clear harmony', () => {
    expect(chooseHarmony(phrase([57,64,57]))).toBeUndefined();
    expect(chooseHarmony(phrase(Array.from({length:12},(_,i) => 48+i)))).toBeUndefined();
    expect(chooseHarmony(phrase([57,58,59]))).toBeUndefined();
  });
});
describe('a companion that earns its entrance', () => {
  it('lays down no notes before the third phrase, then enters together on the next downbeat', () => {
    const partner = new Companion(); partner.reset(0,0.5);
    for (let pass=0;pass<2;pass++) [57,60,64].forEach((midi,i) => {
      const t = pass*2+i*0.5; partner.accept(note(t,midi)); expect(partner.takeDue(t+0.1,0.04)).toEqual([]);
    });
    [57,60,64].forEach((midi,i) => partner.accept(note(4+i*0.5,midi)));
    expect(partner.takeDue(5.1,0.04)).toEqual([]); expect(partner.active?.startAt).toBe(6);
    const chord = partner.takeDue(5.9,0.04);
    expect(chord).toHaveLength(3); expect(chord.every(n => n.at === 6 && n.fireAt === 5.96)).toBe(true);
    expect(partner.active?.harmony.label).toBe('Am'); expect(partner.takeDue(5.95,0.04)).toEqual([]);
  });
  it('holds one stable harmony through improvisation and preserves phase through mute', () => {
    const partner = established(); partner.takeDue(5.1,0);
    const held = partner.active;
    [61,63,66,70].forEach((midi,i) => partner.accept(note(5.2+i*0.1,midi)));
    expect(partner.active).toBe(held);
    partner.setMuted(true); expect(partner.takeDue(6,0)).toEqual([]);
    partner.setMuted(false); const notes = partner.takeDue(26,0);
    expect(notes).toHaveLength(3); expect(notes.every(note => note.at === 26)).toBe(true);
  });
  it('never bunches stale chords up or ignores high output latency', () => {
    const partner = established(); partner.takeDue(5.95,0.2);
    expect(partner.active?.startAt).toBe(8); expect(partner.takeDue(7.8,0.2)).toHaveLength(3);
    expect(partner.takeDue(20.4,0.2)).toEqual([]); expect(partner.takeDue(21.8,0.2)).toHaveLength(3);
  });
  it('masks every chord voice and its octave while allowing unrelated player notes', () => {
    const partner = established(); partner.takeDue(5.1,0.04);
    const notes = partner.takeDue(5.9,0.04); notes.forEach(n => partner.scheduled(n,0.04));
    for (const voice of notes) {
      expect(partner.accept(note(6.1,voice.midi))).toBe(false);
      expect(partner.accept(note(6.1,voice.midi+12))).toBe(false);
    }
    expect(partner.accept(note(6.1,66))).toBe(true);
    partner.reset(0,0.5,7); expect(partner.takeDue(8,0)).toEqual([]);
    expect(partner.accept(note(6.9,66))).toBe(false); expect(partner.listener.repetitions).toBe(0);
  });
  it('releases a stopped chord mask after its short room tail so new listening can begin', () => {
    const partner = established(); partner.takeDue(5.1,0.04);
    const chord = partner.takeDue(5.9,0.04); chord.forEach(n => partner.scheduled(n,0.04));
    partner.mask.release(6.2);
    expect(partner.accept(note(6.25,chord[0].midi))).toBe(false);
    expect(partner.accept(note(6.3,chord[0].midi))).toBe(true);
  });
  it('can recognize a clearer new phrase after an ambiguous repeated idea', () => {
    const partner = new Companion(); partner.reset(0,0.5);
    for (let pass=0;pass<3;pass++) [57,58,59].forEach((midi,i) => partner.accept(note(pass*2+i*0.5,midi)));
    expect(partner.unclear).toBe(true); expect(partner.takeDue(5.1,0)).toEqual([]);
    for (let pass=0;pass<3;pass++) [57,60,64].forEach((midi,i) => partner.accept(note(6+pass*2+i*0.5,midi)));
    partner.takeDue(11.1,0); expect(partner.active?.harmony.label).toBe('Am');
  });
});
