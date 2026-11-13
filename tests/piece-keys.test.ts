import { expect, it } from 'vitest';
import { gradeKeys, type KeyPress } from '../src/piece/grade';
import { toEvents, type Exercise } from '../src/piece/exercise';
import { baseFor, keyLabels, keyMap } from '../src/piece/keys';
import { WaitRun } from '../src/piece/wait';

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

it('wait mode stops at each attack until its keys are played', () => {
  const run = new WaitRun(ex, 60);
  expect(run.beat).toBe(-2);
  // Other keys long before the notes arrive are ignored, so finding the hand position costs nothing.
  expect(run.press(65)).toBe('ignored'); expect(run.mistakes).toBe(0);
  run.step(10);
  expect(run.beat).toBe(0); expect(run.waiting).toBe(true); expect(run.needed).toEqual([60]);
  run.step(5); expect(run.beat).toBe(0);
  expect(run.press(61)).toBe('wrong'); expect(run.mistakes).toBe(1);
  expect(run.press(60)).toBe('hit'); expect(run.waiting).toBe(false);
  run.step(1); expect(run.press(62)).toBe('hit');
  // A chord needs every key; a key pressed up to a beat early counts.
  run.press(60); run.step(1); run.press(67);
  expect(run.waiting).toBe(true); expect(run.needed).toEqual([64]);
  run.press(64); run.step(5);
  expect(run.done).toBe(true);
  expect(run.summary()).toMatchObject({ notes: 5, mistakes: 1 });
});

it('wait mode lets the player lead and catches the lane up', () => {
  const run = new WaitRun(ex, 60);
  // Play the first two attacks during the lead-in, before the lane gets there.
  expect(run.press(60)).toBe('hit'); expect(run.press(62)).toBe('hit');
  expect(run.current?.beat).toBe(2);
  let t = 0; while (run.beat < 2 && t < 10) { run.step(0.02); t += 0.02; }
  // Four beats of lane at 60 BPM would take 4 s at tempo; catching up is much faster.
  expect(t).toBeLessThan(2);
  expect(run.waiting).toBe(true);
});
