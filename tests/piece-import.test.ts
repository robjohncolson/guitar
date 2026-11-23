import { describe, expect, it } from 'vitest';
import { compile } from '../src/piece/notation';
import { checkAnswer, MESSAGE_LIMIT, pitchMode, problemsMessage, readAnswer, wholeFile } from '../src/piece/import';
import { exampleTune } from '../src/piece/import-guide';

// Invisible and typographic characters are written as \u{...} escapes so that the test says what it holds.
const NBSP = '\u{a0}',
  BOM = '\u{feff}';
const piece = exampleTune('printed');
const [header, bars] = [piece.slice(0, piece.indexOf('== 1')), piece.slice(piece.indexOf('== 1'))];
// The example's header without its section line (which names bars 1 to 4), for one-bar pieces: 13 lines, then bar 1.
const bare = header.replace(/^section:.*\n/m, '');
const fence = (body: string, lang = 'text') => `\`\`\`${lang}\n${body}\`\`\``;

describe('reading an AI answer', () => {
  it('uses the code block and leaves the prose around it', () => {
    const answer = `Here is the piece file.\n\n${fence(piece)}\n\nI was unsure about bar 3.`;
    const read = readAnswer(answer);
    expect(read.text).toBe(piece);
    expect(read.tidied).toEqual(['Used the code block in the answer.']);
  });

  it('joins the parts of a long piece from several pasted answers, with CRLF line ends', () => {
    const first = `${header}${bars.slice(0, bars.indexOf('== 3'))}`,
      second = bars.slice(bars.indexOf('== 3'));
    const answer = `Part 1 of 2. Bars 3 and 4 follow.\r\n${fence(first)}\r\n\r\nSure, here is part 2:\r\n${fence(second, '')}\r\nThat is the end.`;
    const read = readAnswer(answer);
    expect(read.text).toBe(piece);
    expect(read.tidied).toEqual([
      'Used 2 code blocks, joined in order.',
      'Changed Windows line endings to plain ones.',
    ]);
    expect(compile(read.text).diagnostics).toEqual([]);
  });

  it('leaves out header lines a later part repeats word for word, and keeps ones that differ', () => {
    const first = `${header}${bars.slice(0, bars.indexOf('== 3'))}`,
      second = bars.slice(bars.indexOf('== 3'));
    const repeated = readAnswer(
      `${fence(first)}\n${fence(`title: Little Morning Tune\npitch-mode: printed\n${second}`)}`,
    );
    expect(repeated.text).toBe(piece);
    expect(repeated.tidied).toContain('Left out header lines that a later part repeated word for word.');
    const different = readAnswer(`${fence(first)}\n${fence(`title: Another title\n${second}`)}`);
    expect(different.text).toContain('title: Another title');
    // Inside a bar the compiler reads any "name:" line as a voice; the import says what the stray line really is.
    const kept = checkAnswer(`${fence(first)}\n${fence(`title: Another title\n${second}`)}`);
    expect(kept.ok).toBe(false);
    expect(kept.errors[0]).toMatchObject({ quote: 'title: Another title' });
    expect(kept.errors[0].message).toBe(
      '"title:" is a header line, but it comes after the first bar. Header lines belong only at the top of the piece; a later part leaves them out.',
    );
  });

  it('ignores code blocks that hold no piece, uses the whole text without fences, and says when a block was cut off', () => {
    expect(readAnswer(`${fence('npm install\n', 'bash')}\n${fence(piece)}`).text).toBe(piece);
    expect(readAnswer(piece).text).toBe(piece);
    expect(readAnswer(piece).tidied).toEqual([]);
    const cut = readAnswer(`Here it is:\n\`\`\`text\n${piece.slice(0, piece.indexOf('== 4'))}`);
    expect(cut.tidied.some((t) => t.includes('was not closed'))).toBe(true);
    expect(checkAnswer(`~~~\n${piece}~~~\n`).ok).toBe(true);
  });

  it('removes a byte order mark and replaces typographic characters only where the format needs plain ones', () => {
    const typographic = `${BOM}title: F\u{266f} Minor “Waltz” – No. 2\ncomposer: José${NBSP}Example\nsource: Pages\nlicence: Unknown\npitch-mode: sounding\nkey: 3\u{266f}\ntime: 3/4\nvoices: rh@1:R lh@2:L\nsection: A 1\u{2013}2 “The waltz – first part.”\n\n== 1\nharmony: F\u{266f}m B\u{266d}7@2\nrh: f\u{266f}4:4${NBSP}a4:4 c\u{266f}5:4\nlh: f\u{266f}2:2. % keep the F\u{266f} here\n== 2\nharmony: C\u{266f}\u{b0}7\nrh: e\u{266e}5:2.\nlh: <c\u{266f}3 e3>:2.\u{200b}\n`;
    const read = readAnswer(typographic);
    expect(read.text).toBe(
      `title: F\u{266f} Minor “Waltz” – No. 2\ncomposer: José${NBSP}Example\nsource: Pages\nlicence: Unknown\npitch-mode: sounding\nkey: 3#\ntime: 3/4\nvoices: rh@1:R lh@2:L\nsection: A 1-2 "The waltz – first part."\n\n== 1\nharmony: F#m Bb7@2\nrh: f#4:4 a4:4 c#5:4\nlh: f#2:2. % keep the F\u{266f} here\n== 2\nharmony: C#o7\nrh: en5:2.\nlh: <c#3 e3>:2.\n`,
    );
    expect(read.tidied).toEqual([
      'Removed a byte order mark.',
      'Replaced 15 typographic characters with the plain ones the format uses.',
    ]);
    const checked = checkAnswer(typographic);
    expect(checked.ok).toBe(true);
    expect(checked.title).toBe('F\u{266f} Minor “Waltz” – No. 2');
    expect(checked.score!.sections[0].note).toBe('The waltz – first part.');
    expect(checked.warnings).toEqual([]);
  });

  it('never guesses at music: inside a code block, a note without a duration stays an error for the AI', () => {
    const text = `${bare}== 1\nrh: g4 a4:8 c5:4 e5:4 r:4.\nlh: c3:2 <e3 g3>:2\n`;
    const checked = checkAnswer(fence(text));
    expect(checked.text).toBe(text);
    expect(checked.ok).toBe(false);
    expect(checked.errors[0]).toEqual({
      line: 15,
      level: 'error',
      quote: 'rh: g4 a4:8 c5:4 e5:4 r:4.',
      message: '"g4" needs a duration, for example g4:4.',
    });
  });
});

