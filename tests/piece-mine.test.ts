import { describe, expect, it } from 'vitest';
import { compile } from '../src/piece/notation';
import { exampleTune } from '../src/piece/import-guide';
import {
  addPiece,
  asDraft,
  confirmByEar,
  confirmPiece,
  isDraft,
  MAX_BYTES,
  MAX_PIECES,
  MINE_KEY,
  parseMine,
  pickerLabel,
  pieceMeta,
  readMine,
  removePiece,
  slugId,
  titleKey,
  type Mine,
} from '../src/piece/mine';

const tune = exampleTune('printed');
const notesOf = (text: string) => {
  const s = compile(text).score!;
  return { bars: s.bars, notes: s.notes, sections: s.sections };
};
const changedLines = (a: string, b: string) => {
  const x = a.split('\n'),
    y = b.split('\n');
  return x.map((line, i) => (line === y[i] ? -1 : i)).filter((i) => i >= 0);
};

describe('draft until confirmed by ear', () => {
  it('a piece of his is a draft while its compiled verified is none or checks', () => {
    expect(compile(tune).score!.meta.verified).toBe('checks');
    expect(['none', 'checks', 'sources', 'owner', undefined].map(isDraft)).toEqual([true, true, false, false, false]);
  });

  it('confirming rewrites only the verified line, and the piece compiles to the same bars and notes', () => {
    const confirmed = confirmByEar(tune);
    expect(changedLines(tune, confirmed)).toEqual([5]);
    expect(confirmed.split('\n')[5]).toBe('verified: owner');
    expect(compile(confirmed).score!.meta.verified).toBe('owner');
    expect(notesOf(confirmed)).toEqual(notesOf(tune));
    expect(compile(confirmed).diagnostics).toEqual([]);
    expect(confirmByEar(confirmed)).toBe(confirmed);
  });

  it('keeps a trailing comment and the spacing before it', () => {
    const text = tune.replace('verified: none', 'verified: checks    % none | checks | sources | owner');
    const confirmed = confirmByEar(text);
    expect(confirmed.split('\n')[5]).toBe('verified: owner    % none | checks | sources | owner');
    expect(changedLines(text, confirmed)).toEqual([5]);
  });

  it('handles CRLF input, keeping every line ending', () => {
    const crlf = tune.replace(/\n/g, '\r\n'),
      confirmed = confirmByEar(crlf);
    expect(confirmed).toBe(confirmByEar(tune).replace(/\n/g, '\r\n'));
    expect(compile(confirmed).score!.meta.verified).toBe('owner');
    const missing = crlf.replace('verified: none\r\n', ''),
      inserted = confirmByEar(missing);
    expect(inserted).toBe(
      missing.replace('title: Little Morning Tune\r\n', 'title: Little Morning Tune\r\nverified: owner\r\n'),
    );
  });

  it('inserts the line after the title when there is none, or before the first header line without a title', () => {
    const missing = tune.replace('verified: none\n', ''),
      inserted = confirmByEar(missing);
    expect(inserted.split('\n').slice(0, 2)).toEqual(['title: Little Morning Tune', 'verified: owner']);
    expect(notesOf(inserted)).toEqual(notesOf(tune));
    const untitled = `% a comment first\n${missing.replace(/^title: .*\n/, '')}`;
    expect(confirmByEar(untitled).split('\n').slice(0, 3)).toEqual([
      '% a comment first',
      'verified: owner',
      'composer: Example Composer',
    ]);
  });

  it('never touches a verified line in a comment or in the bars', () => {
    const text = tune.replace('verified: none\n', '% verified: none\n');
    const confirmed = confirmByEar(text);
    expect(confirmed).toContain('% verified: none\n');
    expect(compile(confirmed).score!.meta.verified).toBe('owner');
  });

  it('an added piece always starts as a draft: an answer that claims owner or sources is set back to none', () => {
    for (const claim of ['owner', 'sources']) {
      const text = tune.replace('verified: none', `verified: ${claim}`);
      expect(asDraft(text)).toBe(tune);
    }
    expect(asDraft(tune)).toBe(tune);
    const checks = tune.replace('verified: none', 'verified: checks');
    expect(asDraft(checks)).toBe(checks);
  });
});

