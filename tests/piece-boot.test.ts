import { describe, expect, it } from 'vitest';
import { exampleTune } from '../src/piece/import-guide';
import { pickPack, type PiecePack } from '../src/piece/pack';

// A broken piece must never wedge boot: the page still opens music and says what was wrong with the saved piece.
const good = exampleTune('printed');
const broken = good.replace('rh: c5:1', 'rh: c5:2');
const pack = (id: string, text: string, origin: PiecePack['origin']): PiecePack => ({ id, text, origin });

describe('opening a piece', () => {
  it('opens the piece that was asked for when it compiles', () => {
    const all = [pack('gymnopedie', good, 'bundled'), pack('mine:a', good, 'mine')],
      load = pickPack(all, 'mine:a');
    expect(load?.pack.id).toBe('mine:a');
    expect(load?.compiled.score.meta.title).toBeTruthy();
    expect(load?.refused).toBeUndefined();
  });

  it('keeps the old choice of the first pack when the saved id is gone', () => {
    const all = [pack('gymnopedie', good, 'bundled'), pack('mine:a', good, 'mine')];
    expect(pickPack(all, 'mine:gone')?.pack.id).toBe('gymnopedie');
  });

  it('falls back to the first compilable bundled piece and keeps what was wrong with the saved piece', () => {
    const all = [pack('gymnopedie', good, 'bundled'), pack('mine:a', broken, 'mine')],
      load = pickPack(all, 'mine:a');
    expect(load?.pack.id).toBe('gymnopedie');
    expect(load?.refused?.pack.id).toBe('mine:a');
    expect(load?.refused?.compiled.score).toBeUndefined();
    expect(load?.refused?.compiled.diagnostics.some((d) => d.level === 'error')).toBe(true);
  });

  it('prefers a bundled piece over a local or own piece, and skips a broken bundled one', () => {
    const all = [
      pack('local:first', good, 'local'),
      pack('broken', broken, 'bundled'),
      pack('gymnopedie', good, 'bundled'),
    ];
    expect(pickPack(all, 'broken')?.pack.id).toBe('gymnopedie');
  });

  it('uses a local or own piece only when no bundled piece compiles', () => {
    const all = [pack('broken', broken, 'bundled'), pack('mine:a', good, 'mine')];
    expect(pickPack(all, 'broken')?.pack.id).toBe('mine:a');
  });

  it('returns nothing, so the page stays as it was, when no piece compiles', () => {
    expect(pickPack([pack('a', broken, 'bundled'), pack('b', broken, 'mine')], 'a')).toBeUndefined();
  });
});
