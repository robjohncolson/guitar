import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, readSessionCookie, sessionCookie } from './core.js';
import type { AccountService, Identity } from './service.js';

const MAX_BODY = 2_400_000;
const errorBudget = { windowStart: 0, count: 0 };

function send(res: ServerResponse, status: number, body: unknown, cookie?: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (cookie) res.setHeader('Set-Cookie', cookie);
  res.end(body === undefined ? '' : JSON.stringify(body));
}

async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) throw new ApiError(415, 'Expected JSON.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new ApiError(413, 'Request too large.');
    chunks.push(chunk as Buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); } catch { throw new ApiError(400, 'Invalid JSON.'); }
}

/** Behind Vercel, the client address is the first x-forwarded-for entry (set by Vercel's edge). */
export function clientIp(req: IncomingMessage): string {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return (forwarded || String(req.headers['x-real-ip'] ?? '') || req.socket?.remoteAddress || 'unknown').slice(0, 64);
}

/** Session cookies are Secure (and __Host-) on HTTPS; plain names only for local http testing. */
export function isSecureRequest(req: IncomingMessage): boolean {
  const host = String(req.headers.host ?? '');
  const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim();
  return proto ? proto === 'https' : !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
}

/** Mutating requests must come from this same site (defence in depth on top of SameSite=Lax). */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== 'string') return false;
  try {
    const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim();
    return new URL(origin).host === host;
  } catch { return false; }
}

export type Route = { method: string; path: string[] };

export function createHandler(service: AccountService | (() => Promise<AccountService>)) {
  const getService = typeof service === 'function' ? service : async () => service;
  return async function handle(req: IncomingMessage, res: ServerResponse, route: string): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase();
    let path: string[];
    try { path = route.split('/').filter(Boolean).map(decodeURIComponent); } catch { path = ['\u0000']; }
    const secure = isSecureRequest(req);
    try {
      if (path.length > 3 || path.some(segment => !/^[A-Za-z0-9:_.-]{1,80}$/.test(segment) || /^\.+$/.test(segment))) throw new ApiError(404, 'Not found.');
      if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(req)) throw new ApiError(403, 'Cross-site request refused.');

      if (path[0] === 'client-error' && method === 'POST' && path.length === 1) {
        const body = await readJson(req, 4096);
        const now = Date.now();
        if (now - errorBudget.windowStart > 60_000) { errorBudget.windowStart = now; errorBudget.count = 0; }
        if (++errorBudget.count <= 30 && body && typeof body === 'object') {
          const b = body as Record<string, unknown>;
          const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : undefined);
          // Logged to the Vercel function log only. No IP, cookie or user id is recorded.
          console.warn(JSON.stringify({ kind: 'client-error', page: clip(b.page, 100), message: clip(b.message, 500), source: clip(b.source, 200), line: typeof b.line === 'number' ? b.line : undefined, stack: clip(b.stack, 1500) }));
        }
        return send(res, 204, undefined);
      }

      const svc = await getService();
      const token = readSessionCookie(secure, req.headers.cookie);
      const ip = clientIp(req);

      if (path[0] === 'session' && method === 'GET' && path.length === 1) {
        const who = await svc.identity(token);
        return send(res, 200, { accounts: true, signedIn: Boolean(who), username: who?.username ?? null }, token && !who ? sessionCookie(secure, null) : undefined);
      }
      if (path[0] === 'auth' && method === 'POST' && path.length === 2) {
        if (path[1] === 'signup' || path[1] === 'signin') {
          const body = await readJson(req, 4096);
          const result = path[1] === 'signup' ? await svc.signUp(body, ip) : await svc.signIn(body, ip);
          return send(res, 200, { signedIn: true, username: result.username }, sessionCookie(secure, result.token));
        }
        if (path[1] === 'signout') {
          await svc.signOut(token);
          return send(res, 200, { signedIn: false }, sessionCookie(secure, null));
        }
      }

      const who: Identity | null = await svc.identity(token);
      if (!who) throw new ApiError(401, 'Please sign in.');

      if (path[0] === 'account' && path[1] === 'delete' && method === 'POST' && path.length === 2) {
        await svc.deleteAccount(who, await readJson(req, 4096), ip);
        return send(res, 200, { deleted: true }, sessionCookie(secure, null));
      }
      if (path[0] === 'progress') {
        if (method === 'GET' && path.length === 1) return send(res, 200, { items: await svc.listProgress(who) });
        if (method === 'PUT' && path.length === 2) {
          const result = await svc.putProgress(who, path[1], await readJson(req, 600_000));
          return result.ok ? send(res, 200, { item: result.item }) : send(res, 409, { error: 'conflict', current: result.current });
        }
      }
      if (path[0] === 'pieces') {
        if (method === 'GET' && path.length === 1) return send(res, 200, { items: await svc.listPieces(who) });
        if (path.length === 2) {
          if (method === 'GET') return send(res, 200, { piece: await svc.getPiece(who, path[1]) });
          if (method === 'PUT') { await svc.putPiece(who, path[1], await readJson(req, MAX_BODY)); return send(res, 200, { saved: true }); }
          if (method === 'DELETE') { await svc.deletePiece(who, path[1]); return send(res, 200, { deleted: true }); }
        }
      }
      throw new ApiError(404, 'Not found.');
    } catch (error) {
      if (error instanceof ApiError) return send(res, error.status, { error: error.message });
      // Database and configuration errors can contain connection details; log the class only.
      console.error(JSON.stringify({ kind: 'api-error', route: path.slice(0, 1).join('/'), name: (error as Error)?.name, code: (error as { code?: string })?.code }));
      return send(res, 503, { error: 'Accounts are temporarily unavailable. Your progress is still saved in this browser.' });
    }
  };
}
