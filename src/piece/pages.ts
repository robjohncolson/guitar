/**
 * Pictures of sheet music for the reader (reader.ts): each page is cut, from its own pixels, into pictures that each
 * hold one system (one line of music across the page) where it can, and each picture is sized for what the service
 * really looks at.
 *
 * The cutting is pure (inkMask, cutPage, cutPixels, sendSize, picturesLine) and tested on drawn pages in
 * tests/piece-pages.test.ts.
 * The canvas helpers at the end draw a page and cut it in the browser; nothing here touches the network.
 *
 * How a page is cut: the ink in each pixel row, outside page-long unbroken vertical lines (a scanner's dark edge, the
 * edge of a photographed page), gives a row profile; runs of inked rows separated by wide blank gaps are blocks. A gap
 * that a vertical line crosses (a system's barline or brace joining its staves, found also when it is faint, as in a
 * soft photo) is inside a system, so its blocks join. A block much smaller than the others joins its nearer neighbour
 * (a title, a tempo word), except below the last system and farther from it than that system is tall (a page number, a
 * footer), where it is left out; a block that is mostly solid ink (a dark edge) is left out too.
 *
 * When one block is far taller than the others (systems run together by a slur, a hairpin, a shadow or a crease), and
 * taller than any one system could be (over a third of the width of the music), that block alone is sent as overlapping
 * bands, each at most two `keep` tall, so that every stretch of `keep` rows is whole in at least one band. `keep` is a
 * quarter more than the tallest system: the page's other systems, and the block's own systems, which may be taller (a
 * song's systems of a voice and a piano after a piano-only intro). Only blocks of music (they hold staff lines) that the
 * picture's edge does not cut are measured: never a title, a line of text, or a system half cut off by a crop. The
 * block's own systems are found from their staves (runs of long, thin lines), joined where a line or a brace at their
 * left end crosses the gap between them, as it does at the start of every system of several staves; each counts as its
 * staves plus as much ink outside them as the other systems have. Where there is no other system to measure by (the
 * page is one block of ink), `keep` is SYSTEM_SHARE of the width of the music (a piano system is about a quarter of it),
 * or the tallest of the block's systems with the widest gap between them if that is more, as on a narrow crop of the
 * first bars of a page; a block that one system found from its staves covers for the most part goes whole. A block no
 * taller than two `keep` goes whole, as one picture.
 *
 * Every length here is a share of the picture's long side: the height of a page, but the width of a picture of a few
 * lines cut from a page, whose height says nothing about the size of the music.
 *
 * Then a check that does not depend on which way round the page was read (cutPixels): every row that holds anything
 * (it is not uniform, whatever its brightness) must lie in some picture, a page number or a footer below the music
 * excepted. A page where some of it does not (light notes on a dark page under a light bar, say, read the wrong way
 * round) goes as overlapping strips over all of its content instead, so nothing the owner chose is left out unseen.
 *
 * All of this is best effort, and nothing that reads its result may promise more: a PDF or a straight, clean scan is
 * usually cut into one line of music per picture, but a photo often goes as a few overlapping strips, and a picture
 * may hold more than one line of music. The owner sees every picture before anything is sent.
 */

/** The service scales every picture down to about this many pixels, and more than this on the long side is wasted. */
export const MAX_PIXELS = 1_700_000;
export const MAX_SIDE = 2600;

