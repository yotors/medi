import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= fileURLToPath(new URL('./.cache/ms-playwright', import.meta.url));

export default defineConfig({
  testDir: './tooling/tests',
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'artifacts/playwright-report' }]],
  outputDir: 'artifacts/test-results',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
});
