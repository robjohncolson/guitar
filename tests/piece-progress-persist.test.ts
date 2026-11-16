import { describe, expect, it } from 'vitest';
import type { Unit } from '../src/piece/curriculum';
import { advanceUnit, DAY, initialUnit, parsePieceProgress, progressId, type UnitProgress } from '../src/piece/progress';

const unit: Unit = { id: 'LR:1-4', kind: 'together', stage: 5, title: 'Hands together', goal: '', why: '', bars: [0, 1, 2, 3], hands: ['L', 'R'], requires: [], rungs: [0.5, 0.6, 0.7, 0.8, 0.88, 0.94, 1], certify: [0.8, 1], goalBpm: 66 };
const id = progressId('x', unit.id), now = Date.UTC(2026, 10, 14, 18);
const save = (units: Record<string, unknown>) => JSON.stringify({ version: 1, units });
const reload = (p: UnitProgress) => parsePieceProgress(save({ [id]: p })).units[id];
const tampered = (over: Record<string, unknown>) => parsePieceProgress(save({ [id]: { ...initialUnit(), ...over } })).units[id];
const take = (p: UnitProgress, score: number, comfortable = true) => advanceUnit(unit, p, { trusted: true, score }, comfortable, now, true);

it('keeps the clean and hard counts through a save and a reload', () => {
  const units = {
    [progressId('x', 'LR:1-4')]: { ...initialUnit(), rung: 1, clean: 1, attempts: 2 },
    [progressId('x', 'LR:5-8')]: { ...initialUnit(), rung: 2, hard: 1, attempts: 3 },
    [progressId('x', 'LR:9-12')]: { ...initialUnit(), rung: 2, clean: 1, hard: 1, attempts: 4 },
  };
  const back = parsePieceProgress(JSON.stringify({ ...parsePieceProgress(null), units }));
  expect(back.units).toEqual(units);
  expect(back.units[progressId('x', 'LR:9-12')]).toMatchObject({ clean: 1, hard: 1 });
});

it('loads an old save without the counts as zero and keeps the rest', () => {
  const old = { rung: 2, support: 1, best: 0.7, certified: [0.5], attempts: 5, last: now, due: 0, interval: 0, days: ['2026-11-13'], learned: false };
  expect(parsePieceProgress(save({ [id]: old })).units[id]).toEqual({ ...old, clean: 0, hard: 0 });
});

it('clamps tampered counts to whole numbers: clean 0 to 2, hard 0 to 1, anything else 0', () => {
  for (const [clean, want] of [[7, 2], [2, 2], [1.7, 1], [-3, 0], [null, 0], [NaN, 0], ['2', 0], [{}, 0]] as [unknown, number][]) expect(tampered({ clean }).clean, `clean ${String(clean)}`).toBe(want);
  for (const [hard, want] of [[5, 1], [1.5, 1], [0.9, 0], [-1, 0], ['x', 0], [null, 0], [Infinity, 0]] as [unknown, number][]) expect(tampered({ hard }).hard, `hard ${String(hard)}`).toBe(want);
});

it('climbs on two clean takes even when the page is reloaded between them', () => {
  let p = take(initialUnit(), 0.95).progress;
  expect(p).toMatchObject({ rung: 0, clean: 1 });
  p = reload(p);
  expect(p.clean).toBe(1);
  const second = take(p, 0.95);
  expect(second.progress).toMatchObject({ rung: 1, clean: 0 });
  expect(second.event.kind).toBe('climb');
});

it('steps down on two needs-more-room takes even when the page is reloaded between them', () => {
  for (const [score, comfortable] of [[0.5, true], [0.95, false]] as const) {
    let p = take({ ...initialUnit(), rung: 2, attempts: 3, best: 0.7 }, score, comfortable).progress;
    expect(p, `${score} ${comfortable}`).toMatchObject({ rung: 2, hard: 1 });
    p = reload(p);
    expect(p.hard).toBe(1);
    const second = take(p, score, comfortable);
    expect(second.progress, `${score} ${comfortable}`).toMatchObject({ rung: 1, hard: 0 });
    expect(second.event.kind).toBe('step-down');
  }
});

