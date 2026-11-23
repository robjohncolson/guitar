import type { Curriculum, Unit } from './curriculum';
import { phrases } from './progress';

/**
 * The journey map's layout: the whole course as one walk down the panel. Pure and deterministic in the course, the
 * piece's sections and the width; it knows nothing of progress (journey-view.ts draws progress on top of it).
 *
 * The walk starts at the trailhead (hearing the piece), with a camp beside it for the key drills and any step that
 * belongs nowhere else. Then each section is a region: its phrases (from phrases(), in learning order) are stops along
 * a path that snakes left and right, row by row, and the section's run-through is a gate at the region's end. The
 * whole piece is the summit. Chords and changes hang off the stop they belong to; joins are small bridges on the path
 * after the phrase they leave. Every step of the course, sameAs steps included, belongs to exactly one stop.
 *
 * The join rule: a join stands on the path between the phrase it leaves and the next stop, where there is room: its
 * centre at least JOIN_CLEAR from every stop's centre and JOIN_REACH + 1 from every label, and at least JOIN_GAP from any
 * other join. Rows are spaced so that this always fits (see pitchFor); at the end of a row the join goes round the turn.
 */
export type StopKind = 'trailhead' | 'camp' | 'phrase' | 'gate' | 'summit';
export interface Stop {
  /** Stable within a layout: the kind and the first step it holds. */
  id: string;
  kind: StopKind;
  /** Centre, in CSS pixels from the map's top left. Every stop is a 44 px button around it. */
  x: number;
  y: number;
  /** The region it stands in (an index into regions); -1 for the trailhead, the camp and the summit. */
  region: number;
  /** The short label under it ("5–8"), shown in small caps. */
  label: string;
  /**
   * Where the label stands: under the stop, nudged inward at the panel's edges so the path's turn never runs through it
   * (anchor middle); the trailhead's beside its flag (anchor start). y is the baseline.
   */
  labelX: number;
  labelY: number;
  labelAnchor: 'middle' | 'start';
  /** What it is called in words ("Bars 5 to 8"). */
  name: string;
  /** Drawn as dots inside: the phrase's passages, a gate's run-through, the summit's whole piece. */
  dots: string[];
  /** Drawn as small dots above: chords and changes (or the camp's drills). */
  marks: string[];
  /** Drawn as bridges on the path: joins. */
  joins: string[];
  /** Every step it opens, in list order: dots, then marks, then joins. */
  steps: string[];
  /** Where each shown mark stands (marks[i] at markAt[i]); the rest are counted by more ("+n"). */
  markAt: { x: number; y: number }[];
  more?: { x: number; y: number; n: number };
}
export interface Bridge {
  unit: string;
  x: number;
  y: number;
  /** The path's direction there, in degrees. */
  angle: number;
}
export interface Region {
  name: string;
  /** "Bars 5–12". */
  bars: string;
  top: number;
  bottom: number;
  /** The header's baseline and the side it is written on (away from where the path crosses the header). */
  headY: number;
  align: 'left' | 'right';
}
/** One cubic piece of the path, from one waypoint to the next; toStop is the next stop at or after its end. */
export interface PathPiece {
  d: string;
  y0: number;
  y1: number;
  toStop: number;
}
/** A horizontal slice of the map: the view draws one per slice, so a stop's list can open right under its row. */
export interface Slice {
  top: number;
  bottom: number;
  stops: number[];
}
export interface JourneyLayout {
  width: number;
  height: number;
  stops: Stop[];
  regions: Region[];
  bridges: Bridge[];
  path: PathPiece[];
  /** The dotted side trail from the trailhead (or the start) to the camp. */
  spur?: string;
  slices: Slice[];
  /** Where the path starts: the trailhead's flag, or a plain start point when there is none. */
  start: { x: number; y: number };
}
export interface JourneyInput {
  units: readonly Unit[];
  sections: readonly { name: string; from: number; to: number }[];
  bars: readonly { number: number }[];
  width: number;
}

/** A stop's button is NODE px square. */
export const NODE = 44;
/**
 * A join's centre keeps this far from every stop's centre. A join reaches 7 px along the path (its rails) and 5.5 px
 * across; a stop's ring reaches 21.3 px (radius 20.5 and its line), the "you are here" ring 28.6 px at the top of its
 * breath (radius 26.5, 1.6 px line, 5% larger). 28.6 + 7 rounds up to 36: the join stays clear of both, and of the halo
 * of today's plan (29.5 px) but for its rails' outer corners, which that faint fill may meet.
 */
