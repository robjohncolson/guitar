import type { Curriculum, Unit } from './curriculum';

/** Bounded local progress for piece practice. Never stores audio. */
export const pieceProgressKey = 'piece.trainer.v1';
export interface UnitProgress {
  rung: number; clean: number; hard: number; support: 0 | 1 | 2; best: number; certified: number[];
  attempts: number; last: number; due: number; interval: number; days: string[]; learned: boolean;
}
export interface PieceTake { date: number; piece: string; unit: string; bpm: number; score: number; trusted: boolean }
export interface PieceProgress {
  version: 1; units: Record<string, UnitProgress>; goals: Record<string, number>; history: PieceTake[];
  offset: number; calibrated: boolean; calibrationKey: string; auto: boolean; checkPitch: boolean;
  selected: { piece: string; unit: string; instrument: 'piano' | 'guitar' };
}
export const DAY = 86400000;
const REVIEW_DAYS = [1, 2, 4, 8, 16, 32];
const bounded = (n: unknown, min: number, max: number, fallback: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback);
export const initialUnit = (): UnitProgress => ({ rung: 0, clean: 0, hard: 0, support: 0, best: 0, certified: [], attempts: 0, last: 0, due: 0, interval: 0, days: [], learned: false });
export const progressId = (piece: string, unit: string) => `${piece}|${unit}`;

export function parsePieceProgress(raw: string | null, fallbackCalibration?: { offset: number; calibrated: boolean; calibrationKey: string }): PieceProgress {
  const result: PieceProgress = { version: 1, units: {}, goals: {}, history: [], offset: fallbackCalibration?.offset ?? 0, calibrated: fallbackCalibration?.calibrated ?? false, calibrationKey: fallbackCalibration?.calibrationKey ?? '', auto: true, checkPitch: true, selected: { piece: '', unit: '', instrument: 'piano' } };
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
      .map((h: PieceTake) => ({ date: h.date, piece: String(h.piece).slice(0, 120), unit: String(h.unit).slice(0, 160), bpm: h.bpm, score: Math.max(0, Math.min(1, h.score)), trusted: h.trusted === true }));
  } catch { /* An old or unreadable save never blocks practice. */ }
  return result;
}

export const dayOf = (time: number) => { const d = new Date(time); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const rungBpm = (unit: Unit, p: UnitProgress, goal = unit.goalBpm) => Math.max(20, Math.round(goal * unit.rungs[Math.min(p.rung, unit.rungs.length - 1)]));
export const reached = (p: UnitProgress | undefined, fraction: number) => Boolean(p && (p.best >= fraction - 1e-9 || p.certified.some(c => c >= fraction - 1e-9)));

/** Between attempts only. Clean = trusted, 90% or better and comfortable. Two clean takes climb a rung; certification rungs fade support over three. */
export function advanceUnit(unit: Unit, before: UnitProgress, result: { trusted: boolean; score: number }, comfortable: boolean, now: number, calibrated: boolean): { progress: UnitProgress; message: string } {
  const p: UnitProgress = { ...before, certified: [...before.certified], days: [...before.days] };
  if (!result.trusted) return { progress: p, message: 'Same tempo. An unclear recording does not count either way.' };
  if (!calibrated) return { progress: p, message: 'Calibrate timing to save tempo steps. Keep practising meanwhile.' };
  p.attempts++; p.last = now;
  const fraction = unit.rungs[Math.min(p.rung, unit.rungs.length - 1)], top = p.rung >= unit.rungs.length - 1;
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
      if (!p.learned && p.days.length >= 2) { p.learned = true; p.interval = 1; p.due = now + DAY; return { progress: p, message: 'Learned: certified at the goal tempo on two different days. It will come back for review.' }; }
      return { progress: p, message: p.learned ? 'Steady at the goal tempo.' : 'Certified at the goal tempo. Do it again on another day to call it learned.' };
    }
    p.rung++;
    return { progress: p, message: `Certified at ${Math.round(fraction * 100)}%. ${unit.rungs[p.rung] ? `Next: ${Math.round(unit.rungs[p.rung] * 100)}% of the goal tempo.` : ''}`.trim() };
  }
  if (p.clean >= 2 && !top) { p.clean = 0; p.rung++; return { progress: p, message: `Two clean takes. Next: ${Math.round(unit.rungs[p.rung] * 100)}% of the goal tempo.` }; }
  return { progress: p, message: top ? 'Clean at the goal tempo.' : 'Clean. One more like that moves the tempo up.' };
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

/** A short session: a key drill to warm up, due reviews, at most two units in progress or next in line, then one play-through. */
export function suggestToday(curriculum: Curriculum, get: (id: string) => UnitProgress | undefined, now: number): { unit: Unit; reason: string }[] {
  const plan: { unit: Unit; reason: string }[] = [], used = new Set<string>();
  const add = (unit: Unit | undefined, reason: string) => { if (unit && !used.has(unit.id)) { used.add(unit.id); plan.push({ unit, reason }); } };
  const active = curriculum.units.filter(u => !u.sameAs && u.kind !== 'listen');
  const drills = active.filter(u => u.kind === 'drill' && !u.optional).sort((a, b) => (get(a.id)?.last ?? 0) - (get(b.id)?.last ?? 0));
  add(drills[0], 'Warm up in the key');
  for (const u of active.filter(u => unitState(u, get(u.id), now) === 'due').sort((a, b) => get(a.id)!.due - get(b.id)!.due).slice(0, 2)) add(u, 'Due for review');
  if (!get('listen')?.attempts) add(curriculum.units.find(u => u.kind === 'listen'), 'Hear it before you start');
  const open = active.filter(u => u.kind !== 'drill' && ['new', 'practising'].includes(unitState(u, get(u.id), now)) && ready(u, get));
  const started = open.filter(u => get(u.id)?.attempts).sort((a, b) => (get(b.id)?.last ?? 0) - (get(a.id)?.last ?? 0));
  for (const u of [...started, ...open.filter(u => !get(u.id)?.attempts)].slice(0, 2)) add(u, get(u.id)?.attempts ? 'Continue' : 'Next step');
  const runs = active.filter(u => ['section', 'performance', 'seam', 'together'].includes(u.kind) && ready(u, get) && get(u.id)?.attempts).sort((a, b) => b.bars.length - a.bars.length);
  add(runs[0], 'Play through without stopping');
  return plan;
}
