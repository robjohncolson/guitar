import type { ProgressKey } from './core.js';

export type ProgressItem = { key: ProgressKey; value: unknown; updatedAt: string; version: number };
export type PieceSummary = { id: string; updatedAt: string; bytes: number };
export type PutProgressResult = { ok: true; item: ProgressItem } | { ok: false; current: ProgressItem | null };
export type AttemptAction = 'signin' | 'signup' | 'delete';

/** Storage used by the account API. Every user-data method takes the session's user id; nothing reads across users. */
export interface Store {
  countAttempts(bucket: string, action: AttemptAction, since: Date, failuresOnly: boolean): Promise<number>;
  recordAttempt(buckets: string[], action: AttemptAction, success: boolean, now: Date): Promise<void>;
  countUsers(): Promise<number>;
  /** Returns the new user id, or null when the username is taken. */
  createUser(username: string, passwordHash: string, now: Date): Promise<string | null>;
  findUser(username: string): Promise<{ id: string; passwordHash: string } | null>;
  passwordHash(userId: string): Promise<string | null>;
  touchSignIn(userId: string, now: Date): Promise<void>;
  createSession(tokenHash: string, userId: string, now: Date, expires: Date, keep: number): Promise<void>;
  sessionUser(tokenHash: string, now: Date): Promise<{ userId: string; username: string } | null>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  listProgress(userId: string): Promise<ProgressItem[]>;
  putProgress(userId: string, key: ProgressKey, valueJson: string, updatedAt: Date, baseVersion: number): Promise<PutProgressResult>;
  listPieces(userId: string): Promise<PieceSummary[]>;
  getPiece(userId: string, pieceId: string): Promise<{ id: string; text: string; updatedAt: string } | null>;
  /** 'limit' when the user already has the maximum number of other pieces. */
  putPiece(userId: string, pieceId: string, text: string, now: Date, maxPieces: number): Promise<'ok' | 'limit'>;
  deletePiece(userId: string, pieceId: string): Promise<boolean>;
}

/** In-memory store for unit tests; same contract and per-user scoping as the Postgres store. */
export class MemoryStore implements Store {
  attempts: { bucket: string; action: AttemptAction; success: boolean; at: Date }[] = [];
  users = new Map<string, { id: string; username: string; passwordHash: string; lastSignIn?: Date }>();
  sessions = new Map<string, { userId: string; expires: Date; created: Date }>();
  progress = new Map<string, ProgressItem>();
  pieces = new Map<string, { id: string; text: string; updatedAt: string }>();
  private nextId = 1;

  async countAttempts(bucket: string, action: AttemptAction, since: Date, failuresOnly: boolean) {
    return this.attempts.filter(a => a.bucket === bucket && a.action === action && a.at >= since && (!failuresOnly || !a.success)).length;
  }
  async recordAttempt(buckets: string[], action: AttemptAction, success: boolean, now: Date) {
    for (const bucket of buckets) this.attempts.push({ bucket, action, success, at: now });
  }
  async countUsers() { return this.users.size; }
  async createUser(username: string, passwordHash: string) {
    if ([...this.users.values()].some(u => u.username === username)) return null;
    const id = `00000000-0000-4000-8000-${String(this.nextId++).padStart(12, '0')}`;
    this.users.set(id, { id, username, passwordHash });
    return id;
  }
  async findUser(username: string) {
    const user = [...this.users.values()].find(u => u.username === username);
    return user ? { id: user.id, passwordHash: user.passwordHash } : null;
  }
  async passwordHash(userId: string) { return this.users.get(userId)?.passwordHash ?? null; }
  async touchSignIn(userId: string, now: Date) { const u = this.users.get(userId); if (u) u.lastSignIn = now; }
  async createSession(tokenHash: string, userId: string, now: Date, expires: Date, keep: number) {
    this.sessions.set(tokenHash, { userId, expires, created: now });
    const mine = [...this.sessions.entries()].filter(([, s]) => s.userId === userId).sort((a, b) => b[1].created.getTime() - a[1].created.getTime());
    for (const [hash] of mine.slice(keep)) this.sessions.delete(hash);
  }
  async sessionUser(tokenHash: string, now: Date) {
    const s = this.sessions.get(tokenHash);
    if (!s || s.expires <= now) return null;
    const u = this.users.get(s.userId);
    return u ? { userId: u.id, username: u.username } : null;
  }
  async deleteSession(tokenHash: string) { this.sessions.delete(tokenHash); }
  async deleteUser(userId: string) {
    this.users.delete(userId);
    for (const [k, s] of this.sessions) if (s.userId === userId) this.sessions.delete(k);
    for (const k of [...this.progress.keys(), ...this.pieces.keys()]) if (k.startsWith(`${userId}|`)) { this.progress.delete(k); this.pieces.delete(k); }
  }
  async listProgress(userId: string) {
    return [...this.progress.entries()].filter(([k]) => k.startsWith(`${userId}|`)).map(([, v]) => structuredClone(v));
  }
  async putProgress(userId: string, key: ProgressKey, valueJson: string, updatedAt: Date, baseVersion: number): Promise<PutProgressResult> {
    const id = `${userId}|${key}`, current = this.progress.get(id) ?? null;
    if ((current?.version ?? 0) !== baseVersion) return { ok: false, current: current && structuredClone(current) };
    const item: ProgressItem = { key, value: JSON.parse(valueJson), updatedAt: updatedAt.toISOString(), version: baseVersion + 1 };
    this.progress.set(id, item);
    return { ok: true, item: structuredClone(item) };
  }
  async listPieces(userId: string) {
    return [...this.pieces.entries()].filter(([k]) => k.startsWith(`${userId}|`)).map(([, p]) => ({ id: p.id, updatedAt: p.updatedAt, bytes: Buffer.byteLength(p.text) }));
  }
  async getPiece(userId: string, pieceId: string) { const p = this.pieces.get(`${userId}|${pieceId}`); return p ? { ...p } : null; }
  async putPiece(userId: string, pieceId: string, text: string, now: Date, maxPieces: number): Promise<'ok' | 'limit'> {
    const others = (await this.listPieces(userId)).filter(p => p.id !== pieceId).length;
    if (others >= maxPieces) return 'limit';
    this.pieces.set(`${userId}|${pieceId}`, { id: pieceId, text, updatedAt: now.toISOString() });
    return 'ok';
  }
  async deletePiece(userId: string, pieceId: string) { return this.pieces.delete(`${userId}|${pieceId}`); }
}