export const JOIN_CLEAR = 36;
/** Nothing of a join is further than this from its centre (the rails' corners: 7 along, 5.5 across). */
export const JOIN_REACH = 9;
/** Two joins keep at least this far apart, centre to centre. */
export const JOIN_GAP = 12;
/**
 * The rings around a stop: "you are here" (radius 26.5, a 1.6 px line, breathing to 5% larger in the lively look) and
 * the soft halo of today's plan (radius 29, a 1 px line). RING_REACH is the furthest either reaches from the stop's
 * centre. The ring rule: the stop's label and its marks keep RING_AIR clear of it, so labels stand LABEL_DROP below the
 * centre (a 10 px label's box, as the browser measures it, runs from LABEL_UP above its baseline to LABEL_DOWN below)
 * and marks MARK_RISE above it (a mark is a 3 px dot with a 1.1 px line).
 */
export const HERE_RING = 26.5;
export const HALO = 29;
export const BREATH = 1.05;
export const RING_REACH = Math.max(HALO + 0.5, (HERE_RING + 0.8) * BREATH);
export const RING_AIR = 2;
export const MARK_R = 3;
const MARK_REACH = MARK_R + 0.55;
export const LABEL_UP = 12;
export const LABEL_DOWN = 3;
const LABEL_DROP = Math.ceil(RING_REACH + RING_AIR + LABEL_UP);
const MARK_RISE = Math.ceil(RING_REACH + RING_AIR + MARK_REACH);
const MARK_STEP = 8;
/** Stops in a row are at least this far apart, centre to centre: room for one join between two stops. */
const PITCH = 2 * JOIN_CLEAR;
/** Stop centres keep this far from the panel's edges, so the path can turn outside them. */
const SIDE = 40;
const TURN = 13;
const ROW_H = 110;
/** A stop's centre within its row: room above for two rows of marks, below for its label. */
const ROW_Y = 58;
const HEAD_H = 34;
const START_H = 104;
const START_Y = 54;
const SUMMIT_H = 104;
const SUMMIT_Y = 52;
/** A gentle, fixed wobble so the path reads as a walk, not a ruled line. */
const WOBBLE = [-4, 3, -2, 4, -3, 2];

const round = (n: number) => Math.round(n * 10) / 10;
const prettyName = (name: string) => name.replace(/(\d)$/, ' $1');
const barSpan = (bars: readonly { number: number }[], from: number, to: number) =>
  from === to ? `${bars[from]?.number ?? from + 1}` : `${bars[from]?.number ?? from + 1}–${bars[to]?.number ?? to + 1}`;
const barWords = (bars: readonly { number: number }[], from: number, to: number) =>
  from === to
    ? `Bar ${bars[from]?.number ?? from + 1}`
    : `Bars ${bars[from]?.number ?? from + 1} to ${bars[to]?.number ?? to + 1}`;
/** Stops per row at this width: as many as fit pitch apart between the two side margins. */
export const perRow = (width: number, pitch = PITCH) => Math.max(1, Math.floor((width - 2 * SIDE) / pitch) + 1);
/**
 * The pitch a region needs so that k joins leaving one phrase fit between it and the next stop on the same row (with
 * 8 px to spare when there are two or more, so that they are never squeezed).
 */
const pitchFor = (k: number) => (k > 1 ? 2 * JOIN_CLEAR + (k - 1) * JOIN_GAP + 8 : PITCH);
/** A label's estimated half width: 10 px capitals with 0.1em spacing, about 7.4 px a letter. */
export const labelHalf = (label: string) => label.length * 3.7 + 2;

interface Pending {
  kind: StopKind;
  region: number;
  label: string;
  name: string;
  dots: Unit[];
  marks: Unit[];
  joins: Unit[];
  bars?: Set<number>;
}

