import { createPool, migrate } from '../compiled/server/db.js';

const password = process.env.MEDI_RUNTIME_PASSWORD ?? '';
if (!/^[a-f0-9]{64}$/.test(password)) throw new Error('A generated runtime credential is required.');
const pool = createPool();
try {
  await migrate(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(71934102)');
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
    const privileges = {
      registration_migrations: 'SELECT',
      hospitals: 'SELECT, UPDATE',
      staff_users: 'SELECT, INSERT, UPDATE',
      staff_sessions: 'SELECT, INSERT, DELETE',
      login_buckets: 'SELECT, INSERT, UPDATE, DELETE',
      patients: 'SELECT, INSERT',
      registration_requests: 'SELECT, INSERT',
      audit_events: 'SELECT, INSERT',
      outpatient_visits: 'SELECT, INSERT, UPDATE',
      outpatient_requests: 'SELECT, INSERT',
      staff_administration_events: 'SELECT, INSERT',
      staff_administration_requests: 'SELECT, INSERT',
      hospital_departments: 'SELECT, INSERT, UPDATE',
      hospital_services: 'SELECT, INSERT, UPDATE',
      hospital_service_versions: 'SELECT, INSERT',
      hospital_configuration_events: 'SELECT, INSERT',
      hospital_configuration_requests: 'SELECT, INSERT',
      billing_invoices: 'SELECT, INSERT',
      billing_lines: 'SELECT, INSERT',
      billing_payments: 'SELECT, INSERT',
      billing_receipts: 'SELECT, INSERT',
      billing_events: 'SELECT, INSERT',
      billing_requests: 'SELECT, INSERT',
      billing_counters: 'SELECT, INSERT, UPDATE',
      clinical_amendments: 'SELECT, INSERT',
      clinical_events: 'SELECT, INSERT',
      clinical_requests: 'SELECT, INSERT',
      inventory_products: 'SELECT, INSERT, UPDATE',
      inventory_batches: 'SELECT, INSERT, UPDATE',
      inventory_movements: 'SELECT, INSERT',
      inventory_authorizations: 'SELECT, INSERT',
      inventory_dispenses: 'SELECT, INSERT',
      inventory_events: 'SELECT, INSERT',
      inventory_requests: 'SELECT, INSERT',
    };
    const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows;
    for (const { tablename } of tables) {
      if (!Object.hasOwn(privileges, tablename)) throw new Error('A new table requires explicit runtime privileges.');
      await client.query(`GRANT ${privileges[tablename]} ON TABLE public."${tablename}" TO medi_runtime`);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  console.log('Release migrations and restricted runtime grants applied.');
} catch {
  console.error('Release migration failed. Configuration and database diagnostics were not logged.');
  process.exitCode = 1;
} finally { await pool.end(); }
