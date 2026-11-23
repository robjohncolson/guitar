import { compile, type Diagnostic } from './notation';
import { noChord, parseChord } from './analysis';
import { MARKS } from './import-guide';
import type { Score } from './score';

/**
 * Reading what an AI chat sends back (see import-guide.ts). Pure: no storage, no network. The text is tidied only where
 * the format needs plain characters; the words of the title, composer, source, licence and section notes are never
 * changed, no music is guessed (no invented durations, no dropped notes), and no piece line is dropped without a word.
 */

/** The most a piece (and anything pasted to be read as one) may be. */
export const MAX_BYTES = 300000;
export const textBytes = (text: string) => new TextEncoder().encode(text).length;
/** How much of a line a problem quotes. */
export const QUOTE_LIMIT = 200;
const clip = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit - 1)}\u{2026}` : text);

export interface ReadAnswer {
  /** The piece text to compile. */
  text: string;
  /** Plain sentences saying what was done to the pasted text. */
  tidied: string[];
  /** Lines outside the code blocks that start like piece lines but do not read as them: not used. */
  unused?: string[];
}

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const PIECE_LINE = /^\s*(title\s*:|==\s*\d)/m;
/** Lines that start the body of a piece file (after the comment is cut off): a bar, or a repeat or ending line. */
export const BODY_LINE = /^(==\s*\d|\|:$|:\|\d?$|\[\d+(,\d+)*$|\]$)/;
/** A line without its comment, trimmed. */
export const code = (line: string) => line.replace(/%.*$/, '').trim();
/** A `name: value` line, as the compiler reads header lines and voice lines. */
const FIELD = /^([a-zA-Z][\w-]*)(?:\[[A-Za-z]\])?\s*:/;
/** Header names the compiler knows. */
export const HEADERS = new Set([
  'title',
  'composer',
  'arranger',
  'source',
  'licence',
  'license',
  'redistributable',
  'verified',
  'pitch-mode',
  'key',
  'mode',
  'time',
  'tempo',
  'voices',
  'section',
]);
// Outside the code blocks a line is judged by its SHAPE, not by whether it is valid: a piece-shaped line is piece text
// and goes to the compiler exactly as it would inside a code block (so its problems go to the AI), a line that starts
// like a piece line but reads as words is never used and is named to the owner, and everything else is prose.

/** A voice line's tokens, with a chord (spaces inside its angle brackets) kept as one token. */
export const musicTokens = (value: string): string[] => value.match(/<[^>]*>\S*|[^\s<]+/g) ?? [];
/** Note-shaped: a pitch with or without a duration (valid or not), a rest, R, a chord, tuplet or grace braces. */
const NOTE_SHAPE =
  /^(?:[a-gA-G](?:##|bb|[#bxn])?\d*(?:-\d+)?~?(?::[\d.]*~?)?|[rs](?::[\d.]*~?)?|R|<[^>]*>(?::[\d.]*~?)?|\d+:\d+\{\S*|g\{\S*|\})$/;
/** Chord-shaped: starts with A to G (known or not), or N.C., with an optional @offset. */
const CHORD_SHAPE = /^(?:[A-G][^\s@]*|[Nn]\.?\s*[Cc]\.?)(?:@[\d.]*)?$/;
const FIELD_LINE = /^([a-zA-Z][\w-]*)(\[[A-Za-z]\])?\s*:\s*(.*)$/;
/** A bar line: "== N" followed only by option-shaped words (time: ..., key: ..., partial, swing, straight) or one other word. */
const barShaped = (c: string) => {
  const m = /^==\s*\d+(.*)$/.exec(c);
  return Boolean(
    m &&
    !/\s/.test(
      m[1]
        .replace(/\btime:\s*\S+/g, '')
        .replace(/\bkey:\s*\S+/g, '')
        .replace(/\b(partial|swing|straight)\b/g, '')
        .trim(),
    ),
  );
};
const opensBody = (c: string) => barShaped(c) || BODY_LINE.test(c);
/** A line no piece file has: not a header, voice, bar, repeat or ending line. Used for a cut-off answer's tail. */
const proseLine = (line: string) => {
  const c = code(line);
  return Boolean(c) && !FIELD_LINE.test(c) && !/^(==|\|:|:\||\[\d|\])/.test(c);
};

/**
 * Where a line outside the code blocks sits: in the header area of the first part (before any bar of the piece), in the
 * head of a later part (before its first bar), in a part's body, or in commentary (text between code blocks that holds
 * no part of its own).
 */
type Place = 'header' | 'head' | 'body' | 'commentary';
export type LineShape = 'quiet' | 'prose' | 'piece' | 'suspect';
function lineShape(raw: string, place: Place, voices: Set<string>): LineShape {
  const c = code(tidyLine(raw).line);
  if (!c) return 'quiet';
  if (c.startsWith('==')) return barShaped(c) && place !== 'commentary' ? 'piece' : 'suspect';
  if (BODY_LINE.test(c)) return place === 'commentary' ? 'suspect' : 'piece';
  if (/^(\|:|:\||\[\d|\])/.test(c)) return 'suspect';
  const field = FIELD_LINE.exec(c);
  if (!field) {
    // "rh c5:4 d5:4": a voice line that lost its colon is not prose.
    const tokens = musicTokens(c);
    return place === 'body' && tokens.length > 1 && tokens.slice(1).every((t) => NOTE_SHAPE.test(t))
      ? 'suspect'
      : 'prose';
  }
  const [, name, hand, value] = field;
  // Before any bar every "word: value" line is a header line, known or not, as it is to the compiler.
  if (place === 'header') return value || HEADERS.has(name) ? 'piece' : 'prose';
  // A header line later on: a later part repeating the header (left out when word for word), or the compiler's to report.
  if (!hand && HEADERS.has(name)) return place === 'commentary' ? 'prose' : 'piece';
  let shaped: boolean | undefined; // undefined: an empty heading such as "Notes:"
  if (!hand && name === 'harmony')
    shaped = value
      .split(/\s+/)
      .filter(Boolean)
      .every((t) => CHORD_SHAPE.test(t));
  else if (!hand && name === 'mark') {
    const words = value.split(/\s+/).filter(Boolean);
    shaped = words.length <= 1 || words.every((w) => Object.keys(MARKS).includes(w));
  } else if (!value) shaped = voices.has(name) ? true : undefined;
  else shaped = musicTokens(value).every((t) => NOTE_SHAPE.test(t));
  if (shaped === undefined) return 'prose';
  if (place === 'body') return shaped ? 'piece' : 'suspect';
  // Before a later part's first bar a voice, harmony or mark line cannot be placed, and words there are not a header.
  if (place === 'head') return 'suspect';
  // Commentary between code blocks: music there cannot be placed; words there are prose ("Note: bar 3 was faint").
  return shaped ? 'suspect' : 'prose';
}

interface Segment {
  fenced: boolean;
  lines: string[];
  /** A code block that ended with its closing fence (false: the answer may have been cut off). */
  closed: boolean;
}
/** Split pasted lines into code blocks and the text between them, in order. */
function segments(input: string[]): Segment[] {
  const lines = [...input],
    out: Segment[] = [];
  let bare: string[] = [];
  const flush = () => {
    if (bare.length) out.push({ fenced: false, lines: bare, closed: true });
    bare = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE.exec(lines[i]);
    if (!open) {
      bare.push(lines[i]);
      continue;
    }
    flush();
    const marker = open[1],
      body: string[] = [];
    let closed = false;
    for (i++; i < lines.length; i++) {
      const close = FENCE.exec(lines[i]);
      if (close && close[1][0] === marker[0] && close[1].length >= marker.length) {
        const doubled = close[1].length >= 2 * marker.length;
        if (!doubled && /^\s*[\w+.-]+\s*$/.test(close[2])) {
          // The next answer's opening fence ("```text") while this block is still open: this answer was cut off. Text
          // from the next answer before its fence (a sentence) is not piece text.
          while (body.length && (!body[body.length - 1].trim() || proseLine(body[body.length - 1]))) body.pop();
          i--;
          break;
        }
        closed = true;
        // Copied text has no final line break, so the next answer pasted behind it starts on the closing fence's line.
        // That text is read as the next line; a doubled fence ("``````text") closes this block and opens the next.
        const rest = doubled ? close[1].slice(marker.length) + close[2] : close[2];
        if (rest.trim()) {
          lines[i] = rest;
          i--;
        }
        break;
      }
      body.push(lines[i]);
    }
    out.push({ fenced: true, lines: body, closed });
  }
  flush();
  return out;
}

