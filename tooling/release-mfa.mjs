// Constrained local packaged operator ceremony; never sources the development .env.
import {
  constants,
  lstatSync,
  fstatSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  fsyncSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { resolve, dirname, join, parse } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
let container, scratch, ownedOutput;
let phase = 'admission';
const rootOwner = lstatSync('/').uid;
function trusted(path, privateDirectory = false) {
  let at = dirname(path),
    first = true;
  for (;;) {
    const s = lstatSync(at);
    if (
      !s.isDirectory() ||
      s.isSymbolicLink() ||
      ![rootOwner, process.getuid()].includes(s.uid) ||
      (s.mode & 0o022 && !(s.uid === rootOwner && s.mode & 0o1000)) ||
      (first && privateDirectory && s.mode & 0o077)
    )
      throw Error();
    if (at === parse(at).root) break;
    at = dirname(at);
    first = false;
  }
}
function privateRead(path, limit) {
  trusted(path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const s = fstatSync(fd);
    if (
      !s.isFile() ||
      ![rootOwner, process.getuid()].includes(s.uid) ||
      s.mode & 0o077 ||
      s.size > limit
    )
      throw Error();
    return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
}
function docker(args, env = process.env) {
  const r = spawnSync('docker', args, { encoding: 'utf8', env, timeout: 20000, maxBuffer: 65536 });
  if (r.error || r.status !== 0) throw Error();
  return r.stdout.trim();
}
try {
  const [target, mode, hospital, user, reason, operator, output, ...extra] = process.argv.slice(2);
  if (
    target !== 'medi-release-local' ||
    extra.length ||
    !['grant', 'rotate-keys'].includes(mode) ||
    !/^[a-z0-9-]{1,100}$/.test(hospital ?? '') ||
    !/^[a-z0-9_.-]{1,100}$/.test(user ?? '') ||
    !['initial_enrollment', 'lost_all_factors', 'compromised_factor'].includes(reason) ||
    !/^[A-Za-z0-9_.-]{1,80}$/.test(operator ?? '') ||
    !output
  )
    throw Error();
  const path = resolve(output);
  trusted(path, true);
  const config = privateRead(resolve('.local/release.env'), 1024);
  if (
    !/^MEDI_MIGRATION_PASSWORD=[a-f0-9]{64}\nMEDI_RUNTIME_PASSWORD=[a-f0-9]{64}\nMEDI_RELEASE_TAG=[a-z0-9][a-z0-9_.-]{0,63}\n$/.test(
      config,
    )
  )
    throw Error();
  const settings = Object.fromEntries(
    config
      .trim()
      .split('\n')
      .map((line) => line.split('=')),
  );
  const id = docker([
    'ps',
    '-q',
    '--filter',
    'label=com.docker.compose.project=medi-release-local',
    '--filter',
    'label=com.docker.compose.service=api',
  ]);
  if (!/^[a-f0-9]{12,64}$/.test(id)) throw Error();
  const [api] = JSON.parse(docker(['inspect', id]));
  if (
    api.Config.Image !== `medi-local-api:${settings.MEDI_RELEASE_TAG}` ||
    !api.State.Running ||
    !api.NetworkSettings.Networks['medi-release-local_data'] ||
    !api.Mounts.some(
      (m) =>
        m.Name === 'medi-release-local_release-mfa-keys' &&
        m.Destination === '/run/secrets' &&
        !m.RW,
    )
  )
    throw Error();
  const db = docker([
    'ps',
    '-q',
    '--filter',
    'label=com.docker.compose.project=medi-release-local',
    '--filter',
    'label=com.docker.compose.service=database',
  ]);
  if (!/^[a-f0-9]{12,64}$/.test(db)) throw Error();
  // Publish only into a newly owned file. Early creation rejects preexisting targets before mutation.
  const fd = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  ownedOutput = path;
  try {
    container = 'medi-mfa-operator-' + randomUUID();
    const env = {
      ...process.env,
      DATABASE_URL: `postgresql://medi_migrator:${settings.MEDI_MIGRATION_PASSWORD}@database:5432/product_studio_release`,
    };
    phase = 'container-create';
    docker(
      [
        'create',
        '--name',
        container,
        '--network',
        'medi-release-local_data',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges:true',
        '--user',
        '1000:1000',
        '--mount',
        'type=volume,src=medi-release-local_release-mfa-keys,dst=/run/secrets,readonly',
        '-e',
        'DATABASE_URL',
        '-e',
        'STAFF_MFA_KEYRING_FILE=/run/secrets/mfa-keyring.json',
        '-e',
        'STAFF_MFA_POLICY=required',
        '-e',
        'MEDI_OPERATOR_RELEASE=medi-release-local',
        api.Image,
        'node',
        '-e',
        'setTimeout(()=>{},60000)',
      ],
      env,
    );
    // A private nonroot writable layer permits archive retrieval without secret stdout.
    phase = 'container-start';
    docker(['start', container]);
    phase = 'private-directory';
    docker([
      'exec',
      container,
      'node',
      '-e',
      "require('node:fs').mkdirSync('/tmp/operator',{mode:0o700})",
    ]);
    phase = 'operator-action';
    docker([
      'exec',
      container,
      'node',
      'compiled/server/mfa-setup.js',
      mode,
      hospital,
      user,
      reason,
      operator,
      '/tmp/operator/result.json',
    ]);
    scratch = mkdtempSync(join(dirname(path), '.mfa-result-'));
    phase = 'private-result';
    docker(['cp', `${container}:/tmp/operator/result.json`, join(scratch, 'result.json')]);
    const value = privateRead(join(scratch, 'result.json'), 8192),
      result = JSON.parse(value);
    if (result.hospitalCode !== hospital || result.username !== user) throw Error();
    writeFileSync(fd, value);
    fsyncSync(fd);
    ownedOutput = undefined;
  } finally {
    closeSync(fd);
  }
} catch {
  process.stderr.write(
    'Release operator result could not be confirmed (' +
      phase +
      '). Verify target account state before retrying; a committed action may have lost its reply. No authentication details logged.\n',
  );
  process.exitCode = 1;
} finally {
  if (container)
    try {
      docker(['rm', '-f', container]);
    } catch {
      process.stderr.write(
        'Private operator container cleanup failed (container-cleanup): ' +
          container +
          '. Remove this helper before delivery.\n',
      );
      process.exitCode = 1;
    }
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  if (ownedOutput) rmSync(ownedOutput, { force: true });
}

if (process.exitCode !== 1)
  console.log(
    'Packaged release operator result written privately. Verify identity before delivery.',
  );
