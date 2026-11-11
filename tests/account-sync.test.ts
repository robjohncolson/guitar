import { describe, expect, it } from 'vitest';
import { conflicts, plan, type LocalView } from '../src/account/reconcile';
import type { CloudItem } from '../src/account/api';

const meta = (version = 0, modifiedAt: string | null = null, dirty = false) => ({ version, modifiedAt, dirty });
const local = (over: Partial<Record<string, Partial<LocalView>>> = {}): LocalView[] =>
  (['guitar.trainer.v1', 'guitar.practice.v1', 'piece.trainer.v1'] as const).map(key => ({ key, text: null, meta: meta(), ...over[key] }));
const cloud = (key: CloudItem['key'], value: unknown, version: number, updatedAt = '2026-11-10T12:00:00.000Z'): CloudItem => ({ key, value, version, updatedAt });
const action = (plans: ReturnType<typeof plan>, key: string) => plans.find(p => p.key === key)!.action;

describe('progress sync planning', () => {
  it('pushes local-only keys, takes cloud-only keys and links identical ones', () => {
    const l = local({ 'guitar.trainer.v1': { text: '{"a":1}' }, 'guitar.practice.v1': { text: '{"v":2}' } });
    const c = [cloud('guitar.practice.v1', { v: 2 }, 3), cloud('piece.trainer.v1', { p: 1 }, 1)];
    const p = plan(l, c, 'merge');
    expect(action(p, 'guitar.trainer.v1')).toBe('push');
    expect(action(p, 'guitar.practice.v1')).toBe('link');
    expect(action(p, 'piece.trainer.v1')).toBe('take');
    expect(conflicts(l, c)).toEqual([]);
  });
  it('asks on first sign-in only when both sides differ, and honours the choice', () => {
    const l = local({ 'guitar.trainer.v1': { text: '{"a":"device"}', meta: meta(0, '2026-11-11T09:00:00.000Z', true) }, 'piece.trainer.v1': { text: '{"p":"device"}' } });
    const c = [cloud('guitar.trainer.v1', { a: 'cloud' }, 2, '2026-11-10T09:00:00.000Z'), cloud('piece.trainer.v1', { p: 'cloud' }, 5, '2026-11-10T09:00:00.000Z')];
    expect(conflicts(l, c)).toEqual(['guitar.trainer.v1', 'piece.trainer.v1']);
    expect(plan(l, c, 'device').filter(p => p.action === 'push').map(p => p.key)).toEqual(['guitar.trainer.v1', 'piece.trainer.v1']);
    expect(plan(l, c, 'cloud').filter(p => p.action === 'take').map(p => p.key)).toEqual(['guitar.trainer.v1', 'piece.trainer.v1']);
    // Merge: the trainer copy here changed after the cloud copy; untracked local Pieces progress counts as older.
    const merged = plan(l, c, 'merge');
    expect(action(merged, 'guitar.trainer.v1')).toBe('push');
    expect(action(merged, 'piece.trainer.v1')).toBe('take');
    expect(merged.find(p => p.key === 'guitar.trainer.v1')!.baseVersion).toBe(2);
  });
  it('on a linked device, takes newer cloud copies unless this device changed more recently', () => {
    const c = [cloud('guitar.trainer.v1', { a: 'other device' }, 4, '2026-11-11T10:00:00.000Z'), cloud('guitar.practice.v1', { v: 'cloud' }, 2, '2026-11-11T10:00:00.000Z'), cloud('piece.trainer.v1', { p: 1 }, 7)];
    const l = local({
      'guitar.trainer.v1': { text: '{"a":"old"}', meta: meta(3) },
      'guitar.practice.v1': { text: '{"v":"edited here"}', meta: meta(1, '2026-11-11T11:00:00.000Z', true) },
      'piece.trainer.v1': { text: '{"p":2}', meta: meta(7, '2026-11-11T11:00:00.000Z', true) },
    });
    const p = plan(l, c, 'linked');
    expect(action(p, 'guitar.trainer.v1')).toBe('take');
    expect(action(p, 'guitar.practice.v1')).toBe('push');
    expect(action(p, 'piece.trainer.v1')).toBe('push');
    const stale = plan(local({ 'guitar.practice.v1': { text: '{"v":"edited earlier"}', meta: meta(1, '2026-11-11T09:00:00.000Z', true) } }), c, 'linked');
    expect(action(stale, 'guitar.practice.v1')).toBe('take');
  });
});
