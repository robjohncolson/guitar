import pg from 'pg';
import type { ProgressKey } from './core.js';
import type { AttemptAction, PieceSummary, ProgressItem, PutProgressResult, Store } from './store.js';

export type DatabaseConfig = { url: string; caPem?: string; poolMax?: number };

/** Explicit TLS fields so a URL sslmode can never weaken certificate verification. */
export function createPool(config: DatabaseConfig): pg.Pool {
  const host = new URL(config.url).hostname;
  const local = host === 'localhost' || host === '127.0.0.1';
  return new pg.Pool({
    connectionString: config.url,
    ssl: local && !config.caPem ? false : { rejectUnauthorized: true, ...(config.caPem ? { ca: config.caPem } : {}) },
    max: config.poolMax ?? 1, idleTimeoutMillis: 5_000, connectionTimeoutMillis: 10_000,
  });
}

type Row = { key: ProgressKey; value: unknown; updated_at: Date; version: number };
const item = (r: Row): ProgressItem => ({ key: r.key, value: r.value, updatedAt: r.updated_at.toISOString(), version: r.version });

export class PgStore implements Store {
  constructor(private readonly pool: pg.Pool) {}

  /** One transaction per call. User-data calls set guitar.user_id, which the RLS policies require. */
  private async tx<T>(userId: string | null, run: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      const role = await client.query<{ role: string }>("SELECT current_user AS role, set_config('guitar.user_id', $1, true)", [userId ?? '']);
      if (role.rows[0]?.role !== 'guitar_app') throw new Error('Unexpected database role');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { broken = true; }
      throw error;
    } finally { client.release(broken); }
  }

  countAttempts(bucket: string, action: AttemptAction, since: Date, failuresOnly: boolean) {
    return this.tx(null, async c => Number((await c.query<{ n: string }>(
      'SELECT count(*) AS n FROM guitar.auth_attempts WHERE bucket = $1 AND action = $2 AND at >= $3 AND ($4::boolean IS FALSE OR NOT success)',
      [bucket, action, since, failuresOnly])).rows[0].n));
  }
  recordAttempt(buckets: string[], action: AttemptAction, success: boolean, now: Date) {
    return this.tx(null, async c => {
      await c.query('INSERT INTO guitar.auth_attempts (bucket, action, success, at) SELECT b, $2, $3, $4 FROM unnest($1::text[]) AS b', [buckets, action, success, now]);
      // Keep the table small: attempts only matter for the last hour.
      await c.query("DELETE FROM guitar.auth_attempts WHERE at < $1::timestamptz - interval '1 day'", [now]);
    });
  }
  countUsers() { return this.tx(null, async c => Number((await c.query<{ n: string }>('SELECT count(*) AS n FROM guitar.users')).rows[0].n)); }
  createUser(username: string, passwordHash: string, now: Date) {
    return this.tx(null, async c => (await c.query<{ id: string }>(
      'INSERT INTO guitar.users (username, password_hash, created_at) VALUES ($1, $2, $3) ON CONFLICT (username) DO NOTHING RETURNING id',
      [username, passwordHash, now])).rows[0]?.id ?? null);
  }
  findUser(username: string) {
    return this.tx(null, async c => (await c.query<{ id: string; passwordHash: string }>(
      'SELECT id, password_hash AS "passwordHash" FROM guitar.users WHERE username = $1', [username])).rows[0] ?? null);
  }
  passwordHash(userId: string) {
    return this.tx(null, async c => (await c.query<{ h: string }>('SELECT password_hash AS h FROM guitar.users WHERE id = $1', [userId])).rows[0]?.h ?? null);
  }
  async touchSignIn(userId: string, now: Date) { await this.tx(null, c => c.query('UPDATE guitar.users SET last_sign_in_at = $2 WHERE id = $1', [userId, now])); }
  async createSession(tokenHash: string, userId: string, now: Date, expires: Date, keep: number) {
    await this.tx(null, async c => {
      await c.query('INSERT INTO guitar.sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)', [tokenHash, userId, now, expires]);
      await c.query(`DELETE FROM guitar.sessions WHERE (user_id = $1 AND token_hash IN (
        SELECT token_hash FROM guitar.sessions WHERE user_id = $1 ORDER BY created_at DESC OFFSET $2)) OR expires_at <= $3`, [userId, keep, now]);
    });
  }
  sessionUser(tokenHash: string, now: Date) {
    return this.tx(null, async c => (await c.query<{ userId: string; username: string }>(
      'SELECT u.id AS "userId", u.username FROM guitar.sessions s JOIN guitar.users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > $2',
      [tokenHash, now])).rows[0] ?? null);
  }
  async deleteSession(tokenHash: string) { await this.tx(null, c => c.query('DELETE FROM guitar.sessions WHERE token_hash = $1', [tokenHash])); }
  async deleteUser(userId: string) {
    // Progress and pieces cascade; set the user id so the cascade passes the owner-only policies.
    await this.tx(userId, c => c.query('DELETE FROM guitar.users WHERE id = $1', [userId]));
  }
  listProgress(userId: string) {
    return this.tx(userId, async c => (await c.query<Row>('SELECT key, value, updated_at, version FROM guitar.progress WHERE user_id = $1 ORDER BY key', [userId])).rows.map(item));
  }
  putProgress(userId: string, key: ProgressKey, valueJson: string, updatedAt: Date, baseVersion: number): Promise<PutProgressResult> {
    return this.tx(userId, async c => {
      const current = (await c.query<Row>('SELECT key, value, updated_at, version FROM guitar.progress WHERE user_id = $1 AND key = $2 FOR UPDATE', [userId, key])).rows[0];
      if ((current?.version ?? 0) !== baseVersion) return { ok: false as const, current: current ? item(current) : null };
      const row = current
        ? (await c.query<Row>('UPDATE guitar.progress SET value = $3::jsonb, updated_at = $4, version = version + 1 WHERE user_id = $1 AND key = $2 RETURNING key, value, updated_at, version', [userId, key, valueJson, updatedAt])).rows[0]
        : (await c.query<Row>('INSERT INTO guitar.progress (user_id, key, value, updated_at, version) VALUES ($1, $2, $3::jsonb, $4, 1) ON CONFLICT DO NOTHING RETURNING key, value, updated_at, version', [userId, key, valueJson, updatedAt])).rows[0];
      if (!row) return { ok: false as const, current: null };
      return { ok: true as const, item: item(row) };
    });
  }
  listPieces(userId: string) {
    return this.tx(userId, async c => (await c.query<{ id: string; updated_at: Date; bytes: number }>(
      'SELECT piece_id AS id, updated_at, octet_length(text) AS bytes FROM guitar.imported_pieces WHERE user_id = $1 ORDER BY piece_id', [userId]))
      .rows.map((r): PieceSummary => ({ id: r.id, updatedAt: r.updated_at.toISOString(), bytes: Number(r.bytes) })));
  }
  getPiece(userId: string, pieceId: string) {
    return this.tx(userId, async c => {
      const r = (await c.query<{ id: string; text: string; updated_at: Date }>(
        'SELECT piece_id AS id, text, updated_at FROM guitar.imported_pieces WHERE user_id = $1 AND piece_id = $2', [userId, pieceId])).rows[0];
      return r ? { id: r.id, text: r.text, updatedAt: r.updated_at.toISOString() } : null;
    });
  }
  putPiece(userId: string, pieceId: string, text: string, now: Date, maxPieces: number): Promise<'ok' | 'limit'> {
    return this.tx(userId, async c => {
      // Serialise this user's piece writes so the cap cannot be raced.
      await c.query('SELECT 1 FROM guitar.users WHERE id = $1 FOR UPDATE', [userId]);
      const others = Number((await c.query<{ n: string }>('SELECT count(*) AS n FROM guitar.imported_pieces WHERE user_id = $1 AND piece_id <> $2', [userId, pieceId])).rows[0].n);
      if (others >= maxPieces) return 'limit' as const;
      await c.query(`INSERT INTO guitar.imported_pieces (user_id, piece_id, text, updated_at) VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, piece_id) DO UPDATE SET text = EXCLUDED.text, updated_at = EXCLUDED.updated_at`, [userId, pieceId, text, now]);
      return 'ok' as const;
    });
  }
  deletePiece(userId: string, pieceId: string) {
    return this.tx(userId, async c => ((await c.query('DELETE FROM guitar.imported_pieces WHERE user_id = $1 AND piece_id = $2', [userId, pieceId])).rowCount ?? 0) > 0);
  }
}
