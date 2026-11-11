// Account primitives shared by the API: input validation, password hashing, session tokens and cookies.
// Mirrors SEI Study Lab's password mode (scrypt N=32768, 30-day httpOnly sessions), adapted for open sign-up.
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export const PROGRESS_KEYS = ['guitar.trainer.v1', 'guitar.practice.v1', 'piece.trainer.v1'] as const;
export type ProgressKey = typeof PROGRESS_KEYS[number];
export const isProgressKey = (key: unknown): key is ProgressKey => typeof key === 'string' && (PROGRESS_KEYS as readonly string[]).includes(key);

export const LIMITS = {
  progressBytes: 512 * 1024,
  pieceBytes: 2 * 1024 * 1024,
  piecesPerUser: 30,
  sessionsPerUser: 20,
  /** Failed sign-ins (or account deletions) allowed per window. */
  failuresPerUser: 10,
  failuresPerIp: 30,
  signupsPerIp: 5,
  failureWindowMs: 15 * 60 * 1000,
  signupWindowMs: 60 * 60 * 1000,
} as const;

export const GENERIC_SIGNIN_ERROR = 'Username or password is incorrect.';
export const RATE_LIMIT_ERROR = 'Too many attempts. Please wait a few minutes and try again.';

export function normalizeUsername(value: unknown): string {
  if (typeof value !== 'string') throw new ApiError(400, 'Usernames are 3–32 characters: lowercase letters, numbers, _ or -.');
  const name = value.trim().toLowerCase();
  if (!/^[a-z0-9_-]{3,32}$/.test(name)) throw new ApiError(400, 'Usernames are 3–32 characters: lowercase letters, numbers, _ or -.');
  return name;
}

export function validatePassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 10 || value.length > 200 || !/\S/u.test(value) || Buffer.byteLength(value, 'utf8') > 800) {
    throw new ApiError(400, 'Passwords need at least 10 characters (200 at most).');
  }
  return value;
}

const PREFIX = 'scrypt$32768$8$1$';
const FORMAT = /^scrypt\$32768\$8\$1\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/;
const derive = (password: string, salt: Buffer): Promise<Buffer> => new Promise((resolve, reject) => {
  scrypt(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => { if (error) reject(error); else resolve(key); });
});
// Unknown usernames still pay one full scrypt so response time does not reveal which accounts exist.
const DUMMY_HASH = `${PREFIX}${Buffer.alloc(16).toString('base64url')}$${Buffer.alloc(32).toString('base64url')}`;

export async function hashPassword(password: string): Promise<string> {
  validatePassword(password);
  const salt = randomBytes(16);
  return `${PREFIX}${salt.toString('base64url')}$${(await derive(password, salt)).toString('base64url')}`;
}

export async function verifyPassword(password: string, stored?: string | null): Promise<boolean> {
  const real = typeof stored === 'string' ? stored.match(FORMAT) : null;
  const parts = real ?? DUMMY_HASH.match(FORMAT)!;
  const actual = await derive(password, Buffer.from(parts[1], 'base64url'));
  return timingSafeEqual(actual, Buffer.from(parts[2], 'base64url')) && Boolean(real);
}

export const SESSION_SECONDS = 30 * 24 * 60 * 60;
export const newSessionToken = () => randomBytes(32).toString('base64url');
/** Tokens carry 256 random bits, so a plain SHA-256 is enough; only the hash is stored. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const hashIp = (ip: string) => createHash('sha256').update(`guitar-ip:${ip}`).digest('hex').slice(0, 32);
const validToken = (token: string) => token.length === 43 && /^[A-Za-z0-9_-]+$/.test(token);

export function cookieName(secure: boolean) { return secure ? '__Host-guitar_session' : 'guitar_session'; }

export function sessionCookie(secure: boolean, token: string | null): string {
  if (token !== null && !validToken(token)) throw new Error('Invalid session token');
  return `${cookieName(secure)}=${token ?? ''}; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Lax; Path=/; Max-Age=${token === null ? 0 : SESSION_SECONDS}`;
}

export function readSessionCookie(secure: boolean, header?: string): string | null {
  const name = cookieName(secure);
  const values = (header ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1);
  return validToken(value) ? value : null;
}

export function validatePieceId(value: unknown): string {
  if (typeof value !== 'string' || !/^mine:[A-Za-z0-9_-]{0,60}$/.test(value)) throw new ApiError(400, 'Invalid piece id.');
  return value;
}

/** Serialised size of a JSON progress value, enforced before it reaches the database. */
export function progressValue(value: unknown): string {
  if (value === undefined || value === null || typeof value !== 'object') throw new ApiError(400, 'Progress must be a JSON object.');
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text, 'utf8') > LIMITS.progressBytes) throw new ApiError(413, 'That progress is too large to save.');
  return text;
}

export function pieceText(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new ApiError(400, 'Piece text is missing.');
  if (Buffer.byteLength(value, 'utf8') > LIMITS.pieceBytes) throw new ApiError(413, 'That piece is too large to save (2 MB at most).');
  if (value.includes('\u0000')) throw new ApiError(400, 'Piece text is invalid.');
  return value;
}

/** Client clocks can be wrong; never accept timestamps from the future (beyond a small skew) or before 2020. */
export function clientTimestamp(value: unknown, now: Date): Date {
  const parsed = typeof value === 'string' ? new Date(value) : new Date(NaN);
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() < Date.UTC(2020, 0, 1)) return now;
  return parsed.getTime() > now.getTime() + 5 * 60 * 1000 ? now : parsed;
}
