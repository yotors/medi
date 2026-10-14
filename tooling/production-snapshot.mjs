// Sent to the recorded API image as fixed code; never sourced from an archive.
import pg from 'pg';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
const client = new pg.Client({
  connectionString: (await import('./compiled/server/secrets.js')).databaseUrl(),
  statement_timeout: 120000,
});
const lines = createInterface({ input: process.stdin });
const iterator = lines[Symbol.asyncIterator]();
const timer = setTimeout(() => {
  client.end().finally(() => process.exit(1));
}, 240000);
const identifier = (value) => '"' + value.replaceAll('"', '""') + '"';
try {
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const schemas = (
    await client.query(
      "SELECT nspname FROM pg_namespace WHERE left(nspname,3) <> 'pg_' AND nspname <> 'information_schema' ORDER BY 1",
    )
  ).rows;
  if (JSON.stringify(schemas) !== '[{"nspname":"public"}]') throw Error();
  if (
    (
      await client.query(
        "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind NOT IN ('r','i','v')",
      )
    ).rowCount
  )
    throw Error();
  // Unsupported state is rejected rather than producing incomplete evidence.
  for (const sql of [
    'SELECT 1 FROM pg_largeobject_metadata',
    'SELECT 1 FROM pg_default_acl',
    "SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname<>'public'",
    "SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype IN ('d','e','r','m')",
  ])
    if ((await client.query(sql)).rowCount) throw Error();
  for (const sql of [
    'SELECT 1 FROM pg_db_role_setting',
    "SELECT 1 FROM pg_collation c JOIN pg_namespace n ON n.oid=c.collnamespace WHERE n.nspname='public'",
    "SELECT 1 FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT (c.relkind='v' AND r.rulename='_RETURN')",
  ])
    if ((await client.query(sql)).rowCount) throw Error();
  const inventory = {};
  const queries = {
    policies:
      "SELECT schemaname,tablename,policyname,permissive,roles::text[] AS roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname",
    views:
      "SELECT v.viewname,v.definition,c.reloptions FROM pg_views v JOIN pg_namespace n ON n.nspname=v.schemaname JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=v.viewname WHERE v.schemaname='public' ORDER BY v.viewname",
    tables:
      "SELECT c.relname, c.relkind, pg_get_userbyid(c.relowner) owner,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname",
    columns:
      "SELECT table_name,column_name,ordinal_position,column_default,is_nullable,data_type,udt_name,character_maximum_length,numeric_precision,numeric_scale,collation_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position",
    constraints:
      "SELECT c.relname,con.conname,pg_get_constraintdef(con.oid,true) definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY 1,2",
    indexes:
      "SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY 1,2",
    triggers:
      "SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid) definition,t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY 1,2",
    functions:
      "SELECT p.proname,pg_get_function_identity_arguments(p.oid) args,pg_get_functiondef(p.oid) definition,pg_get_userbyid(p.proowner) owner,p.proacl::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY 1,2",
    schemas:
      "SELECT nspname,pg_get_userbyid(nspowner) owner,nspacl::text FROM pg_namespace WHERE nspname='public'",
    roles:
      "SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,rolconfig FROM pg_roles WHERE rolname IN ('medi_migrator','medi_runtime') ORDER BY 1",
    memberships:
      "SELECT pg_get_userbyid(roleid) role,pg_get_userbyid(member) member,admin_option FROM pg_auth_members WHERE pg_get_userbyid(member) IN ('medi_migrator','medi_runtime') ORDER BY 1,2",
    database:
      'SELECT datname,pg_get_userbyid(datdba) owner,datacl::text,encoding,datcollate,datctype FROM pg_database WHERE datname=current_database()',
    versions: 'SELECT version FROM registration_migrations ORDER BY version',
    extensions: 'SELECT extname,extversion FROM pg_extension ORDER BY extname',
  };
  for (const [name, sql] of Object.entries(queries))
    inventory[name] = (await client.query(sql)).rows;
  inventory.records = [];
  for (const { relname, relkind } of inventory.tables) {
    if (relkind !== 'r') continue;
    const hash = createHash('sha256');
    let count = 0;
    await client.query(
      'DECLARE records NO SCROLL CURSOR FOR SELECT to_jsonb(t)::text AS row FROM public.' +
        identifier(relname) +
        ' t ORDER BY to_jsonb(t)::text COLLATE "C"',
    );
    while (true) {
      const rows = (await client.query('FETCH 256 FROM records')).rows;
      if (!rows.length) break;
      for (const { row } of rows) {
        hash.update(String(Buffer.byteLength(row)) + ':' + row);
        count++;
      }
    }
    await client.query('CLOSE records');
    inventory.records.push({ table: relname, count, sha256: hash.digest('hex') });
  }
  const snapshot = (await client.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
  const version = (await client.query('SHOW server_version')).rows[0].server_version;
  process.stdout.write(JSON.stringify({ snapshot, version, inventory }) + '\n');
  const command = await iterator.next();
  if (command.done || command.value !== 'commit') throw Error();
  await client.query('COMMIT');
} catch {
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  lines.close();
  await client.end();
}
