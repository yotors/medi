import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { installation, prepare, compose, main, validate } from './production-install.mjs';
import { docker } from './release-process.mjs';
import { backup, recoverCheck } from './production-backup.mjs';
import { scheduledBackup } from './production-schedule.mjs';
import { initKey, check } from './release-archive.mjs';
const directory = mkdtempSync('/tmp/medi-production-drill-'),
  target = 'medi-prod-drill-' + randomBytes(6).toString('hex');
let i,
  owned = false;
const started = Date.now();
let stage = 'prepare';
try {
  const images = Object.fromEntries(
    ['api', 'web'].map((s) => [
      s,
      JSON.parse(docker(['image', 'inspect', 'medi-local-' + s + ':local'], process.env))[0].Id,
    ]),
  );
  stage = 'initializer-refusals';
  const refusals = spawnSync(
    process.execPath,
    ['tooling/production-secrets-check.mjs', images.api],
    { stdio: 'inherit', timeout: 120000 },
  );
  check(refusals.status === 0);
  stage = 'prepare';
  mkdirSync(join(directory, 'backups'), { mode: 0o700 });
  const config = {
    project: target,
    apiImage: images.api,
    webImage: images.web,
    domain: 'rehearsal.example.org',
    tlsEmail: 'synthetic@example.org',
    webhook: 'https://synthetic.invalid/alerts',
    backupDirectory: join(directory, 'backups'),
    hospitalCode: 'synthetic-hospital',
    hospitalName: 'Synthetic installation',
    username: 'named.admin',
    operator: 'synthetic-operator',
  };
  const input = join(directory, 'config.json'),
    path = join(directory, 'installation');
  writeFileSync(input, JSON.stringify(config), { mode: 0o600 });
  const occupiedVolume = target + '-occupied';
  docker(
    ['volume', 'create', '--label', 'com.docker.compose.project=' + target, occupiedVolume],
    process.env,
  );
  let occupiedProjectRefused = false;
  try {
    try {
      prepare(input, path);
    } catch {
      occupiedProjectRefused = true;
    }
    check(occupiedProjectRefused);
    docker(['volume', 'inspect', occupiedVolume], process.env);
  } finally {
    docker(['volume', 'rm', occupiedVolume], process.env);
  }
  prepare(input, path);
  let refused = false;
  try {
    prepare(input, path);
  } catch {
    refused = true;
  }
  check(refused);
  i = installation(path);
  validate(i);
  for (const kind of ['ps', 'volume', 'network'])
    check(
      !docker(
        kind === 'ps'
          ? ['ps', '-aq', '--filter', 'label=com.docker.compose.project=' + target]
          : [kind, 'ls', '-q', '--filter', 'label=com.docker.compose.project=' + target],
        i.env,
      ).trim(),
    );
  const override = join(directory, 'override.json');
  writeFileSync(
    override,
    JSON.stringify({
      services: {
        web: { ports: ['127.0.0.1:18080:80', '127.0.0.1:18443:443'] },
        receiver: {
          image: images.api,
          command: ['node', '/receiver.mjs'],
          volumes: [join(path, 'deploy/observability/receiver.mjs') + ':/receiver.mjs:ro'],
          networks: ['data'],
          read_only: true,
          logging: { driver: 'none' },
        },
      },
    }),
    { mode: 0o600 },
  );
  i.compose.push('-f', override);
  let caddy = readFileSync(join(path, 'deploy/Caddyfile.production'), 'utf8').replace(
    '{$MEDI_DOMAIN} {',
    '{$MEDI_DOMAIN} {\n tls internal',
  );
  writeFileSync(join(path, 'deploy/Caddyfile.production'), caddy);
  writeFileSync(
    join(path, 'private/alertmanager.yaml'),
    'route:\n  receiver: synthetic\nreceivers:\n  - name: synthetic\n    webhook_configs:\n      - url: http://receiver:9094/alerts\n        send_resolved: true\n',
    { mode: 0o600 },
  );
  stage = 'start';
  owned = true;
  compose(i, ['up', '-d', '--wait', '--wait-timeout', '120']);
  stage = 'empty';
  const empty = compose(i, [
    'exec',
    '-T',
    'database',
    'psql',
    '-U',
    'medi_migrator',
    '-d',
    'product_studio_release',
    '-Atc',
    'SELECT (SELECT count(*) FROM hospitals)+(SELECT count(*) FROM patients)+(SELECT count(*) FROM staff_users)',
  ]).trim();
  check(empty === '0');
  stage = 'bootstrap';
  const output = join(directory, 'admin.json');
  await main(['bootstrap', path, output]);
  const credentials = JSON.parse(readFileSync(output));
  stage = 'mfa-and-module';
  compose(i, [
    'exec',
    '-T',
    'database',
    'psql',
    '-U',
    'medi_migrator',
    '-d',
    'product_studio_release',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    "INSERT INTO hospitals(id,code,name) VALUES('11111111-1111-4111-8111-111111111111','synthetic-foreign','Synthetic foreign hospital');INSERT INTO department_records(id,hospital_id,kind,data) VALUES('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','supplier','{\"name\":\"Foreign supplier\",\"contact\":\"Synthetic\"}');",
  ]);
  const script = `import {randomUUID} from 'node:crypto';import {totp} from './compiled/server/mfa-config.js';let s='';for await(const b of process.stdin)s+=b;const f=JSON.parse(s);let cookie,csrf;const req=async(path,body)=>{const r=await fetch('http://127.0.0.1:3100'+path,{method:body?'POST':'GET',headers:{origin:'https://rehearsal.example.org',...(cookie?{cookie}:{}),...(csrf?{'x-csrf-token':csrf}:{}),...(body?{'content-type':'application/json','idempotency-key':randomUUID()}: {})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error();if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return r.json();};try{const l=await req('/api/auth/login',{hospitalCode:'synthetic-hospital',username:'named.admin',password:f.password});if(l.authState!=='enrollment')throw Error();csrf=l.csrfToken;const m=await req('/api/auth/mfa/start',{grant:f.grant});const v=await req('/api/auth/mfa/confirm',{code:totp(m.secret).generate()});csrf=v.session.csrfToken;await req('/api/departments/commands',{type:'supplier.create',name:'Synthetic supplier',contact:'Synthetic contact'});const list=await req('/api/departments?kind=supplier');if(list.total!==1||list.entries[0].data.name!=='Synthetic supplier')throw Error();}catch{process.exitCode=1;}`;
  compose(
    i,
    ['exec', '-T', 'api', 'node', '--input-type=module', '-e', script],
    JSON.stringify(credentials),
  );
  stage = 'tls';
  const tls = spawnSync(
    'curl',
    [
      '--silent',
      '--show-error',
      '--insecure',
      '--resolve',
      'rehearsal.example.org:18443:127.0.0.1',
      '--dump-header',
      '-',
      '--output',
      '/dev/null',
      'https://rehearsal.example.org:18443',
    ],
    { encoding: 'utf8', timeout: 15000 },
  );
  check(
    tls.status === 0 &&
      /strict-transport-security: max-age=31536000/i.test(tls.stdout) &&
      /content-security-policy:/i.test(tls.stdout),
  );
  stage = 'restart';
  compose(i, ['restart', 'api', 'database']);
  compose(i, ['up', '-d', '--wait', '--wait-timeout', '120', 'api']);
  check(
    compose(i, [
      'exec',
      '-T',
      'database',
      'psql',
      '-U',
      'medi_migrator',
      '-d',
      'product_studio_release',
      '-Atc',
      "SELECT count(*) FROM department_records WHERE kind='supplier'",
    ]).trim() === '2',
  );
  stage = 'backup';
  const key = join(directory, 'backup.key');
  initKey(key);
  const scheduled = await scheduledBackup(path, key, {
    mounted: () => true,
    notify: async () => {
      throw Error('Unexpected backup failure');
    },
  });
  const { archive, ...b } = scheduled;
  stage = 'restore';
  const recovered = await recoverCheck(key, archive);
  stage = 'negative';
  const wrong = join(directory, 'wrong.key');
  initKey(wrong);
  let wrongRejected = false;
  try {
    await recoverCheck(wrong, archive);
  } catch {
    wrongRejected = true;
  }
  check(wrongRejected);
  const tampered = join(directory, 'backups', 'tampered.medibak');
  const data = readFileSync(archive);
  data[data.length - 1] ^= 1;
  writeFileSync(tampered, data, { mode: 0o600 });
  let tamperRejected = false;
  try {
    await recoverCheck(key, tampered);
  } catch {
    tamperRejected = true;
  }
  check(tamperRejected);
  writeFileSync(
    'docs/production-installation-evidence.json',
    JSON.stringify(
      {
        result: 'PASS',
        at: new Date().toISOString(),
        images,
        backup: b,
        recovered,
        scheduleInvocation:
          'same scheduler function with synthetic mounted destination; systemd host activation remains operator input',
        emptyBootstrap: true,
        mfaEnrollment: true,
        moduleWriteRead: true,
        foreignTenantExcluded: true,
        restartPersistence: true,
        wrongKeyRejected: wrongRejected,
        tamperRejected,
        occupiedDirectoryRejected: refused,
        occupiedProjectRejected: occupiedProjectRefused,
        durationSeconds: Math.round((Date.now() - started) / 1000),
      },
      null,
      2,
    ) + '\n',
  );
  console.log('PASS: isolated production installation and encrypted replacement recovery.');
} catch {
  console.error(
    'Production installation drill failed at ' + stage + '; private diagnostics withheld.',
  );
  process.exitCode = 1;
} finally {
  if (owned)
    try {
      compose(i, ['down', '--volumes', '--remove-orphans', '--timeout', '10']);
    } catch {
      process.exitCode = 1;
      console.error('Owned production drill cleanup failed: ' + target);
    }
  rmSync(directory, { recursive: true, force: true });
}
