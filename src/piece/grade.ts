import type { Exercise, XEvent } from './exercise';
import {
  attackRise,
  eventContext,
  estimateTuning,
  RULES,
  verifyEvent,
  type NoteVerdict,
  type PianoOnset,
} from './listen';
import { noteName } from './score';

/** Grading of one take: timing per attack, plus per-note evidence where the instrument and the mic allow it. */
export interface NoteResult {
  midi: number;
  verdict: NoteVerdict | 'unchecked';
  heardAs?: number;
  reason: string;
}
/** unsure: sound rose here but no clear attack was found, so timing is not judged either way. */
export interface EventResult {
  index: number;
  beat: number;
  mark: 'good' | 'early' | 'late' | 'missed' | 'unsure';
  offset?: number;
  notes: NoteResult[];
  /** Keys takes only: the timing tier; perfect is information and scores as good. */ tier?: KeyTier;
}
export interface PieceGrade {
  trusted: boolean;
  reason: string;
  events: EventResult[];
  timing: number;
  pitch: number | null;
  score: number;
  extras: number;
  extraNotes: { beat: number; midi: number }[];
  coverage: number;
  checked: number;
  unclear: number;
  cannot: number;
  tuning: number;
  feedback: string;
  offset: number;
}
export interface TakeAudio {
  samples: Float32Array;
  rate: number;
  playAt: number;
  coverage: number;
  clipped: number;
  interrupted?: boolean;
  clicks: boolean;
}
export interface Attack {
  t: number;
  midi?: number;
  confidence?: number;
  strength?: number;
}

/** Monotonic one-to-one matching of attacks to expected events; an attack is never shared. */
export function match(expected: number[], attacks: number[], reach: number): Map<number, number> {
  const rows = expected.length + 1,
    cols = attacks.length + 1;
  const cost = Array.from({ length: rows }, () => new Float64Array(cols)),
    path = Array.from({ length: rows }, () => new Uint8Array(cols));
  for (let i = 1; i < rows; i++) {
    cost[i][0] = i;
    path[i][0] = 1;
  }
  for (let j = 1; j < cols; j++) {
    cost[0][j] = j;
    path[0][j] = 2;
  }
  for (let i = 1; i < rows; i++)
    for (let j = 1; j < cols; j++) {
      const error = Math.abs(attacks[j - 1] - expected[i - 1]);
      const matched = error <= reach ? cost[i - 1][j - 1] + error / reach : Infinity,
        missing = cost[i - 1][j] + 1,
        extra = cost[i][j - 1] + 1;
      if (matched <= missing && matched <= extra) {
        cost[i][j] = matched;
        path[i][j] = 0;
      } else if (missing <= extra) {
        cost[i][j] = missing;
        path[i][j] = 1;
      } else {
        cost[i][j] = extra;
        path[i][j] = 2;
      }
    }
  const pairs = new Map<number, number>();
  for (let i = rows - 1, j = cols - 1; i || j;) {
    if (i && j && path[i][j] === 0) pairs.set(--i, --j);
    else if (i && (!j || path[i][j] === 1)) i--;
    else j--;
  }
  return pairs;
}

export const barAt = (ex: Exercise, beat: number) => {
  const bar = [...ex.bars].reverse().find((b) => b.beat <= beat + 1e-6) ?? ex.bars[0];
  return { number: bar?.number ?? 1, beat: Math.round((beat - (bar?.beat ?? 0)) * 100) / 100 + 1 };
};
const where = (ex: Exercise, beat: number) => {
  const at = barAt(ex, beat);
  return `bar ${at.number}, beat ${at.beat}`;
};

/** Piano: spectral-flux attacks plus partial evidence. Unclear evidence never counts for or against. */
/**
 * How far from the beat an attack may land and still count as on time: the learner's choice in Sound & timing.
 * Standard is 130 ms (less at fast tempos, 16% of a beat); the others scale both limits.
 */
export const LENIENCY = { tight: 0.65, standard: 1, relaxed: 1.6, loose: 2.2 } as const;
export type Leniency = keyof typeof LENIENCY;
let slack: number = LENIENCY.relaxed;
export function setLeniency(level: Leniency | number): void {
  slack = typeof level === 'number' ? level : LENIENCY[level];
}
/** The on-time window in seconds at this beat length, never wider than the reach used to pair attacks with beats. */
export const timingWindow = (period: number) =>
  Math.min(0.13 * slack, period * 0.16 * slack, Math.min(0.4, period * 0.45) * 0.9);

