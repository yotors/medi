import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
const key=process.argv[2];if(!key)throw Error('Provide the private archive encryption-key path.');
const directory=mkdtempSync(resolve('.local/mfa-backup-admission-'));
try{
  const original=JSON.parse(readFileSync('.local/mfa-keyring.json','utf8'));
  const wrong={current:original.current,keys:Object.fromEntries(Object.keys(original.keys).map(id=>[id,randomBytes(32).toString('hex')]))};
  const missing={current:'unreferenced',keys:{unreferenced:randomBytes(32).toString('hex')}};
  for(const candidate of [wrong,missing,{...original,extra:true},{...original,keys:{...original.keys,...Object.fromEntries(Array.from({length:65},(_,i)=>['extra'+i,randomBytes(32).toString('hex')]))}},{...original,extra:'x'.repeat(16385)}]){
    const file=join(directory,'candidate.json');writeFileSync(file,JSON.stringify(candidate),{mode:0o600});const archive=join(directory,randomUUID()+'.medi');
    const result=spawnSync(process.execPath,['tooling/release-backup.mjs','backup',key,archive],{env:{...process.env,MEDI_BACKUP_MFA_KEYRING_FILE:file},encoding:'utf8',timeout:120000});
    if(result.error||result.status!==1||existsSync(archive)||!result.stderr.includes('Release backup failed'))throw Error('Backup did not safely reject the invalid captured keyring.');
  }
  console.log('PASS: wrong/missing, extra-field and oversized MFA keyrings rejected before archive publication.');
}finally{rmSync(directory,{recursive:true,force:true});}
