import { describe, expect, it } from 'vitest';
import gymnopedie from '../src/piece/packs/gymnopedie-1.piece.txt?raw';
import { compile } from '../src/piece/notation';
import { buildCurriculum, type Unit } from '../src/piece/curriculum';
import { arrange, guitarUnits } from '../src/piece/guitar';
import { arrangePiece, guitarPieceUnits } from '../src/piece/solo';
import {
  BREATH,
  HALO,
  HERE_RING,
  MARK_R,
  RING_AIR,
  RING_REACH,
  JOIN_CLEAR,
  JOIN_GAP,
  JOIN_REACH,
  LABEL_DOWN,
  LABEL_UP,
  journeyLayout,
  labelHalf,
  NODE,
  perRow,
  type JourneyLayout,
} from '../src/piece/journey';
import { courseListHtml, journeyHtml, type JourneyState } from '../src/piece/journey-view';
import { starsFor } from '../src/piece/game';
import { starsHtml } from '../src/piece/hud';
import { ready, unitState } from '../src/piece/progress';
import { DAY, initialUnit, phrases, type UnitProgress } from '../src/piece/progress';
import type { Score } from '../src/piece/score';
import { longPiece } from './helpers/long-piece';

const courses = (score: Score): [string, Unit[]][] => [
  ['piano', buildCurriculum(score).units],
  ['guitar accompaniment', guitarUnits(score, arrange(score))],
  ['guitar plays the piece', guitarPieceUnits(score, arrangePiece(score))],
];
const gymnopedieScore = compile(gymnopedie).score!;
// The same notes with every section line taken out: one region.
const plain = compile(
  gymnopedie
    .split('\n')
    .filter((l) => !l.startsWith('section:'))
    .join('\n'),
).score!;
const long = compile(longPiece()).score!;
const pieces: [string, Score][] = [
  ['Gymnopédie', gymnopedieScore],
  ['Gymnopédie without sections', plain],
  ['a long original test piece', long],
];
const WIDTHS = [280, 390, 440];
const decode = (text: string) => text.replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)));
const layoutOf = (score: Score, units: Unit[], width: number) =>
  journeyLayout({ units, sections: score.sections, bars: score.bars, width });

it('has the pieces the checks need', () => {
  expect(plain.sections).toEqual([]);
  expect(long.bars.length).toBe(120);
  const steps = courses(long).map(([, u]) => u.filter((x) => !x.sameAs).length);
  expect(Math.max(...steps)).toBeGreaterThan(180);
});

