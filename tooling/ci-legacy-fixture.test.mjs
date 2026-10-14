import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('CI old fixture refuses occupied projects and cleans only its generated project', () => {
  const root = mkdtempSync(join(tmpdir(), 'medi-ci-fixture-'));
  try {
    for (const path of ['current/tooling', 'legacy', 'bin', 'temp'])
      mkdirSync(join(root, path), { recursive: true });
    copyFileSync(
      new URL('./ci-legacy-fixture.mjs', import.meta.url),
      join(root, 'current/tooling/ci-legacy-fixture.mjs'),
    );
    const fake = `#!/usr/bin/env -S node --
import fs from 'node:fs';import path from 'node:path';
const name=path.basename(process.argv[1]),a=process.argv.slice(2);
fs.appendFileSync(process.env.CALLS,JSON.stringify({name,args:a})+'\\n');
if(name==='git'&&a[0]==='rev-parse')console.log('bb2d61eca859415e458fc753a5a3787b267fa987');
if(name==='docker'&&['ps','volume','network'].includes(a[0])&&process.env.OCCUPIED===a[0])console.log('existing-owned-elsewhere');
if(name==='docker'&&a.includes('-Atc'))console.log('1,2,3,4,5,6,7,8,9,10,11');
if(name==='npm'&&a.includes('release:local')&&process.env.FAIL_BUILD)process.exit(1);
if(name==='npm'&&(a.includes('release:key-init')||a.includes('release:backup'))){fs.mkdirSync('.local/release-backups',{recursive:true});fs.writeFileSync(a.at(-1),'private-fixture',{mode:0o600});}
`;
    for (const name of ['git', 'docker', 'npm'])
      writeFileSync(join(root, 'bin', name), fake, { mode: 0o700 });
    const calls = join(root, 'calls');
    const run = (extra = {}) =>
      spawnSync(process.execPath, [join(root, 'current/tooling/ci-legacy-fixture.mjs')], {
        env: {
          ...process.env,
          GITHUB_ACTIONS: 'true',
          GITHUB_WORKSPACE: root,
          RUNNER_TEMP: join(root, 'temp'),
          PATH: join(root, 'bin') + ':' + process.env.PATH,
          CALLS: calls,
          ...extra,
        },
        encoding: 'utf8',
        timeout: 15000,
      });
    assert.equal(run({ GITHUB_ACTIONS: 'false' }).status, 1);
    assert.equal(existsSync(calls), false);
    let entries;
    for (const resource of ['ps', 'volume', 'network']) {
      writeFileSync(calls, '');
      assert.equal(run({ OCCUPIED: resource }).status, 1);
      entries = readFileSync(calls, 'utf8');
      assert.equal(entries.includes('release:local'), false);
      assert.equal(entries.includes('down'), false);
    }
    writeFileSync(calls, '');
    const failedBuild = run({ FAIL_BUILD: '1' });
    assert.equal(failedBuild.status, 1);
    entries = readFileSync(calls, 'utf8');
    assert.ok(entries.includes('release:local'), entries + failedBuild.stderr);
    assert.ok(
      entries.includes('down'),
      entries +
        failedBuild.stderr +
        failedBuild.stdout +
        readFileSync(join(root, 'current/.local/ci-legacy-owned-project-cleanup.log'), 'utf8'),
    );
    assert.equal(entries.includes('release:backup'), false);
    writeFileSync(calls, '');
    const result = run();
    assert.equal(result.status, 0);
    assert.match(result.stdout, /PASS/);
    assert.equal(
      readFileSync(join(root, 'current/.local/release-backups/ci-old.medi'), 'utf8'),
      'private-fixture',
    );
    assert.equal(readFileSync(join(root, 'current/.local/ci-old.key'), 'utf8'), 'private-fixture');
    entries = readFileSync(calls, 'utf8');
    assert.ok(entries.includes('down'));
    assert.equal(result.stdout.includes('private-fixture'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
