/**
 * Offline-first JSON backups. One versioned file carries the progress keys, the owner's local pieces and the input
 * preferences; it never carries the AI reader's key or the old sync bookkeeping. Reading validates every part before
 * anything is written, and a restore keeps the previous text so a storage error can roll the whole write back.
 */
import { defaultStore, loadVersioned, quarantineRaw, type StorageLike } from './migrate';
import { parseProgress, type Progress } from '../trainer/progress';
import { mergeWeakSpots } from '../piece/spot';
import { LOG_DAYS, parsePieceProgress, type DayLog, type PieceProgress, type PieceTake } from '../piece/progress';
import { MAX_BYTES, MAX_PIECES, type Mine } from '../piece/mine';

export interface BackupStore extends StorageLike {
  removeItem(key: string): void;
}

export const BACKUP_FORMAT = 'clean-take-backup';
export const BACKUP_VERSION = 1;
/** The parts a backup may contain, in the order they are written. */
export const BACKUP_KEYS = ['guitar.trainer.v1', 'piece.trainer.v1', 'piece.imported.v1', 'piece.input.v1'] as const;
export type BackupKey = (typeof BACKUP_KEYS)[number];
/** Asked for by name: a reader key is a secret and sync bookkeeping belongs to a service that is switched off. */
export const NEVER_BACKUP_KEYS = ['piece.reader.v1', 'guitar.sync.v1'] as const;
/** Input preferences are device settings, kept here so a backup can carry them without opening piece/main.ts. */
export type InputPreferences = Record<string, unknown>;
export type BackupData = {
  'guitar.trainer.v1'?: Progress;
  'piece.trainer.v1'?: PieceProgress;
  'piece.imported.v1'?: Mine[];
  'piece.input.v1'?: InputPreferences;
};
export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  data: Partial<BackupData>;
}
export interface BackupSummary {
  exportedAt: string;
  /** Pieces the owner added himself. */
  pieces: number;
  /** Piece steps that have a saved record. */
  steps: number;
  /** Days with saved piece practice. */
  days: number;
  /** Guitar lessons that have a saved record. */
  lessons: number;
  parts: BackupKey[];
}
export type RestoreMode = 'merge' | 'replace';

export type ReadBackupResult = { ok: true; backup: Backup; summary: BackupSummary } | { ok: false; reason: string };
export type RestoreResult = { ok: true; written: BackupKey[] } | { ok: false; reason: string };
export type ImportResult = { ok: true; summary: BackupSummary; written: BackupKey[] } | { ok: false; reason: string };

const LABELS: Record<BackupKey, string> = {
  'guitar.trainer.v1': 'guitar course progress',
  'piece.trainer.v1': 'Pieces progress',
  'piece.imported.v1': 'your own pieces',
  'piece.input.v1': 'input settings',
};
const LENIENCIES = ['tight', 'standard', 'relaxed', 'loose'] as const;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const tempStore = (key: string, raw: string): StorageLike => ({
  getItem: (name) => (name === key ? raw : null),
  setItem: () => undefined,
});
const versioned = <T>(key: BackupKey, raw: string, parse: (raw: string | null) => T): T | undefined => {
  try {
    const loaded = loadVersioned<T>(
      key,
      { currentVersion: BACKUP_VERSION, parse: (value) => parse(value == null ? null : JSON.stringify(value)) },
      tempStore(key, raw),
    );
    return loaded.status === 'ok' || loaded.status === 'migrated' ? loaded.value : undefined;
  } catch {
    return undefined;
  }
};

function readTrainer(value: unknown): Progress | undefined {
  if (!isRecord(value) || value.version !== BACKUP_VERSION) return undefined;
  if (value.skills !== undefined && !isRecord(value.skills)) return undefined;
  if (value.history !== undefined && !Array.isArray(value.history)) return undefined;
  if (value.selected !== undefined && typeof value.selected !== 'string') return undefined;
  return versioned('guitar.trainer.v1', JSON.stringify(value), parseProgress);
}

function readPiece(value: unknown): PieceProgress | undefined {
  if (!isRecord(value) || value.version !== BACKUP_VERSION) return undefined;
  for (const part of ['units', 'goals', 'bests', 'today', 'weakSpots'] as const)
    if (value[part] !== undefined && !isRecord(value[part])) return undefined;
  for (const part of ['history', 'log'] as const)
    if (value[part] !== undefined && !Array.isArray(value[part])) return undefined;
  if (value.selected !== undefined && !isRecord(value.selected)) return undefined;
  if (value.dailyGoal !== undefined && typeof value.dailyGoal !== 'number') return undefined;
  return versioned('piece.trainer.v1', JSON.stringify(value), (raw) => parsePieceProgress(raw));
}

