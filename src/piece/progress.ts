import type { Curriculum, Unit } from './curriculum';

/** Bounded local progress for piece practice. Never stores audio. */
export const pieceProgressKey = 'piece.trainer.v1';
export interface UnitProgress {
  rung: number; clean: number; hard: number; support: 0 | 1 | 2; best: number; certified: number[];
  attempts: number; last: number; due: number; interval: number; days: string[]; learned: boolean;
}
/** clean: set when the take is answered (trusted, 90% or better and comfortable); absent until then. */
export interface PieceTake { date: number; piece: string; unit: string; bpm: number; score: number; trusted: boolean; clean?: boolean }
/** One practised day: every take, the clean ones, and seconds of playing (takes and Wait for me runs). */
export interface DayLog { day: string; takes: number; clean: number; seconds: number }
/** Today's checklist for one course, fixed when it is first shown that day so it has an end. */
export interface TodayPlan { day: string; rows: { id: string; reason: string; slot: PlanSlot }[] }
export interface PieceProgress {
  version: 1; units: Record<string, UnitProgress>; goals: Record<string, number>; history: PieceTake[];
  offset: number; calibrated: boolean; calibrationKey: string; auto: boolean; checkPitch: boolean;
  selected: { piece: string; unit: string; instrument: 'piano' | 'guitar' };
  /** Personal bests per step, tempo and input (see bests.ts). Trusted takes only. */
  bests: Record<string, TakeBest>;
  /** About 120 practised days, oldest first. */
  log: DayLog[];
  /** The learner's own daily aim, in clean takes. */
  dailyGoal: number;
  /** Today's checklist per course (piece id, plus #guitar). Other days are dropped. */
  today: Record<string, TodayPlan>;
}
/** A step's record at one tempo and input: best score, tightest median timing (ms), last take's on-time share, a clean take from memory. */
export interface TakeBest { score: number; tight: number; last: number; memory: boolean; date: number }
export const DAY = 86400000;
const REVIEW_DAYS = [1, 2, 4, 8, 16, 32];
export const LOG_DAYS = 120;
const bounded = (n: unknown, min: number, max: number, fallback: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback);
export const initialUnit = (): UnitProgress => ({ rung: 0, clean: 0, hard: 0, support: 0, best: 0, certified: [], attempts: 0, last: 0, due: 0, interval: 0, days: [], learned: false });
export const progressId = (piece: string, unit: string) => `${piece}|${unit}`;

