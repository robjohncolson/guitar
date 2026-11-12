import {
  ApiError, GENERIC_SIGNIN_ERROR, LIMITS, RATE_LIMIT_ERROR, SESSION_SECONDS, clientTimestamp, hashIp, hashPassword, hashToken,
  isProgressKey, newSessionToken, normalizeUsername, pieceText, progressValue, validatePassword, validatePieceId, verifyPassword,
} from './core.js';
import type { Store } from './store.js';

export type ServiceConfig = { signupOpen: boolean; maxUsers: number };
export type Identity = { userId: string; username: string };

function record(body: unknown, allowed: string[]): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'Invalid request.');
  const r = body as Record<string, unknown>;
  if (Object.keys(r).some(k => !allowed.includes(k))) throw new ApiError(400, 'Invalid request.');
  return r;
}

/** Account rules, independent of HTTP. Every data method is scoped to the identity resolved from the session cookie. */
export class AccountService {
  constructor(private readonly store: Store, private readonly config: ServiceConfig, private readonly clock: () => Date = () => new Date()) {}

  private async limited(ip: string, username: string, action: 'signin' | 'delete'): Promise<void> {
    const since = new Date(this.clock().getTime() - LIMITS.failureWindowMs);
    const [byIp, byUser] = await Promise.all([
      this.store.countAttempts(`ip:${hashIp(ip)}`, action, since, true),
      this.store.countAttempts(`user:${username}`, action, since, true),
    ]);
    if (byIp >= LIMITS.failuresPerIp || byUser >= LIMITS.failuresPerUser) throw new ApiError(429, RATE_LIMIT_ERROR);
  }

  private async newSession(userId: string): Promise<string> {
    const token = newSessionToken(), now = this.clock();
    await this.store.createSession(hashToken(token), userId, now, new Date(now.getTime() + SESSION_SECONDS * 1000), LIMITS.sessionsPerUser);
    return token;
  }

  async identity(token: string | null): Promise<Identity | null> {
    return token ? this.store.sessionUser(hashToken(token), this.clock()) : null;
  }

  async signUp(body: unknown, ip: string): Promise<{ token: string; username: string }> {
    const r = record(body, ['username', 'password']);
    const username = normalizeUsername(r.username), password = validatePassword(r.password);
    const now = this.clock(), ipBucket = `ip:${hashIp(ip)}`;
    if (await this.store.countAttempts(ipBucket, 'signup', new Date(now.getTime() - LIMITS.signupWindowMs), false) >= LIMITS.signupsPerIp) {
      throw new ApiError(429, RATE_LIMIT_ERROR);
    }
    await this.store.recordAttempt([ipBucket], 'signup', true, now);
    if (!this.config.signupOpen || await this.store.countUsers() >= this.config.maxUsers) throw new ApiError(403, 'New accounts are paused right now.');
    const id = await this.store.createUser(username, await hashPassword(password), now);
    if (!id) throw new ApiError(409, 'That username is not available. Try another.');
    return { token: await this.newSession(id), username };
  }

  async signIn(body: unknown, ip: string): Promise<{ token: string; username: string }> {
    const r = record(body, ['username', 'password']);
    // Malformed credentials get the same answer as wrong ones.
    let username: string, password: string;
    try { username = normalizeUsername(r.username); password = validatePassword(r.password); }
    catch { throw new ApiError(401, GENERIC_SIGNIN_ERROR); }
    await this.limited(ip, username, 'signin');
    const user = await this.store.findUser(username);
    const valid = await verifyPassword(password, user?.passwordHash);
    if (!user || !valid) {
      await this.store.recordAttempt([`ip:${hashIp(ip)}`, `user:${username}`], 'signin', false, this.clock());
      throw new ApiError(401, GENERIC_SIGNIN_ERROR);
    }
    await this.store.touchSignIn(user.id, this.clock());
    return { token: await this.newSession(user.id), username };
  }

  async signOut(token: string | null): Promise<void> { if (token) await this.store.deleteSession(hashToken(token)); }

  async deleteAccount(who: Identity, body: unknown, ip: string): Promise<void> {
    const r = record(body, ['password']);
    await this.limited(ip, who.username, 'delete');
    const ok = typeof r.password === 'string' && r.password.length <= 200 && await verifyPassword(r.password, await this.store.passwordHash(who.userId));
    if (!ok) {
      await this.store.recordAttempt([`ip:${hashIp(ip)}`, `user:${who.username}`], 'delete', false, this.clock());
      throw new ApiError(401, 'That password is not right.');
    }
    await this.store.deleteUser(who.userId);
  }

  listProgress(who: Identity) { return this.store.listProgress(who.userId); }

  async putProgress(who: Identity, key: string, body: unknown) {
    if (!isProgressKey(key)) throw new ApiError(404, 'Unknown progress key.');
    const r = record(body, ['value', 'updatedAt', 'baseVersion']);
    const base = r.baseVersion;
    if (typeof base !== 'number' || !Number.isInteger(base) || base < 0 || base > 2_000_000_000) throw new ApiError(400, 'Invalid request.');
    return this.store.putProgress(who.userId, key, progressValue(r.value), clientTimestamp(r.updatedAt, this.clock()), base);
  }

  listPieces(who: Identity) { return this.store.listPieces(who.userId); }

  async getPiece(who: Identity, id: string) {
    const piece = await this.store.getPiece(who.userId, validatePieceId(id));
    if (!piece) throw new ApiError(404, 'Piece not found.');
    return piece;
  }

  async putPiece(who: Identity, id: string, body: unknown) {
    const r = record(body, ['text']);
    const result = await this.store.putPiece(who.userId, validatePieceId(id), pieceText(r.text), this.clock(), LIMITS.piecesPerUser);
    if (result === 'limit') throw new ApiError(409, `You can keep up to ${LIMITS.piecesPerUser} pieces in your account.`);
  }

  async deletePiece(who: Identity, id: string) {
    if (!await this.store.deletePiece(who.userId, validatePieceId(id))) throw new ApiError(404, 'Piece not found.');
  }
}