export function gradePiano(
  ex: Exercise,
  bpm: number,
  take: TakeAudio,
  onsets: PianoOnset[],
  offset: number,
  checkPitch = true,
): PieceGrade {
  const period = 60 / bpm,
    graded = ex.events.map((e, index) => ({ e, index })).filter((x) => x.e.grade !== 'none');
  const times = graded.map((x) => take.playAt + offset + x.e.beat * period);
  const strong = onsets.filter((o) => o.strength >= 0.12);
  const pairs = match(
      times,
      strong.map((o) => o.t),
      Math.min(0.4, period * 0.45),
    ),
    window = timingWindow(period);
  // One analysis window per attack. It ends before the next expected event or the next clear attack, never at a weak
  // stray peak: a shortened window cannot separate semitones.
  const strengths = strong.map((o) => o.strength).sort((a, b) => a - b),
    median = strengths[Math.floor(strengths.length / 2)] ?? 0;
  const cache = new Map<number, ReturnType<typeof eventContext>>();
  const context = (j: number, i?: number) => {
    if (!cache.has(j)) {
      const following = strong.slice(j + 1).find((o) => o.strength >= 0.3 * median)?.t ?? Infinity,
        next = Math.min(following, i === undefined ? Infinity : (times[i + 1] ?? Infinity) - 0.05);
      cache.set(
        j,
        eventContext(
          take.samples,
          take.rate,
          strong[j].t,
          strong[j - 1]?.t,
          Number.isFinite(next) ? next : undefined,
          0,
          take.clicks,
        ),
      );
    }
    return cache.get(j)!;
  };
  // The detector favours recall; an attack only counts where the sound really rose, so a stray peak never earns timing credit.
  const rise = (j: number, i?: number) => attackRise(context(j, i)),
    real = (j: number, i?: number) => rise(j, i) >= RULES.attack;
  // Between noAttack and attack the evidence is ambiguous: the event is unsure and counts neither way.
  const ambiguous = new Set<number>();
  for (const [i, j] of [...pairs])
    if (!real(j, i)) {
      if (rise(j, i) >= RULES.noAttack) ambiguous.add(i);
      pairs.delete(i);
    }
  const used = new Set(pairs.values());
  // An extra attack must be about as strong as the take's real ones; a rolled chord or a pedal thump right after a matched attack is not one.
  const matchedStrength = [...used].map((j) => strong[j].strength).sort((a, b) => a - b),
    typical = matchedStrength[Math.floor(matchedStrength.length / 2)] ?? 1;
  const extras = strong.filter(
    (o, j) =>
      !used.has(j) &&
      o.strength >= 0.4 * typical &&
      ![...used].some((u) => Math.abs(strong[u].t - o.t) < 0.08) &&
      real(j),
  );
  const contexts = new Map<number, ReturnType<typeof eventContext>>();
  if (checkPitch) for (const [i, j] of pairs) if (graded[i].e.grade === 'pitch') contexts.set(i, context(j, i));
  const tuning = estimateTuning(
    [...contexts.entries()].map(([i, ctx]) => ({ ctx, expected: graded[i].e.notes.map((n) => n.midi) })),
  );
  if (Math.abs(tuning) >= 8) for (const ctx of contexts.values()) ctx.cents = tuning;
  const extraNotes: PieceGrade['extraNotes'] = [];
  let inTime = 0,
    heard = 0,
    wrongOrMissing = 0,
    unclear = 0,
    cannot = 0;
  const offsets: number[] = [];
  const events: EventResult[] = graded.map(({ e, index }, i) => {
    const j = pairs.get(i);
    if (j === undefined) {
      // Only call it missed when nothing rose here; a soft attack the detector could not place is not counted either way.
      const rose =
        ambiguous.has(i) ||
        attackRise(eventContext(take.samples, take.rate, times[i], undefined, undefined, 0, take.clicks)) >=
          RULES.noAttack;
      return {
        index,
        beat: e.beat,
        mark: rose ? 'unsure' : 'missed',
        notes: e.notes.map((n) => ({
          midi: n.midi,
          verdict: 'unchecked',
          reason: rose ? 'sound rose here, but its attack was not clear' : 'no attack was heard here',
        })),
      };
    }
    const delta = strong[j].t - times[i];
    offsets.push(delta);
    const good = Math.abs(delta) <= window;
    if (good) inTime++;
    let notes: NoteResult[] = e.notes.map((n) => ({
      midi: n.midi,
      verdict: 'unchecked',
      reason: e.grade === 'onset' ? 'timing only' : 'note checks are off',
    }));
    const ctx = contexts.get(i);
    if (ctx) {
      const result = verifyEvent(
        ctx,
        e.notes.map((n) => n.midi),
      );
      notes = result.notes.map((n) => ({ midi: n.midi, verdict: n.verdict, heardAs: n.heardAs, reason: n.reason }));
      for (const midi of result.extras) extraNotes.push({ beat: e.beat, midi });
      for (const n of result.notes) {
        if (n.verdict === 'heard') heard++;
        else if (n.verdict === 'not-heard' || n.verdict === 'wrong') wrongOrMissing++;
        else if (n.verdict === 'unclear') unclear++;
        else cannot++;
      }
    }
    return { index, beat: e.beat, mark: good ? 'good' : delta < 0 ? 'early' : 'late', offset: delta, notes };
  });
  const unsure = events.filter((e) => e.mark === 'unsure').length,
    count = Math.max(1, graded.length - unsure),
    checked = heard + wrongOrMissing;
  // Note checks shape the score only when at least half of the checkable notes got a definite verdict; unclear notes never count either way.
  const timing = Math.max(0, (inTime - extras.length) / count),
    pitch = checkPitch && checked && checked >= 0.5 * (checked + unclear) ? heard / checked : null;
  const reason = take.interrupted
    ? 'Audio timing was interrupted. This take will not change your progress.'
    : unsure > 0.25 * graded.length
      ? 'Several attacks were too soft or blurred to place. This take will not change your progress.'
      : take.coverage < 0.9
        ? 'The microphone recording had gaps. This take could not be judged.'
        : take.clipped > 0.005
          ? 'The input distorted. Move the microphone a little farther from the piano and try again.'
          : Math.abs(tuning) > 45
            ? `Your piano sounds about ${Math.round(Math.abs(tuning))} cents ${tuning < 0 ? 'flat' : 'sharp'}. Note checks paused; timing still counts. Try "Note checks: off" in Sound & timing.`
            : '';
  const missed = events.filter((e) => e.mark === 'missed'),
    wrong = events.flatMap((e) => e.notes.filter((n) => n.verdict === 'wrong').map((n) => ({ e, n })));
  const silent = events.flatMap((e) => e.notes.filter((n) => n.verdict === 'not-heard').map((n) => ({ e, n })));
  const late = events.filter((e) => e.mark === 'late').length,
    early = events.filter((e) => e.mark === 'early').length;
  const name = (m: number) => noteName(m, ex.keySig);
  const feedback =
    reason ||
    (wrong.length
      ? `At ${where(ex, wrong[0].e.beat)} it sounded like ${name(wrong[0].n.heardAs!)} instead of ${name(wrong[0].n.midi)}.`
      : '') ||
    (silent.length
      ? `At ${where(ex, silent[0].e.beat)}, ${name(silent[0].n.midi)} did not sound. Check that finger presses the key down fully.`
      : '') ||
    (missed.length
      ? `Nothing was heard at ${where(ex, missed[0].beat)}. Keep counting through held notes and rests.`
      : '') ||
    (extraNotes.length
      ? `An extra sound near ${name(extraNotes[0].midi)} at ${where(ex, extraNotes[0].beat)}. Check for a neighbouring key.`
      : '') ||
    (extras.length ? 'There were extra attacks. Play each chord once, together.' : '') ||
    (late > early && late ? 'Several attacks came a little late. Prepare the next shape during the long notes.' : '') ||
    (early ? 'Some attacks came early. Let each held note have its full length.' : '') ||
    'Steady and clear. Notice how it felt in your hands.';
  offsets.sort((a, b) => a - b);
  return {
    trusted: !reason,
    reason,
    events,
    timing,
    pitch,
    score: Math.max(0, Math.min(timing, pitch ?? 1)),
    extras: extras.length,
    extraNotes,
    coverage: take.coverage,
    checked,
    unclear,
    cannot,
    tuning,
    feedback,
    offset: offsets.length ? offsets[Math.floor(offsets.length / 2)] : 0,
  };
}

