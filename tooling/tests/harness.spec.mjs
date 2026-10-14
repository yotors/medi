import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// This fixture validates tool installation only. It is not application coverage.
const fixture = `<!doctype html><html lang="en"><head><title>Tooling fixture</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body><main><h1>Tooling fixture</h1><label for="name">Name</label>
<input id="name"><button type="button" onclick="document.querySelector('output').textContent='Saved'">Save</button>
<output aria-live="polite"></output></main></body></html>`;

test.beforeEach(async ({ page }) => {
  await page.route('http://fixture.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: fixture }),
  );
  await page.goto('http://fixture.test/');
});

test('browser interaction and accessible fixture work', async ({ page }) => {
  await page.getByLabel('Name').fill('Test');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('output')).toHaveText('Saved');
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations).toEqual([]);
});

test('accessibility scanner detects a broken control', async ({ page }) => {
  await page.locator('main').evaluate((el) => {
    const input = document.createElement('input');
    input.id = 'unlabelled';
    el.append(input);
  });
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.some((v) => v.id === 'label')).toBe(true);
});
