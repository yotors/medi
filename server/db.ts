import { readFile } from 'node:fs/promises';
import pg from 'pg';

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  const pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000 });
  // pg removes the failed idle client. Never log its error object or connection details.
  pool.on('error', () => { process.stderr.write('An idle database connection failed. New requests will reconnect.\n'); });
  return pool;
}

export async function migrate(pool: pg.Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(71934102)');
    const { rows: [identity] } = await client.query<{ name: string }>('SELECT current_database() AS name');
    if (!/^(hospital_(dev|test)|product_studio(?:_[a-z0-9_]+)?)$/.test(identity.name)) {
      throw new Error('Migrations require a dedicated hospital_dev, hospital_test or product_studio database.');
    }
    const { rows } = await client.query<{ tablename: string }>(
      'SELECT tablename FROM pg_tables WHERE schemaname = current_schema()',
    );
    if (rows.length && !rows.some(row => row.tablename === 'registration_migrations')) {
      throw new Error('Refusing to initialize an existing unrelated database schema.');
    }
    await client.query('CREATE TABLE IF NOT EXISTS registration_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const [version, file] of [[1, '001_registration.sql'], [2, '002_outpatient.sql'], [3, '003_outpatient_integrity.sql'], [4, '004_staff_administration.sql'], [5, '005_hospital_configuration.sql'], [6, '006_configuration_indexes.sql'], [7, '007_outpatient_billing.sql']] as const) {
      const applied = await client.query('SELECT 1 FROM registration_migrations WHERE version = $1', [version]);
      if (!applied.rowCount) {
        await client.query(await readFile(new URL(`./migrations/${file}`, import.meta.url), 'utf8'));
        await client.query('INSERT INTO registration_migrations(version) VALUES ($1)', [version]);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
