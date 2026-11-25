import { describe, expect, it } from 'vitest';
import {
  cutPage,
  cutPixels,
  inkMask,
  MAX_PIXELS,
  MAX_SIDE,
  ONE_SYSTEM,
  picturesLine,
  sendSize,
  SYSTEM_SHARE,
  type Cut,
  type Mask,
} from '../src/piece/pages';

// Pages drawn for these tests: staff lines, barlines and note heads on a 1000 x 1414 page (A4 at about 120 dpi).
const W = 1000,
  H = 1414;
const page = (height = H): Mask => ({ width: W, height, ink: new Uint8Array(W * height) });
const fill = (m: Mask, x0: number, y0: number, x1: number, y1: number) => {
  for (let y = Math.max(0, y0); y < Math.min(m.height, y1); y++)
    for (let x = Math.max(0, x0); x < Math.min(m.width, x1); x++) m.ink[y * m.width + x] = 1;
};
/** A seeded random number, so every run draws the same page. */
const random = (seed: number) => () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

/** One staff: five lines `space` px apart (10 by default), note heads between them; returns its bottom. */
function staff(m: Mask, top: number, rand: () => number, space = 10): number {
  for (let i = 0; i < 5; i++) fill(m, 80, top + i * space, 920, top + i * space + 1);
  for (let x = 130; x < 900; x += 40) {
    const y = top - Math.round(1.5 * space) + Math.floor(rand() * 6 * space);
    fill(m, x, y, x + 9, y + 7);
    fill(m, x + 8, y - Math.round(2.5 * space), x + 9, y + 3); // a stem
  }
  return top + 4 * space + 1;
}
/** A piano system: two staves with barlines through both; the rows [first, last + 1) its ink really covers. */
function pianoSystem(m: Mask, top: number, rand: () => number, barlines = true, space = 10): [number, number] {
  staff(m, top, rand, space);
  const bottom = staff(m, top + 9 * space, rand, space);
  if (barlines) for (const x of [80, 330, 580, 919]) fill(m, x, top, x + 1, bottom);
  else fill(m, 60, top, 61, bottom); // only a thin system line at the left joins the staves
  return inkRows(m, top - 4 * space, bottom + 4 * space);
}
/**
 * A system of `staves` staves, as in a song: a line at the left joins them all, and barlines join only the lowest two
 * (the piano), so the staves above (a voice) are joined to them by the line at the left alone. One staff has barlines
 * of its own and no line at the left. Returns the rows its ink covers.
 */
function songSystem(m: Mask, top: number, staves: number, rand: () => number, space = 10): [number, number] {
  let bottom = top;
  for (let s = 0; s < staves; s++) {
    const t = top + s * 9 * space;
    bottom = staff(m, t, rand, space);
    if (s < staves - 2) for (const x of [330, 580, 919]) fill(m, x, t, x + 1, bottom);
  }
  if (staves > 1) fill(m, 80, top, 81, bottom);
  const piano = top + Math.max(0, staves - 2) * 9 * space;
  for (const x of [330, 580, 919]) fill(m, x, piano, x + 1, bottom);
  return inkRows(m, top - 4 * space, bottom + 4 * space);
}
/** The rows [first, last + 1) of rows [y0, y1) that hold any ink where systems are drawn (x from 50 to 930). */
function inkRows(m: Mask, y0: number, y1: number): [number, number] {
  const rows = Array.from({ length: y1 - y0 }, (_, i) => y0 + i).filter(
    (y) => y >= 0 && y < m.height && m.ink.subarray(y * m.width + 50, y * m.width + 930).some((v) => v === 1),
  );
  return [rows[0], rows[rows.length - 1] + 1];
}
/** The width of the music: from its leftmost ink to its rightmost. */
function musicWidth(m: Mask): number {
  let left = m.width,
    right = -1;
  for (let i = 0; i < m.ink.length; i++)
    if (m.ink[i]) {
      left = Math.min(left, i % m.width);
      right = Math.max(right, i % m.width);
    }
  return right - left + 1;
}
const px = (c: Cut, height = H) => [Math.round(c.top * height), Math.round(c.bottom * height)];

/**
 * A crowded page as labels (0 paper, n the ink of system n, 99 a slur): five piano systems, a slur across every gap, so
 * that the page is one block of ink.
 */
function crowdedPage(seed: number): Uint8Array {
  const label = new Uint8Array(W * H),
    rand = random(seed),
    put = (x0: number, y0: number, x1: number, y1: number, l: number) => {
      for (let y = y0; y < y1; y++) label.fill(l, y * W + x0, y * W + x1);
    },
    tops = [100, 370, 640, 910, 1180];
  tops.forEach((top, i) => {
    for (const t of [top, top + 90]) {
      for (let k = 0; k < 5; k++) put(80, t + k * 10, 920, t + k * 10 + 1, i + 1);
      for (let x = 130; x < 900; x += 40) {
        const y = t - 15 + Math.floor(rand() * 60);
        put(x, y, x + 9, y + 7, i + 1);
        put(x + 8, y - 25, x + 9, y + 3, i + 1);
      }
    }
    for (const x of [80, 333, 667, 919]) put(x, top, x + 1, top + 131, i + 1);
  });
  for (let i = 0; i < 4; i++) put(430 + 40 * i, tops[i] + 126, 490 + 40 * i, tops[i + 1] + 5, 99);
  return label;
}
/** A camera turned a little about the page's vertical axis: lines above the middle tilt one way, below it the other. */
const keystone =
  (k: number) =>
  (x: number, y: number): [number, number] => [x, y + (k * (x - W / 2) * (y - H / 2)) / H];
/**
 * A page as a camera sees it: picture pixel (x, y) shows page point map(x, y), sampled 3 x 3 for grey edges. Returns
 * RGBA and, for each system, the rows [first, last + 1) its ink lands on.
 */
