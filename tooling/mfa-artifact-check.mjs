// Deliberately fail a synthetic browser test and ensure failure artifacts omit its secret.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
mkdirSync('.local', { recursive: true, mode: 0o700 });
const directory = mkdtempSync(resolve('.local/mfa-artifact-'));
const marker = randomBytes(32).toString('hex');
try {
  writeFileSync(
    join(directory, 'test.spec.ts'),
    "import {test,expect} from '@playwright/test';\ntest('controlled private-field failure',async({page})=>{\nawait page.setContent('<main><h1>Authenticator setup</h1><p data-private>'+process.env.MFA_FAILURE_MARKER+'</p></main>');\nexpect(false).toBe(true);\n});\n",
    { mode: 0o600 },
  );
  writeFileSync(
    join(directory, 'config.ts'),
    "import {defineConfig} from '@playwright/test';\nimport actual from '../../playwright.mfa.config';\nexport default defineConfig({...actual,testDir:'.',testMatch:'test.spec.ts',outputDir:'output',webServer:undefined});\n",
    { mode: 0o600 },
  );
  const run = spawnSync(
    process.execPath,
    ['node_modules/@playwright/test/cli.js', 'test', '--config', join(directory, 'config.ts')],
    {
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: resolve('.cache/ms-playwright'),
        MFA_FAILURE_MARKER: marker,
      },
      encoding: 'utf8',
      timeout: 30000,
    },
  );
  if (
    run.error ||
    run.status !== 1 ||
    !/[12] failed/.test(run.stdout) ||
    (run.stdout + run.stderr).includes(marker)
  )
    throw Error('Controlled browser failure guard did not pass.');
  function scan(path) {
    for (const item of readdirSync(path, { withFileTypes: true })) {
      const p = join(path, item.name);
      if (item.isDirectory()) scan(p);
      else if (
        /\.(png|zip|webm)$/.test(p) ||
        (item.name === 'error-context.md' && readFileSync(p, 'utf8').includes('# Page snapshot')) ||
        readFileSync(p).includes(Buffer.from(marker))
      )
        throw Error('Private marker appeared in a failure artifact.');
    }
  }
  scan(directory);
  console.log(
    'PASS: controlled Playwright failure produced no secret marker in output or artifacts.',
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
