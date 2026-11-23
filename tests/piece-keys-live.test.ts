/**
 * The live key judge (KeyJudge) and the live run counter (LiveRun) against their references, judgeKeys and liveRun,
 * which stay in the code unchanged. After every press the incremental readings must equal judgeKeys' (live and
 * settled, same tier per note, same wrong keys), the changes it reports must be exactly the ones main.ts used to find
 * by comparing maps, and the run counter must give liveRun's answer at every frame.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { judgeKeys, KeyJudge, keyReach, keyTogether, LENIENCY, setLeniency, type KeyPress } from '../src/piece/grade';
import { LiveRun, liveRun, runEvidence } from '../src/piece/game';
import { toEvents, type Exercise, type XEvent } from '../src/piece/exercise';

afterEach(() => setLeniency(LENIENCY.relaxed));

function rng(seed: number): () => number {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}
const exercise = (events: XEvent[], beats = Math.ceil(Math.max(1, ...events.map((e) => e.beat + 1)))): Exercise => ({
  id: 'live',
  title: 'live',
  instrument: 'piano',
  beatsPerBar: 4,
  beats,
  keySig: 0,
  bars: [{ beat: 0, number: 1 }],
  chords: [],
  events,
});
const sorted = <T>(m: ReadonlyMap<string, T>) => [...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * Feeds presses (in the given arrival order) to a KeyJudge, in batches of one or more, and checks everything after
 * each batch against the references. frames: how many run-counter frames to check between batches.
 */
function check(ex: Exercise, bpm: number, presses: KeyPress[], r: () => number, frames = 3): { moved: number } {
  const judge = new KeyJudge(ex, bpm),
    period = 60 / bpm,
    so: KeyPress[] = [];
  let run: LiveRun | undefined,
    prev = new Map<string, string>(),
    prevSettled = new Map<string, string>(),
    t = -1,
    moved = 0;
  for (let k = 0; k < presses.length;) {
    const batch = r() < 0.8 ? 1 : 1 + Math.floor(r() * 3);
    for (let b = 0; b < batch && k < presses.length; b++) so.push(presses[k++]);
    const diff = judge.sync(so),
      live = judgeKeys(ex, bpm, so),
      settled = judgeKeys(ex, bpm, so, true);
    const where = `${so.length} presses`;
    expect(sorted(judge.live), `live after ${where}`).toEqual(sorted(live.notes));
    expect(sorted(judge.settled), `settled after ${where}`).toEqual(sorted(settled.notes));
    expect(
      [...judge.wrong].sort((a, b) => a - b),
      `wrong after ${where}`,
    ).toEqual([...live.wrong]);
    // main.ts walked the new map in order and skipped the keys whose tier had not changed: the same list, same order.
    expect(diff.changed, `changed after ${where}`).toEqual(
      [...live.notes].filter(([key, tier]) => prev.get(key) !== tier).map(([key]) => key),
    );
    // After a reset of the lane main.ts lists every key in judgeKeys' order.
    expect(judge.inOrder([...judge.live.keys()]), `order after ${where}`).toEqual([...live.notes.keys()]);
    // Every note whose reading moved is reported, so the run counter never keeps a stale walk.
    const reported = new Set(diff.events.map((i) => judge.graded[i].e));
    for (const { e } of judge.graded)
      for (const n of e.notes) {
        const key = `${e.beat}:${n.midi}`;
        if (live.notes.get(key) !== prev.get(key) || settled.notes.get(key) !== prevSettled.get(key))
          expect(reported.has(e), `unreported ${key}`).toBe(true);
      }
    moved = Math.max(moved, diff.events.length);
    prev = new Map(live.notes);
    prevSettled = new Map(settled.notes);
    if (run) run.update(diff);
    else run = new LiveRun(judge);
    const ev = runEvidence(ex, bpm, so);
    for (let f = 0; f < frames; f++) {
      // Mostly forward, as frames go; now and then back (a new reading of the clock), and sometimes far ahead.
      const roll = r();
      t = roll < 0.08 ? t - r() * 0.5 : roll < 0.12 ? t + r() * 3 : Math.max(t, so[so.length - 1].t) + r() * 0.05;
      expect(run.now(t), `run at ${t} after ${where}`).toEqual(liveRun(ex, period, ev, t));
    }
  }
  if (run) expect(run.now(Infinity)).toEqual(liveRun(ex, period, runEvidence(ex, bpm, so), Infinity));
  return { moved };
}

