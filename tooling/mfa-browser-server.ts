import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPool, migrate } from '../server/db.ts';
import { buildApp } from '../server/app.ts';
const directory=mkdtempSync(join(tmpdir(),'mfa-browser-'));
process.env.STAFF_MFA_KEYRING_FILE=join(directory,'keys.json');
writeFileSync(process.env.STAFF_MFA_KEYRING_FILE,JSON.stringify({current:'browser',keys:{browser:randomBytes(32).toString('hex')}}),{mode:0o600});
process.env.STAFF_MFA_POLICY='required';
const pool=createPool();await migrate(pool);
// A dedicated schema keeps ephemeral browser keys independent of other fixtures.
const schema='mfa_browser_'+randomBytes(8).toString('hex');await pool.query(`CREATE SCHEMA ${schema}`);
const pg=await import('pg');const scoped=new pg.default.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});await migrate(scoped);
const app=buildApp({pool:scoped,origin:'http://127.0.0.1:5176'});
// Test process obtains only the schema name, never a key or seed.
mkdirSync('.local',{recursive:true,mode:0o700});
writeFileSync('.local/mfa-browser-schema',schema,{mode:0o600});
await app.listen({host:'127.0.0.1',port:3112});
const close=async()=>{await app.close();await scoped.end();await pool.query(`DROP SCHEMA ${schema} CASCADE`);await pool.end();rmSync(directory,{recursive:true,force:true});rmSync('.local/mfa-browser-schema',{force:true});process.exit();};
process.once('SIGTERM',close);process.once('SIGINT',close);