function photograph(label: Uint8Array, map: (x: number, y: number) => [number, number]) {
  const rgba = new Uint8ClampedArray(W * H * 4),
    rows = new Map<number, [number, number]>();
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let inked = 0,
        system = 0;
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++) {
          const [sx, sy] = map(x + (i + 0.5) / 3, y + (j + 0.5) / 3).map(Math.floor),
            l = sx >= 0 && sy >= 0 && sx < W && sy < H ? label[sy * W + sx] : 0;
          if (l) inked++;
          if (l && l !== 99) system = l;
        }
      const at = (y * W + x) * 4;
      rgba[at] = rgba[at + 1] = rgba[at + 2] = Math.round(250 * (1 - inked / 9)) + 3;
      rgba[at + 3] = 255;
      if (system && inked >= 3) {
        const r = rows.get(system);
        if (r) [r[0], r[1]] = [Math.min(r[0], y), Math.max(r[1], y + 1)];
        else rows.set(system, [y, y + 1]);
      }
    }
  return { rgba, systems: [...rows.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]) };
}
/** Grey levels as RGBA. */
const grey = (lum: ArrayLike<number>) => {
  const rgba = new Uint8ClampedArray(lum.length * 4);
  for (let i = 0; i < lum.length; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = lum[i];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
};
/** The system's ink lies wholly inside the cut (cuts fall on whole rows). */
const holds = (c: Cut, [y0, y1]: [number, number], height = H) =>
  Math.round(c.top * height) <= y0 && Math.round(c.bottom * height) >= y1;

describe('cutting a page into systems', () => {
  it('cuts in the wide blank gaps: one picture per system, with a margin, none overlapping', () => {
    const m = page(),
      rand = random(1);
    fill(m, 350, 60, 650, 85); // a title, which joins the first system
    const systems = [200, 500, 800, 1100].map((y) => pianoSystem(m, y, rand));
    const { kind, cuts } = cutPage(m);
    expect(kind).toBe('systems');
    expect(cuts).toHaveLength(4);
    systems.forEach((s, i) => expect(holds(cuts[i], s), JSON.stringify([px(cuts[i]), s])).toBe(true));
    expect(holds(cuts[0], [60, 85])).toBe(true);
    for (let i = 1; i < cuts.length; i++) expect(cuts[i].top).toBeGreaterThanOrEqual(cuts[i - 1].bottom);
    // A margin around the ink, and the page's empty sides trimmed off.
    expect(cuts[1].top * H).toBeLessThan(systems[1][0] - 5);
    expect(cuts[1].bottom * H).toBeGreaterThan(systems[1][1] + 5);
    for (const c of cuts) {
      expect(c.left).toBeGreaterThan(0.03);
      expect(c.right).toBeLessThan(0.97);
    }
    // The margin is 2% of the page's long side on every side (here the gaps are wide enough for all of it): enough for
    // a stem's tip too faint to see in a soft photo. It must not shrink.
    const margin = 0.02 * H;
    for (const i of [1, 2]) {
      expect(cuts[i].top * H, 'top').toBeLessThanOrEqual(systems[i][0] - margin + 1);
      expect(cuts[i].bottom * H, 'bottom').toBeGreaterThanOrEqual(systems[i][1] + margin - 1);
    }
    for (const c of cuts) {
      expect(c.left * W, 'left').toBeLessThanOrEqual(80 - margin + 1);
      expect(c.right * W, 'right').toBeGreaterThanOrEqual(920 + margin - 1);
    }
  });

  it('keeps the two staves of a system together when only a thin line at the left joins them', () => {
    const m = page(),
      rand = random(2);
    const systems = [150, 450, 750].map((y) => pianoSystem(m, y, rand, false));
    const { kind, cuts } = cutPage(m);
    expect(kind).toBe('systems');
    expect(cuts).toHaveLength(3);
    systems.forEach((s, i) => expect(holds(cuts[i], s)).toBe(true));
  });

  it('a page with one system gives one picture', () => {
    const m = page();
    const system = pianoSystem(m, 300, random(3));
    const { kind, cuts } = cutPage(m);
    expect(kind).toBe('systems');
    expect(cuts).toHaveLength(1);
    expect(holds(cuts[0], system)).toBe(true);
  });

  it('ignores a scanner’s dark edge down the side of the page', () => {
    const m = page(),
      rand = random(4);
    fill(m, 0, 0, 12, H);
    fill(m, W - 6, 0, W, H);
    const systems = [200, 550, 900].map((y) => pianoSystem(m, y, rand));
    const { kind, cuts } = cutPage(m);
    expect(kind).toBe('systems');
    expect(cuts).toHaveLength(3);
    systems.forEach((s, i) => expect(holds(cuts[i], s)).toBe(true));
  });

  it('without clear gaps (a crowded page), falls back to overlapping bands that each hold whole systems', () => {
    const m = page(),
      rand = random(5);
    const systems = [100, 330, 560, 790, 1020].map((y) => pianoSystem(m, y, rand));
    // Dynamics, slurs and fingering fill every gap: no blank row is left between the systems.
    for (let y = 0; y < H; y += 3) {
      const x = 200 + Math.floor(rand() * 500);
      fill(m, x, y, x + 30, y + 3);
    }
    const { kind, cuts } = cutPage(m);
    expect(kind).toBe('bands');
    for (const s of systems)
      expect(
        cuts.some((c) => holds(c, s)),
        JSON.stringify(s),
      ).toBe(true);
    for (let i = 1; i < cuts.length; i++) expect(cuts[i].top).toBeLessThan(cuts[i - 1].bottom);
    // A few bands, measured from the width of the music (there is no system apart to measure by): each at most two
    // SYSTEM_SHARE of it tall, and every stretch of SYSTEM_SHARE of it whole in one of them.
    const keep = Math.floor(SYSTEM_SHARE * musicWidth(m));
    expect(cuts.length).toBeGreaterThanOrEqual(2);
    expect(cuts.length).toBeLessThanOrEqual(5);
    for (const c of cuts) expect((c.bottom - c.top) * H).toBeLessThanOrEqual(2 * keep + 4);
    for (let y = 0; y + keep <= H; y += 5) expect(cuts.some((c) => holds(c, [y, y + keep]))).toBe(true);
  });

  it('when one block is far taller than the rest (two systems run together), sends bands', () => {
    const m = page(),
      rand = random(6);
    const systems = [100, 400, 600, 1000].map((y) => pianoSystem(m, y, rand));
    fill(m, 500, 300, 501, 650); // a long slur line runs the second and third systems together
    fill(m, 500, 300, 530, 650);
    const { kind, cuts } = cutPage(m);
    expect(kind).toBe('bands');
    for (const s of systems) expect(cuts.some((c) => holds(c, s))).toBe(true);
  });

  it('bands only the block where systems run together, sized from the other systems, so each is whole', () => {
    // Three systems each about an eighth of the page, two joined by a long slur: more than a fifth of the inked height.
    const m = page(),
      rand = random(13);
    const systems = [400, 620, 840].map((y) => pianoSystem(m, y, rand));
    fill(m, 500, 500, 530, 700);
    const { kind, cuts } = cutPage(m);
    expect(kind).toBe('bands');
    for (const s of systems)
      expect(
        cuts.some((c) => holds(c, s)),
        JSON.stringify([s, cuts.map(px)]),
      ).toBe(true);
    // The system that stands alone is still cut on its own.
    expect(cuts.filter((c) => c.top * H > systems[1][1])).toHaveLength(1);

    // Four systems run together by hairpins in every gap, and one apart: overlapping bands, each system whole in one.
    const n = page(),
      tops = [60, 270, 480, 690, 1100],
      many = tops.map((y) => pianoSystem(n, y, rand));
    for (const y of [190, 400, 610]) fill(n, 300, y, 700, y + 50);
    const banded = cutPage(n);
    expect(banded.kind).toBe('bands');
    for (const s of many)
      expect(
        banded.cuts.some((c) => holds(c, s)),
        JSON.stringify(s),
      ).toBe(true);
    expect(banded.cuts.length).toBeGreaterThan(2);
    for (const c of banded.cuts) expect((c.bottom - c.top) * H).toBeLessThan(2.6 * (many[4][1] - many[4][0]));
  });

  it('keeps whole, in some band, every stretch up to a quarter taller than the page’s other systems', () => {
    // Two to four systems run together by hairpins across their gaps, at varying distances, and one system apart.
    // Wherever it lies, any stretch of rows up to 1.25 times the system apart is wholly inside one band.
    const rand = random(21);
    let tried = 0;
    for (let trial = 0; trial < 30; trial++) {
      const m = page(),
        count = 2 + Math.floor(rand() * 3),
        pitch = 185 + Math.floor(rand() * 50),
        start = 45 + Math.floor(rand() * 40),
        alone = start + count * pitch + 40 + Math.floor(rand() * 80);
      if (alone + 150 > H) continue;
      const joined = Array.from({ length: count }, (_, i) => pianoSystem(m, start + i * pitch, rand)),
        other = pianoSystem(m, alone, rand);
      for (let i = 0; i + 1 < count; i++) fill(m, 300, joined[i][1] - 5, 700, joined[i + 1][0] + 5);
      const { kind, cuts } = cutPage(m);
      // The systems run together come as overlapping bands, or whole in one picture when two `keep` hold them all.
      const together = cuts.filter((c) => !holds(c, other));
      expect(kind).toBe(together.length > 1 ? 'bands' : 'systems');
      if (together.length === 1) expect(holds(together[0], [joined[0][0], joined[count - 1][1]])).toBe(true);
      expect(cuts.filter((c) => holds(c, other))).toHaveLength(1);
      const keep = Math.floor(1.25 * (other[1] - other[0]));
      for (let y = joined[0][0]; y + keep <= joined[count - 1][1]; y += 5)
        expect(
          cuts.some((c) => holds(c, [y, y + keep])),
          JSON.stringify({ trial, y, keep, cuts: cuts.map(px) }),
        ).toBe(true);
      for (const c of cuts) expect((c.bottom - c.top) * H).toBeLessThanOrEqual(2 * keep + 4);
      tried++;
    }
    expect(tried).toBeGreaterThan(15);
  });

  it('systems run together that are taller than the page’s other systems (a song after a piano intro) are each whole', () => {
    // A piano intro of two staves, then systems of a voice and a piano, taller than the intro, run together by a crease
    // down the margin. The bands must hold the tallest of them whole, not just a quarter more than the intro.
    const m = page(),
      rand = random(51);
    const intro = songSystem(m, 120, 2, rand),
      song = [420, 760, 1100].map((y) => songSystem(m, y, 3, rand));
    fill(m, 30, song[0][1] - 20, 44, song[2][0] + 20);
    const { kind, cuts } = cutPage(m);
    expect(kind).toBe('bands');
    expect(cuts.filter((c) => holds(c, intro))).toHaveLength(1);
    const tallest = Math.max(...song.map((s) => s[1] - s[0]));
    expect(tallest).toBeGreaterThan(1.25 * (intro[1] - intro[0]));
    for (let y = song[0][0]; y + tallest <= song[2][1]; y += 3)
      expect(
        cuts.some((c) => holds(c, [y, y + tallest])),
        JSON.stringify({ y, tallest, cuts: cuts.map((c) => px(c)) }),
      ).toBe(true);
    // Still bands, not the whole run sent as one picture.
    const banded = cuts.filter((c) => c.bottom * H > song[0][0] + 5);
    expect(banded.length).toBeGreaterThan(1);
    for (const c of banded) expect((c.bottom - c.top) * H).toBeLessThan(song[2][1] - song[0][0]);

    // The same with slurs across both gaps instead of a crease, on several pages.
    for (const seed of [52, 53, 54]) {
      const n = page(),
        r = random(seed),
        first = songSystem(n, 110, 2, r),
        three = [390, 700, 1010].map((y) => songSystem(n, y, 3, r));
      fill(n, 450, three[0][1] - 5, 520, three[1][0] + 5);
      fill(n, 600, three[1][1] - 5, 680, three[2][0] + 5);
      const slurred = cutPage(n);
      for (const s of [first, ...three])
        expect(
          slurred.cuts.some((c) => holds(c, s)),
          JSON.stringify({ seed, s, cuts: slurred.cuts.map((c) => px(c)) }),
        ).toBe(true);
    }
  });

  it('pages that mix systems of one, two and three staves, some run together, lose no system', () => {
    // Staves [1, 2, 3, 2], the last three run together: the three-staff system is far taller than the one apart.
    const m = page(),
      rand = random(55);
    const systems = [100, 260, 520, 880].map((y, i) => songSystem(m, y, [1, 2, 3, 2][i], rand));
    fill(m, 300, systems[1][1] - 4, 360, systems[2][0] + 4);
    fill(m, 600, systems[2][1] - 4, 660, systems[3][0] + 4);
    const fixed = cutPage(m);
    expect(fixed.kind).toBe('bands');
    for (const s of systems)
      expect(
        fixed.cuts.some((c) => holds(c, s)),
        JSON.stringify({ s, cuts: fixed.cuts.map((c) => px(c)) }),
      ).toBe(true);

    // Random pages: systems of 1 to 3 staves at random sizes and gaps, one or two gaps bridged by a slur.
    let pages = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const r = random(seed * 7919),
        n = page(),
        space = 8 + Math.floor(r() * 4),
        drawn: [number, number][] = [];
      for (let y = 80 + Math.floor(r() * 60); ;) {
        const staves = r() < 0.5 ? 2 : r() < 0.5 ? 3 : 1,
          tall = (staves - 1) * 9 * space + 12 * space;
        if (y + tall > 1380) break;
        drawn.push(songSystem(n, y + 4 * space, staves, r, space));
        y += tall + 10 + Math.floor(r() * 40);
      }
      if (drawn.length < 3) continue;
      for (let k = 1 + Math.floor(r() * 2); k > 0; k--) {
        const i = Math.floor(r() * (drawn.length - 1)),
          x = 300 + Math.floor(r() * 400);
        fill(n, x, drawn[i][1] - 4, x + 60, drawn[i + 1][0] + 4);
      }
      const { cuts } = cutPage(n);
      for (const s of drawn)
        expect(
          cuts.some((c) => holds(c, s)),
          JSON.stringify({ seed, s, cuts: cuts.map((c) => px(c)) }),
        ).toBe(true);
      pages++;
    }
    expect(pages).toBeGreaterThan(40);
  });

  it('a page number, a footer or a title far from the music does not turn the page into bands', () => {
    const rand = random(14);
    // Two systems and a page number at the foot of the page: the number is not sent.
    const a = page(),
      two = [150, 450].map((y) => pianoSystem(a, y, rand));
    fill(a, 490, 1370, 510, 1385);
    const cutA = cutPage(a);
    expect(cutA.kind).toBe('systems');
    expect(cutA.cuts).toHaveLength(2);
    two.forEach((s, i) => expect(holds(cutA.cuts[i], s)).toBe(true));
    expect(cutA.cuts[1].bottom * H).toBeLessThan(700);
    // One system at the top and a page number far below it: one picture of the system alone, no blank picture.
    const b = page(),
      one = pianoSystem(b, 120, rand);
    fill(b, 495, 1380, 505, 1396);
    const cutB = cutPage(b);
    expect(cutB).toMatchObject({ kind: 'systems' });
    expect(cutB.cuts).toHaveLength(1);
    expect(holds(cutB.cuts[0], one)).toBe(true);
    expect(cutB.cuts[0].bottom * H).toBeLessThan(400);
    // Five systems, a page number just one gap below the last: five pictures.
    const c = page(),
      five = [60, 320, 580, 840, 1100].map((y) => pianoSystem(c, y, rand));
    fill(c, 490, 1385, 510, 1400);
    const cutC = cutPage(c);
    expect(cutC.kind).toBe('systems');
    expect(cutC.cuts).toHaveLength(5);
    five.forEach((s, i) => expect(holds(cutC.cuts[i], s)).toBe(true));
    // A title well above four short systems joins the first picture.
    const d = page(),
      four = [260, 520, 780, 1040].map((y) => pianoSystem(d, y, rand));
    fill(d, 350, 60, 650, 90);
    const cutD = cutPage(d);
    expect(cutD.kind).toBe('systems');
    expect(cutD.cuts).toHaveLength(4);
    expect(holds(cutD.cuts[0], [60, 90])).toBe(true);
    four.forEach((s, i) => expect(holds(cutD.cuts[i], s)).toBe(true));
  });

  it('barlines that line up from system to system are music, not a scanner’s edge, even on a full page', () => {
    // Six systems fill two thirds of the page, their barlines at the same places in every system.
    const m = page(),
      rand = random(15);
    const systems = [20, 250, 480, 710, 940, 1170].map((y) => pianoSystem(m, y, rand));
    const { kind, cuts } = cutPage(m);
    expect(kind).toBe('systems');
    expect(cuts).toHaveLength(6);
    systems.forEach((s, i) => expect(holds(cuts[i], s), JSON.stringify([s, px(cuts[i])])).toBe(true));
  });

  it('sends no band of blank paper, nor one that holds only the page number', () => {
    const m = page(),
      rand = random(16);
    // Crowded music run together over the top half of the page, then blank paper and a page number.
    for (const y of [40, 230, 420, 610]) pianoSystem(m, y, rand);
    for (let y = 0; y < 760; y += 3) fill(m, 300, y, 330, y + 3);
    fill(m, 495, 1380, 505, 1396);
    const { kind, cuts } = cutPage(m);
    expect(kind).toBe('bands');
    expect(cuts.length).toBeGreaterThan(1);
    for (const c of cuts) {
      let inked = 0;
      for (let y = Math.round(c.top * H); y < Math.round(c.bottom * H); y++)
        for (let x = 0; x < W; x++) inked += m.ink[y * W + x];
      expect(inked).toBeGreaterThan(0);
      expect(c.bottom * H).toBeLessThan(800);
    }
  });

  it('a page of noise is sent as bands covering all of it', () => {
    const m = page(),
      rand = random(7);
    for (let i = 0; i < m.ink.length; i++) m.ink[i] = rand() < 0.05 ? 1 : 0;
    const { kind, cuts } = cutPage(m);
    expect(kind).toBe('bands');
    expect(cuts[0].top).toBe(0);
    expect(cuts[cuts.length - 1].bottom).toBe(1);
    for (let y = 0; y < H; y += 7) expect(cuts.some((c) => c.top * H <= y && c.bottom * H > y)).toBe(true);
  });

  it('an empty page has nothing to send', () => {
    expect(cutPage(page())).toEqual({ kind: 'blank', cuts: [] });
  });
});