/** The size a cut is sent at: never enlarged, at most MAX_PIXELS and at most MAX_SIDE on its long side. */
export function sendSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height), Math.sqrt(MAX_PIXELS / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

export interface Mask {
  width: number;
  height: number;
  /** 1 where a pixel is ink, row by row. */
  ink: Uint8Array;
  /**
   * 1 where a pixel is at least faintly darker than its paper: a thin barline softened by a photo and by scaling down,
   * which `ink` misses. Used only to see what joins the staves of a system and how far its ink reaches. Missing: `ink`.
   */
  faint?: Uint8Array;
}

/** A pixel is ink below this share of its paper's brightness, and faint ink below FAINT. */
const INK = 0.6,
  FAINT = 0.8;

/**
 * Ink from RGBA pixels. A pixel is ink when it is much darker than the paper around it: the paper's brightness is
 * measured per tile (the brightest of the tile and its neighbours), so a photo's shadow is not ink but the print in it
 * is. Transparent pixels count as white paper. A region darker than any paper (a table around a photographed page) has
 * no ink, nor has a tile that is nearly all dark next to paper (the table along the page's edge): print never covers a
 * whole tile. Light notes on a dark page (a dark-mode screenshot) are looked at the other way round (see lightOnDark),
 * so that the page is usually cut like the same page in light mode (cutPixels catches a page read the wrong way round);
 * the pictures sent are cut from the page as it was given.
 */
export function inkMask(rgba: ArrayLike<number>, width: number, height: number): Mask {
  const n = width * height,
    lum = brightness(rgba, n);
  const tile = Math.max(8, Math.round(Math.min(width, height) / 24)),
    tw = Math.ceil(width / tile),
    th = Math.ceil(height / tile),
    hist = new Uint32Array(tw * th * 256),
    sizes = new Uint32Array(tw * th);
  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / tile) * tw;
    for (let x = 0; x < width; x++) {
      const t = row + Math.floor(x / tile);
      hist[t * 256 + lum[y * width + x]]++;
      sizes[t]++;
    }
  }
  if (lightOnDark(hist, sizes)) {
    for (let i = 0; i < n; i++) lum[i] = 255 - lum[i];
    for (let t = 0; t < tw * th; t++) hist.subarray(t * 256, t * 256 + 256).reverse();
  }
  // The paper of a tile: the level 90% of its pixels are at or below.
  const level = new Float32Array(tw * th);
  for (let t = 0; t < tw * th; t++) {
    const target = sizes[t] * 0.9;
    let seen = 0,
      v = 0;
    for (; v < 255; v++) {
      seen += hist[t * 256 + v];
      if (seen >= target) break;
    }
    level[t] = v;
  }
  const paper = new Float32Array(tw * th);
  for (let ty = 0; ty < th; ty++)
    for (let tx = 0; tx < tw; tx++) {
      let best = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = tx + dx,
            y = ty + dy;
          if (x >= 0 && y >= 0 && x < tw && y < th) best = Math.max(best, level[y * tw + x]);
        }
      paper[ty * tw + tx] = best;
    }
  const ink = new Uint8Array(n),
    faint = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / tile) * tw;
    for (let x = 0; x < width; x++) {
      const t = row + Math.floor(x / tile),
        p = paper[t];
      if (p < 64 || level[t] < p * INK) continue;
      const v = lum[y * width + x];
      if (v < p * FAINT) faint[y * width + x] = 1;
      if (v < p * INK) ink[y * width + x] = 1;
    }
  }
  return { width, height, ink, faint };
}

/** The brightness (0 to 255) of each of `n` RGBA pixels; transparent pixels count as white paper. */
function brightness(rgba: ArrayLike<number>, n: number): Uint8Array {
  const lum = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3] / 255,
      l = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    lum[i] = Math.round(l * a + 255 * (1 - a));
  }
  return lum;
}

/**
 * Light notes on a dark page, as in a dark-mode screenshot: most of the picture is dark, a little of it (the notes) is
 * much lighter, next to nothing is darker, and the light is in thin strokes, never a whole region. Not a dim photo of a
 * page (its print is darker than its paper), nor a page photographed on a dark table (its light part, the page, is a
 * region). `hist` holds a 256-level histogram of each tile's brightness, `sizes` each tile's pixel count.
 */
function lightOnDark(hist: Uint32Array, sizes: Uint32Array): boolean {
  const tiles = sizes.length,
    all = new Float64Array(256);
  let n = 0;
  for (let t = 0; t < tiles; t++) {
    n += sizes[t];
    for (let v = 0; v < 256; v++) all[v] += hist[t * 256 + v];
  }
  const median = (count: (v: number) => number, size: number) => {
    let seen = 0,
      v = 0;
    for (; v < 255; v++) if ((seen += count(v)) >= size / 2) break;
    return v;
  };
  const background = median((v) => all[v], n);
  if (background >= 96) return false;
  let light = 0,
    dark = 0;
  for (let v = 0; v < 256; v++)
    if (v > background + 64) light += all[v];
    else if (v < background - 32) dark += all[v];
  if (light < 0.002 * n || light > 0.25 * n || 4 * dark > light) return false;
  // Tiles mostly light: a region of light (a page on a table, a panel), not strokes of ink.
  let regions = 0;
  for (let t = 0; t < tiles; t++) if (median((v) => hist[t * 256 + v], sizes[t]) > background + 64) regions++;
  return regions <= 0.02 * tiles;
}

/** A rectangle of the page, as fractions of its width and height (so it applies at any resolution). */
export interface Cut {
  top: number;
  bottom: number;
  left: number;
  right: number;
}
export interface PageCuts {
  /**
   * systems: cut in the gaps, usually one system per cut (a block of systems run together may go whole, and so may all
   * of a page's content); bands: some or all of the page in overlapping bands (its systems could not all be told apart,
   * or some of its content was in no picture); blank: no ink, or nothing that looks like music.
   */
  kind: 'systems' | 'bands' | 'blank';
  cuts: Cut[];
}