export function parsePieceProgress(raw: string | null, fallbackCalibration?: { offset: number; calibrated: boolean; calibrationKey: string }): PieceProgress {
  const result: PieceProgress = { version: 1, units: {}, goals: {}, history: [], offset: fallbackCalibration?.offset ?? 0, calibrated: fallbackCalibration?.calibrated ?? false, calibrationKey: fallbackCalibration?.calibrationKey ?? '', auto: true, checkPitch: true, selected: { piece: '', unit: '', instrument: 'piano' }, bests: {}, log: [], dailyGoal: 6, today: {} };
  try {
    const value = JSON.parse(raw ?? '{}');
    if (!value || value.version !== 1) return result;
    result.offset = bounded(value.offset, -0.3, 0.5, 0); result.calibrated = value.calibrated === true; result.auto = value.auto !== false; result.checkPitch = value.checkPitch !== false;
    result.calibrationKey = typeof value.calibrationKey === 'string' && value.calibrationKey.length < 300 ? value.calibrationKey : '';
    if (value.selected && typeof value.selected === 'object') result.selected = { piece: String(value.selected.piece ?? '').slice(0, 120), unit: String(value.selected.unit ?? '').slice(0, 160), instrument: value.selected.instrument === 'guitar' ? 'guitar' : 'piano' };
    for (const [id, g] of Object.entries(value.goals ?? {})) if (id.length < 120) result.goals[id] = Math.round(bounded(g, 20, 240, 60));
    for (const [id, saved] of Object.entries(value.units ?? {}).slice(0, 4000)) {
      const s = saved as Partial<UnitProgress>;
      if (id.length > 300 || !s || typeof s !== 'object') continue;
      result.units[id] = {
        rung: Math.floor(bounded(s.rung, 0, 20, 0)), clean: 0, hard: 0, support: Math.floor(bounded(s.support, 0, 2, 0)) as 0 | 1 | 2,
        best: bounded(s.best, 0, 1.2, 0), certified: Array.isArray(s.certified) ? s.certified.filter(c => typeof c === 'number' && c > 0 && c <= 1.2).slice(0, 10) : [],
        attempts: Math.floor(bounded(s.attempts, 0, 1e6, 0)), last: bounded(s.last, 0, 1e14, 0), due: bounded(s.due, 0, 1e14, 0), interval: bounded(s.interval, 0, 365, 0),
        days: Array.isArray(s.days) ? s.days.filter(d => typeof d === 'string' && /^\d{4}-\d\d-\d\d$/.test(d)).slice(-10) : [], learned: s.learned === true,
      };
    }
    if (Array.isArray(value.history)) result.history = value.history.filter((h: PieceTake) => h && typeof h.unit === 'string' && Number.isFinite(h.date) && Number.isFinite(h.bpm) && Number.isFinite(h.score)).slice(-200)
      .map((h: PieceTake) => ({ date: h.date, piece: String(h.piece).slice(0, 120), unit: String(h.unit).slice(0, 160), bpm: h.bpm, score: Math.max(0, Math.min(1, h.score)), trusted: h.trusted === true, ...(typeof h.clean === 'boolean' ? { clean: h.clean && h.trusted === true } : {}) }));
    if (Array.isArray(value.log)) result.log = value.log.filter((d: DayLog) => d && typeof d.day === 'string' && /^\d{4}-\d\d-\d\d$/.test(d.day))
      .map((d: DayLog) => ({ day: d.day, takes: Math.floor(bounded(d.takes, 0, 1e5, 0)), clean: Math.floor(bounded(d.clean, 0, 1e5, 0)), seconds: Math.round(bounded(d.seconds, 0, 86400, 0)) })).slice(-LOG_DAYS);
    result.dailyGoal = Math.round(bounded(value.dailyGoal, 1, 60, 6));
    for (const [id, t] of Object.entries((value.today && typeof value.today === 'object' ? value.today : {}) as Record<string, TodayPlan>).slice(0, 40)) {
      if (id.length > 140 || !t || typeof t.day !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(t.day) || !Array.isArray(t.rows)) continue;
      result.today[id] = { day: t.day, rows: t.rows.filter(r => r && typeof r.id === 'string' && typeof r.reason === 'string' && SLOTS.includes(r.slot)).slice(0, 12).map(r => ({ id: r.id.slice(0, 160), reason: r.reason.slice(0, 80), slot: r.slot })) };
    }
    const bests = value.bests && typeof value.bests === 'object' ? Object.entries(value.bests as Record<string, Partial<TakeBest>>) : [];
    for (const [id, b] of bests.slice(-400)) {
      if (id.length > 320 || !b || typeof b !== 'object' || !Number.isFinite(b.score)) continue;
      result.bests[id] = { score: bounded(b.score, 0, 1, 0), tight: bounded(b.tight, 0, 1000, 1000), last: bounded(b.last, 0, 1, 0), memory: b.memory === true, date: bounded(b.date, 0, 1e14, 0) };
    }
  } catch { /* An old or unreadable save never blocks practice. */ }
  return result;
}

