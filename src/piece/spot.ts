import { fromBars, type Exercise } from './exercise';
import type { EventResult, PieceGrade } from './grade';
import type { Unit } from './curriculum';
import type { Hand, Score } from './score';

export interface SpotPick {
  from: number;
  to: number;
  lead: boolean;
  hand: Hand;
}
const EPS = 1e-6;

const positionAt = (ex: Exercise, beat: number) => ex.bars.reduce((k, b, i) => (b.beat <= beat + EPS ? i : k), 0);
const handOf = (ex: Exercise, e: EventResult, midi: number): Hand => {
  const x = ex.events.find((v) => Math.abs(v.beat - e.beat) < EPS);
  return x?.notes.find((n) => n.midi === midi)?.hand ?? 'R';
};
const unclear = (e: EventResult) =>
  e.mark === 'unsure' || (e.notes.length > 0 && e.notes.every((n) => n.verdict === 'unclear'));

/** Confirmed problems per bar position of the take: events missed (or off the beat when timing counts) and notes wrong or not heard. */
export function problemBars(
  ex: Exercise,
  result: PieceGrade,
  timing: boolean,
): Map<number, { count: number; L: number; R: number }> {
  const bars = new Map<number, { count: number; L: number; R: number }>();
  for (const e of result.events) {
    const marked = e.mark === 'missed' || (timing && (e.mark === 'early' || e.mark === 'late'));
    const notes = e.notes.filter((n) => marked || n.verdict === 'wrong' || n.verdict === 'not-heard');
    if (!marked && !notes.length) continue;
    const k = positionAt(ex, e.beat),
      b = bars.get(k) ?? { count: 0, L: 0, R: 0 };
    b.count++;
    for (const n of notes) b[handOf(ex, e, n.midi)]++;
    bars.set(k, b);
  }
  return bars;
}

/** The short run of whole bars to practise on its own, 'choose' when the take is too unclear to say, or nothing when the trouble is everywhere or nowhere. */
export function pickSpot(ex: Exercise, result: PieceGrade, timing: boolean): SpotPick | 'choose' | undefined {
  if (result.events.filter(unclear).length > result.events.length / 2) return 'choose';
  const n = ex.bars.length,
    bars = problemBars(ex, result, timing),
    P = [...bars.keys()].sort((a, b) => a - b);
  if (!P.length || P.length > n / 2) return undefined;
  const clusters: number[][] = [];
  for (const p of P) {
    const last = clusters[clusters.length - 1];
    if (last && p - last[last.length - 1] <= 2) last.push(p);
    else clusters.push([p]);
  }
  const total = (c: number[]) => c.reduce((s, p) => s + bars.get(p)!.count, 0);
  const best = clusters.reduce((a, c) => (total(c) > total(a) ? c : a));
  const s = best[0],
    e = best[best.length - 1];
  if (e - s + 1 > n / 2) return undefined;
  const lead = s > 0 && !(s - 1 === 0 && e === n - 1);
  let L = 0,
    R = 0;
  for (let p = s; p <= e; p++) {
    const b = bars.get(p);
    if (b) {
      L += b.L;
      R += b.R;
    }
  }
  return { from: lead ? s - 1 : s, to: e, lead, hand: L > R ? 'L' : 'R' };
}

export const spotId = (unitId: string, from: number, to: number, hands: Hand[]) =>
  `spot/${unitId}/${from}-${to}/${hands.join('')}`;
export const isSpotId = (id: string) => id.startsWith('spot/');

/** A take of bar positions from..to of the unit's play order. */
export function spotExercise(score: Score, unit: Unit, from: number, to: number, hands: Hand[]): Exercise {
  const bars = unit.bars.slice(from, to + 1);
  return fromBars(
    score,
    bars,
    hands,
    spotId(unit.id, from, to, hands),
    `${unit.title}: ${barsText(bars.map((i) => score.bars[i].number))}`,
  );
}

/** The next tempo rung below bpm, or 15% slower when none is. */
export function slowerBpm(unit: Unit, bpm: number): number {
  const below = unit.rungs.map((r) => Math.max(20, Math.round(unit.goalBpm * r))).filter((c) => c < bpm);
  return below.length ? Math.max(...below) : Math.max(20, Math.round(bpm * 0.85));
}

