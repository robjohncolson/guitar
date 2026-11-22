import { runLine, takeStars, type Stars, type StepStars } from './game';
import { floorPct } from './loop';

/** One segment of the tempo ladder. pct is the rung's share of the goal tempo, in whole percent. */
export interface LadderRung {
  bpm: number;
  pct: number;
  certify: boolean;
  certified: boolean;
}
export interface LadderView {
  rungs: LadderRung[];
  at: number;
  /** Ahead rungs are placement-target buttons; target is the chosen one. */
  pick: boolean;
  target: number;
  /** plain: clean takes at this tempo toward the next step (of 2, not necessarily in a row); cert: fading help on a certification rung (support 0..2). Omitted = no pips. */
  pips?: { kind: 'plain'; clean: number } | { kind: 'cert'; support: number };
  dim?: boolean;
  /** A confirmed clean answer just happened: 'pip' pops the newest filled pip, 'climb' slides the current segment. */
  pop?: 'pip' | 'climb';
}

const GEM = '<span class="gem" aria-hidden="true">◆</span>';
const esc = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const pip = (on: boolean, pop: boolean) => `<span class="pip${on ? ' on' : ''}${pop ? ' pop' : ''}"></span>`;
/** The pips are for the eye only; the caption carries their words. */
function pipRow(pips: NonNullable<LadderView['pips']>, pop: boolean): string {
  if (pips.kind === 'plain') {
    const filled = Math.max(0, Math.min(2, pips.clean));
    return `<div class="pip-row"><span class="pip-group" aria-hidden="true">${[0, 1].map((i) => pip(i < filled, pop && i === filled - 1)).join('')}</span><span class="pip-caption">${filled} of 2 clean takes</span></div>`;
  }
  const filled = Math.max(0, Math.min(3, pips.support));
  return `<div class="pip-row"><span class="pip-group" aria-hidden="true">${['Notes', 'Memory', 'Click'].map((name, i) => `<span class="pip-item">${pip(i < filled, pop && i === filled - 1)}${name}</span>`).join('')}</span><span class="pip-caption">Help level ${pips.support + 1} of 3</span></div>`;
}

/**
 * The tempo ladder: one segment per rung (passed, the current one, ahead), then the pips under it. While `pick`, each
 * ahead segment is a button that chooses the placement target. All input is numbers, so nothing here needs escaping.
 */
export function ladderHtml(v: LadderView): string {
  const segments = v.rungs
    .map((r, i) => {
      const mark = `${r.certify ? ' certify' : ''}${r.certified ? ' certified' : ''}`,
        inner = `${r.bpm}${r.certify ? GEM : ''}`;
      if (i < v.at) return `<span class="rung passed${mark}">${inner}</span>`;
      if (i === v.at)
        return `<span class="rung now${v.pop === 'climb' ? ' slide' : ''}${mark}" aria-current="step">${inner}</span>`;
      if (!v.pick) return `<span class="rung ahead${mark}">${inner}</span>`;
      return `<button type="button" class="rung ahead rung-pick${i === v.target ? ' on' : ''}${mark}" data-rung="${i}" aria-pressed="${i === v.target}" aria-label="Place at ${Math.round(r.pct)}%: ${r.bpm} BPM">${inner}</button>`;
    })
    .join('');
  return `<div class="ladder${v.dim ? ' dim' : ''}" role="group" aria-label="Tempo step ${v.at + 1} of ${v.rungs.length}">${segments}</div>${v.pips ? pipRow(v.pips, v.pop === 'pip') : ''}`;
}

export interface ScoreView {
  trusted: boolean;
  reason: string;
  score: number;
  timing: number;
  pitch: number | null;
  keys: boolean;
  estimate: boolean;
  /** Keys and MIDI takes: the longest run of right, on-time attacks (keyStats). Shown from 5 up. */
  run?: number;
}

const MARKS =
  '<span class="score-tick" style="left:65%"></span><span class="score-tick clean" style="left:80%"></span>';
const bar = (s: number) =>
  `<div class="score-bar" role="img" aria-label="${s}%, with marks at 65% and 80%. 80% counts as clean."><span class="score-fill" style="width:${Math.max(0, Math.min(100, s))}%"></span>${MARKS}</div><div class="score-ticks" aria-hidden="true"><span style="left:65%">65%</span><span style="left:80%">80%</span></div><p class="score-rule">80% counts as clean</p>`;

