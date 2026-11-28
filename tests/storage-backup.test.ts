import { describe, expect, it } from 'vitest';
import {
  backupFilename,
  backupText,
  BACKUP_KEYS,
  createBackup,
  importBackup,
  NEVER_BACKUP_KEYS,
  readBackup,
  restoreBackup,
  summaryOf,
  type BackupStore,
} from '../src/storage/backup';
import { initialSkill, parseProgress, type Progress } from '../src/trainer/progress';
import { initialUnit, parsePieceProgress, type PieceProgress } from '../src/piece/progress';
import { lessons } from '../src/trainer/curriculum';
import type { Mine } from '../src/piece/mine';

class Store implements BackupStore {
  data = new Map<string, string>();
  writes: string[] = [];
  failOnce: string | null = null;
  private failed = false;
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.writes.push(key);
    if (key === this.failOnce && !this.failed) {
      this.failed = true;
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    }
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.writes.push(key);
    this.data.delete(key);
  }
}

const lesson = lessons[0];
const trainer = (): Progress => {
  const progress = parseProgress(null);
  progress.selected = lesson.id;
  progress.skills[lesson.id] = { ...initialSkill(lesson), bpm: 64, best: 64, last: 1000, attempts: 3 };
  progress.history = [{ date: 1000, lesson: lesson.id, bpm: 64, score: 0.92, trusted: true }];
  return progress;
};
const piece = (over: Partial<PieceProgress> = {}): PieceProgress => ({
  ...parsePieceProgress(null),
  ...over,
});
const mine = (id: string, title: string): Mine => ({ id, text: `title: ${title}\ncomposer: Test\n` });
const input = { keys: true, midiSound: false, calm: false, piano: 'simple', guitar: 'piece', leniency: 'tight' };

const filled = () => {
  const store = new Store();
  store.setItem('guitar.trainer.v1', JSON.stringify(trainer()));
  store.setItem(
    'piece.trainer.v1',
    JSON.stringify(
      piece({
        units: { 'one|R:1-4': { ...initialUnit(), rung: 2, best: 0.8, last: 1000, attempts: 4 } },
        goals: { one: 72 },
        history: [{ date: 1000, piece: 'one', unit: 'R:1-4', bpm: 60, score: 0.85, trusted: true }],
        log: [{ day: '2026-11-20', takes: 3, clean: 2, seconds: 240 }],
        selected: { piece: 'one', unit: 'R:1-4', instrument: 'piano' },
      }),
    ),
  );
  store.setItem('piece.imported.v1', JSON.stringify([mine('mine:one', 'One')]));
  store.setItem('piece.input.v1', JSON.stringify(input));
  return store;
};
const snapshot = (store: Store) => [...store.data.entries()].sort(([a], [b]) => a.localeCompare(b));