/**
 * Without other systems to measure by, bands keep whole every system up to this share of the width of the music: a
 * piano system is about a quarter of it, a system of three staves (a voice and a piano) about two fifths.
 */
export const SYSTEM_SHARE = 0.45;
/** A block up to this share of the width of the music may be one tall system: it is never cut into bands. */
export const ONE_SYSTEM = 0.35;
/** A block is too tall to be one system above this share of the page, or this many times the next tallest block. */
const TALL = 0.5,
  TALLER = 1.8;
/** Bands keep whole every system up to this many times as tall as the page's other systems. */
const SLACK = 1.25;
/** A block goes whole as one system only when the one system its staves show covers more than this share of it. */
const MOSTLY = 0.5;

export function cutPage(mask: Mask): PageCuts {
  const { width: W, height: H, ink } = mask,
    faint = mask.faint ?? ink,
    // The picture's long side: a page's height, or the width of a picture of a few lines cut from a page.
    side = Math.max(W, H);
  // The margin around a cut is wide enough for a stem's tip that is too faint to see in a soft photo (about 2 mm on a
  // page of A4), but reaches at most halfway into a gap.
  const margin = Math.max(2, Math.round(side * 0.02)),
    minGap = Math.max(2, Math.round(side * 0.006));
  // Columns with one long unbroken run of ink (a scanner's dark edge, a photographed page's edge, a frame) are not
  // music: they are left out. Barlines that line up from system to system are music: each of their runs ends in the
  // gap below its system (a break shorter than a gap between blocks does not end a run). So is a barline in a picture
  // of one system, however tightly cropped: it is short beside the width of the music.
  const frame = new Uint8Array(W);
  for (let x = 0; x < W; x++)
    for (let y = 0, start = 0, at = -H; y < H; y++) {
      if (!faint[y * W + x]) continue;
      if (y - at > minGap) start = y;
      at = y;
      if (y + 1 - start > 0.6 * side) {
        frame[x] = 1;
        break;
      }
    }
  let columns = 0,
    left = W,
    right = -1;
  const row = new Uint32Array(H),
    reach = new Uint32Array(H);
  for (let x = 0; x < W; x++) if (!frame[x]) columns++;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (!frame[x]) {
        const at = y * W + x;
        row[y] += ink[at];
        reach[y] += faint[at];
        if (ink[at]) {
          if (x < left) left = x;
          if (x > right) right = x;
        }
      }
  /** The width of the music: from its leftmost ink to its rightmost (a staff's length, on a page of music). */
  const wide = Math.max(1, right - left + 1);
  // A blank row may still hold a few thin vertical lines (barlines crossing the gap between two staves).
  const blankMax = Math.max(1, Math.floor(W * 0.003)),
    inked = (y: number) => row[y] > blankMax;
  let first = -1,
    last = -1;
  for (let y = 0; y < H; y++)
    if (inked(y)) {
      if (first < 0) first = y;
      last = y;
    }
  if (first < 0) return { kind: 'blank', cuts: [] };

  /** The inked columns of rows [y0, y1), widened by the margin, as fractions; undefined when they hold no ink. */
  const across = (y0: number, y1: number): { left: number; right: number } | undefined => {
    let x0 = W,
      x1 = -1;
    for (let y = y0; y < y1; y++)
      for (let x = 0; x < W; x++)
        if (!frame[x] && ink[y * W + x]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
        }
    if (x1 < 0) return undefined;
    return { left: Math.max(0, x0 - margin) / W, right: Math.min(W, x1 + 1 + margin) / W };
  };

  // Blocks: runs of inked rows, split at blank gaps at least minGap tall. [c0, c1) is a block's music, without the
  // small blocks (a title, a page number) that join it later.
  type Block = { y0: number; y1: number; c0: number; c1: number };
  let blocks: Block[] = [];
  const block = (y0: number, y1: number) => blocks.push({ y0, y1, c0: y0, c1: y1 });
  for (let y = first, start = first, blank = 0; y <= last + 1; y++) {
    if (y <= last && inked(y)) {
      if (blank >= minGap) {
        block(start, y - blank);
        start = y;
      }
      blank = 0;
    } else if (y > last) block(start, y - blank);
    else blank++;
  }
  // A gap crossed from edge to edge by a vertical line, even a faint one, is inside one system.
  const crossed = (y0: number, y1: number) => {
    for (let x = 0; x < W; x++) {
      if (frame[x]) continue;
      let hits = 0;
      for (let y = y0; y < y1; y++) {
        const at = y * W + x;
        if (faint[at] || (x > 0 && !frame[x - 1] && faint[at - 1]) || (x + 1 < W && !frame[x + 1] && faint[at + 1]))
          hits++;
      }
      if (hits >= 0.9 * (y1 - y0)) return true;
    }
    return false;
  };
  blocks = blocks.reduce<Block[]>((out, b) => {
    const prev = out[out.length - 1];
    if (prev && crossed(prev.y1, b.y0)) prev.y1 = prev.c1 = b.y1;
    else out.push({ ...b });
    return out;
  }, []);
  // A block mostly of solid ink (a dark edge of a photo, a black bar) is not music.
  blocks = blocks.filter((b) => {
    let n = 0;
    for (let y = b.y0; y < b.y1; y++) n += row[y];
    return n <= 0.5 * columns * (b.y1 - b.y0);
  });
  if (!blocks.length) return { kind: 'blank', cuts: [] };
  const core = (b: Block) => b.c1 - b.c0;
  // A small block (far smaller than the others, and under a twentieth of the page: a line of text, never a system)
  // joins its nearer neighbour (a title, a tempo word), or is left out when it lies below the last system, farther from
  // it than that system is tall or than a tenth of the page (a page number, a footer).
  for (;;) {
    if (blocks.length < 2) break;
    const cores = blocks.map(core).sort((a, b) => a - b),
      median = cores[Math.floor(cores.length / 2)],
      smallest = Math.min(0.35 * median, 0.05 * side);
    let small = -1;
    blocks.forEach((b, i) => {
      if (core(b) < smallest && (small < 0 || core(b) < core(blocks[small]))) small = i;
    });
    if (small < 0) break;
    const b = blocks[small],
      above = small > 0 ? b.y0 - blocks[small - 1].y1 : Infinity,
      below = small < blocks.length - 1 ? blocks[small + 1].y0 - b.y1 : Infinity;
    if (below === Infinity && above > Math.min(core(blocks[small - 1]), 0.1 * side)) {
      blocks.splice(small, 1);
      continue;
    }
    const into = above <= below ? small - 1 : small + 1;
    blocks[into] = { ...blocks[into], y0: Math.min(blocks[into].y0, b.y0), y1: Math.max(blocks[into].y1, b.y1) };
    blocks.splice(small, 1);
  }
  // A block reaches out through rows with any ink at all, faint included (a stem's tip, the end of a slur), up to the
  // middle of a gap; so does its music, where nothing joined it on that side.
  blocks.forEach((b, i) => {
    const up = i === 0 ? 0 : Math.ceil((blocks[i - 1].y1 + b.y0) / 2),
      down = i === blocks.length - 1 ? H : Math.floor((b.y1 + blocks[i + 1].y0) / 2),
      [top, bottom] = [b.c0 === b.y0, b.c1 === b.y1];
    while (b.y0 > up && reach[b.y0 - 1] > 0) b.y0--;
    while (b.y1 < down && reach[b.y1] > 0) b.y1++;
    if (top) b.c0 = b.y0;
    if (bottom) b.c1 = b.y1;
  });

  // One block far taller than the rest, and taller than one system could be, holds systems run together: it alone goes
  // as overlapping bands.
  const order = blocks.map((_, i) => i).sort((a, b) => core(blocks[b]) - core(blocks[a])),
    other = order.length > 1 ? core(blocks[order[1]]) : undefined,
    tall = (b: Block) =>
      core(b) > ONE_SYSTEM * wide && (core(b) > TALL * H || (other !== undefined && core(b) > TALLER * other));
  // What a system measures here: the tallest of the page's other systems, among the blocks of music (at least three
  // rows of staff line, which run across most of the music's width) that the picture's edge does not cut off. A title,
  // a line of text or half a system at the edge of a crop is no measure of a system.
  const staffed = (b: Block) => {
    let lines = 0;
    for (let y = b.c0; y < b.c1; y++) if (reach[y] >= 0.5 * wide && (y === b.c0 || reach[y - 1] < 0.5 * wide)) lines++;
    return lines >= 3;
  };
  const measured = blocks.filter((b, i) => i !== order[0] && b.y0 > 0 && b.y1 < H && staffed(b)),
    system = measured.length ? Math.max(...measured.map(core)) : undefined;

  // The staves of rows [y0, y1), from their lines: a line is a row (or a few) crossed by one unbroken run of ink at
  // least half the width of the music, thin beside the space between lines (a wide bar of ink is no staff line); a
  // staff is three or more lines, each at most a little over two spaces below the one before (one line may be missed).
  // `x` is where the staff's lines start.
  type Staff = { top: number; bottom: number; x: number };
  const staves = (y0: number, y1: number): { list: Staff[]; space: number } => {
    const found: { y0: number; y1: number; x: number }[] = [];
    for (let y = y0; y < y1; y++) {
      if (reach[y] < 0.5 * wide) continue;
      let length = 0,
        at = -1;
      for (let x = 0, start = -1, end = -W; x < W; x++) {
        if (frame[x] || !faint[y * W + x]) continue;
        if (x - end > 3) start = x; // a break of a pixel or two does not end a line
        end = x;
        if (end - start + 1 > length) [length, at] = [end - start + 1, start];
      }
      if (length < 0.5 * wide) continue;
      const line = found[found.length - 1];
      if (line && line.y1 === y) [line.y1, line.x] = [y + 1, Math.min(line.x, at)];
      else found.push({ y0: y, y1: y + 1, x: at });
    }
    if (found.length < 3) return { list: [], space: 0 };
    const steps = found
        .slice(1)
        .map((l, i) => l.y0 - found[i].y0)
        .sort((a, b) => a - b),
      space = steps[Math.floor((steps.length - 1) / 2)],
      list: Staff[] = [];
    let staff: typeof found = [];
    const close = () => {
      const xs = staff.map((l) => l.x).sort((a, b) => a - b);
      if (staff.length >= 3) list.push({ top: staff[0].y0, bottom: staff[staff.length - 1].y1, x: xs[xs.length >> 1] });
      staff = [];
    };
    for (const line of found) {
      if (line.y1 - line.y0 > 0.5 * space) continue;
      if (staff.length && line.y0 - staff[staff.length - 1].y0 > 2.2 * space) close();
      staff.push(line);
    }
    close();
    return { list, space };
  };
  // The systems of a block: its staves, joined where a line, a brace or a bracket at their left end crosses the gap
  // between them (a system of several staves always begins with one). A slur, a hairpin or a crease elsewhere joins
  // nothing here; one that does lies at the left end, and only makes the system it joins look taller.
  const systemsOf = (b: Block): { top: number; bottom: number }[] => {
    const { list, space } = staves(b.c0, b.c1),
      out: { top: number; bottom: number }[] = [];
    list.forEach((s, i) => {
      const above = list[i - 1];
      if (above) {
        const x0 = Math.max(0, Math.min(above.x, s.x) - Math.round(3 * space)),
          x1 = Math.min(W - 1, Math.max(above.x, s.x) + Math.round(2 * space));
        let hits = 0;
        for (let y = above.bottom; y < s.top; y++)
          for (let x = x0; x <= x1; x++)
            if (!frame[x] && faint[y * W + x]) {
              hits++;
              break;
            }
        if (hits >= 0.9 * (s.top - above.bottom)) {
          out[out.length - 1].bottom = s.bottom;
          return;
        }
      }
      out.push({ top: s.top, bottom: s.bottom });
    });
    return out;
  };
  // How far a system's ink reaches outside its staves on this page (stems, ledger lines, words), measured on the
  // systems apart.
  const outside = measured.flatMap((b) => {
      const { list } = staves(b.c0, b.c1);
      return list.length ? [core(b) - (list[list.length - 1].bottom - list[0].top)] : [];
    }),
    reaches = outside.length ? Math.max(...outside) : undefined;
  /**
   * What a tall block's bands must keep whole. Its own systems, found from their staves, may be taller than the page's
   * systems apart (a piano-only intro above systems of a voice and a piano), so the tallest of them counts too: from
   * its first staff line to its last, plus the ink a system apart has outside its staves, and a quarter more, like the
   * systems apart. Without systems apart: the tallest of its systems plus the widest gap between two of them, or
   * SYSTEM_SHARE of the width of the music if that is more; a block that one system found from its staves covers for
   * the most part goes whole.
   */
  const keepFor = (b: Block): number => {
    const found = systemsOf(b),
      tallest = found.length ? Math.max(...found.map((s) => s.bottom - s.top)) : 0;
    if (system !== undefined)
      return SLACK * Math.max(system, found.length && reaches !== undefined ? tallest + reaches : 0);
    // One system that covers most of the block is the block (systems a crease at their left end joins into one): it
    // goes whole. One found among others whose staves could not be found (only the middle system of a photo taken at a
    // slight angle has straight staff lines) is no measure of the block.
    if (found.length === 1 && tallest > MOSTLY * core(b)) return Math.max(SYSTEM_SHARE * wide, core(b));
    const gap = found.length > 1 ? Math.max(...found.slice(1).map((s, i) => s.top - found[i].bottom)) : 0;
    return Math.max(SYSTEM_SHARE * wide, found.length > 1 ? tallest + gap : 0);
  };
  const cuts: Cut[] = [];
  let banded = false;
  blocks.forEach((b, i) => {
    // The margin reaches at most halfway into a gap, so no cut takes ink from its neighbour.
    const top = b.y0 - Math.min(margin, i === 0 ? b.y0 : Math.floor((b.y0 - blocks[i - 1].y1) / 2)),
      bottom = b.y1 + Math.min(margin, i === blocks.length - 1 ? H - b.y1 : Math.floor((blocks[i + 1].y0 - b.y1) / 2));
    // Every stretch of `keep` rows lies wholly in one band: the n bands are as short as that allows, at most two
    // `keep` tall (keepFor says what `keep` is). A block that is not tall, or no taller than two `keep`, goes whole.
    const span = bottom - top,
      keep = tall(b) ? Math.max(1, Math.ceil(keepFor(b))) : span,
      n = tall(b) ? Math.max(1, Math.ceil(span / keep) - 1) : 1,
      band = Math.min(span, Math.ceil((span + keep * (n - 1)) / n)),
      step = n > 1 ? (span - band) / (n - 1) : 0;
    if (n > 1) banded = true;
    for (let k = 0; k < n; k++) {
      const y0 = n > 1 ? Math.floor(top + k * step) : top,
        y1 = k === n - 1 ? bottom : Math.min(bottom, Math.ceil(top + k * step + band)),
        side = n > 1 ? across(y0, y1) : across(b.y0, b.y1);
      if (side) cuts.push({ top: y0 / H, bottom: y1 / H, ...side });
    }
  });
  return cuts.length ? { kind: banded ? 'bands' : 'systems', cuts } : { kind: 'blank', cuts: [] };
}