/** Three stars, filled or empty, drawn by CSS (no glyphs); the label carries the words. */
const starSpans = (stars: Stars) =>
  [0, 1, 2].map((i) => `<span class="star${i < stars ? ' on' : ''}" aria-hidden="true"></span>`).join('');

/**
 * The take's score card: a row of three stars first, the score (the lower of timing and notes) beside it, what each part
 * scored with the lower one marked, and a bar with marks at 65% and 80%. A take that could not be judged shows its reason
 * and no stars, no percentage and no bar. Every percentage is rounded down (floorPct), so "90%" always means 90.0% or better.
 */
export function scoreHtml(v: ScoreView): string {
  const stars = takeStars(v.score, v.trusted, !v.estimate);
  if (!stars)
    return `<div class="score-head"><strong class="score-num">Not scored</strong><p class="score-why">${esc(v.reason)}</p></div>`;
  const s = floorPct(v.score),
    t = floorPct(v.timing),
    estimate = v.estimate ? '<span class="score-est"> · estimate</span>' : '';
  let label = 'Score: on time. Notes were not checked.',
    split = '';
  if (v.pitch !== null) {
    // Timing is the lower one when the two are equal.
    const lowerIsPitch = v.pitch < v.timing,
      notes = `${floorPct(v.pitch)}% ${v.keys ? 'right keys' : 'notes heard'}`,
      timing = `${t}% on time`;
    label = 'Score: the lower of the two';
    split = `<p class="score-split">${lowerIsPitch ? timing : `<strong class="lower">${timing}</strong>`} · ${lowerIsPitch ? `<strong class="lower">${notes}</strong>` : notes}</p>`;
  }
  const run = v.keys && v.run !== undefined ? runLine(v.run) : undefined,
    row = `<span class="stars take-stars${stars.estimate ? ' estimate' : ''}" role="img" aria-label="${stars.stars} of 3 stars${stars.estimate ? ', estimate' : ''}">${starSpans(stars.stars)}</span>`;
  return `<div class="score-head scored"><div class="score-top">${row}<strong class="score-num">${s}%</strong></div><div class="score-meta"><p class="score-label">${label}${estimate}</p>${split}${run ? `<p class="score-run">${run}</p>` : ''}</div></div>${bar(s)}`;
}

export interface MetricsView {
  trusted: boolean;
  timing: number;
  pitch: number | null;
  keys: boolean;
  timed: boolean;
  piano: boolean;
}
/**
 * The take details' metrics line: the on-time share (its number counts up during the reveal) and the notes. An unscored
 * take shows no percentage at all, only that it was not scored.
 */
export function metricsHtml(v: MetricsView): string {
  if (!v.trusted) return '<span>Not scored</span>';
  const final = floorPct(v.timing);
  return `<span><strong id="piece-count" aria-hidden="true">${final}%</strong><span class="sr-only">${final}%</span> on time${v.timed ? '' : ' · estimate'}</span>${v.pitch === null ? `<span>${v.piano ? 'Notes mostly unchecked' : 'Timing only'}</span>` : `<span><strong>${floorPct(v.pitch)}%</strong> ${v.keys ? 'right keys' : 'notes heard right'}</span>`}`;
}

const SEAL =
  '<svg class="seal" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7"/><path d="M4.6 8.3l2.2 2.2 4.6-4.7"/></svg>';
const SEAL_DUE =
  '<svg class="seal due" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7"/><path d="M8 4.2V8l2.7 1.7"/></svg>';
/**
 * A step's stars where steps are listed: three stars from saved progress, then a seal when it is learned. A review that is
 * due puts a small clock on the seal; the stars never dim or go. The label carries the words.
 */
export function starsHtml(s: StepStars): string {
  const label = `${s.stars} of 3 stars${s.learned ? ', learned' : ''}${s.due ? ', review due' : ''}`;
  return `<span class="stars step-stars" role="img" aria-label="${label}">${starSpans(s.stars)}${s.learned ? (s.due ? SEAL_DUE : SEAL) : ''}</span>`;
}
