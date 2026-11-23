import { describe, expect, it } from 'vitest';
import { compile } from '../src/piece/notation';
import { noChord, parseChord, QUALITIES } from '../src/piece/analysis';
import { noteName, PPQ, type Score } from '../src/piece/score';
import { checkAnswer } from '../src/piece/import';
import {
  CHORD_ALIASES,
  CHORD_SUFFIXES,
  exampleTune,
  importGuide,
  MARKS,
  READING_MODE,
  structureExample,
  TOKENS,
} from '../src/piece/import-guide';

// The guide is what an AI that has never seen this repo works from. These tests hold it to the compiler.

const fences = (text: string) => [...text.matchAll(/^```[a-z]*\n([\s\S]*?)^```$/gm)].map((m) => m[1]);
const spans = (text: string) =>
  [...text.replace(/^```[a-z]*\n[\s\S]*?^```$/gm, '').matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
const clean = (text: string): Score => {
  const { score, diagnostics } = compile(text);
  expect(diagnostics).toEqual([]);
  return score!;
};
const head = (time = '4/4', key = '0', voices = 'rh@1:R lh@2:L') =>
  `title: t\npitch-mode: sounding\nkey: ${key}\ntime: ${time}\nvoices: ${voices}\n`;
const order = (s: Score) => s.playOrder.map((i) => s.bars[i].number);

describe('the instructions for an AI', () => {
  it('are short enough to paste into a chat and name the right pitch mode for each reading', () => {
    for (const reading of ['first', 'second'] as const) {
      const text = importGuide(reading);
      expect(text.length).toBeLessThan(10000);
      expect(text).toContain(`pitch-mode: ${READING_MODE[reading]}`);
      expect(text).not.toContain(`pitch-mode: ${READING_MODE[reading === 'first' ? 'second' : 'first']}\n`);
    }
    expect(importGuide('second')).toMatch(/fresh chat/);
    // The same guide with a different opening: everything after the first paragraph matches once the mode is swapped.
    const body = (reading: 'first' | 'second') =>
      importGuide(reading).split('\n\n').slice(1).join('\n\n').replaceAll(`pitch-mode: ${READING_MODE[reading]}`, 'M');
    expect(body('second')).toBe(body('first'));
  });

  it('compile: every code example, both modes, with no diagnostics; the header template with bars added', () => {
    for (const reading of ['first', 'second'] as const) {
      const blocks = fences(importGuide(reading));
      expect(blocks.length).toBe(3);
      for (const block of blocks) {
        if (/^==\s*\d/m.test(block)) clean(block);
        else {
          // The header lines alone: add bars 1 to 8 (the template's section names them) and nothing may be reported.
          const bars = Array.from({ length: 8 }, (_, i) => `== ${i + 1}\nrh: R\nlh: R\n`).join('');
          const score = clean(block + bars);
          expect(score.key).toBe(2);
          expect(score.sections).toHaveLength(1);
        }
      }
    }
  });

  it('use an original example with two hands, a chord, a tie, a rest, a dotted note and an accidental, the same in both modes', () => {
    const printed = clean(exampleTune('printed')),
      sounding = clean(exampleTune('sounding'));
    expect(sounding.notes).toEqual(printed.notes);
    const s = printed;
    expect(new Set(s.notes.map((n) => n.hand))).toEqual(new Set(['L', 'R']));
    expect(s.bars).toHaveLength(4);
    const at = (bar: number, tick: number) => s.notes.filter((n) => s.bars[n.bar].number === bar && n.tick === tick);
    expect(at(1, PPQ * 2).filter((n) => n.hand === 'L')).toHaveLength(2); // chord
    expect(s.notes.find((n) => noteName(n.midi) === 'D5' && s.bars[n.bar].number === 3)!.dur).toBe(PPQ * 2.5); // tie
    expect(s.notes.find((n) => n.midi === 66)).toBeDefined(); // F sharp
    expect(s.notes.find((n) => n.finger)?.finger).toBe(1); // fingering
    expect(s.notes.some((n) => n.dur === PPQ * 1.5)).toBe(true); // dotted quarter
    expect(clean(exampleTune('printed')).meta.redistributable).toBe(false);
    expect(compile(exampleTune('printed')).score!.meta.verified).toBe('checks'); // written as none, compiled as checks
    const repeat = clean(structureExample('sounding'));
    expect(order(repeat)).toEqual([0, 1, 2, 1, 3, 4]);
    expect(repeat.bars[0].ticks).toBe(PPQ);
    expect(repeat.bars[4].ticks).toBe(PPQ * 2);
  });

  it('document only tokens that the tests below exercise', () => {
    const documented = new Set<string>([
      ...Object.values(TOKENS).flat(),
      ...Object.keys(MARKS).map((m) => `mark: ${m}`),
      'mark: ...',
      '%',
      '== N',
    ]);
    for (const reading of ['first', 'second'] as const)
      for (const span of spans(importGuide(reading))) expect(documented, span).toContain(span);
  });

  it('list exactly the chord symbols the analysis knows', () => {
    expect(new Set<string>(CHORD_SUFFIXES)).toEqual(new Set(Object.keys(QUALITIES)));
    for (const suffix of [...CHORD_SUFFIXES, ...CHORD_ALIASES]) {
      expect(parseChord(`C${suffix}`), suffix).toBeDefined();
      expect(parseChord(`F#${suffix}/A`), suffix).toBeDefined();
      expect(parseChord(`Bb${suffix}`), suffix).toBeDefined();
    }
    expect(parseChord('Cmaj7#11')).toBeUndefined();
  });
});

describe('every token the guide documents compiles as the guide says', () => {
  it('pitches, accidentals, octaves and the piano range', () => {
    const midi = (p: string) => clean(`${head()}== 1 partial\nrh: ${p}:4\n`).notes[0].midi;
    expect(TOKENS.pitches.map(midi)).toEqual([60, 66, 58, 76, 62, 60]);
    expect(midi('c##4')).toBe(62);
    expect(midi('b3')).toBe(59);
    expect(midi('a0')).toBe(21);
    expect(midi('c8')).toBe(108);
    expect(compile(`${head()}== 1 partial\nrh: g#0:4\n`).score).toBeUndefined();
    expect(compile(`${head()}== 1 partial\nrh: c#8:4\n`).score).toBeUndefined();
  });

  it('durations, dots and that every note needs its own duration', () => {
    const beats = (t: string) => clean(`${head()}== 1 partial\nrh: ${t}\n`).notes[0].dur / PPQ;
    expect(TOKENS.dotted.map(beats)).toEqual([1.5, 3.5]);
    expect(['c4:1', 'c4:2', 'c4:4', 'c4:8', 'c4:16', 'c4:32', 'c4:64'].map(beats)).toEqual([
      4, 2, 1, 0.5, 0.25, 0.125, 0.0625,
    ]);
    expect(compile(`${head()}== 1 partial\nrh: c4:4 d4\n`).diagnostics[0].message).toContain('needs a duration');
  });

  it('ties merge across the barline, in chords for one note or all', () => {
    const tie = clean(`${head('2/4')}== 1\nrh: ${TOKENS.tie}\n== 2\nrh: g4:2\n`);
    expect(tie.notes.map((n) => n.dur / PPQ)).toEqual([4]);
    const one = clean(`${head()}== 1\nrh: ${TOKENS.chordTieOne} <c4 e4 g4>:2\n`);
    expect(one.notes.map((n) => `${noteName(n.midi)}/${n.dur / PPQ}`).sort()).toEqual(
      ['C4/4', 'E4/2', 'E4/2', 'G4/2', 'G4/2'].sort(),
    );
    const all = clean(`${head()}== 1\nrh: ${TOKENS.chordTieAll} <c4 e4 g4>:2\n`);
    expect(all.notes.map((n) => n.dur / PPQ)).toEqual([4, 4, 4]);
    const chord = clean(`${head()}== 1\nrh: ${TOKENS.chord} r:2\n`);
    expect(chord.notes.map((n) => n.tick)).toEqual([0, 0, 0]);
  });

  it('rests, spacers, whole-bar rests and fingering', () => {
    const s = clean(
      `${head()}== 1\nrh: ${TOKENS.rest} ${TOKENS.finger} ${TOKENS.spacer} c4:4\nlh: ${TOKENS.barRest}\n== 2\nrh: ${TOKENS.fingerChord} r:2\nlh: R\n`,
    );
    expect(s.notes.filter((n) => n.bar === 0).map((n) => [n.tick / PPQ, n.finger])).toEqual([
      [1, 2],
      [3, undefined],
    ]);
    expect(s.notes.filter((n) => n.bar === 1).map((n) => n.finger)).toEqual([1, 3, 5]);
    expect(s.notes.some((n) => n.hand === 'L')).toBe(false);
  });

  it('tuplets, grace notes and a hand override', () => {
    const s = clean(`${head()}== 1\nrh: ${TOKENS.tuplet} ${TOKENS.grace} r:2\n${TOKENS.hand}\n`);
    const rh = s.notes.filter((n) => n.voice === 'rh');
    expect(rh.map((n) => n.dur)).toEqual([PPQ / 3, PPQ / 3, PPQ / 3, PPQ]);
    expect(rh.map((n) => noteName(n.midi))).toEqual(['C5', 'D5', 'E5', 'C5']); // the grace D5 is not played
    expect(s.notes.find((n) => n.voice === 'lh')!.hand).toBe('R');
  });

  it('pickup and partial bars, metre and key changes, swing and straight', () => {
    const s = clean(
      `${head('3/4')}${TOKENS.pickup}\nrh: c4:4\n== 1\nrh: c4:2.\n${TOKENS.change.replace('9', '2')}\nrh: bb3:2\n${TOKENS.swing.replace('17', '3')}\nrh: c4:8 d4:8 e4:4\n${TOKENS.straight.replace('25', '4')}\nrh: c4:2\n${TOKENS.partial.replace('12', '5')}\nrh: c4:4\n`,
    );
    expect(s.bars.map((b) => [b.number, b.ticks / PPQ, `${b.num}/${b.den}`, b.key, Boolean(b.swing)])).toEqual([
      [0, 1, '3/4', 0, false],
      [1, 3, '3/4', 0, false],
      [2, 2, '2/4', -1, false],
      [3, 2, '2/4', -1, true],
      [4, 2, '2/4', -1, false],
      [5, 1, '2/4', -1, false],
    ]);
    for (const option of [TOKENS.pickup, TOKENS.partial, TOKENS.change, TOKENS.swing, TOKENS.straight])
      expect(/^==\s*\d+/.test(option)).toBe(true);
  });

  it('chord symbols with beat offsets, and no chord', () => {
    const s = clean(`${head()}== 1\n${TOKENS.harmony}\nrh: c4:1\n== 2\n${TOKENS.noChord}\nrh: R\n`);
    expect(s.bars[0].harmony).toEqual([
      { tick: 0, symbol: 'C' },
      { tick: 2 * PPQ, symbol: 'G/B' },
    ]);
    expect(s.bars[0].harmony.every((h) => parseChord(h.symbol))).toBe(true);
    expect(noChord(s.bars[1].harmony[0].symbol)).toBe(true);
  });

  it('repeats, endings and the jump marks give the play order the guide describes', () => {
    const bar = (n: number, extra = '') => `== ${n}\n${extra}rh: c4:1\n`;
    const [first, second, both] = TOKENS.endings;
    // |: before bar 2, first ending bar 3, :| after it, second ending bar 4, ] so that bar 5 is in no ending.
    const repeats = clean(
      `${head()}${bar(1)}${TOKENS.repeatStart}\n${bar(2)}${first}\n${bar(3)}${TOKENS.repeatEnd}\n${second}\n${bar(4)}${TOKENS.endingsClose}\n${bar(5)}`,
    );
    expect(order(repeats)).toEqual([1, 2, 3, 2, 4, 5]);
    expect(repeats.bars.map((b) => b.ending ?? null)).toEqual([null, null, [1], [2], null]);
    const thrice = clean(`${head()}${TOKENS.repeatStart}\n${bar(1)}${TOKENS.repeatThree}\n${bar(2)}`);
    expect(order(thrice)).toEqual([1, 1, 1, 2]);
    const toStart = clean(`${head()}${bar(1)}${bar(2)}${TOKENS.repeatEnd}\n${bar(3)}`);
    expect(order(toStart)).toEqual([1, 2, 1, 2, 3]); // no |: needed to repeat from the beginning
    const shared = clean(
      `${head()}${TOKENS.repeatStart}\n${bar(1)}${both}\n${bar(2)}${TOKENS.repeatThree}\n[3\n${bar(3)}`,
    );
    expect(order(shared)).toEqual([1, 2, 1, 2, 1, 3]);
    const mark = (m: keyof typeof MARKS) => `mark: ${m}\n`;
    const dc = clean(`${head()}${bar(1)}${bar(2, mark('fine'))}${bar(3, mark('dc'))}`);
    expect(order(dc)).toEqual([1, 2, 3, 1, 2]);
    const ds = clean(
      `${head()}${bar(1)}${bar(2, mark('segno'))}${bar(3, mark('tocoda'))}${bar(4, mark('ds'))}${bar(5, mark('coda'))}`,
    );
    expect(order(ds)).toEqual([1, 2, 3, 4, 2, 3, 5]);
  });

  it('section lines and unsure comments', () => {
    const s = clean(
      `${head()}section: A 1-2 "The tune, then its answer."\n== 1\nrh: c4:1\n${TOKENS.unsure}\n== 2\nrh: d4:1\n`,
    );
    expect(s.sections).toEqual([{ name: 'A', from: 0, to: 1, note: 'The tune, then its answer.' }]);
    const checked = checkAnswer(`${head()}== 1\nrh: c4:1\n${TOKENS.unsure}\n== 2\nrh: d4:1\n`);
    expect(checked.unsure).toEqual([{ line: 8, note: 'bar 12: the left-hand chord could be A or C' }]);
  });
});

describe('what the guide claims about the music, checked against the compiler', () => {
  const guide = importGuide('first');
  const line = (start: string) => guide.split('\n').find((l) => l.startsWith(start)) ?? '';
  const midiOf = (name: string) =>
    compile(`title: t\npitch-mode: sounding\ntime: 1/4\nvoices: rh@1:R\n== 1\nrh: ${name.toLowerCase()}:4\n`).score
      ?.notes[0].midi;
  // Staff positions from first principles: a step is one letter; the G clef's second line is G4, the F clef's fourth F3.
  const LETTERS = 'CDEFGAB';
  const step = (name: string) => Number(name[1]) * 7 + LETTERS.indexOf(name[0]);
  const named = (n: number) => `${LETTERS[((n % 7) + 7) % 7]}${Math.floor(n / 7)}`;
  const staff = (bottom: number) => ({
    lines: [0, 2, 4, 6, 8].map((k) => named(bottom + k)),
    spaces: [1, 3, 5, 7].map((k) => named(bottom + k)),
    below: [-2, -4, -6].map((k) => named(bottom + k)),
    belowSpaces: [-1, -3, -5].map((k) => named(bottom + k)),
    above: [10, 12, 14].map((k) => named(bottom + k)),
    aboveSpaces: [9, 11, 13].map((k) => named(bottom + k)),
  });
  const treble = staff(step('G4') - 2),
    bass = staff(step('F3') - 6);

  it('states the staff table exactly as the clefs give it, with names the compiler reads to the right pitches', () => {
    expect(guide).toContain(
      `- Treble clef lines, bottom to top: ${treble.lines.join(' ')}. Spaces: ${treble.spaces.join(' ')}.`,
    );
    expect(guide).toContain(`- Bass clef lines: ${bass.lines.join(' ')}. Spaces: ${bass.spaces.join(' ')}.`);
    for (const [clef, s] of [
      ['Treble', treble],
      ['Bass', bass],
    ] as const)
      expect(guide).toContain(
        `- ${clef} ledger lines below: ${s.below.join(', ')} (${clef === 'Treble' ? 'spaces under the staff and between them' : 'spaces'}: ${s.belowSpaces.join(', ')}). Above: ${s.above.join(', ')} (spaces: ${s.aboveSpaces.join(', ')}).`,
      );
    // Every name in the table, read by the compiler, rises with its staff position.
    for (const s of [treble, bass]) {
      const names = [...s.below.reverse(), ...s.belowSpaces, ...s.lines, ...s.spaces, ...s.aboveSpaces, ...s.above];
      const ordered = names.sort((a, b) => step(a) - step(b)).map(midiOf);
      expect(ordered.every((m, i) => m !== undefined && (i === 0 || m > ordered[i - 1]!))).toBe(true);
    }
    expect(midiOf('C4')).toBe(60);
  });

  it('states the piano range the compiler accepts', () => {
    const [, low, high] = /Range (\w+) to (\w+)\./.exec(guide)!;
    expect([midiOf(low), midiOf(high)]).toEqual([21, 108]);
    const outside = (midi: number) =>
      compile(`title: t\npitch-mode: sounding\ntime: 1/4\nvoices: rh@1:R\n== 1\nrh: ${midi < 21 ? 'g#0' : 'c#8'}:4\n`)
        .score;
    expect(outside(20)).toBeUndefined();
    expect(outside(109)).toBeUndefined();
  });

  it('says never to use R in a pickup or partial bar, because R fills the whole metre there', () => {
    expect(line(`- Pickup bar: \`${TOKENS.pickup}\``)).toMatch(
      /In these two, never use R; write rests with their real length\./,
    );
    const pickup = (lh: string) =>
      compile(
        `title: t\npitch-mode: sounding\ntime: 3/4\nvoices: rh@1:R lh@2:L\n== 0\nrh: g4:4\nlh: ${lh}\n== 1\nrh: c5:2.\nlh: R\n`,
      ).score!.bars[0].ticks / PPQ;
    expect(pickup('r:4')).toBe(1);
    expect(pickup('R')).toBe(3);
  });

  it('says how ties carry accidentals in each mode, as the compiler does', () => {
    expect(line('- sounding:')).toContain('on every note (also after a tie)');
    expect(line('- printed:')).toContain('carries it through a tie');
    const tie = (mode: string, second: string) =>
      compile(
        `title: t\npitch-mode: ${mode}\nkey: 0\ntime: 2/4\nvoices: rh@1:R\n== 1\nrh: f#4:2~\n== 2\nrh: ${second}:2\n`,
      );
    expect(tie('sounding', 'f4').diagnostics.some((d) => d.message.includes('does not continue'))).toBe(true);
    expect(tie('sounding', 'f#4').score!.notes.map((n) => n.dur / PPQ)).toEqual([4]);
    expect(tie('printed', 'f4').score!.notes.map((n) => [n.midi, n.dur / PPQ])).toEqual([[66, 4]]);
  });

  it('a voice that moves to the other staff, and tuplets of any ratio', () => {
    const s = clean(
      `title: t\npitch-mode: sounding\ntime: 4/4\nvoices: rh@1:R lh@2:L ${TOKENS.crossStaff}\n== 1\nrh: c5:1\nlh: R\nlh2: c4:1\n== 2\nrh: c5:1\nlh: c3:1\nlh2: R\n`,
    );
    expect(s.notes.find((n) => n.voice === 'lh2')).toMatchObject({ staff: 1, hand: 'L' });
    const ratios = /Any ratio works \(([^)]+)\)/.exec(guide)![1].split(', ');
    expect(ratios.length).toBeGreaterThan(2);
    for (const ratio of ratios) {
      const [n, m] = ratio.split(':').map(Number);
      const group = `${n}:${m}{ ${Array.from({ length: n }, () => 'c5:8').join(' ')} }`;
      clean(`title: t\npitch-mode: sounding\ntime: ${m}/8\nvoices: rh@1:R\n== 1\nrh: ${group}\n`);
    }
  });
});
