import { randomBytes } from 'node:crypto';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  cpSync,
  existsSync,
  rmSync,
  openSync,
  closeSync,
  fsyncSync,
} from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, privatePath, readPrivate } from './release-archive.mjs';
import { docker, child } from './release-process.mjs';
export const root = fileURLToPath(new URL('../', import.meta.url));
export const immutable = (x) =>
  typeof x === 'string' &&
  /^(?:sha256:[a-f0-9]{64}|[a-zA-Z0-9][a-zA-Z0-9./:_-]*@sha256:[a-f0-9]{64})$/.test(x);
export function configuration(c) {
  check(
    c &&
      Object.keys(c).sort().join(',') ===
        'apiImage,backupDirectory,domain,hospitalCode,hospitalName,operator,project,tlsEmail,username,webImage,webhook',
  );
  check(
    immutable(c.apiImage) && immutable(c.webImage) && /^medi-prod-[a-z0-9-]{1,40}$/.test(c.project),
  );
  check(
    typeof c.domain === 'string' &&
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(c.domain) &&
      c.domain.length <= 253,
  );
  check(/^[A-Za-z0-9_.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(c.tlsEmail));
  check(
    /^[a-z0-9-]{1,60}$/.test(c.hospitalCode) &&
      /^[a-z0-9_.-]{1,100}$/.test(c.username) &&
      /^[A-Za-z0-9_.-]{1,80}$/.test(c.operator),
  );
  check(
    typeof c.hospitalName === 'string' &&
      c.hospitalName.trim().length > 0 &&
      c.hospitalName.length <= 100 &&
      !/[\x00-\x1f]/.test(c.hospitalName),
  );
  const u = new URL(c.webhook);
  check(u.protocol === 'https:' && !u.username && !u.password && !u.hash);
  privatePath(c.backupDirectory, false);
  return c;
}
export function installation(path) {
  path = privatePath(path, false);
  const c = configuration(JSON.parse(readPrivate(join(path, 'installation.json'), 16384)));
  readPrivate(join(path, 'private/secrets.json'), 16384);
  return {
    path,
    c,
    env: {
      ...process.env,
      MEDI_API_IMAGE: c.apiImage,
      MEDI_WEB_IMAGE: c.webImage,
      MEDI_DOMAIN: c.domain,
      MEDI_TLS_EMAIL: c.tlsEmail,
      MEDI_SECRETS_FILE: join(path, 'private/secrets.json'),
    },
    compose: [
      'compose',
      '--project-name',
      c.project,
      '--env-file',
      '/dev/null',
      '-f',
      join(path, 'compose.production.yaml'),
    ],
  };
}
export function compose(i, args, input) {
  return docker([...i.compose, ...args], i.env, input);
}
export function validate(i) {
  const effective = JSON.parse(compose(i, ['config', '--format', 'json']));
  for (const [name, s] of Object.entries(effective.services)) {
    check(immutable(s.image));
    if (name !== 'web') check(!s.ports?.length);
    check(!s.privileged);
  }
  check(
    effective.services.api.user === '1000:1000' &&
      effective.services.api.volumes.length === 1 &&
      effective.services.api.volumes[0].source === 'api-secrets' &&
      effective.services.api.volumes[0].read_only &&
      effective.services.migrate.volumes.length === 1 &&
      effective.services.migrate.volumes[0].source === 'owner-secrets' &&
      effective.networks.data.internal,
  );
  check(
    effective.services.api.read_only &&
      effective.services.api.environment.STAFF_MFA_POLICY === 'required' &&
      effective.services.api.environment.APP_ORIGIN === 'https://' + i.c.domain,
  );
  return effective;
}
export function prepare(configFile, path) {
  const c = configuration(JSON.parse(readPrivate(configFile, 16384)));
  path = resolve(path);
  privatePath(dirname(path), false);
  check(!existsSync(path));
  for (const kind of ['ps', 'volume', 'network'])
    check(
      !docker(
        kind === 'ps'
          ? ['ps', '-aq', '--filter', 'label=com.docker.compose.project=' + c.project]
          : [kind, 'ls', '-q', '--filter', 'label=com.docker.compose.project=' + c.project],
        process.env,
      ).trim(),
    );
  let owned = false;
  try {
    mkdirSync(path, { mode: 0o700 });
    owned = true;
    mkdirSync(join(path, 'private'), { mode: 0o700 });
    writeFileSync(join(path, 'installation.json'), JSON.stringify(c), { mode: 0o600, flag: 'wx' });
    const hex = () => randomBytes(32).toString('hex');
    writeFileSync(
      join(path, 'private/secrets.json'),
      JSON.stringify({
        migrationPassword: hex(),
        runtimePassword: hex(),
        mfaKeyring: { current: 'initial', keys: { initial: hex() } },
      }),
      { mode: 0o600, flag: 'wx' },
    );
    cpSync(join(root, 'compose.production.yaml'), join(path, 'compose.production.yaml'));
    cpSync(join(root, 'deploy'), join(path, 'deploy'), { recursive: true });
    writeFileSync(
      join(path, 'private/alertmanager.yaml'),
      `route:\n  receiver: operator\nreceivers:\n  - name: operator\n    webhook_configs:\n      - url: ${JSON.stringify(c.webhook)}\n        send_resolved: true\n`,
      { mode: 0o600, flag: 'wx' },
    );
    validate(installation(path));
    return path;
  } catch (e) {
    if (owned) rmSync(path, { recursive: true, force: true });
    throw e;
  }
}
export async function main(args) {
  const [mode, path, third, ...extra] = args;
  check(!extra.length);
  if (mode === 'prepare') {
    check(third);
    prepare(path, third);
  } else {
    const i = installation(path);
    validate(i);
    if (mode === 'validate') check(!third);
    else if (mode === 'start') {
      check(!third);
      compose(i, ['up', '-d', '--wait', '--wait-timeout', '120']);
    } else if (mode === 'status') {
      check(!third);
      process.stdout.write(compose(i, ['ps']));
    } else if (mode === 'restart') {
      check(!third);
      compose(i, [
        'restart',
        'database',
        'api',
        'web',
        'collector',
        'prometheus',
        'alertmanager',
        'probe',
      ]);
    } else if (mode === 'maintenance-migrate') {
      check(!third);
      compose(i, ['stop', 'api']);
      compose(i, ['run', '--rm', '--no-deps', '-T', 'migrate']);
      compose(i, ['up', '-d', '--wait', '--wait-timeout', '120', 'api']);
    } else if (mode === 'bootstrap') {
      check(third);
      privatePath(dirname(resolve(third)), false);
      check(!existsSync(third));
      const fd = openSync(third, 'wx', 0o600);
      let h,
        published = false;
      try {
        const script = readFileSync(join(root, 'tooling/production-bootstrap-owner.mjs'), 'utf8');
        h = child(
          [
            ...i.compose,
            'run',
            '--rm',
            '--no-deps',
            '-T',
            '--entrypoint',
            'node',
            'migrate',
            '--input-type=module',
            '-e',
            script,
          ],
          i.env,
        );
        h.process.stdin.write(JSON.stringify(i.c) + '\n');
        const out = await new Promise((res, rej) => {
          let data = '';
          h.process.stdout.on('data', (b) => {
            data += b;
            if (data.length > 16384) {
              h.process.kill('SIGKILL');
              rej(Error());
            }
            if (data.includes('\n')) res(data);
          });
          h.done.then(() => rej(Error()), rej);
        });
        JSON.parse(out);
        writeFileSync(fd, out);
        fsyncSync(fd);
        const parent = openSync(dirname(resolve(third)), 'r');
        try {
          fsyncSync(parent);
        } finally {
          closeSync(parent);
        }
        h.process.stdin.end('commit\n');
        await h.done;
        published = true;
      } finally {
        h?.process.stdin.end('abort\n');
        closeSync(fd);
        if (!published) rmSync(third, { force: true });
      }
    } else throw Error();
  }
  console.log('Production operator operation completed.');
}
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch(() => {
    console.error('Production operation refused or failed; private diagnostics withheld.');
    process.exitCode = 1;
  });
