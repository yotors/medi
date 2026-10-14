import type pg from 'pg';
import { schemaManifest } from './schema-manifest.ts';
import { boundedMfa } from './mfa-db.ts';
export function validateHistory(rows: {version:number;checksum?:string|null}[], complete=false) {
  if(complete && rows.length!==schemaManifest.length)throw Error('Schema unavailable.');
  for(let i=0;i<rows.length;i++)if(rows[i].version!==i+1 || !schemaManifest[i] || (rows[i].checksum!=null && rows[i].checksum!==schemaManifest[i].sha256) || (complete && rows[i].checksum!==schemaManifest[i].sha256))throw Error('Schema unavailable.');
}
export async function schemaReady(pool: pg.Pool) {
  try { await boundedMfa(pool,'status',async client=>{const {rows}=await client.query('SELECT version,checksum FROM registration_migrations ORDER BY version');validateHistory(rows,true);}); }
  catch { throw Error('Schema unavailable.'); }
}
const cache=new WeakMap<pg.Pool,{until:number;pending:Promise<void>}>();
export function compatibleSchema(pool: pg.Pool) {
  const now=Date.now(), old=cache.get(pool);if(old&&old.until>now)return old.pending;
  const state={until:Infinity,pending:Promise.resolve()};
  state.pending=schemaReady(pool).finally(()=>{state.until=Date.now()+2000;});cache.set(pool,state);return state.pending;
}
