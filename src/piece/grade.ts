import type { Exercise, XEvent } from './exercise';
import { attackRise, eventContext, estimateTuning, RULES, verifyEvent, type NoteVerdict, type PianoOnset } from './listen';
import { noteName } from './score';

/** Grading of one take: timing per attack, plus per-note evidence where the instrument and the mic allow it. */
export interface NoteResult { midi: number; verdict: NoteVerdict | 'unchecked'; heardAs?: number; reason: string }
/** unsure: sound rose here but no clear attack was found, so timing is not judged either way. */
export interface EventResult { index: number; beat: number; mark: 'good' | 'early' | 'late' | 'missed' | 'unsure'; offset?: number; notes: NoteResult[] }
export interface PieceGrade {
  trusted: boolean; reason: string; events: EventResult[]; timing: number; pitch: number | null; score: number;
  extras: number; extraNotes: { beat: number; midi: number }[]; coverage: number;
  checked: number; unclear: number; cannot: number; tuning: number; feedback: string; offset: number;
}
export interface TakeAudio { samples: Float32Array; rate: number; playAt: number; coverage: number; clipped: number; interrupted?: boolean; clicks: boolean }
export interface Attack { t: number; midi?: number; confidence?: number; strength?: number }

/** Monotonic one-to-one matching of attacks to expected events; an attack is never shared. */
export function match(expected: number[], attacks: number[], reach: number): Map<number, number> {
  const rows = expected.length + 1, cols = attacks.length + 1;
  const cost = Array.from({ length: rows }, () => new Float64Array(cols)), path = Array.from({ length: rows }, () => new Uint8Array(cols));
  for (let i = 1; i < rows; i++) { cost[i][0] = i; path[i][0] = 1; }
  for (let j = 1; j < cols; j++) { cost[0][j] = j; path[0][j] = 2; }
  for (let i = 1; i < rows; i++) for (let j = 1; j < cols; j++) {
    const error = Math.abs(attacks[j - 1] - expected[i - 1]);
    const matched = error <= reach ? cost[i - 1][j - 1] + error / reach : Infinity, missing = cost[i - 1][j] + 1, extra = cost[i][j - 1] + 1;
    if (matched <= missing && matched <= extra) { cost[i][j] = matched; path[i][j] = 0; }
    else if (missing <= extra) { cost[i][j] = missing; path[i][j] = 1; } else { cost[i][j] = extra; path[i][j] = 2; }
  }
  const pairs = new Map<number, number>();
  for (let i = rows - 1, j = cols - 1; i || j;) {
    if (i && j && path[i][j] === 0) pairs.set(--i, --j);
    else if (i && (!j || path[i][j] === 1)) i--; else j--;
  }
  return pairs;
}

export const barAt = (ex: Exercise, beat: number) => {
  const bar = [...ex.bars].reverse().find(b => b.beat <= beat + 1e-6) ?? ex.bars[0];
  return { number: bar?.number ?? 1, beat: Math.round((beat - (bar?.beat ?? 0)) * 100) / 100 + 1 };
};
const where = (ex: Exercise, beat: number) => { const at = barAt(ex, beat); return `bar ${at.number}, beat ${at.beat}`; };

