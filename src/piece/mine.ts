import { PIECES_KEY } from '../account/config';
import { defaultStore, quarantineRaw, type StorageLike } from '../storage/migrate';
import { compile } from './notation';
import { BODY_LINE, code, MAX_BYTES, textBytes } from './import';
import type { ScoreMeta } from './score';

/**
 * The owner's own pieces: `{ id, text }` in localStorage (`piece.imported.v1`), at most 30, each at most 300 KB. A piece is
 * a draft until he confirms it by ear; that state lives in the piece text itself (its `verified:` line), so the account copy
 * and a downloaded file carry it too. Nothing here touches the network.
 */
export type Mine = { id: string; text: string };
export const MINE_KEY = PIECES_KEY;
export const MAX_PIECES = 30;
export { MAX_BYTES, textBytes };

export function parseMine(raw: string | null): Mine[] {
  try {
    const v = JSON.parse(raw ?? '[]');
    return Array.isArray(v)
      ? v.filter((x) => typeof x?.id === 'string' && typeof x?.text === 'string').slice(0, MAX_PIECES)
      : [];
  } catch {
    return [];
  }
}
export function readMine(store?: StorageLike): Mine[] {
  try {
    const s = store ?? defaultStore();
    if (!s) return [];
    const raw = s.getItem(MINE_KEY);
    // Unreadable text is copied aside instead of being silently lost on the next write.
    if (raw !== null && !readableMine(raw)) quarantineRaw(MINE_KEY, raw, s);
    return parseMine(raw);
  } catch {
    return [];
  }
}
function readableMine(raw: string): boolean {
  try {
    return Array.isArray(JSON.parse(raw));
  } catch {
    return false;
  }
}
/** False when browser storage is full or unavailable. */
export function writeMine(list: Mine[]): boolean {
  try {
    localStorage.setItem(MINE_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** A compiled `verified` value that still needs the owner's ear. */
export const isDraft = (verified: string | undefined) => verified === 'none' || verified === 'checks';

export interface PieceMeta {
  /** Undefined when the text does not compile. */
  title?: string;
  composer: string;
  verified?: ScoreMeta['verified'];
}
const metaCache = new Map<string, PieceMeta>();
/**
 * Title, composer and verified state of a piece text, compiled once per text: the panel and the picker repaint often,
 * and a large piece takes a few hundred milliseconds to compile.
 */
export function pieceMeta(text: string): PieceMeta {
  let found = metaCache.get(text);
  if (!found) {
    const meta = compile(text).score?.meta;
    found = { title: meta?.title, composer: meta?.composer ?? '', verified: meta?.verified };
    if (metaCache.size >= 64) metaCache.delete(metaCache.keys().next().value!);
    metaCache.set(text, found);
  }
  return found;
}

/** The piece picker's label: his own pieces say "yours", and "draft" until he has confirmed them by ear. */
export const pickerLabel = (title: string, origin: 'bundled' | 'local' | 'mine', verified: string | undefined) =>
  `${title}${origin === 'bundled' ? '' : ' · yours'}${origin === 'mine' && isDraft(verified) ? ' · draft' : ''}`;

/** Titles are the identity of his pieces: compared without case, accents in another form or extra spaces. */
export const titleKey = (title: string) => title.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

/** `mine:` plus a slug of the title, as file names gave before; a slug already taken gets -2, -3 and so on. */
export function slugId(title: string, taken: Set<string>): string {
  const slug =
    title
      .normalize('NFKD')
      .replace(/[\u{300}-\u{36f}]/gu, '') // accents, split off by NFKD
      .replace(/[^\w-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'piece';
  let id = `mine:${slug}`;
  for (let n = 2; taken.has(id); n++) id = `mine:${slug}-${n}`;
  return id;
}

export type Added =
  | {
      ok: true;
      list: Mine[];
      id: string;
      /** added: a new piece; replaced: the same piece with new text; unchanged: it already had exactly this text. */
      outcome: 'added' | 'replaced' | 'unchanged';
      /** The text claimed `verified: owner` or `sources` and was set back to a draft. */
      demoted: boolean;
      /** Set when he chose to replace a piece of his by another composer: that composer. */
      replacedComposer?: string;
    }
  | { ok: false; reason: 'untitled' | 'large' | 'full' }
  /**
   * One of his pieces has this title but another composer: he chooses between replacing that piece (`id`, named by its
   * title and composer) and a separate piece. `others` counts his further pieces with the same title.
   */
  | { ok: false; reason: 'ask'; id: string; title: string; composer: string; others: number };

/**
 * Add a checked piece to his list. It always comes in as a draft (asDraft). A piece of his with the same title and
 * composer gets the new text and keeps its id and its place in the list; with the same title and another composer he is
 * asked first, and `choice` then names the piece to replace or asks for a separate one; a new title gets a new id at the
 * end.
 */
export function addPiece(
  mine: Mine[],
  piece: { text: string; title: string; composer: string },
  choice?: { replace: string } | 'separate',
  metaOf: (text: string) => PieceMeta = pieceMeta,
): Added {
  if (!piece.title.trim()) return { ok: false, reason: 'untitled' };
  const text = asDraft(piece.text),
    demoted = text !== piece.text;
  if (textBytes(text) > MAX_BYTES) return { ok: false, reason: 'large' };
  const titled = mine.filter((m) => {
    const t = metaOf(m.text).title;
    return t !== undefined && titleKey(t) === titleKey(piece.title);
  });
  const same = titled.find((m) => titleKey(metaOf(m.text).composer) === titleKey(piece.composer)),
    chosen = typeof choice === 'object' ? titled.find((m) => m.id === choice.replace) : undefined,
    target = same ?? chosen;
  if (target)
    return target.text === text
      ? { ok: true, list: mine, id: target.id, outcome: 'unchanged', demoted }
      : {
          ok: true,
          list: mine.map((m) => (m === target ? { id: m.id, text } : m)),
          id: target.id,
          outcome: 'replaced',
          demoted,
          ...(same ? {} : { replacedComposer: metaOf(target.text).composer }),
        };
  if (titled.length && choice !== 'separate') {
    const meta = metaOf(titled[0].text);
    return {
      ok: false,
      reason: 'ask',
      id: titled[0].id,
      title: meta.title ?? piece.title,
      composer: meta.composer,
      others: titled.length - 1,
    };
  }
  if (mine.length >= MAX_PIECES) return { ok: false, reason: 'full' };
  const id = slugId(piece.title, new Set(mine.map((m) => m.id)));
  return { ok: true, list: [...mine, { id, text }], id, outcome: 'added', demoted };
}

/** "It sounds right" on one of his pieces: only that piece's verified line changes. */
export const confirmPiece = (mine: Mine[], id: string): Mine[] =>
  mine.map((m) => (m.id === id ? { id, text: confirmByEar(m.text) } : m));
export const removePiece = (mine: Mine[], id: string): Mine[] => mine.filter((m) => m.id !== id);

/** Where the header's (last) `verified:` line is, if any, and where a new one would go: after the title line. */
function verifiedLine(lines: string[]): { at: number; insert: number; value?: string } {
  let at = -1,
    title = -1,
    first = -1,
    value: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = code(lines[i].replace(/\r$/, ''));
    if (!line) continue;
    if (BODY_LINE.test(line)) break;
    if (first < 0 && /^[a-zA-Z][\w-]*\s*:/.test(line)) first = i;
    if (/^title\s*:/.test(line)) title = i;
    const m = /^verified\s*:\s*(.*)$/.exec(line);
    if (m) {
      at = i;
      value = m[1];
    }
  }
  return { at, insert: title >= 0 ? title + 1 : Math.max(0, first), value };
}

/** Set the header's `verified:` value; only that one line changes (or one line is inserted after the title). */
function setVerified(text: string, value: 'none' | 'owner'): string {
  const lines = text.split('\n'),
    place = verifiedLine(lines);
  if (place.at >= 0) {
    lines[place.at] = lines[place.at].replace(
      /^(\s*verified\s*:\s*)([^%\r]*?)([ \t]*(?:%[^\r]*)?)(\r?)$/,
      (_m, head: string, _old: string, tail: string, cr: string) => `${head}${value}${tail}${cr}`,
    );
    return lines.join('\n');
  }
  lines.splice(place.insert, 0, `verified: ${value}${text.includes('\r\n') ? '\r' : ''}`);
  return lines.join('\n');
}

/**
 * "It sounds right": the owner's own click, and the only way a piece of his stops being a draft. Rewrites the header's
 * `verified:` line to `verified: owner` (keeping a trailing comment and the line ending), or inserts that line after the
 * title when there is none. Nothing else in the text changes.
 */
export const confirmByEar = (text: string) => setVerified(text, 'owner');

/**
 * A piece added through the import area always starts as a draft: an answer that claims `verified: owner` or `sources`
 * is set back to `none`, because only the owner's own click confirms a piece. Other texts are returned unchanged.
 */
export function asDraft(text: string): string {
  const value = verifiedLine(text.split('\n')).value;
  return value === 'owner' || value === 'sources' ? setVerified(text, 'none') : text;
}
