// Runs against the built image, including its pinned Node24 crypto runtime.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const directory=mkdtempSync(join(tmpdir(),'mfa-runtime-'));const source=join(directory,'keyring.json'),output=join(directory,'keys');mkdirSync(output,{mode:0o700});
const image=process.argv[2]??'medi-local-api:local';if(!/^(medi-local-api:[a-z0-9_.-]+|sha256:[a-f0-9]{64})$/.test(image))throw Error('Invalid local image.');
function docker(args){const r=spawnSync('docker',args,{encoding:'utf8',timeout:30000});if(r.status!==0)throw Error('MFA runtime check failed; diagnostics withheld.');return r.stdout;}
try{
  writeFileSync(source,JSON.stringify({current:'runtime-check',keys:{'runtime-check':randomBytes(32).toString('hex')}}),{mode:0o600});
  for(const candidate of [{current:'test',keys:{test:'1'.repeat(64)},extra:true},{current:'test',keys:{test:'1'.repeat(64)},extra:'x'.repeat(16385)}]){
    const invalid=join(directory,'invalid.json');writeFileSync(invalid,JSON.stringify(candidate),{mode:0o600});
    const rejected=spawnSync('docker',['run','--rm','--network','none','--read-only','--user','0:0','--cap-drop','ALL','--cap-add','DAC_OVERRIDE','--mount',`type=bind,src=${invalid},dst=/input/keyring.json,readonly`,'--mount',`type=bind,src=${output},dst=/output`,image,'node','deploy/keyring-init.mjs'],{encoding:'utf8',timeout:30000});
    if(rejected.status!==1)throw Error('Unsafe provisioning keyring was not rejected.');
  }
  docker(['run','--rm','--network','none','--user','0:0','--cap-drop','ALL','--cap-add','CHOWN','--cap-add','DAC_OVERRIDE','--mount',`type=bind,src=${directory},dst=/check`,image,'node','-e',"require('node:fs').chownSync('/check/keyring.json',65532,65532)"]);
  docker(['run','--rm','--network','none','--read-only','--user','0:0','--cap-drop','ALL','--cap-add','CHOWN','--cap-add','DAC_OVERRIDE','--cap-add','FOWNER','--mount',`type=bind,src=${source},dst=/input/keyring.json,readonly`,'--mount',`type=bind,src=${output},dst=/output`,image,'node','deploy/keyring-init.mjs']);
  // Source remains private and owned by a UID different from the API's UID1000.
  docker(['run','--rm','--network','none','--user','0:0','--cap-drop','ALL','--cap-add','DAC_OVERRIDE','--cap-add','FOWNER','--mount',`type=bind,src=${directory},dst=/check`,image,'node','-e',"const f=require('node:fs');const s=f.statSync('/check/keyring.json');if(s.uid!==65532||(s.mode&511)!==384)process.exit(1);f.chmodSync('/check/keys',493)"]);
  writeFileSync(join(output,'wrong.json'),JSON.stringify({current:'runtime-check',keys:{'runtime-check':randomBytes(32).toString('hex')}}),{mode:0o400});
  const script=`import assert from 'node:assert/strict';import {statSync} from 'node:fs';import {seal,unseal,newSecret,validateEnvelopes} from './compiled/server/mfa-config.js';assert.equal(process.getuid(),1000);assert.ok(process.version.startsWith('v24.'));const s=statSync('/run/secrets/mfa-keyring.json');assert.equal(s.uid,1000);assert.equal(s.mode&511,256);const e=seal(newSecret(),'hospital','user','factor');assert.ok(unseal(e,'hospital','user','factor'));for(const n of [0,1,4,8,12,15])assert.throws(()=>unseal({...e,tag:Buffer.from(e.tag,'base64').subarray(0,n).toString('base64')},'hospital','user','factor'));assert.throws(()=>unseal({...e,nonce:Buffer.alloc(8).toString('base64')},'hospital','user','factor'));assert.throws(()=>unseal(e,'other','user','factor'));process.env.NODE_ENV='production';let fetched=false;const pool={connect:async()=>({query:async({text})=>({rows:text.startsWith('FETCH')&&!fetched?(fetched=true,[{hospital_id:'hospital',user_id:'user',purpose:'factor',envelope:e}]):[]}),release:()=>{}})};process.env.STAFF_MFA_KEYRING_FILE='/run/secrets/wrong.json';await assert.rejects(validateEnvelopes(pool));process.env.STAFF_MFA_KEYRING_FILE='/run/secrets/missing.json';await assert.rejects(validateEnvelopes(pool));`;
  docker(['run','--rm','--network','none','--read-only','--cap-drop','ALL','--env','STAFF_MFA_KEYRING_FILE=/run/secrets/mfa-keyring.json','--mount',`type=bind,src=${output},dst=/run/secrets,readonly`,image,'node','--input-type=module','-e',script]);
  console.log('PASS: Node24 strict GCM envelopes; UID65532 private source provisioned for UID1000 read-only runtime; packaged readiness rejects wrong/missing keys.');
}finally{rmSync(directory,{recursive:true,force:true});}
