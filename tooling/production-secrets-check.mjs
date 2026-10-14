import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { immutable } from './production-install.mjs';
const [image, ...extra] = process.argv.slice(2);
let directory;
try {
  if (extra.length || !immutable(image)) throw Error();
  directory = mkdtempSync('/tmp/medi-secrets-refusal-');
  let passed = 0;
  for (const mode of ['public', 'oversized', 'shape', 'symlink', 'directory']) {
    const input = join(directory, mode);
    mkdirSync(input, { mode: 0o700 });
    const file = join(input, 'secrets.json');
    if (mode === 'directory') mkdirSync(file, { mode: 0o700 });
    else if (mode === 'symlink') {
      writeFileSync(join(input, 'actual.json'), '{}', { mode: 0o600 });
      symlinkSync('actual.json', file);
    } else
      writeFileSync(file, mode === 'oversized' ? 'x'.repeat(16385) : '{}', {
        mode: mode === 'public' ? 0o644 : 0o600,
      });
    const r = spawnSync(
      'docker',
      [
        'run',
        '--rm',
        '--network',
        'none',
        '--read-only',
        '--cap-drop',
        'ALL',
        '--cap-add',
        'DAC_OVERRIDE',
        '--security-opt',
        'no-new-privileges:true',
        '--user',
        '0:0',
        '-v',
        input + ':/input:ro',
        '--entrypoint',
        'node',
        image,
        'deploy/secrets-init.mjs',
      ],
      { encoding: 'utf8', timeout: 20000 },
    );
    if (
      r.status !== 1 ||
      r.stdout ||
      r.stderr.trim() !== 'Private installation secrets could not be provisioned.'
    )
      throw Error();
    passed++;
  }
  console.log(
    `PASS: ${passed} initializer source-mode/size/shape/symlink/nonregular refusals, no secret diagnostics.`,
  );
} catch {
  console.error('Initializer refusal check failed; private diagnostics withheld.');
  process.exitCode = 1;
} finally {
  if (directory) rmSync(directory, { recursive: true, force: true });
}