describe('checking an answer', () => {
  it('summarises a good piece: title, bars, notes, sections, and the bars the AI marked unsure', () => {
    const text = piece.replace('== 3\n', '% unsure: bar 3: the tie could be a slur\n== 3\n');
    const c = checkAnswer(fence(text));
    expect([c.ok, c.title, c.bars, c.notes, c.sections]).toEqual([true, 'Little Morning Tune', 4, 22, 1]);
    expect(c.errors).toEqual([]);
    expect(c.unsure).toEqual([{ line: 23, note: 'bar 3: the tie could be a slur' }]);
  });

  it('quotes the line of every problem, and reports whole-file problems without a line', () => {
    const broken = `title: Broken\npitch-mode: printed\ntime: 4/4\nvoices: rh@1:R\n== 1\nrh: c4:4 d4:4 e4:4\n== 2\nrh: c4:4 d4:4 e4:4 f4:4 g4:4\n`;
    const c = checkAnswer(broken);
    expect(c.ok).toBe(false);
    expect(c.errors.map((p) => [p.line, p.quote])).toEqual([
      [6, 'rh: c4:4 d4:4 e4:4'],
      [8, 'rh: c4:4 d4:4 e4:4 f4:4 g4:4'],
    ]);
    expect(c.errors[0].message).toBe('Voice rh fills 3 of 4 beats in bar 1.');
    // Inside a code block that holds a piece every line is piece text: a line of prose there is the AI's problem, quoted.
    const prose = checkAnswer(fence(`I cannot read bar 2.\n${piece}`));
    expect(prose.errors.map((p) => [p.line, p.quote, p.message])).toEqual([
      [1, 'I cannot read bar 2.', 'Cannot read "I cannot read bar 2.".'],
    ]);
    expect(compile('nothing here').diagnostics.filter(wholeFile)).toHaveLength(3);
    // Outside one, prose is left out, and with nothing left the owner is told so.
    const empty = checkAnswer('Sorry, I cannot read the image.');
    expect(empty).toMatchObject({ ok: false, addable: false, errors: [] });
    expect(empty.paste).toBe(
      'There is no piece file in this text. Paste the AI’s answer (with its code block), then press Check.',
    );
  });

  it('knows which compiler messages concern the whole file (they are reported on line 1)', () => {
    const { diagnostics } = compile('');
    expect(diagnostics).toHaveLength(3);
    expect(diagnostics.every(wholeFile)).toBe(true);
    expect(compile('title: t\nbad line').diagnostics.filter(wholeFile)).toHaveLength(3);
    expect(wholeFile({ line: 1, level: 'error', message: 'Cannot read "x".' })).toBe(false);
  });

  it('warns about chord symbols the app does not know, and needs a title line', () => {
    const c = checkAnswer(fence(piece.replace('harmony: G7', 'harmony: G7(b13)').replace(/^title: .*\n/, '')));
    expect(c.ok).toBe(true);
    expect(c.title).toBe('');
    expect(c.warnings).toHaveLength(1);
    expect(c.warnings[0]).toMatchObject({ level: 'warn', quote: 'harmony: G7(b13)' });
    expect(c.warnings[0].message).toContain('"G7(b13)"');
    expect(checkAnswer(piece.replace('harmony: G7', 'harmony: N.C.')).warnings).toEqual([]);
  });

  it('reads the pitch mode from the header', () => {
    expect(pitchMode(exampleTune('printed'))).toBe('printed');
    expect(pitchMode(exampleTune('sounding'))).toBe('sounding');
    expect(pitchMode('title: t\n== 1\npitch-mode: printed\n')).toBeUndefined();
  });
});