function readPieces(value: unknown): Mine[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_PIECES) return undefined;
  const ids = new Set<string>(),
    list: Mine[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.text !== 'string') return undefined;
    if (!item.id || ids.has(item.id) || textSize(item.text) > MAX_BYTES) return undefined;
    ids.add(item.id);
    list.push({ id: item.id, text: item.text });
  }
  return list;
}

function readInput(value: unknown): InputPreferences | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of ['keys', 'midiSound', 'calm'] as const)
    if (value[key] !== undefined && typeof value[key] !== 'boolean') return undefined;
  if (value.piano !== undefined && value.piano !== 'grand' && value.piano !== 'simple') return undefined;
  if (value.guitar !== undefined && value.guitar !== 'piece' && value.guitar !== 'accompany') return undefined;
  if (value.leniency !== undefined && !LENIENCIES.includes(value.leniency as (typeof LENIENCIES)[number]))
    return undefined;
  return { ...value };
}

const textSize = (text: string): number => {
  try {
    return new TextEncoder().encode(text).length;
  } catch {
    return text.length;
  }
};

function readPart(key: BackupKey, value: unknown): BackupData[BackupKey] | undefined {
  switch (key) {
    case 'guitar.trainer.v1':
      return readTrainer(value);
    case 'piece.trainer.v1':
      return readPiece(value);
    case 'piece.imported.v1':
      return readPieces(value);
    case 'piece.input.v1':
      return readInput(value);
  }
}
const isBackupKey = (key: string): key is BackupKey => (BACKUP_KEYS as readonly string[]).includes(key);

export function defaultBackupStore(): BackupStore | undefined {
  const store = defaultStore() as (StorageLike & Partial<BackupStore>) | undefined;
  return store && typeof store.removeItem === 'function' ? (store as BackupStore) : undefined;
}

/** A valid backup file, or undefined when the value is not a backup this build can use. */
function checkBackup(value: unknown): { backup: Backup } | { reason: string } {
  if (!isRecord(value) || value.format !== BACKUP_FORMAT)
    return { reason: 'This file is not a Clean Take backup, so nothing was imported.' };
  if (typeof value.version !== 'number' || !Number.isInteger(value.version))
    return { reason: 'This backup does not say which version it is, so nothing was imported.' };
  if (value.version > BACKUP_VERSION)
    return { reason: 'This backup was made by a newer version of Clean Take, so nothing was imported.' };
  if (value.version !== BACKUP_VERSION)
    return { reason: 'This backup is from an older version of Clean Take that this page cannot read.' };
  if (typeof value.exportedAt !== 'string' || Number.isNaN(Date.parse(value.exportedAt)))
    return { reason: 'This backup does not say when it was made, so nothing was imported.' };
  if (!isRecord(value.data)) return { reason: 'This backup contains no saved progress, so nothing was imported.' };

  const data: Backup['data'] = {};
  for (const [key, part] of Object.entries(value.data)) {
    if (!isBackupKey(key))
      return { reason: 'This backup contains a part that Clean Take does not recognise, so nothing was imported.' };
    const checked = readPart(key, part);
    if (!checked) return { reason: `The ${LABELS[key]} part of this backup is not valid, so nothing was imported.` };
    (data as Record<string, unknown>)[key] = checked;
  }
  return {
    backup: {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: value.exportedAt,
      data,
    },
  };
}

/**
 * Reads the saved values into one backup. A part that cannot be read is left out and named in `skipped`, so a corrupt
 * save is never presented as a good backup. Reader and sync keys are never read.
 */
export function createBackup(store?: BackupStore, now: Date = new Date()): { backup: Backup; skipped: BackupKey[] } {
  const s = store ?? defaultBackupStore(),
    data: Backup['data'] = {},
    skipped: BackupKey[] = [];
  if (s)
    for (const key of BACKUP_KEYS) {
      let raw: string | null = null;
      try {
        raw = s.getItem(key);
      } catch {
        raw = null;
      }
      if (raw === null) continue;
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        skipped.push(key);
        continue;
      }
      const part = readPart(key, value);
      if (!part) {
        skipped.push(key);
        continue;
      }
      (data as Record<string, unknown>)[key] = part;
    }
  return {
    backup: { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(), data },
    skipped,
  };
}

export const backupText = (backup: Backup): string => `${JSON.stringify(backup, null, 2)}\n`;
export const backupFilename = (date: Date = new Date()): string =>
  `clean-take-backup-${date.toISOString().slice(0, 10)}.json`;

