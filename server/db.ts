import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { runtimeGrants } from './runtime-grants.ts';
import { schemaManifest } from './schema-manifest.ts';
import { validateHistory } from './schema.ts';

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  const pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000 });
  // pg removes the failed idle client. Never log its error object or connection details.
  pool.on('error', () => { process.stderr.write('An idle database connection failed. New requests will reconnect.\n'); });
  return pool;
}

export async function migrate(pool: pg.Pool, grants?: (client: pg.PoolClient) => Promise<void>) {
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
    // Verify every file before any application-schema write.
    const bodies=await Promise.all(schemaManifest.map(async entry=>{
      const body=await readFile(new URL(`./migrations/${entry.file}`,import.meta.url),'utf8');
      if(createHash('sha256').update(body).digest('hex')!==entry.sha256)throw Error('Migration artifact rejected.');return body;
    }));
    let history: {version:number;checksum?:string|null}[]=[];
    if(rows.length) {
      history=(await client.query('SELECT * FROM registration_migrations ORDER BY version')).rows;
      validateHistory(history);
      if(history.some(row=>row.checksum==null))await verifyLegacySchema(client,history.length,bodies);
    }
    await client.query('CREATE TABLE IF NOT EXISTS registration_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    await client.query('ALTER TABLE registration_migrations ADD COLUMN IF NOT EXISTS checksum text');
    for(const entry of schemaManifest) {
      if(entry.version>history.length) {
        await client.query(bodies[entry.version-1]);
        await client.query('INSERT INTO registration_migrations(version,checksum) VALUES ($1,$2)',[entry.version,entry.sha256]);
      } else await client.query('UPDATE registration_migrations SET checksum=$2 WHERE version=$1 AND checksum IS NULL',[entry.version,entry.sha256]);
    }
    await client.query('ALTER TABLE registration_migrations ALTER COLUMN checksum SET NOT NULL');
    if(grants)await grants(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Reconstruct only pinned historical SQL in a transient schema, within the owner
// transaction, and compare relational structure before adopting legacy hashes.
async function verifyLegacySchema(client: pg.PoolClient, version:number, bodies:string[]) {
  const original=(await client.query('SELECT current_schema() AS name')).rows[0].name as string;
  if(!/^[a-zA-Z0-9_]+$/.test(original))throw Error('Schema unavailable.');
  const runtime=(await client.query("SELECT rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls FROM pg_roles WHERE rolname='medi_runtime'")).rows[0];
  if(original==='public' && runtime) {
    if(Object.values(runtime).some(Boolean))throw Error('Legacy privileges rejected.');
    if((await client.query("SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='medi_runtime')")).rowCount)throw Error('Legacy privileges rejected.');
    const tables=(await client.query('SELECT tablename,tableowner FROM pg_tables WHERE schemaname=current_schema()')).rows;
    const owner=(await client.query('SELECT current_user AS name')).rows[0].name;
    for(const table of tables) {
      const current=runtimeGrants[table.tablename as keyof typeof runtimeGrants];
      const allowed=(version<=11&&table.tablename==='staff_sessions'?'SELECT, INSERT, DELETE':current)?.split(', ');
      if(!allowed || table.tableowner!==owner)throw Error('Legacy privileges rejected.');
      for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) {
        const actual=(await client.query('SELECT has_table_privilege($1,$2,$3) allowed',['medi_runtime','public.'+table.tablename,privilege])).rows[0].allowed;
        if(actual!==allowed.includes(privilege))throw Error('Legacy privileges rejected.');
      }
    }
    if((await client.query("SELECT has_schema_privilege('medi_runtime',current_schema(),'CREATE') unsafe")).rows[0].unsafe)throw Error('Legacy privileges rejected.');
  }
  const temporary='baseline_'+randomUUID().replaceAll('-','');
  const inventory=async(schema:string)=>{
    const result=await client.query(`SELECT c.relname,c.relkind,c.relrowsecurity,
      (SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) columns,
      (SELECT jsonb_agg(pg_get_constraintdef(k.oid) ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid=c.oid) constraints,
      (SELECT jsonb_agg(pg_get_indexdef(i.indexrelid) ORDER BY ic.relname) FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid WHERE i.indrelid=c.oid) indexes
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind IN ('r','v','m','f','p') AND c.relname<>'registration_migrations' ORDER BY c.relname`,[schema]);
    const triggers=(await client.query(`SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid) definition,t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal ORDER BY 1,2`,[schema])).rows;
    const functions=(await client.query(`SELECT p.proname,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 ORDER BY 1`,[schema])).rows;
    return JSON.stringify({tables:result.rows,triggers,functions}).replaceAll(schema+'.','');
  };
  await client.query(`CREATE SCHEMA "${temporary}"`);
  await client.query(`SET LOCAL search_path TO "${temporary}"`);
  for(let i=0;i<version;i++)await client.query(bodies[i]);
  const expected=JSON.parse(await inventory(temporary));
  // pg_dump reparses deparsed CHECKs: BETWEEN's nested AND becomes a flat AND.
  // Derive that alternate representation only from our pinned reconstruction.
  const checks=(await client.query(`SELECT t.relname,c.conname,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=$1 AND c.contype='c'`,[temporary])).rows;
  const quote=(name:string)=>'"'+name.replaceAll('"','""')+'"';
  for(const row of checks)await client.query(`ALTER TABLE ${quote(temporary)}.${quote(row.relname)} DROP CONSTRAINT ${quote(row.conname)}, ADD CONSTRAINT ${quote(row.conname)} ${row.definition}`);
  const roundtripped=JSON.parse(await inventory(temporary));
  await client.query(`SET LOCAL search_path TO "${original}"`);
  const actual=JSON.parse(await inventory(original));
  for(let i=0;i<expected.tables.length;i++) {
    const originalChecks=expected.tables[i].constraints, normalized=roundtripped.tables[i].constraints, observed=actual.tables[i]?.constraints;
    if(Array.isArray(originalChecks)&&Array.isArray(observed)&&observed.length===originalChecks.length) {
      for(let j=0;j<originalChecks.length;j++)if(observed[j]===normalized?.[j])observed[j]=originalChecks[j];
    }
  }
  if(JSON.stringify(expected)!==JSON.stringify(actual))throw Error('Legacy schema rejected.');
  await client.query(`DROP SCHEMA "${temporary}" CASCADE`);
}