describe('pictures with no system apart to measure the others by', () => {
  it('a picture of one system, however tightly cropped, is one picture of the whole system', () => {
    const rand = random(31);
    for (const height of [200, 260, 330, 420]) {
      const m = page(height),
        system = pianoSystem(m, Math.round((height - 182) / 2) + 40, rand);
      const { kind, cuts } = cutPage(m);
      expect(kind, String(height)).toBe('systems');
      expect(cuts).toHaveLength(1);
      expect(holds(cuts[0], system, height), JSON.stringify([height, system, px(cuts[0], height)])).toBe(true);
    }
    // Notes only inside the staves, so that three barlines are all the ink across the gap between them: although they
    // run down most of the picture, they are barlines (not the edge of a page) and keep the two staves together.
    const m = page(170),
      top = 20;
    for (const t of [top, top + 90]) {
      for (let i = 0; i < 5; i++) fill(m, 80, t + i * 10, 920, t + i * 10 + 1);
      for (let x = 130; x < 900; x += 40) {
        const y = t + Math.floor(rand() * 34);
        fill(m, x, y, x + 9, y + 7);
      }
    }
    for (const x of [80, 500, 919]) fill(m, x, top, x + 1, top + 131);
    const tight = cutPage(m);
    expect(tight.kind).toBe('systems');
    expect(tight.cuts).toHaveLength(1);
    expect(holds(tight.cuts[0], [top, top + 131], 170)).toBe(true);
  });

  it('a title above one system in a short picture goes with it, in one picture', () => {
    const m = page(330),
      rand = random(33);
    fill(m, 380, 10, 620, 34);
    const system = pianoSystem(m, 130, rand);
    const { kind, cuts } = cutPage(m);
    expect(kind).toBe('systems');
    expect(cuts).toHaveLength(1);
    expect(holds(cuts[0], [10, system[1]], 330), JSON.stringify(px(cuts[0], 330))).toBe(true);
  });

  it('three large systems run together by a dark strip down the margin (a shadow, a crease) are each whole', () => {
    // Staves 12 px apart: each system is about a quarter of the width of the music, more than a fifth of the block.
    const m = page(),
      rand = random(34);
    const systems = [300, 620, 940].map((y) => pianoSystem(m, y, rand, true, 12));
    fill(m, 20, Math.round(H * 0.22), 40, Math.round(H * 0.78));
    const { kind, cuts } = cutPage(m);
    expect(kind).toBe('bands');
    for (const s of systems)
      expect(
        cuts.some((c) => holds(c, s)),
        JSON.stringify([s, cuts.map((c) => px(c))]),
      ).toBe(true);
    const keep = Math.floor(SYSTEM_SHARE * musicWidth(m));
    for (const c of cuts) expect((c.bottom - c.top) * H).toBeLessThanOrEqual(2 * keep + 4);
  });

  it('keeps whole, in some picture, every system and every stretch up to SYSTEM_SHARE of the width of the music', () => {
    // Two to six systems of any size up to about a quarter of the width of the music, run together by hairpins in every
    // gap: nothing apart to measure a system by.
    const rand = random(41);
    let banded = 0;
    for (let trial = 0; trial < 30; trial++) {
      const m = page(),
        count = 2 + Math.floor(rand() * 5),
        space = 8 + Math.floor(rand() * 6),
        pitch = Math.round(17.5 * space) + 20 + Math.floor(rand() * 50),
        start = 50 + Math.floor(rand() * 40);
      if (start + count * pitch + 60 > H) continue;
      const systems = Array.from({ length: count }, (_, i) => pianoSystem(m, start + i * pitch, rand, true, space));
      for (let i = 0; i + 1 < count; i++) fill(m, 300, systems[i][1] - 5, 700, systems[i + 1][0] + 5);
      const { kind, cuts } = cutPage(m);
      expect(kind).toBe(cuts.length > 1 ? 'bands' : 'systems');
      if (cuts.length > 1) banded++;
      for (const s of systems) expect(cuts.some((c) => holds(c, s))).toBe(true);
      const keep = Math.floor(SYSTEM_SHARE * musicWidth(m));
      for (let y = systems[0][0]; y + keep <= systems[count - 1][1]; y += 5)
        expect(
          cuts.some((c) => holds(c, [y, y + keep])),
          JSON.stringify({ trial, y, keep, cuts: cuts.map((c) => px(c)) }),
        ).toBe(true);
      for (const c of cuts) expect((c.bottom - c.top) * H).toBeLessThanOrEqual(2 * keep + 4);
    }
    expect(banded).toBeGreaterThan(5);
  });

  it('a narrow crop (the first bars of the page) of systems run together keeps each whole', () => {
    // A third of the page's width: a piano system can be taller than SYSTEM_SHARE of the width of the music, so the
    // bands are measured from the systems' own staves.
    const drawCrop = (seed: number, join: (m: Mask, s: [number, number][]) => void) => {
      const w = 400,
        h = 800,
        m: Mask = { width: w, height: h, ink: new Uint8Array(w * h) },
        rand = random(seed);
      const systems = [80, 330, 580].map((top): [number, number] => {
        for (const t of [top, top + 90]) {
          for (let i = 0; i < 5; i++) fill(m, 20, t + i * 10, 380, t + i * 10 + 1);
          for (let x = 50; x < 370; x += 40) {
            const y = t - 15 + Math.floor(rand() * 60);
            fill(m, x, y, x + 9, y + 7);
            fill(m, x + 8, y - 25, x + 9, y + 3);
          }
        }
        for (const x of [20, 200, 379]) fill(m, x, top, x + 1, top + 131);
        const rows = [];
        for (let y = top - 45; y < top + 180; y++)
          if (m.ink.subarray(y * w, (y + 1) * w).some((v) => v === 1)) rows.push(y);
        return [rows[0], rows[rows.length - 1] + 1];
      });
      join(m, systems);
      expect(Math.max(...systems.map((s) => s[1] - s[0]))).toBeGreaterThan(SYSTEM_SHARE * musicWidth(m));
      return { m, systems, h };
    };
    for (const seed of [1, 2, 3, 61, 62]) {
      // A crease down the margin, at the staves' left end: the systems may go as one picture, but each is whole.
      const crease = drawCrop(seed, (m, s) => fill(m, 6, s[0][1] - 20, 14, s[2][0] + 20));
      const a = cutPage(crease.m);
      for (const s of crease.systems)
        expect(
          a.cuts.some((c) => holds(c, s, crease.h)),
          JSON.stringify({ seed, s, cuts: a.cuts.map((c) => px(c, crease.h)) }),
        ).toBe(true);
      // Slurs across both gaps, in the middle of the music: bands, each system whole in one.
      const slurs = drawCrop(seed, (m, s) => {
        fill(m, 150, s[0][1] - 4, 190, s[1][0] + 4);
        fill(m, 250, s[1][1] - 4, 290, s[2][0] + 4);
      });
      const b = cutPage(slurs.m);
      expect(b.kind).toBe('bands');
      for (const s of slurs.systems)
        expect(
          b.cuts.some((c) => holds(c, s, slurs.h)),
          JSON.stringify({ seed, s, cuts: b.cuts.map((c) => px(c, slurs.h)) }),
        ).toBe(true);
    }
  });

  it('a title or a line of text is never the measure of a system', () => {
    // A title, a subtitle and a composer close together: one block taller than a twentieth of the page, with no staff
    // lines. Two systems below it run together by a hairpin.
    const m = page(),
      rand = random(35);
    for (let y = 60; y < 135; y += 3) for (let x = 250 + (y % 7); x < 750; x += 7) fill(m, x, y, x + 2, y + 3);
    const two = [300, 560].map((y) => pianoSystem(m, y, rand));
    fill(m, 300, two[0][1] - 5, 700, two[1][0] + 5);
    expect(two[1][1] - two[0][0]).toBeGreaterThan(ONE_SYSTEM * musicWidth(m));
    const { cuts } = cutPage(m);
    for (const s of two)
      expect(
        cuts.some((c) => holds(c, s)),
        JSON.stringify([s, cuts.map((c) => px(c))]),
      ).toBe(true);
  });

  it('a crowded page photographed at a slight angle goes as overlapping strips, not whole because one system was found', () => {
    // Five piano systems with a slur across every gap: one block of ink, nothing apart to measure by. Through a camera
    // turned a little, only the middle system's staff lines run straight across the picture, so the block's staves show
    // that one system alone. It covers a fifth of the block: no reason to send the whole page as one picture.
    for (const [seed, k] of [
      [3, 0.03],
      [5, 0.05],
    ]) {
      const { rgba, systems } = photograph(crowdedPage(seed), keystone(k));
      const { kind, cuts } = cutPage(inkMask(rgba, W, H));
      // A photo that already goes as strips is cut as before: nothing in it is left out.
      expect(cutPixels(rgba, W, H)).toEqual({ kind, cuts });
      expect(kind, `seed ${seed}`).toBe('bands');
      expect(cuts.length).toBeGreaterThan(1);
      for (const c of cuts) expect(c.bottom - c.top).toBeLessThan(0.6);
      for (const s of systems)
        expect(
          cuts.some((c) => holds(c, s)),
          JSON.stringify({ seed, s, cuts: cuts.map((c) => px(c)) }),
        ).toBe(true);
    }
  });

  it('half a system cut off by the edge of a crop is not the measure of a system', () => {
    const height = 640,
      m = page(height),
      rand = random(36);
    pianoSystem(m, -60, rand); // only its lower staff is in the picture
    const two = [250, 470].map((y) => pianoSystem(m, y, rand));
    fill(m, 300, two[0][1] - 5, 700, two[1][0] + 5);
    // The two together are too tall to be one system, so they are not simply sent whole as one.
    expect(two[1][1] - two[0][0]).toBeGreaterThan(ONE_SYSTEM * musicWidth(m));
    const { cuts } = cutPage(m);
    for (const s of two)
      expect(
        cuts.some((c) => holds(c, s, height)),
        JSON.stringify([s, cuts.map((c) => px(c, height))]),
      ).toBe(true);
  });
});

