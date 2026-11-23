import { isBlack, noteName, type Hand, type Score } from './score';

/**
 * Comparing two independent readings of the same piece, bar by bar. Used by scripts/piece-check.mjs --diff and by the
 * Pieces page. Agreement never confirms a piece: nothing catches a mistake both readings share.
 */

/** Notes per written bar as "beat:pitch:length:hand" strings (ties merged, so a missing tie shows up), sorted. */
export function barNotes(s: Score): Map<number, string[]> {
  const bars = new Map<number, string[]>();
  for (const n of s.notes) {
    const k = s.bars[n.bar].number;
    bars.set(
      k,
      [...(bars.get(k) ?? []), `${n.tick / s.ppq}:${n.midi}:${+(n.dur / s.ppq).toFixed(3)}:${n.hand}`].sort(),
    );
  }
  return bars;
}

/** Chord symbols (with their beats) and the swing feel per written bar. */
export function barFeel(s: Score): Map<number, string> {
  return new Map(
    s.bars.map((b) => [
      b.number,
      `${b.harmony.map((h) => `${h.symbol}@${h.tick / s.ppq + 1}`).join(' ') || 'no chord symbol'}${b.swing ? ' · swing' : ''}`,
    ]),
  );
}

export interface NoteDiff {
  bar: number;
  onlyA: string[];
  onlyB: string[];
}
/** Every bar number in either reading where the notes differ in pitch, start, length or hand. */
export function diffNotes(a: Map<number, string[]>, b: Map<number, string[]>): { same: number; differ: NoteDiff[] } {
  let same = 0;
  const differ: NoteDiff[] = [];
  for (const bar of [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => x - y)) {
    const x = a.get(bar) ?? [],
      y = b.get(bar) ?? [],
      onlyA = x.filter((v) => !y.includes(v)),
      onlyB = y.filter((v) => !x.includes(v));
    if (!onlyA.length && !onlyB.length && x.length === y.length) same++;
    else differ.push({ bar, onlyA, onlyB });
  }
  return { same, differ };
}

export interface FeelDiff {
  bar: number;
  a: string;
  b: string;
}
/** Bars present in both readings whose chord symbols or swing differ. */
export function diffFeel(a: Map<number, string>, b: Map<number, string>): FeelDiff[] {
  const differ: FeelDiff[] = [];
  for (const [bar, text] of a) if (b.has(bar) && b.get(bar) !== text) differ.push({ bar, a: text, b: b.get(bar)! });
  return differ;
}

export const AGREEMENT_NOTE =
  'Look again at the page for every differing bar; agreement does not prove both are right.';

/** The note comparison as scripts/piece-check.mjs prints it (pinned by tests/piece-compare.test.ts). */
export function noteDiffLines(
  diff: { same: number; differ: NoteDiff[] },
  labelA: string,
  labelB: string,
  name: (midi: number) => string,
): string[] {
  const show = (list: string[]) =>
    list
      .map((v) => {
        const [beat, midi, length, hand] = v.split(':');
        return `${name(Number(midi))}@${Number(beat) + 1} (${length} beats, ${hand})`;
      })
      .join(' ');
  return [
    ...diff.differ.map(
      (d) => `bar ${d.bar}: only in ${labelA}: ${show(d.onlyA) || '-'} | only in ${labelB}: ${show(d.onlyB) || '-'}`,
    ),
    `${diff.same} bars agree on every note's pitch, start, length and hand; ${diff.differ.length} differ. ${AGREEMENT_NOTE}`,
  ];
}

/** The chord and swing comparison as scripts/piece-check.mjs prints it. */
export function feelDiffLines(differ: FeelDiff[], labelA: string, labelB: string): string[] {
  return [
    ...differ.map((d) => `bar ${d.bar} chords/feel: ${labelA}: ${d.a} | ${labelB}: ${d.b}`),
    `${differ.length} bars differ in chord symbols or swing.`,
  ];
}

// The page's comparison: the same facts, in plain words.

