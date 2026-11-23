import type { Unit } from './curriculum';
import { hasStars, starNews, stepStars, type StepStars } from './game';
import { starsHtml } from './hud';
import { pieceMeta } from './mine';
import {
  initialUnit,
  progressId,
  week,
  type AdvanceEvent,
  type PieceProgress,
  type PlanRow,
  type UnitProgress,
} from './progress';

/**
 * The end-of-session summary behind Finish: facts about this visit (this page load) only. Stars and steps that moved
 * are read by comparing saved progress now with a copy taken when the page loaded; the copy lives in memory and nothing
 * new is stored. Counted means the ladder counted the take (a trusted, calibrated answer at the step's tempo, or a
 * clean placement); unclear, uncalibrated and free-tempo takes are not counted and never appear as wins. Nothing here
 * is praised for time, takes played or days in a row, and a step down is never mentioned. With nothing to list, the card
 * says where things stand ("No step ended this visit higher than it started."), never what happened in between.
 */
export class Visit {
  /** Every step's saved progress when the page loaded, by progress key (a piece reset in this visit is forgotten). */
  readonly before: Map<string, UnitProgress>;
  /** Answers the ladder counted in this visit. */
  counted = 0;
  /** Steps (progress keys) whose first counted take on a new day was clean in this visit. */
  readonly overnight = new Set<string>();
  /** Steps placed in this visit, with the tempo step the placement put them on (when it happened). */
  readonly placed = new Map<string, number>();
  /** Steps a placement of another step raised (a hands-together placement raises its one-hand steps): by whom, to where. */
  readonly placedWith = new Map<string, { by: string; rung: number }>();
  /** Each step's tempo step as of the last answer, to see what a placement raised. */
  private rungs: Map<string, number>;
  constructor(units: Readonly<Record<string, UnitProgress>>) {
    this.before = new Map(
      Object.entries(units).map(([k, p]) => [k, { ...p, certified: [...p.certified], days: [...p.days] }]),
    );
    this.rungs = new Map(Object.entries(units).map(([k, p]) => [k, p.rung]));
  }
  /**
   * One answered take, as the page's answer() saw it: the ladder's event (none for free tempo), its step's key and the
   * saved progress right after it.
   */
  answered(
    event: AdvanceEvent | undefined,
    key: string | undefined,
    units: Readonly<Record<string, UnitProgress>>,
  ): void {
    if (event && event.kind !== 'uncounted' && key) {
      this.counted++;
      if (event.overnight) this.overnight.add(key);
      if (event.kind === 'placed') {
        this.placed.set(key, units[key]?.rung ?? 0);
        for (const [k, p] of Object.entries(units))
          if (k !== key && p.rung > (this.rungs.get(k) ?? 0)) this.placedWith.set(k, { by: key, rung: p.rung });
      }
    }
    this.rungs = new Map(Object.entries(units).map(([k, p]) => [k, p.rung]));
  }
  /**
   * The learner reset a piece's progress (all three courses): everything this visit remembers of it goes, the copy from
   * page load, the tempo steps, placements (also steps placed with one of its steps) and overnight marks. From then on
   * the card compares that piece with nothing, as the page does. Counted answers stay counted.
   */
  forget(pack: string): void {
    const gone = (k: string) => packOf(k) === pack;
    for (const k of [...this.before.keys()]) if (gone(k)) this.before.delete(k);
    for (const k of [...this.rungs.keys()]) if (gone(k)) this.rungs.delete(k);
    for (const k of [...this.placed.keys()]) if (gone(k)) this.placed.delete(k);
    for (const [k, w] of [...this.placedWith]) if (gone(k) || gone(w.by)) this.placedWith.delete(k);
    for (const k of [...this.overnight]) if (gone(k)) this.overnight.delete(k);
  }
}