/** The next tempo rung above bpm, never past cap (the parent step's own tempo), or 15% faster when none is. */
export function fasterBpm(unit: Unit, bpm: number, cap = Infinity): number {
  const above = unit.rungs.map((r) => Math.max(20, Math.round(unit.goalBpm * r))).filter((c) => c > bpm && c <= cap);
  if (above.length) return Math.min(...above);
  return Math.max(20, Math.min(cap, Math.round(bpm * 1.15)));
}

/** The most weak passages kept for one course. */
export const WEAK_MAX = 5;
const WEAK_DAYS = [1, 2, 4, 8, 16];
const DAY_MS = 86400000;

/**
 * A passage that recurring, trusted takes have confirmed needs another look. It is remembered by play-order bar
 * positions inside a step, with a spaced-review due date. It never implies failure: the plan offers it again like any
 * other passage and the step's own tempo ladder is untouched.
 */
export interface WeakSpot {
  unit: string;
  from: number;
  to: number;
  hands: Hand[];
  due: number;
  count: number;
}
const weakKey = (s: Pick<WeakSpot, 'unit' | 'from' | 'to' | 'hands'>) =>
  `${s.unit}|${s.from}-${s.to}|${s.hands.join('')}`;
const weakRank = (a: WeakSpot, b: WeakSpot) => b.count - a.count || a.due - b.due || a.unit.localeCompare(b.unit);
const weakDue = (count: number, now: number) => now + WEAK_DAYS[Math.min(WEAK_DAYS.length - 1, count - 1)] * DAY_MS;

/** Adds or repeats a confirmed problem range from one trusted take; keeps the five most recurring per course. */
export function rememberWeakSpot(list: WeakSpot[], unit: string, pick: SpotPick, now: number): WeakSpot[] {
  const hands: Hand[] = [pick.hand],
    key = weakKey({ unit, from: pick.from, to: pick.to, hands }),
    next = list.map((s) => ({ ...s, hands: [...s.hands] })),
    found = next.find((s) => weakKey(s) === key);
  if (found) {
    found.count = Math.min(WEAK_MAX, found.count + 1);
    found.due = weakDue(found.count, now);
  } else next.push({ unit, from: pick.from, to: pick.to, hands, due: weakDue(1, now), count: 1 });
  return next.sort(weakRank).slice(0, WEAK_MAX);
}

/** A trusted spot pass on a remembered range moves its next review out; anything else leaves the list alone. */
export function rescheduleWeakSpot(list: WeakSpot[], unit: string, from: number, to: number, now: number): WeakSpot[] {
  const found = list.find((s) => s.unit === unit && s.from === from && s.to === to);
  if (!found) return list;
  return list.map((s) =>
    s === found ? { ...s, hands: [...s.hands], due: weakDue(s.count, now) } : { ...s, hands: [...s.hands] },
  );
}

/** Combines two saved lists without losing either browser's passages, then keeps the five most recurring. */
export function mergeWeakSpots(
  local: Readonly<Record<string, WeakSpot[]>>,
  incoming: Readonly<Record<string, WeakSpot[]>>,
): Record<string, WeakSpot[]> {
  const out: Record<string, WeakSpot[]> = {};
  for (const [course, list] of Object.entries(local))
    out[course] = list
      .map((s) => ({ ...s, hands: [...s.hands] }))
      .sort(weakRank)
      .slice(0, WEAK_MAX);
  for (const [course, list] of Object.entries(incoming)) {
    const byKey = new Map((out[course] ?? []).map((s) => [weakKey(s), s]));
    for (const s of list) {
      const before = byKey.get(weakKey(s));
      if (!before || s.count > before.count || (s.count === before.count && s.due > before.due))
        byKey.set(weakKey(s), { ...s, hands: [...s.hands] });
    }
    out[course] = [...byKey.values()].sort(weakRank).slice(0, WEAK_MAX);
  }
  return out;
}

export function barsText(numbers: number[]): string {
  if (numbers.length === 1) return `bar ${numbers[0]}`;
  const run = numbers.length > 1 && numbers.every((v, i) => i === 0 || v === numbers[i - 1] + 1);
  return run ? `bars ${numbers[0]}–${numbers[numbers.length - 1]}` : `bars ${numbers.join(', ')}`;
}

export const spotOffered = (instrument: 'piano' | 'guitar', unit: Unit) =>
  !unit.drill &&
  !['chord', 'listen'].includes(unit.kind) &&
  unit.bars.length >= 2 &&
  (instrument === 'piano' || unit.id.startsWith('gp-'));
