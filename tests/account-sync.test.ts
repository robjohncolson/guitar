import { afterEach, describe, expect, it, vi } from 'vitest';
import { conflicts, plan, type LocalView } from '../src/account/reconcile';
import { getProgress, type CloudItem } from '../src/account/api';
import { isProgressKey, PROGRESS_KEYS } from '../src/account/config';

const meta = (version = 0, modifiedAt: string | null = null, dirty = false) => ({ version, modifiedAt, dirty });
const local = (over: Partial<Record<string, Partial<LocalView>>> = {}): LocalView[] =>
  PROGRESS_KEYS.map((key) => ({
    key,
    text: null,
    meta: meta(),
    ...over[key],
  }));
const cloud = (
  key: CloudItem['key'],
  value: unknown,
  version: number,
  updatedAt = '2026-11-10T12:00:00.000Z',
): CloudItem => ({ key, value, version, updatedAt });
const action = (plans: ReturnType<typeof plan>, key: string) => plans.find((p) => p.key === key)!.action;

describe('progress sync planning', () => {
  it('pushes local-only keys, takes cloud-only keys and links identical ones', () => {
    const l = local({ 'guitar.trainer.v1': { text: '{"a":1}' } });
    const c = [cloud('piece.trainer.v1', { p: 1 }, 1)];
    const p = plan(l, c, 'merge');
    expect(action(p, 'guitar.trainer.v1')).toBe('push');
    expect(action(p, 'piece.trainer.v1')).toBe('take');
    expect(conflicts(l, c)).toEqual([]);
    const same = local({ 'guitar.trainer.v1': { text: '{"a":1}' } });
    expect(action(plan(same, [cloud('guitar.trainer.v1', { a: 1 }, 3)], 'merge'), 'guitar.trainer.v1')).toBe('link');
  });
  it('asks on first sign-in only when both sides differ, and honours the choice', () => {
    const l = local({
      'guitar.trainer.v1': { text: '{"a":"device"}', meta: meta(0, '2026-11-11T09:00:00.000Z', true) },
      'piece.trainer.v1': { text: '{"p":"device"}' },
    });
    const c = [
      cloud('guitar.trainer.v1', { a: 'cloud' }, 2, '2026-11-10T09:00:00.000Z'),
      cloud('piece.trainer.v1', { p: 'cloud' }, 5, '2026-11-10T09:00:00.000Z'),
    ];
    expect(conflicts(l, c)).toEqual(['guitar.trainer.v1', 'piece.trainer.v1']);
    expect(
      plan(l, c, 'device')
        .filter((p) => p.action === 'push')
        .map((p) => p.key),
    ).toEqual(['guitar.trainer.v1', 'piece.trainer.v1']);
    expect(
      plan(l, c, 'cloud')
        .filter((p) => p.action === 'take')
        .map((p) => p.key),
    ).toEqual(['guitar.trainer.v1', 'piece.trainer.v1']);
    // Merge: the trainer copy here changed after the cloud copy; untracked local Pieces progress counts as older.
    const merged = plan(l, c, 'merge');
    expect(action(merged, 'guitar.trainer.v1')).toBe('push');
    expect(action(merged, 'piece.trainer.v1')).toBe('take');
    expect(merged.find((p) => p.key === 'guitar.trainer.v1')!.baseVersion).toBe(2);
  });
  it('on a linked device, takes newer cloud copies unless this device changed more recently', () => {
    const c = [
      cloud('guitar.trainer.v1', { a: 'other device' }, 4, '2026-11-11T10:00:00.000Z'),
      cloud('piece.trainer.v1', { p: 1 }, 7),
    ];
    const p = plan(
      local({
        'guitar.trainer.v1': { text: '{"a":"old"}', meta: meta(3) },
        'piece.trainer.v1': { text: '{"p":2}', meta: meta(7, '2026-11-11T11:00:00.000Z', true) },
      }),
      c,
      'linked',
    );
    expect(action(p, 'guitar.trainer.v1')).toBe('take');
    expect(action(p, 'piece.trainer.v1')).toBe('push');
    const newer = plan(
      local({
        'guitar.trainer.v1': { text: '{"a":"edited here"}', meta: meta(1, '2026-11-11T11:00:00.000Z', true) },
      }),
      c,
      'linked',
    );
    expect(action(newer, 'guitar.trainer.v1')).toBe('push');
    const stale = plan(
      local({
        'guitar.trainer.v1': { text: '{"a":"edited earlier"}', meta: meta(1, '2026-11-11T09:00:00.000Z', true) },
      }),
      c,
      'linked',
    );
    expect(action(stale, 'guitar.trainer.v1')).toBe('take');
  });
});

describe('keys this client no longer syncs', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('the removed Play page settings are not a synced key', () => {
    expect(PROGRESS_KEYS).toEqual(['guitar.trainer.v1', 'piece.trainer.v1']);
    expect(isProgressKey('guitar.practice.v1')).toBe(false);
    expect(isProgressKey('piece.trainer.v1')).toBe(true);
  });
  it('ignores cloud copies of keys the server keeps for older clients', async () => {
    const old = { key: 'guitar.practice.v1', value: { v: 1 }, version: 9, updatedAt: '2026-11-10T12:00:00.000Z' };
    const kept = cloud('guitar.trainer.v1', { a: 1 }, 2);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ items: [old, kept] }), { headers: { 'content-type': 'application/json' } }),
      ),
    );
    const { items } = await getProgress();
    expect(items).toEqual([kept]);
    const p = plan(local(), [...items, old as unknown as CloudItem], 'linked');
    expect(p.map((x) => x.key)).toEqual(['guitar.trainer.v1', 'piece.trainer.v1']);
  });
});
