// Runs against a real Postgres with db/001_guitar_schema.sql applied, as the guitar_app role:
//   GUITAR_TEST_DATABASE_URL=postgresql://guitar_app@127.0.0.1:55433/postgres npx vitest run tests/server/postgres.test.ts
// Skipped when the variable is not set (CI and Vercel builds).
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createPool, PgStore } from '../../server/pg-store';
import { AccountService } from '../../server/service';

const url = process.env.GUITAR_TEST_DATABASE_URL;
const suffix = Math.random().toString(36).slice(2, 8);
const pw = 'integration password';

describe.skipIf(!url)('Postgres store as guitar_app (RLS)', () => {
  const pool = url ? createPool({ url, caPem: process.env.GUITAR_TEST_DATABASE_CA_PEM }) : (undefined as unknown as pg.Pool);
  const svc = url ? new AccountService(new PgStore(pool), { signupOpen: true, maxUsers: 100000 }) : (undefined as unknown as AccountService);
  const made: string[] = [];
  afterAll(async () => {
    if (!url) return;
    for (const token of made) { const who = await svc.identity(token); if (who) await svc.deleteAccount(who, { password: pw }, '127.0.0.1'); }
    await pool.end();
  });
  const user = async (name: string) => { const s = await svc.signUp({ username: `${name}-${suffix}`, password: pw }, `198.51.100.${made.length + 1}`); made.push(s.token); return (await svc.identity(s.token))!; };

  it('stores progress with versions and pieces with a cap, scoped to the owner', async () => {
    const a = await user('pga'), b = await user('pgb');
    expect(await svc.putProgress(b, 'guitar.trainer.v1', { value: { b: true }, updatedAt: '2026-11-10T00:00:00Z', baseVersion: 0 })).toMatchObject({ ok: true, item: { version: 1 } });
    expect(await svc.putProgress(b, 'guitar.trainer.v1', { value: { b: 2 }, updatedAt: '2026-11-10T00:00:00Z', baseVersion: 0 })).toMatchObject({ ok: false, current: { version: 1 } });
    await svc.putPiece(b, 'mine:b-piece', { text: 'b text' });
    expect(await svc.listProgress(a)).toEqual([]);
    expect(await svc.listPieces(a)).toEqual([]);
    await expect(svc.getPiece(a, 'mine:b-piece')).rejects.toMatchObject({ status: 404 });
    expect((await svc.listPieces(b))[0]).toMatchObject({ id: 'mine:b-piece', bytes: 6 });
  });

  it('RLS hides other users’ rows even from raw SQL that forgets the user filter', async () => {
    const a = await user('rla'), b = await user('rlb');
    await svc.putProgress(b, 'piece.trainer.v1', { value: { secret: 1 }, updatedAt: '2026-11-10T00:00:00Z', baseVersion: 0 });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      expect((await client.query('SELECT current_user AS u')).rows[0].u).toBe('guitar_app');
      expect((await client.query('SELECT count(*)::int AS n FROM guitar.progress')).rows[0].n).toBe(0);
      await client.query("SELECT set_config('guitar.user_id', $1, true)", [a.userId]);
      expect((await client.query('SELECT count(*)::int AS n FROM guitar.progress')).rows[0].n).toBe(0);
      await expect(client.query("INSERT INTO guitar.progress (user_id, key, value, updated_at) VALUES ($1, 'guitar.practice.v1', '{}', now())", [b.userId])).rejects.toMatchObject({ code: '42501' });
      await client.query('ROLLBACK');
      await client.query('BEGIN');
      await client.query("SELECT set_config('guitar.user_id', $1, true)", [a.userId]);
      expect((await client.query('UPDATE guitar.progress SET value = \'{"hacked":1}\' WHERE user_id = $1', [b.userId])).rowCount).toBe(0);
      expect((await client.query('DELETE FROM guitar.imported_pieces')).rowCount).toBe(0);
      await client.query('ROLLBACK');
      for (const q of ['CREATE TABLE guitar.x (id int)', 'SELECT * FROM pg_catalog.pg_authid', 'SET ROLE postgres']) {
        await client.query('BEGIN');
        await expect(client.query(q)).rejects.toBeTruthy();
        await client.query('ROLLBACK');
      }
    } finally { client.release(); }
    expect((await svc.listProgress(b))[0].value).toEqual({ secret: 1 });
  });

  it('deleting an account removes its progress, pieces and sessions', async () => {
    const s = await svc.signUp({ username: `gone-${suffix}`, password: pw }, '198.51.100.200');
    const who = (await svc.identity(s.token))!;
    await svc.putProgress(who, 'guitar.practice.v1', { value: { v: 1 }, updatedAt: '', baseVersion: 0 });
    await svc.putPiece(who, 'mine:gone', { text: 'gone' });
    await svc.deleteAccount(who, { password: pw }, '198.51.100.200');
    expect(await svc.identity(s.token)).toBeNull();
    await expect(svc.signIn({ username: `gone-${suffix}`, password: pw }, '198.51.100.201')).rejects.toMatchObject({ status: 401 });
  });
});
