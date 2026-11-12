// Local stand-in for Vercel: serves dist/ and runs api/router.ts for /api/*, so the account flow can be tested end to end.
//   GUITAR_DATABASE_URL=postgresql://guitar_app@127.0.0.1:55433/postgres PORT=4180 node scripts/accounts-server.mjs
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createServer as createVite } from 'vite';

const root = path.resolve('dist'), port = Number(process.env.PORT || 4180);
const vite = await createVite({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
const { default: handler } = await vite.ssrLoadModule('/api/router.ts');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/markdown', '.bin': 'application/octet-stream' };
createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://local');
  if (url.pathname.startsWith('/api/')) return handler(req, res);
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root)) { res.statusCode = 403; return res.end(); }
  try { if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html'); res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream'); res.end(await readFile(file)); }
  catch { res.statusCode = 404; res.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`accounts server on http://127.0.0.1:${port}`));
