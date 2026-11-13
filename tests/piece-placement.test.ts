import { expect, it } from 'vitest';
import gymnopedie from '../src/piece/packs/gymnopedie-1.piece.txt?raw';
import { compile } from '../src/piece/notation';
import { buildCurriculum, type Unit } from '../src/piece/curriculum';
import { advanceUnit, canPlace, DAY, initialUnit, placeHands, placeUnit, suggestToday, unitState, type UnitProgress } from '../src/piece/progress';

const curriculum = buildCurriculum(compile(gymnopedie).score!);
const unit = (id: string) => curriculum.units.find(u => u.id === id)!;
const together = unit('LR:9-12'), hand = unit('L:1-4');
const now = Date.UTC(2026, 0, 5, 12), good = { trusted: true, score: 0.95 };
const at = (u: Unit, fraction: number) => u.rungs.indexOf(fraction);
const place = (u: Unit, before: UnitProgress, target: number, over: Partial<{ trusted: boolean; score: number }> = {}, comfortable = true, calibrated = true, when = now) =>
  placeUnit(u, before, target, { ...good, ...over }, comfortable, when, calibrated);
const clean = (u: Unit, p: UnitProgress, when = now) => advanceUnit(u, p, good, true, when, true).progress;

it('places a clean take at a non-certifying step as its first clean take there', () => {
  const r = place(together, initialUnit(), at(together, 0.88));
  expect(r.placed).toBe(true);
  expect(r.progress).toMatchObject({ rung: at(together, 0.88), best: 0.88, attempts: 1, clean: 1, hard: 0, support: 0, learned: false, certified: [] });
  expect(r.event).toMatchObject({ kind: 'placed', clean: true });
  expect(r.message).toMatch(/^Placed at 88%: \d+ BPM\./);
  expect(clean(together, r.progress).rung).toBe(at(together, 0.94));
});

it('places at a certification step with support 1, the notes-shown take counted', () => {
  const r = place(together, initialUnit(), at(together, 1));
  expect(r.placed).toBe(true);
  expect(r.progress).toMatchObject({ rung: at(together, 1), best: 1, attempts: 1, support: 1, certified: [] });
  expect(r.message).toMatch(/^Placed at 100%: \d+ BPM\. .*two more clean takes/);
});

it('records nothing for a take that does not place', () => {
  const before = { ...initialUnit(), rung: 1, hard: 1, attempts: 3, best: 0.6, last: now - DAY, clean: 1 };
  for (const [over, comfortable] of [[{ score: 0.85 }, true], [{}, false], [{ score: 0.2 }, false]] as const) {
    const r = place(together, before, at(together, 0.88), over, comfortable);
    expect(r.placed).toBe(false);
    expect(r.progress).toEqual(before);
  }
});

it('does not place an untrusted or uncalibrated take', () => {
  const before = { ...initialUnit(), attempts: 2, hard: 1 };
  for (const r of [place(together, before, 4, { trusted: false }), place(together, before, 4, {}, true, false)]) {
    expect(r.placed).toBe(false);
    expect(r.progress).toEqual(before);
  }
});

it('places one hand no higher than its top step', () => {
  const r = place(hand, initialUnit(), 6);
  expect(r.placed).toBe(true);
  expect(r.progress).toMatchObject({ rung: at(hand, 0.8), best: 0.8, support: 1, attempts: 1 });
});

it('leaves certification and the two-day rule intact after a placement at the goal tempo', () => {
  let p = place(together, initialUnit(), at(together, 1)).progress;
  p = clean(together, p);
  expect(p.support).toBe(2);
  p = clean(together, p);
  expect(p.certified).toContain(1);
  expect(p.learned).toBe(false);
  expect(unitState(together, p, now)).toBe('done');
  p = clean(together, clean(together, clean(together, p, now + DAY), now + DAY), now + DAY);
  expect(p.learned).toBe(true);
});

it('cannot place a step already at or above the target, learned, or certified at its top', () => {
  const high = { ...initialUnit(), rung: at(together, 0.88), attempts: 1 };
  expect(canPlace(together, high, at(together, 0.88))).toBe(false);
  expect(canPlace(together, high, at(together, 0.7))).toBe(false);
  expect(canPlace(together, high, at(together, 0.94))).toBe(true);
  const r = place(together, high, at(together, 0.7));
  expect(r.placed).toBe(false);
  expect(r.progress).toEqual(high);
  const learned = { ...initialUnit(), rung: 3, attempts: 4, learned: true, certified: [0.8, 1] };
  expect(canPlace(together, learned, 6)).toBe(false);
  expect(place(together, learned, 6).placed).toBe(false);
  expect(canPlace(together, { ...initialUnit(), rung: 5, certified: [1] }, 6)).toBe(false);
  expect(canPlace(unit('listen'), undefined, 0)).toBe(false);
});

it('places the matching one-hand steps after a clean hands-together placement, never certifying them', () => {
  const units = curriculum.units, get = () => undefined;
  const bars = [...new Set(together.bars)].sort((a, b) => a - b).join(',');
  const hands = units.filter(u => u.kind === 'hand' && [...new Set(u.bars)].sort((a, b) => a - b).join(',') === bars);
  expect(hands.length).toBeGreaterThan(0);
  const high = placeHands(units, together, 1, get);
  expect(high.length).toBeGreaterThan(0);
  for (const [id, p] of high) {
    const u = unit(id);
    expect(u.sameAs).toBeUndefined();
    expect(p).toMatchObject({ rung: at(u, 0.8), best: 0.8, attempts: 1, clean: 0, support: 0, certified: [], learned: false });
  }
  for (const [id, p] of placeHands(units, together, 0.7, get)) expect(p).toMatchObject({ rung: at(unit(id), 0.7), best: 0.7, certified: [] });
  const [id] = high[0], above = { ...initialUnit(), rung: 3, attempts: 2, best: 0.8 };
  expect(placeHands(units, together, 0.7, i => (i === id ? above : undefined)).some(([x]) => x === id)).toBe(false);
  expect(placeHands(units, hand, 1, get)).toEqual([]);
});

it('reads placed progress like any other in the state and the plan', () => {
  const placed = place(together, initialUnit(), at(together, 0.88)).progress;
  expect(unitState(together, initialUnit(), now)).toBe('new');
  expect(unitState(together, placed, now)).toBe('practising');
  const get = (id: string) => (id === together.id ? placed : undefined);
  const rows = suggestToday(curriculum, get, now);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.map(r => r.unit.id)).not.toEqual(suggestToday(curriculum, () => undefined, now).map(r => r.unit.id));
});
