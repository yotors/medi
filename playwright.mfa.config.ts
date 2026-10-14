import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
process.env.PLAYWRIGHT_BROWSERS_PATH ??= fileURLToPath(new URL('./.cache/ms-playwright',import.meta.url));
process.env.MEDI_BROWSER_TEST='1';
process.env.PLAYWRIGHT_NO_COPY_PROMPT='1';
export default defineConfig({testDir:'./tests',testMatch:'mfa.spec.ts',workers:1,retries:0,timeout:40000,reporter:'list',use:{baseURL:'http://127.0.0.1:5176',trace:'off',screenshot:'off'},projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['Pixel 7']}}],webServer:[{command:'node --env-file-if-exists=.env --import tsx tooling/mfa-browser-server.ts',url:'http://127.0.0.1:3112/api/health',reuseExistingServer:false},{command:'STAFF_API_TARGET=http://127.0.0.1:3112 npm run dev -- --port 5176 --strictPort',url:'http://127.0.0.1:5176',reuseExistingServer:false}]});
