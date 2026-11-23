import { describe, expect, it } from 'vitest';
import type { Unit } from '../src/piece/curriculum';
import { keyStats } from '../src/piece/bests';
import { toEvents, type Exercise } from '../src/piece/exercise';
import { gradeKeys, keyReach, keyWindow, type KeyPress } from '../src/piece/grade';
import {
  countUp,
  keyWin,
  liveRun,
  pieceStars,
  revealStars,
  RUN_FADE_MS,
  RUN_PULSE_MS,
  RUN_SHOWN,
  runCounter,
  runEvidence,
  runLine,
  runPlace,
  starChip,
  starCount,
  starMoment,
  starNews,
  starsAt,
  starsFor,
  starTitle,
  stepStars,
  takeRun,
  takeStars,
  THREE_STARS,
  type Box,
  type Moment,
  type RunMemo,
} from '../src/piece/game';
import {
  advanceUnit,
  CLEAN,
  DAY,
  initialUnit,
  placeHands,
  placeUnit,
  ROOM,
  unitState,
  type UnitProgress,
} from '../src/piece/progress';

const LADDER = [0.5, 0.6, 0.7, 0.8, 0.88, 0.94, 1];
const unit = (o: Partial<Unit> = {}): Unit => ({
  id: 'LR:1-4',
  kind: 'together',
  stage: 5,
  title: 'Bars 1–4 hands together',
  goal: '',
  why: '',
  bars: [0, 1, 2, 3],
  hands: ['L', 'R'],
  requires: [],
  rungs: LADDER,
  certify: [0.8, 1],
  goalBpm: 66,
  ...o,
});
const together = unit();
const left = unit({ id: 'L:1-4', kind: 'hand', hands: ['L'], rungs: LADDER.filter((r) => r <= 0.8), certify: [0.8] });
const now = Date.UTC(2026, 10, 14, 18);
const p = (o: Partial<UnitProgress> = {}): UnitProgress => ({ ...initialUnit(), ...o });