describe('offline JSON backup', () => {
  it('round-trips the four saved parts and never includes the reader key or sync bookkeeping', () => {
    const source = filled();
    source.setItem('piece.reader.v1', JSON.stringify({ address: 'https://example.test', key: 'secret' }));
    source.setItem('guitar.sync.v1', JSON.stringify({ user: 'someone', keys: {} }));

    const { backup } = createBackup(source);
    expect(Object.keys(backup.data).sort()).toEqual([...BACKUP_KEYS].sort());
    expect(backup.data).not.toHaveProperty('piece.reader.v1');
    expect(backup.data).not.toHaveProperty('guitar.sync.v1');
    expect(NEVER_BACKUP_KEYS).toEqual(['piece.reader.v1', 'guitar.sync.v1']);
    expect(backupFilename(new Date('2026-11-27T12:00:00.000Z'))).toBe('clean-take-backup-2026-11-27.json');

    const summary = summaryOf(backup);
    expect(summary).toMatchObject({ pieces: 1, steps: 1, days: 1, lessons: 1 });

    const read = readBackup(backupText(backup));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.summary.parts).toEqual([...BACKUP_KEYS]);

    const target = new Store();
    const result = importBackup(backupText(backup), 'replace', target);
    expect(result.ok).toBe(true);
    expect(JSON.parse(target.getItem('guitar.trainer.v1')!)).toMatchObject({ selected: lesson.id });
    expect(JSON.parse(target.getItem('piece.trainer.v1')!).units['one|R:1-4'].rung).toBe(2);
    expect(JSON.parse(target.getItem('piece.imported.v1')!)).toEqual([mine('mine:one', 'One')]);
    expect(JSON.parse(target.getItem('piece.input.v1')!)).toEqual(input);
    expect(target.getItem('piece.reader.v1')).toBeNull();
    expect(target.getItem('guitar.sync.v1')).toBeNull();
  });

  it('round-trips saves with weak spots, and still reads saves without them', () => {
    const weak = { unit: 'R:1-4', from: 1, to: 2, hands: ['R'] as ('L' | 'R')[], due: 1000, count: 2 };
    const source = new Store();
    source.setItem('piece.trainer.v1', JSON.stringify(piece({ weakSpots: { one: [weak] } })));
    const { backup } = createBackup(source);
    const read = readBackup(backupText(backup));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const target = new Store();
    expect(restoreBackup(read.backup, 'replace', target).ok).toBe(true);
    expect(JSON.parse(target.getItem('piece.trainer.v1')!).weakSpots).toEqual({ one: [weak] });

    const old = new Store();
    old.setItem('piece.trainer.v1', JSON.stringify({ version: 1, units: {} }));
    const oldBackup = createBackup(old).backup;
    const oldRead = readBackup(backupText(oldBackup));
    expect(oldRead.ok).toBe(true);
    const oldTarget = new Store();
    expect(restoreBackup(oldBackup, 'replace', oldTarget).ok).toBe(true);
    expect(JSON.parse(oldTarget.getItem('piece.trainer.v1')!).weakSpots).toEqual({});
  });

  it('rejects malformed, future and foreign files without writing anything', () => {
    const store = new Store();
    store.setItem('guitar.trainer.v1', JSON.stringify(trainer()));
    const before = snapshot(store);
    const envelope = (data: unknown, version = 1) =>
      JSON.stringify({
        format: 'clean-take-backup',
        version,
        exportedAt: '2026-11-27T12:00:00.000Z',
        data,
      });
    const bad = [
      'not JSON',
      JSON.stringify({ format: 'something-else', version: 1, exportedAt: '2026-11-27T12:00:00.000Z', data: {} }),
      envelope({ 'guitar.trainer.v1': { version: 1, skills: 'nope' } }),
      envelope({}, 2),
      envelope({ 'piece.reader.v1': { key: 'secret' } }),
      envelope({ 'guitar.sync.v1': { user: 'someone' } }),
      envelope({ 'piece.imported.v1': [{ id: 'mine:x' }] }),
    ];
    for (const text of bad) {
      const result = importBackup(text, 'replace', store);
      expect(result.ok, text).toBe(false);
      expect(snapshot(store), text).toEqual(before);
    }
  });

  it('merge keeps this browser’s newer steps and own pieces, while replace uses the file’s copy', () => {
    const source = filled();
    source.setItem(
      'piece.trainer.v1',
      JSON.stringify(
        piece({
          units: {
            'one|R:1-4': { ...initialUnit(), rung: 1, best: 0.6, last: 5000, attempts: 2 },
            'one|R:5-8': { ...initialUnit(), rung: 3, best: 0.9, last: 4000, attempts: 5 },
          },
          goals: { one: 80 },
          selected: { piece: 'one', unit: 'R:5-8', instrument: 'piano' },
        }),
      ),
    );
    source.setItem('piece.imported.v1', JSON.stringify([mine('mine:one', 'File version'), mine('mine:two', 'Two')]));
    const read = readBackup(backupText(createBackup(source).backup));
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    const local = () => {
      const store = filled();
      store.setItem(
        'piece.trainer.v1',
        JSON.stringify(
          piece({
            units: {
              'one|R:1-4': { ...initialUnit(), rung: 2, best: 0.8, last: 1000, attempts: 4 },
              'one|R:9-12': { ...initialUnit(), rung: 1, best: 0.7, last: 2000, attempts: 1 },
            },
            goals: { one: 72 },
          }),
        ),
      );
      store.setItem(
        'piece.imported.v1',
        JSON.stringify([mine('mine:one', 'This browser’s version'), mine('mine:three', 'Three')]),
      );
      store.setItem('piece.input.v1', JSON.stringify({ ...input, piano: 'grand' }));
      return store;
    };

    const merged = local();
    expect(restoreBackup(read.backup, 'merge', merged).ok).toBe(true);
    const mergedPiece = JSON.parse(merged.getItem('piece.trainer.v1')!) as PieceProgress;
    expect(Object.keys(mergedPiece.units).sort()).toEqual(['one|R:1-4', 'one|R:5-8', 'one|R:9-12']);
    expect(mergedPiece.units['one|R:1-4'].rung).toBe(1); // the file's copy of this step is newer
    expect(mergedPiece.units['one|R:9-12'].rung).toBe(1); // a step only this browser has stays
    expect(mergedPiece.goals.one).toBe(72); // the learner's own goal wins
    expect((JSON.parse(merged.getItem('piece.imported.v1')!) as Mine[]).map((p) => p.id).sort()).toEqual([
      'mine:one',
      'mine:three',
      'mine:two',
    ]);
    expect(
      (JSON.parse(merged.getItem('piece.imported.v1')!) as Mine[]).find((p) => p.id === 'mine:one')!.text,
    ).toContain('This browser’s version');
    expect(JSON.parse(merged.getItem('piece.input.v1')!).piano).toBe('grand');

    const replaced = local();
    expect(restoreBackup(read.backup, 'replace', replaced).ok).toBe(true);
    const replacedPiece = JSON.parse(replaced.getItem('piece.trainer.v1')!) as PieceProgress;
    expect(Object.keys(replacedPiece.units).sort()).toEqual(['one|R:1-4', 'one|R:5-8']);
    expect(replacedPiece.units['one|R:1-4'].rung).toBe(1);
    expect((JSON.parse(replaced.getItem('piece.imported.v1')!) as Mine[]).map((p) => p.id).sort()).toEqual([
      'mine:one',
      'mine:two',
    ]);
    expect(JSON.parse(replaced.getItem('piece.input.v1')!).piano).toBe('simple');
  });

  it('rolls every key back when a write fails', () => {
    const source = filled();
    const before = filled();
    const originals = snapshot(before);
    const target = before;
    target.failOnce = 'piece.trainer.v1';
    const result = importBackup(backupText(createBackup(source).backup), 'replace', target);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('nothing was changed');
    expect(snapshot(target)).toEqual(originals);
  });

  it('keeps the exact old text beside a key it had to replace, and refuses an unreadable backup part', () => {
    const source = filled();
    const target = new Store();
    target.setItem('guitar.trainer.v1', '{"version":1,');
    const result = importBackup(backupText(createBackup(source).backup), 'replace', target);
    expect(result.ok).toBe(true);
    expect(target.getItem('guitar.trainer.v1.quarantine')).toBe('{"version":1,');
    expect(JSON.parse(target.getItem('guitar.trainer.v1')!).version).toBe(1);

    const broken = new Store();
    broken.setItem('piece.imported.v1', JSON.stringify([mine('mine:bad', 'Bad')]));
    const before = snapshot(broken);
    const partial = JSON.stringify({
      format: 'clean-take-backup',
      version: 1,
      exportedAt: '2026-11-27T12:00:00.000Z',
      data: {
        'guitar.trainer.v1': trainer(),
        'piece.imported.v1': [{ id: 'mine:two', text: 'title: Two\n', extra: true }],
      },
    });
    expect(importBackup(partial, 'merge', broken).ok).toBe(true);
    expect(snapshot(broken)).not.toEqual(before);

    const invalid = JSON.stringify({
      format: 'clean-take-backup',
      version: 1,
      exportedAt: '2026-11-27T12:00:00.000Z',
      data: { 'piece.imported.v1': [{ id: 'mine:two' }] },
    });
    const keep = snapshot(broken);
    expect(importBackup(invalid, 'merge', broken).ok).toBe(false);
    expect(snapshot(broken)).toEqual(keep);
  });
});