/** Piano: spectral-flux attacks plus partial evidence. Unclear evidence never counts for or against. */
export function gradePiano(ex: Exercise, bpm: number, take: TakeAudio, onsets: PianoOnset[], offset: number, checkPitch = true): PieceGrade {
  const period = 60 / bpm, graded = ex.events.map((e, index) => ({ e, index })).filter(x => x.e.grade !== 'none');
  const times = graded.map(x => take.playAt + offset + x.e.beat * period);
  const strong = onsets.filter(o => o.strength >= 0.12);
  const pairs = match(times, strong.map(o => o.t), Math.min(0.4, period * 0.45)), window = Math.min(0.13, period * 0.16);
  // One analysis window per attack. It ends before the next expected event or the next clear attack, never at a weak
  // stray peak: a shortened window cannot separate semitones.
  const strengths = strong.map(o => o.strength).sort((a, b) => a - b), median = strengths[Math.floor(strengths.length / 2)] ?? 0;
  const cache = new Map<number, ReturnType<typeof eventContext>>();
  const context = (j: number, i?: number) => {
    if (!cache.has(j)) {
      const following = strong.slice(j + 1).find(o => o.strength >= 0.3 * median)?.t ?? Infinity, next = Math.min(following, i === undefined ? Infinity : (times[i + 1] ?? Infinity) - 0.05);
      cache.set(j, eventContext(take.samples, take.rate, strong[j].t, strong[j - 1]?.t, Number.isFinite(next) ? next : undefined, 0, take.clicks));
    }
    return cache.get(j)!;
  };
  // The detector favours recall; an attack only counts where the sound really rose, so a stray peak never earns timing credit.
  const rise = (j: number, i?: number) => attackRise(context(j, i)), real = (j: number, i?: number) => rise(j, i) >= RULES.attack;
  // Between noAttack and attack the evidence is ambiguous: the event is unsure and counts neither way.
  const ambiguous = new Set<number>();
  for (const [i, j] of [...pairs]) if (!real(j, i)) { if (rise(j, i) >= RULES.noAttack) ambiguous.add(i); pairs.delete(i); }
  const used = new Set(pairs.values());
  // An extra attack must be about as strong as the take's real ones; a rolled chord or a pedal thump right after a matched attack is not one.
  const matchedStrength = [...used].map(j => strong[j].strength).sort((a, b) => a - b), typical = matchedStrength[Math.floor(matchedStrength.length / 2)] ?? 1;
  const extras = strong.filter((o, j) => !used.has(j) && o.strength >= 0.4 * typical && ![...used].some(u => Math.abs(strong[u].t - o.t) < 0.08) && real(j));
  const contexts = new Map<number, ReturnType<typeof eventContext>>();
  if (checkPitch) for (const [i, j] of pairs) if (graded[i].e.grade === 'pitch') contexts.set(i, context(j, i));
  const tuning = estimateTuning([...contexts.entries()].map(([i, ctx]) => ({ ctx, expected: graded[i].e.notes.map(n => n.midi) })));
  if (Math.abs(tuning) >= 8) for (const ctx of contexts.values()) ctx.cents = tuning;
  const extraNotes: PieceGrade['extraNotes'] = [];
  let inTime = 0, heard = 0, wrongOrMissing = 0, unclear = 0, cannot = 0;
  const offsets: number[] = [];
  const events: EventResult[] = graded.map(({ e, index }, i) => {
    const j = pairs.get(i);
    if (j === undefined) {
      // Only call it missed when nothing rose here; a soft attack the detector could not place is not counted either way.
      const rose = ambiguous.has(i) || attackRise(eventContext(take.samples, take.rate, times[i], undefined, undefined, 0, take.clicks)) >= RULES.noAttack;
      return { index, beat: e.beat, mark: rose ? 'unsure' : 'missed', notes: e.notes.map(n => ({ midi: n.midi, verdict: 'unchecked', reason: rose ? 'sound rose here, but its attack was not clear' : 'no attack was heard here' })) };
    }
    const delta = strong[j].t - times[i];
    offsets.push(delta);
    const good = Math.abs(delta) <= window;
    if (good) inTime++;
    let notes: NoteResult[] = e.notes.map(n => ({ midi: n.midi, verdict: 'unchecked', reason: e.grade === 'onset' ? 'timing only' : 'note checks are off' }));
    const ctx = contexts.get(i);
    if (ctx) {
      const result = verifyEvent(ctx, e.notes.map(n => n.midi));
      notes = result.notes.map(n => ({ midi: n.midi, verdict: n.verdict, heardAs: n.heardAs, reason: n.reason }));
      for (const midi of result.extras) extraNotes.push({ beat: e.beat, midi });
      for (const n of result.notes) {
        if (n.verdict === 'heard') heard++; else if (n.verdict === 'not-heard' || n.verdict === 'wrong') wrongOrMissing++;
        else if (n.verdict === 'unclear') unclear++; else cannot++;
      }
    }
    return { index, beat: e.beat, mark: good ? 'good' : delta < 0 ? 'early' : 'late', offset: delta, notes };
  });
  const unsure = events.filter(e => e.mark === 'unsure').length, count = Math.max(1, graded.length - unsure), checked = heard + wrongOrMissing;
  // Note checks shape the score only when at least half of the checkable notes got a definite verdict; unclear notes never count either way.
  const timing = Math.max(0, (inTime - extras.length) / count), pitch = checkPitch && checked && checked >= 0.5 * (checked + unclear) ? heard / checked : null;
  const reason = take.interrupted ? 'Audio timing was interrupted. This take will not change your progress.'
    : unsure > 0.25 * graded.length ? 'Several attacks were too soft or blurred to place. This take will not change your progress.'
    : take.coverage < 0.9 ? 'The microphone recording had gaps. This take could not be judged.'
      : take.clipped > 0.005 ? 'The input distorted. Move the microphone a little farther from the piano and try again.'
        : Math.abs(tuning) > 45 ? `Your piano sounds about ${Math.round(Math.abs(tuning))} cents ${tuning < 0 ? 'flat' : 'sharp'}. Note checks paused; timing still counts. Try "Note checks: off" in Sound & timing.`
          : '';
  const missed = events.filter(e => e.mark === 'missed'), wrong = events.flatMap(e => e.notes.filter(n => n.verdict === 'wrong').map(n => ({ e, n })));
  const silent = events.flatMap(e => e.notes.filter(n => n.verdict === 'not-heard').map(n => ({ e, n })));
  const late = events.filter(e => e.mark === 'late').length, early = events.filter(e => e.mark === 'early').length;
  const name = (m: number) => noteName(m, ex.keySig);
  const feedback = reason
    || (wrong.length ? `At ${where(ex, wrong[0].e.beat)} it sounded like ${name(wrong[0].n.heardAs!)} instead of ${name(wrong[0].n.midi)}.` : '')
    || (silent.length ? `At ${where(ex, silent[0].e.beat)}, ${name(silent[0].n.midi)} did not sound. Check that finger presses the key down fully.` : '')
    || (missed.length ? `Nothing was heard at ${where(ex, missed[0].beat)}. Keep counting through held notes and rests.` : '')
    || (extraNotes.length ? `An extra sound near ${name(extraNotes[0].midi)} at ${where(ex, extraNotes[0].beat)}. Check for a neighbouring key.` : '')
    || (extras.length ? 'There were extra attacks. Play each chord once, together.' : '')
    || (late > early && late ? 'Several attacks came a little late. Prepare the next shape during the long notes.' : '')
    || (early ? 'Some attacks came early. Let each held note have its full length.' : '')
    || 'Steady and clear. Notice how it felt in your hands.';
  offsets.sort((a, b) => a - b);
  return { trusted: !reason, reason, events, timing, pitch, score: Math.max(0, Math.min(timing, pitch ?? 1)), extras: extras.length, extraNotes, coverage: take.coverage, checked, unclear, cannot, tuning, feedback, offset: offsets.length ? offsets[Math.floor(offsets.length / 2)] : 0 };
}