/** A random exercise: single notes and chords, repeated notes, a few ungraded events, gaps, varied spacing. */
function randomExercise(r: () => number): Exercise {
  const notes: { beat: number; midi: number; hand: 'R'; dur: number }[] = [];
  let beat = r() * 0.5;
  const count = 4 + Math.floor(r() * 26);
  let last = 60;
  for (let i = 0; i < count; i++) {
    const size = r() < 0.3 ? 2 + Math.floor(r() * 3) : 1,
      root = r() < 0.25 ? last : 48 + Math.floor(r() * 24);
    last = root;
    for (let k = 0; k < size; k++)
      notes.push({ beat, midi: root + k * (3 + Math.floor(r() * 2)), hand: 'R', dur: 0.25 });
    beat += r() < 0.08 ? 4 + r() * 6 : [0.25, 0.25, 0.5, 0.5, 1, 1.5, 2][Math.floor(r() * 7)];
  }
  const events = toEvents(notes).map((e) => ({ ...e, grade: r() < 0.06 ? ('none' as const) : e.grade }));
  return exercise(events);
}
/** Presses for an exercise with every kind of slip. */
function randomPresses(ex: Exercise, bpm: number, r: () => number): KeyPress[] {
  const period = 60 / bpm,
    reach = keyReach(period),
    presses: KeyPress[] = [];
  for (const e of ex.events) {
    if (r() < 0.1) continue; // a missed attack
    const roll = r(),
      at =
        e.beat * period +
        (roll < 0.6
          ? (r() - 0.5) * 0.06 // on time
          : roll < 0.85
            ? (r() - 0.5) * 2.2 * reach // early or late, sometimes past the reach
            : (r() < 0.5 ? -1 : 1) * reach * (0.9 + r() * 0.2)); // right at the edge of the reach
    for (const n of e.notes) {
      if (r() < 0.08) continue; // a missing chord tone
      const midi = r() < 0.1 ? n.midi + [-2, -1, 1, 2, 12][Math.floor(r() * 5)] : n.midi; // a wrong key
      presses.push({ t: at + (e.notes.length > 1 ? r() * 0.1 : 0), midi }); // chords a little spread
      if (r() < 0.05) presses.push({ t: at + r() * 0.05, midi }); // the same key twice
    }
    if (r() < 0.1) presses.push({ t: at + (r() - 0.5) * 2 * reach, midi: 40 + Math.floor(r() * 50) }); // a stray key
  }
  if (r() < 0.3) presses.push({ t: -0.4 + r() * 0.3, midi: 60 }); // before the first beat
  return presses.sort((a, b) => a.t - b.t);
}

