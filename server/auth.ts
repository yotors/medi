import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type pg from 'pg';
import type { Session } from '../shared/registration.ts';

export const SESSION_COOKIE = 'staff_session';
export const SESSION_SECONDS = 8 * 60 * 60;
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key));
  });
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt-v1:${salt}:${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, salt, hash] = encoded.split(':');
  // Version 1 fixes N=131072, r=8, p=1 and a 64-byte key; future costs need a new version.
  if (algorithm !== 'scrypt-v1' || !/^[a-f0-9]{32}$/.test(salt ?? '') || !/^[a-f0-9]{128}$/.test(hash ?? '')) return false;
  return timingSafeEqual(await derive(password, salt), Buffer.from(hash, 'hex'));
}
// Unknown accounts still perform the same password derivation.
export const DUMMY_PASSWORD_HASH = `scrypt-v1:${'0'.repeat(32)}:${'0'.repeat(128)}`;
export function safeEqual(left: string, right: string) {
  return timingSafeEqual(Buffer.from(digest(left), 'hex'), Buffer.from(digest(right), 'hex'));
}

export async function readSession(pool: pg.Pool, token: string | undefined): Promise<Session | null> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const { rows: [row] } = await pool.query(`
    SELECT u.id, u.display_name, u.role, h.id AS hospital_id, h.name AS hospital_name,
      h.code AS hospital_code, s.csrf_token, s.expires_at
    FROM staff_sessions s JOIN staff_users u ON u.id=s.user_id
    JOIN hospitals h ON h.id=u.hospital_id
    WHERE s.token_hash=$1 AND s.expires_at > now() AND u.active=true`, [digest(token)]);
  return row ? {
    user: { id: row.id, displayName: row.display_name, role: row.role,
      hospital: { id: row.hospital_id, name: row.hospital_name, code: row.hospital_code } },
    csrfToken: row.csrf_token,
    expiresAt: row.expires_at.toISOString(),
  } : null;
}

export async function allowLogin(pool: pg.Pool, account: string, ip: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(71934103)');
    await client.query('DELETE FROM login_buckets WHERE expires_at <= now()');
    const { rows: [count] } = await client.query('SELECT count(*)::integer AS count FROM login_buckets');
    let allowed = true;
    for (const [key, limit] of [[`account:${account}`, 10], [`ip:${ip}`, 50]] as const) {
      const hash = digest(key);
      const { rows: [existing] } = await client.query('SELECT attempts FROM login_buckets WHERE bucket_hash=$1', [hash]);
      if (!existing && count.count >= 9998) { allowed = false; continue; }
      const { rows: [bucket] } = await client.query(`
        INSERT INTO login_buckets(bucket_hash, attempts, expires_at) VALUES ($1, 1, now() + interval '15 minutes')
        ON CONFLICT (bucket_hash) DO UPDATE SET attempts=LEAST(login_buckets.attempts + 1, 1000000)
        RETURNING attempts`, [hash]);
      if (bucket.attempts > limit) allowed = false;
    }
    await client.query('COMMIT');
    return allowed;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
