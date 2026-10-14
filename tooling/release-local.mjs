import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const mode = process.argv[2];
if (!['up', 'stop', 'status', 'build'].includes(mode))
  throw new Error('Use up, stop, status or build.');
mkdirSync('.local', { recursive: true, mode: 0o700 });
const directory = lstatSync('.local');
if (!directory.isDirectory() || directory.isSymbolicLink() || directory.mode & 0o077)
  throw new Error('.local must be a private real directory (mode 700).');
const path = '.local/release.env';
const firstConfiguration = !existsSync(path);
if (!existsSync(path)) {
  if (!['up', 'build'].includes(mode)) throw new Error('Run release-local.mjs up first.');
  const volumes = spawnSync(
    'docker',
    [
      'volume',
      'ls',
      '--filter',
      'name=medi-release-local_release-database',
      '--format',
      '{{.Name}}',
    ],
    { encoding: 'utf8' },
  );
  if (volumes.error || volumes.status !== 0)
    throw new Error('Could not check existing release storage; no credentials were generated.');
  if (volumes.stdout.split('\n').includes('medi-release-local_release-database'))
    throw new Error(
      'Existing release storage requires its original private configuration. Restore .local/release.env; no credentials were generated.',
    );
  writeFileSync(
    path,
    `MEDI_MIGRATION_PASSWORD=${randomBytes(32).toString('hex')}\nMEDI_RUNTIME_PASSWORD=${randomBytes(32).toString('hex')}\nMEDI_RELEASE_TAG=local\n`,
    { mode: 0o600, flag: 'wx' },
  );
  console.log('Created private release configuration.');
}
if (['up', 'build'].includes(mode)) {
  const mfaPath = '.local/mfa-keyring.json';
  if (!existsSync(mfaPath)) {
    if (!['up', 'build'].includes(mode)) throw new Error('Restore the private MFA keyring first.');
    if (!firstConfiguration) {
      const lookup = spawnSync(
        'docker',
        [
          'ps',
          '-q',
          '--filter',
          'label=com.docker.compose.project=medi-release-local',
          '--filter',
          'label=com.docker.compose.service=database',
        ],
        { encoding: 'utf8' },
      );
      const id = lookup.stdout?.trim();
      if (lookup.status !== 0 || !/^[a-f0-9]{12,64}$/.test(id ?? ''))
        throw new Error(
          'Restore the original MFA keyring, or start the pre-MFA database before upgrading.',
        );
      const query = (sql) =>
        spawnSync(
          'docker',
          ['exec', id, 'psql', '-U', 'medi_migrator', '-d', 'product_studio_release', '-Atc', sql],
          { encoding: 'utf8' },
        );
      const table = query("SELECT to_regclass('public.staff_factors') IS NOT NULL");
      if (table.status !== 0) throw new Error('Could not check MFA key references.');
      if (table.stdout.trim() === 't') {
        const count = query(
          'SELECT (SELECT count(*) FROM staff_factors)+(SELECT count(*) FROM staff_mfa_pending)',
        );
        if (count.status !== 0 || count.stdout.trim() !== '0')
          throw new Error('Existing MFA envelopes require the original keyring.');
      }
    }
    writeFileSync(
      mfaPath,
      JSON.stringify({
        current: 'local-v1',
        keys: { 'local-v1': randomBytes(32).toString('hex') },
      }) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
  }
  const mfaStat = lstatSync(mfaPath);
  if (!mfaStat.isFile() || mfaStat.isSymbolicLink() || mfaStat.mode & 0o077)
    throw new Error('MFA keyring must be a private real file.');
}
const stat = lstatSync(path);
if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077)
  throw new Error('Release configuration must be a private real file (mode 600).');
const config = readFileSync(path, 'utf8');
if (
  !/^MEDI_MIGRATION_PASSWORD=[a-f0-9]{64}\nMEDI_RUNTIME_PASSWORD=[a-f0-9]{64}\nMEDI_RELEASE_TAG=[a-z0-9][a-z0-9_.-]{0,63}\n$/.test(
    config,
  )
)
  throw new Error('Unexpected release configuration; no secrets displayed.');
const environment = {
  ...process.env,
  ...Object.fromEntries(
    config
      .trim()
      .split('\n')
      .map((line) => line.split('=')),
  ),
};
const args = [
  'compose',
  '--project-name',
  'medi-release-local',
  '--env-file',
  path,
  '-f',
  'compose.release.yaml',
];
const command =
  mode === 'up'
    ? ['up', '-d', '--build', '--wait', '--wait-timeout', '120']
    : mode === 'build'
      ? ['build']
      : mode === 'status'
        ? ['ps']
        : ['stop'];
const result = spawnSync('docker', [...args, ...command], { stdio: 'inherit', env: environment });
process.exitCode = result.status ?? 1;
if (mode === 'up' && result.status === 0)
  console.log(
    'Local release ready at https://localhost:8443/staff. Trust its local certificate explicitly; no system CA was installed.',
  );
