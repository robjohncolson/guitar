import { expect, it } from 'vitest';
import type { Exercise } from '../src/piece/exercise';
import type { EventResult, NoteResult, PieceGrade } from '../src/piece/grade';
import type { Unit } from '../src/piece/curriculum';
import type { Score } from '../src/piece/score';
import { barsText, isSpotId, pickSpot, problemBars, slowerBpm, spotExercise, spotId, spotOffered } from '../src/piece/spot';

/** An exercise of n four-beat bars with a right-hand and a left-hand note on every beat 0 and 2 of each bar. */
const exercise = (n: number): Exercise => ({
  id: 'x', title: 'x', instrument: 'piano', beatsPerBar: 4, beats: n * 4, keySig: 0, chords: [],
  bars: Array.from({ length: n }, (_, i) => ({ beat: i * 4, number: i + 1 })),
  events: Array.from({ length: n * 2 }, (_, i) => ({ beat: i * 2, grade: 'pitch' as const, notes: [{ midi: 40, hand: 'L' as const, dur: 1 }, { midi: 64, hand: 'R' as const, dur: 1 }] })),
});
const note = (midi: number, verdict: NoteResult['verdict'] = 'heard'): NoteResult => ({ midi, verdict, reason: '' });
const good = (beat: number): EventResult => ({ index: 0, beat, mark: 'good', notes: [note(40), note(64)] });
const grade = (events: EventResult[]) => ({ events }) as unknown as PieceGrade;
/** All events of an n-bar exercise, good except for the overrides keyed by beat. */
const take = (n: number, over: Record<number, Partial<EventResult>>) => grade(Array.from({ length: n * 2 }, (_, i) => ({ ...good(i * 2), index: i, ...over[i * 2] }) as EventResult));
const wrongR = (beat: number): Record<number, Partial<EventResult>> => ({ [beat]: { notes: [note(40), note(64, 'wrong')] } });
const missed = (beat: number): Record<number, Partial<EventResult>> => ({ [beat]: { mark: 'missed' } });

it('picks a cluster of adjacent problem bars with a lead-in bar and the hand that struggled', () => {
  const ex = exercise(8), r = take(8, { ...wrongR(12), ...wrongR(16) });
  expect(problemBars(ex, r, true).get(3)).toEqual({ count: 1, L: 0, R: 1 });
  expect(pickSpot(ex, r, true)).toEqual({ from: 2, to: 4, lead: true, hand: 'R' });
});

it('picks the left hand when its notes are the problem', () => {
  const r = take(8, { 12: { notes: [note(40, 'not-heard'), note(64)] } });
  expect(pickSpot(exercise(8), r, true)).toEqual({ from: 2, to: 3, lead: true, hand: 'L' });
});

it('keeps one clean bar between problem bars in one cluster, and picks the heavier of two clusters', () => {
  const ex = exercise(12);
  expect(pickSpot(ex, take(12, { ...wrongR(8), ...wrongR(16) }), true)).toEqual({ from: 1, to: 4, lead: true, hand: 'R' });
  const two = take(12, { ...wrongR(4), ...wrongR(36), ...missed(38), ...wrongR(40) });
  expect(pickSpot(ex, two, true)).toEqual({ from: 8, to: 10, lead: true, hand: 'R' });
});

it('ignores unsure and unclear events, and asks to choose when most of the take is unclear', () => {
  const unsure = take(8, { 8: { mark: 'unsure' }, 12: { mark: 'unsure' } });
  expect(pickSpot(exercise(8), unsure, true)).toBeUndefined();
  const unclear = take(8, { 8: { notes: [note(40, 'unclear'), note(64, 'unclear')] } });
  expect(pickSpot(exercise(8), unclear, true)).toBeUndefined();
  const most = take(8, Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i * 2, { mark: 'unsure' as const }])));
  expect(pickSpot(exercise(8), most, true)).toBe('choose');
});

it('counts early and late only when timing is judged', () => {
  const r = take(8, { 16: { mark: 'late' }, 20: { mark: 'early' } });
  expect(pickSpot(exercise(8), r, false)).toBeUndefined();
  expect(pickSpot(exercise(8), r, true)).toEqual({ from: 3, to: 5, lead: true, hand: 'R' });
});