export interface VisitCourse {
  name: string;
  units: readonly Unit[];
  key: (id: string) => string;
  current: boolean;
}
/** The open piece: its id and its three courses as the page keys their progress. */
export interface VisitPiece {
  pack: string;
  courses: readonly VisitCourse[];
}
export interface VisitFacts {
  piece: VisitPiece;
  visit: Pick<Visit, 'before' | 'counted' | 'overnight' | 'placed' | 'placedWith'>;
  /** All saved progress now, every piece. */
  units: Readonly<Record<string, UnitProgress>>;
  /** A piece's title as the piece picker knows it, or undefined when the piece is gone. */
  title: (pack: string) => string | undefined;
  /** Clean takes today (the day log) and the learner's own daily aim. */
  clean: number;
  aim: number;
  /** suggestToday as it will stand at the start of tomorrow with today's saved progress. */
  tomorrow: readonly PlanRow[];
  now: number;
}
export interface VisitStep {
  title: string;
  /** Set when the step is in another course than the current one. */
  course?: string;
}
export interface VisitSummary {
  clean: number;
  aim: number;
  stars: (VisitStep & { stars: StepStars; news: string })[];
  moved: (VisitStep & { what: string[] })[];
  /** Other pieces whose steps made progress in this visit: "Also in this visit: 2 steps made progress in …". */
  others: string[];
  /**
   * No saved step, in any piece or course, ends this visit higher than it started (no higher tempo step, no better
   * best, no new certification, nothing newly learned: movedUp), by plain comparison with the copy from page load. A
   * step that went up and came back down in the same visit ends where it started.
   */
  level: boolean;
  next?: string;
}

const pct = (f: number) => `${Math.round(f * 100)}%`;
/** What tomorrow's plan brings first, in the plan's own words: never a warning, never a loss. */
const ahead: Partial<Record<PlanRow['slot'], (u: Unit) => string>> = {
  review: () => 'comes back for review',
  second: () => 'comes back for its second day',
  chord: (u) => `is the next ${u.kind === 'change' ? 'change' : 'chord'} the music needs`,
  phrase: (u) =>
    u.kind === 'seam' ? 'is the next join' : u.kind === 'section' ? 'is the next section' : 'is the next phrase',
  run: () => 'is the play-through',
};
/**
 * A step made progress: a higher tempo step, a better best (a first clean take is the first star), a new certification,
 * or newly learned. Stars come from best, certified and learned only, so no star gained anywhere is missed.
 */
const movedUp = (before: UnitProgress | undefined, after: UnitProgress) =>
  after.rung > (before?.rung ?? 0) ||
  after.best > (before?.best ?? 0) + 1e-9 ||
  after.certified.some((x) => !(before?.certified ?? []).some((y) => Math.abs(x - y) < 1e-9)) ||
  (after.learned && !before?.learned);
