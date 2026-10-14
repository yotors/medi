import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createReadStream, rmSync, writeFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { check, loadKey, authenticateArchive, scratch, configValues, validateManifest } from './release-archive.mjs';
import { docker, child, snapshot } from './release-process.mjs';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
export async function withIsolatedTarget(keyPath, archivePath, callback) {
let directory, compose, environment, target, holder, created=false, evidence;
const started = Date.now();
let stage='authenticate';
try {
  check(keyPath && archivePath);
  const key = loadKey(keyPath); directory = scratch(dirname(resolve(archivePath)));
  const { manifest, dump, offset } = await authenticateArchive(archivePath,key,directory);
  stage='manifest';
  validateManifest(manifest);
  stage='images';
  const config = configValues(manifest.config);
  for (const service of ['database','api','web','migrate']) {
    check(/^sha256:[a-f0-9]{64}$/.test(manifest.images[service]));
    check(JSON.parse(docker(['image','inspect',manifest.images[service]],process.env))[0].Id === manifest.images[service]);
  }
  stage='target-start';
  target = `medi-recovery-${randomBytes(12).toString('hex')}`;
  compose = ['compose','--project-name',target,'--env-file','/dev/null','-f','compose.recovery.yaml'];
  if (manifest.format === 2) {
    const keyPath = resolve(directory,'mfa-keyring.json'); writeFileSync(keyPath,JSON.stringify(manifest.mfaKeyring),{mode:0o600,flag:'wx'});
    const override = resolve(directory,'mfa-compose.json');
    writeFileSync(override,JSON.stringify({services:{'mfa-keyring':{image:manifest.images.api,pull_policy:'never',user:'0:0',command:['node','deploy/keyring-init.mjs'],volumes:[keyPath+':/input/keyring.json:ro','recovery-mfa-keys:/output'],network_mode:'none',read_only:true,cap_drop:['ALL'],cap_add:['CHOWN','DAC_OVERRIDE','FOWNER'],security_opt:['no-new-privileges:true']},api:{environment:{STAFF_MFA_POLICY:'required',STAFF_MFA_KEYRING_FILE:'/run/secrets/mfa-keyring.json'},volumes:['recovery-mfa-keys:/run/secrets:ro'],depends_on:{'mfa-keyring':{condition:'service_completed_successfully'}}}},volumes:{'recovery-mfa-keys':{}}}),{mode:0o600,flag:'wx'});
    compose.push('-f',override);
  }
  environment = { ...process.env,...config, RECOVERY_API_IMAGE:manifest.images.api, RECOVERY_DATABASE_IMAGE:manifest.images.database };
  check(!docker(['ps','-aq','--filter',`label=com.docker.compose.project=${target}`],environment).trim());
  check(!docker(['volume','ls','-q','--filter',`label=com.docker.compose.project=${target}`],environment).trim());
  check(!docker(['network','ls','-q','--filter',`label=com.docker.compose.project=${target}`],environment).trim());
  created=true;
  docker([...compose,'up','-d','--wait','--wait-timeout','90','database'],environment);
  stage='roles';
  const bootstrap = `import pg from 'pg'; const c=new pg.Client({connectionString:process.env.DATABASE_URL}); try { await c.connect(); await c.query("CREATE ROLE medi_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '"+process.env.MEDI_RUNTIME_PASSWORD+"'"); await c.query('REVOKE ALL ON DATABASE product_studio_release FROM PUBLIC'); await c.query('GRANT CONNECT ON DATABASE product_studio_release TO medi_runtime'); } catch {process.exitCode=1;} finally {await c.end();}`;
  docker([...compose,'run','--rm','--no-deps','-T','--entrypoint','node','migrate','--input-type=module','-e',bootstrap],environment);
  stage='restore';
  const restore = child([...compose,'exec','-T','database','pg_restore','-U','medi_migrator','-d','product_studio_release','--exit-on-error','--single-transaction'],environment);
  try { await pipeline(createReadStream(dump,{start:offset}),restore.process.stdin); await restore.done; }
  finally { restore.process.kill('SIGKILL'); }
  stage='inventory';
  holder = await snapshot(compose,environment,`${target}-snapshot`);
  for (const field of Object.keys(manifest.inventory)) if (!isDeepStrictEqual(holder.result.inventory[field],manifest.inventory[field])) console.error('Inventory mismatch category: '+field);
  check(holder.result.version === manifest.version && isDeepStrictEqual(holder.result.inventory,manifest.inventory));
  holder.process.stdin.end('commit\n'); await holder.done;
  if(callback) {
    stage='trusted-operation';
    evidence=await callback({manifest,compose,environment,directory,target});
  } else {
  stage='api';
  docker([...compose,'up','-d','--wait','--wait-timeout','90','api'],environment);
  let foreignPatient = null;
  if (manifest.fixture) {
    const seed = `import pg from 'pg'; import {randomUUID} from 'node:crypto'; const c=new pg.Client({connectionString:process.env.DATABASE_URL}); try { await c.connect(); const h=randomUUID(),p=randomUUID(); await c.query('BEGIN'); await c.query('INSERT INTO hospitals(id,code,name) VALUES ($1,$2,$3)',[h,'recovery-'+h,'Recovery synthetic foreign hospital']); await c.query('INSERT INTO patients(id,hospital_id,record_number,name,normalized_name) VALUES ($1,$2,$3,$4,$5)',[p,h,'RECOVERY-FOREIGN','Recovery synthetic foreign patient','recovery synthetic foreign patient']); await c.query('COMMIT'); process.stdout.write(p); } catch {process.exitCode=1;} finally {await c.end();}`;
    foreignPatient=docker([...compose,'run','--rm','--no-deps','-T','--entrypoint','node','migrate','--input-type=module','-e',seed],environment).trim();
    check(/^[a-f0-9-]{36}$/.test(foreignPatient));
  }
  const verify = `let input=''; for await(const chunk of process.stdin) input+=chunk; const {fixture:f,foreignPatient}=JSON.parse(input); const base='http://127.0.0.1:3100'; const origin='https://localhost:8443'; const req=(path,options={})=>fetch(base+path,{...options,headers:{origin,...options.headers},signal:AbortSignal.timeout(15000)}); try { if(!(await req('/api/health')).ok||(await req('/api/patients')).status!==401) throw Error(); if(f){ const login=await req('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({hospitalCode:f.hospitalCode,username:f.username,password:f.password})}); if(!login.ok) throw Error(); let user=await login.json(); let cookie=login.headers.get('set-cookie')?.split(';')[0]; if(user.authState && user.authState!=='complete'){ const {createPool}=await import('./compiled/server/db.js');const {unseal,totp}=await import('./compiled/server/mfa-config.js');const p=createPool();let seed;try{const row=(await p.query('SELECT envelope FROM staff_factors WHERE hospital_id=$1 AND user_id=$2',[user.user.hospital.id,user.user.id])).rows[0];seed=unseal(row.envelope,user.user.hospital.id,user.user.id,'factor');}finally{await p.end();} const verified=await req('/api/auth/mfa/verify',{method:'POST',headers:{cookie,'content-type':'application/json','x-csrf-token':user.csrfToken},body:JSON.stringify({code:totp(seed).generate({timestamp:Date.now()+30000})})});if(!verified.ok)throw Error();user=(await verified.json()).session;cookie=verified.headers.get('set-cookie')?.split(';')[0]; } if(!cookie) throw Error(); const headers={cookie}; if((await req('/api/patients/'+foreignPatient,{headers})).status!==404) throw Error(); if(f.patientId && !(await req('/api/patients/'+encodeURIComponent(f.patientId),{headers})).ok) throw Error(); const session=await req('/api/auth/session',{headers}); if(!session.ok) throw Error(); const body=await session.json(); if(body.user.hospital.code!==f.hospitalCode) throw Error(); await req('/api/auth/logout',{method:'POST',headers:{cookie,'x-csrf-token':user.csrfToken}}); } }catch{process.exitCode=1;}`;
  docker([...compose,'exec','-T','api','node','--input-type=module','-e',verify],environment,JSON.stringify({fixture:manifest.fixture,foreignPatient}));
  evidence = { result:'PASS', tables:manifest.inventory.records.length, records:manifest.inventory.records.reduce((n,r)=>n+r.count,0), schemaVersions:manifest.inventory.versions, images:manifest.images, durationSeconds:Math.round((Date.now()-started)/1000), application:manifest.fixture?'health/auth/tenant/read':'health/anonymous-denial' };
  }
} catch { console.error(`Release recovery failed at ${stage}; sensitive diagnostics withheld.`); process.exitCode=1; }
finally {
  holder?.process.stdin.end('abort\n');
  if(created) { try { docker([...compose,'down','--volumes','--remove-orphans','--timeout','10'],environment); } catch { console.error(`Recovery cleanup failed; inspect isolated project ${target}.`); process.exitCode=1; } }
  if(directory) rmSync(directory,{recursive:true,force:true});
}

if (evidence && !process.exitCode) return evidence;
throw Error('Isolated recovery failed.');
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const [key,archive,...extra]=process.argv.slice(2);
 try {check(!extra.length);console.log(JSON.stringify(await withIsolatedTarget(key,archive)));}
 catch {process.exitCode=1;}
}