/** Guitar: plucks graded by CREPE pitch where an event asks for it; strums by timing only. */
export function gradeAttacks(ex: Exercise, bpm: number, attacks: Attack[], take: Pick<TakeAudio, 'coverage' | 'clipped' | 'interrupted'>, offset: number): PieceGrade {
  const period = 60 / bpm, graded = ex.events.map((e, index) => ({ e, index })).filter(x => x.e.grade !== 'none');
  const times = graded.map(x => x.e.beat * period);
  const shifted = attacks.map(a => ({ ...a, t: a.t - offset })).sort((a, b) => a.t - b.t);
  const pairs = match(times, shifted.map(a => a.t), Math.min(0.4, period * 0.45)), window = Math.min(0.13, period * 0.16);
  const used = new Set(pairs.values()), extras = shifted.filter((_, j) => !used.has(j)).length;
  let inTime = 0, heard = 0, wrongOrMissing = 0, unclear = 0;
  const offsets: number[] = [];
  const events: EventResult[] = graded.map(({ e, index }: { e: XEvent; index: number }, i) => {
    const j = pairs.get(i);
    if (j === undefined) return { index, beat: e.beat, mark: 'missed', notes: e.notes.map(n => ({ midi: n.midi, verdict: 'unchecked', reason: 'no attack was heard here' })) };
    const a = shifted[j], delta = a.t - times[i];
    offsets.push(delta);
    if (Math.abs(delta) <= window) inTime++;
    const notes: NoteResult[] = e.notes.map(n => {
      if (e.grade !== 'pitch' || e.notes.length !== 1) return { midi: n.midi, verdict: 'unchecked', reason: 'timing only' };
      if (a.midi === undefined || (a.confidence ?? 0) < 0.5) { unclear++; return { midi: n.midi, verdict: 'unclear', reason: 'the pitch was not clear' }; }
      if (Math.abs(a.midi - n.midi) <= 0.65) { heard++; return { midi: n.midi, verdict: 'heard', reason: 'pitch matched' }; }
      wrongOrMissing++;
      return { midi: n.midi, verdict: 'wrong', heardAs: Math.round(a.midi), reason: 'a different pitch sounded' };
    });
    return { index, beat: e.beat, mark: Math.abs(delta) <= window ? 'good' : delta < 0 ? 'early' : 'late', offset: delta, notes };
  });
  const count = Math.max(1, graded.length), checked = heard + wrongOrMissing;
  const timing = Math.max(0, (inTime - extras) / count), pitch = checked ? heard / checked : null;
  const reason = take.interrupted ? 'Audio timing was interrupted. This take will not change your progress.' : take.coverage < 0.9 ? 'The microphone recording had gaps. This take could not be judged.'
    : take.clipped > 0.005 ? 'The input distorted. Move a little farther from the microphone and try again.' : unclear > 0.15 * Math.max(1, checked + unclear) ? 'Some notes were unclear. This take will not change your progress.' : '';
  const wrong = events.flatMap(e => e.notes.filter(n => n.verdict === 'wrong').map(n => ({ e, n }))), missed = events.filter(e => e.mark === 'missed');
  const late = events.filter(e => e.mark === 'late').length, early = events.filter(e => e.mark === 'early').length;
  const feedback = reason || (wrong.length ? `At ${where(ex, wrong[0].e.beat)} the string sounded ${noteName(wrong[0].n.heardAs!)} instead of ${noteName(wrong[0].n.midi)}.` : '')
    || (missed.length ? `Nothing was heard at ${where(ex, missed[0].beat)}. Keep the strumming hand moving through the gaps.` : '')
    || (extras ? 'There were extra attacks. Let the muted strokes miss the strings.' : '')
    || (late > early && late ? 'Several strokes came late. Start the change on the last beat before it.' : '') || (early ? 'Some strokes came early. Count the full beat.' : '')
    || 'Steady. Listen back for every string ringing.';
  offsets.sort((a, b) => a - b);
  return { trusted: !reason, reason, events, timing, pitch, score: Math.max(0, Math.min(timing, pitch ?? 1)), extras, extraNotes: [], coverage: take.coverage, checked, unclear, cannot: 0, tuning: 0, feedback, offset: offsets.length ? offsets[Math.floor(offsets.length / 2)] : 0 };
}