/** Two levels differ clearly when they are more than this share of the brighter one apart, and at least DIFFER_MIN. */
const DIFFER = 0.4,
  DIFFER_MIN = 32;
const differ = (a: number, b: number) => Math.abs(a - b) > Math.max(DIFFER_MIN, DIFFER * Math.max(a, b));

/** Where a page holds anything: `rows` is 1 for a row of content, `left` and `right` its first and last such column. */
interface Content {
  rows: Uint8Array;
  left: Int32Array;
  right: Int32Array;
}

/**
 * Where the page holds anything at all, whichever way round it is (dark on light, light on dark, on grey), without
 * deciding what is ink. A row holds content when it is not uniform: more than a few of its pixels differ clearly both
 * from the background around them (the middle level of their own tile and of each neighbouring one, so that the edge of
 * a light bar, of a panel or of a page on a table is not content) and from the rest of the row (so that a streak of
 * glare or a rule across the whole row is not either). Columns with one long unbroken run of such pixels (a scanner's
 * dark edge, a frame) are left out, as cutPage leaves them out.
 */
function contentOf(rgba: ArrayLike<number>, width: number, height: number): Content {
  const W = width,
    H = height,
    n = W * H,
    lum = brightness(rgba, n),
    side = Math.max(W, H);
  const tile = Math.max(8, Math.round(Math.min(W, H) / 24)),
    tw = Math.ceil(W / tile),
    th = Math.ceil(H / tile),
    hist = new Uint32Array(tw * th * 256),
    sizes = new Uint32Array(tw * th);
  for (let y = 0; y < H; y++) {
    const row = Math.floor(y / tile) * tw;
    for (let x = 0; x < W; x++) {
      const t = row + Math.floor(x / tile);
      hist[t * 256 + lum[y * W + x]]++;
      sizes[t]++;
    }
  }
  const middle = new Uint8Array(tw * th);
  for (let t = 0; t < tw * th; t++) {
    let seen = 0,
      v = 0;
    for (; v < 255; v++) if ((seen += hist[t * 256 + v]) * 2 >= sizes[t]) break;
    middle[t] = v;
  }
  // The background levels around each tile: its own middle level and its neighbours'.
  const around: number[][] = [];
  for (let ty = 0; ty < th; ty++)
    for (let tx = 0; tx < tw; tx++) {
      const levels = new Set<number>();
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = tx + dx,
            y = ty + dy;
          if (x >= 0 && y >= 0 && x < tw && y < th) levels.add(middle[y * tw + x]);
        }
      around.push([...levels]);
    }
  const stands = new Uint8Array(n);
  for (let y = 0; y < H; y++) {
    const row = Math.floor(y / tile) * tw;
    for (let x = 0; x < W; x++) {
      const v = lum[y * W + x];
      if (around[row + Math.floor(x / tile)].every((m) => differ(v, m))) stands[y * W + x] = 1;
    }
  }
  const minGap = Math.max(2, Math.round(side * 0.006)),
    frame = new Uint8Array(W);
  for (let x = 0; x < W; x++)
    for (let y = 0, start = 0, at = -H; y < H; y++) {
      if (!stands[y * W + x]) continue;
      if (y - at > minGap) start = y;
      at = y;
      if (y + 1 - start > 0.6 * side) {
        frame[x] = 1;
        break;
      }
    }
  const blankMax = Math.max(1, Math.floor(W * 0.003)),
    rows = new Uint8Array(H),
    left = new Int32Array(H).fill(-1),
    right = new Int32Array(H).fill(-1),
    levels = new Uint32Array(256);
  for (let y = 0; y < H; y++) {
    levels.fill(0);
    let size = 0;
    for (let x = 0; x < W; x++)
      if (!frame[x]) {
        levels[lum[y * W + x]]++;
        size++;
      }
    if (!size) continue;
    let seen = 0,
      level = 0;
    for (; level < 255; level++) if ((seen += levels[level]) * 2 >= size) break;
    let standing = 0,
      apart = 0,
      x0 = -1,
      x1 = -1;
    for (let x = 0; x < W; x++) {
      if (frame[x]) continue;
      const i = y * W + x;
      if (stands[i]) {
        standing++;
        if (x0 < 0) x0 = x;
        x1 = x;
      }
      if (differ(lum[i], level)) apart++;
    }
    if (standing > blankMax && apart > blankMax) [rows[y], left[y], right[y]] = [1, x0, x1];
  }
  return { rows, left, right };
}

