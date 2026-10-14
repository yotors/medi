import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
test('stop/status use verified configuration without reading or creating MFA files', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-admission-'));
  try {
    mkdirSync(join(root, 'tooling'));
    mkdirSync(join(root, '.local'), { mode: 0o700 });
    mkdirSync(join(root, 'bin'));
    writeFileSync(
      join(root, 'tooling/release-local.mjs'),
      readFileSync('tooling/release-local.mjs'),
    );
    writeFileSync(
      join(root, '.local/release.env'),
      'MEDI_MIGRATION_PASSWORD=' +
        'a'.repeat(64) +
        '\nMEDI_RUNTIME_PASSWORD=' +
        'b'.repeat(64) +
        '\nMEDI_RELEASE_TAG=local\n',
      { mode: 0o600 },
    );
    writeFileSync(
      join(root, 'bin/docker'),
      '#!/usr/bin/env node\nconst args=process.argv.slice(2);if(!args.includes("--project-name")||!args.includes("medi-release-local")||!["stop","ps"].includes(args.at(-1)))process.exit(2);\n',
      { mode: 0o700 },
    );
    for (const key of ['absent', 'unreadable']) {
      if (key === 'unreadable')
        writeFileSync(join(root, '.local/mfa-keyring.json'), 'not valid', { mode: 0 });
      for (const mode of ['stop', 'status']) {
        const result = spawnSync(
          process.execPath,
          [join(root, 'tooling/release-local.mjs'), mode],
          {
            env: { ...process.env, PATH: join(root, 'bin') + ':' + process.env.PATH },
            encoding: 'utf8',
          },
        );
        assert.equal(result.status, 0);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
