import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH ??= `${root}.cache/ms-playwright`;
const { chromium } = await import('playwright');
const child = spawn(
  process.execPath,
  [
    `${root}node_modules/@playwright/mcp/cli.js`,
    '--headless',
    '--isolated',
    '--executable-path',
    chromium.executablePath(),
    '--output-dir',
    `${root}artifacts/browser`,
  ],
  { cwd: root, env: process.env, stdio: 'inherit' },
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
