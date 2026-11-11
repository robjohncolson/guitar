import { describe, expect, it } from 'vitest';
import {
  ApiError, LIMITS, SESSION_SECONDS, clientTimestamp, hashPassword, normalizeUsername, readSessionCookie, sessionCookie,
  validatePassword, validatePieceId, verifyPassword, progressValue, pieceText,
} from '../../server/core';
import { AccountService } from '../../server/service';
import { MemoryStore } from '../../server/store';

const pw = 'correct horse battery';
const make = (now = { t: Date.UTC(2026, 10, 11) }, config = { signupOpen: true, maxUsers: 1000 }) => {
  const store = new MemoryStore();
  return { store, now, svc: new AccountService(store, config, () => new Date(now.t)) };
};
const status = async (p: Promise<unknown>) => { try { await p; return 200; } catch (e) { return (e as ApiError).status; } };

describe('input validation', () => {
  it('accepts 3–32 lowercase letters, digits, _ and -', () => {
    expect(normalizeUsername('Rob_J-1')).toBe('rob_j-1');
    for (const bad of ['ab', 'a'.repeat(33), 'rob.j', 'rob j', 'röb', '', 12, null]) expect(() => normalizeUsername(bad)).toThrow(ApiError);
  });
  it('requires passwords of 10–200 characters', () => {
    expect(validatePassword('0123456789')).toBe('0123456789');
    for (const bad of ['short', ' '.repeat(12), 'x'.repeat(201), undefined]) expect(() => validatePassword(bad)).toThrow(ApiError);
  });
  it('limits piece ids and sizes, progress size and timestamps', () => {
    expect(validatePieceId('mine:my-song_2')).toBe('mine:my-song_2');
    for (const bad of ['local:linus', 'mine:../x', 'mine:' + 'a'.repeat(61), 'gymnopedie-1']) expect(() => validatePieceId(bad)).toThrow(ApiError);
    expect(() => progressValue({ big: 'x'.repeat(LIMITS.progressBytes) })).toThrow(/too large/);
    expect(() => progressValue('text')).toThrow(ApiError);
    expect(() => pieceText('x'.repeat(LIMITS.pieceBytes + 1))).toThrow(/too large/);
    const now = new Date(Date.UTC(2026, 10, 11));
    expect(clientTimestamp('2099-01-01T00:00:00Z', now)).toEqual(now);
    expect(clientTimestamp('garbage', now)).toEqual(now);
    expect(clientTimestamp('2026-11-10T00:00:00.000Z', now).toISOString()).toBe('2026-11-10T00:00:00.000Z');
  });
});

describe('password hashing', () => {
  it('uses salted scrypt and verifies only the right password', async () => {
    const a = await hashPassword(pw), b = await hashPassword(pw);
    expect(a).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword(pw, a)).toBe(true);
    expect(await verifyPassword('wrong password!', a)).toBe(false);
    expect(await verifyPassword(pw, null)).toBe(false);
    expect(await verifyPassword(pw, 'not-a-hash')).toBe(false);
  });
});

