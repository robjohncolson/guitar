import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compile } from '../src/piece/notation';
import { noteName, type Score } from '../src/piece/score';
import {
  AGREEMENT_NOTE,
  agree,
  barFeel,
  barNotes,
  compareReadings,
  comparisonLines,
  diffFeel,
  diffNotes,
  differencesMessage,
  feelDiffLines,
  noteDiffLines,
} from '../src/piece/compare';
import { exampleTune } from '../src/piece/import-guide';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixture = (name: string) => readFileSync(new URL(`./fixtures/piece-diff/${name}`, import.meta.url), 'utf8');
const lf = (text: string) => text.replace(/\r\n/g, '\n');
const score = (text: string): Score => {
  const { score } = compile(text);
  expect(score).toBeDefined();
  return score!;
};

describe('piece-check --diff', () => {
  // expected.txt is the output of scripts/piece-check.mjs before the comparison moved to src/piece/compare.ts.
  const first = 'tests/fixtures/piece-diff/first.piece.txt',
    second = 'tests/fixtures/piece-diff/second.piece.txt';

  it('prints exactly what it printed before the comparison moved into a shared module', () => {
    const out = execFileSync(process.execPath, ['scripts/piece-check.mjs', first, '--diff', second], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(lf(out)).toBe(lf(fixture('expected.txt')));
  });

  it('builds the same lines from the module directly', () => {
    const a = score(fixture('first.piece.txt')),
      b = score(fixture('second.piece.txt'));
    const lines = [
      ...noteDiffLines(diffNotes(barNotes(a), barNotes(b)), first, second, (m) => noteName(m, a.key)),
      ...feelDiffLines(diffFeel(barFeel(a), barFeel(b)), 'first', 'second'),
    ];
    // The script also prints a summary line and the second file's warning first.
    expect(lf(fixture('expected.txt')).trim().split('\n').slice(2)).toEqual(lines);
  });
});

describe('comparing two readings on the page', () => {
  const tune = exampleTune('printed');

  it('lists exactly the bars that differ in one note and one chord symbol', () => {
    const other = exampleTune('sounding')
      .replace('rh: e5:4 c5:4 f#4:4 a4:4', 'rh: e5:4 c5:4 f4:4 a4:4')
      .replace('harmony: G7', 'harmony: G');
    const c = compareReadings(score(tune), score(other));
    expect(c.header).toEqual([]);
    expect(c.notes.map((d) => d.bar)).toEqual([2]);
    expect(c.chords.map((d) => d.bar)).toEqual([3]);
    expect(comparisonLines(c)).toEqual([
      'Bar 2: only the first reading has F#4/Gb4 on beat 3 (1 beat, right hand); only the second has F4 on beat 3 (1 beat, right hand).',
      'Bar 3, chord symbols and swing: the first reading has G7 on beat 1; the second has G on beat 1.',
    ]);
    expect(c.sameBars).toBe(3);
    expect(agree(c)).toBe(false);
  });

  it('agrees when nothing differs, and never treats agreement as a check', () => {
    const c = compareReadings(score(tune), score(exampleTune('sounding')));
    expect(agree(c)).toBe(true);
    expect(comparisonLines(c)).toEqual([]);
    expect(AGREEMENT_NOTE).toContain('agreement does not prove both are right');
  });

  it('puts header disagreements first: key and time signature, number of bars, pickup', () => {
    const other = tune
      .replace('key: 0', 'key: 1#')
      .replace('time: 4/4', 'time: 2/2')
      .replace('== 1\n', '== 0\nrh: g4:4\nlh: r:4\n== 1\n')
      .replace(/== 3\n[\s\S]*$/, '');
    const c = compareReadings(score(tune), score(other.replace('section: A 1-4', 'section: A 1-2')));
    expect(c.header.map((h) => h.what)).toEqual(['Key signature', 'Time signature', 'Number of bars', 'Pickup']);
    expect(c.header[0]).toEqual({ what: 'Key signature', first: 'no sharps or flats', second: '1 sharp' });
    expect(c.header[3]).toEqual({ what: 'Pickup', first: 'no pickup', second: 'a pickup of 1 beat' });
    const lines = comparisonLines(c);
    expect(lines[0]).toBe('Key signature: the first reading has no sharps or flats; the second has 1 sharp.');
    expect(lines).toContain('Bar 0 is only in the second reading.');
    expect(lines).toContain('Bar 4 is only in the first reading.');
    // Header facts come before bars, bars before chord symbols.
    const kinds = lines.map((l) => (l.startsWith('Bar') ? (l.includes('chord symbols') ? 2 : 1) : 0));
    expect([...kinds].sort()).toEqual(kinds);
  });

  it('reports key and time changes and a different playing order from repeats', () => {
    const changed = tune.replace('== 3\n', '== 3 key: 1b\n');
    const keyed = compareReadings(score(tune), score(changed));
    expect(keyed.header).toEqual([{ what: 'Key signature changes', first: 'none', second: 'bar 3: 1 flat' }]);
    const repeated = tune.replace('== 4\n', ':|\n== 4\n');
    const c = compareReadings(score(tune), score(repeated));
    expect(c.header).toEqual([
      {
        what: 'Repeats, endings and jumps',
        first: '4 bars played, and after bar 3 it plays bar 4',
        second: '7 bars played, and after bar 3 it plays bar 1',
      },
    ]);
  });

  it('notices swing and a missing tie', () => {
    const swung = tune.replace('== 2\n', '== 2 swing\n').replace('d5:2~ d5:8', 'd5:2 d5:8');
    const c = compareReadings(score(tune), score(swung));
    expect(c.notes.map((d) => d.bar)).toEqual([3]);
    expect(c.chords.map((d) => [d.bar, d.second])).toEqual([
      [2, 'Am on beat 1, D7 on beat 3, swing'],
      [3, 'G7 on beat 1, swing'],
      [4, 'C on beat 1, swing'],
    ]);
  });

  it('builds the message for the AI: the differing bars, then a request to look again and send the whole file', () => {
    const other = tune.replace('rh: c5:1', 'rh: c5:2 r:2');
    const message = differencesMessage(compareReadings(score(tune), score(other)));
    const lines = message.split('\n');
    expect(lines[0]).toMatch(/^Two independent readings of this piece disagree in these places\./);
    expect(lines).toContain(
      '- Bar 4: only the first reading has C5 on beat 1 (4 beats, right hand); only the second has C5 on beat 1 (2 beats, right hand).',
    );
    expect(lines[lines.length - 1]).toMatch(
      /look at the page again[\s\S]*send the whole corrected piece file again in one code block/,
    );
  });

  it('names a black key both ways, whatever the key signature, and lists notes by beat, then pitch', () => {
    const f = (rh: string) => `title: t\npitch-mode: sounding\nkey: 1b\ntime: 2/4\nvoices: rh@1:R\n== 1\nrh: ${rh}\n`;
    const c = compareReadings(score(f('c#5:4 e5:4')), score(f('d5:4 e5:4')));
    // A printed C sharp in F major is still named C#5 (the key signature alone would call it Db5).
    expect(comparisonLines(c)).toEqual([
      'Bar 1: only the first reading has C#5/Db5 on beat 1 (1 beat, right hand); only the second has D5 on beat 1 (1 beat, right hand).',
    ]);
    // As strings the comparison sorts "0.5:..." before "0:..." and "0:100" before "0:99"; the page sorts by beat, then pitch.
    const d = compareReadings(score(f('<d#7 e7>:8 e5:8 r:4')), score(f('r:2')));
    expect(d.notes[0].first.map((n) => `${n.pitch}@${n.beat}`)).toEqual(['D♯7/E♭7@1', 'E7@1', 'E5@1.5']);
    expect(comparisonLines(d)[0]).toBe(
      'Bar 1: only the first reading has D#7/Eb7 on beat 1 (0.5 beats, right hand); E7 on beat 1 (0.5 beats, right hand); E5 on beat 1.5 (0.5 beats, right hand).',
    );
  });

  it('a bar where only one reading has notes says so plainly', () => {
    const one = `title: t\npitch-mode: sounding\ntime: 2/4\nvoices: rh@1:R\n== 1\nrh: c5:4 d5:4\n`;
    const c = compareReadings(score(one), score(one.replace('c5:4 d5:4', '<c5 e5>:4 d5:4')));
    expect(comparisonLines(c)).toEqual(['Bar 1: only the second reading has E5 on beat 1 (1 beat, right hand).']);
    const d = compareReadings(score(one.replace('c5:4 d5:4', '<c5 e5>:4 d5:4')), score(one));
    expect(comparisonLines(d)).toEqual(['Bar 1: only the first reading has E5 on beat 1 (1 beat, right hand).']);
  });

  it('caps the message at 60 differences and counts the rest', () => {
    const long = (shift: string) =>
      `title: t\npitch-mode: sounding\ntime: 4/4\nvoices: rh@1:R\n${Array.from({ length: 70 }, (_, i) => `== ${i + 1}\nrh: ${shift}:1\n`).join('')}`;
    const message = differencesMessage(compareReadings(score(long('c4')), score(long('d4'))));
    expect(message.split('\n').filter((l) => l.startsWith('- Bar'))).toHaveLength(60);
    expect(message).toContain('- And 10 more differences after these.');
  });
});
