import { describe, expect, it } from 'vitest';
import type { Unit } from '../src/piece/curriculum';
import { pieceMap } from '../src/piece/map';
import { DAY, initialUnit, type UnitProgress } from '../src/piece/progress';
import type { Score } from '../src/piece/score';

const LADDER = [0.5, 0.6, 0.7, 0.8, 0.88, 0.94, 1];
const unit = (o: Partial<Unit>): Unit => ({
  id: 'x',
  kind: 'hand',
  stage: 3,
  title: 'x',
  goal: '',
  why: '',
  bars: [],
  hands: ['L'],
  requires: [],
  rungs: LADDER.filter((r) => r <= 0.8),
  certify: [0.8],
  goalBpm: 66,
  ...o,
});
const units = [
  unit({ id: 'L:1-4', title: 'Bars 1–4 · left hand', bars: [0, 1, 2, 3] }),
  unit({ id: 'L:5-8', title: 'Bars 5–8 · left hand', bars: [4, 5, 6, 7], sameAs: 'L:1-4' }),
  unit({ id: 'R:1-4', title: 'Bars 1–4 · right hand', bars: [0, 1, 2, 3], hands: ['R'] }),
  unit({
    id: 'LR:1-4',
    kind: 'together',
    title: 'Bars 1–4 hands together',
    bars: [0, 1, 2, 3],
    hands: ['L', 'R'],
    rungs: LADDER,
    certify: [0.8, 1],
  }),
];
// The map reads only the bar numbers and the sections of the score.
const score = {
  bars: Array.from({ length: 8 }, (_, i) => ({ number: i + 1 })),
  sections: [],
} as unknown as Score;
const now = Date.UTC(2026, 10, 20, 18);
const p = (o: Partial<UnitProgress>): UnitProgress => ({ ...initialUnit(), attempts: 1, ...o });
const saved: Record<string, UnitProgress> = {
  'L:1-4': p({ best: 0.6 }),
  'R:1-4': p({ best: 0.8, certified: [0.8] }),
  'LR:1-4': p({ rung: 6, best: 1, certified: [0.8, 1], learned: true, due: now - DAY, interval: 4 }),
};
const map = (get: (id: string) => UnitProgress | undefined = (id) => saved[id]) =>
  pieceMap(score, units, get, now, 'piano').html;
/** The cell buttons, each with its classes and label. */
const cells = (html: string) =>
  [...html.matchAll(/<button class="map-cell ([^"]*)" data-unit="([^"]*)"[^>]*aria-label="([^"]*)"/g)].map((m) => ({
    cls: m[1].split(' '),
    unit: m[2],
    label: m[3],
  }));

describe('the map shows stars from saved progress', () => {
  it('gives each cell its step stars, in its class and in words', () => {
    const all = cells(map()),
      bar1 = (lane: string) => all.find((c) => c.label.startsWith(`Bar 1 · ${lane}`))!;
    expect(bar1('Left hand').cls).toContain('s1');
    expect(bar1('Left hand').label).toContain('1 of 3 stars');
    // One hand alone tops out at 80%, so certifying there is all three stars.
    expect(bar1('Right hand').cls).toContain('s3');
    expect(bar1('Right hand').label).toContain('3 of 3 stars');
  });

  it('shows a sameAs bar with the stars of the step it points to', () => {
    const bar5 = cells(map()).find((c) => c.label.startsWith('Bar 5 · Left hand'))!;
    expect(bar5.unit).toBe('L:1-4');
    expect(bar5.cls).toContain('s1');
    expect(bar5.label).toContain('1 of 3 stars');
  });

  it('keeps every star on a due review, with the due ring and words', () => {
    const together = cells(map()).filter((c) => c.unit === 'LR:1-4');
    expect(together.length).toBe(4);
    for (const c of together) {
      expect(c.cls).toEqual(expect.arrayContaining(['goal', 's3', 'due']));
      expect(c.label).toContain('3 of 3 stars');
      expect(c.label).toContain('review due');
    }
    // Not yet due: the same three stars, now learned.
    const later = cells(map((id) => (id === 'LR:1-4' ? { ...saved[id], due: now + DAY } : saved[id]))).filter(
      (c) => c.unit === 'LR:1-4',
    );
    for (const c of later) {
      expect(c.cls).toContain('s3');
      expect(c.cls).not.toContain('due');
      expect(c.label).toContain('learned');
    }
  });

  it('gives no stars to a step with none, and never uses loss words', () => {
    const empty = cells(map(() => undefined));
    expect(empty.length).toBeGreaterThan(0);
    for (const c of empty) {
      expect(c.cls.some((x) => /^s\d$/.test(x))).toBe(false);
      expect(c.label).not.toContain('stars');
    }
    for (const html of [map(), map(() => undefined)])
      expect(html.replace(/<[^>]*>/g, ' ') + cells(html).map((c) => c.label)).not.toMatch(
        /streak|combo|lost|reset|failed/i,
      );
  });
});