export interface KeyPress { t: number; midi: number }
/**
 * Computer keys or MIDI: pitches and press times are exact, so every graded note gets a definite verdict.
 * t is seconds from the first beat. Presses close together form one attack, as a chord does.
 */
export function gradeKeys(ex: Exercise, bpm: number, presses: KeyPress[], interrupted = false): PieceGrade {
  const period = 60 / bpm, graded = ex.events.map((e, index) => ({ e, index })).filter(x => x.e.grade !== 'none');
  const times = graded.map(x => x.e.beat * period), together = Math.min(0.08, period * 0.25);
  const groups: { t: number; midis: number[] }[] = [];
  for (const p of [...presses].sort((a, b) => a.t - b.t)) {
    const last = groups[groups.length - 1];
    if (last && p.t - last.t <= together) { if (!last.midis.includes(p.midi)) last.midis.push(p.midi); } else groups.push({ t: p.t, midis: [p.midi] });
  }
  const pairs = match(times, groups.map(g => g.t), Math.min(0.4, period * 0.45)), window = Math.min(0.13, period * 0.16);
  const used = new Set(pairs.values()), extras = groups.length - used.size, extraNotes: PieceGrade['extraNotes'] = [];
  let inTime = 0, heard = 0, wrongOrMissing = 0;
  const offsets: number[] = [];
  const events: EventResult[] = graded.map(({ e, index }, i) => {
    const j = pairs.get(i);
    if (j === undefined) return { index, beat: e.beat, mark: 'missed', notes: e.notes.map(n => ({ midi: n.midi, verdict: 'unchecked', reason: 'nothing was played here' })) };
    const g = groups[j], delta = g.t - times[i], expected = e.notes.map(n => n.midi);
    offsets.push(delta);
    if (Math.abs(delta) <= window) inTime++;
    const stray = g.midis.filter(m => !expected.includes(m));
    for (const midi of stray) extraNotes.push({ beat: e.beat, midi });
    const notes: NoteResult[] = e.notes.map(n => {
      if (g.midis.includes(n.midi)) { heard++; return { midi: n.midi, verdict: 'heard', reason: 'key matched' }; }
      wrongOrMissing++;
      const near = stray.slice().sort((a, b) => Math.abs(a - n.midi) - Math.abs(b - n.midi))[0];
      return near !== undefined && Math.abs(near - n.midi) <= 2 ? { midi: n.midi, verdict: 'wrong', heardAs: near, reason: 'a neighbouring key was played' } : { midi: n.midi, verdict: 'not-heard', reason: 'this key was not played' };
    });
    return { index, beat: e.beat, mark: Math.abs(delta) <= window ? 'good' : delta < 0 ? 'early' : 'late', offset: delta, notes };
  });
  const count = Math.max(1, graded.length), checked = heard + wrongOrMissing;
  const timing = Math.max(0, (inTime - extras) / count), pitch = checked ? heard / checked : null;
  const reason = interrupted ? 'Audio timing was interrupted. This take will not change your progress.'
    : !presses.length ? 'No keys were pressed during the take. Click the page outside any text box, then try again.' : '';
  const name = (m: number) => noteName(m, ex.keySig);
  const wrong = events.flatMap(e => e.notes.filter(n => n.verdict === 'wrong').map(n => ({ e, n })));
  const silent = events.flatMap(e => e.notes.filter(n => n.verdict === 'not-heard').map(n => ({ e, n })));
  const missed = events.filter(e => e.mark === 'missed'), late = events.filter(e => e.mark === 'late').length, early = events.filter(e => e.mark === 'early').length;
  const feedback = reason
    || (wrong.length ? `At ${where(ex, wrong[0].e.beat)} you played ${name(wrong[0].n.heardAs!)} instead of ${name(wrong[0].n.midi)}.` : '')
    || (silent.length ? `At ${where(ex, silent[0].e.beat)}, ${name(silent[0].n.midi)} was missing.` : '')
    || (missed.length ? `Nothing was played at ${where(ex, missed[0].beat)}. Keep counting through held notes and rests.` : '')
    || (extraNotes.length ? `An extra ${name(extraNotes[0].midi)} at ${where(ex, extraNotes[0].beat)}.` : '')
    || (extras ? 'There were extra attacks. Play each chord once, together.' : '')
    || (late > early && late ? 'Several notes came a little late. Look ahead to the next shape during the long notes.' : '')
    || (early ? 'Some notes came early. Let each held note have its full length.' : '')
    || 'Every key right and on time.';
  offsets.sort((a, b) => a - b);
  return { trusted: !reason, reason, events, timing, pitch, score: Math.max(0, Math.min(timing, pitch ?? 1)), extras, extraNotes, coverage: 1, checked, unclear: 0, cannot: 0, tuning: 0, feedback, offset: offsets.length ? offsets[Math.floor(offsets.length / 2)] : 0 };
}