describe('ink from pixels', () => {
  /** RGBA for a photo: paper that darkens from left to right (a shadow), print on it. */
  function photo(): Uint8ClampedArray {
    const m = page(),
      rand = random(8);
    const systems = [200, 600, 1000].map((y) => pianoSystem(m, y, rand));
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const paper = 245 - (x / W) * 140,
          v = m.ink[y * W + x] ? paper * 0.25 : paper,
          i = (y * W + x) * 4;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
        rgba[i + 3] = 255;
      }
    expect(systems).toHaveLength(3);
    return rgba;
  }

  it('finds the print and not the shadow, so the photo still cuts into systems', () => {
    const rgba = photo(),
      mask = inkMask(rgba, W, H);
    // The darkest paper (right edge, no print) is not ink.
    expect(mask.ink[700 * W + 990]).toBe(0);
    expect(mask.ink[100 * W + 990]).toBe(0);
    // A staff line on the dark side is.
    expect(mask.ink[1000 * W + 900]).toBe(1);
    const { kind, cuts } = cutPage(mask);
    expect(kind).toBe('systems');
    expect(cuts).toHaveLength(3);
    // The shadow is not content either: the check that nothing is left out changes nothing.
    expect(cutPixels(rgba, W, H)).toEqual({ kind, cuts });
  });

  it('a soft photo: faint barlines still join the two staves of each system, and the table around the page is not music', () => {
    // A page photographed on a darker table: grey paper, dark print, and barlines so softened (by the photo and by
    // scaling down) that they are only a little darker than the paper.
    const left = 70,
      right = 930,
      top = 70,
      bottom = 1370,
      lum = new Uint8ClampedArray(W * H).fill(60);
    for (let y = top; y < bottom; y++) lum.fill(215, y * W + left, y * W + right);
    const m = page(),
      rand = random(17);
    const systems = [200, 600, 1000].map((y) => pianoSystem(m, y, rand, false));
    const bars = [200, 600, 1000].flatMap((y) => [130, 380, 630, 880].map((x) => [x, y] as const));
    for (let i = 0; i < W * H; i++) if (m.ink[i]) lum[i] = 40;
    for (const [x, y] of bars) for (let r = y; r < y + 131; r++) if (!m.ink[r * W + x]) lum[r * W + x] = 150;
    // pianoSystem drew a thin line at the left to join the staves (here on the table): take it away, so that only the
    // faint barlines join them.
    for (const y of [200, 600, 1000]) for (let r = y; r < y + 131; r++) lum[r * W + 60] = 60;
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = lum[i];
      rgba[i * 4 + 3] = 255;
    }
    const mask = inkMask(rgba, W, H);
    // The barlines are not ink, only faint ink: without them staves would be pictures of their own.
    expect(mask.ink[(200 + 65) * W + 380]).toBe(0);
    expect(mask.faint![(200 + 65) * W + 380]).toBe(1);
    expect(cutPage({ ...mask, faint: undefined }).cuts.length).toBeGreaterThan(3);
    const { kind, cuts } = cutPage(mask);
    expect(kind).toBe('systems');
    expect(cuts).toHaveLength(3);
    systems.forEach((s, i) => expect(holds(cuts[i], s), JSON.stringify([s, px(cuts[i])])).toBe(true));
    // The table along the page's edges is not ink.
    expect(mask.ink[30 * W + 500]).toBe(0);
    expect(mask.ink[700 * W + 20]).toBe(0);
    // Nor content left out: the check after cutting changes nothing.
    expect(cutPixels(rgba, W, H)).toEqual({ kind, cuts });
  });

  it('cuts a dark-mode screenshot (light notes on a dark page) like the same page in light mode', () => {
    const m = page(),
      systems = [200, 500, 800, 1100].map((y) => pianoSystem(m, y, random(4)));
    const light = cutPage(inkMask(grey(m.ink.map((v) => (v ? 20 : 240))), W, H)),
      dark = cutPage(inkMask(grey(m.ink.map((v) => (v ? 230 : 30))), W, H));
    expect(light.kind).toBe('systems');
    expect(light.cuts).toHaveLength(4);
    expect(dark).toEqual(light);
    systems.forEach((s, i) => expect(holds(dark.cuts[i], s), JSON.stringify([s, px(dark.cuts[i])])).toBe(true));
    expect(cutPixels(grey(m.ink.map((v) => (v ? 230 : 30))), W, H)).toEqual(light);
  });

  it('is not fooled into reading a dim photo or a page on a dark table the other way round', () => {
    // A dim photo: grey paper, darker print, and thin streaks of glare lighter than anything else.
    const m = page(),
      systems = [200, 600, 1000].map((y) => pianoSystem(m, y, random(9)));
    const dim = m.ink.map((v) => (v ? 30 : 90));
    for (const y of [40, 41, 1380, 1381]) dim.fill(200, y * W, (y + 1) * W);
    const dimMask = inkMask(grey(dim), W, H);
    expect(dimMask.ink[200 * W + 500]).toBe(1); // a staff line
    const dimCuts = cutPage(dimMask);
    expect(dimCuts.kind).toBe('systems');
    expect(dimCuts.cuts).toHaveLength(3);
    systems.forEach((s, i) => expect(holds(dimCuts.cuts[i], s)).toBe(true));
    // The streaks of glare run across whole rows: they are not content, and nothing is left out.
    expect(cutPixels(grey(dim), W, H)).toEqual(dimCuts);
    // A page photographed on a dark table, under a quarter of the picture: the light part of the picture is a region
    // (the page), not strokes of ink.
    const table = new Uint8Array(W * H).fill(45);
    for (let y = 100; y < 1300; y++) table.fill(220, y * W + 360, y * W + 640);
    const tops = [300, 600, 900];
    for (const top of tops) {
      for (const t of [top, top + 60])
        for (let k = 0; k < 5; k++) table.fill(30, (t + k * 7) * W + 375, (t + k * 7) * W + 625);
      for (const x of [375, 500, 624]) for (let y = top; y < top + 89; y++) table[y * W + x] = 30;
    }
    const tableMask = inkMask(grey(table), W, H);
    expect(tableMask.ink[300 * W + 450]).toBe(1); // print on the page
    expect(tableMask.ink[250 * W + 450]).toBe(0); // the page's paper
    expect(tableMask.ink[200 * W + 100]).toBe(0); // the table
    const tableCuts = cutPage(tableMask);
    expect(tableCuts.kind).toBe('systems');
    expect(tableCuts.cuts).toHaveLength(3);
    tops.forEach((top, i) => expect(holds(tableCuts.cuts[i], [top, top + 89])).toBe(true));
    // The edges of the page on the table are not content left out.
    expect(cutPixels(grey(table), W, H)).toEqual(tableCuts);
  });

  it('reads transparent pixels as paper', () => {
    const rgba = new Uint8ClampedArray(20 * 20 * 4); // all transparent black
    expect(inkMask(rgba, 20, 20).ink.every((v) => v === 0)).toBe(true);
    expect(cutPixels(rgba, 20, 20)).toEqual({ kind: 'blank', cuts: [] });
  });
});