describe.each(pieces)('%s', (_, score) => {
  it.each(courses(score))('puts every step of the %s course on the map exactly once', (_, units) => {
    for (const width of WIDTHS) {
      const layout = layoutOf(score, units, width),
        placed = layout.stops.flatMap((s) => s.steps);
      expect(placed.length, `width ${width}`).toBe(new Set(placed).size);
      expect([...placed].sort()).toEqual(units.map((u) => u.id).sort());
      // So every step that is not sameAs is there exactly once, and nothing else is.
      for (const u of units.filter((x) => !x.sameAs)) expect(placed.filter((id) => id === u.id)).toHaveLength(1);
      // Each stop lists what it draws: dots, marks and joins are its steps, in that order.
      for (const s of layout.stops) expect(s.steps).toEqual([...s.dots, ...s.marks, ...s.joins]);
      // Every join is a bridge on the path.
      expect(layout.bridges.map((b) => b.unit).sort()).toEqual(
        units
          .filter((u) => u.kind === 'seam')
          .map((u) => u.id)
          .sort(),
      );
    }
  });

  it.each(courses(score))('never overlaps two stops or leaves the panel in the %s course', (_, units) => {
    for (const width of WIDTHS) {
      const layout = layoutOf(score, units, width),
        half = NODE / 2;
      for (const s of layout.stops) {
        expect(s.x - half, `${s.id} at ${width}`).toBeGreaterThanOrEqual(0);
        expect(s.x + half, `${s.id} at ${width}`).toBeLessThanOrEqual(width);
        expect(s.y - half).toBeGreaterThanOrEqual(0);
        expect(s.y + half).toBeLessThanOrEqual(layout.height);
      }
      for (let i = 0; i < layout.stops.length; i++)
        for (let j = i + 1; j < layout.stops.length; j++) {
          const a = layout.stops[i],
            b = layout.stops[j];
          const apart = Math.abs(a.x - b.x) >= NODE + 8 || Math.abs(a.y - b.y) >= NODE + 8;
          expect(apart, `${a.id} and ${b.id} at ${width}`).toBe(true);
        }
      // Slices cover the map from top to bottom, and each stop sits inside its own slice.
      let top = 0;
      for (const slice of layout.slices) {
        expect(slice.top).toBe(top);
        top = slice.bottom;
        for (const i of slice.stops) {
          expect(layout.stops[i].y - half).toBeGreaterThanOrEqual(slice.top);
          expect(layout.stops[i].y + half).toBeLessThanOrEqual(slice.bottom);
        }
      }
      expect(top).toBe(layout.height);
      expect(layout.slices.flatMap((s) => s.stops)).toEqual(layout.stops.map((_, i) => i));
    }
  });

  it('walks the phrases in learning order, each region ending at its gate, from the trailhead to the summit', () => {
    const [, units] = courses(score)[0],
      layout = layoutOf(score, units, 390);
    expect(layout.stops[0].kind).toBe('trailhead');
    expect(layout.stops[layout.stops.length - 1].kind).toBe('summit');
    const order = phrases({ title: '', key: '', goalBpm: 0, units, summary: [] }).flatMap((p) =>
      p.units.filter((u) => u.kind !== 'section').map((u) => u.id),
    );
    const walked = layout.stops.filter((s) => s.kind === 'phrase').flatMap((s) => s.dots);
    expect(walked).toEqual(order);
    for (let r = 0; r < layout.regions.length; r++) {
      const inRegion = layout.stops.filter((s) => s.region === r);
      expect(inRegion[inRegion.length - 1].kind, `region ${r}`).toBe('gate');
    }
    expect(layout.regions).toHaveLength(Math.max(1, score.sections.length));
  });

  it.each(courses(score))(
    'keeps every join clear of the stops, their labels and the other joins in the %s course',
    (_, units) => {
      for (const width of [280, 300, 320, 336, 360, 390, 440, 520, 700]) {
        const layout = layoutOf(score, units, width);
        for (const b of layout.bridges) {
          for (const s of layout.stops)
            expect(Math.hypot(b.x - s.x, b.y - s.y), `${b.unit} near ${s.id} at ${width}`).toBeGreaterThanOrEqual(
              JOIN_CLEAR,
            );
          for (const s of layout.stops) {
            const half = labelHalf(s.label),
              x0 = s.labelAnchor === 'start' ? s.labelX : s.labelX - half,
              x1 = x0 + 2 * half;
            const apart = Math.hypot(
              Math.max(x0 - b.x, 0, b.x - x1),
              Math.max(s.labelY - LABEL_UP - b.y, 0, b.y - s.labelY - LABEL_DOWN),
            );
            expect(apart, `${b.unit} near the label of ${s.id} at ${width}`).toBeGreaterThanOrEqual(JOIN_REACH + 1);
          }
          for (const c of layout.bridges)
            if (c !== b)
              expect(Math.hypot(b.x - c.x, b.y - c.y), `${b.unit} and ${c.unit}`).toBeGreaterThanOrEqual(JOIN_GAP);
        }
      }
    },
  );

  it.each(courses(score))("keeps every stop's label and marks clear of its rings in the %s course", (_, units) => {
    // At their largest: the plan's halo with its line, and the "you are here" ring with its line at the top of its breath.
    const reach = Math.max(HALO + 0.5, (HERE_RING + 0.8) * BREATH);
    expect(RING_REACH).toBe(reach);
    for (const width of [280, 336, 390, 440, 700]) {
      const layout = layoutOf(score, units, width);
      for (const s of layout.stops) {
        const half = labelHalf(s.label),
          x0 = s.labelAnchor === 'start' ? s.labelX : s.labelX - half,
          x1 = x0 + 2 * half,
          y0 = s.labelY - LABEL_UP,
          y1 = s.labelY + LABEL_DOWN;
        const label = Math.hypot(Math.max(x0 - s.x, 0, s.x - x1), Math.max(y0 - s.y, 0, s.y - y1));
        expect(label - reach, `label of ${s.id} at ${width}`).toBeGreaterThanOrEqual(RING_AIR);
        expect(s.markAt).toHaveLength(s.marks.length - (s.more?.n ?? 0));
        for (const m of s.markAt)
          expect(
            Math.hypot(m.x - s.x, m.y - s.y) - MARK_R - 0.55 - reach,
            `a mark of ${s.id} at ${width}`,
          ).toBeGreaterThanOrEqual(RING_AIR);
        if (s.more) expect(s.y - s.more.y, `"+n" of ${s.id}`).toBeGreaterThanOrEqual(reach + RING_AIR);
      }
      // Labels and marks stay inside their own slice of the map.
      for (const slice of layout.slices)
        for (const i of slice.stops) {
          const s = layout.stops[i];
          expect(s.labelY + LABEL_DOWN, `label of ${s.id}`).toBeLessThanOrEqual(slice.bottom);
          for (const m of s.markAt) expect(m.y - MARK_R - 1, `mark of ${s.id}`).toBeGreaterThanOrEqual(slice.top);
        }
    }
  });

  it('is deterministic', () => {
    for (const [, units] of courses(score)) expect(layoutOf(score, units, 390)).toEqual(layoutOf(score, units, 390));
  });
});

