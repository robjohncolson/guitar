import { expect, it } from 'vitest';
import gymnopedie from '../src/piece/packs/gymnopedie-1.piece.txt?raw';
import { compile } from '../src/piece/notation';
import { buildCurriculum, type Curriculum } from '../src/piece/curriculum';
import { arrange, guitarUnits } from '../src/piece/guitar';
import { advanceUnit, DAY, dayOf, initialUnit, logDay, parsePieceProgress, phrases, rowDone, suggestToday, unitState, week, type PlanRow, type UnitProgress } from '../src/piece/progress';

const score = compile(gymnopedie).score!;
const piano = buildCurriculum(score);
const guitar: Curriculum = { ...piano, units: guitarUnits(score, arrange(score), score.tempo.bpm) };
const passage = (r: PlanRow) => ['hand', 'together', 'section'].includes(r.unit.kind);

/**
 * A learner who plays perfect takes, follows today's checklist (fixed at the start of the day) row by row until each is
 * done for today, then keeps going with fresh suggestions, for a number of takes per day.
 */
function simulate(curriculum: Curriculum, days: number, perDay: number) {
  const units: Record<string, UnitProgress> = {}, get = (id: string) => units[id];
  const start = new Date(2026, 10, 2, 18).getTime(), firstDays: PlanRow[][] = [];
  for (let d = 0; d < days; d++) {
    const takes = new Map<string, { trusted: boolean; clean: boolean }[]>();
    let now = start + d * DAY;
    const fixed = suggestToday(curriculum, get, now);
    if (d < 2) firstDays.push(fixed);
    const doneRow = (r: PlanRow) => rowDone(r, get(r.unit.id), takes.get(r.unit.id) ?? [], now);
    for (let t = 0; t < perDay; t++) {
      const fresh = suggestToday(curriculum, get, now);
      const row = fixed.find(r => !doneRow(r)) ?? fresh.find(r => !doneRow(r)) ?? fresh.find(r => r.slot === 'phrase') ?? fresh[0];
      if (!row) break;
      const u = row.unit;
      if (u.kind === 'listen') { units[u.id] = { ...(units[u.id] ?? initialUnit()), attempts: 1, last: now }; continue; }
      const change = advanceUnit(u, units[u.id] ?? initialUnit(), { trusted: true, score: 1 }, true, now, true);
      units[u.id] = change.progress;
      takes.set(u.id, [...(takes.get(u.id) ?? []), { trusted: true, clean: change.event.clean }]);
      now += 60000;
    }
  }
  const end = start + days * DAY, real = curriculum.units.filter(u => !u.sameAs);
  return { firstDays, learned: real.filter(u => ['learned', 'due'].includes(unitState(u, units[u.id], end))).length, units };
}

it('starts the first day with the piece itself: hear it, then a phrase, with the chord it needs', () => {
  const plan = suggestToday(piano, () => undefined, Date.UTC(2026, 10, 11));
  expect(plan.map(p => p.reason)).toEqual(['Hear it before you start', 'A chord the music needs', "Today's phrase", "Today's section"]);
  expect(plan.slice(2).map(r => r.unit.id)).toEqual(['L:1-4', 'section:Intro']);
  expect(plan.slice(2).every(passage)).toBe(true);
  expect(plan.slice(2).every(r => r.unit.bars.every(b => b <= 3))).toBe(true);
});

it('groups the music into phrases with their chords, changes and joins, for piano and guitar', () => {
  const music = phrases(piano);
  expect(music[0].units.map(u => u.id)).toContain('L:1-4');
  expect(music.flatMap(p => p.extras).filter(u => u.kind === 'chord')).toHaveLength(piano.units.filter(u => u.kind === 'chord').length);
  // The join across the repeat belongs to the last phrase, not the first.
  expect(music.findIndex(p => p.extras.some(u => u.id === 'seam:39-1'))).toBeGreaterThan(0);
  const g = phrases(guitar);
  expect(g[0].units.map(u => u.id)).toEqual(['g-pattern:muted', 'g-pattern:chord']);
  const plan = suggestToday(guitar, () => undefined, Date.UTC(2026, 10, 11));
  expect(plan.map(p => p.slot)).toEqual(['chord', 'phrase', 'phrase']);
});