export const dayOf = (time: number) => { const d = new Date(time); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const rungBpm = (unit: Unit, p: UnitProgress, goal = unit.goalBpm) => Math.max(20, Math.round(goal * unit.rungs[Math.min(p.rung, unit.rungs.length - 1)]));
export const reached = (p: UnitProgress | undefined, fraction: number) => Boolean(p && (p.best >= fraction - 1e-9 || p.certified.some(c => c >= fraction - 1e-9)));

/**
 * What one answered take did to the ladder, for the moment shown after it. uncounted: unclear or not calibrated.
 * overnight: a clean take that was this step's first counted take on a new day (it stuck overnight).
 */
export type AdvanceKind = 'uncounted' | 'hold' | 'climb' | 'fade' | 'certified' | 'learned' | 'review' | 'step-down' | 'placed';
export interface AdvanceEvent { kind: AdvanceKind; clean: boolean; overnight: boolean }
/** Between attempts only. Clean = trusted, 90% or better and comfortable. Two clean takes climb a rung; certification rungs fade support over three. */
export function advanceUnit(unit: Unit, before: UnitProgress, result: { trusted: boolean; score: number }, comfortable: boolean, now: number, calibrated: boolean): { progress: UnitProgress; message: string; event: AdvanceEvent } {
  const step = ladder(unit, before, result, comfortable, now, calibrated), counted = result.trusted && calibrated, clean = counted && result.score >= 0.9 && comfortable;
  const overnight = clean && before.attempts > 0 && before.last > 0 && dayOf(before.last) !== dayOf(now);
  const m = step.message, p = step.progress;
  const kind: AdvanceKind = !counted ? 'uncounted' : m.startsWith('Review passed') ? 'review' : p.learned && !before.learned ? 'learned'
    : p.rung < before.rung || m.startsWith('Make room') || m.startsWith('It has faded') ? 'step-down' : p.certified.length > before.certified.length || m.startsWith('Certified') ? 'certified'
      : p.rung > before.rung ? 'climb' : p.support > before.support ? 'fade' : 'hold';
  return { ...step, event: { kind, clean, overnight } };
}
function ladder(unit: Unit, before: UnitProgress, result: { trusted: boolean; score: number }, comfortable: boolean, now: number, calibrated: boolean): { progress: UnitProgress; message: string } {
  const p: UnitProgress = { ...before, certified: [...before.certified], days: [...before.days] };
  if (!result.trusted) return { progress: p, message: 'Same tempo. An unclear recording does not count either way.' };
  if (!calibrated) return { progress: p, message: 'Calibrate timing to save tempo steps. Keep practising meanwhile.' };
  p.attempts++; p.last = now;
  const fraction = unit.rungs[Math.min(p.rung, unit.rungs.length - 1)], top = p.rung >= unit.rungs.length - 1;
  // One hand alone stops at 80%: its top step is not the goal tempo, and the messages say so.
  const topName = fraction >= 1 - 1e-9 ? 'the goal tempo' : `${Math.round(fraction * 100)}%, the top step for one hand`;
  const clean = result.score >= 0.9 && comfortable, hard = result.score < 0.65 || !comfortable;
  if (clean) { p.clean++; p.hard = 0; p.best = Math.max(p.best, fraction); } else { p.clean = 0; p.hard = hard ? p.hard + 1 : 0; }
  if (p.learned && p.due <= now) {
    if (clean && top) { p.interval = REVIEW_DAYS[Math.min(REVIEW_DAYS.length - 1, REVIEW_DAYS.indexOf(p.interval) + 1)] ?? 1; p.due = now + p.interval * DAY; return { progress: p, message: `Review passed. Next review in ${p.interval} day${p.interval === 1 ? '' : 's'}.` }; }
    if (hard) { p.interval = 1; p.due = now + DAY; p.hard = 0; p.rung = Math.max(0, p.rung - 1); return { progress: p, message: 'It has faded a little. One step slower; it will come back quickly.' }; }
  }
  if (p.hard >= 2) {
    p.hard = 0; p.clean = 0; p.support = 0; p.rung = Math.max(0, p.rung - 1);
    return { progress: p, message: `Make room for the movement: one step slower, ${Math.round(unit.rungs[p.rung] * 100)}% of the goal tempo.` };
  }
  if (!clean) return { progress: p, message: 'Keep this tempo. Choose one detail to fix in the next take.' };
  if (unit.certify.some(c => Math.abs(c - fraction) < 1e-9)) {
    if (p.support < 2) { p.support = (p.support + 1) as 1 | 2; return { progress: p, message: p.support === 1 ? 'Clean. Next take: the falling notes hide while you play.' : 'Clean from memory. Next take: a click only on each bar.' }; }
    p.support = 0; p.clean = 0;
    if (!p.certified.some(c => Math.abs(c - fraction) < 1e-9)) p.certified.push(fraction);
    if (top) {
      const day = dayOf(now);
      if (!p.days.includes(day)) p.days.push(day);
      if (!p.learned && p.days.length >= 2) { p.learned = true; p.interval = 1; p.due = now + DAY; return { progress: p, message: `Learned: certified at ${topName} on two different days. It will come back for review.` }; }
      return { progress: p, message: p.learned ? `Steady at ${topName}.` : `Certified at ${topName}. Do it again on another day to call it learned.` };
    }
    p.rung++;
    return { progress: p, message: `Certified at ${Math.round(fraction * 100)}%. ${unit.rungs[p.rung] ? `Next: ${Math.round(unit.rungs[p.rung] * 100)}% of the goal tempo.` : ''}`.trim() };
  }
  if (p.clean >= 2 && !top) { p.clean = 0; p.rung++; return { progress: p, message: `Two clean takes. Next: ${Math.round(unit.rungs[p.rung] * 100)}% of the goal tempo.` }; }
  return { progress: p, message: top ? `Clean at ${topName}.` : 'Clean. One more like that moves the tempo up.' };
}

/** A step can be placed while it is not learned and not certified at its top tempo step; only steps above its current one are targets. */
export function canPlace(unit: Unit, p: UnitProgress | undefined, target = unit.rungs.length - 1): boolean {
  const top = unit.rungs.length - 1;
  if (unit.sameAs || unit.kind === 'listen' || top < 1 || p?.learned || (p?.certified ?? []).some(c => c >= unit.rungs[top] - 1e-9)) return false;
  return Math.min(target, top) > (p?.rung ?? 0);
}

/**
 * One take started from the placement control, at the target tempo step with notes shown. A clean take (trusted, calibrated,
 * 90% or better, comfortable) moves the step to the target and counts as its first clean take there; certification and the
 * two-day rule are untouched. Anything else records nothing: no attempt, no hard take, no step-down.
 */
export function placeUnit(unit: Unit, before: UnitProgress, target: number, result: { trusted: boolean; score: number }, comfortable: boolean, now: number, calibrated: boolean, goal = unit.goalBpm): { placed: boolean; progress: UnitProgress; message: string; event: AdvanceEvent } {
  const t = Math.min(target, unit.rungs.length - 1), stay = { ...before, certified: [...before.certified], days: [...before.days] };
  const missed = (message: string) => ({ placed: false, progress: stay, message, event: { kind: 'uncounted' as AdvanceKind, clean: false, overnight: false } });
  if (!canPlace(unit, before, t)) return missed('Already at or past that tempo step. Nothing changed.');
  const fraction = unit.rungs[t], at = `${Math.round(fraction * 100)}%: ${rungBpm(unit, { ...before, rung: t }, goal)} BPM`;
  if (!result.trusted) return missed('Not placed. An unclear recording does not count either way; nothing was recorded.');
  if (!calibrated) return missed('Not placed. Calibrate timing first; nothing was recorded.');
  if (result.score < 0.9 || !comfortable) return missed(`Not placed at ${at}. Nothing was recorded: practise from the current step, or try a lower one.`);
  const step = ladder(unit, { ...stay, rung: t, clean: 0, hard: 0, support: 0 }, result, true, now, true);
  const overnight = before.attempts > 0 && before.last > 0 && dayOf(before.last) !== dayOf(now);
  const certify = unit.certify.some(c => Math.abs(c - fraction) < 1e-9), next = unit.certify.find(c => c > fraction) ?? unit.rungs[unit.rungs.length - 1];
  const needed = certify ? 'To certify it: two more clean takes, from memory and then with a click on each bar.'
    : `One more clean take moves it up. Certifying still needs the takes with fading help at ${Math.round(next * 100)}%.`;
  return { placed: true, progress: step.progress, message: `Placed at ${at}. ${needed}`, event: { kind: 'placed', clean: true, overnight } };
}

/**
 * After a clean placement of a hands-together passage: the one-hand steps for the same bars move to their own highest tempo
 * step at or below the placed one (one hand stops at 80%). Never higher, never certified, never a learned or certified step.
 */
export function placeHands(units: Unit[], placed: Unit, fraction: number, get: (id: string) => UnitProgress | undefined): [string, UnitProgress][] {
  if (placed.kind !== 'together') return [];
  const byId = new Map(units.map(u => [u.id, u])), bars = [...new Set(placed.bars)].sort((a, b) => a - b).join(',');
  const out = new Map<string, UnitProgress>();
  for (const u of units) {
    if (u.kind !== 'hand' || [...new Set(u.bars)].sort((a, b) => a - b).join(',') !== bars) continue;
    const r = u.sameAs ? byId.get(u.sameAs) ?? u : u, p = get(r.id);
    let t = -1;
    r.rungs.forEach((f, i) => { if (f <= fraction + 1e-9) t = i; });
    if (t < 0 || out.has(r.id) || !canPlace(r, p, t)) continue;
    const base = p ?? initialUnit();
    out.set(r.id, { ...base, certified: [...base.certified], days: [...base.days], rung: t, clean: 0, hard: 0, support: 0, best: Math.max(base.best, r.rungs[t]), attempts: Math.max(base.attempts, 1) });
  }
  return [...out];
}

export type UnitState = 'new' | 'practising' | 'done' | 'learned' | 'due' | 'covered';
/** Hands-separate units are done when certified at their top rung; others need two days at the goal tempo. */
export function unitState(unit: Unit, p: UnitProgress | undefined, now: number): UnitState {
  if (unit.sameAs) return 'covered';
  if (!p || !p.attempts) return 'new';
  if (p.learned) return p.due <= now ? 'due' : 'learned';
  return p.certified.some(c => c >= unit.rungs[unit.rungs.length - 1] - 1e-9) ? 'done' : 'practising';
}
export function ready(unit: Unit, units: (id: string) => UnitProgress | undefined): boolean {
  return unit.requires.every(r => reached(units(r.id), r.at));
}

export type PlanSlot = 'listen' | 'warm' | 'review' | 'second' | 'chord' | 'phrase' | 'run';
const SLOTS: PlanSlot[] = ['listen', 'warm', 'review', 'second', 'chord', 'phrase', 'run'];
export interface PlanRow { unit: Unit; reason: string; slot: PlanSlot }
export interface Phrase { bars: Set<number>; units: Unit[]; extras: Unit[] }

/**
 * The music in learning order: passages (one hand, hands together, guitar pattern or section) grouped by the bars they
 * cover, ordered by their last bar and, for the same last bar, shorter first; so a section follows its last phrase.
 * Chords attach to the first phrase that uses them; changes and joins to the later of the phrases they touch.
 */
export function phrases(curriculum: Curriculum): Phrase[] {
  const groups = new Map<string, Phrase & { last: number; order: number }>();
  for (const [order, u] of curriculum.units.entries()) {
    if (!['hand', 'together', 'section'].includes(u.kind) || !u.bars.length) continue;
    const bars = [...new Set(u.bars)].sort((a, b) => a - b), id = bars.join(',');
    const g = groups.get(id) ?? { bars: new Set(bars), units: [], extras: [], last: bars[bars.length - 1], order };
    g.units.push(u); groups.set(id, g);
  }
  const list = [...groups.values()].sort((a, b) => a.last - b.last || a.bars.size - b.bars.size || a.order - b.order);
  if (!list.length) return [];
  for (const u of curriculum.units.filter(x => ['chord', 'change', 'seam'].includes(x.kind))) {
    const at = [...new Set(u.bars)].map(b => list.findIndex(g => g.bars.has(b))).filter(i => i >= 0);
    list[at.length ? (u.kind === 'chord' ? Math.min(...at) : Math.max(...at)) : 0].extras.push(u);
  }
  return list.map(({ bars, units, extras }) => ({ bars, units, extras }));
}

const open = (u: Unit, get: (id: string) => UnitProgress | undefined, now: number) => ['new', 'practising'].includes(unitState(u, get(u.id), now));

/**
 * A short session built around one phrase of the music: hear the piece first; then a key drill to warm up, reviews that
 * are due (two at most, oldest first), steps certified on an earlier day that need their second day (two at most), one
 * chord or change the music so far needs, today's phrase (two passages or joins at most), and one play-through.
 * Prerequisites stay advisory. Deterministic in the course and the saved progress.
 */
export function suggestToday(curriculum: Curriculum, get: (id: string) => UnitProgress | undefined, now: number): PlanRow[] {
  const plan: PlanRow[] = [], used = new Set<string>(), today = dayOf(now);
  const resolve = (u: Unit) => (u.sameAs ? curriculum.units.find(x => x.id === u.sameAs) ?? u : u);
  const add = (unit: Unit | undefined, reason: string, slot: PlanSlot) => { if (unit && !used.has(unit.id)) { used.add(unit.id); plan.push({ unit, reason, slot }); } };
  const active = curriculum.units.filter(u => !u.sameAs && u.kind !== 'listen');
  const listen = curriculum.units.find(u => u.kind === 'listen');
  if (listen && !get(listen.id)?.attempts) add(listen, 'Hear it before you start', 'listen');
  const begun = active.some(u => u.kind !== 'drill' && get(u.id)?.attempts);
  const drills = active.filter(u => u.kind === 'drill' && !u.optional).sort((a, b) => (get(a.id)?.last ?? 0) - (get(b.id)?.last ?? 0));
  if (begun) add(drills[0], 'Warm up in the key', 'warm');
  for (const u of active.filter(u => unitState(u, get(u.id), now) === 'due').sort((a, b) => get(a.id)!.due - get(b.id)!.due).slice(0, 2)) add(u, 'Due for review', 'review');
  const second = active.filter(u => { const p = get(u.id); return unitState(u, p, now) === 'done' && !p!.learned && p!.days.length > 0 && !p!.days.includes(today); });
  for (const u of second.sort((a, b) => get(a.id)!.last - get(b.id)!.last).slice(0, 2)) add(u, 'Second day: play it again', 'second');
  const music = phrases(curriculum);
  const members = (p: Phrase) => [...new Set([...p.units, ...p.extras.filter(u => u.kind === 'seam')].map(resolve))].filter(u => open(u, get, now));
  const at = music.findIndex(p => members(p).length > 0);
  const chords = music.slice(0, at < 0 ? music.length : at + 1).flatMap(p => p.extras.filter(u => u.kind !== 'seam')).map(resolve).filter(u => open(u, get, now));
  add(chords[0], chords[0]?.kind === 'change' ? 'A change the music needs' : 'A chord the music needs', 'chord');
  if (at >= 0) for (const u of members(music[at]).slice(0, 2)) add(u, u.kind === 'seam' ? 'Join it to the next phrase' : u.kind === 'section' ? "Today's section" : "Today's phrase", 'phrase');
  const runs = active.filter(u => ['section', 'performance', 'seam', 'together'].includes(u.kind) && ready(u, get) && get(u.id)?.attempts && !used.has(u.id)).sort((a, b) => b.bars.length - a.bars.length);
  add(runs[0], 'Play through without stopping', 'run');
  return plan;
}

/** A plan row is done for today from what was played today: listened, reviewed, confirmed, three clean takes, or one trusted run. */
export function rowDone(row: { unit: Unit; slot: PlanSlot }, p: UnitProgress | undefined, takesToday: Pick<PieceTake, 'trusted' | 'clean'>[], now: number): boolean {
  const state = unitState(row.unit, p, now), today = dayOf(now);
  switch (row.slot) {
    case 'listen': return Boolean(p?.attempts && dayOf(p.last) === today);
    case 'review': return takesToday.some(t => t.trusted) && state !== 'due';
    case 'second': return Boolean(p && (p.learned || p.days.includes(today)));
    case 'warm': case 'run': return takesToday.some(t => t.trusted);
    default: return takesToday.filter(t => t.clean).length >= 3 || ['done', 'learned', 'due'].includes(state);
  }
}

/** Adds to today's entry in the day log, keeping about 120 days. */
export function logDay(log: DayLog[], now: number, add: Partial<Omit<DayLog, 'day'>>): DayLog[] {
  const day = dayOf(now), last = log[log.length - 1], entry = last?.day === day ? last : { day, takes: 0, clean: 0, seconds: 0 };
  entry.takes += add.takes ?? 0; entry.clean += add.clean ?? 0; entry.seconds = Math.min(86400, entry.seconds + Math.round(add.seconds ?? 0));
  return entry === last ? log : [...log, entry].slice(-LOG_DAYS);
}
/** The last seven days, oldest first, and how many days this week (from Monday) had any playing. Nothing here ever resets. */
export function week(log: DayLog[], now: number): { days: DayLog[]; played: number } {
  const byDay = new Map(log.map(d => [d.day, d]));
  const at = (back: number) => { const d = new Date(now); d.setDate(d.getDate() - back); return dayOf(d.getTime()); };
  const days = Array.from({ length: 7 }, (_, i) => byDay.get(at(6 - i)) ?? { day: at(6 - i), takes: 0, clean: 0, seconds: 0 });
  const sinceMonday = (new Date(now).getDay() + 6) % 7;
  let played = 0;
  for (let back = 0; back <= sinceMonday; back++) if ((byDay.get(at(back))?.takes ?? 0) > 0) played++;
  return { days, played };
}
