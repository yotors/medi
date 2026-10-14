import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, privatePath, readPrivate, initKey, loadKey, configValues, encryptArchive, validateManifest } from './release-archive.mjs';
import { docker, child, snapshot, sourceCompose, cleanupContainer } from './release-process.mjs';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
let holder, dump, environment, snapshotName;
try {
  const [mode, keyPath, archivePath, ...extra] = process.argv.slice(2);
  check(!extra.length && keyPath);
  if (mode === 'key-init') { check(!archivePath); initKey(keyPath); console.log('Private rehearsal key created. Keep it separate from archives.'); }
  else {
    check(mode === 'backup' && archivePath && resolve(keyPath) !== resolve(archivePath));
    const key = loadKey(keyPath); privatePath(dirname(resolve(archivePath)), false); check(!existsSync(archivePath));
    const config = readPrivate('.local/release.env', 4096).toString(); environment = { ...process.env, ...configValues(config) };
    const images = {};
    for (const service of ['database','api','web','migrate']) {
      const id = docker(['ps','-aq','--filter','label=com.docker.compose.project=medi-release-local','--filter',`label=com.docker.compose.service=${service}`,'--filter','label=com.docker.compose.oneoff=False'], environment).trim(); check(/^[a-f0-9]{12,64}$/.test(id));
      const info = JSON.parse(docker(['inspect', id], environment))[0];
      check(info.Config.Labels['com.docker.compose.project'] === 'medi-release-local' && info.Config.Labels['com.docker.compose.service'] === service);
      check(service === 'migrate' ? info.State.ExitCode === 0 : info.State.Running && info.State.Health?.Status === 'healthy');
      if (service === 'database') {
        check(info.Config.Env.includes('POSTGRES_DB=product_studio_release') && info.Config.Env.includes('POSTGRES_USER=medi_migrator') && info.Config.Env.includes('POSTGRES_PASSWORD='+environment.MEDI_MIGRATION_PASSWORD));
        check(info.Mounts.some(m => m.Type === 'volume' && m.Name === 'medi-release-local_release-database' && m.Destination === '/var/lib/postgresql/data'));
      }
      if (service === 'database' || service === 'api') check(Object.values(info.NetworkSettings.Ports ?? {}).every(value => value === null));
      check(/^sha256:[a-f0-9]{64}$/.test(info.Image));
      const configured = service === 'database' ? 'postgres:16-alpine@sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229' : `medi-local-${service === 'web' ? 'web' : 'api'}:${environment.MEDI_RELEASE_TAG}`;
      check(JSON.parse(docker(['image','inspect',configured],environment))[0].Id === info.Image);
      images[service] = info.Image;
    }
    check(images.api === images.migrate);
    snapshotName = `medi-backup-${randomBytes(12).toString('hex')}`;
    holder = await snapshot(sourceCompose, environment, snapshotName);
    check(/^[0-9A-F]+-[0-9A-F]+-[0-9]+$/.test(holder.result.snapshot));
    const mfaKeyring = JSON.parse(readPrivate(process.env.MEDI_BACKUP_MFA_KEYRING_FILE ?? '.local/mfa-keyring.json',16384));
    if (!mfaKeyring || Object.keys(mfaKeyring).sort().join(',')!=='current,keys' || typeof mfaKeyring.current!=='string' || !/^[A-Za-z0-9_-]{1,64}$/.test(mfaKeyring.current) || !mfaKeyring.keys || typeof mfaKeyring.keys!=='object' || Array.isArray(mfaKeyring.keys) || Object.keys(mfaKeyring.keys).length>64 || !Object.hasOwn(mfaKeyring.keys,mfaKeyring.current) || Object.entries(mfaKeyring.keys).some(([id,key])=>! /^[A-Za-z0-9_-]{1,64}$/.test(id)||typeof key!=='string'||! /^[a-f0-9]{64}$/.test(key))) throw Error();
    const validateKeys = `import {createPool} from './compiled/server/db.js';import {createDecipheriv} from 'node:crypto';let input='';for await(const part of process.stdin)input+=part;const {ring,snapshot}=JSON.parse(input);const p=createPool(),c=await p.connect();try{if(!/^[0-9A-F]+-[0-9A-F]+-[0-9]+$/.test(snapshot))throw Error();await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await c.query("SET TRANSACTION SNAPSHOT '"+snapshot+"'");const rows=(await c.query("SELECT hospital_id,user_id,envelope,'factor' AS purpose FROM staff_factors UNION ALL SELECT hospital_id,user_id,envelope,'pending' AS purpose FROM staff_mfa_pending")).rows;for(const r of rows){const e=r.envelope;if(!e||Object.keys(e).sort().join(',')!=='ciphertext,keyId,nonce,tag')throw Error();for(const [v,n] of [[e.nonce,12],[e.tag,16],[e.ciphertext,32]])if(typeof v!=='string'||v.length>44||Buffer.from(v,'base64').length!==n||Buffer.from(v,'base64').toString('base64')!==v)throw Error();if(!Object.hasOwn(ring.keys,e.keyId))throw Error();const d=createDecipheriv('aes-256-gcm',Buffer.from(ring.keys[e.keyId],'hex'),Buffer.from(e.nonce,'base64'),{authTagLength:16});d.setAAD(Buffer.from(JSON.stringify(['staff-mfa-v1',r.hospital_id,r.user_id,r.purpose])));d.setAuthTag(Buffer.from(e.tag,'base64'));const secret=Buffer.concat([d.update(Buffer.from(e.ciphertext,'base64')),d.final()]).toString();if(!/^[A-Z2-7]{32}$/.test(secret))throw Error();}await c.query('COMMIT');}catch{process.exitCode=1;}finally{c.release();await p.end();}`;
    docker([...sourceCompose,'exec','-T','api','node','--input-type=module','-e',validateKeys],environment,JSON.stringify({ring:mfaKeyring,snapshot:holder.result.snapshot}));
    const manifest = { format: 2, mfaKeyring, createdAt: new Date().toISOString(), images, config, fixture: existsSync('.local/release-verification.json') ? JSON.parse(readPrivate('.local/release-verification.json', 1024 * 1024)) : null, ...holder.result };
    validateManifest(manifest);
    // Pin image identities before publication. These references intentionally survive cleanup.
    const reference = randomBytes(12).toString('hex');
    for (const [service,id] of Object.entries(images)) docker(['image','tag',id,`medi-backup-${service}:${reference}`],environment);
    dump = child([...sourceCompose,'exec','-T','database','pg_dump','-U','medi_migrator','-d','product_studio_release','--format=custom',`--snapshot=${holder.result.snapshot}`],environment); dump.process.stdin.end();
    const completion = dump.done.then(async () => { holder.process.stdin.end('commit\n'); await holder.done; });
    completion.catch(() => {});
    await encryptArchive(archivePath,key,manifest,dump.process.stdout,completion);
    console.log(`PASS: authenticated encrypted release archive; ${manifest.inventory.records.length} tables. Image reference: ${reference}.`);
  }
} catch { console.error('Release backup failed; sensitive diagnostics withheld.'); process.exitCode = 1; }
finally {
  dump?.process.kill('SIGKILL'); holder?.process.stdin.end('abort\n');
  if (snapshotName) cleanupContainer(snapshotName,environment);
}
