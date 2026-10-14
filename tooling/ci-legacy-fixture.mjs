// Materialize a genuine old release only on a fresh GitHub Actions runner.
// Private logs, keys and archives are never uploaded as CI evidence.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, copyFileSync, chmodSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const baseline = 'bb2d61eca859415e458fc753a5a3787b267fa987';
const current = fileURLToPath(new URL('../', import.meta.url));
let legacy, owned = false, phase = 'admission';
function run(command, args, cwd, timeout = 600000) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 });
  const log = join(current, '.local', 'ci-legacy-' + phase + '.log');
  writeFileSync(log, (result.stdout ?? '') + (result.stderr ?? ''), { mode: 0o600 });
  if (result.error || result.status !== 0) throw Error('Fixture step failed.');
  return result.stdout.trim();
}
const compose = ['compose', '--project-name', 'medi-release-local', '--env-file', '.local/release.env', '-f', 'compose.release.yaml'];
try {
  if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.RUNNER_TEMP || !process.env.GITHUB_WORKSPACE) throw Error();
  const workspace = realpathSync(process.env.GITHUB_WORKSPACE);
  if (realpathSync(current) !== join(workspace, 'current')) throw Error();
  legacy = realpathSync(join(workspace, 'legacy'));
  if (legacy !== join(workspace, 'legacy')) throw Error();
  mkdirSync(join(current, '.local'), { recursive: true, mode: 0o700 });
  mkdirSync(join(current, '.local', 'release-backups'), { recursive: true, mode: 0o700 });
  if (run('git', ['rev-parse', 'HEAD'], legacy) !== baseline) throw Error();
  if (run('git', ['status', '--porcelain'], legacy)) throw Error();
  phase = 'fresh-project';
  for (const resource of ['ps', 'volume', 'network']) {
    const args = resource === 'ps' ? ['ps', '-aq'] : [resource, 'ls', '-q'];
    if (run('docker', [...args, '--filter', 'label=com.docker.compose.project=medi-release-local'], legacy, 30000)) throw Error();
  }
  phase = 'locked-dependencies';
  run('npm', ['ci', '--ignore-scripts'], legacy);
  owned = true; // Pristine runner checked before any project creation.
  for (const command of ['release:local', 'release:verify']) {
    phase = command.replace(':', '-');
    run('npm', ['run', command], legacy);
  }
  phase = 'old-schema';
  const versions = run('docker', [...compose, 'exec', '-T', 'database', 'psql', '-U', 'medi_migrator', '-d', 'product_studio_release', '-Atc', 'SELECT string_agg(version::text,\',\' ORDER BY version) FROM registration_migrations'], legacy, 30000);
  if (versions !== '1,2,3,4,5,6,7,8,9,10,11') throw Error();
  phase = 'archive';
  mkdirSync(join(legacy, '.local', 'release-backups'), { recursive: true, mode: 0o700 });
  run('npm', ['run', 'release:key-init', '--', '.local/ci-old.key'], legacy);
  run('npm', ['run', 'release:backup', '--', '.local/ci-old.key', '.local/release-backups/ci-old.medi'], legacy);
  for (const [source, target] of [['ci-old.key', 'ci-old.key'], ['release-backups/ci-old.medi', 'release-backups/ci-old.medi']]) {
    copyFileSync(join(legacy, '.local', source), join(current, '.local', target));
    chmodSync(join(current, '.local', target), 0o600);
  }
} catch {
  process.stderr.write('Genuine old CI fixture failed at ' + phase + '; private diagnostics retained locally.\n');
  process.exitCode = 1;
} finally {
  if (owned) {
    phase = 'owned-project-cleanup';
    try { run('docker', [...compose, 'down', '--volumes'], legacy, 60000); }
    catch { process.stderr.write('Generated old CI project cleanup failed.\n'); process.exitCode = 1; }
  }
}
if (!process.exitCode) process.stdout.write('PASS: pinned old release, schema1–11 and private archive retained; generated old project removed.\n');
