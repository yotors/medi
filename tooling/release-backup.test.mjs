import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { authenticateArchive, encryptArchive, initKey, loadKey, privatePath } from './release-archive.mjs';
const fixture = fn => async () => { const d=mkdtempSync(join(tmpdir(),'release-crypto-test-')); try { await fn(d); } finally { rmSync(d,{recursive:true,force:true}); } };
test('authenticated roundtrip and no overwrite',fixture(async d => {
  const key=randomBytes(32), archive=join(d,'backup');
  await encryptArchive(archive,key,{ secret:'hidden' },Readable.from(['custom dump']));
  const out=join(d,'out');mkdirSync(out,{mode:0o700});
  const result=await authenticateArchive(archive,key,out);
  assert.deepEqual(result.manifest,{secret:'hidden'});
  assert.equal(readFileSync(result.dump).subarray(result.offset).toString(),'custom dump');
  const before=readFileSync(archive);
  await assert.rejects(encryptArchive(archive,key,{},Readable.from(['replacement'])));
  assert.deepEqual(readFileSync(archive),before);
  assert.equal(readdirSync(d).some(n=>n.endsWith('.partial')),false);
}));
test('wrong key, every region tamper, and truncation reject before metadata consumption',fixture(async d => {
  const key=randomBytes(32), path=join(d,'backup');
  await encryptArchive(path,key,{secret:'sensitive fixture'},Readable.from(['sensitive clinical dump']));
  const original=readFileSync(path);
  const cases=[{bytes:original,key:randomBytes(32)},...[0,8,20,30,original.length-17,original.length-1].map(i=>{const bytes=Buffer.from(original);bytes[i]^=1;return {bytes,key};}),{bytes:original.subarray(0,original.length-4),key}];
  for(const [i,c] of cases.entries()) { const input=join(d,'bad'+i),out=join(d,'out'+i);writeFileSync(input,c.bytes,{mode:0o600});mkdirSync(out,{mode:0o700});await assert.rejects(authenticateArchive(input,c.key,out),e=>!e.message.includes('sensitive'));assert.deepEqual(readdirSync(out),[]); }
}));
test('private paths and key creation fail closed',fixture(async d=>{
  const key=join(d,'key');initKey(key);assert.equal(loadKey(key).length,32);assert.throws(()=>initKey(key));
  const link=join(d,'link');symlinkSync(key,link);assert.throws(()=>loadKey(link));
  const publicFile=join(d,'public');writeFileSync(publicFile,'secret',{mode:0o644});assert.throws(()=>privatePath(publicFile));
  const publicDir=join(d,'public-dir');mkdirSync(publicDir,{mode:0o755});assert.throws(()=>initKey(join(publicDir,'key')));
}));
test('failed producer and failed completion leave no accepted archive or partial',fixture(async d=>{
  const path=join(d,'backup'),key=randomBytes(32);
  await assert.rejects(encryptArchive(path,key,{},Readable.from((async function*(){yield 'data';throw Error('secret');})())));
  const failure=Promise.reject(Error('subprocess failed'));failure.catch(()=>{});
  await assert.rejects(encryptArchive(path,key,{},Readable.from(['data']),failure));
  assert.deepEqual(readdirSync(d),[]);
}));
test('recovery CLI rejects invalid authentication/manifest before Docker and sanitizes output',fixture(async d=>{
  const {spawnSync}=await import('node:child_process');
  const keyPath=join(d,'key');initKey(keyPath);const key=loadKey(keyPath);
  const bin=join(d,'bin');mkdirSync(bin,{mode:0o700});const marker=join(d,'docker-called');
  writeFileSync(join(bin,'docker'),'#!/bin/sh\ntouch "'+marker+'"\nexit 99\n',{mode:0o700});
  for(const authenticated of [false,true]) {
    const path=join(d,authenticated?'invalid-manifest':'invalid-auth');
    await encryptArchive(path,key,{secret:'SENSITIVE-CREDENTIAL-AND-ROW'},Readable.from(['SENSITIVE-DUMP']));
    if(!authenticated){const bytes=readFileSync(path);bytes[bytes.length-1]^=1;writeFileSync(path,bytes);}
    const result=spawnSync(process.execPath,['tooling/release-recovery.mjs',keyPath,path],{cwd:new URL('../',import.meta.url),env:{...process.env,PATH:bin+':'+process.env.PATH},encoding:'utf8'});
    assert.match(result.stderr, new RegExp('failed at '+(authenticated?'manifest':'authenticate')));
    assert.notEqual(result.status,0);assert.equal(readdirSync(d).includes('docker-called'),false);
    assert.doesNotMatch(result.stdout+result.stderr,/SENSITIVE|password|postgresql:\/\//);
  }
  const valid={format:1,createdAt:new Date().toISOString(),config:'MEDI_MIGRATION_PASSWORD='+ 'a'.repeat(64)+'\nMEDI_RUNTIME_PASSWORD='+ 'b'.repeat(64)+'\nMEDI_RELEASE_TAG=local\n',images:Object.fromEntries(['api','migrate','database','web'].map(s=>[s,'sha256:'+'c'.repeat(64)])),version:'16.1',fixture:null,inventory:Object.fromEntries(['views','tables','columns','constraints','indexes','triggers','functions','schemas','roles','memberships','database','versions','extensions','records'].map(n=>[n,[]]))};
  valid.inventory.database=[{datname:'product_studio_release'}];
  const path=join(d,'valid');await encryptArchive(path,key,valid,Readable.from(['dump']));
  const result=spawnSync(process.execPath,['tooling/release-recovery.mjs',keyPath,path],{cwd:new URL('../',import.meta.url),env:{...process.env,PATH:bin+':'+process.env.PATH},encoding:'utf8'});
  assert.match(result.stderr,/failed at images/);assert.equal(readdirSync(d).includes('docker-called'),true);
}));
test('failed subprocess diagnostics are suppressed',fixture(async d=>{
  const {child}=await import('./release-process.mjs');
  writeFileSync(join(d,'docker'),'#!/bin/sh\necho SENSITIVE-DATABASE-DIAGNOSTIC >&2\nexit 23\n',{mode:0o700});
  const handle=child(['ignored'],{...process.env,PATH:d+':'+process.env.PATH});
  await assert.rejects(handle.done,e=>e.message==='Release subprocess failed.');
}));
test('partial target startup failure cleans only generated project and authenticated scratch',fixture(async d=>{
  const {spawnSync}=await import('node:child_process');
  const keyPath=join(d,'key');initKey(keyPath);const key=loadKey(keyPath);
  const bin=join(d,'bin');mkdirSync(bin,{mode:0o700});const calls=join(d,'calls');
  const id='sha256:'+'c'.repeat(64);
  const valid={format:1,createdAt:new Date().toISOString(),config:'MEDI_MIGRATION_PASSWORD='+ 'a'.repeat(64)+'\nMEDI_RUNTIME_PASSWORD='+ 'b'.repeat(64)+'\nMEDI_RELEASE_TAG=local\n',images:Object.fromEntries(['api','migrate','database','web'].map(s=>[s,id])),version:'16.1',fixture:null,inventory:Object.fromEntries(['views','tables','columns','constraints','indexes','triggers','functions','schemas','roles','memberships','database','versions','extensions','records'].map(n=>[n,[]]))};
  valid.inventory.database=[{datname:'product_studio_release'}];
  const script=`#!/bin/sh\ncase "$1" in\nimage) echo '[{"Id":"${id}"}]';;\ncompose) echo "$*" >> '${calls}'; case " $* " in *' up '*) echo SENSITIVE-DIAGNOSTIC >&2; exit 42;; *' down '*) exit 0;; *) exit 99;; esac;;\n*) exit 0;;\nesac\n`;
  writeFileSync(join(bin,'docker'),script,{mode:0o700});
  const path=join(d,'valid');await encryptArchive(path,key,valid,Readable.from(['dump']));const before=readFileSync(path);
  const result=spawnSync(process.execPath,['tooling/release-recovery.mjs',keyPath,path],{cwd:new URL('../',import.meta.url),env:{...process.env,PATH:bin+':'+process.env.PATH},encoding:'utf8',timeout:10000});
  assert.equal(result.error,undefined);assert.equal(result.status,1);assert.match(result.stderr,/failed at target-start/);assert.doesNotMatch(result.stdout+result.stderr,/SENSITIVE/);
  const commands=readFileSync(calls,'utf8').trim().split('\n');assert.equal(commands.length,2);assert.match(commands[0],/ up /);assert.match(commands[1],/ down --volumes /);
  const names=commands.map(c=>c.match(/--project-name (medi-recovery-[a-f0-9]{24}) /)?.[1]);assert.ok(names[0]);assert.equal(names[0],names[1]);
  assert.equal(readdirSync(d).some(n=>n.startsWith('recovery-')),false);assert.deepEqual(readFileSync(path),before);
}));
test('SIGTERM during restore cleans target and plaintext without changing archive',fixture(async d=>{
  const {spawn}=await import('node:child_process');
  const {once}=await import('node:events');
  const {existsSync}=await import('node:fs');
  const keyPath=join(d,'key');initKey(keyPath);const key=loadKey(keyPath);
  const bin=join(d,'bin');mkdirSync(bin,{mode:0o700});const calls=join(d,'calls'),ready=join(d,'ready');
  const id='sha256:'+'c'.repeat(64);
  const valid={format:1,createdAt:new Date().toISOString(),config:'MEDI_MIGRATION_PASSWORD='+ 'a'.repeat(64)+'\nMEDI_RUNTIME_PASSWORD='+ 'b'.repeat(64)+'\nMEDI_RELEASE_TAG=local\n',images:Object.fromEntries(['api','migrate','database','web'].map(s=>[s,id])),version:'16.1',fixture:null,inventory:Object.fromEntries(['views','tables','columns','constraints','indexes','triggers','functions','schemas','roles','memberships','database','versions','extensions','records'].map(n=>[n,[]]))};
  valid.inventory.database=[{datname:'product_studio_release'}];
  // Node fixture blocks without spawning grandchildren, so SIGKILL cannot leak
  // an unrelated shell sleep process when the CLI interrupts its Docker child.
  const script=`#!${process.execPath}\nconst fs=require('node:fs');const a=process.argv.slice(2);if(a[0]==='image'){console.log(JSON.stringify([{Id:${JSON.stringify(id)}}]));}else if(a[0]==='compose'){fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(a)+'\\n');if(a.includes('pg_restore')){fs.writeFileSync(${JSON.stringify(ready)},'ready');process.stderr.write('SENSITIVE-RESTORE-DIAGNOSTIC\\n');process.stdin.resume();setInterval(()=>{},1000);}}`;
  writeFileSync(join(bin,'docker'),script,{mode:0o700});
  const path=join(d,'valid');await encryptArchive(path,key,valid,Readable.from(['dump']));const before=readFileSync(path);
  const proc=spawn(process.execPath,['tooling/release-recovery.mjs',keyPath,path],{cwd:new URL('../',import.meta.url),env:{...process.env,PATH:bin+':'+process.env.PATH},stdio:['ignore','pipe','pipe']});
  let output='';proc.stdout.on('data',c=>output+=c);proc.stderr.on('data',c=>output+=c);
  const closed=once(proc,'close');
  const deadline=Date.now()+10000;
  try {
    while(!existsSync(ready)&&proc.exitCode===null&&Date.now()<deadline) await new Promise(r=>setTimeout(r,20));
    assert.ok(existsSync(ready),'restore must start before interruption');
    assert.ok(readdirSync(d).some(n=>n.startsWith('recovery-')),'authenticated plaintext exists during restore');
    proc.kill('SIGTERM');
    const timeout=setTimeout(()=>proc.kill('SIGKILL'),5000);
    let result;try{result=await closed;}finally{clearTimeout(timeout);}
    assert.deepEqual(result,[1,null]);assert.match(output,/failed at restore/);assert.doesNotMatch(output,/SENSITIVE/);
    const commands=readFileSync(calls,'utf8').trim().split('\n').map(JSON.parse);
    const down=commands.filter(a=>a.includes('down'));assert.equal(down.length,1);assert.ok(down[0].includes('--volumes'));
    const projects=new Set(commands.map(a=>a[a.indexOf('--project-name')+1]));assert.equal(projects.size,1);assert.match([...projects][0],/^medi-recovery-[a-f0-9]{24}$/);
    assert.equal(readdirSync(d).some(n=>n.startsWith('recovery-')),false);assert.deepEqual(readFileSync(path),before);
  } finally {if(proc.exitCode===null)proc.kill('SIGKILL');}
}));
test('crypto deadlines, cancellation after dump completion, and directory fsync failure leave no publication',fixture(async d=>{
  const key=randomBytes(32),path=join(d,'archive');
  const keepAlive=setInterval(()=>{},1000);
  try { await assert.rejects(encryptArchive(path,key,{},new Readable({read(){}}),Promise.resolve(),{timeoutMs:20})); }
  finally {clearInterval(keepAlive);}
  assert.deepEqual(readdirSync(d),[]);
  const controller=new AbortController();
  const completion=new Promise(resolve=>setTimeout(()=>{controller.abort();resolve();},20));
  await assert.rejects(encryptArchive(path,key,{},Readable.from(['dump']),completion,{signal:controller.signal}));
  assert.deepEqual(readdirSync(d),[]);
  await assert.rejects(encryptArchive(path,key,{},Readable.from(['dump']),Promise.resolve(),{syncDirectory(){throw Error('fsync failure');}}));
  assert.deepEqual(readdirSync(d),[]);
  await encryptArchive(path,key,{},Readable.from([randomBytes(8*1024*1024)]));
  const out=join(d,'out');mkdirSync(out,{mode:0o700});
  await assert.rejects(authenticateArchive(path,key,out,{timeoutMs:1}));assert.deepEqual(readdirSync(out),[]);
}));
test('nonsticky writable ancestor rejected without changing its permissions',fixture(async d=>{
  const {chmodSync,lstatSync}=await import('node:fs');
  const ancestor=join(d,'untrusted');mkdirSync(ancestor,{mode:0o700});chmodSync(ancestor,0o777);
  const leaf=join(ancestor,'private');mkdirSync(leaf,{mode:0o700});
  assert.throws(()=>initKey(join(leaf,'key')));assert.equal(lstatSync(ancestor).mode&0o777,0o777);
}));
test('snapshot protocol decodes split UTF-8 without corruption',fixture(async d=>{
  const {snapshot}=await import('./release-process.mjs');
  const script=`#!${process.execPath}\nconst b=Buffer.from(JSON.stringify({definition:'ሆስፒታል'})+'\\n');const i=b.indexOf(0xe1)+1;process.stdout.write(b.subarray(0,i));setTimeout(()=>process.stdout.write(b.subarray(i)),20);process.stdin.resume();process.stdin.on('end',()=>process.exit(0));`;
  writeFileSync(join(d,'docker'),script,{mode:0o700});
  const result=await snapshot([],{...process.env,PATH:d+':'+process.env.PATH},'medi-backup-test');
  assert.equal(result.result.definition,'ሆስፒታል');result.process.stdin.end('commit\n');await result.done;
}));
function validManifest() {
  const id='sha256:'+'c'.repeat(64);
  return {format:1,createdAt:new Date().toISOString(),config:'MEDI_MIGRATION_PASSWORD='+ 'a'.repeat(64)+'\nMEDI_RUNTIME_PASSWORD='+ 'b'.repeat(64)+'\nMEDI_RELEASE_TAG=local\n',images:Object.fromEntries(['api','migrate','database','web'].map(s=>[s,id])),version:'16.1',fixture:null,inventory:{...Object.fromEntries(['views','tables','columns','constraints','indexes','triggers','functions','schemas','roles','memberships','versions','extensions','records'].map(n=>[n,[]])),database:[{datname:'product_studio_release'}]}};
}
for(const failure of ['roles','restore','inventory','api','cleanup']) test('target '+failure+' failure preserves archive and cleans private scratch',fixture(async d=>{
  const {spawnSync}=await import('node:child_process');
  const keyPath=join(d,'key');initKey(keyPath);const key=loadKey(keyPath),manifest=validManifest();
  const bin=join(d,'bin');mkdirSync(bin,{mode:0o700});const calls=join(d,'calls');
  const script=`#!${process.execPath}\nconst fs=require('node:fs');const a=process.argv.slice(2),failure=${JSON.stringify(failure)};const fail=()=>{console.error('SENSITIVE-INTERNAL-DIAGNOSTIC');process.exit(33);};if(a[0]==='image')console.log(JSON.stringify([{Id:${JSON.stringify(manifest.images.api)}}]));else if(a[0]==='compose'){fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(a)+'\\n');if(a.includes('down')){if(failure==='cleanup')fail();}else if(a.includes('pg_restore')){process.stdin.resume();process.stdin.on('end',()=>{if(failure==='restore')fail();});}else if(a.includes('--name')){const inventory=${JSON.stringify(manifest.inventory)};if(failure==='inventory')inventory.records=[{table:'altered',count:1,sha256:'0'.repeat(64)}];console.log(JSON.stringify({version:'16.1',inventory}));process.stdin.resume();process.stdin.on('end',()=>process.exit(0));}else if(a.includes('run')){if(failure==='roles')fail();}else if(a.includes('up')&&a.at(-1)==='api'){if(failure==='api')fail();}else if(a.includes('exec')){process.stdin.resume();}}`;
  writeFileSync(join(bin,'docker'),script,{mode:0o700});
  const path=join(d,'valid');await encryptArchive(path,key,manifest,Readable.from(['dump']));const before=readFileSync(path);
  const result=spawnSync(process.execPath,['tooling/release-recovery.mjs',keyPath,path],{cwd:new URL('../',import.meta.url),env:{...process.env,PATH:bin+':'+process.env.PATH},encoding:'utf8',timeout:10000});
  assert.equal(result.error,undefined);assert.equal(result.status,1);assert.doesNotMatch(result.stdout+result.stderr,/SENSITIVE/);
  if(failure==='cleanup')assert.doesNotMatch(result.stdout,/PASS/);
  if(failure==='cleanup')assert.match(result.stderr,/cleanup failed; inspect isolated project medi-recovery-[a-f0-9]{24}/);
  else assert.match(result.stderr,new RegExp('failed at '+failure));
  const commands=readFileSync(calls,'utf8').trim().split('\n').map(JSON.parse);assert.equal(commands.filter(a=>a.includes('down')).length,1);
  assert.equal(readdirSync(d).some(n=>n.startsWith('recovery-')),false);assert.deepEqual(readFileSync(path),before);
}));
test('backup manifest admission rejects malformed fixtures and inventory',()=>{
  // Backup and recovery share this validator; backup invokes it before pg_dump.
  for(const mutate of [m=>m.fixture={password:'secret'},m=>m.inventory.records=[{table:'unsafe-table',count:1,sha256:'0'.repeat(64)}]]) {
    const m=validManifest();mutate(m);assert.throws(()=>validateManifestForTest(m));
  }
});
import {validateManifest as validateManifestForTest} from './release-archive.mjs';
for (const malformed of ['inventory','fixture']) test('backup CLI rejects malformed '+malformed+' before dump or publication',fixture(async d=>{
  const {copyFileSync,existsSync}=await import('node:fs');
  const {spawnSync}=await import('node:child_process');
  const project=join(d,'project'),tooling=join(project,'tooling'),local=join(project,'.local'),bin=join(d,'bin');
  mkdirSync(project,{mode:0o700});mkdirSync(tooling,{mode:0o700});mkdirSync(local,{mode:0o700});mkdirSync(bin,{mode:0o700});
  for(const name of ['release-backup.mjs','release-archive.mjs','release-cancellation.mjs','release-process.mjs','release-snapshot.mjs'])copyFileSync(new URL(name,import.meta.url),join(tooling,name));
  const manifest=validManifest();writeFileSync(join(local,'release.env'),manifest.config,{mode:0o600});
  if(malformed==='fixture')writeFileSync(join(local,'release-verification.json'),JSON.stringify({password:'SENSITIVE-INVALID-FIXTURE'}),{mode:0o600});
  else manifest.inventory.records=[{table:'invalid-table',count:1,sha256:'0'.repeat(64)}];
  const dumpMarker=join(d,'dump-called'),snapshotMarker=join(d,'snapshot-called');
  const script=`#!${process.execPath}\nconst fs=require('node:fs');const a=process.argv.slice(2),services=['database','api','web','migrate'],image=${JSON.stringify(manifest.images.api)};if(a[0]==='ps'){const label=a.find(x=>x.startsWith('label=com.docker.compose.service='));if(label)console.log(String(services.indexOf(label.split('=').at(-1))+1).repeat(64));}else if(a[0]==='inspect'){const service=services[Number(a[1][0])-1];console.log(JSON.stringify([{Image:image,Config:{Labels:{'com.docker.compose.project':'medi-release-local','com.docker.compose.service':service},Env:['POSTGRES_DB=product_studio_release','POSTGRES_USER=medi_migrator','POSTGRES_PASSWORD='+process.env.MEDI_MIGRATION_PASSWORD]},State:{Running:true,ExitCode:0,Health:{Status:'healthy'}},Mounts:[{Type:'volume',Name:'medi-release-local_release-database',Destination:'/var/lib/postgresql/data'}],NetworkSettings:{Ports:{}}}]));}else if(a[0]==='image'&&a[1]==='inspect')console.log(JSON.stringify([{Id:image}]));else if(a.includes('pg_dump')){fs.writeFileSync(${JSON.stringify(dumpMarker)},'called');process.exit(91);}else if(a.includes('--name')){fs.writeFileSync(${JSON.stringify(snapshotMarker)},'called');console.log(JSON.stringify({snapshot:'00000001-00000001-1',version:'16.1',inventory:${JSON.stringify(manifest.inventory)}}));process.stdin.resume();process.stdin.on('end',()=>process.exit(0));}`;
  writeFileSync(join(bin,'docker'),script,{mode:0o700});const key=join(d,'key');initKey(key);const archive=join(d,'archive');
  const result=spawnSync(process.execPath,[join(tooling,'release-backup.mjs'),'backup',key,archive],{env:{...process.env,PATH:bin+':'+process.env.PATH},encoding:'utf8',timeout:10000});
  assert.equal(result.error,undefined);assert.equal(result.status,1);assert.ok(existsSync(snapshotMarker),'must reach snapshot admission');
  assert.equal(existsSync(dumpMarker),false);assert.equal(existsSync(archive),false);assert.equal(readdirSync(d).some(n=>n.endsWith('.partial')),false);
  assert.doesNotMatch(result.stdout+result.stderr,/PASS|SENSITIVE/);
}));
