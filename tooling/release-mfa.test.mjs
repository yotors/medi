import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,copyFileSync,chmodSync,symlinkSync,existsSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
test('packaged operator refuses unknown project, confused source and unsafe private output',()=>{
  mkdirSync(resolve('.local'),{recursive:true,mode:0o700});
  const root=mkdtempSync(resolve('.local/operator-admission-'));
  try {
    mkdirSync(join(root,'tooling'));mkdirSync(join(root,'.local'),{mode:0o700});mkdirSync(join(root,'bin'));
    copyFileSync('tooling/release-mfa.mjs',join(root,'tooling/release-mfa.mjs'));
    writeFileSync(join(root,'.local/release.env'),`MEDI_MIGRATION_PASSWORD=${'1'.repeat(64)}\nMEDI_RUNTIME_PASSWORD=${'2'.repeat(64)}\nMEDI_RELEASE_TAG=local\n`,{mode:0o600});
    const log=join(root,'calls');writeFileSync(join(root,'bin/docker'),`#!/usr/bin/env node\nimport fs from 'node:fs';fs.appendFileSync(${JSON.stringify(log)},process.argv.slice(2).join(' ')+'\\n');if(process.argv[2]==='ps')console.log('a'.repeat(12));else if(process.argv[2]==='inspect')console.log(JSON.stringify([{Image:'sha256:fixture',Config:{Image:process.env.FAKE_VALID?'medi-local-api:local':'unrelated-api:local'},State:{Running:true},NetworkSettings:{Networks:{'medi-release-local_data':{}}},Mounts:[{Name:'medi-release-local_release-mfa-keys',Destination:'/run/secrets',RW:false}]} ]));else if(process.argv[2]==='cp')fs.writeFileSync(process.argv[4],JSON.stringify({hospitalCode:'synthetic',username:'staff',reencrypted:0}),{mode:0o600});else if(process.argv[2]==='rm')process.exit(1);`,{mode:0o700});
    const output=join(root,'.local/result.json');
    const run=(target='medi-release-local',path=output,valid=false)=>spawnSync(process.execPath,[join(root,'tooling/release-mfa.mjs'),target,'grant','synthetic','staff','initial_enrollment','test-operator',path],{env:{...process.env,...(valid?{FAKE_VALID:'1'}:{}),PATH:join(root,'bin')+':'+process.env.PATH},encoding:'utf8',timeout:5000});
    assert.equal(run('production').status,1);assert.equal(existsSync(log),false);
    assert.equal(run().status,1);assert.equal(existsSync(output),false);assert.ok(!readFileSync(log,'utf8').includes('create'));
    const unsafe=join(root,'unsafe');mkdirSync(unsafe,{mode:0o777});chmodSync(unsafe,0o777);assert.equal(run('medi-release-local',join(unsafe,'grant')).status,1);
    const linked=join(root,'linked');symlinkSync(join(root,'.local'),linked);assert.equal(run('medi-release-local',join(linked,'grant')).status,1);
    writeFileSync(output,'preserve',{mode:0o600});assert.equal(run('medi-release-local',output,true).status,1);assert.equal(readFileSync(output,'utf8'),'preserve');assert.ok(!readFileSync(log,'utf8').includes('create'));
    const cleanup=run('medi-release-local',join(root,'.local/cleanup-result.json'),true);assert.equal(cleanup.status,1);assert.match(cleanup.stderr,/container-cleanup/);assert.equal(cleanup.stdout.includes('result written'),false);
    const result=run();assert.equal((result.stdout+result.stderr).includes('1'.repeat(64)),false);
  }finally{rmSync(root,{recursive:true,force:true});}
});
