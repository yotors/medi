// Trusted code executed only inside a generated isolated upgraded target.
import {randomUUID} from 'node:crypto';
import {createPool} from './compiled/server/db.js';
import {issueGrant} from './compiled/server/mfa.js';
import {totp} from './compiled/server/mfa-config.js';
let input='';for await(const chunk of process.stdin)input+=chunk;const f=JSON.parse(input);
const pool=createPool();let stage='grant';
try{
 if(!f||!/^release-[a-f0-9-]{8}$/.test(f.hospitalCode))throw Error();
 const client=await pool.connect();let grant;
 try{await client.query('BEGIN');const h=(await client.query('SELECT id FROM hospitals WHERE code=$1 FOR UPDATE',[f.hospitalCode])).rows[0];const u=(await client.query('SELECT id FROM staff_users WHERE hospital_id=$1 AND username=$2',[h.id,f.username])).rows[0];grant=(await issueGrant(client,h.id,u.id,null,'upgrade-synthetic-verifier','initial_enrollment')).grant;await client.query('COMMIT');}catch{await client.query('ROLLBACK');throw Error();}finally{client.release();}
 const origin='https://localhost:8443';let cookie,csrf;
 const req=async(path,body,key)=>{const r=await fetch('http://127.0.0.1:3100'+path,{method:body?'POST':'GET',headers:{origin,...(cookie?{cookie,'x-csrf-token':csrf}:{}),...(body?{'content-type':'application/json'}:{}),...(key?{'idempotency-key':key}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error();const c=r.headers.get('set-cookie');if(c)cookie=c.split(';')[0];return r.json();};
 stage='login';const login=await req('/api/auth/login',{hospitalCode:f.hospitalCode,username:f.username,password:f.password});csrf=login.csrfToken;if(login.authState!=='enrollment')throw Error();
 stage='mfa';const setup=await req('/api/auth/mfa/start',{grant});const verified=await req('/api/auth/mfa/confirm',{code:totp(setup.secret).generate()});csrf=verified.session.csrfToken;if(verified.session.authState!=='complete')throw Error();
 stage='write';const key=randomUUID(),body={name:'Upgrade synthetic '+randomUUID(),contact:''};const first=await req('/api/patients',body,key),again=await req('/api/patients',body,key);if(!first.patient?.id||first.patient.id!==again.patient?.id)throw Error();await req('/api/patients/'+first.patient.id);
}catch{process.stderr.write('Upgrade smoke failed at '+stage+'; diagnostics withheld.\n');process.exitCode=1;}finally{await pool.end();}