describe('the problems message for the AI', () => {
  it('lists the first 20 problems with line, quoted text and message, counts the rest and asks for the whole file', () => {
    const many = `${header}${Array.from({ length: 25 }, (_, i) => `== ${i + 1}\nrh: c5:4\nlh: c3:1\n`).join('')}`;
    const c = checkAnswer(many);
    expect(c.errors).toHaveLength(25);
    const message = problemsMessage(c);
    expect(message.split('\n')[0]).toMatch(/^The piece file you sent does not compile yet\./);
    expect(message).toContain('1. Line 16: rh: c5:4\n   Voice rh fills 1 of 4 beats in bar 1.');
    expect(message).toContain(`${MESSAGE_LIMIT}. Line ${16 + 3 * 19}: rh: c5:4`);
    expect(message).not.toContain(`${MESSAGE_LIMIT + 1}. Line`);
    expect(message).toContain('There are 5 more problems after these.');
    expect(message.trim().split('\n').pop()).toMatch(/send the whole corrected piece file again in one code block/);
  });

  it('labels warnings in a file that does not compile, and words a warnings-only message differently', () => {
    const text = `${bare.replace('pitch-mode: printed', 'pitch-mode: sounding').replace('key: 0', 'key: 1#')}== 1\nrh: f4:1\nlh: c3:2\n`;
    const c = checkAnswer(text);
    expect(c.ok).toBe(false);
    expect(problemsMessage(c)).toContain('(warning) Line 15: rh: f4:1');
    const warned = checkAnswer(text.replace('lh: c3:2', 'lh: c3:1'));
    expect(warned.ok).toBe(true);
    expect(problemsMessage(warned).split('\n')[0]).toMatch(/^The piece file you sent compiles, but the app warns/);
    expect(
      problemsMessage({
        ok: false,
        errors: [{ line: 0, level: 'error', quote: '', message: 'No bars found.' }],
        warnings: [],
      }),
    ).toContain('1. Whole file: No bars found.');
  });
});

