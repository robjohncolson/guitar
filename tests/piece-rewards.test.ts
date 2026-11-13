import { expect, it } from 'vitest';
import gymnopedie from '../src/piece/packs/gymnopedie-1.piece.txt?raw';
import { compile } from '../src/piece/notation';
import { buildCurriculum, type Unit } from '../src/piece/curriculum';
import { advanceUnit, DAY, initialUnit, parsePieceProgress, type UnitProgress } from '../src/piece/progress';
import { bestKey, compareTake, keyStats, pruneBests, tightness, timingSummary } from '../src/piece/bests';
import type { EventResult } from '../src/piece/grade';

const curriculum = buildCurriculum(compile(gymnopedie).score!);
const unit = (id: string) => curriculum.units.find(u => u.id === id)!;
const take = (score: number, trusted = true) => ({ score, trusted });

it('reports a structured event for each ladder outcome without changing the outcome', () => {
  const u = unit('LR:5-8'), now = Date.UTC(2026, 10, 11, 18);
  let p: UnitProgress = initialUnit();
  const kinds: string[] = [];
  const step = (score: number, comfortable = true, at = now, calibrated = true, trusted = true) => {
    const r = advanceUnit(u, p, take(score, trusted), comfortable, at, calibrated); kinds.push(r.event.kind); p = r.progress; return r;
  };
  expect(step(0.2, false, now, true, false).event).toEqual({ kind: 'uncounted', clean: false, overnight: false });
  expect(step(1, true, now, false).event.kind).toBe('uncounted');
  expect(step(0.95).event).toEqual({ kind: 'hold', clean: true, overnight: false });
  expect(step(0.95).event.kind).toBe('climb');
  expect(step(0.7).event).toEqual({ kind: 'hold', clean: false, overnight: false });
  expect(step(0.5).event.kind).toBe('hold');
  expect(step(0.5).event.kind).toBe('step-down');
  for (let i = 0; i < 6; i++) step(1);
  expect(p.rung).toBe(3);
  expect([step(1).event.kind, step(1).event.kind, step(1).event.kind]).toEqual(['fade', 'fade', 'certified']);
  expect(p.certified).toEqual([0.8]);
});

it('marks a clean first take on a new day as overnight, and calls learned and review passed', () => {
  const u: Unit = { ...unit('chord:Bm'), rungs: [1], certify: [1] }, day1 = Date.UTC(2026, 10, 11, 18);
  let p = initialUnit();
  for (let i = 0; i < 3; i++) p = advanceUnit(u, p, take(1), true, day1, true).progress;
  const first = advanceUnit(u, p, take(1), true, day1 + DAY, true);
  expect(first.event).toMatchObject({ kind: 'fade', overnight: true });
  expect(advanceUnit(u, first.progress, take(1), true, day1 + DAY, true).event.overnight).toBe(false);
  expect(advanceUnit(u, p, take(1), false, day1 + DAY, true).event.overnight).toBe(false);
  p = first.progress;
  for (let i = 0; i < 2; i++) p = advanceUnit(u, p, take(1), true, day1 + DAY, true).progress;
  expect(p.learned).toBe(true);
  const due = day1 + 2 * DAY + 1;
  expect(advanceUnit(u, p, take(1), true, due, true).event).toMatchObject({ kind: 'review', overnight: true });
  expect(advanceUnit(u, p, take(0.3), true, due, true).event.kind).toBe('step-down');
});

const ev = (beat: number, mark: EventResult['mark'], offset?: number, tier?: EventResult['tier'], verdict: 'heard' | 'wrong' = 'heard'): EventResult =>
  ({ index: beat, beat, mark, offset, tier, notes: [{ midi: 60, verdict, reason: '' }] });

it('computes keys stats, tightness and a timing summary from the graded events', () => {
  const events = [ev(0, 'good', 0.01, 'perfect'), ev(1, 'good', -0.03, 'good'), ev(2, 'late', 0.2, 'late'), ev(3, 'good', 0.02, 'perfect'), ev(4, 'good', 0.04, 'good', 'wrong'), ev(5, 'missed')];
  expect(keyStats(events)).toEqual({ perfect: 2, run: 2 });
  expect(tightness(events)).toBe(30);
  expect(tightness(events, true)).toBe(30);
  expect(tightness([ev(0, 'missed')])).toBeUndefined();
  expect(timingSummary(events)).toBe('Timing 20 ms late on average; half the notes within 30 ms of it.');
  expect(timingSummary([ev(0, 'unsure')])).toBe('');
});

it('keeps bests and deltas from trusted takes only, and leads with what improved', () => {
  const base = { score: 0.8, timing: 0.8, tight: 40, support: 0, date: 1 };
  expect(compareTake(undefined, base, false)).toEqual({ after: undefined, wins: [] });
  const first = compareTake(undefined, base, true);
  expect(first.wins).toEqual(['First counted take at this tempo: 80%.']);
  const better = compareTake(first.after, { score: 0.92, timing: 0.9, tight: 25, support: 1, date: 2 }, true);
  expect(better.wins).toEqual(['New best at this tempo: 92% (was 80%).', '+10% on time versus your last take.', 'Tightest timing yet: 25 ms from the beat (was 40).', 'First clean take from memory at this tempo.']);
  expect(better.after).toEqual({ score: 0.92, tight: 25, last: 0.9, memory: true, date: 2 });
  const untrusted = compareTake(better.after, { score: 1, timing: 1, tight: 1, support: 1, date: 3 }, false);
  expect(untrusted).toEqual({ after: better.after, wins: [] });
  const worse = compareTake(better.after, { score: 0.7, timing: 0.7, tight: 60, support: 1, date: 4 }, true);
  expect(worse.wins).toEqual([]);
  expect(worse.after).toMatchObject({ score: 0.92, tight: 25, last: 0.7, memory: true });
  expect(bestKey('p|u', 60, true)).not.toBe(bestKey('p|u', 60, false));
  const store = { a: { ...better.after!, date: 1 }, b: { ...better.after!, date: 3 }, c: { ...better.after!, date: 2 } };
  pruneBests(store, 2);
  expect(Object.keys(store).sort()).toEqual(['b', 'c']);
});

it('saves bests inside the piece progress and still loads old saves without them', () => {
  const old = parsePieceProgress(JSON.stringify({ version: 1, units: {}, history: [] }));
  expect(old.bests).toEqual({});
  const saved = parsePieceProgress(JSON.stringify({ version: 1, bests: { 'p|u@60k': { score: 0.9, tight: 20, last: 0.85, memory: true, date: 5 }, bad: { score: 'x' } } }));
  expect(saved.bests).toEqual({ 'p|u@60k': { score: 0.9, tight: 20, last: 0.85, memory: true, date: 5 } });
  expect(parsePieceProgress(JSON.stringify(saved)).bests).toEqual(saved.bests);
});