it('keeps a needs-more-room take on a certification rung through a reload, and the second one still drops the help', () => {
  // Rung 3 is the 80% certification rung. Help level 1 (notes hidden) has been reached when a needs-more-room take comes.
  for (const [score, comfortable] of [[0.5, true], [0.95, false]] as const) {
    const first = take({ ...initialUnit(), rung: 3, support: 1, clean: 1, attempts: 4, best: 0.7 }, score, comfortable);
    expect(first.progress, `${score} ${comfortable}`).toMatchObject({ rung: 3, support: 1, hard: 1, clean: 1 });
    expect(first.event.kind, `${score} ${comfortable}`).toBe('hold');
    const back = reload(first.progress);
    expect(back, `${score} ${comfortable}: reloaded`).toMatchObject({ rung: 3, support: 1, hard: 1 });
    const second = take(back, score, comfortable);
    expect(second.progress, `${score} ${comfortable}`).toMatchObject({ rung: 2, support: 0, hard: 0, clean: 0 });
    expect(second.event.kind, `${score} ${comfortable}`).toBe('step-down');
  }
});

it('steps a learned step down on one needs-more-room take once its review is due, so no count is needed or kept', () => {
  const due = { ...initialUnit(), rung: 6, certified: [0.8, 1], learned: true, interval: 4, due: now - DAY, days: ['2026-11-01', '2026-11-02'], best: 1, attempts: 12, last: now - 5 * DAY };
  for (const [score, comfortable] of [[0.5, true], [0.95, false]] as const) {
    const before = reload(due);
    expect(before, 'nothing is pending').toMatchObject({ hard: 0, clean: 0, learned: true });
    const eased = take(before, score, comfortable);
    expect(eased.event.kind, `${score} ${comfortable}`).toBe('step-down');
    expect(eased.progress, `${score} ${comfortable}`).toMatchObject({ rung: 5, learned: true, interval: 1, due: now + DAY, hard: 0, clean: 0 });
    expect(reload(eased.progress), `${score} ${comfortable}: reloaded`).toMatchObject({ rung: 5, learned: true, due: now + DAY, hard: 0 });
  }
  // A clean take at the top passes the review instead, and leaves no needs-more-room count behind.
  const passed = take(reload(due), 0.95);
  expect(passed.event.kind).toBe('review');
  expect(passed.progress).toMatchObject({ rung: 6, learned: true, interval: 8, due: now + 8 * DAY, hard: 0 });
});

it('carries a pending clean or needs-more-room take across midnight', () => {
  const start = { ...initialUnit(), rung: 2, attempts: 3, best: 0.7 }, nextDay = (p: UnitProgress, score: number, comfortable: boolean) => advanceUnit(unit, reload(p), { trusted: true, score }, comfortable, now + DAY, true);
  const climbed = nextDay(take(start, 0.95).progress, 0.95, true);
  expect(climbed.progress).toMatchObject({ rung: 3, clean: 0 });
  expect(climbed.event).toEqual({ kind: 'climb', clean: true, overnight: true });
  const eased = nextDay(take(start, 0.95, false).progress, 0.95, false);
  expect(eased.progress).toMatchObject({ rung: 1, hard: 0 });
  expect(eased.event.kind).toBe('step-down');
});

describe('calibration latency', () => {
  it('keeps the output latency measured with the offset, and drops a bad one', () => {
    expect(parsePieceProgress(JSON.stringify({ version: 1, offset: 0.12, calibrated: true, latency: 0.045 })).latency).toBe(0.045);
    expect(parsePieceProgress(JSON.stringify({ version: 1, offset: 0.12, calibrated: true, latency: 5 })).latency).toBe(1);
    expect(parsePieceProgress(JSON.stringify({ version: 1, offset: 0.12, calibrated: true })).latency).toBeUndefined();
  });
});

it('climbs after two clean takes at a step even with a weaker take between them', () => {
  const one = take({ ...initialUnit(), rung: 1, attempts: 2 }, 0.95, true);
  expect(one.progress).toMatchObject({ rung: 1, clean: 1 });
  const weaker = take(one.progress, 0.7, true);
  expect(weaker.progress).toMatchObject({ rung: 1, clean: 1, hard: 0 });
  const two = take(weaker.progress, 0.93, true);
  expect(two.progress).toMatchObject({ rung: 2, clean: 0 });
  expect(two.event.kind).toBe('climb');
});