/** Header lines whose value is free text: their words are left exactly as written. */
const WORDS = /^\s*(title|composer|arranger|source|licen[cs]e|tempo)\s*:/i;
// Written as \u{...} escapes so that the source stays plain ASCII.
const SPACES = /[\u{a0}\u{2000}-\u{200a}\u{202f}\u{205f}\u{3000}]/gu;
const INVISIBLE = /[\u{200b}-\u{200d}\u{2060}\u{feff}]/gu;
const MUSIC: [RegExp, string][] = [
  [/\u{266f}/gu, '#'], // sharp sign
  [/\u{266d}/gu, 'b'], // flat sign
  [/\u{266e}/gu, 'n'], // natural sign
  [/\u{1d12a}/gu, 'x'], // double sharp
  [/\u{1d12b}/gu, 'bb'], // double flat
  [/\u{b0}/gu, 'o'], // degree sign: a diminished chord
];
const ENTITY: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };
const DASH = '[\u{2010}-\u{2015}\u{2212}]';
const QUOTE_OPEN = '["\u{201c}\u{201d}\u{201e}\u{201f}\u{2033}]',
  QUOTE_CLOSE = '["\u{201c}\u{201d}\u{201f}\u{2033}]';
/** The bar range of a section line: the numbers right before its note (or the end of the line). */
const SECTION_RANGE = new RegExp(`^(\\s*section\\s*:.*?)(\\d+)\\s*${DASH}\\s*(\\d+)(\\s*(?:${QUOTE_OPEN}.*)?)$`, 'u');
const SECTION_NOTE = new RegExp(`(\\d\\s+)(${QUOTE_OPEN})(.*)(${QUOTE_CLOSE})\\s*$`, 'u');