/** Guitar: plucks graded by CREPE pitch where an event asks for it; strums by timing only. */
export function gradeAttacks(
  ex: Exercise,
  bpm: number,
  attacks: Attack[],
  take: Pick<TakeAudio, 'coverage' | 'clipped' | 'interrupted'>,
  offset: number,
): PieceGrade {
  const period = 60 / bpm,
    graded = ex.events.map((e, index) => ({ e, index })).filter((x) => x.e.grade !== 'none');
  const times = graded.map((x) => x.e.beat * period);
  const shifted = attacks.map((a) => ({ ...a, t: a.t - offset })).sort((a, b) => a.t - b.t);
  const pairs = match(
      times,
      shifted.map((a) => a.t),
      Math.min(0.4, period * 0.45),
    ),
    window = timingWindow(period);
  const used = new Set(pairs.values()),
    extras = shifted.filter((_, j) => !used.has(j)).length;
  let inTime = 0,
    heard = 0,
    wrongOrMissing = 0,
    unclear = 0;
  const offsets: number[] = [];
  const events: EventResult[] = graded.map(({ e, index }: { e: XEvent; index: number }, i) => {
    const j = pairs.get(i);
    if (j === undefined)
      return {
        index,
        beat: e.beat,
        mark: 'missed',
        notes: e.notes.map((n) => ({ midi: n.midi, verdict: 'unchecked', reason: 'no attack was heard here' })),
      };
    const a = shifted[j],
      delta = a.t - times[i];
    offsets.push(delta);
    if (Math.abs(delta) <= window) inTime++;
    const notes: NoteResult[] = e.notes.map((n) => {
      if (e.grade !== 'pitch' || e.notes.length !== 1)
        return { midi: n.midi, verdict: 'unchecked', reason: 'timing only' };
      if (a.midi === undefined || (a.confidence ?? 0) < 0.5) {
        unclear++;
        return { midi: n.midi, verdict: 'unclear', reason: 'the pitch was not clear' };
      }
      if (Math.abs(a.midi - n.midi) <= 0.65) {
        heard++;
        return { midi: n.midi, verdict: 'heard', reason: 'pitch matched' };
      }
      wrongOrMissing++;
      return { midi: n.midi, verdict: 'wrong', heardAs: Math.round(a.midi), reason: 'a different pitch sounded' };
    });
    return {
      index,
      beat: e.beat,
      mark: Math.abs(delta) <= window ? 'good' : delta < 0 ? 'early' : 'late',
      offset: delta,
      notes,
    };
  });
  const count = Math.max(1, graded.length),
    checked = heard + wrongOrMissing;
  const timing = Math.max(0, (inTime - extras) / count),
    pitch = checked ? heard / checked : null;
  const reason = take.interrupted
    ? 'Audio timing was interrupted. This take will not change your progress.'
    : take.coverage < 0.9
      ? 'The microphone recording had gaps. This take could not be judged.'
      : take.clipped > 0.005
        ? 'The input distorted. Move a little farther from the microphone and try again.'
        : unclear > 0.15 * Math.max(1, checked + unclear)
          ? 'Some notes were unclear. This take will not change your progress.'
          : '';
  const wrong = events.flatMap((e) => e.notes.filter((n) => n.verdict === 'wrong').map((n) => ({ e, n }))),
    missed = events.filter((e) => e.mark === 'missed');
  const late = events.filter((e) => e.mark === 'late').length,
    early = events.filter((e) => e.mark === 'early').length;
  const feedback =
    reason ||
    (wrong.length
      ? `At ${where(ex, wrong[0].e.beat)} the string sounded ${noteName(wrong[0].n.heardAs!)} instead of ${noteName(wrong[0].n.midi)}.`
      : '') ||
    (missed.length
      ? `Nothing was heard at ${where(ex, missed[0].beat)}. Keep the strumming hand moving through the gaps.`
      : '') ||
    (extras ? 'There were extra attacks. Let the muted strokes miss the strings.' : '') ||
    (late > early && late ? 'Several strokes came late. Start the change on the last beat before it.' : '') ||
    (early ? 'Some strokes came early. Count the full beat.' : '') ||
    'Steady. Listen back for every string ringing.';
  offsets.sort((a, b) => a - b);
  return {
    trusted: !reason,
    reason,
    events,
    timing,
    pitch,
    score: Math.max(0, Math.min(timing, pitch ?? 1)),
    extras,
    extraNotes: [],
    coverage: take.coverage,
    checked,
    unclear,
    cannot: 0,
    tuning: 0,
    feedback,
    offset: offsets.length ? offsets[Math.floor(offsets.length / 2)] : 0,
  };
}

