import type { Unit } from './curriculum';
import type { Exercise } from './exercise';
import { judgeKeys, keyReach, type KeyLive, type KeyPress } from './grade';
import { floorPct } from './pct';
import { CLEAN, ROOM, type UnitProgress } from './progress';

/**
 * The game layer: stars and the in-take run counter. Every value here is a read-out of the grade or of saved progress
 * that never decreases; nothing here changes a score, the clean rule, the ladder or the plan, and nothing is stored.
 * Pure: no DOM, no storage, no clock (callers pass the time), no randomness.
 */
export type Stars = 0 | 1 | 2 | 3;
/** A take at this score or better earns its third star. */
export const THREE_STARS = 0.95;

/** Stars for a percentage as printed (whole, rounded down by floorPct): 65% one, 80% (clean) two, 95% three. */
export function starsAt(pct: number): Stars {
  return pct >= floorPct(THREE_STARS) ? 3 : pct >= floorPct(CLEAN) ? 2 : pct >= floorPct(ROOM) ? 1 : 0;
}

export interface TakeStars {
  stars: Stars;
  /** The take's timing was not calibrated (a microphone take before calibration): the card labels it an estimate. */
  estimate: boolean;
}
/** A take's stars, from the same rounded-down percentage the card prints. An unscored take has none at all. */
export function takeStars(score: number, trusted: boolean, timed: boolean): TakeStars | undefined {
  if (!trusted || !Number.isFinite(score)) return undefined;
  return { stars: starsAt(floorPct(score)), estimate: !timed };
}
/** The card's count-up easing (t from 0 to 1, clamped): the on-time number and the stars both use it. */
export const countUp = (t: number) => {
  const c = Math.max(0, Math.min(1, t));
  return 1 - (1 - c) * (1 - c);
};
/**
 * During the card's count-up: the stars filled so far. They follow the score (the percentage printed beside them, the
 * lower of on time and notes), eased like the on-time count, so they end on the take's stars and never pass them.
 */
export function revealStars(score: number, t: number): Stars {
  return starsAt(Math.floor(floorPct(score) * countUp(t)));
}

export interface StepStars {
  stars: Stars;
  /** Learned: certified at the top tempo step on two different days. Never removed. */
  learned: boolean;
  /** A learned step whose review is due. A marker on the seal only: the stars stay. */
  due: boolean;
}
/** The fastest tempo step this step has (one hand alone stops at 80%). */
export const topRung = (unit: Unit) => Math.max(...unit.rungs);
/** Hearing the piece is not graded, so it has no stars. */
export const hasStars = (unit: Unit) => unit.kind !== 'listen' && unit.rungs.length > 0;
/**
 * A step's stars from saved progress that never decreases: one for its first clean take (best above 0), two once any
 * tempo step is certified, three once it is certified at its own top step. A step-down, a faded review or a due review
 * never lowers them (best and certified only grow; learned is never unset).
 */
export function stepStars(unit: Unit, p: UnitProgress | undefined, now?: number): StepStars {
  if (!p) return { stars: 0, learned: false, due: false };
  const top = topRung(unit),
    stars: Stars = p.certified.some((c) => c >= top - 1e-9) ? 3 : p.certified.length ? 2 : p.best > 0 ? 1 : 0;
  return { stars, learned: p.learned, due: p.learned && now !== undefined && p.due <= now };
}
/** The step that holds the progress: a step marked sameAs points to the one that teaches it. */
export const stepOf = (units: readonly Unit[], unit: Unit) =>
  unit.sameAs ? (units.find((u) => u.id === unit.sameAs) ?? unit) : unit;
/** The stars to show beside a step, sameAs resolved; undefined for a step that has none (hearing the piece). */
export function starsFor(
  units: readonly Unit[],
  unit: Unit,
  get: (id: string) => UnitProgress | undefined,
  now?: number,
): StepStars | undefined {
  const step = stepOf(units, unit);
  return hasStars(step) ? stepStars(step, get(step.id), now) : undefined;
}
/** Stars earned and possible over the real steps (not sameAs, not hearing the piece). */
export function pieceStars(
  units: readonly Unit[],
  get: (id: string) => UnitProgress | undefined,
): { earned: number; total: number } {
  const real = units.filter((u) => !u.sameAs && hasStars(u));
  return { earned: real.reduce((n, u) => n + stepStars(u, get(u.id)).stars, 0), total: real.length * 3 };
}