describe('KeyJudge and LiveRun equal judgeKeys and liveRun after every press', () => {
  it('on random exercises and takes, at every leniency', { timeout: 120000 }, () => {
    const r = rng(20261122);
    let takes = 0;
    for (const level of ['tight', 'standard', 'relaxed', 'loose'] as const) {
      setLeniency(level);
      for (let n = 0; n < 60; n++) {
        const ex = randomExercise(r),
          bpm = 40 + Math.floor(r() * 160);
        check(ex, bpm, randomPresses(ex, bpm, r), r);
        takes++;
      }
    }
    expect(takes).toBe(240);
  });

  it('when presses arrive out of time order (it judges them all again)', { timeout: 60000 }, () => {
    const r = rng(77);
    for (let n = 0; n < 60; n++) {
      const ex = randomExercise(r),
        bpm = 50 + Math.floor(r() * 120),
        presses = randomPresses(ex, bpm, r);
      // Swap neighbours now and then, and sometimes send one much earlier press late.
      for (let k = 1; k < presses.length; k++)
        if (r() < 0.15) [presses[k - 1], presses[k]] = [presses[k], presses[k - 1]];
      if (presses.length > 3 && r() < 0.5) presses.push({ ...presses[1], t: presses[1].t - 0.01 });
      check(ex, bpm, presses, r);
    }
  });

  it('when one press re-aligns the whole take so far', () => {
    // Sixteenths at a slow tempo, each press just after the midpoint between two beats and within reach of both. While
    // there is a later beat, the matching pairs each press with the beat after it (slightly closer); the last press has
    // none, and pairing every press with the beat before it becomes cheaper: that one press moves every pair.
    const bpm = 40,
      period = 60 / bpm,
      count = 40,
      ex = exercise(
        toEvents(Array.from({ length: count }, (_, i) => ({ beat: i / 4, midi: 60, hand: 'R', dur: 0.25 }))),
      );
    // Tight timing, so a press is late when paired with the beat before it and early with the beat after it.
    setLeniency('tight');
    expect(keyReach(period)).toBeGreaterThan(period / 8);
    const presses = Array.from({ length: count }, (_, i) => ({ t: (i + 0.5) * (period / 4) + 0.002, midi: 60 }));
    const { moved } = check(ex, bpm, presses, rng(5), 2);
    // The chain really moved far back in one press, so the trace back from the new corner was long.
    expect(moved).toBeGreaterThan(10);
    // And the other way: the presses a little early, then late, then early again.
    const wobble = Array.from({ length: count }, (_, i) => ({
      t: i * (period / 4) + (i % 3 === 0 ? 0.4 : -0.4) * keyReach(period),
      midi: i % 5 === 0 ? 61 : 60,
    }));
    check(ex, bpm, wobble, rng(6), 2);
  });

  it('with repeated notes, chords pressed apart, presses together at one instant and long gaps', () => {
    const r = rng(9);
    for (let n = 0; n < 40; n++) {
      const bpm = 60 + Math.floor(r() * 100),
        period = 60 / bpm,
        together = keyTogether(period);
      const events = toEvents(
        Array.from({ length: 12 }, (_, i) => [
          { beat: i < 6 ? i * 0.5 : 20 + i, midi: 60, hand: 'R' as const, dur: 0.5 },
          ...(i % 3 === 0 ? [{ beat: i < 6 ? i * 0.5 : 20 + i, midi: 64, hand: 'R' as const, dur: 0.5 }] : []),
        ]).flat(),
      );
      const ex = exercise(events),
        presses: KeyPress[] = [];
      for (const e of events)
        for (const note of e.notes) {
          const at = e.beat * period + (r() - 0.5) * 0.1;
          // A chord's second key just inside or just outside the grouping limit; some keys at exactly the same time.
          presses.push({ t: at, midi: note.midi });
          if (r() < 0.3) presses.push({ t: at + together * (r() < 0.5 ? 0.999 : 1.001), midi: note.midi + 4 });
          if (r() < 0.2) presses.push({ t: at, midi: note.midi + 7 });
        }
      check(
        ex,
        bpm,
        presses.sort((a, b) => a.t - b.t),
        r,
      );
    }
  });

  it('when two events share a beat and a key, and with nothing graded', () => {
    // Two events at one beat (toEvents never makes them, but an exercise may): judgeKeys' map keeps the last reading.
    const r = rng(13);
    for (let n = 0; n < 40; n++) {
      const bpm = 60 + Math.floor(r() * 80),
        period = 60 / bpm;
      const events: XEvent[] = [];
      for (let i = 0; i < 10; i++) {
        events.push({ beat: i, notes: [{ midi: 60 + (i % 3), hand: 'R', dur: 1 }], grade: 'pitch' });
        if (r() < 0.4)
          events.push({
            beat: i,
            notes: [
              { midi: 60 + (i % 3), hand: 'L', dur: 1 },
              { midi: 60 + (i % 3), hand: 'L', dur: 1 },
            ],
            grade: 'onset',
          });
      }
      const ex = exercise(events),
        presses = events
          .filter(() => r() < 0.9)
          .map((e) => ({ t: e.beat * period + (r() - 0.5) * 0.3, midi: e.notes[0].midi + (r() < 0.1 ? 1 : 0) }))
          .sort((a, b) => a.t - b.t);
      check(ex, bpm, presses, r);
    }
    const none = exercise([{ beat: 0, notes: [{ midi: 60, hand: 'R', dur: 1 }], grade: 'none' }]);
    check(
      none,
      60,
      [
        { t: 0, midi: 60 },
        { t: 0.5, midi: 62 },
      ],
      r,
    );
  });

  it('refuses a press list that was not only appended to', () => {
    const ex = exercise(toEvents([{ beat: 0, midi: 60, hand: 'R', dur: 1 }])),
      judge = new KeyJudge(ex, 60);
    judge.sync([{ t: 0, midi: 60 }]);
    expect(() => judge.sync([{ t: 0, midi: 60 }])).toThrow(/appended/);
    expect(() => judge.sync([])).toThrow(/appended/);
  });
});