/** Tidy one line: the comment and free-text header values stay as they are. */
function tidyLine(line: string): { line: string; count: number; entities: number } {
  if (WORDS.test(line) || /^\s*%/.test(line)) return { line, count: 0, entities: 0 };
  const cut = line.indexOf('%'),
    head = cut < 0 ? line : line.slice(0, cut),
    tail = cut < 0 ? '' : line.slice(cut);
  let count = 0,
    entities = 0,
    out = head;
  const swap = (pattern: RegExp, by: string) => {
    out = out.replace(pattern, () => {
      count++;
      return by;
    });
  };
  swap(SPACES, ' ');
  swap(INVISIBLE, '');
  if (/^\s*section\s*:/i.test(out)) {
    // Only the bar range and the quotes around the note: the section's own words stay, dashes in them too.
    out = out.replace(SECTION_RANGE, (_m, a: string, from: string, to: string, rest: string) => {
      count++;
      return `${a}${from}-${to}${rest}`;
    });
    out = out.replace(SECTION_NOTE, (_m, a: string, open: string, note: string, close: string) => {
      count += Number(open !== '"') + Number(close !== '"');
      return `${a}"${note}"`;
    });
  } else {
    // Some tools hand text over HTML-escaped: <c4 e4>:2 arrives as &lt;c4 e4&gt;:2.
    out = out.replace(/&(lt|gt|amp|quot|apos|#39|nbsp);/gi, (_m, name: string) => {
      entities++;
      return ENTITY[name.toLowerCase()];
    });
    for (const [pattern, by] of MUSIC) swap(pattern, by);
  }
  return { line: out + tail, count, entities };
}

