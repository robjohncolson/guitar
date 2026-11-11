import type { IncomingMessage, ServerResponse } from 'node:http';
import { serviceFromEnv } from '../server/config.js';
import { createHandler } from '../server/http.js';
import type { AccountService } from '../server/service.js';

// One function serves every /api/* route (vercel.json rewrites /api/:route* here). Importing it opens no connection.
let service: AccountService | undefined;
const handle = createHandler(async () => (service ??= serviceFromEnv()));

/** The original path (/api/progress/x) or the rewrite destination (/api/router?route=progress/x). */
export function routeOf(url: string): string {
  const parsed = new URL(url, 'http://local');
  if (parsed.pathname === '/api/router') return parsed.searchParams.get('route') ?? '';
  return parsed.pathname.replace(/^\/api\/?/, '');
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try { await handle(req, res, routeOf(req.url ?? '/')); }
  catch {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: 'Accounts are not configured on this deployment.' }));
  }
}
