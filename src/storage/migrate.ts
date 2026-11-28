/**
 * Versioned reads for saved practice progress. A save is only ever replaced after it has been read: old versions are
 * migrated one step at a time, the old text is kept as `<key>.backup.v<old version>`, and text this build cannot read
 * (corrupt JSON, a version it does not know) is copied to `<key>.quarantine` and never deleted or overwritten on boot.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export type VersionedValue = Record<string, unknown>;
/** One step: the value at version N becomes the value at version N + 1. */
export type Migration = (value: VersionedValue) => VersionedValue;
export interface VersionedOptions<T> {
  currentVersion: number;
  /** Version N to the step that turns it into version N + 1. */
  migrations?: Record<number, Migration>;
  /** Names the data may have had before a rename. They are read, never deleted or rewritten. */
  legacyKeys?: readonly string[];
  parse: (value: unknown) => T;
}
export type LoadStatus = 'ok' | 'migrated' | 'missing' | 'corrupt' | 'future' | 'unsupported';
export interface Loaded<T> {
  value: T;
  status: LoadStatus;
  /** The version that was read, when the text was readable. */
  version: number | null;
  /** The saved text was migrated, moved from an old key, or otherwise rewritten. */
  changed: boolean;
  /**
   * True when there is no safe copy of what was saved, so this page must not overwrite the key. A corrupt save whose
   * quarantine copy was written is safe to replace later; a save from a newer version never is.
   */
  readOnly: boolean;
  raw: string | null;
  sourceKey: string;
  /** A plain sentence for the page's status line, when something was kept rather than used. */
  warning?: string;
}

export function defaultStore(): StorageLike | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
const read = (store: StorageLike, key: string): string | null => {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
};
/** Copies `raw` to `target` only when nothing is there yet, so the first saved copy is never overwritten. */
const copyIfAbsent = (store: StorageLike, target: string, raw: string): boolean => {
  try {
    if (store.getItem(target) !== null) return true;
    store.setItem(target, raw);
    return true;
  } catch {
    return false;
  }
};
/** Keeps unreadable saved text under `<key>.quarantine`; the original key is left exactly as it was. */
export function quarantineRaw(key: string, raw: string, store?: StorageLike): boolean {
  const s = store ?? defaultStore();
  return s ? copyIfAbsent(s, `${key}.quarantine`, raw) : false;
}

/**
 * Reads `key` (or the first of `legacyKeys` when it is missing) and returns a value this build can use. Old versions
 * are migrated forward only after their exact saved text has been backed up; corrupt text and versions this build does
 * not understand are quarantined and the key is left untouched.
 */
export function loadVersioned<T>(key: string, options: VersionedOptions<T>, store?: StorageLike): Loaded<T> {
  const s = store ?? defaultStore(),
    blank = (status: LoadStatus, extra: Partial<Loaded<T>> = {}): Loaded<T> => ({
      value: options.parse({}),
      status,
      version: null,
      changed: false,
      readOnly: false,
      raw: null,
      sourceKey: key,
      ...extra,
    });
  if (!s) return blank('missing');

  let raw = read(s, key),
    sourceKey = key;
  if (raw === null)
    for (const legacy of options.legacyKeys ?? []) {
      const found = read(s, legacy);
      if (found !== null) {
        raw = found;
        sourceKey = legacy;
        break;
      }
    }
  if (raw === null) return blank('missing');

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    value = undefined;
  }
  const record = value as VersionedValue | null,
    version = record && typeof record === 'object' && !Array.isArray(record) ? record.version : undefined;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    const kept = quarantineRaw(key, raw, s);
    return blank('corrupt', {
      raw,
      sourceKey,
      readOnly: !kept,
      warning: kept
        ? `Saved progress could not be read. A copy is kept at ${key}.quarantine; this page will not overwrite the saved copy on its own.`
        : 'Saved progress could not be read, and a copy could not be kept. This page will not overwrite it.',
    });
  }

  if (version > options.currentVersion)
    return blank('future', {
      version,
      raw,
      sourceKey,
      readOnly: true,
      warning:
        'Saved progress was made by a newer version of Clean Take, so it was left untouched. This page will not overwrite it.',
    });

  if (version === options.currentVersion) {
    const adopted = sourceKey !== key,
      saved = adopted
        ? (() => {
            try {
              s.setItem(key, raw);
              return true;
            } catch {
              return false;
            }
          })()
        : false;
    return {
      value: options.parse(record),
      // Reading a save that already lives under the current name changes nothing.
      status: saved ? 'migrated' : 'ok',
      version,
      changed: saved,
      readOnly: false,
      raw,
      sourceKey,
    };
  }

  // An old version: keep its exact text before changing anything. Without that copy, the original stays in place.
  const backup = `${key}.backup.v${version}`,
    backed = copyIfAbsent(s, backup, raw);
  if (!backed) {
    const kept = quarantineRaw(key, raw, s);
    return blank('unsupported', {
      version,
      raw,
      sourceKey,
      readOnly: !kept,
      warning: kept
        ? `Saved progress is from an older version and could not be backed up, so it was left untouched. A copy is kept at ${key}.quarantine.`
        : 'Saved progress is from an older version that could not be backed up or moved. This page will not overwrite it.',
    });
  }

  let next = record as VersionedValue,
    from = version,
    failed = false;
  try {
    while (from < options.currentVersion) {
      const step = options.migrations?.[from];
      if (!step) throw new Error(`no migration from version ${from}`);
      const stepped = step(next);
      if (!stepped || typeof stepped !== 'object' || Array.isArray(stepped))
        throw new Error(`bad migration from version ${from}`);
      next = stepped;
      from++;
    }
  } catch {
    failed = true;
  }

  if (!failed) {
    const migrated: VersionedValue = { ...next, version: options.currentVersion };
    try {
      // Read it back before it replaces anything: a migration that cannot be read is not a migration.
      const parsed = options.parse(migrated);
      s.setItem(key, JSON.stringify(migrated));
      return {
        value: parsed,
        status: 'migrated',
        version: options.currentVersion,
        changed: true,
        readOnly: false,
        raw,
        sourceKey,
      };
    } catch {
      failed = true;
    }
  }

  const kept = quarantineRaw(key, raw, s);
  return blank('unsupported', {
    version,
    raw,
    sourceKey,
    readOnly: !kept,
    warning: kept
      ? `Saved progress could not be migrated. The copy at ${backup} and ${key}.quarantine is kept; this page will not overwrite the saved copy.`
      : 'Saved progress could not be migrated. This page will not overwrite it.',
  });
}
