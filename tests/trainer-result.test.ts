import { describe, expect, it } from 'vitest';
import { cueMidi, lessonById, type Lesson } from '../src/trainer/curriculum';
import { grade, type Evidence } from '../src/trainer/grader';
import { ESTIMATE, laneMarks, NO_PROGRESS, NOT_SCORED, resultView } from '../src/trainer/result';

const BPM = 60;
const played = (lesson: Lesson, extra: Partial<Evidence> = {}): Evidence => ({
  coverage: 1,
  clipped: 0,
  attacks: lesson.notes.map((n) => ({
    t: n.beat * (60 / BPM),
    midi: cueMidi(n),
    confidence: 0.9,
    duration: n.length * (60 / BPM),
  })),
  ...extra,
});
const text = (v: ReturnType<typeof resultView>) => JSON.stringify(v);

describe('resultView', () => {
  it('shows timing, notes and per-note marks for a trusted calibrated take, and asks for the comfort answer', () => {
    const lesson = lessonById('two-notes');
    const result = grade(lesson, BPM, played(lesson));
    expect(result.trusted).toBe(true);
    const v = resultView(result, true);
    expect(v.scored).toBe(true);
    expect(v.headline).toBe('');
    expect(v.metrics).toEqual([
      { value: '100%', label: 'timing' },
      { value: '100%', label: 'notes' },
    ]);
    expect(v.details).toMatch(/^1: good \(\+0 ms\) · 2: good/);
    expect(v.comfort).toBe(true);
    expect(v.status).toBe(result.feedback);
  });

  it('labels timing as an estimate when the take is trusted but timing is not calibrated', () => {
    const lesson = lessonById('two-notes');
    const v = resultView(grade(lesson, BPM, played(lesson)), false);
    expect(v.scored).toBe(true);
    expect(v.metrics[0]).toEqual({ value: '100%', label: 'timing · estimate' });
    expect(v.comfort).toBe(true);
    expect(v.status.endsWith(ESTIMATE)).toBe(true);
  });

  it('shows "rhythm only" and no pitch percentage for a rhythm-only lesson', () => {
    const lesson = lessonById('strum');
    expect(lesson.rhythmOnly).toBe(true);
    const evidence = played(lesson);
    evidence.attacks = evidence.attacks.map((a) => ({ t: a.t }));
    const v = resultView(grade(lesson, BPM, evidence), true);
    expect(v.scored).toBe(true);
    expect(v.metrics).toHaveLength(2);
    expect(v.metrics[1]).toEqual({ value: null, label: 'Rhythm only · no pitch score' });
  });

  it('adds a releases chip when the lesson grades releases', () => {
    const lesson = lessonById('rests');
    const result = grade(lesson, BPM, played(lesson));
    expect(result.trusted).toBe(true);
    expect(result.articulation).not.toBeNull();
    const v = resultView(result, true);
    expect(v.metrics.map((m) => m.label)).toEqual(['timing', 'notes', 'releases']);
    expect(v.metrics[2].value).toBe('100%');
  });

  it('lists extra attacks and missed notes in the details of a scored take', () => {
    const lesson = lessonById('two-notes');
    const evidence = played(lesson);
    evidence.attacks = [evidence.attacks[0], { t: 0.5, midi: 40, confidence: 0.9 }];
    const v = resultView(grade(lesson, BPM, evidence), true);
    expect(v.scored).toBe(true);
    expect(v.details).toContain('missed');
    expect(v.details).toContain('extra attacks');
  });

  const untrusted: [string, Partial<Evidence>][] = [
    ['distorted input', { clipped: 0.05 }],
    ['interrupted timing', { interrupted: true }],
    ['a recording with gaps', { coverage: 0.5 }],
  ];
  for (const id of ['two-notes', 'strum', 'rests'])
    for (const [name, extra] of untrusted)
      for (const calibrated of [true, false])
        it(`shows "Not scored", the reason and no grade for ${name} in ${id} (${calibrated ? 'calibrated' : 'uncalibrated'})`, () => {
          const lesson = lessonById(id);
          // Silence on top of bad input: the grader would otherwise mark every note missed and score 0%.
          const result = grade(lesson, BPM, { ...played(lesson), attacks: [], ...extra });
          expect(result.trusted).toBe(false);
          expect(result.notes.every((n) => n.mark === 'missed')).toBe(true);
          const v = resultView(result, calibrated);
          expect(v.scored).toBe(false);
          expect(v.headline).toBe(NOT_SCORED);
          expect(v.headline).toBe('Not scored');
          expect(v.reason).toBe(result.reason);
          expect(v.metrics).toEqual([]);
          expect(v.comfort).toBe(false);
          expect(text(v)).not.toContain('%');
          expect(text(v)).not.toMatch(/missed/i);
          expect(text(v)).not.toMatch(/good|wrong|early|late|uncertain|extra|rhythm only|releases/i);
          // The status line follows the Pieces wording and leaves the reason to the card, said once.
          expect(v.status).toBe('Take finished. Not scored.');
          expect(text(v).split(result.reason)).toHaveLength(2);
          expect(text(v)).not.toContain('will not change your level');
          // Says once, in the reason or the details, that the take leaves progress alone.
          expect(`${v.reason} ${v.details} ${v.status}`.split(NO_PROGRESS)).toHaveLength(2);
          // The timing lane draws every note plain.
          expect(laneMarks(result)).toBeUndefined();
        });

  it('treats unclear notes as not scored', () => {
    const lesson = lessonById('two-notes');
    const evidence = played(lesson);
    evidence.attacks = evidence.attacks.map((a) => ({ ...a, confidence: 0.1 }));
    const result = grade(lesson, BPM, evidence);
    expect(result.trusted).toBe(false);
    const v = resultView(result, true);
    expect(v.headline).toBe('Not scored');
    expect(v.reason).toContain('unclear');
    expect(text(v)).not.toContain('%');
    expect(text(v)).not.toMatch(/missed|uncertain/);
    expect(`${v.reason} ${v.details}`.split(NO_PROGRESS)).toHaveLength(2);
  });

  it('still says why when an untrusted grade carries no reason', () => {
    const lesson = lessonById('two-notes');
    const result = { ...grade(lesson, BPM, played(lesson)), trusted: false, reason: '' };
    const v = resultView(result, true);
    expect(v.headline).toBe('Not scored');
    expect(v.reason).not.toBe('');
    expect(v.details).toContain(NO_PROGRESS);
    expect(text(v)).not.toContain('%');
  });

  it('lets the timing lane colour only a scored take', () => {
    const lesson = lessonById('two-notes');
    const scored = grade(lesson, BPM, played(lesson));
    expect(laneMarks(scored)).toBe(scored.notes);
    expect(laneMarks(undefined)).toBeUndefined();
    expect(laneMarks({ ...scored, trusted: false })).toBeUndefined();
  });
});