const ORDINAL = ['', 'first', 'second', 'third'];
/** What an answer earned in stars, for the milestone moment: "second star", "second and third stars"; undefined if none. */
export function starNews(unit: Unit, before: UnitProgress, after: UnitProgress): string | undefined {
  if (!hasStars(unit)) return undefined;
  const a = stepStars(unit, before).stars,
    b = stepStars(unit, after).stars;
  if (b <= a) return undefined;
  const names = ORDINAL.slice(a + 1, b + 1);
  return names.length === 1 ? `${names[0]} star` : `${names.join(' and ')} stars`;
}
/** A moment's title naming a new star: added to an existing title, or on its own for this step. */
export const starTitle = (title: string | undefined, news: string) =>
  title ? `${title} · ${news}` : `${news[0].toUpperCase()}${news.slice(1)} for this step`;

/** A milestone moment as answer() shows it: a title, how long it stands, its size and whether the next take follows. */
export interface Moment {
  title: string;
  ms: number;
  size: 'small' | 'medium' | 'big';
  next: boolean;
}
/**
 * The milestone moment once a confirmed answer's star news is added. No news: the moment is unchanged (or none). News
 * with a moment: its title names the star and nothing else changes. News with no moment: a small moment of 1.2 s that
 * names the first star and leads on to the next take, like the "Less help next take" moment.
 */
export function starMoment(earlier: Moment | undefined, news: string | undefined): Moment | undefined {
  if (!news) return earlier;
  return { ...(earlier ?? { ms: 1200, size: 'small', next: true }), title: starTitle(earlier?.title, news) };
}
/** The Last take line, which every look shows (Calm and reduced motion too): the answer's outcome, then any new star. */
export const starChip = (chip: string, news: string | undefined) => (news ? `${chip} · ${news}` : chip);
/** The course list's count of stars over the real steps. */
export const starCount = (s: { earned: number; total: number }) => `${s.earned} of ${s.total} stars`;

/**
 * What the run counter is read from during a keys or MIDI take, all by the grade's own rules (judgeKeys): the live
 * reading (an open match shows as 'played' and counts for nothing yet), the settled reading the grade will give, and
 * when each wrong key went down (seconds from the first beat).
 */
export interface RunEvidence {
  live: ReadonlyMap<string, KeyLive>;
  settled: ReadonlyMap<string, KeyLive>;
  wrong: readonly number[];
}
export function runEvidence(ex: Exercise, bpm: number, presses: readonly KeyPress[]): RunEvidence {
  const live = judgeKeys(ex, bpm, presses),
    settled = judgeKeys(ex, bpm, presses, true);
  return { live: live.notes, settled: settled.notes, wrong: [...settled.wrong].map((k) => presses[k].t) };
}
const onTime = (tier: KeyLive | undefined) => tier === 'perfect' || tier === 'good';
/**
 * The run of attacks so far at time t (seconds from the first beat), counted like keyStats on the card: an attack
 * counts when every one of its notes is on time with the right key; a missed attack, a missing or wrong note, or an
 * early or late attack ends the run. A wrong key also ends it at once (an extra key the card would let pass ends it
 * too, so the live count is never more than the card's). An attack still in play holds the count where it is; once no
 * later press can reach it or its neighbours (two match reaches after its beat) the settled reading decides it.
 * best: the longest run so far; at t = Infinity it is the card's "Longest run".
 */
