import type { ProgressKey } from './config';

export type CloudItem = { key: ProgressKey; value: unknown; updatedAt: string; version: number };
export type CloudPiece = { id: string; updatedAt: string; bytes: number };
export class ApiFailure extends Error {
  readonly status: number; readonly body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) { super(typeof body.error === 'string' ? body.error : 'Accounts are unavailable right now.'); this.status = status; this.body = body; }
}

const base = `${import.meta.env.BASE_URL}api/`;
export async function api<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number; keepalive?: boolean } = {}): Promise<T> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 15000);
  try {
    const res = await fetch(base + path, {
      method: init.method ?? 'GET', credentials: 'same-origin', signal: controller.signal, keepalive: init.keepalive,
      headers: init.body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const type = res.headers.get('content-type') ?? '';
    const body = type.includes('application/json') ? await res.json().catch(() => ({})) : {};
    if (!res.ok) throw new ApiFailure(res.status, body);
    if (!type.includes('application/json')) throw new ApiFailure(503, {}); // e.g. a static host answering with HTML
    return body as T;
  } catch (error) {
    if (error instanceof ApiFailure) throw error;
    throw new ApiFailure(0, { error: 'Could not reach your account. Your progress is still saved in this browser.' });
  } finally { clearTimeout(timer); }
}

export const getSession = (timeoutMs?: number) => api<{ accounts: boolean; signedIn: boolean; username: string | null }>('session', { timeoutMs });
export const getProgress = () => api<{ items: CloudItem[] }>('progress');
export const putProgress = (key: ProgressKey, value: unknown, updatedAt: string | null, baseVersion: number, keepalive = false) =>
  api<{ item: CloudItem }>(`progress/${key}`, { method: 'PUT', body: { value, updatedAt: updatedAt ?? new Date().toISOString(), baseVersion }, keepalive });
export const listPieces = () => api<{ items: CloudPiece[] }>('pieces');
export const getPiece = (id: string) => api<{ piece: { id: string; text: string; updatedAt: string } }>(`pieces/${encodeURIComponent(id)}`);
export const savePiece = (id: string, text: string) => api<{ saved: boolean }>(`pieces/${encodeURIComponent(id)}`, { method: 'PUT', body: { text } });
export const deletePiece = (id: string) => api<{ deleted: boolean }>(`pieces/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const signIn = (username: string, password: string, create: boolean) => api<{ signedIn: boolean; username: string }>(create ? 'auth/signup' : 'auth/signin', { method: 'POST', body: { username, password } });
export const signOut = () => api<{ signedIn: boolean }>('auth/signout', { method: 'POST', body: {} });
export const deleteAccount = (password: string) => api<{ deleted: boolean }>('account/delete', { method: 'POST', body: { password } });