it('brings a step certified on an earlier day back for its second day, and puts due reviews first, capped', () => {
  const u = piano.units.find(x => x.id === 'L:1-4')!, day1 = new Date(2026, 10, 11, 18).getTime();
  let p = initialUnit();
  for (let i = 0; i < 20 && unitState(u, p, day1) !== 'done'; i++) p = advanceUnit(u, p, { trusted: true, score: 1 }, true, day1, true).progress;
  expect(unitState(u, p, day1)).toBe('done');
  const heard = { ...initialUnit(), attempts: 1, last: day1 };
  const get = (id: string) => (id === u.id ? p : id === 'listen' ? heard : undefined);
  expect(suggestToday(piano, get, day1 + 600000).some(r => r.slot === 'second')).toBe(false);
  const next = suggestToday(piano, get, day1 + DAY);
  expect(next.find(r => r.slot === 'second')?.unit.id).toBe(u.id);
  expect(rowDone(next.find(r => r.slot === 'second')!, p, [], day1 + DAY)).toBe(false);
  const due = (id: string) => ({ ...initialUnit(), attempts: 9, last: day1, learned: true, due: day1 + 1000 * id.length, interval: 1, days: ['2026-11-10', '2026-11-11'] });
  const many = suggestToday(piano, id => (id.startsWith('chord:') || id.startsWith('L:') ? due(id) : id === 'listen' ? heard : undefined), day1 + 3 * DAY);
  expect(many.filter(r => r.slot === 'review')).toHaveLength(2);
  expect(many.findIndex(r => r.slot === 'review')).toBeLessThan(many.findIndex(r => r.slot === 'phrase'));
});

it('following the plan with perfect takes reaches the music on day one and learns steps steadily (piano and guitar)', () => {
  const sim = simulate(piano, 60, 40);
  expect(sim.firstDays[0].some(passage)).toBe(true);
  expect(sim.firstDays[1].some(r => r.slot === 'second')).toBe(true);
  // The stage-order plan it replaces learned 8 steps in the same simulation.
  expect(sim.learned).toBeGreaterThanOrEqual(50);
  const g = simulate(guitar, 30, 40);
  expect(g.firstDays[0].some(passage)).toBe(true);
  expect(g.learned).toBeGreaterThan(guitar.units.length / 2);
});

it('keeps a bounded day log and a lenient week that never resets', () => {
  const t = new Date(2026, 10, 13, 20).getTime(); // a Friday
  let log = logDay([], t - 3 * DAY, { takes: 4, clean: 2, seconds: 90 });
  log = logDay(log, t, { takes: 1, seconds: 30 }); log = logDay(log, t, { clean: 1 });
  expect(log).toEqual([{ day: dayOf(t - 3 * DAY), takes: 4, clean: 2, seconds: 90 }, { day: dayOf(t), takes: 1, clean: 1, seconds: 30 }]);
  const w = week(log, t);
  expect(w.days.map(d => d.takes)).toEqual([0, 0, 0, 4, 0, 0, 1]);
  expect(w.played).toBe(2);
  for (let i = 0; i < 200; i++) log = logDay(log, t + i * DAY, { takes: 1 });
  expect(log).toHaveLength(120);
  const saved = parsePieceProgress(JSON.stringify({ version: 1, log: [...log, { day: 'bad' }], dailyGoal: 8, today: { g: { day: '2026-11-13', rows: [{ id: 'L:1-4', reason: "Today's phrase", slot: 'phrase' }, { id: 'x', reason: 'r', slot: 'nope' }] } }, history: [{ unit: 'x', date: 1, bpm: 60, score: 1, trusted: true, clean: true }] }));
  expect(saved.log).toHaveLength(120);
  expect(saved.dailyGoal).toBe(8);
  expect(saved.today.g.rows).toEqual([{ id: 'L:1-4', reason: "Today's phrase", slot: 'phrase' }]);
  expect(saved.history[0].clean).toBe(true);
  const old = parsePieceProgress(JSON.stringify({ version: 1, units: {}, history: [] }));
  expect(old).toMatchObject({ log: [], dailyGoal: 6, today: {} });
});