export function summaryOf(backup: Backup): BackupSummary {
  const piece = backup.data['piece.trainer.v1'],
    trainer = backup.data['guitar.trainer.v1'];
  return {
    exportedAt: backup.exportedAt,
    pieces: backup.data['piece.imported.v1']?.length ?? 0,
    steps: piece ? Object.keys(piece.units).length : 0,
    days: piece ? piece.log.length : 0,
    lessons: trainer ? Object.keys(trainer.skills).length : 0,
    parts: BACKUP_KEYS.filter((key) => backup.data[key] !== undefined),
  };
}

/** One plain sentence for the preview and the status line. */
export function summaryText(summary: BackupSummary): string {
  const date = new Date(summary.exportedAt).toLocaleDateString(),
    pieces = `${summary.pieces} of your own piece${summary.pieces === 1 ? '' : 's'}`,
    steps = `${summary.steps} piece step${summary.steps === 1 ? '' : 's'}`,
    days = `${summary.days} practised day${summary.days === 1 ? '' : 's'}`,
    lessons = `${summary.lessons} guitar lesson${summary.lessons === 1 ? '' : 's'}`;
  return `Backup from ${date}: ${pieces}, ${steps}, ${days}, ${lessons}.`;
}

export function readBackup(text: string): ReadBackupResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'That file could not be read as JSON, so nothing was imported.' };
  }
  const checked = checkBackup(value);
  if ('reason' in checked) return { ok: false, reason: checked.reason };
  return { ok: true, backup: checked.backup, summary: summaryOf(checked.backup) };
}

function mergeTrainerHistory(local: Progress['history'], incoming: Progress['history']): Progress['history'] {
  const seen = new Set<string>(),
    all: Progress['history'] = [];
  for (const take of [...local, ...incoming]) {
    const key = `${take.date}|${take.lesson}|${take.bpm}|${take.score}|${take.trusted}`;
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(take);
  }
  return all.sort((a, b) => a.date - b.date).slice(-60);
}

function mergeTrainer(local: Progress, incoming: Progress): Progress {
  const skills = { ...local.skills };
  for (const [id, skill] of Object.entries(incoming.skills)) {
    const before = skills[id];
    if (!before || skill.last > before.last) skills[id] = skill;
  }
  const hasOwnProgress = local.history.length > 0 || Object.keys(local.skills).length > 0;
  return {
    ...local,
    skills,
    history: mergeTrainerHistory(local.history, incoming.history),
    selected: hasOwnProgress ? local.selected : incoming.selected,
    // A device that has measured its own sound delay keeps it; a fresh browser takes the backup's.
    ...(local.calibrated
      ? {}
      : { offset: incoming.offset, calibrated: incoming.calibrated, calibrationKey: incoming.calibrationKey }),
  };
}

const takeKey = (take: PieceTake): string =>
  `${take.date}|${take.piece}|${take.unit}|${take.bpm}|${take.score}|${take.trusted}|${Boolean(take.clean)}`;

function mergePieceHistory(local: PieceTake[], incoming: PieceTake[]): PieceTake[] {
  const seen = new Set<string>(),
    all: PieceTake[] = [];
  for (const take of [...local, ...incoming]) {
    const key = takeKey(take);
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(take);
  }
  return all.sort((a, b) => a.date - b.date).slice(-200);
}

/** The same practised day counted once: the larger figure from either copy, never a sum that doubles a session. */
function mergeDays(local: DayLog[], incoming: DayLog[]): DayLog[] {
  const days = new Map<string, DayLog>();
  for (const day of [...local, ...incoming]) {
    const before = days.get(day.day);
    days.set(
      day.day,
      before
        ? {
            day: day.day,
            takes: Math.max(before.takes, day.takes),
            clean: Math.max(before.clean, day.clean),
            seconds: Math.max(before.seconds, day.seconds),
          }
        : { ...day },
    );
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-LOG_DAYS);
}

function mergePiece(local: PieceProgress, incoming: PieceProgress): PieceProgress {
  const units = { ...local.units },
    bests = { ...local.bests };
  for (const [id, unit] of Object.entries(incoming.units)) {
    const before = units[id];
    if (!before || unit.last > before.last) units[id] = unit;
  }
  for (const [id, best] of Object.entries(incoming.bests)) {
    const before = bests[id];
    if (!before || best.date > before.date) bests[id] = best;
  }
  const hasOwnProgress =
    local.history.length > 0 || Object.keys(local.units).length > 0 || Boolean(local.selected.piece);
  return {
    ...local,
    units,
    bests,
    // The learner's own goals and today's fixed checklist win; the backup fills in what this browser has no copy of.
    goals: { ...incoming.goals, ...local.goals },
    today: { ...incoming.today, ...local.today },
    weakSpots: mergeWeakSpots(local.weakSpots ?? {}, incoming.weakSpots ?? {}),
    history: mergePieceHistory(local.history, incoming.history),
    log: mergeDays(local.log, incoming.log),
    dailyGoal: local.dailyGoal === 6 ? incoming.dailyGoal : local.dailyGoal,
    selected: hasOwnProgress ? local.selected : incoming.selected,
    ...(local.calibrated
      ? {}
      : {
          offset: incoming.offset,
          calibrated: incoming.calibrated,
          calibrationKey: incoming.calibrationKey,
          ...(incoming.latency === undefined ? {} : { latency: incoming.latency }),
        }),
  };
}

