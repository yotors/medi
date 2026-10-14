import { randomBytes } from 'node:crypto';
import {
  readFileSync,
  writeFileSync,
  rmSync,
  mkdtempSync,
  createReadStream,
  existsSync,
} from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { pipeline } from 'node:stream/promises';
import {
  check,
  privatePath,
  readPrivate,
  initKey,
  loadKey,
  encryptArchive,
  authenticateArchive,
} from './release-archive.mjs';
import { docker, child, cleanupContainer } from './release-process.mjs';
import { validateSecurityInventory, compareProductionSecurity } from './release-inventory.mjs';
import { installation, validate, compose, immutable } from './production-install.mjs';
const script = readFileSync(new URL('./production-snapshot.mjs', import.meta.url), 'utf8');
async function inventory(i, name) {
  const h = child(
    [
      ...i.compose,
      'run',
      '--rm',
      '--no-deps',
      '-T',
      '--name',
      name,
      '--entrypoint',
      'node',
      'migrate',
      '--input-type=module',
      '-e',
      script,
    ],
    i.env,
  );
  let data = '';
  const result = await new Promise((res, rej) => {
    h.process.stdout.on('data', (b) => {
      data += b;
      if (data.length > 4194304) {
        h.process.kill('SIGKILL');
        rej(Error());
      }
      if (data.includes('\n')) {
        try {
          res(JSON.parse(data.trim()));
        } catch {
          rej(Error());
        }
      }
    });
    h.done.then(() => rej(Error()), rej);
  });
  return { ...h, result };
}
function manifest(m) {
  check(
    m &&
      Object.keys(m).sort().join(',') ===
        'createdAt,format,images,inventory,schema,secrets,version' &&
      m.format === 3 &&
      Number.isFinite(Date.parse(m.createdAt)),
  );
  check(m.images && Object.keys(m.images).sort().join(',') === 'api,database,web');
  for (const image of Object.values(m.images)) check(/^sha256:[a-f0-9]{64}$/.test(image));
  check(
    /^16\./.test(m.version) &&
      Array.isArray(m.schema) &&
      m.schema.length > 0 &&
      m.schema.length <= 1000 &&
      m.schema.every((x) => Number.isSafeInteger(x.version)),
  );
  check(
    m.inventory &&
      Object.values(m.inventory).every((v) => Array.isArray(v) && v.length <= 10000) &&
      isDeepStrictEqual(m.schema, m.inventory.versions),
  );
  const s = m.secrets;
  check(
    s &&
      Object.keys(s).sort().join(',') === 'mfaKeyring,migrationPassword,runtimePassword' &&
      /^[a-f0-9]{64}$/.test(s.migrationPassword) &&
      /^[a-f0-9]{64}$/.test(s.runtimePassword) &&
      s.runtimePassword !== s.migrationPassword,
  );
  check(
    s.mfaKeyring &&
      Object.keys(s.mfaKeyring).sort().join(',') === 'current,keys' &&
      /^[A-Za-z0-9_-]{1,64}$/.test(s.mfaKeyring.current) &&
      s.mfaKeyring.keys &&
      typeof s.mfaKeyring.keys === 'object' &&
      !Array.isArray(s.mfaKeyring.keys) &&
      Object.keys(s.mfaKeyring.keys).length <= 64 &&
      Object.hasOwn(s.mfaKeyring.keys, s.mfaKeyring.current),
  );
  for (const [k, v] of Object.entries(s.mfaKeyring.keys))
    check(/^[A-Za-z0-9_-]{1,64}$/.test(k) && /^[a-f0-9]{64}$/.test(v));
}
export async function backup(path, keyPath, archive) {
  const i = installation(path);
  validate(i);
  const key = loadKey(keyPath);
  check(
    resolve(keyPath) !== resolve(archive) &&
      dirname(resolve(archive)) === resolve(i.c.backupDirectory),
  );
  privatePath(dirname(resolve(archive)), false);
  check(!existsSync(archive));
  let holder, dump;
  const name = 'medi-backup-' + randomBytes(12).toString('hex');
  try {
    const images = {};
    for (const s of ['api', 'database', 'web']) {
      const id = compose(i, ['ps', '-q', s]).trim();
      check(/^[a-f0-9]{12,64}$/.test(id));
      const info = JSON.parse(docker(['inspect', id], i.env))[0];
      check(
        info.State.Running &&
          info.Config.Labels['com.docker.compose.project'] === i.c.project &&
          info.Config.Labels['com.docker.compose.service'] === s,
      );
      check(
        info.Image ===
          JSON.parse(
            docker(
              [
                'image',
                'inspect',
                s === 'api'
                  ? i.c.apiImage
                  : s === 'web'
                    ? i.c.webImage
                    : 'postgres:16-alpine@sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229',
              ],
              i.env,
            ),
          )[0].Id,
      );
      images[s] = info.Image;
      check(/^sha256:[a-f0-9]{64}$/.test(info.Image));
    }
    holder = await inventory(i, name);
    check(/^[0-9A-F]+-[0-9A-F]+-[0-9]+$/.test(holder.result.snapshot));
    const m = {
      format: 3,
      createdAt: new Date().toISOString(),
      images,
      secrets: JSON.parse(readPrivate(join(i.path, 'private/secrets.json'), 16384)),
      schema: holder.result.inventory.versions,
      version: holder.result.version,
      inventory: holder.result.inventory,
    };
    manifest(m);
    validateSecurityInventory(m.inventory, { legacyViewOptions: true });
    compose(i, [
      'exec',
      '-T',
      'api',
      'node',
      '--input-type=module',
      '-e',
      `import {createPool} from './compiled/server/db.js';import {validateEnvelopes} from './compiled/server/mfa-config.js';const p=createPool();try{await validateEnvelopes(p);}catch{process.exitCode=1;}finally{await p.end();}`,
    ]);
    for (const [s, id] of Object.entries(images))
      docker(['image', 'tag', id, 'medi-production-backup-' + s + ':' + name.slice(12)], i.env);
    dump = child(
      [
        ...i.compose,
        'exec',
        '-T',
        'database',
        'pg_dump',
        '-U',
        'medi_migrator',
        '-d',
        'product_studio_release',
        '--format=custom',
        '--snapshot=' + holder.result.snapshot,
      ],
      i.env,
    );
    dump.process.stdin.end();
    const completion = dump.done.then(async () => {
      holder.process.stdin.end('commit\n');
      await holder.done;
    });
    completion.catch(() => {});
    await encryptArchive(archive, key, m, dump.process.stdout, completion);
    return { format: 3, images, schema: m.schema, tables: m.inventory.records.length };
  } finally {
    dump?.process.kill('SIGKILL');
    holder?.process.stdin.end('abort\n');
    cleanupContainer(name, i.env);
  }
}
export async function recoverCheck(keyPath, archive) {
  const directory = mkdtempSync(
    join(privatePath(dirname(resolve(archive)), false), 'recover-check-'),
  );
  let target,
    i,
    holder,
    owned = false;
  try {
    const a = await authenticateArchive(archive, loadKey(keyPath), directory);
    manifest(a.manifest);
    validateSecurityInventory(a.manifest.inventory, { legacyViewOptions: true });
    const m = a.manifest;
    for (const image of Object.values(m.images))
      check(
        immutable(image) &&
          JSON.parse(docker(['image', 'inspect', image], process.env))[0].Id === image,
      );
    target = 'medi-recovery-' + randomBytes(12).toString('hex');
    for (const kind of ['ps', 'volume', 'network'])
      check(
        !docker(
          kind === 'ps'
            ? ['ps', '-aq', '--filter', 'label=com.docker.compose.project=' + target]
            : [kind, 'ls', '-q', '--filter', 'label=com.docker.compose.project=' + target],
          process.env,
        ).trim(),
      );
    writeFileSync(join(directory, 'secrets.json'), JSON.stringify(m.secrets), {
      mode: 0o600,
      flag: 'wx',
    });
    const logs = { driver: 'none' },
      restricted = {
        read_only: true,
        cap_drop: ['ALL'],
        security_opt: ['no-new-privileges:true'],
        logging: logs,
        pull_policy: 'never',
      };
    const cfg = {
      services: {
        secrets: {
          ...restricted,
          image: m.images.api,
          user: '0:0',
          cap_add: ['CHOWN', 'DAC_OVERRIDE', 'FOWNER'],
          network_mode: 'none',
          command: ['node', 'deploy/secrets-init.mjs'],
          volumes: [
            join(directory, 'secrets.json') + ':/input/secrets.json:ro',
            'api-secrets:/api',
            'owner-secrets:/owner',
            'database-secrets:/database',
          ],
        },
        database: {
          command: [
            'postgres',
            '-c',
            'log_statement=none',
            '-c',
            'log_min_error_statement=panic',
            '-c',
            'log_parameter_max_length=0',
            '-c',
            'log_parameter_max_length_on_error=0',
            '-c',
            'logging_collector=off',
          ],
          image: m.images.database,
          pull_policy: 'never',
          logging: logs,
          environment: {
            POSTGRES_USER: 'medi_migrator',
            POSTGRES_DB: 'product_studio_release',
            POSTGRES_PASSWORD_FILE: '/run/secrets/password',
          },
          volumes: ['database:/var/lib/postgresql/data', 'database-secrets:/run/secrets:ro'],
          depends_on: { secrets: { condition: 'service_completed_successfully' } },
          networks: ['data'],
          healthcheck: {
            test: ['CMD', 'pg_isready', '-U', 'medi_migrator', '-d', 'product_studio_release'],
            interval: '2s',
            timeout: '3s',
            retries: 40,
          },
        },
        migrate: {
          ...restricted,
          image: m.images.api,
          command: ['node', 'deploy/migrate.mjs'],
          environment: {
            DATABASE_URL_FILE: '/run/secrets/database-url',
            MEDI_RUNTIME_PASSWORD_FILE: '/run/secrets/runtime-password',
            STAFF_MFA_KEYRING_FILE: '/run/secrets/mfa-keyring.json',
          },
          volumes: ['owner-secrets:/run/secrets:ro'],
          networks: ['data'],
        },
        api: {
          ...restricted,
          image: m.images.api,
          command: ['node', 'compiled/server/index.js'],
          environment: {
            DATABASE_URL_FILE: '/run/secrets/database-url',
            APP_ORIGIN: 'https://recovery.invalid',
            NODE_ENV: 'production',
            STAFF_MFA_POLICY: 'required',
            STAFF_MFA_KEYRING_FILE: '/run/secrets/mfa-keyring.json',
            HOST: '0.0.0.0',
            PORT: '3100',
          },
          volumes: ['api-secrets:/run/secrets:ro'],
          networks: ['data'],
          healthcheck: {
            test: [
              'CMD',
              'node',
              '-e',
              "fetch('http://127.0.0.1:3100/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
            ],
            interval: '2s',
            timeout: '3s',
            retries: 40,
          },
        },
      },
      networks: { data: { internal: true } },
      volumes: { database: {}, 'api-secrets': {}, 'owner-secrets': {}, 'database-secrets': {} },
    };
    const file = join(directory, 'compose.json');
    writeFileSync(file, JSON.stringify(cfg), { mode: 0o600, flag: 'wx' });
    i = {
      compose: ['compose', '--project-name', target, '--env-file', '/dev/null', '-f', file],
      env: process.env,
    };
    owned = true;
    compose(i, ['up', '-d', '--wait', '--wait-timeout', '100', 'database']);
    const roles = `import {createPool} from './compiled/server/db.js';import {privateSecret} from './compiled/server/secrets.js';const p=createPool();try{await p.query("CREATE ROLE medi_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '"+privateSecret(process.env.MEDI_RUNTIME_PASSWORD_FILE)+"'");}catch{process.exitCode=1;}finally{await p.end();}`;
    compose(i, [
      'run',
      '--rm',
      '--no-deps',
      '-T',
      '--entrypoint',
      'node',
      'migrate',
      '--input-type=module',
      '-e',
      roles,
    ]);
    const restore = child(
      [
        ...i.compose,
        'exec',
        '-T',
        'database',
        'pg_restore',
        '-U',
        'medi_migrator',
        '-d',
        'product_studio_release',
        '--exit-on-error',
        '--single-transaction',
      ],
      i.env,
    );
    try {
      await pipeline(createReadStream(a.dump, { start: a.offset }), restore.process.stdin);
      await restore.done;
    } finally {
      restore.process.kill('SIGKILL');
    }
    compose(i, ['run', '--rm', '--no-deps', '-T', 'migrate']);
    holder = await inventory(i, target + '-snapshot');
    check(
      compareProductionSecurity(holder.result.inventory, m.inventory) &&
        isDeepStrictEqual(holder.result.inventory.records, m.inventory.records) &&
        isDeepStrictEqual(holder.result.inventory.versions, m.schema),
    );
    holder.process.stdin.end('commit\n');
    await holder.done;
    compose(i, ['up', '-d', '--wait', '--wait-timeout', '100', 'api']);
    return {
      result: 'PASS',
      images: m.images,
      schema: m.schema,
      tables: m.inventory.records.length,
      integrity: 'restored record hashes, explicit grants, schema and MFA readiness',
    };
  } finally {
    holder?.process.stdin.end('abort\n');
    if (owned) compose(i, ['down', '--volumes', '--remove-orphans', '--timeout', '10']);
    rmSync(directory, { recursive: true, force: true });
  }
}
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const [mode, ...args] = process.argv.slice(2);
  try {
    if (mode === 'key-init') {
      check(args.length === 1);
      initKey(args[0]);
      console.log('Independent private backup key created.');
    } else if (mode === 'backup') {
      check(args.length === 3);
      console.log(JSON.stringify(await backup(...args)));
    } else if (mode === 'recover-check') {
      check(args.length === 2);
      console.log(JSON.stringify(await recoverCheck(...args)));
    } else throw Error();
  } catch {
    console.error('Production backup/recovery failed; private diagnostics withheld.');
    process.exitCode = 1;
  }
}
