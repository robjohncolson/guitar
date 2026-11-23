import { describe, expect, it } from 'vitest';
import { compile } from '../src/piece/notation';
import { PPQ } from '../src/piece/score';

// A tuplet fills exactly the time it states, also when its notes do not divide into whole ticks (PPQ = 480).
const piece = (time: string, rh: string) =>
  `title: t\npitch-mode: sounding\ntime: ${time}\nvoices: rh@1:R\n== 1\nrh: ${rh}\n== 2\nrh: ${rh}\n`;
const notes = (n: number, d: string) =>
  Array.from({ length: n }, (_, i) => `${'cdefgab'[i % 7]}${4 + Math.floor(i / 7)}:${d}`).join(' ');

describe('tuplets fill exactly the time they state', () => {
  const cases: [number, number][] = [
    [7, 4],
    [7, 8],
    [9, 8],
    [11, 8],
    [5, 4],
    [6, 4],
    [3, 2],
  ];
  for (const [unit, ticks] of [
    ['8', PPQ / 2],
    ['4', PPQ],
  ] as const)
    for (const [n, m] of cases)
      it(`${n}:${m} in ${unit === '8' ? 'eighths' : 'quarters'}`, () => {
        // One group fills the bar: m units long.
        const time = `${(m * ticks) / PPQ}/4`;
        const { score, diagnostics } = compile(piece(time, `${n}:${m}{ ${notes(n, unit)} }`));
        expect(diagnostics).toEqual([]);
        for (const bar of score!.bars) {
          const inBar = score!.notes.filter((x) => x.bar === bar.index);
          expect(inBar).toHaveLength(n);
          expect(inBar[0].tick).toBe(0);
          inBar.forEach((x, i) => {
            if (i) expect(x.tick).toBe(inBar[i - 1].tick + inBar[i - 1].dur);
            // Each note within one tick of its exact length.
            expect(Math.abs(x.dur - (ticks * m) / n)).toBeLessThan(1);
          });
          expect(inBar[n - 1].tick + inBar[n - 1].dur).toBe(bar.ticks);
        }
        expect(score!.bars[1].start).toBe(m * ticks);
      });

  it('keeps the exact ticks of tuplets that divide evenly', () => {
    const s = compile(piece('2/4', '3:2{ c5:8 d5:8 e5:8 } 5:4{ c5:16 d5:16 e5:16 f5:16 g5:16 }')).score!;
    expect(s.notes.filter((x) => x.bar === 0).map((x) => [x.tick, x.dur])).toEqual([
      [0, 160],
      [160, 160],
      [320, 160],
      [480, 96],
      [576, 96],
      [672, 96],
      [768, 96],
      [864, 96],
    ]);
  });

  it('a triplet nested in a triplet', () => {
    const group = '3:2{ c5:8 3:2{ d5:16 e5:16 f5:16 } g5:8 }';
    const { score, diagnostics } = compile(piece('4/4', `${group} ${group} ${group} ${group}`));
    expect(diagnostics).toEqual([]);
    const bar = score!.notes.filter((x) => x.bar === 0);
    expect(bar).toHaveLength(20);
    expect(bar.map((x) => x.tick).filter((t, i) => i % 5 === 0)).toEqual([0, 480, 960, 1440]);
    expect(bar[19].tick + bar[19].dur).toBe(4 * PPQ);
  });

  it('keeps today’s ticks where per-note rounding already adds up', () => {
    // 7:4 of a sixteenth, a dotted eighth, a dotted quarter and a quarter: rounded one by one the notes add up to the
    // stated time, so this compiled before and keeps exactly the ticks it had (275, not 274).
    const s = compile(piece('2/4', '7:4{ c5:16 d5:8. e5:4. f5:4 }')).score!;
    expect(s.notes.filter((x) => x.bar === 0).map((x) => [x.tick, x.dur])).toEqual([
      [0, 69],
      [69, 206],
      [275, 411],
      [686, 274],
    ]);
  });

  it('a bar that is really one sixteenth short still fails, with the same message as before', () => {
    const plain = compile(piece('4/4', 'c5:4 c5:4 c5:4 c5:8 c5:16'));
    expect(plain.score).toBeUndefined();
    expect(plain.diagnostics[0].message).toBe('Voice rh fills 3.75 of 4 beats in bar 1.');
    const septuplet = compile(piece('4/4', `7:4{ ${notes(7, '8')} } c5:4 c5:8 c5:16`));
    expect(septuplet.score).toBeUndefined();
    expect(septuplet.diagnostics[0].message).toMatch(/^Voice rh fills 3\.7\d* of 4 beats in bar 1\.$/);
    const long = compile(piece('4/4', `7:4{ ${notes(7, '8')} } c5:2 c5:16`));
    expect(long.score).toBeUndefined();
  });

  it('a pickup that per-note rounding would make longer than its bar is placed exactly', () => {
    // 1/4 time: seven sixteenths in the time of four, rounded one by one, come to 483 ticks of a 480-tick bar.
    const pickup = (rh: string) =>
      compile(`title: t\npitch-mode: sounding\ntime: 1/4\nvoices: rh@1:R\n== 0\nrh: ${rh}\n== 1\nrh: c5:4\n`);
    const { score, diagnostics } = pickup(`7:4{ ${notes(7, '16')} }`);
    expect(diagnostics).toEqual([]);
    expect(score!.bars[0].ticks).toBe(PPQ);
    const first = score!.notes.filter((x) => x.bar === 0);
    expect(first[6].tick + first[6].dur).toBe(PPQ);
    expect(score!.bars[1].start).toBe(PPQ);
    // With a whole-bar rest after the septuplet the voice still ends with the metre.
    const withR = pickup(`7:4{ ${notes(7, '16')} } R`);
    expect(withR.diagnostics).toEqual([]);
    expect(withR.score!.bars[0].ticks).toBe(PPQ);
  });

  it('a whole-bar rest never hides a tuplet that really overfills the bar', () => {
    for (const bar of ['== 1', '== 0'])
      expect(
        compile(`title: t\npitch-mode: sounding\ntime: 1/4\nvoices: rh@1:R\n${bar}\nrh: 7:4{ ${notes(7, '8')} } R\n`)
          .score,
      ).toBeUndefined();
  });

  it('a partial bar with a septuplet is as long as the septuplet', () => {
    const s = compile(
      `title: t\npitch-mode: sounding\ntime: 4/4\nvoices: rh@1:R\n== 0\nrh: 7:4{ ${notes(7, '16')} }\n== 1\nrh: c5:1\n`,
    ).score!;
    // Rounded one by one the notes give 483 ticks, which a partial bar accepts, so that is what it keeps.
    expect(s.bars[0].ticks).toBe(483);
  });
});