export function liveRun(ex: Exercise, period: number, ev: RunEvidence, t: number): { run: number; best: number } {
  const close = 2 * keyReach(period);
  const items: { at: number; e?: Exercise['events'][number] }[] = [
    ...ex.events.filter((e) => e.grade !== 'none').map((e) => ({ at: e.beat * period, e })),
    ...ev.wrong.filter((at) => at <= t).map((at) => ({ at })),
  ].sort((a, b) => a.at - b.at);
  let run = 0,
    best = 0,
    waiting = false;
  for (const { at, e } of items) {
    if (!e) {
      run = 0;
      continue;
    }
    if (waiting) continue;
    const closed = t > at + close,
      tiers = e.notes.map((n) => (closed ? ev.settled : ev.live).get(`${e.beat}:${n.midi}`));
    if (tiers.every(onTime)) best = Math.max(best, ++run);
    else if (closed || tiers.some((x) => x === 'early' || x === 'late')) run = 0;
    else waiting = true;
  }
  return { run, best };
}
/** A finished keys take's longest run, for the card: the same count the live counter showed, at the end of the take. */
export const takeRun = (ex: Exercise, bpm: number, presses: readonly KeyPress[]) =>
  liveRun(ex, 60 / bpm, runEvidence(ex, bpm, presses), Infinity).best;

/** A box on the lane canvas, in CSS pixels. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/**
 * Where the run counter sits: the top left of the lane, where notes are still beats away from the hit line, so it never
 * covers a note about to land. If a text box (the message pill, a milestone moment) is there, it moves down below it.
 */
export function runPlace(w: number, h: number, avoid: readonly Box[]): Box {
  const box = { x: 8, y: 10, w, h };
  for (let i = 0; i <= avoid.length; i++) {
    const hit = avoid.find((a) => overlaps(box, a));
    if (!hit) break;
    box.y = hit.y + hit.h + 6;
  }
  return box;
}

/** The in-take run counter (keys and MIDI only) appears from this many right, on-time attacks in a row. */
export const RUN_SHOWN = 5;
/** In the lively look the counter pulses once as the run reaches each of these. */
export const RUN_PULSES = [10, 20, 30];
export const RUN_FADE_MS = 600;
export const RUN_PULSE_MS = 360;
/** What the counter remembers between frames: the run last frame, a pulse start and, after a run ends, its fade. */
export interface RunMemo {
  last: number;
  pulseAt?: number;
  fadeFrom?: number;
  endedAt?: number;
}
export interface RunShow {
  text: string;
  alpha: number;
  scale: number;
}
/**
 * One frame of the run counter. Shown from RUN_SHOWN up as "N in a row". Lively: it pulses as the run reaches 10, 20
 * and 30, and when the run ends it just fades out. Calm (or reduced motion): no pulse, and it is simply gone.
 * moving: the counter still changes on its own (a pulse or a fade), so a still lane must keep drawing.
 */
export function runCounter(
  memo: RunMemo,
  run: number,
  now: number,
  lively: boolean,
): { memo: RunMemo; show?: RunShow; moving: boolean } {
  if (run >= RUN_SHOWN) {
    const crossed = lively && RUN_PULSES.some((m) => memo.last < m && run >= m),
      pulseAt = lively ? (crossed ? now : memo.pulseAt) : undefined,
      age = pulseAt === undefined ? Infinity : now - pulseAt,
      scale = age < RUN_PULSE_MS ? 1 + 0.18 * Math.sin((Math.PI * age) / RUN_PULSE_MS) : 1;
    return {
      memo: { last: run, pulseAt },
      show: { text: `${run} in a row`, alpha: 1, scale },
      moving: age < RUN_PULSE_MS,
    };
  }
  const ended = memo.last >= RUN_SHOWN && lively,
    fadeFrom = ended ? memo.last : memo.fadeFrom,
    endedAt = ended ? now : memo.endedAt,
    age = endedAt === undefined || !lively ? Infinity : now - endedAt;
  if (fadeFrom === undefined || age >= RUN_FADE_MS) return { memo: { last: run }, moving: false };
  return {
    memo: { last: run, fadeFrom, endedAt },
    show: { text: `${fadeFrom} in a row`, alpha: 1 - age / RUN_FADE_MS, scale: 1 },
    moving: true,
  };
}

/** The card's line for a keys or MIDI take (takeRun): "Longest run: N" from RUN_SHOWN up, the counter's own threshold. */
export const runLine = (run: number) => (run >= RUN_SHOWN ? `Longest run: ${run}` : undefined);
/** The callout for a keys take's tight notes. The run is named only once, on the card (runLine), in one wording. */
export function keyWin(perfect: number, perfectMs: number): string | undefined {
  return perfect ? `${perfect} note${perfect > 1 ? 's' : ''} within ${perfectMs} ms of the beat.` : undefined;
}
