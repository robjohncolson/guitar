import type { Grade } from './grader';

/** One chip under a take: a bold value (null for a plain label) and what it measures. */
export interface MetricChip {
  value: string | null;
  label: string;
}

/** What the take card shows. The page only renders this; the decision lives here. */
export interface ResultView {
  scored: boolean;
  /** "Not scored" for a take that could not be judged; empty for a scored take. */
  headline: string;
  /** Why the take was not scored; empty for a scored take. */
  reason: string;
  metrics: MetricChip[];
  details: string;
  /** Whether the "Felt comfortable" / "Needs more room" answer is offered. */
  comfort: boolean;
  /** The status line under the actions. A take that was not scored says only that; its reason is on the card. */
  status: string;
}

export const NOT_SCORED = 'Not scored';
export const NO_PROGRESS = 'This take will not change your progress.';
/** Status line for a take that could not be judged, worded as on the Pieces page (loop.ts takeStatus). */
export const NOT_SCORED_STATUS = 'Take finished. Not scored.';
export const ESTIMATE = ' Timing is an estimate until you calibrate; this take will not change your level.';
const NEXT = 'Start the next take when ready.';

const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * Decides what the Trainer shows after a graded take. A take the grader could not judge (distorted input, interrupted
 * timing, gaps or unclear notes) shows "Not scored", its reason and that it leaves progress alone: no percentages, no
 * per-note marks and no comfort answer, since neither answer would change anything; the status line says only "Take
 * finished. Not scored." so the reason is not repeated. A scored take shows its timing, notes (or "rhythm only") and
 * release chips, the per-note marks, the grader's suggestion (with the estimate note when timing is uncalibrated), and
 * asks for the comfort answer.
 */
export function resultView(result: Grade, calibrated: boolean): ResultView {
  if (!result.trusted) {
    const reason = result.reason || 'This take could not be judged.';
    return {
      scored: false,
      headline: NOT_SCORED,
      reason,
      metrics: [],
      details: reason.includes(NO_PROGRESS) ? NEXT : `${NO_PROGRESS} ${NEXT}`,
      comfort: false,
      status: NOT_SCORED_STATUS,
    };
  }
  const metrics: MetricChip[] = [
    { value: pct(result.timing), label: calibrated ? 'timing' : 'timing · estimate' },
    result.pitch === null
      ? { value: null, label: 'Rhythm only · no pitch score' }
      : { value: pct(result.pitch), label: 'notes' },
  ];
  if (result.articulation !== null) metrics.push({ value: pct(result.articulation), label: 'releases' });
  const details =
    result.notes
      .map(
        (n, i) =>
          `${i + 1}: ${n.mark}${n.offset === undefined ? '' : ` (${n.offset >= 0 ? '+' : ''}${Math.round(n.offset * 1000)} ms)`}`,
      )
      .join(' · ') + (result.extras ? ` · ${result.extras} extra attacks` : '');
  return {
    scored: true,
    headline: '',
    reason: '',
    metrics,
    details,
    comfort: true,
    status: result.feedback + (calibrated ? '' : ESTIMATE),
  };
}

/** Per-note marks the timing lane may colour: only a scored take's. An unscored take draws every note plain. */
export function laneMarks(result: Grade | undefined): Grade['notes'] | undefined {
  return result?.trusted ? result.notes : undefined;
}
