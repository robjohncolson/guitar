import { describe, expect, it } from 'vitest';
import { loadVersioned, type StorageLike } from '../src/storage/migrate';
import { readPieceProgress } from '../src/piece/progress';
import { readProgress } from '../src/trainer/progress';

/** A localStorage stand-in that also counts writes, so "idempotent" means the second read writes nothing. */
class Store implements StorageLike {
  data = new Map<string, string>();
  writes: string[] = [];
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.writes.push(key);
    this.data.set(key, value);
  }
}

const parse = (value: unknown) => value as Record<string, unknown>;
const KEY = 'piece.trainer.v1';
const OLD = JSON.stringify({ version: 1, units: { 'p|LR:1-4': { rung: 2 } }, dailyGoal: 9 });
const migrate12 = { 1: (value: Record<string, unknown>) => ({ ...value, migrated: true }) };

describe('versioned local storage', () => {
  it('migrates old-format data, keeps it readable, and backs up the exact old text', () => {
    const store = new Store();
    store.setItem(KEY, OLD);
    const loaded = loadVersioned(KEY, { currentVersion: 2, migrations: migrate12, parse }, store);

    expect(loaded.status).toBe('migrated');
    expect(loaded.changed).toBe(true);
    expect(loaded.readOnly).toBe(false);
    expect(loaded.value.version).toBe(2);
    expect(loaded.value.units).toEqual({ 'p|LR:1-4': { rung: 2 } });
    expect(loaded.value.dailyGoal).toBe(9);
    expect(loaded.value.migrated).toBe(true);
    expect(JSON.parse(store.getItem(KEY)!).version).toBe(2);
    expect(store.getItem(`${KEY}.backup.v1`)).toBe(OLD);
  });

  it('reads an old key name into the current one without deleting or rewriting the old key', () => {
    const store = new Store(),
      oldKey = 'piece.trainer.old';
    store.setItem(oldKey, JSON.stringify({ version: 1, dailyGoal: 4 }));
    const loaded = loadVersioned(KEY, { currentVersion: 1, legacyKeys: [oldKey], parse }, store);

    expect(loaded.value.dailyGoal).toBe(4);
    expect(loaded.sourceKey).toBe(oldKey);
    expect(loaded.changed).toBe(true);
    expect(store.getItem(oldKey)).toBe(JSON.stringify({ version: 1, dailyGoal: 4 }));
    expect(JSON.parse(store.getItem(KEY)!).dailyGoal).toBe(4);
  });

  it('quarantines corrupt text and never deletes or rewrites the original', () => {
    for (const raw of ['{"version":1,', '[]', '{"units":{}}', 'null']) {
      const store = new Store();
      store.setItem(KEY, raw);
      const loaded = loadVersioned(KEY, { currentVersion: 1, parse }, store);

      expect(loaded.status, raw).toBe('corrupt');
      expect(loaded.readOnly, raw).toBe(false);
      expect(store.getItem(KEY), raw).toBe(raw);
      expect(store.getItem(`${KEY}.quarantine`), raw).toBe(raw);
      expect(loaded.warning, raw).toContain(`${KEY}.quarantine`);
    }
  });

  it('preserves future-version data untouched and refuses to overwrite it', () => {
    const store = new Store(),
      raw = JSON.stringify({ version: 99, units: { test: {} } });
    store.setItem(KEY, raw);
    store.writes = [];
    const loaded = loadVersioned(KEY, { currentVersion: 1, parse }, store);

    expect(loaded.status).toBe('future');
    expect(loaded.readOnly).toBe(true);
    expect(store.getItem(KEY)).toBe(raw);
    expect(store.getItem(`${KEY}.quarantine`)).toBeNull();
    expect(store.writes).toEqual([]);
    expect(loaded.warning).toContain('newer version');
  });

  it('does not overwrite a backup that already exists', () => {
    const store = new Store();
    store.setItem(KEY, OLD);
    store.setItem(`${KEY}.backup.v1`, 'the first saved copy');
    loadVersioned(KEY, { currentVersion: 2, migrations: migrate12, parse }, store);
    expect(store.getItem(`${KEY}.backup.v1`)).toBe('the first saved copy');
  });

  it('is idempotent: a second read migrates nothing and writes nothing', () => {
    const store = new Store();
    store.setItem(KEY, OLD);
    const first = loadVersioned(KEY, { currentVersion: 2, migrations: migrate12, parse }, store);
    const writes = [...store.writes];
    const second = loadVersioned(KEY, { currentVersion: 2, migrations: migrate12, parse }, store);

    expect(first.status).toBe('migrated');
    expect(second.status).toBe('ok');
    expect(second.changed).toBe(false);
    expect(second.value).toEqual(first.value);
    expect(store.writes).toEqual(writes);
    expect(store.getItem(`${KEY}.backup.v1`)).toBe(OLD);
  });

  it('quarantines an old version it has no migration for and leaves it in place', () => {
    const store = new Store();
    store.setItem(KEY, OLD);
    const loaded = loadVersioned(KEY, { currentVersion: 2, parse }, store);

    expect(loaded.status).toBe('unsupported');
    expect(store.getItem(KEY)).toBe(OLD);
    expect(store.getItem(`${KEY}.quarantine`)).toBe(OLD);
  });
});

describe('saved progress through the loader', () => {
  it('keeps existing piece progress readable', () => {
    const store = new Store();
    store.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        units: { 'x|LR:1-4': { rung: 2, attempts: 3, best: 0.8 } },
        dailyGoal: 9,
        selected: { piece: 'x', unit: 'LR:1-4', instrument: 'piano' },
      }),
    );
    const loaded = readPieceProgress(undefined, store);
    expect(loaded.status).toBe('ok');
    expect(loaded.value.units['x|LR:1-4']).toMatchObject({ rung: 2, attempts: 3, best: 0.8 });
    expect(loaded.value.dailyGoal).toBe(9);
    expect(loaded.value.selected.piece).toBe('x');
  });

  it('keeps existing guitar course progress readable', () => {
    const store = new Store();
    store.setItem(
      'guitar.trainer.v1',
      JSON.stringify({ version: 1, selected: 'pulse', offset: 0.05, calibrated: true, skills: {} }),
    );
    const loaded = readProgress(store);
    expect(loaded.status).toBe('ok');
    expect(loaded.value.selected).toBe('pulse');
    expect(loaded.value.offset).toBeCloseTo(0.05);
    expect(loaded.value.calibrated).toBe(true);
  });
});