it('has no lead-in when the problem is in the first bar, and drops it when it would cover the whole take', () => {
  expect(pickSpot(exercise(8), take(8, wrongR(0)), true)).toEqual({ from: 0, to: 0, lead: false, hand: 'R' });
  expect(pickSpot(exercise(2), take(2, wrongR(4)), true)).toEqual({ from: 1, to: 1, lead: false, hand: 'R' });
  expect(pickSpot(exercise(3), take(3, wrongR(4)), true)).toEqual({ from: 0, to: 1, lead: true, hand: 'R' });
});

it('gives no spot when nothing, or more than half of the bars, are in trouble, or the cluster is too wide', () => {
  expect(pickSpot(exercise(8), take(8, {}), true)).toBeUndefined();
  expect(pickSpot(exercise(8), take(8, { ...wrongR(0), ...wrongR(4), ...wrongR(8), ...wrongR(12), ...wrongR(16) }), true)).toBeUndefined();
  expect(pickSpot(exercise(8), take(8, { ...wrongR(0), ...wrongR(8), ...wrongR(16), ...wrongR(24) }), true)).toBeUndefined();
  expect(pickSpot(exercise(8), take(8, { ...wrongR(0), ...wrongR(8), ...wrongR(16) }), true)).toBeUndefined();
});

const score = {
  ppq: 480, notes: [0, 1, 2, 3].map(bar => ({ id: bar, bar, tick: 0, dur: 480, midi: 60 + bar, hand: 'R', staff: 1, voice: 'v' })),
  bars: [0, 1, 2, 3].map(i => ({ index: i, number: i + 10, ticks: 1920, num: 4, den: 4, key: 0, start: i * 1920, harmony: [] })),
} as unknown as Score;
const unit = (over: Partial<Unit> = {}): Unit => ({
  id: 'R:1-4', kind: 'hand', stage: 4, title: 'Right hand', goal: '', why: '', bars: [0, 1, 2, 3, 0, 1, 2, 3], hands: ['R'], requires: [],
  rungs: [0.5, 0.7, 1], certify: [], goalBpm: 60, ...over,
});

it('builds a spot take from play-order positions, numbering bars from the score', () => {
  const ex = spotExercise(score, unit(), 2, 5, ['R']);
  expect(ex.id).toBe(spotId('R:1-4', 2, 5, ['R']));
  expect(isSpotId(ex.id)).toBe(true);
  expect(isSpotId('R:1-4')).toBe(false);
  expect(ex.bars.map(b => b.number)).toEqual([12, 13, 10, 11]);
  expect(ex.events.map(e => e.notes[0].midi)).toEqual([62, 63, 60, 61]);
  expect(ex.title).toBe('Right hand: bars 12, 13, 10, 11');
  expect(spotExercise(score, unit(), 1, 2, ['R']).title).toBe('Right hand: bars 11–12');
});

it('chooses a slower tempo from the rungs, or 15% slower below them', () => {
  expect(slowerBpm(unit(), 60)).toBe(42);
  expect(slowerBpm(unit(), 42)).toBe(30);
  expect(slowerBpm(unit(), 31)).toBe(30);
  expect(slowerBpm(unit(), 30)).toBe(26);
  expect(slowerBpm(unit(), 20)).toBe(20);
});

it('words bar runs', () => {
  expect(barsText([3])).toBe('bar 3');
  expect(barsText([3, 4])).toBe('bars 3–4');
  expect(barsText([8, 1])).toBe('bars 8, 1');
});

it('offers spots only for piano passages of two or more bars', () => {
  expect(spotOffered('piano', unit())).toBe(true);
  expect(spotOffered('guitar', unit())).toBe(false);
  expect(spotOffered('piano', unit({ kind: 'chord' }))).toBe(false);
  expect(spotOffered('piano', unit({ kind: 'listen' }))).toBe(false);
  expect(spotOffered('piano', unit({ bars: [0] }))).toBe(false);
  expect(spotOffered('piano', unit({ drill: {} as Unit['drill'] }))).toBe(false);
});
