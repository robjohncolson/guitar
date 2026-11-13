import type { EventResult } from './grade';
import type { TakeBest } from './progress';

/**
 * Personal bests and take-over-take changes, per step, tempo (absolute BPM) and input. Microphone and keys records
 * are kept apart because their timing evidence differs. Only trusted, timed takes ever reach these functions' records.
 */
export const bestKey = (unitId: string, bpm: number, keys: boolean) => `${unitId}@${bpm}${keys ? 'k' : 'm'}`;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : undefined; };
const ms = (seconds: number, approx: boolean) => approx ? Math.round(seconds * 100) * 10 : Math.round(seconds * 1000);

/** Median distance from the beat in ms over the attacks that were placed; undefined when none were. */
export function tightness(events: readonly EventResult[], approx = false): number | undefined {
  const m = median(events.filter(e => e.offset !== undefined).map(e => Math.abs(e.offset!)));
  return m === undefined ? undefined : ms(m, approx);
}

/** Keys takes: notes in the tighter "perfect" tier, and the longest run of attacks on time with every key right. */
export function keyStats(events: readonly EventResult[]): { perfect: number; run: number } {
  let perfect = 0, run = 0, now = 0;
  for (const e of [...events].sort((a, b) => a.beat - b.beat)) {
    const right = (e.mark === 'good') && e.notes.every(n => n.verdict === 'heard');
    if (right && e.tier === 'perfect') perfect += e.notes.length;
    now = right ? now + 1 : 0; run = Math.max(run, now);
  }
  return { perfect, run };
}

/** One line on where the timing sat: the median offset and how wide the middle half spread. Empty when nothing was placed. */
export function timingSummary(events: readonly EventResult[], approx = false): string {
  const offsets = events.filter(e => e.offset !== undefined).map(e => e.offset!);
  if (!offsets.length) return '';
  const mid = ms(median(offsets)!, approx), spread = ms(median(offsets.map(Math.abs))!, approx), about = approx ? 'about ' : '';
  const where = Math.abs(mid) < (approx ? 10 : 5) ? 'centred on the beat' : `${about}${Math.abs(mid)} ms ${mid < 0 ? 'early' : 'late'} on average`;
  return `Timing ${where}; half the notes within ${about}${spread} ms of it.`;
}

export interface TakeFacts { score: number; timing: number; tight?: number; support: number; date: number }
/**
 * Compares a take with the record for its step, tempo and input. Lines lead with what improved; an untrusted take
 * changes nothing and earns no line. The first counted take sets the record without claiming an improvement.
 */
export function compareTake(before: TakeBest | undefined, take: TakeFacts, trusted: boolean, approx = false): { after: TakeBest | undefined; wins: string[] } {
  if (!trusted) return { after: before, wins: [] };
  const pct = (x: number) => `${Math.round(x * 100)}%`, wins: string[] = [], about = approx ? 'about ' : '';
  const memory = take.support >= 1 && take.score >= 0.9;
  if (!before) {
    wins.push(`First counted take at this tempo: ${pct(take.score)}.`);
    if (memory) wins.push('Clean from memory on the first counted take at this tempo.');
  } else {
    if (Math.round(take.score * 100) > Math.round(before.score * 100)) wins.push(`New best at this tempo: ${pct(take.score)} (was ${pct(before.score)}).`);
    const delta = Math.round(take.timing * 100) - Math.round(before.last * 100);
    if (delta > 0) wins.push(`+${delta}% on time versus your last take.`);
    if (take.tight !== undefined && take.tight < before.tight) wins.push(`Tightest timing yet: ${about}${take.tight} ms from the beat (was ${about}${before.tight}).`);
    if (memory && !before.memory) wins.push('First clean take from memory at this tempo.');
  }
  const after: TakeBest = {
    score: Math.max(before?.score ?? 0, take.score), tight: Math.min(before?.tight ?? 1000, take.tight ?? 1000), last: take.timing,
    memory: Boolean(before?.memory) || memory, date: take.date,
  };
  return { after, wins };
}

/** Keeps the record store bounded: the most recently used entries win. */
export function pruneBests(bests: Record<string, TakeBest>, max = 400): void {
  const ids = Object.keys(bests);
  if (ids.length <= max) return;
  for (const id of ids.sort((a, b) => bests[a].date - bests[b].date).slice(0, ids.length - max)) delete bests[id];
}