export interface HeaderDiff {
  what: string;
  first: string;
  second: string;
}
export interface PageNote {
  /** "E4", or both names of a black key: "C#5/Db5". */
  pitch: string;
  midi: number;
  beat: number;
  beats: number;
  hand: Hand;
}
export interface BarDiff {
  bar: number;
  first: PageNote[];
  second: PageNote[];
  /** The bar is missing from one reading. */
  missing?: 'first' | 'second';
}
export interface ChordDiff {
  bar: number;
  first: string;
  second: string;
}
export interface Comparison {
  header: HeaderDiff[];
  notes: BarDiff[];
  chords: ChordDiff[];
  sameBars: number;
}

const signature = (fifths: number) =>
  fifths === 0
    ? 'no sharps or flats'
    : `${Math.abs(fifths)} ${fifths > 0 ? 'sharp' : 'flat'}${Math.abs(fifths) === 1 ? '' : 's'}`;
const beatsText = (n: number) => `${+n.toFixed(3)} beat${n === 1 ? '' : 's'}`;
const changes = (s: Score, read: (b: Score['bars'][number]) => string) =>
  s.bars
    .filter((b, i) => i > 0 && read(b) !== read(s.bars[i - 1]))
    .map((b) => `bar ${b.number}: ${read(b)}`)
    .join(', ') || 'none';
const pickup = (s: Score) =>
  s.bars[0]?.number === 0 ? `a pickup of ${beatsText(s.bars[0].ticks / s.ppq)}` : 'no pickup';

/** Compare two compiled readings: header facts, then notes per bar, then chord symbols and swing per bar. */
export function compareReadings(a: Score, b: Score): Comparison {
  const header: HeaderDiff[] = [];
  const add = (what: string, first: string, second: string) => {
    if (first !== second) header.push({ what, first, second });
  };
  const key = (bar: Score['bars'][number]) => signature(bar.key),
    time = (bar: Score['bars'][number]) => `${bar.num}/${bar.den}`;
  add('Key signature', a.bars[0] ? key(a.bars[0]) : '-', b.bars[0] ? key(b.bars[0]) : '-');
  add('Time signature', a.bars[0] ? time(a.bars[0]) : '-', b.bars[0] ? time(b.bars[0]) : '-');
  add('Number of bars', String(a.bars.length), String(b.bars.length));
  add('Pickup', pickup(a), pickup(b));
  add('Key signature changes', changes(a, key), changes(b, key));
  add('Time signature changes', changes(a, time), changes(b, time));
  const numbers = (s: Score) => new Set(s.bars.map((bar) => bar.number));
  const inA = numbers(a),
    inB = numbers(b);
  // With the same written bars, a different playing order comes from repeats, endings or jumps.
  const order = (s: Score) => s.playOrder.map((i) => s.bars[i].number),
    pa = order(a),
    pb = order(b);
  if (inA.size === inB.size && [...inA].every((n) => inB.has(n)) && pa.join() !== pb.join()) {
    let i = 0;
    while (pa[i] === pb[i]) i++;
    const where = (p: number[]) =>
      `${p.length} bars played, ${i === 0 ? `starting with bar ${p[0]}` : `and after bar ${p[i - 1]} ${p[i] === undefined ? 'it stops' : `it plays bar ${p[i]}`}`}`;
    add('Repeats, endings and jumps', where(pa), where(pb));
  }
  // A black key is named both ways: the reading only knows the pitch, and the page may print either name.
  const spell = (midi: number) => (isBlack(midi) ? `${noteName(midi, 1)}/${noteName(midi, -1)}` : noteName(midi));
  const words = (list: string[]): PageNote[] =>
    list
      .map((v) => {
        const [beat, midi, length, hand] = v.split(':');
        return {
          pitch: spell(Number(midi)),
          midi: Number(midi),
          beat: Number(beat) + 1,
          beats: Number(length),
          hand: hand as Hand,
        };
      })
      .sort((x, y) => x.beat - y.beat || x.midi - y.midi);
  const diff = diffNotes(barNotes(a), barNotes(b));
  const notes: BarDiff[] = diff.differ.map((d) => ({
    bar: d.bar,
    first: words(d.onlyA),
    second: words(d.onlyB),
    missing: !inA.has(d.bar) ? 'first' : !inB.has(d.bar) ? 'second' : undefined,
  }));
  // Bars that exist in one reading only but hold no notes still differ.
  for (const number of [...inA, ...inB])
    if ((!inA.has(number) || !inB.has(number)) && !notes.some((n) => n.bar === number))
      notes.push({ bar: number, first: [], second: [], missing: inA.has(number) ? 'second' : 'first' });
  notes.sort((x, y) => x.bar - y.bar);

  const chordText = (s: Score, number: number) => {
    const bar = s.bars.find((x) => x.number === number)!;
    const symbols = bar.harmony.map((h) => `${h.symbol} on beat ${+(h.tick / s.ppq + 1).toFixed(3)}`).join(', ');
    return `${symbols || 'no chord symbol'}${bar.swing ? ', swing' : ''}`;
  };
  const chords = diffFeel(barFeel(a), barFeel(b)).map((d) => ({
    bar: d.bar,
    first: chordText(a, d.bar),
    second: chordText(b, d.bar),
  }));
  return { header, notes, chords, sameBars: diff.same };
}

