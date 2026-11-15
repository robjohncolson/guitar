import type { UnitState } from './progress';

/** The top bar's status chip: the input, and its worst state. A phone shows the one-word form. */
export interface Chip { long: string; short: string; warn: boolean }
export function statusChip(s: { keys: boolean; midi: boolean; tooLoud: boolean; calibrated: boolean }): Chip {
  if (s.keys) return { long: s.midi ? 'Keys · MIDI' : 'Keys', short: 'Keys', warn: false };
  if (s.tooLoud) return { long: 'Mic too loud', short: 'Too loud', warn: true };
  if (!s.calibrated) return { long: 'Calibrate', short: 'Calibrate', warn: true };
  return { long: 'Mic · calibrated', short: 'Mic', warn: false };
}

/** The Today chip: steps of today's plan done, of all of them. */
export function todayChip(done: number, total: number): Chip & { label: string } {
  if (total <= 0) return { long: 'Today', short: 'Today', warn: false, label: "Today's practice" };
  const d = Math.max(0, Math.min(done, total));
  return { long: `Today ${d} of ${total}`, short: `${d}/${total}`, warn: false, label: `Today ${d} of ${total}: steps of today's practice done` };
}

/** True while the menu or the free-tempo box is open. */
export const overlayOpen = (drawer: boolean, popover: boolean) => drawer || popover;
/** Whether a key may act on the page: while an overlay is open only Escape does (it stops everything and closes it). */
export const keyAllowed = (open: boolean, code: string) => !open || code === 'Escape';

/**
 * The lane's height. Phones: clamp(180, 100dvh − 500, 300), and no taller than the room above the sticky block; after a
 * take, while its card is open, 160. Desktop: min(440, 100vh − 360), no taller than the room above Start, never under
 * 300 (250 while a result card or NOTICE shows). laneTop: the lane's top on the page; below: on phones the sticky
 * block's height, on desktop the distance from the lane's bottom to the bottom of Start (or the answer buttons).
 */
export function laneHeight(v: { phone: boolean; vh: number; laneTop: number; below: number; card: boolean; notice: boolean }): number {
  const fit = Math.floor(v.vh - v.laneTop - v.below - 8);
  if (v.phone) {
    if (v.card) return 160;
    return Math.max(180, Math.min(300, v.vh - 500, fit));
  }
  return Math.max(v.card || v.notice ? 250 : 300, Math.min(440, v.vh - 360, fit));
}

/** "Next in today's plan" shows on stage once the step is finished: certified at its top, learned, or just placed. */
export const stepFinished = (state: UnitState, placed: boolean) => placed || state === 'done' || state === 'learned';