describe('adding to his pieces', () => {
  const evening = tune.replace('title: Little Morning Tune', 'title: Evening Tune');
  const mine: Mine[] = [
    { id: 'mine:Little-Morning-Tune', text: tune },
    { id: 'mine:old-file-name', text: evening },
  ];
  const piece = (text: string) => ({ text, title: pieceMeta(text).title!, composer: pieceMeta(text).composer });

  it('a new title gets mine: plus a slug of the title, at the end of the list, as a draft', () => {
    const text = tune.replace('title: Little Morning Tune', 'title: Gymnopédie No. 3');
    expect(addPiece(mine, piece(text))).toEqual({
      ok: true,
      list: [...mine, { id: 'mine:Gymnopedie-No-3', text }],
      id: 'mine:Gymnopedie-No-3',
      outcome: 'added',
      demoted: false,
    });
  });

  it('always stores a draft: a text that claims owner or sources is set back to none', () => {
    const claimed = tune
      .replace('title: Little Morning Tune', 'title: Claimed')
      .replace('verified: none', 'verified: owner');
    const added = addPiece(mine, piece(claimed));
    expect(added).toMatchObject({ ok: true, outcome: 'added', demoted: true });
    const stored = added.ok ? added.list[added.list.length - 1].text : '';
    expect(stored).toBe(claimed.replace('verified: owner', 'verified: none'));
    expect(isDraft(compile(stored).score!.meta.verified)).toBe(true);
  });

  it('the same title and composer replaces the text and keeps the id and place, ignoring case and spacing', () => {
    const text = evening.replace('rh: c5:1', 'rh: c5:2 r:2');
    expect(addPiece(mine, { text, title: '  evening   TUNE ', composer: 'example composer' })).toEqual({
      ok: true,
      list: [mine[0], { id: 'mine:old-file-name', text }],
      id: 'mine:old-file-name',
      outcome: 'replaced',
      demoted: false,
    });
    expect(titleKey('Gymnope\u{301}die')).toBe(titleKey('Gymnopédie'));
  });

  it('exactly the same text changes nothing', () => {
    expect(addPiece(mine, piece(evening))).toEqual({
      ok: true,
      list: mine,
      id: 'mine:old-file-name',
      outcome: 'unchanged',
      demoted: false,
    });
  });

  it('the same title by another composer asks first: replace it, or add a separate piece', () => {
    const minuet = evening.replace('composer: Example Composer', 'composer: Somebody Else');
    expect(addPiece(mine, piece(minuet))).toEqual({
      ok: false,
      reason: 'ask',
      id: 'mine:old-file-name',
      title: 'Evening Tune',
      composer: 'Example Composer',
      others: 0,
    });
    expect(addPiece(mine, piece(minuet), { replace: 'mine:old-file-name' })).toMatchObject({
      ok: true,
      id: 'mine:old-file-name',
      outcome: 'replaced',
      replacedComposer: 'Example Composer',
    });
    const separate = addPiece(mine, piece(minuet), 'separate');
    expect(separate).toMatchObject({ ok: true, id: 'mine:Evening-Tune', outcome: 'added' });
    // Then each is found by its own composer, and a same-composer replacement says so.
    const both = separate.ok ? separate.list : [];
    const again = minuet.replace('rh: c5:1', 'rh: c5:2 r:2');
    const replaced = addPiece(both, piece(again));
    expect(replaced).toMatchObject({ ok: true, id: 'mine:Evening-Tune', outcome: 'replaced' });
    expect(replaced.ok && replaced.replacedComposer).toBe(undefined);
    // A third composer: the question names the first piece with that title, counts the other, and replaces only the
    // piece it named.
    const third = evening.replace('composer: Example Composer', 'composer: A Third');
    expect(addPiece(both, piece(third))).toMatchObject({ reason: 'ask', id: 'mine:old-file-name', others: 1 });
    const chosen = addPiece(both, piece(third), { replace: 'mine:Evening-Tune' });
    expect(chosen).toMatchObject({ ok: true, id: 'mine:Evening-Tune', replacedComposer: 'Somebody Else' });
    expect(chosen.ok && chosen.list.find((m) => m.id === 'mine:old-file-name')!.text).toBe(evening);
  });

  it('a slug already taken by another title gets a number', () => {
    expect(slugId('Little Morning Tune!', new Set(['mine:Little-Morning-Tune']))).toBe('mine:Little-Morning-Tune-2');
    expect(slugId('さくら', new Set())).toBe('mine:piece');
    expect(slugId('x'.repeat(80), new Set())).toBe(`mine:${'x'.repeat(60)}`);
  });

  it('keeps the limits: 30 pieces (replacing still works when full), 300 KB, and a title', () => {
    const full = Array.from({ length: MAX_PIECES }, (_, i) => ({
      id: `mine:p${i}`,
      text: tune.replace('title: Little Morning Tune', `title: Piece ${i}`),
    }));
    const fresh = tune.replace('title: Little Morning Tune', 'title: One more');
    expect(addPiece(full, piece(fresh))).toEqual({ ok: false, reason: 'full' });
    const changed = full[3].text.replace('rh: c5:1', 'rh: c5:2 r:2');
    expect(addPiece(full, piece(changed))).toMatchObject({ ok: true, id: 'mine:p3', outcome: 'replaced' });
    const large = `${tune}${'% padding\n'.repeat(MAX_BYTES / 10)}`;
    expect(addPiece([], { text: large, title: 'Little Morning Tune', composer: '' })).toEqual({
      ok: false,
      reason: 'large',
    });
    expect(addPiece([], { text: tune, title: '  ', composer: '' })).toEqual({ ok: false, reason: 'untitled' });
  });

  it('confirming one piece changes only that piece’s verified line; removing drops only that piece', () => {
    const confirmed = confirmPiece(mine, 'mine:old-file-name');
    expect(confirmed[0]).toBe(mine[0]);
    expect(changedLines(mine[1].text, confirmed[1].text)).toEqual([5]);
    expect(confirmed[1].text.split('\n')[0]).toBe('title: Evening Tune');
    expect(pieceMeta(confirmed[1].text)).toMatchObject({ title: 'Evening Tune', verified: 'owner' });
    expect(removePiece(mine, 'mine:Little-Morning-Tune')).toEqual([mine[1]]);
  });

  it('the picker says yours, and draft until he confirms', () => {
    expect(pickerLabel('Evening Tune', 'mine', 'checks')).toBe('Evening Tune · yours · draft');
    expect(pickerLabel('Evening Tune', 'mine', 'none')).toBe('Evening Tune · yours · draft');
    expect(pickerLabel('Evening Tune', 'mine', 'owner')).toBe('Evening Tune · yours');
    expect(pickerLabel('Gymnopédie No. 1', 'bundled', 'sources')).toBe('Gymnopédie No. 1');
    expect(pickerLabel('Local', 'local', 'checks')).toBe('Local · yours');
  });

  it('compiles each text once for its title, composer and verified state', () => {
    const first = pieceMeta(evening);
    expect(pieceMeta(evening)).toBe(first);
    expect(first).toEqual({ title: 'Evening Tune', composer: 'Example Composer', verified: 'checks' });
    expect(pieceMeta('not a piece')).toEqual({ title: undefined, composer: '', verified: undefined });
  });

  it('reads the stored list defensively', () => {
    expect(parseMine(null)).toEqual([]);
    expect(parseMine('not json')).toEqual([]);
    expect(parseMine('{"id":"x"}')).toEqual([]);
    expect(parseMine(JSON.stringify([{ id: 'a', text: 't' }, { id: 1, text: 't' }, null]))).toEqual([
      { id: 'a', text: 't' },
    ]);
    expect(parseMine(JSON.stringify(Array.from({ length: 40 }, (_, i) => ({ id: `${i}`, text: '' }))))).toHaveLength(
      MAX_PIECES,
    );
  });

  it('quarantines an unreadable saved list instead of losing it on the next write', () => {
    const data = new Map<string, string>([[MINE_KEY, '{"id":"not a list"}']]),
      store = {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => data.set(key, value),
      };

    expect(readMine(store)).toEqual([]);
    expect(data.get(MINE_KEY)).toBe('{"id":"not a list"}');
    expect(data.get(`${MINE_KEY}.quarantine`)).toBe('{"id":"not a list"}');
    // A second read keeps the first quarantine copy.
    data.set(`${MINE_KEY}.quarantine`, 'first copy');
    readMine(store);
    expect(data.get(`${MINE_KEY}.quarantine`)).toBe('first copy');
  });
});
