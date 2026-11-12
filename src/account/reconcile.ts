import { PROGRESS_KEYS, type ProgressKey } from './config';
import type { KeyMeta } from './changes';
import type { CloudItem } from './api';

export type Choice = 'device' | 'cloud' | 'merge';
export type Plan = { key: ProgressKey; action: 'take' | 'push' | 'link' | 'none'; baseVersion: number; cloud?: CloudItem };
export type LocalView = { key: ProgressKey; text: string | null; meta: KeyMeta };

const time = (iso: string | null | undefined) => { const t = iso ? Date.parse(iso) : NaN; return Number.isNaN(t) ? 0 : t; };
const same = (text: string | null, cloud: CloudItem) => { try { return text !== null && JSON.stringify(JSON.parse(text)) === JSON.stringify(cloud.value); } catch { return false; } };

/** Keys where this device and the account both hold different progress: the first sign-in asks what to do with them. */
export function conflicts(local: LocalView[], cloud: CloudItem[]): ProgressKey[] {
  return local.filter(l => { const c = cloud.find(x => x.key === l.key); return l.text !== null && c && !same(l.text, c); }).map(l => l.key);
}

/**
 * Decide per key what to do. Linked devices (already signed in here) follow versions: untouched local copies take newer
 * cloud copies; local edits are pushed; if both changed, the newer modification wins. A first sign-in uses the choice.
 */
export function plan(local: LocalView[], cloud: CloudItem[], choice: Choice | 'linked'): Plan[] {
  return PROGRESS_KEYS.map(key => {
    const l = local.find(x => x.key === key)!, c = cloud.find(x => x.key === key);
    const cloudVersion = c?.version ?? 0;
    if (!c) return { key, action: l.text !== null ? 'push' : 'none', baseVersion: 0 };
    if (l.text === null) return { key, action: 'take', baseVersion: cloudVersion, cloud: c };
    if (same(l.text, c)) return { key, action: 'link', baseVersion: cloudVersion, cloud: c };
    const localNewer = time(l.meta.modifiedAt) > time(c.updatedAt);
    if (choice === 'linked') {
      if (c.version === l.meta.version) return { key, action: l.meta.dirty ? 'push' : 'link', baseVersion: cloudVersion, cloud: c };
      // The account moved on (another device) or was reset.
      return { key, action: l.meta.dirty && localNewer ? 'push' : 'take', baseVersion: cloudVersion, cloud: c };
    }
    const action = choice === 'device' ? 'push' : choice === 'cloud' ? 'take' : localNewer ? 'push' : 'take';
    return { key, action, baseVersion: cloudVersion, cloud: c };
  });
}
