import { describe, expect, it } from 'vitest';
import { ScaleTracker, guessScale } from '../src/music/scales';
import { midiToHz, pitchClass } from '../src/music/notes';
const note = (midi: number, t = 0, cents = 0) => ({ midi, hz: midiToHz(midi), pitchClass: pitchClass(midi), t, cents, confidence: 0.9 });
describe('scale inference', () => {
  it('recognizes the A minor pentatonic set, reinforced by A and E', () => {
    const tracker = new ScaleTracker();
    [57,60,62,64,67,69].forEach(midi => tracker.add(note(midi), true));
    expect(['minor pentatonic','major pentatonic']).toContain(tracker.guess?.id);
    [57,57,64,64].forEach(midi => tracker.add(note(midi), true));
    expect(tracker.guess).toMatchObject({ tonic: 9, id: 'minor pentatonic' });
  });
  it('recognizes blues instead of major', () => {
    const tracker = new ScaleTracker();
    [57,60,62,63,64,67,57].forEach(midi => tracker.add(note(midi), true));
    expect(tracker.guess).toMatchObject({ tonic: 9, id: 'blues' });
  });
  it('halves histogram mass in four seconds and applies off-grid/cents gates', () => {
    const tracker = new ScaleTracker(); tracker.add(note(57), true); tracker.decay(4);
    expect(tracker.histogram[9]).toBeCloseTo(0.5);
    tracker.add(note(60,4), false); expect(tracker.histogram[0]).toBe(0.4);
    tracker.add(note(61,4,41), true); expect(tracker.histogram[1]).toBe(0); expect(tracker.onsetCount).toBe(2);
  });
  it('freezes the voice scale while the guess continues and requires six onsets', () => {
    const tracker = new ScaleTracker(); tracker.add(note(57), true); tracker.toggleLock();
    const locked = tracker.locked; expect(tracker.ready).toBe(false);
    [60,62,64,67,69].forEach(midi => tracker.add(note(midi), true)); expect(tracker.ready).toBe(true);
    for (let i=0;i<20;i++) tracker.add(note(66,10), true);
    expect(tracker.active).toBe(locked); expect(tracker.guess?.tonic).toBe(6);
    tracker.toggleLock(); expect(tracker.locked).toBeNull();
  });
  it('preserves the specified confidence formula even when superset templates tie', () => {
    const mass = new Float64Array(12); mass[9] = 3; mass[0] = mass[2] = mass[4] = mass[7] = 1;
    expect(guessScale(mass)?.confidence).toBe(0);
  });
});
