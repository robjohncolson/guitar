import { createPool } from './pg-store.js';
import { PgStore } from './pg-store.js';
import { AccountService } from './service.js';

/** Builds the service from environment variables. Errors name the setting, never its value. */
export function serviceFromEnv(env: NodeJS.ProcessEnv = process.env): AccountService {
  const url = env.GUITAR_DATABASE_URL;
  if (!url) throw new Error('GUITAR_DATABASE_URL is not set');
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error('GUITAR_DATABASE_URL is not a valid URL'); }
  const local = ['localhost', '127.0.0.1'].includes(parsed.hostname);
  const caPem = env.GUITAR_DATABASE_CA_PEM?.replace(/\\n/g, '\n');
  if (!local && !caPem?.includes('-----BEGIN CERTIFICATE-----')) throw new Error('GUITAR_DATABASE_CA_PEM must contain the Supabase CA certificate');
  const maxUsers = env.GUITAR_MAX_USERS === undefined ? 1000 : Number(env.GUITAR_MAX_USERS);
  if (!Number.isInteger(maxUsers) || maxUsers < 0) throw new Error('GUITAR_MAX_USERS must be a whole number');
  if (env.GUITAR_SIGNUP !== undefined && !['open', 'closed'].includes(env.GUITAR_SIGNUP)) throw new Error('GUITAR_SIGNUP must be open or closed');
  return new AccountService(new PgStore(createPool({ url, caPem })), { signupOpen: env.GUITAR_SIGNUP !== 'closed', maxUsers });
}