describe('take stars', () => {
  it('uses the named lines: 65% needs more room, 80% is clean, 95% is three stars', () => {
    expect([ROOM, CLEAN, THREE_STARS]).toEqual([0.65, 0.8, 0.95]);
    expect([0, 64, 65, 79, 80, 94, 95, 100].map(starsAt)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it('gives 0 to 3 stars for a trusted take, by the percentage as printed', () => {
    const stars = (score: number) => takeStars(score, true, true)!.stars;
    expect([0, 0.5, 0.649, 0.65, 0.7, 0.799, 0.8, 0.9, 0.949, 0.95, 1].map(stars)).toEqual([
      0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3,
    ]);
  });

  it('floors like the card, so 79.99% has one star and 94.99% two', () => {
    expect(takeStars(0.7999, true, true)).toEqual({ stars: 1, estimate: false });
    expect(takeStars(0.79999999, true, true)!.stars).toBe(1);
    expect(takeStars(0.9499, true, true)).toEqual({ stars: 2, estimate: false });
    expect(takeStars(0.94999999, true, true)!.stars).toBe(2);
    expect(takeStars(0.6499, true, true)!.stars).toBe(0);
  });

  it('gives an untrusted take nothing at all, not even zero stars', () => {
    for (const score of [0, 0.5, 0.8, 1]) {
      expect(takeStars(score, false, true)).toBeUndefined();
      expect(takeStars(score, false, false)).toBeUndefined();
    }
    expect(takeStars(Number.NaN, true, true)).toBeUndefined();
  });

  it('marks an untimed (uncalibrated microphone) take as an estimate', () => {
    expect(takeStars(0.85, true, false)).toEqual({ stars: 2, estimate: true });
    expect(takeStars(0.85, true, true)).toEqual({ stars: 2, estimate: false });
  });

  it('fills the stars during the count-up only as the count passes each line', () => {
    expect(revealStars(1, 0)).toBe(0);
    expect(revealStars(1, 1)).toBe(3);
    expect(revealStars(0.82, 1)).toBe(2);
    expect(revealStars(0.82, 2)).toBe(2);
    const seen = Array.from({ length: 101 }, (_, i) => revealStars(0.97, i / 100));
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    expect(new Set(seen)).toEqual(new Set([0, 1, 2, 3]));
  });

  it("fills on the same easing as the on-time count, and ends on the take's own stars", () => {
    expect([0, 0.5, 1, 2, -1].map(countUp)).toEqual([0, 0.75, 1, 1, 0]);
    for (const score of [0.5, 0.66, 0.81, 0.96]) {
      for (let i = 0; i <= 20; i++)
        expect(revealStars(score, i / 20)).toBe(starsAt(Math.floor(Math.floor(score * 100) * countUp(i / 20))));
      expect(revealStars(score, 1)).toBe(takeStars(score, true, true)!.stars);
    }
  });
});

describe('step stars', () => {
  it('gives one for a first clean take, two once certified, three when certified at the top step', () => {
    expect(stepStars(together, undefined).stars).toBe(0);
    expect(stepStars(together, p({ attempts: 3 })).stars).toBe(0);
    expect(stepStars(together, p({ best: 0.5, attempts: 1 })).stars).toBe(1);
    expect(stepStars(together, p({ best: 0.8, certified: [0.8] })).stars).toBe(2);
    expect(stepStars(together, p({ best: 1, certified: [0.8, 1] })).stars).toBe(3);
  });

  it('works out the top step from the rungs: one hand alone tops out at 80%', () => {
    expect(stepStars(left, p({ best: 0.8, certified: [0.8] })).stars).toBe(3);
    expect(stepStars(together, p({ best: 0.8, certified: [0.8] })).stars).toBe(2);
  });

  it('adds a learned seal and a due marker without touching the stars', () => {
    const learned = p({ best: 1, certified: [0.8, 1], learned: true, due: now + DAY, attempts: 9 });
    expect(stepStars(together, learned, now)).toEqual({ stars: 3, learned: true, due: false });
    expect(stepStars(together, { ...learned, due: now - 1 }, now)).toEqual({ stars: 3, learned: true, due: true });
    // unitState says "due" or "learned" here, never "done": the stars do not come from it.
    expect(unitState(together, { ...learned, due: now - 1 }, now)).toBe('due');
  });

  it('gives a sameAs step the stars of the step it points to', () => {
    const copy = unit({ id: 'LR:9-12', sameAs: together.id });
    const units = [together, copy],
      saved: Record<string, UnitProgress> = { [together.id]: p({ best: 0.8, certified: [0.8] }) };
    const get = (id: string) => saved[id];
    expect(starsFor(units, copy, get)!.stars).toBe(2);
    expect(starsFor(units, together, get)!.stars).toBe(2);
    expect(pieceStars(units, get)).toEqual({ earned: 2, total: 3 });
  });

  it('gives hearing the piece no stars and leaves it out of the total', () => {
    const listen = unit({ id: 'listen', kind: 'listen', rungs: [1], certify: [] });
    const get = (id: string) => (id === 'listen' ? p({ attempts: 1, best: 1 }) : undefined);
    expect(starsFor([listen, together], listen, get)).toBeUndefined();
    expect(pieceStars([listen, together, left], get)).toEqual({ earned: 0, total: 6 });
  });

  it('names a new star for the moment, and nothing when none was earned', () => {
    expect(starNews(together, p(), p({ best: 0.5 }))).toBe('first star');
    expect(starNews(together, p({ best: 0.8 }), p({ best: 0.8, certified: [0.8] }))).toBe('second star');
    expect(starNews(together, p({ best: 1, certified: [0.8] }), p({ best: 1, certified: [0.8, 1] }))).toBe(
      'third star',
    );
    expect(starNews(left, p({ best: 0.8 }), p({ best: 0.8, certified: [0.8] }))).toBe('second and third stars');
    expect(starNews(together, p({ best: 0.5 }), p({ best: 0.6 }))).toBeUndefined();
    expect(starTitle('Certified at 80%', 'second star')).toBe('Certified at 80% · second star');
    expect(starTitle(undefined, 'first star')).toBe('First star for this step');
  });

  it('adds star news to the milestone moment, and leaves it alone without news', () => {
    const cert: Moment = { title: 'Certified at 80%', ms: 2200, size: 'medium', next: true },
      learned: Moment = { title: 'Learned', ms: 3500, size: 'big', next: false };
    expect(starMoment(undefined, undefined)).toBeUndefined();
    expect(starMoment(cert, undefined)).toBe(cert);
    expect(starMoment(cert, 'second star')).toEqual({ ...cert, title: 'Certified at 80% · second star' });
    expect(starMoment(learned, 'third star')).toEqual({ ...learned, title: 'Learned · third star' });
    expect(starMoment(undefined, 'first star')).toEqual({
      title: 'First star for this step',
      ms: 1200,
      size: 'small',
      next: true,
    });
  });

  it('names the new star on the Last take line, which every look shows', () => {
    expect(starChip('92% · Clean, 1 of 2', 'first star')).toBe('92% · Clean, 1 of 2 · first star');
    expect(starChip('92% · Clean, 1 of 2', undefined)).toBe('92% · Clean, 1 of 2');
    expect(starCount({ earned: 4, total: 12 })).toBe('4 of 12 stars');
  });
});

describe('step stars never go down', () => {
  const stars = (u: Unit, x: UnitProgress) => stepStars(u, x, now).stars;
  const answer = (u: Unit, x: UnitProgress, score: number, comfortable = true, at = now) =>
    advanceUnit(u, x, { trusted: true, score }, comfortable, at, true).progress;

  it('keeps them through a tempo step-down', () => {
    let x = answer(together, p({ rung: 2 }), 0.85);
    expect(stars(together, x)).toBe(1);
    x = answer(together, x, 0.4);
    x = answer(together, x, 0.4);
    expect(x.rung).toBe(1);
    expect(stars(together, x)).toBe(1);
  });

  it('keeps them through a faded review, and while the review is due', () => {
    const learned = p({
      rung: 6,
      best: 1,
      certified: [0.8, 1],
      learned: true,
      due: now - 1,
      interval: 4,
      attempts: 20,
      last: now - 5 * DAY,
      days: ['2026-11-01', '2026-11-02'],
    });
    expect(stepStars(together, learned, now)).toEqual({ stars: 3, learned: true, due: true });
    const faded = answer(together, learned, 0.3);
    expect(faded.rung).toBe(5);
    expect(stepStars(together, faded, now)).toEqual({ stars: 3, learned: true, due: false });
    const uncomfortable = answer(together, learned, 0.9, false);
    expect(stars(together, uncomfortable)).toBe(3);
  });

  it('keeps them through takes that are not counted and placement misses', () => {
    const x = p({ rung: 3, best: 0.8, certified: [0.8], attempts: 4 });
    expect(stars(together, advanceUnit(together, x, { trusted: false, score: 1 }, true, now, true).progress)).toBe(2);
    expect(stars(together, advanceUnit(together, x, { trusted: true, score: 1 }, true, now, false).progress)).toBe(2);
    expect(stars(together, placeUnit(together, x, 6, { trusted: true, score: 0.5 }, true, now, true).progress)).toBe(2);
    expect(stars(together, placeUnit(together, x, 6, { trusted: true, score: 0.9 }, true, now, true).progress)).toBe(2);
  });

  it('only ever grows over a long run of mixed answers through the real ladder', () => {
    for (const u of [together, left]) {
      let x = initialUnit(),
        seed = 7,
        at = now,
        due = 0;
      const seen = new Set<number>();
      const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
      for (let i = 0; i < 600; i++) {
        at += next() < 0.2 ? DAY : 60000;
        const before = stepStars(u, x, at),
          trusted = next() < 0.9,
          after = advanceUnit(u, x, { trusted, score: 0.45 + next() * 0.6 }, next() < 0.85, at, next() < 0.95).progress;
        const s = stepStars(u, after, at);
        seen.add(s.stars);
        if (s.due) due++;
        expect(s.stars).toBeGreaterThanOrEqual(before.stars);
        if (before.learned) expect(s.learned).toBe(true);
        x = after;
      }
      // The run went through every star, the learned state and due reviews, so each was checked on the way.
      // One hand alone certifies only at its top step (80%), so it goes from one star straight to three.
      expect([...seen].sort()).toEqual(u === left ? [0, 1, 3] : [0, 1, 2, 3]);
      expect(x.learned).toBe(true);
      expect(due).toBeGreaterThan(0);
    }
  });

  it('only grows when a placement moves the one-hand steps', () => {
    const units = [together, left],
      saved: Record<string, UnitProgress> = { [left.id]: p({ rung: 1, best: 0.6, attempts: 2 }) };
    const moved = placeHands(units, together, 0.88, (id) => saved[id]);
    expect(moved.length).toBe(1);
    expect(stepStars(left, moved[0][1]).stars).toBeGreaterThanOrEqual(stepStars(left, saved[left.id]).stars);
  });
});

describe('run counter and run lines', () => {
  const frames = (runs: number[], lively = true, step = 16) => {
    let memo: RunMemo = { last: 0 },
      t = 1000;
    return runs.map((run) => {
      const r = runCounter(memo, run, t, lively);
      memo = r.memo;
      t += step;
      return r;
    });
  };

  it('appears from 5 in a row, worded without loss words', () => {
    const r = frames([1, 2, 3, 4, 5, 12]);
    expect(r.slice(0, 4).every((f) => !f.show)).toBe(true);
    expect(r[4].show!.text).toBe(`${RUN_SHOWN} in a row`);
    expect(r[5].show!.text).toBe('12 in a row');
    for (const f of r) expect(f.show?.text ?? '').not.toMatch(/streak|combo|lost|reset|failed/i);
  });

  it('pulses as it reaches 10, 20 and 30 in the lively look only', () => {
    const lively = frames([8, 9, 10, 10, 11]);
    expect(lively[2].show!.scale).toBe(1);
    expect(lively[3].show!.scale).toBeGreaterThan(1);
    expect(lively[3].moving).toBe(true);
    const calm = frames([8, 9, 10, 10, 11], false);
    for (const f of calm) expect(f.show!.scale).toBe(1);
    const after = runCounter({ last: 10, pulseAt: 0 }, 12, RUN_PULSE_MS + 1, true);
    expect(after.show!.scale).toBe(1);
    expect(after.moving).toBe(false);
    const thirty = runCounter({ last: 29 }, 30, 500, true);
    expect(runCounter(thirty.memo, 30, 600, true).show!.scale).toBeGreaterThan(1);
    expect(runCounter({ last: 30 }, 31, 500, true).memo.pulseAt).toBeUndefined();
  });

  it('fades out quietly when the run ends (lively), and is simply gone in the calm look', () => {
    const ended = runCounter({ last: 12 }, 0, 1000, true);
    expect(ended.show).toEqual({ text: '12 in a row', alpha: 1, scale: 1 });
    const half = runCounter(ended.memo, 0, 1000 + RUN_FADE_MS / 2, true);
    expect(half.show!.alpha).toBeCloseTo(0.5);
    expect(half.show!.text).toBe('12 in a row');
    expect(runCounter(half.memo, 0, 1000 + RUN_FADE_MS, true).show).toBeUndefined();
    expect(runCounter({ last: 12 }, 0, 1000, false).show).toBeUndefined();
    // A new run from 5 replaces the fade.
    expect(runCounter(ended.memo, 5, 1100, true).show!.text).toBe('5 in a row');
  });

  it('adds "Longest run" from 5 up, and the callout names only the tight notes', () => {
    expect(runLine(4)).toBeUndefined();
    expect(runLine(5)).toBe('Longest run: 5');
    expect(keyWin(0, 40)).toBeUndefined();
    expect(keyWin(1, 40)).toBe('1 note within 40 ms of the beat.');
    expect(keyWin(3, 40)).toBe('3 notes within 40 ms of the beat.');
    expect(keyWin(3, 40)).not.toMatch(/run|in a row/);
  });

  it('places the counter at the top left, clear of the message pill and the moment', () => {
    expect(runPlace(90, 26, [])).toEqual({ x: 8, y: 10, w: 90, h: 26 });
    const hits = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const w of [280, 390, 1100]) {
      const pill: Box = { x: w / 2 - 130, y: 10, w: 260, h: 28 },
        moment: Box = { x: 8, y: 40, w: w - 16, h: 60 };
      for (const avoid of [[pill], [moment], [pill, moment], [moment, pill]]) {
        const box = runPlace(110, 26, avoid);
        for (const a of avoid) expect(hits(box, a)).toBe(false);
        expect(box.x).toBe(8);
      }
    }
    // A pill that leaves the corner free does not move it.
    expect(runPlace(90, 26, [{ x: 150, y: 10, w: 90, h: 28 }]).y).toBe(10);
  });

  it('starts past the bar-label gutter, so a "bar N" label scrolling down the left edge never passes under it', () => {
    const hits = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    // view.ts draws "bar N" at x 6, centred 7 px above its bar line; the gutter ends 8 px past the widest label.
    for (const labelWidth of [30, 38, 46]) {
      const gutter = 6 + labelWidth + 8,
        labels = Array.from({ length: 120 }, (_, k): Box => ({ x: 6, y: k - 14, w: labelWidth, h: 14 }));
      // Without the gutter the corner is under the labels' path.
      expect(labels.some((l) => hits(runPlace(110, 26, []), l))).toBe(true);
      for (const w of [280, 390, 1100]) {
        const pill: Box = { x: w / 2 - 130, y: 10, w: 260, h: 28 },
          moment: Box = { x: 8, y: 40, w: w - 16, h: 60 };
        for (const avoid of [[], [pill], [moment], [pill, moment], [moment, pill]]) {
          const box = runPlace(110, 26, avoid, gutter);
          expect(box.x).toBe(gutter);
          for (const l of labels) expect(hits(box, l)).toBe(false);
          for (const a of avoid) expect(hits(box, a)).toBe(false);
        }
      }
    }
  });
});

/** A line of attacks (single notes or chords), one every beatStep beats. */
const line = (spec: (number | number[])[], beatStep = 1): Exercise => ({
  id: 'run',
  title: 'run',
  instrument: 'piano',
  beatsPerBar: 4,
  beats: spec.length * beatStep,
  keySig: 0,
  bars: [{ beat: 0, number: 1 }],
  chords: [],
  events: toEvents(
    spec.flatMap((m, i) =>
      (Array.isArray(m) ? m : [m]).map((midi) => ({ beat: i * beatStep, midi, hand: 'R' as const, dur: 0.5 })),
    ),
  ),
});
interface Play {
  off?: Record<number, number>;
  skip?: number[];
  wrong?: number[];
  drop?: number[];
}
/** Presses for every attack at period p, on the beat unless off moves it; skip leaves an attack out, drop its lowest note, wrong plays every note a semitone up. */
const play = (ex: Exercise, p: number, o: Play = {}): KeyPress[] =>
  ex.events.flatMap((e, i) =>
    o.skip?.includes(i)
      ? []
      : e.notes
          .filter((_, k) => !(o.drop?.includes(i) && k === 0))
          .map((n) => ({ t: e.beat * p + (o.off?.[i] ?? 0), midi: o.wrong?.includes(i) ? n.midi + 1 : n.midi })),
  );
const card = (ex: Exercise, bpm: number, presses: KeyPress[]) => keyStats(gradeKeys(ex, bpm, presses).events).run;
/** What the counter shows over a take, frame by frame, with only the presses made by each frame. */
const shown = (ex: Exercise, bpm: number, presses: KeyPress[], step = 0.05) => {
  const out: number[] = [];
  for (let t = -0.5; t <= ex.beats * (60 / bpm) + 2; t += step) {
    const so = presses.filter((x) => x.t <= t);
    out.push(liveRun(ex, 60 / bpm, runEvidence(ex, bpm, so), t).run);
  }
  return out;
};

describe('the run counter counts attacks, like the card', () => {
  it('counts a chord once, not once per note', () => {
    const ex = line([[60, 64, 67], 62, [60, 64], 65, 67, [64, 67, 72]]),
      presses = play(ex, 1);
    expect(takeRun(ex, 60, presses)).toBe(6);
    expect(card(ex, 60, presses)).toBe(6);
    expect(Math.max(...shown(ex, 60, presses))).toBe(6);
  });

  it('ends at a skipped attack, though no key was pressed there', () => {
    const ex = line([60, 62, 64, 65, 67, 69, 71, 72, 74, 76]),
      presses = play(ex, 1, { skip: [6] });
    expect(card(ex, 60, presses)).toBe(6);
    expect(takeRun(ex, 60, presses)).toBe(6);
    const s = shown(ex, 60, presses);
    expect(Math.max(...s)).toBe(6);
    expect(s[s.length - 1]).toBe(3);
    // It ends once no later press could still reach the skipped beat, not at the end of the take.
    const after = 6 + 2 * keyReach(1) + 0.1;
    expect(
      liveRun(
        ex,
        1,
        runEvidence(
          ex,
          60,
          presses.filter((x) => x.t <= after),
        ),
        after,
      ).run,
    ).toBe(0);
  });

  it('ends at a missing chord tone, an early or late attack and a wrong key', () => {
    const ex = line([60, [62, 65], 64, 65, 67, 69, 71, 72, [74, 77], 76, 77, 79]),
      off = (keyWindow(1) + keyReach(1)) / 2;
    for (const o of [{ drop: [8] }, { off: { 8: -off } }, { off: { 8: off } }, { wrong: [8] }]) {
      const presses = play(ex, 1, o);
      expect(card(ex, 60, presses)).toBe(8);
      expect(takeRun(ex, 60, presses)).toBe(8);
      expect(Math.max(...shown(ex, 60, presses))).toBe(8);
    }
    // The wrong key ends the count as it goes down, not once its beat has passed.
    const wrong = play(ex, 1, { wrong: [8] }).filter((x) => x.t <= 8.01);
    expect(liveRun(ex, 1, runEvidence(ex, 60, wrong), 8.01).run).toBe(0);
  });

  it('counts an attack by the grade window: on time inside it, ended outside it', () => {
    const ex = line([60, 62, 64, 65, 67, 69]);
    expect(takeRun(ex, 60, play(ex, 1, { off: { 2: keyWindow(1) * 0.9 } }))).toBe(6);
    expect(takeRun(ex, 60, play(ex, 1, { off: { 2: keyWindow(1) * 1.1 } }))).toBe(3);
  });

  it('never counts an attack before it is played, and climbs one attack at a time', () => {
    const ex = line([60, 62, 64, 65, 67, 69, 71]),
      presses = play(ex, 1);
    const s = shown(ex, 60, presses, 0.01);
    for (let i = 1; i < s.length; i++) expect(s[i] - s[i - 1]).toBeLessThanOrEqual(1);
    for (let k = 0; k < 7; k++) {
      const t = k - 0.01;
      expect(
        liveRun(
          ex,
          1,
          runEvidence(
            ex,
            60,
            presses.filter((x) => x.t <= t),
          ),
          t,
        ).run,
      ).toBeLessThanOrEqual(k);
    }
  });

  it('lets a stray extra key end the live count, so the counter is never more than the card', () => {
    const ex = line([60, 62, 64, 65, 67, 69, 71, 72]),
      presses = [...play(ex, 1), { t: 4.5, midi: 90 }].sort((a, b) => a.t - b.t);
    expect(card(ex, 60, presses)).toBe(8);
    // Beats 0 to 4 (five attacks), then the stray key, then beats 5 to 7.
    expect(takeRun(ex, 60, presses)).toBe(5);
    expect(Math.max(...shown(ex, 60, presses))).toBe(5);
    expect(shown(ex, 60, presses).at(-1)).toBe(3);
  });

  it('matches the card on random takes, and the counter never shows more than the card line', () => {
    let seed = 11;
    const kinds = [0, 0, 0];
    const r = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    for (let n = 0; n < 150; n++) {
      const bpm = 50 + Math.floor(r() * 110),
        p = 60 / bpm,
        spec: (number | number[])[] = [];
      for (let i = 0; i < 6 + Math.floor(r() * 14); i++)
        spec.push(r() < 0.3 ? [55 + i, 59 + i, 62 + i] : 60 + Math.floor(r() * 12));
      const ex = line(spec, [0.5, 1, 1, 2][Math.floor(r() * 4)]),
        presses: KeyPress[] = [];
      for (const e of ex.events) {
        if (r() < 0.08) continue;
        const at = e.beat * p + (r() < 0.85 ? (r() - 0.5) * keyWindow(p) : (r() - 0.5) * 2.6 * keyReach(p));
        for (const note of e.notes) {
          if (r() < 0.05) continue;
          presses.push({ t: at + (e.notes.length > 1 ? r() * 0.04 : 0), midi: r() < 0.06 ? note.midi + 2 : note.midi });
        }
      }
      presses.sort((a, b) => a.t - b.t);
      const stray = runEvidence(ex, bpm, presses).wrong.length > 0,
        mine = takeRun(ex, bpm, presses),
        theirs = card(ex, bpm, presses);
      if (stray) expect(mine).toBeLessThanOrEqual(theirs);
      else expect(mine).toBe(theirs);
      expect(Math.max(0, ...shown(ex, bpm, presses, 0.1))).toBeLessThanOrEqual(mine);
      kinds[stray ? 1 : 0]++;
      if (mine >= RUN_SHOWN) kinds[2]++;
    }
    // Both kinds of take, and runs long enough to show, were checked.
    expect(kinds.every((k) => k >= 20)).toBe(true);
  });
});