it('snakes left and right down the panel: rows alternate direction, as many stops as fit', () => {
  expect([280, 336, 390, 440].map((w) => perRow(w))).toEqual([3, 4, 5, 6]);
  const layout = layoutOf(gymnopedieScore, buildCurriculum(gymnopedieScore).units, 390);
  const rows = layout.slices.filter((s) => s.stops.length > 1 && layout.stops[s.stops[0]].region >= 0);
  expect(rows.length).toBeGreaterThan(3);
  const directions = rows.map((s) => Math.sign(layout.stops[s.stops[1]].x - layout.stops[s.stops[0]].x));
  // Every row runs the other way from the row before it.
  const all = layout.slices
    .filter((s) => s.stops.length && layout.stops[s.stops[0]].region >= 0)
    .map((s) => s.stops.map((i) => layout.stops[i].x));
  for (let i = 1; i < all.length; i++)
    if (all[i].length > 1 && all[i - 1].length > 1)
      expect(Math.sign(all[i][1] - all[i][0])).toBe(-Math.sign(all[i - 1][1] - all[i - 1][0]));
  expect(directions.some((d) => d > 0) && directions.some((d) => d < 0)).toBe(true);
});

describe('drawing the map', () => {
  const score = gymnopedieScore,
    units = buildCurriculum(score).units,
    now = new Date(2026, 10, 20, 12).getTime();
  const saved: Record<string, UnitProgress> = {
    'R:5-8': { ...initialUnit(), attempts: 3, best: 0.6 },
    'L:1-4': { ...initialUnit(), attempts: 9, best: 0.8, certified: [0.8], rung: 3 },
    'chord:Gmaj7': {
      ...initialUnit(),
      attempts: 12,
      best: 1,
      certified: [0.8, 1],
      learned: true,
      due: now - DAY,
      days: ['2026-11-18', '2026-11-19'],
    },
  };
  const state = (over: Partial<JourneyState> = {}): JourneyState => ({
    units,
    score,
    get: (id) => saved[id],
    now,
    current: 'R:5-8',
    plan: new Set(['R:5-8', 'LR:5-8']),
    label: () => 'state',
    ...over,
  });
  const layout: JourneyLayout = layoutOf(score, units, 390);

  it('gives every stop a real button with a spoken name, in path order, and marks where you are', () => {
    const html = journeyHtml(layout, state());
    const buttons = [
      ...html.matchAll(/<button type="button" class="jr-stop" data-stop="(\d+)"[^>]*aria-label="([^"]*)"/g),
    ];
    expect(buttons.map((b) => Number(b[1]))).toEqual(layout.stops.map((_, i) => i));
    const names = buttons.map((b) => decode(b[2]));
    const here = layout.stops.findIndex((s) => s.steps.includes('R:5-8'));
    expect(names[here]).toBe("Bars 5 to 8: 1 of 3 steps have stars, in today's plan, you are here");
    expect(html.match(/aria-current="location"/g)).toHaveLength(1);
    expect(names[0]).toBe('Hear the whole piece: not heard yet');
    // The learned chord whose review is due shows the clock on its seal; nothing looks lost.
    const first = layout.stops.find((s) => s.steps.includes('chord:Gmaj7'))!;
    expect(names[layout.stops.indexOf(first)]).toContain(', 1 learned, 1 review due');
    // One colon in every name: the summit and the camp too.
    for (const name of names) expect(name.match(/:/g), name).toHaveLength(1);
    expect(names[names.length - 1]).toBe('The summit, the whole piece: 0 of 1 step has stars, for later');
    expect(html).toContain('class="jd-due"');
  });

  it('opens a stop as a list of its steps, each the List view row that opens it', () => {
    const stop = layout.stops.find((s) => s.steps.includes('R:5-8'))!,
      html = journeyHtml(layout, state(), stop.id);
    const list = /<div class="jr-list"[^>]*>(.*?)<\/div>/.exec(html)![1];
    expect([...list.matchAll(/data-unit="([^"]+)"/g)].map((m) => decode(m[1]))).toEqual(stop.steps);
    expect(list).toContain('· later');
    expect(html).toContain(`data-stop="${layout.stops.indexOf(stop)}" style="left:`);
  });

  it('shows the same information in every look: the drawing has no motion of its own', () => {
    const html = journeyHtml(layout, state());
    expect(html).not.toMatch(/<animate|animation|transition/);
  });
});

