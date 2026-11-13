import { expect, it } from 'vitest';
import { gradeKeys, type KeyPress } from '../src/piece/grade';
import { toEvents, type Exercise } from '../src/piece/exercise';
import { baseFor, keyLabels, keyMap } from '../src/piece/keys';

// Two beats of single notes, then a C major chord on beat 3, at 60 BPM (one second per beat).
const ex: Exercise = {
  id: 'k', title: 'k', instrument: 'piano', beatsPerBar: 4, beats: 4, keySig: 0, bars: [{ beat: 0, number: 1 }], chords: [],
  events: toEvents([
    { beat: 0, midi: 60, hand: 'R', dur: 1 }, { beat: 1, midi: 62, hand: 'R', dur: 1 },
    { beat: 2, midi: 60, hand: 'R', dur: 2 }, { beat: 2, midi: 64, hand: 'R', dur: 2 }, { beat: 2, midi: 67, hand: 'R', dur: 2 },
  ]),
};
const press = (t: number, midi: number): KeyPress => ({ t, midi });

it('grades exact keys on time as a clean take', () => {
  const r = gradeKeys(ex, 60, [press(0.01, 60), press(1.02, 62), press(1.99, 60), press(2.01, 64), press(2.03, 67)]);
  expect(r.trusted).toBe(true);
  expect(r.events.map(e => e.mark)).toEqual(['good', 'good', 'good']);
  expect(r.timing).toBe(1); expect(r.pitch).toBe(1); expect(r.extras).toBe(0);
});

it('names a neighbouring wrong key and a missing chord tone', () => {
  const r = gradeKeys(ex, 60, [press(0, 60), press(1, 63), press(2, 60), press(2.02, 67)]);
  expect(r.events[1].notes[0]).toMatchObject({ verdict: 'wrong', heardAs: 63 });
  expect(r.events[2].notes.find(n => n.midi === 64)?.verdict).toBe('not-heard');
  expect(r.pitch).toBeCloseTo(3 / 5);
  expect(r.feedback).toMatch(/you played D♯4 instead of D4/);
});

it('marks late and missed attacks and counts stray attacks as extras', () => {
  const r = gradeKeys(ex, 60, [press(0.3, 60), press(2, 60), press(2, 64), press(2, 67), press(3.5, 72)]);
  expect(r.events.map(e => e.mark)).toEqual(['late', 'missed', 'good']);
  expect(r.extras).toBe(1);
});

it('does not score a take with no key presses', () => {
  const r = gradeKeys(ex, 60, []);
  expect(r.trusted).toBe(false);
  expect(r.reason).toMatch(/No keys/);
});

it('maps the two computer-key rows to piano pitches from a C', () => {
  const map = keyMap(48);
  expect(map.get('KeyZ')).toBe(48); expect(map.get('KeyS')).toBe(49); expect(map.get('KeyM')).toBe(59);
  expect(map.get('KeyQ')).toBe(60); expect(map.get('Digit2')).toBe(61); expect(map.get('BracketRight')).toBe(79);
  const labels = keyLabels(48);
  expect(labels.get(48)).toBe('Z'); expect(labels.get(60)).toBe('Q'); expect(labels.get(66)).toBe('5');
  expect(baseFor([62, 57, 74])).toBe(48);
});