describe('parts pasted in different ways', () => {
  const p1 = `${header}${bars.slice(0, bars.indexOf('== 3'))}`,
    p2 = bars.slice(bars.indexOf('== 3'));

  it('uses a part pasted without its code block after one with it (fenced, then bare)', () => {
    const answer = `Part 1:\n${fence(p1)}\nHere is part 2 of 2, bars 3 and 4.\n${p2}That is the end.`;
    const read = readAnswer(answer);
    expect(read.text).toBe(piece);
    expect(read.unused).toBeUndefined();
    expect(read.tidied[0]).toBe(
      'Used the code block and a part pasted without a code block (from “== 3”), joined in order.',
    );
    expect(checkAnswer(answer)).toMatchObject({ ok: true, addable: true, bars: 4, notes: 22 });
  });

  it('uses a part pasted without its code block before one with it (bare, then fenced)', () => {
    const answer = `${p1}\nAnd the rest:\n${fence(p2)}`;
    expect(readAnswer(answer).text).toBe(piece);
    expect(readAnswer(answer).tidied[0]).toMatch(
      /a part pasted without a code block \(from “title: Little Morning Tune”\)/,
    );
    expect(checkAnswer(answer)).toMatchObject({ ok: true, addable: true, notes: 22 });
  });

  it('never drops piece lines silently: lines it cannot place are named and the piece cannot be added', () => {
    const c = checkAnswer(`${fence(piece)}\nAlso:\nrh: c5:1 % fixed bar 4\n`);
    expect(c.ok).toBe(true);
    expect(c.addable).toBe(false);
    expect(c.paste).toMatch(
      /^This line outside a code block starts like a line of the piece but does not read as one, so it was not used: “rh: c5:1 % fixed bar 4”\./,
    );
    // Prose around the blocks is not a piece line and is left out without a word.
    expect(checkAnswer(`Sure! Note the ties.\n${fence(piece)}\nEnjoy:\n`).addable).toBe(true);
  });

  it('a closing fence with the next answer on the same line still closes the block', () => {
    const glued = `${fence(p1)}Here is part 2 of 2, bars 3 to 4.\n${fence(p2)}`;
    expect(readAnswer(glued).text).toBe(piece);
    expect(checkAnswer(glued)).toMatchObject({ ok: true, addable: true });
    // The next answer's own fence right behind the closing one: closes and opens.
    expect(readAnswer(`${fence(p1)}${fence(p2)}`).text).toBe(piece);
  });

  it('a later part alone, or the parts in the wrong order: one plain sentence, nothing for the AI', () => {
    for (const answer of [fence(p2), `${fence(p2)}\n${fence(p1)}`]) {
      const c = checkAnswer(answer);
      expect(c.ok).toBe(false);
      expect(c.errors).toEqual([]);
      expect(c.paste).toBe(
        'This has bars but no header lines (title, key, time, voices) before them. If your AI sent the piece in parts, paste the first part first and the others after it, then press Check again.',
      );
    }
  });

  it('the first part alone: says the piece is not complete yet, and nothing for the AI', () => {
    const c = checkAnswer(fence(p1));
    expect(c.ok).toBe(false);
    expect(c.errors).toEqual([]);
    expect(c.paste).toMatch(
      /^The piece is not complete yet: it stops at bar 2, but section A runs to bar 4\. If your AI sent it in parts, paste the next part after this one/,
    );
    // Other problems in that part are still listed, without the section line.
    const broken = checkAnswer(fence(p1.replace('rh: e5:4 c5:4 f#4:4 a4:4', 'rh: e5:4 c5:4 f#4:4')));
    expect(broken.errors.map((e) => e.quote)).toEqual(['rh: e5:4 c5:4 f#4:4']);
    expect(broken.paste).toMatch(/^The piece is not complete yet/);
  });

  it('reads HTML entities in music lines as the characters, and says so', () => {
    const escaped = piece
      .replace('lh: c3:2 <e3 g3>:2', 'lh: c3:2 &lt;e3 g3&gt;:2')
      .replace('title: Little Morning Tune', 'title: Rock &amp; Roll');
    const read = readAnswer(escaped);
    expect(read.text).toBe(piece.replace('title: Little Morning Tune', 'title: Rock &amp; Roll'));
    expect(read.tidied).toContain('Read 2 HTML entities (such as &lt;) as the plain characters.');
  });

  it('refuses more than 300 KB before reading it, and quotes at most 200 characters of a line', () => {
    const huge = checkAnswer('x'.repeat(300001));
    expect(huge).toMatchObject({ ok: false, addable: false, errors: [] });
    expect(huge.paste).toMatch(/larger than 300 KB/);
    const long = checkAnswer(fence(`${bare}== 1\nrh: ${'c4:4 '.repeat(1000)}\nlh: c3:1\n`));
    expect(long.errors[0].quote.length).toBe(200);
    expect(long.errors[0].quote.endsWith('\u{2026}')).toBe(true);
    const unreadable = checkAnswer(fence(`${bare}== 1\nrh: c4:1\nlh: c3:1\n${'y'.repeat(5000)}\n`));
    expect(unreadable.errors[0].message.length).toBeLessThanOrEqual(400);
  });

  it('changes only the bar range of a section line, never the dashes in its note', () => {
    const note = (line: string) =>
      readAnswer(piece.replace('section: A 1-4 "One short phrase."', line)).text.split('\n')[12];
    expect(note('section: A 1-4 "Bars 7\u{2013}8 fall."')).toBe('section: A 1-4 "Bars 7\u{2013}8 fall."');
    expect(note('section: A 1\u{2013}4 “Bars 7\u{2013}8 fall.”')).toBe('section: A 1-4 "Bars 7\u{2013}8 fall."');
  });
});