/** Take arbitrary pasted text (one or several AI answers) and return the piece text inside it, tidied. */
export function readAnswer(raw: string): ReadAnswer {
  const tidied: string[] = [];
  let text = raw,
    unused: string[] | undefined;
  if (text.startsWith('\u{feff}')) {
    text = text.slice(1);
    tidied.push('Removed a byte order mark.');
  }
  if (/\r/.test(text)) {
    text = text.replace(/\r\n?/g, '\n');
    tidied.push('Changed Windows line endings to plain ones.');
  }
  text = text.replace(/[\u{2028}\u{2029}]/gu, '\n');
  let lines = text.split('\n');
  const all = segments(lines),
    blocks = all.filter((s) => s.fenced && PIECE_LINE.test(s.lines.join('\n')));
  // Inside a code block that holds piece text everything is piece text, and the compiler judges it. Outside the code
  // blocks (a part copied with a chat's Copy button, a .piece.txt file, or an answer with no code block at all) each
  // line is judged by its shape (lineShape): piece-shaped lines are piece text, exactly as inside a code block; prose is
  // left out; a line that starts like a piece line but reads as words is never used and is named to the owner.
  const parts: string[][] = [],
    suspect: string[] = [],
    voices = new Set(
      lines.flatMap((l) => {
        const m = /^voices\s*:\s*(.*)$/.exec(code(l));
        return m ? m[1].split(/\s+/).map((v) => v.split('@')[0]) : [];
      }),
    );
  let bare = 0,
    bareStart = '',
    began = false;
  for (const s of all) {
    if (s.fenced) {
      if (blocks.includes(s)) {
        parts.push(s.lines);
        began ||= s.lines.some((l) => opensBody(code(l)));
      }
      continue;
    }
    // A stretch of text outside the code blocks is a part when it has a bar (or a title line); else it is commentary.
    const plain = s.lines.map((l) => code(tidyLine(l).line)),
      firstBar = plain.findIndex(opensBody),
      part = firstBar >= 0 || plain.some((c) => /^title\s*:\s*\S/.test(c)),
      used: string[] = [];
    s.lines.forEach((l, j) => {
      const place: Place = !part ? 'commentary' : firstBar >= 0 && j >= firstBar ? 'body' : began ? 'head' : 'header';
      const shape = lineShape(l, place, voices);
      if (shape === 'suspect') suspect.push(l.trim());
      else if (part && shape !== 'prose') used.push(l);
    });
    if (firstBar >= 0) began = true;
    while (used.length && !used[0].trim()) used.shift();
    while (used.length && !used[used.length - 1].trim()) used.pop();
    if (used.some((l) => code(l))) {
      parts.push(used);
      bare++;
      bareStart ||= used.find((l) => code(l)) ?? '';
    }
  }
  if (suspect.length) unused = suspect;
  {
    let repeated = 0;
    const header = new Set<string>();
    lines = parts.flatMap((part, i) => {
      const bodyAt = part.findIndex((l) => BODY_LINE.test(code(l)));
      const head = bodyAt < 0 ? part : part.slice(0, bodyAt);
      if (i === 0) for (const l of head) if (code(l)) header.add(code(l));
      if (i > 0 && head.some((l) => code(l)) && head.every((l) => !code(l) || header.has(code(l)))) {
        // A later part that repeats the first part's header lines word for word: those lines are left out.
        repeated++;
        return part.filter((l, j) => (bodyAt >= 0 && j >= bodyAt) || !code(l));
      }
      return part;
    });
    const fenced = blocks.length === 1 ? 'the code block' : `${blocks.length} code blocks`,
      outside = `${bare === 1 ? 'a part' : `${bare} parts`} pasted without a code block (from “${clip(bareStart.trim(), 60)}”)`;
    if (blocks.length)
      tidied.unshift(
        bare
          ? `Used ${fenced} and ${outside}, joined in order.`
          : blocks.length === 1
            ? 'Used the code block in the answer.'
            : `Used ${blocks.length} code blocks, joined in order.`,
      );
    if (repeated)
      tidied.push(
        `Left out header lines that ${repeated === 1 ? 'a later part repeated' : `${repeated} later parts repeated`} word for word.`,
      );
    const cut = blocks.find((b) => !b.closed);
    if (cut)
      tidied.push(
        `The code block starting “${clip((cut.lines.find((l) => code(l)) ?? '').trim(), 60)}” was not closed, so that answer may have been cut off. Check that its last bar is complete.`,
      );
  }
  let changed = 0,
    entities = 0;
  lines = lines.map((line) => {
    const t = tidyLine(line);
    changed += t.count;
    entities += t.entities;
    return t.line;
  });
  if (entities)
    tidied.push(
      `Read ${entities} HTML ${entities === 1 ? 'entity' : 'entities'} (such as &lt;) as the plain character${entities === 1 ? '' : 's'}.`,
    );
  if (changed)
    tidied.push(
      `Replaced ${changed} typographic character${changed === 1 ? '' : 's'} with the plain ones the format uses.`,
    );
  text = lines.join('\n').replace(/^\n+/, '');
  if (!text.endsWith('\n')) text += '\n';
  return { text, tidied, unused };
}

