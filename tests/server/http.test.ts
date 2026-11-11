import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHandler } from '../../server/http';
import { AccountService } from '../../server/service';
import { MemoryStore } from '../../server/store';
import { routeOf } from '../../api/router';

let server: Server, base = '';
beforeAll(async () => {
  const handle = createHandler(new AccountService(new MemoryStore(), { signupOpen: true, maxUsers: 100 }));
  server = createServer((req, res) => void handle(req, res, routeOf(req.url ?? '/')));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

const call = async (path: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string | null; type?: string } = {}) => {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['content-type'] = init.type ?? 'application/json';
  if (init.origin !== null && init.method && init.method !== 'GET') headers.origin = init.origin ?? base;
  if (init.cookie) headers.cookie = init.cookie;
  const res = await fetch(base + path, { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined, cookie: res.headers.get('set-cookie') ?? '' };
};
const cookieOf = (setCookie: string) => setCookie.split(';')[0];

describe('account HTTP API', () => {
  it('maps rewrite destinations and original paths to the same route', () => {
    expect(routeOf('/api/router?route=progress/guitar.trainer.v1')).toBe('progress/guitar.trainer.v1');
    expect(routeOf('/api/pieces/mine%3Asong')).toBe('pieces/mine%3Asong');
  });
  it('signs up with an httpOnly cookie and serves only the signed-in user’s data', async () => {
    expect((await call('/api/session')).body).toEqual({ accounts: true, signedIn: false, username: null });
    const a = await call('/api/auth/signup', { method: 'POST', body: { username: 'http-a', password: 'a long password' } });
    expect(a.status).toBe(200);
    expect(a.cookie).toMatch(/^guitar_session=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000$/);
    const ca = cookieOf(a.cookie);
    expect((await call('/api/session', { cookie: ca })).body).toMatchObject({ signedIn: true, username: 'http-a' });
    const b = cookieOf((await call('/api/auth/signup', { method: 'POST', body: { username: 'http-b', password: 'b long password' } })).cookie);
    expect((await call('/api/progress/guitar.practice.v1', { method: 'PUT', cookie: b, body: { value: { volume: 0.4 }, updatedAt: new Date().toISOString(), baseVersion: 0 } })).status).toBe(200);
    expect((await call('/api/pieces/mine%3Ab-only', { method: 'PUT', cookie: b, body: { text: 'private to b' } })).status).toBe(200);
    expect((await call('/api/progress', { cookie: ca })).body).toEqual({ items: [] });
    expect((await call('/api/pieces', { cookie: ca })).body).toEqual({ items: [] });
    expect((await call('/api/pieces/mine%3Ab-only', { cookie: ca })).status).toBe(404);
    expect((await call('/api/progress', { cookie: b })).body.items).toHaveLength(1);
    expect((await call('/api/pieces/mine%3Ab-only', { cookie: b })).body.piece.text).toBe('private to b');
  });
  it('requires a session, same-origin JSON and returns conflicts with the current value', async () => {
    expect((await call('/api/progress')).status).toBe(401);
    const c = cookieOf((await call('/api/auth/signup', { method: 'POST', body: { username: 'http-c', password: 'c long password' } })).cookie);
    expect((await call('/api/progress/guitar.trainer.v1', { method: 'PUT', cookie: c, origin: 'https://evil.example', body: { value: {}, updatedAt: '', baseVersion: 0 } })).status).toBe(403);
    expect((await call('/api/progress/guitar.trainer.v1', { method: 'PUT', cookie: c, origin: null, body: { value: {}, updatedAt: '', baseVersion: 0 } })).status).toBe(403);
    expect((await call('/api/progress/guitar.trainer.v1', { method: 'PUT', cookie: c, type: 'text/plain', body: { value: {}, updatedAt: '', baseVersion: 0 } })).status).toBe(415);
    expect((await call('/api/progress/guitar.trainer.v1', { method: 'PUT', cookie: c, body: { value: { x: 1 }, updatedAt: '', baseVersion: 0 } })).status).toBe(200);
    const conflict = await call('/api/progress/guitar.trainer.v1', { method: 'PUT', cookie: c, body: { value: { x: 2 }, updatedAt: '', baseVersion: 0 } });
    expect(conflict).toMatchObject({ status: 409, body: { error: 'conflict', current: { version: 1, value: { x: 1 } } } });
    expect((await call('/api/auth/signout', { method: 'POST', cookie: c, body: {} })).cookie).toContain('Max-Age=0');
    expect((await call('/api/progress', { cookie: c })).status).toBe(401);
  });
  it('deletes an account with its password and logs client errors without failing', async () => {
    const d = cookieOf((await call('/api/auth/signup', { method: 'POST', body: { username: 'http-d', password: 'd long password' } })).cookie);
    expect((await call('/api/account/delete', { method: 'POST', cookie: d, body: { password: 'wrong one!!' } })).status).toBe(401);
    expect((await call('/api/account/delete', { method: 'POST', cookie: d, body: { password: 'd long password' } })).status).toBe(200);
    expect((await call('/api/auth/signin', { method: 'POST', body: { username: 'http-d', password: 'd long password' } })).status).toBe(401);
    expect((await call('/api/client-error', { method: 'POST', body: { message: 'boom', page: 'piece' } })).status).toBe(204);
    expect((await call('/api/pieces/..%2F..%2Fetc', { method: 'GET' })).status).toBe(404);
  });
});