it('keeps the List view exactly as it was: the same rows, by stage, as the page drew them before', () => {
  const units = buildCurriculum(gymnopedieScore).units,
    now = new Date(2026, 10, 20, 12).getTime();
  const saved: Record<string, UnitProgress> = {
    'L:1-4': { ...initialUnit(), attempts: 9, best: 0.8, certified: [0.8], rung: 3 },
    'R:5-8': { ...initialUnit(), attempts: 3, best: 0.6, rung: 1 },
  };
  const get = (id: string) => saved[id],
    label = (u: Unit) => `${unitState(u, get(u.id), now)}`,
    current = 'R:5-8';
  // The page's List markup before the Journey view, copied as it was.
  const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const stars = (u: Unit) => {
    const s = starsFor(units, u, get, now);
    return s ? starsHtml(s) : '';
  };
  const stages = [
    'Hear the piece',
    'Chords',
    'Chord changes',
    'Left hand',
    'Right hand',
    'Hands together',
    'Joins',
    'Sections and the whole piece',
    'Key drills',
  ];
  const before = stages
    .map((name, i) => {
      const members = units.filter((u) => u.stage === i);
      if (!members.length) return '';
      return `<div class="course-stage">${i + 1} · ${escape(name)}</div>${members.map((u) => `<button class="course-lesson${u.sameAs ? ' covered' : ''}" data-unit="${escape(u.id)}" aria-current="${u.id === current}"><span>${escape(u.title)}${!u.sameAs && !ready(u, get) ? ' <span class="muted">· later</span>' : ''}${u.optional ? ' <span class="muted">· optional</span>' : ''}</span><span>${stars(u)}${escape(label(u))}</span></button>`).join('')}`;
    })
    .join('');
  expect(courseListHtml(stages, { units, get, now, current, label })).toBe(before);
});

describe('joins at the end of a row', () => {
  // The long test piece has sections of 40 and 48 bars: ten and twelve phrases, more than one row holds at any width.
  it.each(courses(long).filter(([name]) => name !== 'guitar accompaniment'))(
    'go round the turn, between the phrases they join, in the %s course',
    (_, units) => {
      const byId = new Map(units.map((u) => [u.id, u]));
      for (const width of [280, 390, 440]) {
        const layout = layoutOf(long, units, width),
          sliceOf = (i: number) => layout.slices.findIndex((s) => s.stops.includes(i));
        // At least one region wraps onto a second row.
        const wraps = layout.regions.some((_, r) => {
          const inRegion = layout.stops.flatMap((s, i) => (s.region === r ? [sliceOf(i)] : []));
          return new Set(inRegion).size > 1;
        });
        expect(wraps, `a region wraps at ${width}`).toBe(true);
        let ends = 0;
        for (const b of layout.bridges) {
          const join = byId.get(b.unit)!,
            from = layout.stops.findIndex(
              (s) => s.kind === 'phrase' && s.dots.some((id) => byId.get(id)?.bars.includes(join.bars[0])),
            ),
            next = from + 1;
          if (from < 0 || join.bars[1] !== join.bars[0] + 1 || sliceOf(from) === sliceOf(next)) continue;
          // A join from the last stop of a row: it stands round the turn, between that phrase and the next stop on the
          // path (the next phrase, or the section's gate), below the phrase and above the next row.
          ends++;
          const a = layout.stops[from],
            c = layout.stops[next];
          expect(b.y, `${b.unit} at ${width}`).toBeGreaterThan(a.y);
          expect(b.y, `${b.unit} at ${width}`).toBeLessThan(c.y);
          expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThanOrEqual(JOIN_CLEAR);
        }
        expect(ends, `joins at the end of a row at ${width}`).toBeGreaterThan(0);
      }
    },
  );
});