describe('warnings the compiler does not give', () => {
  it('marks it does not know, with the exact lowercase words', () => {
    const c = checkAnswer(
      fence(piece.replace('== 4\n', '== 4\nmark: D.C. al Fine\n').replace('== 2\n', '== 2\nmark: Fine\n')),
    );
    expect(c.ok).toBe(true);
    expect(c.warnings.map((w) => w.quote)).toEqual(['mark: Fine', 'mark: D.C. al Fine']);
    expect(c.warnings[1].message).toBe(
      'The app does not know the marks "D.C.", "al", "Fine", so they are ignored and the playing order may be wrong. Marks are lowercase and exact: segno, fine, dc, ds, tocoda, coda.',
    );
    expect(
      checkAnswer(piece.replace('== 4\n', '== 4\nmark: dc\n').replace('== 2\n', '== 2\nmark: fine\n')).warnings,
    ).toEqual([]);
  });

  it('a tempo line without a whole-number q=', () => {
    const tempo = (value: string) => checkAnswer(piece.replace('tempo: q=88 Moderato', `tempo: ${value}`)).warnings;
    expect(tempo('\u{2669}=120 Allegro')[0].message).toMatch(
      /no usable "q=" whole number, so the app plays this at 80 BPM/,
    );
    expect(tempo('q=67.5 Andante')[0].message).toMatch(/at 67 BPM/);
    expect(tempo('q=88 Moderato')).toEqual([]);
    expect(tempo('Moderato q=88')).toEqual([]);
  });

  it('an unknown chord symbol: what it does to the course, and what to write instead', () => {
    const c = checkAnswer(fence(piece.replace('harmony: G7', 'harmony: G13')));
    expect(c.warnings[0].message).toBe(
      'The app does not know the chord symbol "G13": that bar gets no chord step and no guitar strum until the next symbol. Write the nearest listed chord whose notes all belong to it (for example F7 for F13) and keep the printed symbol in a "% unsure:" line.',
    );
  });
});