describe('session cookies', () => {
  it('are httpOnly, SameSite=Lax, __Host- and Secure on https, 30 days', () => {
    const token = 'a'.repeat(43);
    const cookie = sessionCookie(true, token);
    expect(cookie).toContain('__Host-guitar_session=');
    for (const part of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', `Max-Age=${SESSION_SECONDS}`]) expect(cookie).toContain(part);
    expect(sessionCookie(true, null)).toContain('Max-Age=0');
    expect(readSessionCookie(true, `x=1; __Host-guitar_session=${token}`)).toBe(token);
    expect(readSessionCookie(true, `__Host-guitar_session=${token}; __Host-guitar_session=${token}`)).toBeNull();
    expect(readSessionCookie(true, '__Host-guitar_session=short')).toBeNull();
  });
});

describe('accounts', () => {
  it('signs up, signs in, signs out and expires sessions after 30 days', async () => {
    const { svc, now, store } = make();
    const up = await svc.signUp({ username: 'Alice', password: pw }, '1.1.1.1');
    expect(up.username).toBe('alice');
    expect((await svc.identity(up.token))?.username).toBe('alice');
    expect([...store.sessions.keys()][0]).toMatch(/^[0-9a-f]{64}$/);
    expect([...store.sessions.keys()]).not.toContain(up.token);
    const inn = await svc.signIn({ username: 'alice', password: pw }, '1.1.1.1');
    await svc.signOut(inn.token);
    expect(await svc.identity(inn.token)).toBeNull();
    now.t += SESSION_SECONDS * 1000 - 1000;
    expect(await svc.identity(up.token)).not.toBeNull();
    now.t += 2000;
    expect(await svc.identity(up.token)).toBeNull();
  });
  it('gives the same generic error for unknown users, wrong and malformed passwords', async () => {
    const { svc } = make();
    await svc.signUp({ username: 'bob', password: pw }, '2.2.2.2');
    const messages = await Promise.all([
      svc.signIn({ username: 'bob', password: 'wrong password' }, '2.2.2.2'),
      svc.signIn({ username: 'nobody', password: pw }, '2.2.2.2'),
      svc.signIn({ username: 'x', password: 'short' }, '2.2.2.2'),
    ].map(p => p.then(() => 'ok', (e: ApiError) => `${e.status} ${e.message}`)));
    expect(new Set(messages)).toEqual(new Set(['401 Username or password is incorrect.']));
  });
  it('rejects duplicate usernames, extra fields, closed sign-up and the user cap', async () => {
    const { svc } = make();
    await svc.signUp({ username: 'carol', password: pw }, '3.3.3.3');
    expect(await status(svc.signUp({ username: 'CAROL', password: pw }, '3.3.3.4'))).toBe(409);
    expect(await status(svc.signUp({ username: 'dave', password: pw, admin: true }, '3.3.3.4'))).toBe(400);
    expect(await status(make(undefined, { signupOpen: false, maxUsers: 10 }).svc.signUp({ username: 'erin', password: pw }, '9.9.9.9'))).toBe(403);
    const capped = make(undefined, { signupOpen: true, maxUsers: 1 });
    await capped.svc.signUp({ username: 'first', password: pw }, '8.8.8.1');
    expect(await status(capped.svc.signUp({ username: 'second', password: pw }, '8.8.8.2'))).toBe(403);
  });
  it('rate-limits failed sign-ins per username and per IP, then recovers', async () => {
    const { svc, now } = make();
    await svc.signUp({ username: 'frank', password: pw }, '4.4.4.4');
    for (let i = 0; i < LIMITS.failuresPerUser; i++) expect(await status(svc.signIn({ username: 'frank', password: 'wrong guess ' + i }, `10.0.0.${i}`))).toBe(401);
    // Even the right password is refused while the username is locked out.
    expect(await status(svc.signIn({ username: 'frank', password: pw }, '4.4.4.4'))).toBe(429);
    now.t += LIMITS.failureWindowMs + 1;
    expect(await status(svc.signIn({ username: 'frank', password: pw }, '4.4.4.4'))).toBe(200);
    for (let i = 0; i < LIMITS.failuresPerIp; i++) await status(svc.signIn({ username: `user${i}`, password: 'wrong guess!' }, '5.5.5.5'));
    expect(await status(svc.signIn({ username: 'frank', password: pw }, '5.5.5.5'))).toBe(429);
  });
  it('rate-limits sign-ups per IP', async () => {
    const { svc } = make();
    for (let i = 0; i < LIMITS.signupsPerIp; i++) expect(await status(svc.signUp({ username: `spam${i}`, password: pw }, '6.6.6.6'))).toBe(200);
    expect(await status(svc.signUp({ username: 'spam-more', password: pw }, '6.6.6.6'))).toBe(429);
    expect(await status(svc.signUp({ username: 'someone', password: pw }, '6.6.6.7'))).toBe(200);
  });
  it('keeps at most 20 sessions per user', async () => {
    const { svc, now, store } = make();
    const first = await svc.signUp({ username: 'gina', password: pw }, '7.7.7.7');
    for (let i = 0; i < LIMITS.sessionsPerUser; i++) { now.t += 1000; await svc.signIn({ username: 'gina', password: pw }, `7.7.8.${i}`); }
    expect(store.sessions.size).toBe(LIMITS.sessionsPerUser);
    expect(await svc.identity(first.token)).toBeNull();
  });
  it('deletes the account and its data only with the right password', async () => {
    const { svc, store } = make();
    const s = await svc.signUp({ username: 'hank', password: pw }, '1.2.3.4');
    const who = (await svc.identity(s.token))!;
    await svc.putProgress(who, 'guitar.trainer.v1', { value: { a: 1 }, updatedAt: new Date().toISOString(), baseVersion: 0 });
    await svc.putPiece(who, 'mine:song', { text: 'title: Song' });
    expect(await status(svc.deleteAccount(who, { password: 'not my password' }, '1.2.3.4'))).toBe(401);
    await svc.deleteAccount(who, { password: pw }, '1.2.3.4');
    expect(store.users.size + store.progress.size + store.pieces.size + store.sessions.size).toBe(0);
    expect(await svc.identity(s.token)).toBeNull();
  });
});

describe('progress and pieces', () => {
  it('uses versions to detect conflicting writes', async () => {
    const { svc } = make();
    const who = (await svc.identity((await svc.signUp({ username: 'ivy', password: pw }, '1.1.1.9')).token))!;
    const first = await svc.putProgress(who, 'piece.trainer.v1', { value: { n: 1 }, updatedAt: '2026-11-10T00:00:00Z', baseVersion: 0 });
    expect(first).toMatchObject({ ok: true, item: { version: 1 } });
    const stale = await svc.putProgress(who, 'piece.trainer.v1', { value: { n: 2 }, updatedAt: '2026-11-10T01:00:00Z', baseVersion: 0 });
    expect(stale).toMatchObject({ ok: false, current: { version: 1, value: { n: 1 } } });
    expect(await svc.putProgress(who, 'piece.trainer.v1', { value: { n: 3 }, updatedAt: '2026-11-10T02:00:00Z', baseVersion: 1 })).toMatchObject({ ok: true, item: { version: 2 } });
    expect(await status(svc.putProgress(who, 'piece.imported.v1', { value: [], updatedAt: '', baseVersion: 0 }))).toBe(404);
    expect(await status(svc.putProgress(who, 'guitar.trainer.v1', { value: {}, updatedAt: '', baseVersion: -1 }))).toBe(400);
  });
  it('caps pieces per user', async () => {
    const { svc } = make();
    const who = (await svc.identity((await svc.signUp({ username: 'jack', password: pw }, '1.1.2.9')).token))!;
    for (let i = 0; i < LIMITS.piecesPerUser; i++) await svc.putPiece(who, `mine:p${i}`, { text: 'x' });
    expect(await status(svc.putPiece(who, 'mine:one-more', { text: 'x' }))).toBe(409);
    expect(await status(svc.putPiece(who, 'mine:p0', { text: 'updated' }))).toBe(200);
  });
  it('isolates users: A cannot read or write B’s progress or pieces', async () => {
    const { svc } = make();
    const a = (await svc.identity((await svc.signUp({ username: 'user-a', password: pw }, '1.0.0.1')).token))!;
    const b = (await svc.identity((await svc.signUp({ username: 'user-b', password: pw }, '1.0.0.2')).token))!;
    await svc.putProgress(b, 'guitar.trainer.v1', { value: { secret: 'b' }, updatedAt: '2026-11-10T00:00:00Z', baseVersion: 0 });
    await svc.putPiece(b, 'mine:b-song', { text: 'B only' });
    expect(await svc.listProgress(a)).toEqual([]);
    expect(await svc.listPieces(a)).toEqual([]);
    expect(await status(svc.getPiece(a, 'mine:b-song'))).toBe(404);
    expect(await status(svc.deletePiece(a, 'mine:b-song'))).toBe(404);
    // A writing the same key creates A's own row; B's value is untouched.
    await svc.putProgress(a, 'guitar.trainer.v1', { value: { mine: 'a' }, updatedAt: '2026-11-10T00:00:00Z', baseVersion: 0 });
    expect((await svc.listProgress(b))[0].value).toEqual({ secret: 'b' });
    expect((await svc.getPiece(b, 'mine:b-song')).text).toBe('B only');
  });
});