describe('nothing the owner chose is left out', () => {
  /** Four piano systems, as in a dark-mode screenshot; `look` gives each pixel's grey from whether it is ink. */
  const fourSystems = () => {
    const m = page();
    return { m, systems: [200, 500, 800, 1100].map((y) => pianoSystem(m, y, random(4))) };
  };
  const drawn = (m: Mask, look: (ink: boolean, x: number, y: number) => number) =>
    grey(Array.from(m.ink, (v, i) => look(v === 1, i % W, Math.floor(i / W))));
  /** The rows [first, last + 1) that hold any ink of the drawn page. */
  const content = (m: Mask) => inkRows(m, 0, m.height);

  it('a page read the wrong way round (a light bar, a light frame, a grey background) goes as strips over all of it', () => {
    // A dark-mode page under a light bar 60 px tall (a title bar, a browser's frame), inside a light frame, and light
    // notes on grey: the ink is misread, and cutPage alone leaves whole systems out of every picture. The check after
    // cutting does not depend on which way round the page is: content lies outside every picture, so the page goes
    // as overlapping strips over all of its content, and every system is whole in one of them.
    const { m, systems } = fourSystems(),
      [first, last] = content(m);
    const pages = {
      'light bar': drawn(m, (ink, _x, y) => (y < 60 ? 235 : ink ? 230 : 30)),
      'light frame': drawn(m, (ink, x, y) => (y < 90 || x < 40 || x >= 960 ? 235 : ink ? 230 : 30)),
      'grey background': drawn(m, (ink) => (ink ? 250 : 110)),
    };
    for (const [name, rgba] of Object.entries(pages)) {
      const alone = cutPage(inkMask(rgba, W, H)),
        { kind, cuts } = cutPixels(rgba, W, H),
        why = JSON.stringify({ name, alone: alone.cuts.map((c) => px(c)), cuts: cuts.map((c) => px(c)) });
      expect(kind, why).toBe('bands');
      expect(cuts.length, why).toBeGreaterThan(1);
      for (const s of systems)
        expect(
          cuts.some((c) => holds(c, s)),
          why,
        ).toBe(true);
      // Strips over all of the content, overlapping, none of them the whole page.
      expect(cuts[0].top * H, why).toBeLessThanOrEqual(first);
      expect(cuts[cuts.length - 1].bottom * H, why).toBeGreaterThanOrEqual(last);
      for (let i = 1; i < cuts.length; i++) expect(cuts[i].top, why).toBeLessThan(cuts[i - 1].bottom);
      for (let y = first; y < last; y++)
        expect(
          cuts.some((c) => c.top * H <= y && y < c.bottom * H),
          why,
        ).toBe(true);
      for (const c of cuts) {
        expect(c.bottom - c.top, why).toBeLessThan(0.75);
        expect(c.left * W, why).toBeLessThanOrEqual(80);
        expect(c.right * W, why).toBeGreaterThanOrEqual(920);
      }
    }
  });

  it('writing in a bar above the page (a window’s title, a toolbar) goes in a picture too, either way round', () => {
    // A light page under a dark bar with light writing, and a dark page under a light bar with dark writing. What is
    // content is judged against the background of its own part of the page and the parts next to it (so that the edge
    // of a bar or of a photographed page is not content): writing is seen as content once it is more than about a
    // thirtieth of the page from a region as dark or as light as itself, as here.
    const { m, systems } = fourSystems(),
      writing = (x: number, y: number) => y >= 20 && y < 40 && x >= 30 && x < 400 && (x % 11 < 3 || y % 7 === 0);
    for (const [bar, ink, paper, text] of [
      [40, 20, 240, 220],
      [225, 230, 30, 40],
    ]) {
      const rgba = drawn(m, (inked, x, y) => (y < 120 ? (writing(x, y) ? text : bar) : inked ? ink : paper)),
        { cuts } = cutPixels(rgba, W, H),
        why = JSON.stringify({ bar, cuts: cuts.map((c) => px(c)) });
      expect(
        cuts.some((c) => holds(c, [20, 40])),
        why,
      ).toBe(true);
      for (const s of systems)
        expect(
          cuts.some((c) => holds(c, s)),
          why,
        ).toBe(true);
    }
  });

  it('a normal light page and a fully dark page are cut exactly as before', () => {
    const { m, systems } = fourSystems();
    for (const [ink, paper] of [
      [20, 240],
      [230, 30],
      [0, 255],
      [255, 0],
    ]) {
      const rgba = drawn(m, (inked) => (inked ? ink : paper)),
        guarded = cutPixels(rgba, W, H);
      expect(guarded).toEqual(cutPage(inkMask(rgba, W, H)));
      expect(guarded.kind).toBe('systems');
      expect(guarded.cuts).toHaveLength(4);
      systems.forEach((s, i) => expect(holds(guarded.cuts[i], s)).toBe(true));
    }
    // A page number far below the last system is left out on purpose, as before: it is no reason for strips.
    const n = page(),
      three = [150, 450, 750].map((y) => pianoSystem(n, y, random(14)));
    fill(n, 490, 1370, 510, 1385);
    for (const [ink, paper] of [
      [20, 240],
      [230, 30],
    ]) {
      const rgba = drawn(n, (inked) => (inked ? ink : paper)),
        guarded = cutPixels(rgba, W, H);
      expect(guarded).toEqual(cutPage(inkMask(rgba, W, H)));
      expect(guarded.kind).toBe('systems');
      expect(guarded.cuts).toHaveLength(3);
      three.forEach((s, i) => expect(holds(guarded.cuts[i], s)).toBe(true));
      expect(guarded.cuts[2].bottom * H).toBeLessThan(1000);
    }
  });
});

