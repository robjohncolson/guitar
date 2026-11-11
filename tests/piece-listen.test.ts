import { expect, it } from 'vitest';
import { eventContext, fft, pianoOnsets, verifyEvent, type NoteVerdict } from '../src/piece/listen';
import { gradePiano } from '../src/piece/grade';
import { fromBars } from '../src/piece/exercise';
import { compile } from '../src/piece/notation';
import gymnopedie from '../src/piece/packs/gymnopedie-1.piece.txt?raw';
import { addClicks, render, type Strike } from './helpers/piano-synth';

const rate = 48000;
const verdicts = (strikes: Strike[], expected: number[], at: number, previous?: number, seconds = 2.5) => {
  const samples = render(rate, seconds, strikes, 0.0004);
  const result = verifyEvent(eventContext(samples, rate, at, previous, undefined), expected);
  return { by: Object.fromEntries(result.notes.map(n => [n.midi, n.verdict])) as Record<number, NoteVerdict>, notes: result.notes, extras: result.extras };
};

it('computes the same spectrum as a direct DFT', () => {
  const n = 64, re = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 0.7) + (i % 5) * 0.1), im = new Float64Array(n);
  const direct = Array.from({ length: n }, (_, k) => { let r = 0, j = 0; for (let t = 0; t < n; t++) { r += re[t] * Math.cos(-2 * Math.PI * k * t / n); j += re[t] * Math.sin(-2 * Math.PI * k * t / n); } return [r, j]; });
  fft(re, im);
  direct.forEach(([r, j], k) => { expect(re[k]).toBeCloseTo(r, 9); expect(im[k]).toBeCloseTo(j, 9); });
});

it('finds piano attacks within 15 ms, including a soft note under a ringing chord, and ignores metronome pips', () => {
  const strikes: Strike[] = [{ midi: 43, at: 0.5 }, { midi: 59, at: 1.4, amp: 0.12 }, { midi: 62, at: 1.41, amp: 0.12 }, { midi: 66, at: 1.405, amp: 0.12 }, { midi: 79, at: 2.3, amp: 0.035 }, { midi: 38, at: 3.2 }];
  const samples = render(rate, 4.2, strikes, 0.0003);
  addClicks(samples, rate, [0.95, 1.85, 2.75, 3.65], 0.04);
  const onsets = pianoOnsets(samples, rate, 0, 4.2, true);
  expect(onsets.map(o => o.t)).toHaveLength(4);
  [0.5, 1.4, 2.3, 3.2].forEach((t, i) => expect(Math.abs(onsets[i].t - t)).toBeLessThan(0.015));
});

it('hears a correct note, names a neighbouring wrong note, and never accepts an octave substitution', () => {
  expect(verdicts([{ midi: 69, at: 0.5 }], [69], 0.5).by[69]).toBe('heard');
  const neighbour = verdicts([{ midi: 70, at: 0.5 }], [69], 0.5);
  expect(neighbour.by[69]).toBe('wrong');
  expect(neighbour.notes[0].heardAs).toBe(70);
  expect(verdicts([{ midi: 81, at: 0.5 }], [69], 0.5).by[69]).not.toBe('heard');
  expect(verdicts([{ midi: 57, at: 0.5 }], [69], 0.5).by[69]).not.toBe('heard');
  expect(verdicts([{ midi: 50, at: 0.5 }], [69], 0.5).by[69]).not.toBe('heard');
});

it('checks each tone of a chord over a ringing bass, including the twelfth above the bass', () => {
  const bass: Strike = { midi: 43, at: 0.3 }, at = 1.2;
  const full = verdicts([bass, { midi: 59, at }, { midi: 62, at: at + 0.008 }, { midi: 66, at: at + 0.004 }], [59, 62, 66], at, 0.3);
  expect(full.by).toEqual({ 59: 'heard', 62: 'heard', 66: 'heard' });
  expect(full.extras).toEqual([]);
  const missing = verdicts([bass, { midi: 59, at }, { midi: 66, at }], [59, 62, 66], at, 0.3);
  expect(missing.by[62]).toBe('not-heard');
  expect(missing.by[59]).toBe('heard');
  const wrong = verdicts([bass, { midi: 59, at }, { midi: 61, at }, { midi: 66, at }], [59, 62, 66], at, 0.3);
  expect(wrong.by[62]).toBe('wrong');
  expect(wrong.notes.find(n => n.midi === 62)!.heardAs).toBe(61);
  const added = verdicts([bass, { midi: 59, at }, { midi: 62, at }, { midi: 64, at }, { midi: 66, at }], [59, 62, 66], at, 0.3);
  expect(added.extras).toContain(64);
});

it('does not count a note that is only still ringing, and marks a doubled octave as impossible to check', () => {
  const ringing = verdicts([{ midi: 66, at: 0.3 }, { midi: 59, at: 1.3 }, { midi: 62, at: 1.3 }], [59, 62, 66], 1.3, 0.3);
  expect(ringing.by[66]).not.toBe('heard');
  const octave = verdicts([{ midi: 66, at: 0.5 }, { midi: 78, at: 0.5 }], [66, 78], 0.5);
  expect(octave.by[78]).toBe('cannot-check');
  expect(octave.by[66]).toBe('heard');
});

it('grades a rendered Gymnopédie take: correct, one wrong chord tone, a missing chord, and a flat piano', { timeout: 60000 }, () => {
  const score = compile(gymnopedie).score!, exercise = fromBars(score, [0, 1, 2, 3], ['L'], 'L:1-4', 'Intro');
  const bpm = 60, playAt = 0.6, offset = 0.05;
  const take = (change: (s: Strike) => Strike | undefined = s => s, cents = 0) => {
    const strikes = exercise.events.flatMap(e => e.notes.map(n => change({ midi: n.midi, at: playAt + offset + e.beat + (n.midi % 3) * 0.006, dur: n.dur, amp: 0.13, cents }))).filter(Boolean) as Strike[];
    const samples = render(rate, playAt + offset + exercise.beats + 1, strikes, 0.0004);
    return gradePiano(exercise, bpm, { samples, rate, playAt, coverage: 1, clipped: 0, clicks: false }, pianoOnsets(samples, rate, 0, samples.length / rate), offset);
  };
  const clean = take();
  expect(clean.trusted).toBe(true);
  expect(clean.timing).toBe(1);
  expect(clean.pitch).toBe(1);
  expect(clean.events.flatMap(e => e.notes).filter(n => n.verdict === 'heard').length).toBeGreaterThanOrEqual(14);
  const wrong = take(s => (s.midi === 61 && s.at > 9 ? { ...s, midi: 60 } : s));
  expect(wrong.pitch!).toBeLessThan(1);
  expect(wrong.feedback).toContain('bar 4');
  const missing = take(s => (s.at > 1.4 && s.at < 2 ? undefined : s));
  expect(missing.events.filter(e => e.mark === 'missed')).toHaveLength(1);
  const flat = take(s => s, -30);
  expect(flat.tuning).toBeLessThan(-20);
  expect(flat.pitch).toBe(1);
});