function mergePieces(local: Mine[], incoming: Mine[]): Mine[] | string {
  const byId = new Map(local.map((piece) => [piece.id, piece]));
  for (const piece of incoming) if (!byId.has(piece.id)) byId.set(piece.id, piece);
  const list = [...byId.values()];
  return list.length <= MAX_PIECES
    ? list
    : `The backup would bring more than ${MAX_PIECES} pieces, so nothing was imported. Remove a piece first.`;
}

/**
 * Adds a checked backup to `store`. Merge keeps this browser's newer per-step state, adds the file's other steps and
 * pieces, and keeps the device's own goals and input settings. Replace uses the file's copy for every part it contains.
 * Parts the file does not contain are left alone in both modes. Nothing is written until every target value is valid;
 * an unreadable saved key is copied to `<key>.quarantine` first, and a failed write restores every key it touched.
 */
export function restoreBackup(backup: Backup, mode: RestoreMode, store?: BackupStore): RestoreResult {
  const checked = checkBackup(backup);
  if ('reason' in checked) return { ok: false, reason: checked.reason };
  const incoming = checked.backup.data,
    s = store ?? defaultBackupStore();
  if (!s) return { ok: false, reason: 'Browser storage is unavailable, so nothing was imported.' };

  const writes: { key: BackupKey; text: string; raw: string | null; unreadable: boolean }[] = [];
  const localPart = (key: BackupKey): unknown => {
    let raw: string | null = null;
    try {
      raw = s.getItem(key);
    } catch {
      raw = null;
    }
    if (raw === null) return undefined;
    try {
      return readPart(key, JSON.parse(raw));
    } catch {
      return undefined;
    }
  };
  for (const key of BACKUP_KEYS) {
    const part = incoming[key];
    if (part === undefined) continue;
    const before = localPart(key);
    let next: unknown;
    if (mode === 'replace' || before === undefined) next = part;
    else
      switch (key) {
        case 'guitar.trainer.v1':
          next = mergeTrainer(before as Progress, part as Progress);
          break;
        case 'piece.trainer.v1':
          next = mergePiece(before as PieceProgress, part as PieceProgress);
          break;
        case 'piece.imported.v1': {
          const merged = mergePieces(before as Mine[], part as Mine[]);
          if (typeof merged === 'string') return { ok: false, reason: merged };
          next = merged;
          break;
        }
        case 'piece.input.v1':
          // Input settings describe this device, so a merge never changes them when this browser already has a copy.
          next = before;
          break;
      }
    const stillValid = readPart(key, next);
    if (!stillValid)
      return { ok: false, reason: `The ${LABELS[key]} part could not be prepared, so nothing was imported.` };
    let raw: string | null = null;
    try {
      raw = s.getItem(key);
    } catch {
      raw = null;
    }
    writes.push({
      key,
      text: JSON.stringify(stillValid),
      raw,
      unreadable: raw !== null && before === undefined,
    });
  }
  if (!writes.length) return { ok: true, written: [] };

  // Keep unreadable saved text before an explicit restore replaces it. A failed copy stops the restore.
  for (const write of writes)
    if (write.unreadable && !quarantineRaw(write.key, write.raw!, s))
      return {
        ok: false,
        reason: 'Saved text that could not be read could not be copied aside, so nothing was imported.',
      };

  const written: BackupKey[] = [];
  try {
    for (const write of writes) {
      written.push(write.key);
      s.setItem(write.key, write.text);
    }
  } catch {
    // Put every key back exactly as it was, including the one whose write failed.
    for (const key of written) {
      const original = writes.find((write) => write.key === key)!.raw;
      try {
        if (original === null) s.removeItem(key);
        else s.setItem(key, original);
      } catch {
        /* best effort: the original text was never deliberately deleted */
      }
    }
    return { ok: false, reason: 'Browser storage is full or unavailable, so nothing was changed.' };
  }
  return { ok: true, written };
}

/** Read, validate and restore in one step: used by the two pages, and the whole path in the tests. */
export function importBackup(text: string, mode: RestoreMode, store?: BackupStore): ImportResult {
  const read = readBackup(text);
  if (!read.ok) return read;
  const restored = restoreBackup(read.backup, mode, store);
  return restored.ok ? { ok: true, summary: read.summary, written: restored.written } : restored;
}