/** A key press in seconds from the first beat; dur is how long it was held, when the release was seen. */
export interface KeyPress {
  t: number;
  midi: number;
  dur?: number;
}

/*
 * Key timing rules, shared by the live lane and the final grade so the two can never disagree. All in seconds.
 * reach: how far a press may be from a note and still be matched to it. window: on time. perfect: an extra,
 * tighter tier shown as information only; it never changes a score. together: presses this close form one attack.
 */
export const keyReach = (period: number) => Math.min(0.4, period * 0.45);
export const keyWindow = (period: number) => timingWindow(period);
export const keyPerfect = (period: number) => Math.min(0.045, keyWindow(period) / 2);
export const keyTogether = (period: number) => Math.min(0.08, period * 0.25);
export type KeyTier = 'perfect' | 'good' | 'early' | 'late';
/** A matched attack's tier; perfect and good both count as on time. */
export const keyTier = (delta: number, period: number): KeyTier =>
  Math.abs(delta) <= keyPerfect(period)
    ? 'perfect'
    : Math.abs(delta) <= keyWindow(period)
      ? 'good'
      : delta < 0
        ? 'early'
        : 'late';
/** Presses grouped into attacks, in time order: an attack is timed by its first press. presses lists indices into the input. */
export function groupPresses(
  presses: readonly KeyPress[],
  period: number,
): { t: number; midis: number[]; presses: number[] }[] {
  const together = keyTogether(period),
    groups: { t: number; midis: number[]; presses: number[] }[] = [];
  const order = presses.map((p, i) => ({ p, i })).sort((a, b) => a.p.t - b.p.t);
  for (const { p, i } of order) {
    const last = groups[groups.length - 1];
    if (last && p.t - last.t <= together) {
      if (!last.midis.includes(p.midi)) last.midis.push(p.midi);
      last.presses.push(i);
    } else groups.push({ t: p.t, midis: [p.midi], presses: [i] });
  }
  return groups;
}
function alignKeys(ex: Exercise, bpm: number, presses: readonly KeyPress[]) {
  const period = 60 / bpm,
    graded = ex.events.map((e, index) => ({ e, index })).filter((x) => x.e.grade !== 'none');
  const times = graded.map((x) => x.e.beat * period),
    groups = groupPresses(presses, period);
  return {
    period,
    graded,
    times,
    groups,
    pairs: match(
      times,
      groups.map((g) => g.t),
      keyReach(period),
    ),
    window: keyWindow(period),
  };
}
/** The live view of a keys take so far: each played note's tier (by noteKey) and the presses that hit no expected note. */
export type KeyLive = KeyTier | 'played';
export interface KeyJudgement {
  notes: Map<string, KeyLive>;
  wrong: Set<number>;
}
/**
 * Judges the presses so far with exactly the alignment and rules gradeKeys uses, so the lane shows what the grade
 * will say. While the take runs (settled false), a match another note or attack could still claim shows as 'played'
 * and earns no reward; that is the rule that keeps the lane from ever being more generous than the grade. Only a later
 * press within reach of an already-judged note can re-align it, and the lane then updates on that press.
 */
