import { compile, type Compiled } from './notation';
import type { Score } from './score';

/** A piece the page can open: bundled, a dev-only local file, or one the owner added. */
export interface PiecePack {
  id: string;
  text: string;
  origin: 'bundled' | 'local' | 'mine';
}
export interface PackLoad<T extends PiecePack> {
  pack: T;
  /** The compiled piece; `score` is always present. */
  compiled: Compiled & { score: Score };
  /** What was asked for, when it did not compile and the load fell back. Its diagnostics say why. */
  refused?: { pack: T; compiled: Compiled };
}
type Attempt<T> = { pack: T; compiled: Compiled };

/**
 * The piece to open for `id`: that piece when it compiles, otherwise the first compilable bundled piece (then any
 * other compilable piece), so a broken saved piece can never leave the page without music. Undefined only when
 * nothing at all compiles; the caller then leaves the page as it was.
 */
export function pickPack<T extends PiecePack>(all: readonly T[], id: string): PackLoad<T> | undefined {
  const compiled = new Map<T, Compiled>();
  const attempt = (pack: T | undefined): Attempt<T> | undefined => {
    if (!pack) return undefined;
    let done = compiled.get(pack);
    if (!done) compiled.set(pack, (done = compile(pack.text)));
    return { pack, compiled: done };
  };
  const usable = (a: Attempt<T> | undefined): PackLoad<T> | undefined =>
    a?.compiled.score ? { pack: a.pack, compiled: a.compiled as Compiled & { score: Score } } : undefined;
  const first = (packs: readonly T[]) => {
    for (const pack of packs) {
      const done = attempt(pack);
      if (done?.compiled.score) return done;
    }
    return undefined;
  };

  const asked = all.find((p) => p.id === id) ?? all[0],
    direct = usable(attempt(asked));
  if (direct) return direct;
  const others = all.filter((p) => p !== asked),
    fallback = usable(first(others.filter((p) => p.origin === 'bundled')) ?? first(others));
  if (!fallback) return undefined;
  const refused = attempt(asked);
  return refused ? { ...fallback, refused } : fallback;
}
