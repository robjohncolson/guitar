import { accountsEnabled, PROGRESS_KEYS, type ProgressKey } from './config';
import { CHANGE_EVENT, keyMeta, readMeta, writeMeta, type SyncMeta } from './changes';
import { ApiFailure, getProgress, getSession, putProgress, type CloudItem } from './api';
import { plan, type Choice, type LocalView } from './reconcile';

export type SyncState = { signedIn: boolean; username: string | null; status: string; remoteNewer: boolean };
export const state: SyncState = { signedIn: false, username: null, status: '', remoteNewer: false };
const listeners = new Set<() => void>();
export const onState = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(fn => fn());
const setStatus = (status: string) => { state.status = status; emit(); };

const readLocal = (meta: SyncMeta): LocalView[] => PROGRESS_KEYS.map(key => {
  let text: string | null = null;
  try { text = localStorage.getItem(key); } catch { /* unavailable */ }
  return { key, text, meta: keyMeta(meta, key) };
});

function take(meta: SyncMeta, item: CloudItem): void {
  localStorage.setItem(item.key, JSON.stringify(item.value));
  Object.assign(keyMeta(meta, item.key), { version: item.version, modifiedAt: item.updatedAt, dirty: false });
}

/** Push one key. A conflict means another device wrote first: the newer modification wins. Returns true if local storage changed. */
async function push(key: ProgressKey, baseVersion: number, allowTake: boolean, keepalive = false): Promise<boolean> {
  const meta = readMeta(), m = keyMeta(meta, key);
  let text: string | null = null;
  try { text = localStorage.getItem(key); } catch { return false; }
  if (text === null) return false;
  let value: unknown;
  try { value = JSON.parse(text); } catch { return false; }
  try {
    const { item } = await putProgress(key, value, m.modifiedAt, baseVersion, keepalive);
    const fresh = readMeta(), fm = keyMeta(fresh, key);
    fm.version = item.version;
    if (fm.modifiedAt === m.modifiedAt) fm.dirty = false; // unless it changed again while saving
    writeMeta(fresh);
    return false;
  } catch (error) {
    if (!(error instanceof ApiFailure) || error.status !== 409) throw error;
    const current = error.body.current as CloudItem | null;
    const cloudTime = current ? Date.parse(current.updatedAt) : 0, localTime = m.modifiedAt ? Date.parse(m.modifiedAt) : 0;
    if (!current || localTime >= cloudTime) return push(key, current?.version ?? 0, allowTake, keepalive);
    if (allowTake) { const fresh = readMeta(); take(fresh, current); writeMeta(fresh); return true; }
    state.remoteNewer = true; emit();
    return false;
  }
}

/** Bring this device and the account together. Before the app starts (boot, sign-in) cloud copies can be written to localStorage. */
export async function reconcile(choice: Choice | 'linked', appRunning: boolean): Promise<{ changedLocal: boolean }> {
  const meta = readMeta(), { items } = await getProgress();
  let changedLocal = false;
  const pushes: [ProgressKey, number][] = [];
  for (const p of plan(readLocal(meta), items, choice)) {
    if (p.action === 'take' && p.cloud) {
      if (appRunning) { state.remoteNewer = true; continue; }
      take(meta, p.cloud); changedLocal = true;
    } else if (p.action === 'link' && p.cloud) Object.assign(keyMeta(meta, p.key), { version: p.cloud.version, dirty: false });
    else if (p.action === 'push') { keyMeta(meta, p.key).dirty = true; pushes.push([p.key, p.baseVersion]); }
  }
  writeMeta(meta);
  for (const [key, base] of pushes) changedLocal = (await push(key, base, !appRunning)) || changedLocal;
  emit();
  return { changedLocal };
}

const timers = new Map<ProgressKey, ReturnType<typeof setTimeout>>();
function schedulePush(key: ProgressKey, delay = 2000): void {
  if (!state.signedIn) return;
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => {
    timers.delete(key);
    const m = keyMeta(readMeta(), key);
    if (!m.dirty) return;
    setStatus('Saving to your account…');
    push(key, m.version, false).then(() => setStatus(`Synced ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`), (e: ApiFailure) => setStatus(e.status === 401 ? 'Signed out. Sign in again to keep syncing.' : 'Offline: saved in this browser, will sync later.'));
  }, delay));
}

async function checkRemote(): Promise<void> {
  if (!state.signedIn || document.hidden) return;
  try {
    const meta = readMeta(), { items } = await getProgress();
    for (const c of items) { const m = keyMeta(meta, c.key); if (c.version > m.version && !m.dirty) state.remoteNewer = true; }
    for (const key of PROGRESS_KEYS) if (keyMeta(meta, key).dirty) schedulePush(key, 0);
    emit();
  } catch (e) { if (e instanceof ApiFailure && e.status === 401) { state.signedIn = false; markSignedOut(); emit(); } }
}

function flush(): void {
  if (!state.signedIn) return;
  for (const [key, timer] of timers) { clearTimeout(timer); timers.delete(key); const m = keyMeta(readMeta(), key); if (m.dirty) void push(key, m.version, false, true).catch(() => undefined); }
}

let started = false;
function startLiveSync(): void {
  if (started) return;
  started = true;
  window.addEventListener(CHANGE_EVENT, event => schedulePush((event as CustomEvent<ProgressKey>).detail));
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); else void checkRemote(); });
  window.addEventListener('pagehide', flush);
}

export function markSignedIn(username: string): void {
  const meta = readMeta(); meta.user = username; writeMeta(meta);
  state.signedIn = true; state.username = username; startLiveSync(); emit();
}
/** Signing out keeps this browser's progress; the next sign-in compares it with the account again. */
export function markSignedOut(): void {
  const meta = readMeta(); meta.user = null;
  for (const key of PROGRESS_KEYS) { const m = keyMeta(meta, key); m.version = 0; m.dirty = false; }
  writeMeta(meta);
  state.signedIn = false; state.username = null; state.remoteNewer = false; emit();
}

/**
 * Runs before each page's app module. Signed-out visitors (and the static mirror) never touch the network here.
 * A signed-in device pulls newer cloud progress first, so the app starts with it.
 */
export async function bootSync(): Promise<void> {
  if (!accountsEnabled) return;
  const meta = readMeta();
  if (!meta.user) return;
  state.username = meta.user;
  try {
    const session = await getSession(3000);
    if (!session.signedIn || session.username !== meta.user) { markSignedOut(); state.status = 'You were signed out. Your progress is still in this browser.'; return; }
    markSignedIn(session.username);
    await reconcile('linked', false);
    setStatus(`Synced ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
  } catch {
    // Offline or slow: start with local progress, keep the sign-in, and retry when the page regains focus.
    state.signedIn = true; startLiveSync(); state.status = 'Offline: using this browser’s progress.';
  }
}