export function journeyLayout(input: JourneyInput): JourneyLayout {
  const { units, bars } = input,
    width = Math.max(input.width, 2 * SIDE + 1);
  const sections = input.sections.length
    ? [...input.sections]
    : [{ name: 'The piece', from: 0, to: Math.max(0, bars.length - 1) }];
  const placed = new Set<string>();
  /** The steps of a list not yet on the map, now marked as placed: each step lands on exactly one stop. */
  const take = (list: Unit[]) =>
    list.filter((u) => {
      if (placed.has(u.id)) return false;
      placed.add(u.id);
      return true;
    });
  const course = { title: '', key: '', goalBpm: 0, units: [...units], summary: [] } as Curriculum;

  // The phrases in learning order. A phrase that is a section's run-through is that section's gate; a group holding
  // both passages and a run-through (a section that is one phrase) becomes a stop and then the gate.
  const regionOf = (bar: number) => {
    const at = sections.findIndex((s) => bar >= s.from && bar <= s.to);
    if (at >= 0) return at;
    const after = sections.findIndex((s) => s.from > bar);
    return after >= 0 ? after : sections.length - 1;
  };
  const byRegion: Pending[][] = sections.map(() => []),
    gates: Pending[][] = sections.map(() => []);
  for (const p of phrases(course)) {
    const sorted = [...p.bars].sort((a, b) => a - b),
      region = regionOf(sorted[0]),
      from = sorted[0],
      to = sorted[sorted.length - 1];
    const passages = take(p.units.filter((u) => u.kind !== 'section')),
      runs = take(p.units.filter((u) => u.kind === 'section'));
    const extras = take(p.extras.filter((u) => u.kind !== 'seam')),
      joins = take(p.extras.filter((u) => u.kind === 'seam'));
    // A passage played as one bar again and again (the guitar's picking pattern) is named for what it is.
    const pattern = passages.length > 0 && passages.every((u) => new Set(u.bars).size < u.bars.length);
    if (passages.length)
      byRegion[region].push({
        kind: 'phrase',
        region,
        label: pattern ? 'pattern' : barSpan(bars, from, to),
        name: pattern ? 'The picking pattern' : barWords(bars, from, to),
        dots: passages,
        marks: extras,
        joins,
        bars: new Set(sorted),
      });
    if (runs.length) {
      const s = sections[region];
      gates[region].push({
        kind: 'gate',
        region,
        label: 'section',
        name: `${prettyName(s.name)}, the whole section (${barWords(bars, s.from, s.to).toLowerCase()})`,
        dots: runs,
        marks: passages.length ? [] : extras,
        joins: passages.length ? [] : joins,
      });
    }
  }
  const listen = take(units.filter((u) => u.kind === 'listen')),
    summit = take(units.filter((u) => u.kind === 'performance'));
  const drills = take(units.filter((u) => u.kind === 'drill')),
    rest = take([...units]);
  const camp = [...drills, ...rest];

  const stops: Stop[] = [],
    bridges: Bridge[] = [],
    regions: Region[] = [],
    slices: Slice[] = [];
  const toStop = (p: Pending, x: number, y: number): Stop => {
    const dots = p.dots.map((u) => u.id),
      marks = p.marks.map((u) => u.id),
      joins = p.joins.map((u) => u.id),
      half = labelHalf(p.label),
      trail = p.kind === 'trailhead';
    return {
      id: `${p.kind}:${p.dots[0]?.id ?? p.marks[0]?.id ?? p.joins[0]?.id ?? stops.length}`,
      kind: p.kind,
      x: round(x),
      y: round(y),
      region: p.region,
      label: p.label,
      labelX: round(trail ? x + 32 : Math.max(20 + half, Math.min(width - 20 - half, x))),
      labelY: round(trail ? y + 13 : y + LABEL_DROP),
      labelAnchor: trail ? 'start' : 'middle',
      name: p.name,
      dots,
      marks,
      joins,
      steps: [...dots, ...marks, ...joins],
      ...placeMarks(marks.length, x, y),
    };
  };
  // Marks: up to two rows above the stop, as many to a row as fit between two neighbouring stops (fewer at the panel's
  // edges, where the path turns in and out), kept clear of those turns; the rest are counted by "+n".
  const across = perRow(width),
    pitch = across > 1 ? (width - 2 * SIDE) / (across - 1) : width - 2 * SIDE,
    wide = Math.max(4, Math.min(8, Math.floor((pitch - 12) / MARK_STEP)));
  function placeMarks(count: number, x: number, y: number): Pick<Stop, 'markAt' | 'more'> {
    if (!count) return { markAt: [] };
    const cols = x < NODE * 1.5 || x > width - NODE * 1.5 ? Math.min(wide, 5) : wide,
      shown = count > cols * 2 ? cols * 2 - 1 : count,
      top = y - MARK_RISE,
      span = (Math.min(cols, shown) - 1) * MARK_STEP,
      mx = Math.max(36 + span / 2, Math.min(width - 36 - span / 2, x));
    const markAt = Array.from({ length: shown }, (_, i) => {
      const row = Math.floor(i / cols),
        inRow = Math.min(cols, shown - row * cols);
      return { x: round(mx + ((i % cols) - (inRow - 1) / 2) * MARK_STEP), y: round(top - row * MARK_STEP) };
    });
    return shown < count
      ? {
          markAt,
          more: { x: round(mx + ((cols - 1) / 2) * MARK_STEP + 1), y: round(top - MARK_STEP + 3), n: count - shown },
        }
      : { markAt };
  }
  const left = SIDE,
    right = width - SIDE;
  // How many joins leave each phrase (by the bar they leave from): a region's rows are spaced for the most of them.
  const pending = [...byRegion.flat(), ...gates.flat()],
    leaving = new Map<Pending, number>();
  for (const u of pending.flatMap((p) => p.joins)) {
    const from = byRegion.flat().find((p) => p.bars?.has(u.bars[0]));
    if (from) leaving.set(from, (leaving.get(from) ?? 0) + 1);
  }
  /**
   * Waypoints of the path in order, each with the direction the path has there: along the row at a stop, straight down
   * at a turn. stop: the stop index when the waypoint is a stop.
   */
  const way: { x: number; y: number; dx: number; dy: number; stop?: number }[] = [];
  const phraseBars = new Map<number, Set<number>>(),
    joinUnits = new Map<number, Unit[]>();

  // The start: the trailhead, with the camp to its right on a side trail.
  let y = 0;
  const start = { x: left, y: START_Y, dx: 0, dy: 1 };
  if (listen.length) {
    stops.push(
      toStop(
        {
          kind: 'trailhead',
          region: -1,
          label: 'hear it',
          name: 'Hear the whole piece',
          dots: listen,
          marks: [],
          joins: [],
        },
        start.x,
        start.y,
      ),
    );
    way.push({ ...start, stop: 0 });
  } else way.push(start);
  let spur: string | undefined;
  if (camp.length) {
    const cx = Math.max(left + PITCH, right);
    stops.push(
      toStop(
        {
          kind: 'camp',
          region: -1,
          label: 'key drills',
          name: 'The camp, key drills',
          dots: [],
          marks: camp,
          joins: [],
        },
        cx,
        START_Y,
      ),
    );
    // The side trail leaves room after the trailhead for its label, which stands to the right of the flag.
    spur = `M${round(start.x + (listen.length ? 96 : NODE / 2))} ${START_Y}H${round(cx - NODE / 2 - 4)}`;
  }
  slices.push({ top: 0, bottom: START_H, stops: stops.map((_, i) => i) });
  y = START_H;

  // The regions, row by row. Rows alternate direction over the whole map, so the path snakes without a break.
  let row = 0,
    side = 'left' as 'left' | 'right';
  sections.forEach((s, r) => {
    const items = [...byRegion[r], ...gates[r]];
    if (!items.length) return;
    const headTop = y;
    regions.push({
      name: prettyName(s.name),
      bars: `Bars ${barSpan(bars, s.from, s.to)}`,
      top: headTop,
      bottom: 0,
      headY: headTop + HEAD_H - 11,
      align: side === 'left' ? 'right' : 'left',
    });
    slices.push({ top: y, bottom: y + HEAD_H, stops: [] });
    y += HEAD_H;
    const capacity = perRow(width, pitchFor(Math.max(0, ...byRegion[r].map((p) => leaving.get(p) ?? 0)))),
      rows = Math.ceil(items.length / capacity),
      base = Math.floor(items.length / rows),
      extra = items.length % rows;
    let at = 0;
    for (let k = 0; k < rows; k++) {
      const count = base + (k < extra ? 1 : 0),
        forward = row % 2 === 0,
        centre = y + ROW_Y;
      // The turn from the row before (or down from the start), on the side it ended.
      const prev = way[way.length - 1];
      way.push({ x: side === 'right' ? width - TURN : TURN, y: (prev.y + centre) / 2, dx: 0, dy: 1 });
      const slice: Slice = { top: y, bottom: y + ROW_H, stops: [] };
      for (let i = 0; i < count; i++) {
        const p = items[at++],
          spread = count === 1 ? 0.5 : i / (count - 1),
          x = forward ? left + (right - left) * spread : right - (right - left) * spread;
        const index = stops.length;
        stops.push(toStop({ ...p, region: regions.length - 1 }, x, centre + WOBBLE[(row + i) % WOBBLE.length]));
        if (p.bars) phraseBars.set(index, p.bars);
        if (p.joins.length) joinUnits.set(index, p.joins);
        slice.stops.push(index);
        way.push({ x: stops[index].x, y: stops[index].y, dx: forward ? 1 : -1, dy: 0, stop: index });
      }
      slices.push(slice);
      side = forward ? 'right' : 'left';
      row++;
      y += ROW_H;
    }
    regions[regions.length - 1].bottom = y;
  });

  // The summit.
  if (summit.length) {
    const centre = y + SUMMIT_Y;
    way.push({ x: side === 'right' ? width - TURN : TURN, y: (way[way.length - 1].y + centre) / 2, dx: 0, dy: 1 });
    const index = stops.length;
    stops.push(
      toStop(
        {
          kind: 'summit',
          region: -1,
          label: 'whole piece',
          name: 'The summit, the whole piece',
          dots: summit,
          marks: [],
          joins: [],
        },
        width / 2,
        centre,
      ),
    );
    way.push({ x: stops[index].x, y: stops[index].y, dx: side === 'right' ? -1 : 1, dy: 0, stop: index });
    slices.push({ top: y, bottom: y + SUMMIT_H, stops: [index] });
    y += SUMMIT_H;
  }

  // The path: one cubic piece between each pair of waypoints, leaving and arriving in each waypoint's direction. Along a
  // row it sways gently from stop to stop; at the end of a row it runs out to the edge, down, and back in, like a
  // quarter ellipse each way, so it never cuts under a stop's label.
  const path: PathPiece[] = [],
    curves: [number, number, number, number, number, number, number, number][] = [];
  const nextStop = (i: number) => {
    for (let j = i; j < way.length; j++) if (way[j].stop !== undefined) return way[j].stop!;
    return -1;
  };
  for (let i = 0; i + 1 < way.length; i++) {
    const p1 = way[i],
      p2 = way[i + 1],
      across = Math.abs(p2.x - p1.x),
      down = Math.abs(p2.y - p1.y),
      along = p1.dy === 0 && p2.dy === 0 ? 0.4 : 0.55;
    const l1 = (p1.dy ? down : across) * along,
      l2 = (p2.dy ? down : across) * along;
    const c1x = p1.x + p1.dx * l1,
      c1y = p1.y + p1.dy * l1,
      c2x = p2.x - p2.dx * l2,
      c2y = p2.y - p2.dy * l2;
    curves.push([p1.x, p1.y, c1x, c1y, c2x, c2y, p2.x, p2.y]);
    path.push({
      d: `M${round(p1.x)} ${round(p1.y)}C${round(c1x)} ${round(c1y)} ${round(c2x)} ${round(c2y)} ${round(p2.x)} ${round(p2.y)}`,
      y0: round(Math.min(p1.y, c1y, c2y, p2.y)),
      y1: round(Math.max(p1.y, c1y, c2y, p2.y)),
      toStop: nextStop(i + 1),
    });
  }
  // Joins (the join rule above): on the way from the phrase a join leaves (bar a of a join a → b) to the next stop,
  // sampled finely, keeping only the points with room: far enough from every stop and every label. The joins leaving one
  // phrase stand around the middle of the longest stretch with room, JOIN_GAP or more apart; at the end of a row that
  // stretch is round the turn, below the stop's label.
  const fromStop = (u: Unit, fallback: number) => [...phraseBars].find(([, b]) => b.has(u.bars[0]))?.[0] ?? fallback;
  const leavingStop = new Map<number, Unit[]>();
  for (const [index, list] of joinUnits)
    for (const u of list) {
      const from = fromStop(u, index);
      leavingStop.set(from, [...(leavingStop.get(from) ?? []), u]);
    }
  const labels = stops.map((st) => {
    const half = labelHalf(st.label),
      x0 = st.labelAnchor === 'start' ? st.labelX : st.labelX - half;
    return { x0, x1: x0 + 2 * half, y0: st.labelY - LABEL_UP, y1: st.labelY + LABEL_DOWN };
  });
  // Only the stops (and their labels) near a stretch of path can be in its way.
  const near = (y0: number, y1: number) =>
    stops.flatMap((st, i) => (st.y > Math.min(y0, y1) - ROW_H && st.y < Math.max(y0, y1) + ROW_H ? [i] : []));
  const clear = JOIN_CLEAR ** 2,
    reach = (JOIN_REACH + 1) ** 2;
  const room = (x: number, y: number, around: number[]) =>
    around.every((i) => {
      const b = labels[i],
        dx = Math.max(b.x0 - x, 0, x - b.x1),
        dy = Math.max(b.y0 - y, 0, y - b.y1);
      return (stops[i].x - x) ** 2 + (stops[i].y - y) ** 2 >= clear && dx * dx + dy * dy >= reach;
    });
  const SAMPLES = 32;
  for (const [from, list] of [...leavingStop].sort((a, b) => a[0] - b[0])) {
    let first = way.findIndex((w) => w.stop === from);
    if (first < 0 || first >= curves.length) first = Math.max(0, way.findIndex((w) => w.stop === from) - 1);
    let last = first + 1;
    while (last < way.length - 1 && way[last].stop === undefined) last++;
    // Points along the way to the next stop, with their distance along the path and whether there is room there.
    const around = near(way[first].y, way[Math.min(last, way.length - 1)].y);
    const points: { s: number; x: number; y: number; c: Curve; t: number; ok: boolean }[] = [];
    let along = 0;
    for (let piece = first; piece < last && piece < curves.length; piece++)
      for (let i = piece === first ? 0 : 1; i <= SAMPLES; i++) {
        const c = curves[piece],
          t = i / SAMPLES,
          [x, y] = bezier(c, t),
          prev = points[points.length - 1];
        if (prev) along += Math.hypot(x - prev.x, y - prev.y);
        points.push({ s: along, x, y, c, t, ok: room(x, y, around) });
      }
    // The longest stretch with room (the first, if two are as long).
    let best: [number, number] | undefined;
    for (let i = 0; i < points.length; i++) {
      if (!points[i].ok) continue;
      let j = i;
      while (j + 1 < points.length && points[j + 1].ok) j++;
      if (!best || points[j].s - points[i].s > points[best[1]].s - points[best[0]].s) best = [i, j];
      i = j;
    }
    const [lo, hi] = best ?? [Math.floor(points.length / 2), Math.floor(points.length / 2)];
    const middle = (points[lo].s + points[hi].s) / 2,
      spacing = list.length > 1 ? Math.min(JOIN_GAP * 1.5, (points[hi].s - points[lo].s) / (list.length - 1)) : 0;
    list.forEach((u, m) => {
      // The point at that distance along the path, between the two samples around it.
      const target = middle + (m - (list.length - 1) / 2) * spacing;
      let at = lo;
      while (at < hi && points[at + 1].s <= target) at++;
      const p = points[at],
        q = points[Math.min(at + 1, hi)],
        f = q !== p && q.c === p.c && q.s > p.s ? (target - p.s) / (q.s - p.s) : 0,
        t = p.t + (q.t - p.t) * Math.max(0, Math.min(1, f)),
        [x, y] = bezier(p.c, t),
        tangent = bezierTangent(p.c, t);
      bridges.push({
        unit: u.id,
        x: round(x),
        y: round(y),
        angle: round((Math.atan2(tangent[1], tangent[0]) * 180) / Math.PI),
      });
    });
  }
  return { width, height: y, stops, regions, bridges, path, spur, slices, start: { x: start.x, y: start.y } };
}

type Curve = readonly [number, number, number, number, number, number, number, number];
function bezier(c: Curve, t: number): [number, number] {
  const u = 1 - t,
    a = u * u * u,
    b = 3 * u * u * t,
    d = 3 * u * t * t,
    e = t * t * t;
  return [a * c[0] + b * c[2] + d * c[4] + e * c[6], a * c[1] + b * c[3] + d * c[5] + e * c[7]];
}
function bezierTangent(c: Curve, t: number): [number, number] {
  const u = 1 - t;
  return [
    3 * u * u * (c[2] - c[0]) + 6 * u * t * (c[4] - c[2]) + 3 * t * t * (c[6] - c[4]),
    3 * u * u * (c[3] - c[1]) + 6 * u * t * (c[5] - c[3]) + 3 * t * t * (c[7] - c[5]),
  ];
}