export interface Problem {
  /** Line in the piece text, from 1; 0 for problems with the whole file. */
  line: number;
  level: 'error' | 'warn';
  /** The text of that line (at most QUOTE_LIMIT characters), so that an AI can find it without our line numbers. */
  quote: string;
  message: string;
}
export interface Unsure {
  line: number;
  note: string;
}
export interface Checked {
  /** The piece text was read and compiled. */
  ok: boolean;
  /** It may be added: read, titled, and nothing about the pasting is wrong. */
  addable: boolean;
  /**
   * A plain sentence when the problem is in how the answer was pasted (a part missing or out of order, lines outside the
   * code blocks, too large), not in the piece: it is for the owner and never goes to the AI.
   */
  paste?: string;
  text: string;
  tidied: string[];
  score?: Score;
  title: string;
  composer: string;
  bars: number;
  notes: number;
  sections: number;
  errors: Problem[];
  warnings: Problem[];
  unsure: Unsure[];
}

/** Compiler messages about the file as a whole; it reports them on line 1, which would quote the wrong text. */
export const wholeFile = (d: Diagnostic) =>
  d.line === 1 && /^(Add "pitch-mode|Declare voices|No bars found)/.test(d.message);

/** Lines of the body (from the first bar, repeat or ending line on) with their line numbers. */
function bodyLines(lines: string[]): { line: number; text: string; raw: string }[] {
  const at = lines.findIndex((l) => BODY_LINE.test(code(l)));
  return at < 0 ? [] : lines.slice(at).map((raw, i) => ({ line: at + i + 1, text: code(raw), raw: raw.trim() }));
}

/** Chord symbols the analysis does not know: the compiler accepts any symbol, so the import warns. */
function unknownChords(lines: string[]): Problem[] {
  const found: Problem[] = [];
  for (const { line, text, raw } of bodyLines(lines)) {
    const m = /^harmony\s*:\s*(.*)$/.exec(text);
    if (!m) continue;
    for (const part of m[1].split(/\s+/).filter(Boolean)) {
      const symbol = part.split('@')[0];
      if (!noChord(symbol) && !parseChord(symbol))
        found.push({
          line,
          level: 'warn',
          quote: clip(raw, QUOTE_LIMIT),
          message: `The app does not know the chord symbol "${symbol}": that bar gets no chord step and no guitar strum until the next symbol. Write the nearest listed chord whose notes all belong to it (for example F7 for F13) and keep the printed symbol in a "% unsure:" line.`,
        });
    }
  }
  return found;
}
/** Marks the play order does not know are ignored by the compiler without a word, so the import warns. */
function unknownMarks(lines: string[]): Problem[] {
  const known = Object.keys(MARKS);
  return bodyLines(lines).flatMap(({ line, text, raw }) => {
    const m = /^mark\s*:\s*(.*)$/.exec(text);
    if (!m) return [];
    const unknown = m[1].split(/\s+/).filter((v) => v && !known.includes(v));
    return unknown.length
      ? [
          {
            line,
            level: 'warn' as const,
            quote: clip(raw, QUOTE_LIMIT),
            message: `The app does not know the mark${unknown.length === 1 ? '' : 's'} ${unknown.map((u) => `"${u}"`).join(', ')}, so ${unknown.length === 1 ? 'it is' : 'they are'} ignored and the playing order may be wrong. Marks are lowercase and exact: ${known.join(', ')}.`,
          },
        ]
      : [];
  });
}
/** R fills the whole metre, so in a pickup or partial bar it silently makes that bar a full bar long. */
function wholeRestInPartial(lines: string[]): Problem[] {
  let partial = false;
  return bodyLines(lines).flatMap(({ line, text, raw }) => {
    const bar = /^==\s*(\d+)(.*)$/.exec(text);
    if (bar) partial = bar[1] === '0' || /\bpartial\b/.test(bar[2]);
    const voice = /^([a-zA-Z][\w-]*)(?:\[[A-Za-z]\])?\s*:\s*(.*)$/.exec(text);
    if (!partial || !voice || voice[1] === 'harmony' || voice[1] === 'mark' || !musicTokens(voice[2]).includes('R'))
      return [];
    return [
      {
        line,
        level: 'warn' as const,
        quote: clip(raw, QUOTE_LIMIT),
        message:
          'R fills the whole metre, so it makes this pickup or partial bar a full bar long. Write rests with their real length here, for example r:4.',
      },
    ];
  });
}
/** A tempo line without a whole-number q= is read as 80 BPM (or as the digits before a decimal point). */
function badTempo(lines: string[], score: Score): Problem[] {
  const end = lines.findIndex((l) => BODY_LINE.test(code(l)));
  const i = lines.slice(0, end < 0 ? lines.length : end).findIndex((l) => /^tempo\s*:/.test(code(l)));
  if (i < 0 || /(?:^|\s|:)q=\d+(?![\d.,/])/.test(code(lines[i]))) return [];
  return [
    {
      line: i + 1,
      level: 'warn',
      quote: clip(lines[i].trim(), QUOTE_LIMIT),
      message: `The tempo line has no usable "q=" whole number, so the app plays this at ${score.tempo.bpm} BPM. Write q= and a whole number of quarter notes per minute, for example "tempo: q=120 Allegro".`,
    },
  ];
}

const pasted = (sentence: string, text = '', tidied: string[] = []): Checked => ({
  ok: false,
  addable: false,
  paste: sentence,
  text,
  tidied,
  title: '',
  composer: '',
  bars: 0,
  notes: 0,
  sections: 0,
  errors: [],
  warnings: [],
  unsure: [],
});

/** Read the answer, compile it and say what is in it and what is wrong with it. */
export function checkAnswer(raw: string): Checked {
  if (textBytes(raw) > MAX_BYTES)
    return pasted(
      `This is larger than ${MAX_BYTES / 1000} KB, more than a piece file may be. Paste only what the AI answered.`,
    );
  const { text, tidied, unused } = readAnswer(raw),
    lines = text.split('\n'),
    body = bodyLines(lines),
    bodyAt = body.length ? body[0].line - 1 : lines.length,
    head = lines.slice(0, bodyAt).map(code);
  // Lines outside the code blocks that start like piece lines but do not read as them: the owner's to fix or delete.
  const notUsed = unused
    ? `This line outside a code block starts like a line of the piece but does not read as one, so it was not used: “${clip(unused[0], 80)}”${unused.length > 1 ? ` (and ${unused.length - 1} more like it)` : ''}. Delete or correct it in the box, then press Check again.`
    : undefined;
  if (!lines.some((l) => code(l)))
    return pasted(
      notUsed ?? 'There is no piece file in this text. Paste the AI’s answer (with its code block), then press Check.',
      text,
      tidied,
    );
  // A later part alone, or the parts in the wrong order: bars with no header before them.
  if (body.length && !head.some((l) => /^(title|key|time|voices|pitch-mode)\s*:/.test(l)))
    return pasted(
      [
        notUsed,
        'This has bars but no header lines (title, key, time, voices) before them. If your AI sent the piece in parts, paste the first part first and the others after it, then press Check again.',
      ]
        .filter(Boolean)
        .join(' '),
      text,
      tidied,
    );
  const { score, diagnostics } = compile(text);
  const problem = (d: Diagnostic): Problem => {
    if (wholeFile(d)) return { line: 0, level: d.level, quote: '', message: d.message };
    const quote = clip((lines[d.line - 1] ?? '').trim(), QUOTE_LIMIT);
    const voice = /^Unknown voice "([^"]+)"/.exec(d.message);
    const message =
      voice && HEADERS.has(voice[1]) && d.line > bodyAt
        ? `"${voice[1]}:" is a header line, but it comes after the first bar. Header lines belong only at the top of the piece; a later part leaves them out.`
        : d.message;
    return { line: d.line, level: d.level, quote, message: clip(message, 400) };
  };
  // The first part alone: a section that runs past the last bar. That is a missing part, not a problem for the AI.
  const lastBar = Math.max(...body.map((b) => Number(/^==\s*(\d+)/.exec(b.text)?.[1] ?? -1)));
  const beyond = lines.flatMap((l, i) => {
    const m = i < bodyAt ? /^section\s*:\s*(.+?)\s+(\d+)-(\d+)(?:\s+"(.*)")?$/.exec(code(l)) : null;
    return m && Number(m[3]) > lastBar ? [{ line: i + 1, name: m[1], to: Number(m[3]), quote: l.trim() }] : [];
  });
  let errors = diagnostics.filter((d) => d.level === 'error').map(problem),
    incomplete: string | undefined;
  if (beyond.length && lastBar >= 0) {
    const last = beyond.reduce((a, b) => (b.to > a.to ? b : a));
    errors = errors.filter((e) => !beyond.some((b) => b.line === e.line));
    incomplete = `The piece is not complete yet: it stops at bar ${lastBar}, but section ${last.name} runs to bar ${last.to}. If your AI sent it in parts, paste the next part after this one and press Check again. If this is the whole piece, the section line is wrong (“${clip(last.quote, 80)}”).`;
  }
  // A bar number twice: most often a part pasted twice (opening a file adds it after the text already in the box).
  const numbers = body.flatMap((b) => /^==\s*(\d+)/.exec(b.text)?.[1] ?? []),
    twice = numbers.find((n, i) => numbers.indexOf(n) !== i);
  const repeatedBar =
    twice === undefined
      ? undefined
      : `Bar ${twice} appears twice. If a part was pasted twice, remove the extra copy and press Check again; otherwise ask your AI to correct the bar numbers.`;
  const paste = [notUsed, repeatedBar, incomplete].filter(Boolean).join(' ') || undefined;
  const warnings = diagnostics.filter((d) => d.level === 'warn').map(problem);
  if (score)
    warnings.push(
      ...unknownChords(lines),
      ...unknownMarks(lines),
      ...badTempo(lines, score),
      ...wholeRestInPartial(lines),
    );
  warnings.sort((a, b) => a.line - b.line);
  const unsure: Unsure[] = [];
  lines.forEach((line, i) => {
    const m = /%\s*unsure\s*:\s*(.*)$/i.exec(line);
    if (m) unsure.push({ line: i + 1, note: clip(m[1].trim(), QUOTE_LIMIT) });
  });
  // The compiler calls a piece without a title line "Untitled"; the import needs the real title, because the title is
  // what tells the owner's pieces apart.
  const titled = head.some((l) => /^title\s*:\s*\S/.test(l));
  const title = titled ? (score?.meta.title.trim() ?? '') : '';
  return {
    ok: Boolean(score),
    addable: Boolean(score) && !paste && Boolean(title),
    paste,
    text,
    tidied,
    score,
    title,
    composer: score?.meta.composer.trim() ?? '',
    bars: score?.bars.length ?? 0,
    notes: score?.notes.length ?? 0,
    sections: score?.sections.length ?? 0,
    errors,
    warnings,
    unsure,
  };
}

