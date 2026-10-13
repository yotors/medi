import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
process.env.PLAYWRIGHT_BROWSERS_PATH ??= fileURLToPath(new URL('./.cache/ms-playwright', import.meta.url));
export default defineConfig({
  testDir: './tests', testMatch: 'staff.spec.ts', workers: 1, retries: 0, forbidOnly: Boolean(process.env.CI),
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'artifacts/staff-report' }]],
  outputDir: 'artifacts/staff-test-results', timeout: 40000,
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'off', screenshot: 'only-on-failure' },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }, { name: 'mobile', use: { ...devices['Pixel 7'] } }],
  webServer: [
    { command: 'npm run dev:api', url: 'http://127.0.0.1:3100/api/health', reuseExistingServer: !process.env.CI },
    { command: 'npm run dev -- --port 5173 --strictPort', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI },
  ],
});
