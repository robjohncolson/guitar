import { describe, expect, it } from 'vitest';
import { Repeater } from '../src/music/repeater';
import { OnsetDetector } from '../src/audio/onset';
import { SelfMask } from '../src/audio/self-mask';
import { centsOffset, hzToMidi, midiToHz, pitchClass } from '../src/music/notes';
const note = (t: number, hz = 220) => {
  const midi = hzToMidi(hz);
  return { t,hz,midi:Math.round(midi),pitchClass:pitchClass(midi),cents:centsOffset(midi),confidence:0.9 };
};
describe('two-beat repeater', () => {
  it('answers the very first note exactly two beats after its attack, retaining its tuning', () => {
    const repeater = new Repeater(); repeater.setTempo(120);
    expect(repeater.accept(note(5.13,221.7))).toBe(true);
    expect(repeater.pending).toBe(1);
    expect(repeater.takeDue(6,0.04)).toHaveLength(0);
    const [echo] = repeater.takeDue(6.02,0.04);
    expect(echo.at).toBeCloseTo(6.13); expect(echo.fireAt).toBeCloseTo(6.09);
    expect(midiToHz(echo.midi)).toBeCloseTo(221.7);
    expect(repeater.takeDue(6.1,0.04)).toHaveLength(0);
  });
  it.each([40,80,100,120,240])('uses two beats at %i BPM without quantizing the player', bpm => {
    const repeater = new Repeater(); repeater.setTempo(bpm); repeater.accept(note(1.123));
    expect(repeater.next?.at).toBeCloseTo(1.123+120/bpm);
  });
  it('keeps every attack in order even when another player note coincides with a repeat', () => {
    const repeater = new Repeater(); repeater.setTempo(120);
    repeater.accept(note(1,220)); repeater.accept(note(1.2,330)); repeater.accept(note(2,440));
    expect(repeater.takeDue(2,0).map(echo => echo.hz)).toEqual([220]);
    expect(repeater.takeDue(2.2,0).map(echo => echo.hz)).toEqual([330]);
    expect(repeater.takeDue(3,0).map(echo => echo.hz)).toEqual([440]);
  });
  it('a ringing note queues one repeat', () => {
    const detector = new OnsetDetector(), repeater = new Repeater();
    for (let i=0;i<100;i++) {
      const onset = detector.process(i*0.02,{hz:220,confidence:0.9});
      if (onset) repeater.accept(onset);
    }
    expect(repeater.onsetCount).toBe(1); expect(repeater.pending).toBe(1);
  });
  it('does not recursively echo its own output, but accepts a different player pitch', () => {
    const repeater = new Repeater(); repeater.setTempo(120); repeater.accept(note(1));
    const [echo] = repeater.takeDue(1.94,0.04); repeater.scheduled(echo,0.04);
    expect(repeater.accept(note(2.02))).toBe(false); expect(repeater.pending).toBe(0);
    expect(repeater.accept(note(2.03,330))).toBe(true); expect(repeater.pending).toBe(1);
    expect(repeater.onsetCount).toBe(2);
  });
  it('mute/panic clears pending repeats and unmuting never revives them', () => {
    const repeater = new Repeater(); repeater.accept(note(1)); repeater.setMuted(true);
    repeater.accept(note(2)); expect(repeater.pending).toBe(0);
    repeater.setMuted(false); expect(repeater.takeDue(3,0)).toEqual([]);
    repeater.accept(note(4)); expect(repeater.pending).toBe(1);
  });
  it('a BPM change cancels old delays and invalid values leave the clock alone', () => {
    const repeater = new Repeater(); repeater.accept(note(1)); repeater.setTempo(80);
    expect(repeater.pending).toBe(0); repeater.accept(note(2)); expect(repeater.next?.at).toBe(3.5);
    expect(() => repeater.setTempo(NaN)).toThrow(); expect(repeater.bpm).toBe(80);
  });
  it('skips stale echoes instead of bunching them up after a stalled tab', () => {
    const repeater = new Repeater(); repeater.setTempo(120); repeater.accept(note(1));
    expect(repeater.takeDue(2.1,0.04)).toEqual([]); expect(repeater.pending).toBe(0);
  });
  it('allows the specified 15 ms late tolerance and masks the actual audible start', () => {
    const repeater = new Repeater(); repeater.setTempo(120); repeater.accept(note(1));
    const [echo] = repeater.takeDue(1.97,0.04); expect(echo.fireAt).toBe(1.97);
    repeater.scheduled(echo,0.04); expect(repeater.mask.drops(note(2.015))).toBe(true);
  });
});
it('self-mask expires and distinguishes pitches within 50 cents', () => {
  const mask = new SelfMask(); mask.arm(1,0.3,64);
  expect(mask.drops(note(1.37,midiToHz(64.49)))).toBe(true);
  expect(mask.drops(note(1.2,midiToHz(64.51)))).toBe(false);
  expect(mask.drops(note(1.4,midiToHz(64)))).toBe(false);
});
