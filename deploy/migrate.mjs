import {runtimeGrants as privileges} from '../compiled/server/runtime-grants.js';
import { createPool, migrate } from '../compiled/server/db.js';

const password = process.env.MEDI_RUNTIME_PASSWORD ?? '';
if (!/^[a-f0-9]{64}$/.test(password)) throw new Error('A generated runtime credential is required.');
const pool = createPool();
try {
  await migrate(pool, async client => {
    if (!(await client.query("SELECT 1 FROM pg_roles WHERE rolname='medi_runtime'")).rowCount) {
      await client.query('CREATE ROLE medi_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION');
    }
    // Hex-only private input; PostgreSQL utility statements cannot bind this field.
    await client.query(`ALTER ROLE medi_runtime WITH PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`);
    await client.query('REVOKE ALL ON DATABASE product_studio_release FROM PUBLIC');
    await client.query('GRANT CONNECT ON DATABASE product_studio_release TO medi_runtime');
    await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await client.query('GRANT USAGE ON SCHEMA public TO medi_runtime');
    await client.query('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM medi_runtime');

    const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows;
    for (const { tablename } of tables) {
      if (!Object.hasOwn(privileges, tablename)) throw new Error('A new table requires explicit runtime privileges.');
      await client.query(`GRANT ${privileges[tablename]} ON TABLE public."${tablename}" TO medi_runtime`);
    }
  });
  console.log('Release migrations and restricted runtime grants applied.');
} catch {
  console.error('Release migration failed. Configuration and database diagnostics were not logged.');
  process.exitCode = 1;
} finally { await pool.end(); }
