import { PROGRESS_KEYS, type ProgressKey } from './config';

/** Sync bookkeeping kept beside the progress itself. Written even when signed out, so a later first sign-in can tell which copy is newer. */
export const META_KEY = 'guitar.sync.v1';
export type KeyMeta = { version: number; modifiedAt: string | null; dirty: boolean };
export type SyncMeta = { user: string | null; keys: Partial<Record<ProgressKey, KeyMeta>> };
export const CHANGE_EVENT = 'guitar:progress-changed';

export function readMeta(): SyncMeta {
  try {
    const v = JSON.parse(localStorage.getItem(META_KEY) ?? 'null');
    if (v && typeof v === 'object') {
      const keys: SyncMeta['keys'] = {};
      for (const k of PROGRESS_KEYS) {
        const m = v.keys?.[k];
        if (m && typeof m === 'object') keys[k] = { version: Number.isInteger(m.version) && m.version >= 0 ? m.version : 0, modifiedAt: typeof m.modifiedAt === 'string' ? m.modifiedAt : null, dirty: m.dirty === true };
      }
      return { user: typeof v.user === 'string' ? v.user : null, keys };
    }
  } catch { /* fall through */ }
  return { user: null, keys: {} };
}
export function writeMeta(meta: SyncMeta): void { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch { /* storage full: sync resumes later */ } }
export const keyMeta = (meta: SyncMeta, key: ProgressKey): KeyMeta => (meta.keys[key] ??= { version: 0, modifiedAt: null, dirty: false });

/** Call after saving one of the progress keys to localStorage. Never touches the network itself. */
export function markChanged(key: ProgressKey): void {
  const meta = readMeta(), m = keyMeta(meta, key);
  m.modifiedAt = new Date().toISOString(); m.dirty = true;
  writeMeta(meta);
  try { window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: key })); } catch { /* not in a browser */ }
}

/** localStorage.setItem for a synced key; records a change only when the saved text differs (startup re-saves are not edits). Throws like setItem. */
export function saveTracked(key: ProgressKey, text: string): void {
  let before: string | null = null;
  try { before = localStorage.getItem(key); } catch { /* setItem below reports the failure */ }
  localStorage.setItem(key, text);
  if (before !== text) markChanged(key);
}
