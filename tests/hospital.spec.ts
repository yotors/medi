import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomBytes, randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { mkdir } from 'node:fs/promises';
import { createPool } from '../server/db';
import { provisionStaff } from '../server/setup';
import { prepareBrowserFixture } from './browser-fixture';
try {
  loadEnvFile('.env');
} catch {
  /* CI environment */
}
const pool = createPool(),
  hospitalCode = `governance-${randomUUID().slice(0, 8)}`,
  password = randomBytes(24).toString('hex');
test.beforeAll(async () => {
  test.setTimeout(120000);
  await prepareBrowserFixture(pool);
  for (const role of ['admin', 'auditor'] as const)
    await provisionStaff(pool, {
      hospitalCode,
      hospitalName: 'Fictional Department Center',
      username: role,
      displayName: `Fictional ${role}`,
      role,
      password,
    });
});
test.afterAll(async () => {
  await pool.end();
});
async function signIn(page: Page, role = 'admin') {
  await page.goto('/staff/patients');
  await page.getByLabel('Hospital code', { exact: true }).fill(hospitalCode);
  await page.getByLabel('Username', { exact: true }).fill(role);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Patient directory', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Hospital management', exact: true }).click();
}

test('governance facilities settings download keyboard axe and responsive capture', async ({
  page,
}, info) => {
  await signIn(page);
  const code = `F${randomUUID().slice(0, 8).toUpperCase()}`;
  await page.getByLabel('Facility code', { exact: true }).fill(code);
  await page.getByLabel('Facility name', { exact: true }).fill('Fictional governed facility');
  await page.getByLabel('Reason', { exact: true }).fill('Approved fictional facility');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Fictional governed facility' })).toBeVisible();
  await page.getByRole('button', { name: 'Organization', exact: true }).click();
  await page.getByLabel('Preferred record locale').selectOption('am-ET');
  await page.getByLabel('Display calendar').selectOption('ethiopic');
  await page.getByLabel('Reason', { exact: true }).fill('Approved fictional display preference');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  await page.getByRole('button', { name: 'Exports', exact: true }).click();
  await page.getByLabel('Record collection').selectOption('hospital_facilities');
  await page.getByLabel('Reason', { exact: true }).fill('Approved fictional exit export');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download records', exact: true }).click();
  const file = await download;
  const stream = await file.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const data = JSON.parse(Buffer.concat(chunks).toString());
  expect(data.records.some((r: any) => r.code === code)).toBe(true);
  expect(data.records.every((r: any) => r.hospital_id === data.records[0].hospital_id)).toBe(true);
  await page.getByLabel('Record collection').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Page (250 records per page)')).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await mkdir('artifacts/hospital-ui', { recursive: true });
  await page.screenshot({ path: `artifacts/hospital-ui/${info.project.name}.png`, fullPage: true });
});
test('auditor governance renders records without write forms', async ({ page }) => {
  await signIn(page, 'auditor');
  await expect(page.getByRole('heading', { name: 'Add facility' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Support access', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Approve named support access' })).toHaveCount(0);
});