export function judgeKeys(ex: Exercise, bpm: number, presses: readonly KeyPress[], settled = false): KeyJudgement {
  const { period, graded, times, groups, pairs } = alignKeys(ex, bpm, presses),
    reach = keyReach(period),
    notes = new Map<string, KeyLive>(),
    right = new Set<number>();
  graded.forEach(({ e }, i) => {
    const j = pairs.get(i);
    if (j === undefined) return;
    const g = groups[j],
      judged = keyTier(g.t - times[i], period);
    // A match that could still move (another note or attack within reach) is shown as played, never as on time, until it is the only reading.
    const open =
      times.some((t, k) => k !== i && Math.abs(t - times[i]) <= reach && Math.abs(g.t - t) <= reach) ||
      groups.some((h, k) => k !== j && Math.abs(h.t - times[i]) <= reach);
    const tier: KeyLive = open && !settled ? 'played' : judged;
    for (const n of e.notes) if (g.midis.includes(n.midi)) notes.set(`${e.beat}:${n.midi}`, tier);
    for (const k of g.presses) if (e.notes.some((n) => n.midi === presses[k].midi)) right.add(k);
  });
  return { notes, wrong: new Set(presses.map((_, k) => k).filter((k) => !right.has(k))) };
}

/** What one KeyJudge.sync changed. */
export interface KeyDiff {
  /** Note keys whose live tier was set or changed (a key that went away is not listed), in judgeKeys' order. */
  changed: string[];
  /** Graded events (indices into the exercise's graded events) whose notes' live or settled reading may have changed. */
  events: number[];
  /** Presses (indices into the presses) that became wrong or stopped being wrong, new presses included. */
  flipped: number[];
}
/**
 * judgeKeys kept up to date one press at a time, so judging a press during a take costs the same at the end of a long
 * take as at its start. After every sync, live (the reading judgeKeys gives), settled (judgeKeys with settled true) and
 * wrong hold exactly what judgeKeys returns for the same presses; only the order the maps list their keys in may differ.
 *
 * How it stays exact. Presses are grouped as groupPresses does: a press at or after every earlier one either joins
 * the last attack or starts a new one, and an attack's time (its first press) never changes. The matching is match's
 * own table, one column per attack: a new attack adds a column and leaves every earlier column as it was, so the
 * trace back from the new corner is the one match would take, and once it reaches a cell of the previous trace it
 * follows that trace to the start; only the pairs on the new part can differ. A note's tier then depends on its own
 * attack and on which attacks lie within reach of its beat, so only notes whose pair changed, whose attack gained a
 * press, or that a new attack is within reach of, are judged again. A press earlier than one already judged (it
 * would regroup the presses) rebuilds everything from scratch, with the same result.
 */
export class KeyJudge {
  readonly live = new Map<string, KeyLive>();
  readonly settled = new Map<string, KeyLive>();
  readonly wrong = new Set<number>();
  /** The exercise's graded events, as judgeKeys numbers them. */
  readonly graded: { e: XEvent; index: number }[];
  private readonly period: number;
  private readonly reach: number;
  private readonly together: number;
  private readonly times: Float64Array;
  /** Event beats in time order, for finding the events near a time. */
  private readonly byTime: Int32Array;
  private readonly sortedTimes: Float64Array;
  /** For each event, the other events within reach of its beat (the first half of judgeKeys' open rule). */
  private readonly near: Int32Array[];
  /** Every graded note, numbered in judgeKeys' order (event, then note): its event, pitch and key. */
  private readonly noteEvent: Int32Array;
  private readonly noteMidi: Int32Array;
  private readonly noteKey: string[];
  private readonly firstNote: Int32Array;
  /** The notes behind each key (more than one only when two events share a beat and a pitch), in judgeKeys' order. */
  private readonly owners = new Map<string, number[]>();
  /** Per note: whether its attack holds its key. Per event: its matched attack (-1: none) and its two readings. */
  private readonly sounded: Uint8Array;
  private readonly matched: Int32Array;
  private readonly liveTier: (KeyLive | undefined)[];
  private readonly settledTier: (KeyLive | undefined)[];
  /** Attacks: time, pitches, presses and matched event (-1: none). */
  private readonly attackT: number[] = [];
  private readonly attackMidis: number[][] = [];
  private readonly attackPresses: number[][] = [];
  private readonly attackEvent: number[] = [];
  /** match's table: the last cost column, every column's moves, and the rows the current trace covers in each column. */
  private cost: Float64Array;
  private spare: Float64Array;
  private moves: Uint8Array[] = [];
  private traceLo: number[] = [];
  private traceHi: number[] = [];
  private presses: KeyPress[] = [];
  private latest = -Infinity;
  /** Work collected by a sync, applied at its end. */
  private dirtyEvents = new Set<number>();
  private dirtyAttacks = new Set<number>();

