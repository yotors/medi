// Local synthetic database only. Backups include account/session data; keep private.
import { randomBytes } from 'node:crypto';
import { closeSync, lstatSync, mkdirSync, openSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const mode = process.argv[2];
if (!['backup', 'restore-check'].includes(mode)) throw new Error('Use backup or restore-check.');
let url;
try { url = new URL(process.env.DATABASE_URL ?? ''); }
catch { throw new Error('A valid local DATABASE_URL is required.'); }
if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '15432'
  || url.pathname !== '/hospital_dev' || url.username !== 'hospital_dev' || url.search || url.hash) {
  throw new Error('This tool only supports the dedicated local hospital_dev database.');
}
for (const directory of ['.local', '.local/backups']) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077)) {
    throw new Error('Backup directories must be private real directories (mode 700).');
  }
}
const base = `.local/backups/${new Date().toISOString().replaceAll(':', '-')}-${randomBytes(4).toString('hex')}`;
const dump = `${base}.dump`;
function docker(args, input = 'ignore', output = 'pipe') {
  const result = spawnSync('docker', ['compose', 'exec', '-T', 'database', ...args], {
    stdio: [input, output, 'pipe'], timeout: 120000, maxBuffer: 1024 * 1024,
  });
  // PostgreSQL diagnostics may include sensitive rows; do not log captured stderr.
  if (result.error || result.status !== 0) throw new Error(`Local database ${args[0]} failed; no database contents logged.`);
}
async function inventory(client) {
  const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const result = {};
  for (const { tablename } of tables.rows) {
    const table = `public."${tablename.replaceAll('"', '""')}"`;
    const { rows } = await client.query(`SELECT count(*)::text AS count,
      md5(coalesce(string_agg(digest, '' ORDER BY digest), '')) AS digest
      FROM (SELECT md5(row_to_json(t)::text) AS digest FROM ${table} t) rows`);
    result[tablename] = rows[0];
  }
  if (!result.registration_migrations) throw new Error('Expected Medi migration marker is missing.');
  const schema = {};
  const definitions = {
    columns: `SELECT table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default
      FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`,
    constraints: `SELECT c.relname AS table_name,k.conname,k.contype,pg_get_constraintdef(k.oid,true) AS definition
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' ORDER BY c.relname,k.conname`,
    indexes: `SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname`,
    triggers: `SELECT c.relname AS table_name,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true) AS definition
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`,
    functions: `SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p')
      ORDER BY p.proname,arguments`,
    sequences: `SELECT sequencename,data_type,start_value,min_value,max_value,increment_by,cycle,cache_size
      FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename`,
    views: `SELECT viewname,definition FROM pg_views WHERE schemaname='public' ORDER BY viewname`,
  };
  for (const [kind, query] of Object.entries(definitions)) schema[kind] = (await client.query(query)).rows;
  return { tables: result, schema };
}
const source = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 5000 });
let temporary;
let target;
let dumped = false;
try {
  await source.connect();
  await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const snapshot = (await source.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
  const expected = await inventory(source);
  const output = openSync(dump, 'wx', 0o600);
  try {
    docker(['pg_dump', '-U', 'hospital_dev', '-d', 'hospital_dev', '--format=custom', '--schema=public', `--snapshot=${snapshot}`], 'ignore', output);
    dumped = true;
  } finally { closeSync(output); }
  await source.query('COMMIT');
  writeFileSync(`${base}.json`, JSON.stringify({ createdAt: new Date().toISOString(), ...expected }, null, 2), { mode: 0o600, flag: 'wx' });
  console.log(`Private local backup: ${dump}`);
  if (mode === 'restore-check') {
    const name = `hospital_restorecheck_${randomBytes(8).toString('hex')}`;
    docker(['createdb', '-U', 'hospital_dev', name]);
    temporary = name;
    const input = openSync(dump, 'r');
    try { docker(['pg_restore', '-U', 'hospital_dev', '--clean', '--if-exists', '--no-owner', '--no-privileges', '--exit-on-error', '-d', name], input); }
    finally { closeSync(input); }
    const restoredUrl = new URL(url);
    restoredUrl.pathname = `/${name}`;
    target = new pg.Client({ connectionString: restoredUrl.href, connectionTimeoutMillis: 5000 });
    await target.connect();
    const actual = await inventory(target);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Restore verification failed: schema, table counts or content digests differ.');
    console.log(`Restore verified: ${Object.keys(actual.tables).length} tables; schema, counts and content digests match. Source database was not modified.`);
  }
} catch (error) {
  if (!dumped) { try { unlinkSync(dump); } catch {} }
  console.error(error instanceof Error && /^(Local database |Expected Medi |Restore verification)/.test(error.message)
    ? error.message : 'Local database operation failed; sensitive diagnostics withheld.');
  process.exitCode = 1;
} finally {
  await target?.end();
  await source.end();
  if (temporary && /^hospital_restorecheck_[a-f0-9]{16}$/.test(temporary)) {
    try { docker(['dropdb', '-U', 'hospital_dev', '--force', temporary]); }
    catch { console.error(`Could not remove temporary database ${temporary}.`); process.exitCode = 1; }
  }
}