describe('the size each picture is sent at', () => {
  it('never enlarges, keeps the aspect, at most about 1.7 million pixels and 2,600 px on the long side', () => {
    expect(sendSize(2400, 500)).toEqual({ width: 2400, height: 500 });
    expect(sendSize(800, 200)).toEqual({ width: 800, height: 200 });
    expect(sendSize(5200, 1000)).toEqual({ width: 2600, height: 500 });
    const square = sendSize(2000, 2000);
    expect(square.width).toBe(square.height);
    for (const [w, h] of [
      [2000, 2000],
      [2600, 3700],
      [4032, 3024],
      [10000, 90],
      [1, 1],
    ]) {
      const s = sendSize(w, h);
      expect(s.width * s.height).toBeLessThanOrEqual(MAX_PIXELS);
      expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(MAX_SIDE);
      expect(Math.abs(s.width / s.height - w / h) / (w / h)).toBeLessThan(0.02);
    }
  });
});

describe('the count shown before sending', () => {
  it('counts pictures and pages in plain words, never systems (a picture may hold more than one)', () => {
    expect(
      picturesLine([
        { page: 1, kind: 'systems', kept: 5 },
        { page: 2, kind: 'systems', kept: 4 },
        { page: 3, kind: 'systems', kept: 3 },
      ]),
    ).toBe('12 pictures from 3 pages.');
    expect(picturesLine([{ page: 1, kind: 'systems', kept: 1 }])).toBe('1 picture from 1 page.');
  });

  it('names the pages where some lines went as overlapping strips and the empty ones, and leaves out a page whose pictures were all removed', () => {
    // A page may go partly as pictures cut in the gaps and partly as strips (one block of it run together), or wholly
    // as strips: the sentence is true either way, so it never says that the page went as strips.
    expect(
      picturesLine([
        { page: 1, kind: 'systems', kept: 4 },
        { page: 2, kind: 'bands', kept: 4 },
        { page: 3, kind: 'blank', kept: 0 },
        { page: 4, kind: 'systems', kept: 0 },
      ]),
    ).toBe(
      '8 pictures from 2 pages. On page 2, lines of music that could not be told apart went as overlapping strips. Page 3 looks empty, so nothing from it will be sent.',
    );
    expect(
      picturesLine([
        { page: 1, kind: 'bands', kept: 3 },
        { page: 2, kind: 'bands', kept: 2 },
        { page: 3, kind: 'bands', kept: 2 },
      ]),
    ).toBe(
      '7 pictures from 3 pages. On pages 1, 2 and 3, lines of music that could not be told apart went as overlapping strips.',
    );
    for (const pages of [1, 2])
      expect(
        picturesLine(Array.from({ length: pages }, (_, i) => ({ page: i + 1, kind: 'bands' as const, kept: 2 }))),
      ).not.toMatch(/Pages? [\d, and]+ went/);
    expect(picturesLine([{ page: 1, kind: 'systems', kept: 0 }])).toBe('No pictures to send.');
    for (const kind of ['systems', 'bands', 'blank'] as const)
      expect(picturesLine([{ page: 1, kind, kept: kind === 'blank' ? 0 : 2 }])).not.toMatch(/system/);
  });
});