const handName = (hand: Hand) => (hand === 'R' ? 'right hand' : 'left hand');
/** "F#4 on beat 2.5 (0.5 beats, right hand)", with plain # and b so that any chat reads it. */
export const noteWords = (n: PageNote) =>
  `${n.pitch.replace(/♯/g, '#').replace(/♭/g, 'b')} on beat ${+n.beat.toFixed(3)} (${beatsText(n.beats)}, ${handName(n.hand)})`;

/** One plain sentence per difference, in the page's order. */
export function comparisonLines(c: Comparison): string[] {
  const list = (notes: PageNote[]) => notes.map(noteWords).join('; ');
  const bar = (d: BarDiff) =>
    d.missing
      ? `Bar ${d.bar} is only in the ${d.missing === 'first' ? 'second' : 'first'} reading.`
      : !d.second.length
        ? `Bar ${d.bar}: only the first reading has ${list(d.first)}.`
        : !d.first.length
          ? `Bar ${d.bar}: only the second reading has ${list(d.second)}.`
          : `Bar ${d.bar}: only the first reading has ${list(d.first)}; only the second has ${list(d.second)}.`;
  return [
    ...c.header.map((h) => `${h.what}: the first reading has ${h.first}; the second has ${h.second}.`),
    ...c.notes.map(bar),
    ...c.chords.map(
      (d) => `Bar ${d.bar}, chord symbols and swing: the first reading has ${d.first}; the second has ${d.second}.`,
    ),
  ];
}

/** Whether the two readings agree on everything compared. */
export const agree = (c: Comparison) => !c.header.length && !c.notes.length && !c.chords.length;

/** How many differences the paste-back message lists before it only counts the rest. */
export const DIFF_MESSAGE_LIMIT = 60;

/** The message the owner pastes back into an AI chat: the differing bars and a request for the whole corrected file. */
export function differencesMessage(c: Comparison): string {
  const lines = comparisonLines(c),
    shown = lines.slice(0, DIFF_MESSAGE_LIMIT),
    rest = lines.length - shown.length;
  return [
    'Two independent readings of this piece disagree in these places. Beats count quarter notes from 1 at the start of the bar.',
    '',
    ...shown.map((line) => `- ${line}`),
    ...(rest ? [`- And ${rest} more difference${rest === 1 ? '' : 's'} after these.`] : []),
    '',
    'For each of these bars, look at the page again and read what is printed there; do not decide by which reading seems more likely. Then send the whole corrected piece file again in one code block (or in parts of at most about 40 bars as before, each part in one code block), with the same header lines and pitch-mode as before.',
  ].join('\n');
}