  constructor(
    readonly exercise: Exercise,
    readonly bpm: number,
  ) {
    const period = (this.period = 60 / bpm);
    this.reach = keyReach(period);
    this.together = keyTogether(period);
    this.graded = exercise.events.map((e, index) => ({ e, index })).filter((x) => x.e.grade !== 'none');
    const n = this.graded.length;
    this.times = Float64Array.from(this.graded, (x) => x.e.beat * period);
    this.byTime = Int32Array.from(this.graded.map((_, i) => i).sort((a, b) => this.times[a] - this.times[b]));
    this.sortedTimes = Float64Array.from(this.byTime, (i) => this.times[i]);
    this.near = this.graded.map((_, i) => {
      const out: number[] = [];
      for (let p = this.lowerTime(this.times[i] - 2 * this.reach); p < n; p++) {
        const k = this.byTime[p];
        if (this.sortedTimes[p] > this.times[i] + 2 * this.reach) break;
        if (k !== i && Math.abs(this.times[k] - this.times[i]) <= this.reach) out.push(k);
      }
      return Int32Array.from(out);
    });
    const count = this.graded.reduce((s, x) => s + x.e.notes.length, 0);
    this.noteEvent = new Int32Array(count);
    this.noteMidi = new Int32Array(count);
    this.noteKey = new Array<string>(count);
    this.firstNote = new Int32Array(n + 1);
    let o = 0;
    this.graded.forEach(({ e }, i) => {
      this.firstNote[i] = o;
      for (const note of e.notes) {
        const key = `${e.beat}:${note.midi}`;
        this.noteEvent[o] = i;
        this.noteMidi[o] = note.midi;
        this.noteKey[o] = key;
        const list = this.owners.get(key);
        if (list) list.push(o);
        else this.owners.set(key, [o]);
        o++;
      }
    });
    this.firstNote[n] = o;
    this.sounded = new Uint8Array(count);
    this.matched = new Int32Array(n).fill(-1);
    this.liveTier = new Array(n).fill(undefined);
    this.settledTier = new Array(n).fill(undefined);
    this.cost = new Float64Array(n + 1);
    this.spare = new Float64Array(n + 1);
    this.reset();
  }
  /** Keys of the live reading in the order judgeKeys' map lists them (by the first note that holds each key). */
  inOrder(keys: readonly string[]): string[] {
    const first = (key: string) => this.owners.get(key)?.find((o) => this.sounded[o]) ?? Infinity;
    return keys
      .map((key) => ({ key, at: first(key) }))
      .sort((a, b) => a.at - b.at)
      .map((x) => x.key);
  }
  /** When press k went down (seconds from the first beat). */
  pressAt(k: number): number {
    return this.presses[k].t;
  }
  /**
   * Judge the presses added since the last sync (presses is the whole list so far, as judgeKeys takes it, only ever
   * appended to). Returns what changed.
   */
  sync(presses: readonly KeyPress[]): KeyDiff {
    const from = this.presses.length;
    if (presses.length < from || (from > 0 && presses[from - 1] !== this.presses[from - 1]))
      throw new Error('KeyJudge.sync: presses may only be appended to');
    let rebuild = false;
    for (let k = from; k < presses.length; k++) {
      this.presses.push(presses[k]);
      // A press earlier than one already judged would regroup the presses: judge them all again below.
      if (!rebuild && presses[k].t >= this.latest) this.add(k);
      else rebuild = true;
      this.latest = Math.max(this.latest, presses[k].t);
    }
    if (rebuild) this.rebuild();
    return this.apply();
  }