/**
 * Cut a page from its pixels (inkMask, then cutPage), and leave nothing on it out unseen: every row that holds content
 * (contentOf: whatever its brightness, so this does not depend on which way round the page was read) must lie in some
 * picture. What cutPage leaves out on purpose may stay out: a line of text (under a twentieth of the page) below the last
 * picture, such as a page number or a footer. When any other content lies outside every picture (the ink was misread:
 * light notes on a dark page under a light bar, inside a light frame, on grey), the page goes as overlapping strips over
 * all of its content instead, sized like the bands of a block with nothing to measure a system by: every stretch of
 * SYSTEM_SHARE of the width of the content is whole in one strip.
 */
export function cutPixels(rgba: ArrayLike<number>, width: number, height: number): PageCuts {
  const page = cutPage(inkMask(rgba, width, height)),
    content = contentOf(rgba, width, height),
    W = width,
    H = height,
    side = Math.max(W, H),
    margin = Math.max(2, Math.round(side * 0.02)),
    minGap = Math.max(2, Math.round(side * 0.006));
  // Runs of content rows, split at gaps at least minGap tall.
  const runs: [number, number][] = [];
  for (let y = 0, start = -1, end = -1; y <= H; y++) {
    if (y < H && !content.rows[y]) continue;
    if (start >= 0 && (y === H || y - end - 1 >= minGap)) {
      runs.push([start, end + 1]);
      start = -1;
    }
    if (y < H) {
      if (start < 0) start = y;
      end = y;
    }
  }
  const pictures = page.cuts.map((c) => [Math.round(c.top * H), Math.round(c.bottom * H)]),
    inside = (y: number) => pictures.some(([a, b]) => a <= y && y < b),
    lowest = pictures.length ? Math.max(...pictures.map((p) => p[1])) : H;
  const kept = runs.filter(([a, b]) => !(a >= lowest && b - a < 0.05 * side)),
    missed = kept.some(([a, b]) => {
      for (let y = a; y < b; y++) if (!inside(y)) return true;
      return false;
    });
  if (!missed) return page;

  const columns = (y0: number, y1: number) => {
    let x0 = W,
      x1 = -1;
    for (let y = y0; y < y1; y++)
      if (content.rows[y]) [x0, x1] = [Math.min(x0, content.left[y]), Math.max(x1, content.right[y])];
    return [x0, x1];
  };
  const [x0, x1] = columns(kept[0][0], kept[kept.length - 1][1]),
    top = Math.max(0, kept[0][0] - margin),
    bottom = Math.min(H, kept[kept.length - 1][1] + margin),
    span = bottom - top,
    keep = Math.max(1, Math.ceil(SYSTEM_SHARE * Math.max(1, x1 - x0 + 1))),
    n = Math.max(1, Math.ceil(span / keep) - 1),
    band = Math.min(span, Math.ceil((span + keep * (n - 1)) / n)),
    step = n > 1 ? (span - band) / (n - 1) : 0,
    cuts: Cut[] = [];
  for (let k = 0; k < n; k++) {
    const y0 = Math.floor(top + k * step),
      y1 = k === n - 1 ? bottom : Math.min(bottom, Math.ceil(top + k * step + band)),
      [a, b] = columns(y0, y1);
    if (b >= 0)
      cuts.push({
        top: y0 / H,
        bottom: y1 / H,
        left: Math.max(0, a - margin) / W,
        right: Math.min(W, b + 1 + margin) / W,
      });
  }
  return { kind: cuts.length > 1 ? 'bands' : 'systems', cuts };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (items: string[]) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/**
 * What will be sent, counted: "6 pictures from 2 pages." It speaks of pictures, never of systems, since a picture may
 * hold more than one line of music; a page where some or all of it went as overlapping strips is named, in words true
 * either way. Pages are numbered from 1 across all chosen files; `kept` is how many of a page's pictures the owner has
 * not removed.
 */
export function picturesLine(pages: { page: number; kind: PageCuts['kind']; kept: number }[]): string {
  const used = pages.filter((p) => p.kept > 0),
    pictures = used.reduce((n, p) => n + p.kept, 0),
    banded = used.filter((p) => p.kind === 'bands'),
    blank = pages.filter((p) => p.kind === 'blank').map((p) => `page ${p.page}`);
  const empty = blank.length
    ? ` ${list(blank).replace(/^p/, 'P')} ${blank.length === 1 ? 'looks' : 'look'} empty, so nothing from ${blank.length === 1 ? 'it' : 'them'} will be sent.`
    : '';
  if (!pictures) return `No pictures to send.${empty}`;
  const strips = banded.length
    ? ` On ${banded.length === 1 ? 'page' : 'pages'} ${list(banded.map((p) => String(p.page)))}, lines of music that could not be told apart went as overlapping strips.`
    : '';
  return `${plural(pictures, 'picture')} from ${plural(used.length, 'page')}.${strips}${empty}`;
}

// In the browser: draw a page and cut it.

/** Pages are drawn at most this wide and this large before cutting; a system's picture then needs no enlarging. */
export const PAGE_WIDTH = 2600;
export const PAGE_PIXELS = 12_000_000;
/** The width the cutting looks at: enough to see a staff line, small enough to be quick. */
const ANALYSIS_WIDTH = 1000;

/** The scale that draws a page of this size for cutting (enlarge = a PDF page, which can be drawn at any size). */
export function pageScale(width: number, height: number, enlarge: boolean): number {
  const scale = Math.min(PAGE_WIDTH / width, Math.sqrt(PAGE_PIXELS / (width * height)));
  return enlarge ? scale : Math.min(1, scale);
}

/** A white canvas: transparent pictures would otherwise turn black as JPEG. */
export function paperCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

/** A photo or scan of one page, drawn on white (its orientation taken from the file). */
export async function imagePage(file: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const scale = pageScale(bitmap.width, bitmap.height, false),
      canvas = paperCanvas(bitmap.width * scale, bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

/** Cut a drawn page: where the cuts are, and each one as the JPEG data URL that will be sent. */
export function cutCanvas(page: HTMLCanvasElement): { kind: PageCuts['kind']; pictures: string[] } {
  const w = Math.min(ANALYSIS_WIDTH, page.width),
    h = Math.max(1, Math.round((page.height * w) / page.width)),
    small = paperCanvas(w, h),
    ctx = small.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(page, 0, 0, w, h);
  const { kind, cuts } = cutPixels(ctx.getImageData(0, 0, w, h).data, w, h);
  const pictures = cuts.map((c) => {
    const sx = Math.floor(c.left * page.width),
      sy = Math.floor(c.top * page.height),
      sw = Math.max(1, Math.ceil(c.right * page.width) - sx),
      sh = Math.max(1, Math.ceil(c.bottom * page.height) - sy),
      size = sendSize(sw, sh),
      out = paperCanvas(size.width, size.height),
      octx = out.getContext('2d')!;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(page, sx, sy, sw, sh, 0, 0, size.width, size.height);
    const url = out.toDataURL('image/jpeg', 0.85);
    out.width = out.height = 0;
    return url;
  });
  small.width = small.height = 0;
  return { kind, pictures };
}