/** The piece a progress key belongs to: the key is the piece id, a course tag, "|" and the step id. */
const packOf = (key: string) => key.slice(0, Math.max(0, key.indexOf('|'))).replace(/#guitar(-piece)?$/, '');

/** The card's content, or undefined when nothing was counted in this visit (the page then keeps its one sentence). */
export function visitSummary(f: VisitFacts): VisitSummary | undefined {
  if (f.visit.counted < 1) return undefined;
  const stars: VisitSummary['stars'] = [],
    moved: (VisitSummary['moved'][number] & { key: string; by?: string })[] = [];
  const courses = [...f.piece.courses].sort((a, b) => Number(b.current) - Number(a.current));
  const titles = new Map(courses.flatMap((c) => c.units.map((u) => [c.key(u.id), u.title] as const)));
  for (const c of courses)
    for (const u of c.units) {
      if (u.sameAs || !hasStars(u)) continue;
      const k = c.key(u.id),
        before = f.visit.before.get(k),
        after = f.units[k];
      if (!after) continue;
      const step: VisitStep = c.current ? { title: u.title } : { title: u.title, course: c.name };
      const news = starNews(u, before ?? initialUnit(), after);
      if (news) stars.push({ ...step, stars: stepStars(u, after, f.now), news });
      const at = (rung: number) => pct(u.rungs[Math.min(rung, u.rungs.length - 1)]);
      // A placement is told where it put the step when it happened; the tempo step reached after it, only if higher.
      const placed = f.visit.placed.get(k),
        raised = placed === undefined ? f.visit.placedWith.get(k) : undefined,
        from = placed ?? raised?.rung;
      const what: string[] = [];
      if (placed !== undefined) what.push(`placed at ${at(placed)}`);
      else if (raised) what.push(`placed at ${at(raised.rung)} with ${titles.get(raised.by) ?? 'another step'}`);
      const fresh = after.certified.filter((x) => !(before?.certified ?? []).some((y) => Math.abs(x - y) < 1e-9));
      if (after.learned && !before?.learned) what.push('learned');
      else if (fresh.length) what.push(`certified at ${pct(Math.max(...fresh))}`);
      if (from !== undefined) {
        if (after.rung > from) what.push(`then up to ${at(after.rung)} of the goal tempo`);
      } else if (after.rung > (before?.rung ?? 0)) what.push(`up to ${at(after.rung)} of the goal tempo`);
      if (f.visit.overnight.has(k)) what.push('stuck overnight');
      if (what.length) moved.push({ ...step, what, key: k, by: raised?.by });
    }
  // Steps a placement raised come right after the step that was placed.
  const order = moved.filter((m) => !m.by || !moved.some((x) => x.key === m.by));
  for (const m of moved.filter((x) => x.by && moved.some((y) => y.key === x.by))) {
    const at = order.findIndex((x) => x.key === m.by);
    let end = at + 1;
    while (end < order.length && order[end].by === m.by) end++;
    order.splice(end, 0, m);
  }
  // Every other piece whose saved steps made progress in this visit, in one line each.
  const counts = new Map<string, number>();
  for (const [k, after] of Object.entries(f.units)) {
    const pack = packOf(k);
    if (pack === f.piece.pack || !movedUp(f.visit.before.get(k), after)) continue;
    counts.set(pack, (counts.get(pack) ?? 0) + 1);
  }
  const others = [...counts]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(
      ([pack, n]) =>
        `Also in this visit: ${n} step${n === 1 ? '' : 's'} made progress in ${f.title(pack) ?? 'another piece'}.`,
    );
  const row = f.tomorrow.find((r) => r.slot !== 'listen' && r.slot !== 'warm'),
    words = row && ahead[row.slot]?.(row.unit);
  return {
    clean: f.clean,
    aim: f.aim,
    stars,
    moved: order.map(({ title, course, what }) => (course ? { title, course, what } : { title, what })),
    others,
    level: Object.entries(f.units).every(([k, after]) => !movedUp(f.visit.before.get(k), after)),
    next: row && words ? `Tomorrow's plan: ${row.unit.title} ${words}.` : undefined,
  };
}

const esc = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const named = (s: VisitStep) => `${esc(s.title)}${s.course ? ` <span class="muted">· ${esc(s.course)}</span>` : ''}`;
/** The card: clean takes against the daily aim on the ring, stars gained, what moved, one line ahead. */
export function visitHtml(s: VisitSummary): string {
  const fill = Math.min(100, Math.round((s.clean / Math.max(1, s.aim)) * 100));
  // No clean take yet: the ring is the track alone (a zero-length stroke with a round cap would draw a dot).
  const ring = `<svg class="visit-ring" width="44" height="44" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="18" class="track"/>${fill > 0 ? `<circle cx="22" cy="22" r="18" class="fill" pathLength="100" stroke-dasharray="${fill} 100" transform="rotate(-90 22 22)"/>` : ''}</svg>`;
  const aim = `<div class="visit-aim">${ring}<p>Clean takes today: <strong>${s.clean} of ${s.aim}</strong>${s.clean >= s.aim ? ' · aim reached' : ''}<span class="muted">Your daily aim is ${s.aim} clean take${s.aim === 1 ? '' : 's'}</span></p></div>`;
  const stars = s.stars.length
    ? `<h4 class="visit-head">Stars this visit</h4><ul class="visit-list visit-stars">${s.stars.map((x) => `<li>${starsHtml(x.stars)}<span>${named(x)} <span class="muted">· ${esc(x.news)}</span></span></li>`).join('')}</ul>`
    : '';
  const moved = s.moved.length
    ? `<h4 class="visit-head">What moved</h4><ul class="visit-list visit-moved">${s.moved.map((x) => `<li><span>${named(x)}</span><span class="muted">${esc(x.what.join(', '))}</span></li>`).join('')}</ul>`
    : '';
  const others = s.others.map((line) => `<p class="visit-other">${esc(line)}</p>`).join('');
  // Where things stand, not what happened: only when nothing is listed above and no saved step ended higher than it
  // started. A step that ended higher without being listed (one in no listed course) leaves the card without it.
  const none =
    s.stars.length || s.moved.length || s.others.length || !s.level
      ? ''
      : '<p class="muted">No step ended this visit higher than it started.</p>';
  return `<div class="visit-card">${aim}${stars}${moved}${others}${none}${s.next ? `<p class="visit-next">${esc(s.next)}</p>` : ''}</div>`;
}

/** The open piece's three courses as the page keys their progress: piano (''), guitar ('#guitar-piece'), accompaniment ('#guitar'). */
export function pieceCourses(
  pack: string,
  current: string,
  piano: readonly Unit[],
  guitar: readonly Unit[],
  accompaniment: readonly Unit[],
): VisitPiece {
  const courses = (
    [
      ['piano', piano, ''],
      ['guitar', guitar, '#guitar-piece'],
      ['accompaniment', accompaniment, '#guitar'],
    ] as const
  ).map(([name, units, tag]) => ({
    name,
    units,
    key: (id: string) => progressId(`${pack}${tag}`, id),
    current: tag === current,
  }));
  return { pack, courses };
}
/** A piece's title as the picker shows it (its own title, else its id), or undefined when it is not there any more. */
export function titleIn(packs: readonly { id: string; text: string }[], id: string): string | undefined {
  const found = packs.find((p) => p.id === id);
  return found && (pieceMeta(found.text).title ?? found.id);
}
/** The start of the next calendar day after now, in local time, as dayOf in progress.ts tells days apart. */
export function nextDay(now: number): number {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

/**
 * What Finish shows: the card after a counted take in this visit; otherwise the one sentence the page has always
 * given (today's clean takes of all takes, what moved, the next step in today's plan). plan: suggestToday at a time.
 * Tomorrow's line is read from the plan at the start of tomorrow, so what it names is in tomorrow's plan all day.
 */
export function finishView(f: {
  progress: Pick<PieceProgress, 'units' | 'dailyGoal' | 'log'>;
  visit: VisitFacts['visit'];
  piece: VisitPiece;
  title: VisitFacts['title'];
  notes: readonly string[];
  plan: (time: number) => readonly PlanRow[];
  now: number;
}): { html: string } | { text: string } {
  const { clean, takes } = week(f.progress.log, f.now).days[6];
  const card = visitSummary({
    piece: f.piece,
    visit: f.visit,
    units: f.progress.units,
    title: f.title,
    clean,
    aim: f.progress.dailyGoal,
    tomorrow: f.plan(nextDay(f.now)),
    now: f.now,
  });
  if (card) return { html: visitHtml(card) };
  const next = f.plan(f.now).find((p) => p.slot !== 'warm' && p.slot !== 'listen');
  return {
    text: `Today: ${clean} clean take${clean === 1 ? '' : 's'} of ${takes}. ${f.notes.length ? f.notes.join('. ') + '. ' : 'Steady, deliberate practice counts even when nothing moved up today. '}${next ? `Next time: ${next.unit.title}.` : ''}`,
  };
}
