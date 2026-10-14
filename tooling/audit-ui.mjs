import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const target = process.argv[2];
if (!target || !['http:', 'https:'].includes(new URL(target).protocol)) {
  throw new Error('Usage: npm run audit:ui -- http://127.0.0.1:PORT/path');
}
process.env.PLAYWRIGHT_BROWSERS_PATH ??= fileURLToPath(
  new URL('../.cache/ms-playwright', import.meta.url),
);
const { chromium, devices } = await import('@playwright/test');
const { default: AxeBuilder } = await import('@axe-core/playwright');
const directory = fileURLToPath(new URL(`../artifacts/ui-${Date.now()}/`, import.meta.url));
await mkdir(directory, { recursive: true });
const browser = await chromium.launch();
let failed = false;
try {
  for (const [name, device] of [
    ['desktop', devices['Desktop Chrome']],
    ['mobile', devices['Pixel 7']],
  ]) {
    const context = await browser.newContext(device);
    const page = await context.newPage();
    const errors = [];
    const expectedAuthenticationResponses = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      let anonymousSession = false;
      try {
        const resource = new URL(message.location().url);
        anonymousSession =
          resource.origin === new URL(target).origin && resource.pathname === '/api/auth/session';
      } catch {
        /* Other console errors remain failures. */
      }
      if (
        anonymousSession &&
        message.text() ===
          'Failed to load resource: the server responded with a status of 401 (Unauthorized)'
      ) {
        expectedAuthenticationResponses.push({ path: '/api/auth/session', status: 401 });
        return;
      }
      errors.push(message.text());
    });
    const response = await page.goto(target, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    await page.screenshot({ path: `${directory}/${name}.png`, fullPage: true });
    const evidence = {
      target,
      capturedAt: new Date().toISOString(),
      status: response?.status(),
      errors,
      expectedAuthenticationResponses,
      violations: result.violations,
      incomplete: result.incomplete,
    };
    await writeFile(`${directory}/${name}.json`, JSON.stringify(evidence, null, 2));
    const ok = response?.ok() && errors.length === 0 && result.violations.length === 0;
    failed ||= !ok;
    console.log(
      `${name}: ${ok ? 'PASS' : 'FAIL'}; ${result.violations.length} accessibility violations; ${errors.length} runtime errors`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
console.log(`Evidence: ${directory}`);
process.exitCode = failed ? 1 : 0;