describe('text outside the code blocks is judged by its shape', () => {
  const p1 = `${header}${bars.slice(0, bars.indexOf('== 3'))}`,
    p2 = bars.slice(bars.indexOf('== 3'));

  // A piece copied with a chat's Copy button, or opened from a .piece.txt file, has no code fences: for a pure piece
  // text the result must be exactly what the same text gives inside a code block.
  const head =
    'title: Probe\ncomposer: Me\npitch-mode: printed\nkey: 0\ntime: 4/4\ntempo: q=100\nvoices: rh@1:R lh@2:L\n';
  const bar = (n: number, extra = '') => `== ${n}\n${extra}rh: c5:1\nlh: c3:1\n`;
  const pure: Record<string, string> = {
    'unknown chord': head + bar(1, 'harmony: F13\n') + bar(2),
    'unknown chord with a slash': head + bar(1, 'harmony: C6/9\n') + bar(2),
    'two chords, one unknown': head + bar(1, 'harmony: C F13@2\n') + bar(2),
    'no chord': head + bar(1, 'harmony: N.C.\n') + bar(2),
    'unknown mark': head + bar(1, 'mark: Fine\n') + bar(2),
    'two known marks': head + bar(1, 'mark: fine dc\n') + bar(2),
    'misspelt voice': head + '== 1\nrh: c5:1\nlhh: c3:1\n' + bar(2),
    'a pitch without a duration': head + '== 1\nrh: c5 d5:2\nlh: c3:1\n' + bar(2),
    'a bad duration': head + '== 1\nrh: c5:3\nlh: c3:1\n' + bar(2),
    'uppercase pitches': head + '== 1\nrh: C5:1\nlh: c3:1\n' + bar(2),
    'unknown header': head.replace('tempo: q=100\n', 'tempo: q=100\narranger: Someone\nfoo: bar\n') + bar(1) + bar(2),
    'comments and unsure lines': head + '% a comment\n% unsure: bar 1: maybe\n' + bar(1) + bar(2),
    'fingering and ties': head + '== 1\nrh: c5-1:2~ c5:2\nlh: <c3-5 g3-1>:1\n' + bar(2),
    'tuplets and grace notes': head + '== 1\nrh: 3:2{ c5:4 d5:4 e5:4 } g{ d5:16 } c5:2\nlh: c3:1\n' + bar(2),
    'bar options': head + '== 1 swing\nrh: c5:1\nlh: c3:1\n== 2 time: 3/4 key: 1b\nrh: c5:2.\nlh: c3:2.\n',
    'a misspelt bar option': head + '== 78 swingg\nrh: c5:1\nlh: c3:1\n' + bar(79),
    'repeats and endings': head + '|:\n' + bar(1) + '[1\n' + bar(2) + ':|\n[2\n' + bar(3) + ']\n' + bar(4),
    'a hand override': head + '== 1\nrh: c5:1\nlh[R]: c3:1\n' + bar(2),
    'a section with a note': head.replace('voices:', 'section: A 1-2 "First idea."\nvoices:') + bar(1) + bar(2),
    'a pickup': head + '== 0\nrh: g4:4\nlh: r:4\n' + bar(1),
    'R in a pickup': head + '== 0\nrh: g4:4\nlh: R\n' + bar(1),
    'an empty voice line': head + '== 1\nrh: c5:1\nlh:\n' + bar(2),
    'a header line after the bars': head + bar(1) + 'title: Again\n' + bar(2),
  };

  it('a pure piece text gives exactly the same result with or without code fences', () => {
    for (const [name, text] of Object.entries(pure)) {
      const fenced = checkAnswer(fence(text)),
        bare = checkAnswer(text);
      const facts = (c: typeof fenced) => ({
        text: c.text,
        ok: c.ok,
        addable: c.addable,
        paste: c.paste,
        errors: c.errors,
        warnings: c.warnings,
        unsure: c.unsure,
      });
      expect(facts(bare), name).toEqual(facts(fenced));
      expect(bare.text, name).toBe(text);
    }
    // The cases really differ from each other in what they report.
    expect(checkAnswer(pure['unknown chord']).warnings).toHaveLength(1);
    expect(checkAnswer(pure['a bad duration']).errors.length).toBeGreaterThan(0);
    expect(checkAnswer(pure['R in a pickup']).warnings[0].message).toMatch(/^R fills the whole metre/);
    expect(checkAnswer(pure['a misspelt bar option']).warnings[0].message).toMatch(/swingg/);
  });

  it('a voice line that lost its colon is named to the owner, not left out without a word', () => {
    const c = checkAnswer(piece.replace('rh: c5:1', 'rh c5:1'));
    expect(c.addable).toBe(false);
    expect(c.paste).toMatch(/not used: “rh c5:1”\./);
  });

  it('commentary between code blocks is prose, but a stray music line there is named', () => {
    const p1 = `${header}${bars.slice(0, bars.indexOf('== 3'))}`,
      p2 = bars.slice(bars.indexOf('== 3'));
    expect(checkAnswer(`${fence(p1)}\nNote: bar 3 was faint on the photo.\n${fence(p2)}`)).toMatchObject({
      addable: true,
      text: piece,
    });
    expect(checkAnswer(`${fence(piece)}\nNote: bar 3 was faint on the photo.\n`).addable).toBe(true);
    // A later part without fences that repeats the header word for word: those lines are left out, as in code blocks.
    expect(readAnswer(`${fence(p1)}\ntitle: Little Morning Tune\npitch-mode: printed\n${p2}`).text).toBe(piece);
  });

  it('prose next to a part without fences never becomes chords, marks or bars, and blocks adding', () => {
    for (const answer of [
      `${fence(p1)}\nHere is the rest:\n${p2}harmony: I kept the chords simple\nmark: the fine is in bar 8\n== 9 is the last bar of the piece.\n`,
      `Here it is:\n${piece}harmony: I kept the chords simple\nmark: the fine is in bar 8\n== 9 is the last bar of the piece.\n`,
    ]) {
      const c = checkAnswer(answer);
      expect(c.text).toBe(piece);
      expect(c.score!.playOrder).toEqual([0, 1, 2, 3]);
      expect(c.errors).toEqual([]);
      expect(c.addable).toBe(false);
      expect(c.paste).toBe(
        'This line outside a code block starts like a line of the piece but does not read as one, so it was not used: “harmony: I kept the chords simple” (and 2 more like it). Delete or correct it in the box, then press Check again.',
      );
    }
  });

  it('prose between parts without fences is left out; a "Note:" line is the owner’s, not the AI’s', () => {
    const between = checkAnswer(`${p1}\nAnd part 2:\n${p2}`);
    expect(between).toMatchObject({ ok: true, addable: true, notes: 22, errors: [], warnings: [] });
    expect(between.text.replace(/\n\n+/g, '\n')).toBe(piece.replace(/\n\n+/g, '\n'));
    const note = checkAnswer(`${p1}\nNote: the left hand rests here\n${p2}`);
    expect(note.text.replace(/\n\n+/g, '\n')).toBe(piece.replace(/\n\n+/g, '\n'));
    expect(note.errors).toEqual([]);
    expect(note.warnings).toEqual([]);
    expect(note.addable).toBe(false);
    expect(note.paste).toMatch(/not used: “Note: the left hand rests here”\./);
  });

  it('keeps a music line with a misspelt voice, so that the compiler names it for the AI', () => {
    const c = checkAnswer(`${fence(p1)}\n${p2}lhh: <f2 c3>:2\n`);
    expect(c.text).toBe(`${piece}lhh: <f2 c3>:2\n`);
    expect(c.ok).toBe(false);
    expect(c.paste).toBeUndefined();
    expect(c.errors[0]).toMatchObject({ quote: 'lhh: <f2 c3>:2' });
    expect(c.errors[0].message).toMatch(/^Unknown voice "lhh"/);
  });

  it('a part pasted twice (or a correction of one bar pasted after the piece) blocks adding with one sentence', () => {
    const sentence = (n: number) =>
      `Bar ${n} appears twice. If a part was pasted twice, remove the extra copy and press Check again; otherwise ask your AI to correct the bar numbers.`;
    const twice = checkAnswer(`${fence(piece)}\n${fence(piece)}`);
    expect(twice.addable).toBe(false);
    expect(twice.paste).toBe(sentence(1));
    const firstTwice = checkAnswer(`${fence(p1)}\n${fence(p1)}\n${fence(p2)}`);
    expect(firstTwice).toMatchObject({ addable: false, paste: sentence(1) });
    const correction = checkAnswer(`${fence(piece)}\nCorrection for bar 3:\n${p2.slice(0, p2.indexOf('== 4'))}`);
    expect(correction).toMatchObject({ addable: false, paste: sentence(3) });
  });

  it('a cut-off code block followed by a fenced part is reported truthfully', () => {
    const read = readAnswer(`\`\`\`text\n${p1}Here is part 2:\n${fence(p2)}`);
    expect(read.text).toBe(piece);
    expect(read.tidied).toEqual([
      'Used 2 code blocks, joined in order.',
      'The code block starting “title: Little Morning Tune” was not closed, so that answer may have been cut off. Check that its last bar is complete.',
    ]);
  });
});

describe('a whole-bar rest in a pickup or partial bar', () => {
  it('is warned about, because it makes that bar a full bar long', () => {
    const text = piece.replace('== 1\n', '== 0\nrh: g4:4\nlh: R\n== 1\n');
    const c = checkAnswer(fence(text));
    expect(c.ok).toBe(true);
    expect(c.score!.bars[0].ticks).toBe(4 * 480);
    expect(c.warnings.map((w) => [w.quote, w.message])).toEqual([
      [
        'lh: R',
        'R fills the whole metre, so it makes this pickup or partial bar a full bar long. Write rests with their real length here, for example r:4.',
      ],
    ]);
    expect(checkAnswer(fence(text.replace('lh: R', 'lh: r:4'))).warnings).toEqual([]);
    expect(
      checkAnswer(fence(piece.replace('== 4\n', '== 4 partial\n').replace('lh: <c3 g3>:1', 'lh: R'))).warnings,
    ).toHaveLength(1);
  });
});