  /** The first position in time order whose beat is at or after t. */
  private lowerTime(t: number): number {
    let lo = 0,
      hi = this.sortedTimes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.sortedTimes[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  /** Back to no presses: match's first column (every event missing) and its trace. */
  private reset(): void {
    const n = this.graded.length,
      first = new Uint8Array(n + 1);
    for (let i = 1; i <= n; i++) {
      this.cost[i] = i;
      first[i] = 1;
    }
    this.cost[0] = 0;
    this.moves = [first];
    this.traceLo = [0];
    this.traceHi = [n];
    this.attackT.length = this.attackMidis.length = this.attackPresses.length = this.attackEvent.length = 0;
    this.matched.fill(-1);
  }
  /** Everything again from the presses in time order (stable, as groupPresses sorts them). */
  private rebuild(): void {
    this.reset();
    const order = this.presses.map((p, k) => ({ p, k })).sort((a, b) => a.p.t - b.p.t);
    for (const { k } of order) this.add(k);
    for (let i = 0; i < this.graded.length; i++) this.dirtyEvents.add(i);
    for (let j = 0; j < this.attackT.length; j++) this.dirtyAttacks.add(j);
  }
  /** One press at or after every earlier one: it joins the last attack (groupPresses' rule) or starts a new one. */
  private add(k: number): void {
    const p = this.presses[k],
      last = this.attackT.length - 1;
    if (last >= 0 && p.t - this.attackT[last] <= this.together) {
      if (!this.attackMidis[last].includes(p.midi)) this.attackMidis[last].push(p.midi);
      this.attackPresses[last].push(k);
      this.dirtyAttacks.add(last);
      if (this.attackEvent[last] >= 0) this.dirtyEvents.add(this.attackEvent[last]);
      return;
    }
    this.attackT.push(p.t);
    this.attackMidis.push([p.midi]);
    this.attackPresses.push([k]);
    this.attackEvent.push(-1);
    this.dirtyAttacks.add(last + 1);
    this.extend();
  }
  /** match's table gains the new attack's column; the trace is redone from the new corner until it meets the old one. */
  private extend(): void {
    const n = this.graded.length,
      reach = this.reach,
      times = this.times,
      j = this.attackT.length - 1,
      c = j + 1,
      at = this.attackT[j],
      prev = this.cost,
      cur = this.spare,
      move = new Uint8Array(n + 1);
    cur[0] = c;
    move[0] = 2;
    for (let i = 1; i <= n; i++) {
      const error = Math.abs(at - times[i - 1]);
      const matched = error <= reach ? prev[i - 1] + error / reach : Infinity,
        missing = cur[i - 1] + 1,
        extra = prev[i] + 1;
      if (matched <= missing && matched <= extra) {
        cur[i] = matched;
        move[i] = 0;
      } else if (missing <= extra) {
        cur[i] = missing;
        move[i] = 1;
      } else {
        cur[i] = extra;
        move[i] = 2;
      }
    }
    this.cost = cur;
    this.spare = prev;
    this.moves.push(move);
    this.traceLo.push(n);
    this.traceHi.push(n);
    // match's trace back, from the new corner, until it reaches a cell of the previous trace.
    const pairs: number[] = [];
    let i = n,
      b = c,
      column = c,
      top = n,
      bottom = n;
    while (i || b) {
      if (b < c && this.traceLo[b] <= i && i <= this.traceHi[b]) break;
      if (b !== column) {
        this.traceLo[column] = bottom;
        this.traceHi[column] = top;
        column = b;
        top = i;
      }
      bottom = i;
      const m = this.moves[b][i];
      if (i && b && m === 0) {
        pairs.push(--i, --b);
      } else if (i && (!b || m === 1)) i--;
      else b--;
    }
    // (i, b) is where the traces meet. Above it in its column the new trace may have come down; below, the old one stays.
    if (b === column) this.traceHi[b] = top;
    else {
      this.traceLo[column] = bottom;
      this.traceHi[column] = top;
      this.traceHi[b] = i;
    }
    // The old trace's pairs from that column on are replaced by the new ones.
    for (let g = b; g < j; g++) {
      const e = this.attackEvent[g];
      if (e < 0) continue;
      this.matched[e] = -1;
      this.attackEvent[g] = -1;
      this.dirtyEvents.add(e);
      this.dirtyAttacks.add(g);
    }
    for (let q = 0; q < pairs.length; q += 2) {
      const e = pairs[q],
        g = pairs[q + 1];
      this.matched[e] = g;
      this.attackEvent[g] = e;
      this.dirtyEvents.add(e);
      this.dirtyAttacks.add(g);
    }
    // The new attack may reopen any match within reach of it (the second half of judgeKeys' open rule).
    for (let p = this.lowerTime(at - 2 * reach); p < n; p++) {
      if (this.sortedTimes[p] > at + 2 * reach) break;
      if (Math.abs(at - this.sortedTimes[p]) <= reach) this.dirtyEvents.add(this.byTime[p]);
    }
  }
  /** judgeKeys' reading of event i: its tier, live and settled, and which of its keys its attack holds. */
  private judge(i: number): void {
    const j = this.matched[i];
    let live: KeyLive | undefined, settled: KeyLive | undefined;
    if (j >= 0) {
      const at = this.attackT[j],
        reach = this.reach,
        t = this.times[i];
      const judged = keyTier(at - t, this.period);
      let open = false;
      for (const k of this.near[i])
        if (Math.abs(at - this.times[k]) <= reach) {
          open = true;
          break;
        }
      if (!open) {
        // Another attack within reach of this beat. Attack times only grow, so they lie in one run of indices.
        let lo = 0,
          hi = this.attackT.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (this.attackT[mid] - t < -reach) lo = mid + 1;
          else hi = mid;
        }
        for (let k = lo; k < this.attackT.length && this.attackT[k] - t <= reach; k++)
          if (k !== j) {
            open = true;
            break;
          }
      }
      settled = judged;
      live = open ? 'played' : judged;
    }
    this.liveTier[i] = live;
    this.settledTier[i] = settled;
    for (let o = this.firstNote[i]; o < this.firstNote[i + 1]; o++)
      this.sounded[o] = j >= 0 && this.attackMidis[j].includes(this.noteMidi[o]) ? 1 : 0;
  }
  /** Apply the collected work: judge the touched events and attacks again and bring the maps and the wrong set up to date. */
  private apply(): KeyDiff {
    const keys = new Set<string>(),
      flipped: number[] = [];
    for (const i of this.dirtyEvents) {
      this.judge(i);
      for (let o = this.firstNote[i]; o < this.firstNote[i + 1]; o++) keys.add(this.noteKey[o]);
    }
    // A press is right when its attack is matched to an event that has its pitch (judgeKeys' right set).
    for (const j of this.dirtyAttacks) {
      const i = this.attackEvent[j],
        notes = i >= 0 ? this.graded[i].e.notes : undefined;
      for (const k of this.attackPresses[j]) {
        const midi = this.presses[k].midi,
          wrong = !notes?.some((n) => n.midi === midi);
        if (wrong === this.wrong.has(k)) continue;
        if (wrong) this.wrong.add(k);
        else this.wrong.delete(k);
        flipped.push(k);
      }
    }
    this.dirtyEvents.clear();
    this.dirtyAttacks.clear();
    const changed: { key: string; at: number }[] = [],
      events = new Set<number>();
    for (const key of keys) {
      let live: KeyLive | undefined,
        settled: KeyLive | undefined,
        first = -1;
      // judgeKeys sets a key once per note that holds it, in its order: the last one decides, the first places it.
      for (const o of this.owners.get(key)!)
        if (this.sounded[o]) {
          live = this.liveTier[this.noteEvent[o]];
          settled = this.settledTier[this.noteEvent[o]];
          if (first < 0) first = o;
        }
      const was = this.live.get(key),
        wasSettled = this.settled.get(key);
      if (was === live && wasSettled === settled) continue;
      if (live === undefined) this.live.delete(key);
      else this.live.set(key, live);
      if (settled === undefined) this.settled.delete(key);
      else this.settled.set(key, settled);
      if (live !== undefined && live !== was) changed.push({ key, at: first });
      for (const o of this.owners.get(key)!) events.add(this.noteEvent[o]);
    }
    changed.sort((a, b) => a.at - b.at);
    return { changed: changed.map((x) => x.key), events: [...events], flipped };
  }
}
/**
 * Computer keys or MIDI: pitches and press times are exact, so every graded note gets a definite verdict.
 * t is seconds from the first beat. Presses close together form one attack, as a chord does.
 */
export function gradeKeys(ex: Exercise, bpm: number, presses: KeyPress[], interrupted = false): PieceGrade {
  const { period, graded, times, groups, pairs, window } = alignKeys(ex, bpm, presses);
  const used = new Set(pairs.values()),
    extras = groups.length - used.size,
    extraNotes: PieceGrade['extraNotes'] = [];
  let inTime = 0,
    heard = 0,
    wrongOrMissing = 0;
  const offsets: number[] = [];
  const events: EventResult[] = graded.map(({ e, index }, i) => {
    const j = pairs.get(i);
    if (j === undefined)
      return {
        index,
        beat: e.beat,
        mark: 'missed',
        notes: e.notes.map((n) => ({ midi: n.midi, verdict: 'unchecked', reason: 'nothing was played here' })),
      };
    const g = groups[j],
      delta = g.t - times[i],
      expected = e.notes.map((n) => n.midi);
    offsets.push(delta);
    if (Math.abs(delta) <= window) inTime++;
    const stray = g.midis.filter((m) => !expected.includes(m));
    for (const midi of stray) extraNotes.push({ beat: e.beat, midi });
    const notes: NoteResult[] = e.notes.map((n) => {
      if (g.midis.includes(n.midi)) {
        heard++;
        return { midi: n.midi, verdict: 'heard', reason: 'key matched' };
      }
      wrongOrMissing++;
      const near = stray.slice().sort((a, b) => Math.abs(a - n.midi) - Math.abs(b - n.midi))[0];
      return near !== undefined && Math.abs(near - n.midi) <= 2
        ? { midi: n.midi, verdict: 'wrong', heardAs: near, reason: 'a neighbouring key was played' }
        : { midi: n.midi, verdict: 'not-heard', reason: 'this key was not played' };
    });
    return {
      index,
      beat: e.beat,
      mark: Math.abs(delta) <= window ? 'good' : delta < 0 ? 'early' : 'late',
      offset: delta,
      notes,
      tier: keyTier(delta, period),
    };
  });
  const count = Math.max(1, graded.length),
    checked = heard + wrongOrMissing;
  const timing = Math.max(0, (inTime - extras) / count),
    pitch = checked ? heard / checked : null;
  const reason = interrupted
    ? 'Audio timing was interrupted. This take will not change your progress.'
    : !presses.length
      ? 'No keys were pressed during the take. Click the page outside any text box, then try again.'
      : '';
  const name = (m: number) => noteName(m, ex.keySig);
  const wrong = events.flatMap((e) => e.notes.filter((n) => n.verdict === 'wrong').map((n) => ({ e, n })));
  const silent = events.flatMap((e) => e.notes.filter((n) => n.verdict === 'not-heard').map((n) => ({ e, n })));
  const missed = events.filter((e) => e.mark === 'missed'),
    late = events.filter((e) => e.mark === 'late').length,
    early = events.filter((e) => e.mark === 'early').length;
  const feedback =
    reason ||
    (wrong.length
      ? `At ${where(ex, wrong[0].e.beat)} you played ${name(wrong[0].n.heardAs!)} instead of ${name(wrong[0].n.midi)}.`
      : '') ||
    (silent.length ? `At ${where(ex, silent[0].e.beat)}, ${name(silent[0].n.midi)} was missing.` : '') ||
    (missed.length
      ? `Nothing was played at ${where(ex, missed[0].beat)}. Keep counting through held notes and rests.`
      : '') ||
    (extraNotes.length ? `An extra ${name(extraNotes[0].midi)} at ${where(ex, extraNotes[0].beat)}.` : '') ||
    (extras ? 'There were extra attacks. Play each chord once, together.' : '') ||
    (late > early && late
      ? 'Several notes came a little late. Look ahead to the next shape during the long notes.'
      : '') ||
    (early ? 'Some notes came early. Let each held note have its full length.' : '') ||
    'Every key right and on time.';
  offsets.sort((a, b) => a - b);
  return {
    trusted: !reason,
    reason,
    events,
    timing,
    pitch,
    score: Math.max(0, Math.min(timing, pitch ?? 1)),
    extras,
    extraNotes,
    coverage: 1,
    checked,
    unclear: 0,
    cannot: 0,
    tuning: 0,
    feedback,
    offset: offsets.length ? offsets[Math.floor(offsets.length / 2)] : 0,
  };
}