/** The pitch-mode a piece text declares in its header, if any. */
export function pitchMode(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const c = code(line);
    if (BODY_LINE.test(c)) return undefined;
    const m = /^pitch-mode\s*:\s*(\S+)/.exec(c);
    if (m) return m[1];
  }
  return undefined;
}

/** How many problems the paste-back message lists before it only counts the rest. */
export const MESSAGE_LIMIT = 20;

/** One problem as plain text: where it is, the line itself, and the compiler's message. */
export const problemText = (p: Problem) =>
  p.line ? `Line ${p.line}: ${p.quote}\n   ${p.message}` : `Whole file: ${p.message}`;

/** The message the owner pastes back into the AI chat: the problems, then a request for the whole corrected file. */
export function problemsMessage(checked: Pick<Checked, 'ok' | 'errors' | 'warnings'>): string {
  const all = [...checked.errors, ...checked.warnings],
    shown = all.slice(0, MESSAGE_LIMIT),
    rest = all.length - shown.length;
  const opening = checked.ok
    ? 'The piece file you sent compiles, but the app warns about these lines.'
    : 'The piece file you sent does not compile yet. These are the problems the app found.';
  return [
    `${opening} Line numbers count from the first line of the piece file; the text of each line is quoted so you can find it.`,
    '',
    ...shown.map((p, i) => `${i + 1}. ${p.level === 'warn' && !checked.ok ? '(warning) ' : ''}${problemText(p)}`),
    ...(rest ? ['', `There ${rest === 1 ? 'is 1 more problem' : `are ${rest} more problems`} after these.`] : []),
    '',
    'Please look at the page again where needed, fix every problem, and send the whole corrected piece file again in one code block (or in parts of at most about 40 bars as before, each part in one code block).',
  ].join('\n');
}
