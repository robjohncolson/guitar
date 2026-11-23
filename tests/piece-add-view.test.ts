import { describe, expect, it } from 'vitest';
import { addedHtml, askHtml, checkHtml, compareHtml, listHtml, problemListHtml, SHOWN } from '../src/piece/add-view';
import { checkAnswer, type Problem } from '../src/piece/import';
import { compareReadings } from '../src/piece/compare';
import { exampleTune } from '../src/piece/import-guide';
import { compile } from '../src/piece/notation';
import { pieceMeta, type Mine } from '../src/piece/mine';

// What the owner sees in the panel. Text from an AI or from his storage is shown, never run, and the words are plain.
const tune = exampleTune('printed');
const evil = '<img src=x onerror="alert(1)">';
const text = (html: string) => html.replace(/<[^>]+>/g, '');

describe('his pieces in the list', () => {
  const mine: Mine[] = [
    { id: 'mine:a', text: tune.replace('title: Little Morning Tune', `title: ${evil}`) },
    { id: `mine:"><b>`, text: tune.replace('verified: none', 'verified: owner') },
  ];

  it('escapes every title, composer and id', () => {
    const html = listHtml(mine, pieceMeta);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('"><b>');
    expect(html).toContain('&#60;img src=x onerror=&#34;alert(1)&#34;&#62;');
  });

  it('shows the Draft tag and the confirm button only while a piece is a draft', () => {
    const html = listHtml(mine, pieceMeta);
    const [first, second] = html.split('<li').slice(1);
    expect(first).toContain('<span class="add-tag">Draft</span>');
    expect(first).toContain('data-act="confirm"');
    expect(second).not.toContain('Draft');
    expect(second).not.toContain('data-act="confirm"');
    expect(listHtml(mine, pieceMeta, 'mine:a')).toContain('Click again to remove');
    expect(listHtml([], pieceMeta)).toContain('No pieces yet.');
  });
});

describe('what Check says', () => {
  it('in plain words: read and checked, or cannot read yet', () => {
    const ok = checkHtml(checkAnswer(tune));
    expect(text(ok)).toContain(
      'Little Morning Tune by Example Composer: read and checked. 4 bars, 22 notes, 1 section.',
    );
    expect(ok).toContain('data-act="add"');
    const bad = checkHtml(checkAnswer(tune.replace('rh: c5:1', 'rh: c5:2')));
    expect(text(bad)).toContain('The app cannot read it yet: 1 problem.');
    expect(bad).toContain('Copy problems for your AI');
    for (const html of [ok, bad]) expect(text(html)).not.toMatch(/compil/i);
  });

  it('a pasting problem is one sentence, with nothing to copy for the AI and no Add', () => {
    const part = tune.slice(tune.indexOf('== 3'));
    const html = checkHtml(checkAnswer(part));
    expect(text(html)).toMatch(/^This has bars but no header lines/);
    expect(html).not.toContain('data-act=');
  });

  it('a text that claims to be checked says what it carries and what to do', () => {
    const html = checkHtml(checkAnswer(tune.replace('verified: none', 'verified: owner')));
    expect(text(html)).toContain(
      'This text carries “verified: owner”. It will be added as a draft: after you have listened to it, press It sounds right again.',
    );
  });

  it('counts the problems not shown, and says what the copied message holds', () => {
    const problems = (n: number): Problem[] =>
      Array.from({ length: n }, (_, i) => ({ line: i + 1, level: 'error', quote: 'rh: c4', message: 'm' }));
    expect(text(problemListHtml(problems(SHOWN)))).not.toContain('more');
    expect(text(problemListHtml(problems(15)))).toContain(
      'And 3 more not shown here. The copied message lists them all.',
    );
    expect(text(problemListHtml(problems(30)))).toContain(
      'And 18 more not shown here. The copied message lists the first 20.',
    );
  });
});

describe('what Add and Compare say', () => {
  it('says plainly whether the piece was added, replaced or already the same', () => {
    const base = { ok: true as const, list: [], id: 'mine:x', demoted: false };
    expect(text(addedHtml({ ...base, outcome: 'added' }, 'Tune', 'A'))).toMatch(/^Added “Tune” as a draft\./);
    expect(text(addedHtml({ ...base, outcome: 'replaced' }, 'Tune', 'A'))).toMatch(
      /^Replaced the text of your piece “Tune” \(same title and composer\)\. It is a draft again\./,
    );
    expect(
      text(addedHtml({ ...base, outcome: 'replaced', replacedComposer: 'J. S. Bach' }, 'Minuet', 'Petzold')),
    ).toMatch(/^Replaced your piece “Minuet” by J\. S\. Bach with this one by Petzold\. It is a draft again\./);
    expect(text(addedHtml({ ...base, outcome: 'unchanged' }, 'Tune', 'A'))).toMatch(
      /^Your piece “Tune” already has exactly this text; nothing changed\./,
    );
  });

  it('the Replace question escapes every title and composer, names the piece it would replace, and puts the safe choice first', () => {
    const ask = askHtml({ title: evil, composer: `${evil} Bach`, others: 1 }, `${evil} Petzold`);
    expect(ask).not.toContain('<img');
    // The named piece's title and composer (twice each) and the new piece's composer.
    expect(ask.match(/&#60;img/g)).toHaveLength(5);
    const plain = askHtml({ title: 'Minuet', composer: 'J. S. Bach', others: 1 }, 'Petzold');
    expect(text(plain)).toContain(
      'You already have “Minuet” by J. S. Bach and 1 other piece with that title. This one is by Petzold. Keep it as a separate piece, or replace “Minuet” by J. S. Bach with it?',
    );
    expect(plain.indexOf('data-act="add-separate"')).toBeLessThan(plain.indexOf('data-act="add-replace"'));
    expect(plain).toContain('data-act="add-replace">Replace<');
    expect(plain).toContain('data-act="add-separate">Add as a separate piece<');
  });

  it('when the readings agree it does not talk about differing bars', () => {
    const score = compile(tune).score!;
    const html = compareHtml(compareReadings(score, score), ['printed', 'sounding']);
    expect(text(html)).toContain('The two readings agree');
    expect(text(html)).toContain('Agreement does not prove both are right');
    expect(text(html)).not.toContain('differing bar');
    expect(html).not.toContain('copy-differences');
    const other = compile(tune.replace('rh: c5:1', 'rh: c5:2 r:2')).score!;
    expect(text(compareHtml(compareReadings(score, other), ['printed', 'printed']))).toContain(
      'Both readings use pitch-mode: printed.',
    );
  });
});
