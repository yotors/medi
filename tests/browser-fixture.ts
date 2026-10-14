import type pg from 'pg';
import { digest } from '../server/auth';
import { migrate } from '../server/db';

export async function prepareBrowserFixture(pool: pg.Pool) {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (
    process.env.MEDI_BROWSER_TEST !== '1' ||
    process.env.NODE_ENV === 'production' ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '15432' ||
    url.pathname !== '/hospital_dev'
  ) {
    throw new Error('Browser fixtures require the dedicated local development database.');
  }
  await migrate(pool);
  // Sequential browser files share loopback, unlike independent hospital staff.
  // Give each synthetic fixture a fresh IP budget; account limits remain intact.
  // Rate-limit enforcement itself is tested in isolated server integration schemas.
  await pool.query('DELETE FROM login_buckets WHERE bucket_hash=$1', [digest('ip:127.0.0.1')]);
}
