import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { check, readPrivate, configValues } from './release-archive.mjs';
import { docker, child, sourceCompose, cleanupContainer } from './release-process.mjs';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
let active;
let interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    interrupted = true;
    active?.kill('SIGTERM');
  });
async function run(script, args) {
  check(!interrupted);
  await new Promise((resolve, reject) => {
    const process = spawn(globalThis.process.execPath, [script, ...args], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    active = process;
    let killTimer;
    const timer = setTimeout(() => {
      process.kill('SIGTERM');
      killTimer = setTimeout(() => process.kill('SIGKILL'), 5000);
    }, 600000);
    const finish = (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      active = undefined;
      code === 0 && !interrupted ? resolve() : reject(Error());
    };
    process.once('error', () => finish(1));
    process.once('close', finish);
  });
}
let environment,
  writer,
  stopped = false,
  fixture,
  prefix;
const writerName = `medi-backup-write-${randomBytes(12).toString('hex')}`;
// Fixed code, parameterized private fixture input; never prints names or credentials.
const restoreName = `import pg from 'pg';
let input=''; for await (const chunk of process.stdin) input+=chunk;
const f=JSON.parse(input), c=new pg.Client({connectionString:process.env.DATABASE_URL});
try { await c.connect(); const r=await c.query('UPDATE hospitals SET name=$1 WHERE code=$2 AND (name=$1 OR left(name,$3)=$4)',[f.name,f.code,f.prefix.length,f.prefix]); if(r.rowCount!==1)throw Error(); }
catch {process.exitCode=1;} finally {await c.end();}`;
function restoreSourceName() {
  docker(
    [
      ...sourceCompose,
      'run',
      '--rm',
      '--no-deps',
      '-T',
      '--entrypoint',
      'node',
      'migrate',
      '--input-type=module',
      '-e',
      restoreName,
    ],
    environment,
    JSON.stringify({ code: fixture.hospitalCode, name: fixture.hospitalName, prefix }),
    { cleanup: true },
  );
}
try {
  const [key, archive, ...extra] = process.argv.slice(2);
  check(key && archive && !extra.length);
  const config = readPrivate('.local/release.env', 4096);
  environment = { ...process.env, ...configValues(config.toString()) };
  fixture = JSON.parse(readPrivate('.local/release-verification.json', 1024 * 1024));
  check(
    /^release-[a-f0-9-]{8}$/.test(fixture.hospitalCode) &&
      fixture.hospitalName === 'Release Synthetic Medical Center' &&
      fixture.username === 'admin',
  );
  prefix = `Recovery drill ${randomBytes(12).toString('hex')}:`;
  const configDigest = createHash('sha256').update(config).digest('hex');
  const before = docker([...sourceCompose, 'ps', '-q'], environment)
    .trim()
    .split('\n')
    .sort();
  const script = `import pg from 'pg'; import {createInterface} from 'node:readline';
const c=new pg.Client({connectionString:process.env.DATABASE_URL});
const lines=createInterface({input:process.stdin}), iterator=lines[Symbol.asyncIterator]();
let f, stop=false, last, count=0; const timer=setTimeout(()=>stop=true,180000);
try {
  const first=await iterator.next(); if(first.done)throw Error(); f=JSON.parse(first.value);
  void iterator.next().then(()=>{stop=true;});
  await c.connect(); const initial=await c.query('SELECT name FROM hospitals WHERE code=$1',[f.code]);
  if(initial.rows.length!==1 || initial.rows[0].name!==f.name)throw Error(); last=f.name;
  while(!stop) {
    const next=f.prefix+String(++count);
    const r=await c.query('UPDATE hospitals SET name=$1 WHERE code=$2 AND name=$3',[next,f.code,last]);
    if(r.rowCount!==1)throw Error(); last=next;
    process.stdout.write(String(count)+'\\n');
    await c.query('SELECT pg_sleep(0.05)');
  }
} catch {process.exitCode=1;}
finally {
  if(f && last) {try{const r=await c.query('UPDATE hospitals SET name=$1 WHERE code=$2 AND name=$3',[f.name,f.code,last]);if(r.rowCount!==1)process.exitCode=1;}catch{process.exitCode=1;}}
  clearTimeout(timer); lines.close(); await c.end();
}`;
  writer = child(
    [
      ...sourceCompose,
      'run',
      '--rm',
      '--name',
      writerName,
      '--no-deps',
      '-T',
      '--entrypoint',
      'node',
      'migrate',
      '--input-type=module',
      '-e',
      script,
    ],
    environment,
  );
  let committed = 0,
    buffered = '';
  let ready;
  const firstWrite = new Promise((resolve, reject) => {
    ready = resolve;
    writer.done.then(() => reject(Error()), reject);
  });
  writer.process.stdout.on('data', (chunk) => {
    buffered += chunk.toString();
    const lines = buffered.split('\n');
    buffered = lines.pop();
    for (const line of lines) {
      if (/^[1-9][0-9]{0,7}$/.test(line)) {
        committed = Number(line);
        ready();
      }
    }
  });
  writer.process.stdin.write(
    JSON.stringify({ code: fixture.hospitalCode, name: fixture.hospitalName, prefix }) + '\n',
  );
  await firstWrite;
  const initialWrites = committed;
  await run('tooling/release-backup.mjs', ['backup', key, archive]);
  check(committed > initialWrites + 1);
  writer.process.stdin.end('stop\n');
  await writer.done;
  restoreSourceName();
  // Recovery must work with the source unavailable, without consulting its config.
  stopped = true;
  docker([...sourceCompose, 'stop'], environment);
  await run('tooling/release-recovery.mjs', [key, archive]);
  docker(
    [...sourceCompose, 'up', '-d', '--no-build', '--wait', '--wait-timeout', '120'],
    environment,
  );
  stopped = false;
  check(
    createHash('sha256').update(readPrivate('.local/release.env', 4096)).digest('hex') ===
      configDigest,
  );
  check(
    JSON.stringify(
      docker([...sourceCompose, 'ps', '-q'], environment)
        .trim()
        .split('\n')
        .sort(),
    ) === JSON.stringify(before),
  );
  console.log(
    `PASS: ${committed - initialWrites} committed synthetic changes during backup, source-offline recovery, original configuration and source containers retained; source healthy.`,
  );
} catch {
  console.error('Recovery drill failed; sensitive diagnostics withheld.');
  process.exitCode = 1;
} finally {
  writer?.process.stdin.end('stop\n');
  if (writer) {
    try {
      await writer.done;
    } catch {
      console.error('Synthetic writer did not exit cleanly; attempting scoped restoration.');
      process.exitCode = 1;
    }
  }
  if (environment && writer) cleanupContainer(writerName, environment);
  if (stopped) {
    try {
      docker(
        [...sourceCompose, 'up', '-d', '--no-build', '--wait', '--wait-timeout', '120'],
        environment,
      );
      stopped = false;
    } catch {
      console.error('Source restart failed: inspect medi-release-local.');
      process.exitCode = 1;
    }
  }
  if (environment && fixture && prefix && !stopped) {
    try {
      restoreSourceName();
    } catch {
      console.error(
        'Synthetic fixture restoration failed: inspect the private release verification fixture.',
      );
      process.exitCode = 1;
    }
  }
}
