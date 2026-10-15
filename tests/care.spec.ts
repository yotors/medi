import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { createPool } from '../server/db';
import { prepareBrowserFixture } from './browser-fixture';
import { provisionStaff } from '../server/setup';
try {
  loadEnvFile('.env');
} catch {
  /* CI supplies configuration. */
}
const pool = createPool(),
  code = `care-browser-${randomUUID().slice(0, 8)}`,
  password = randomBytes(24).toString('hex');
test.beforeAll(async () => {
  await prepareBrowserFixture(pool);
  await provisionStaff(pool, {
    hospitalCode: code,
    hospitalName: 'Fictional Care Center',
    username: 'careadmin',
    displayName: 'Fictional care administrator',
    role: 'admin',
    password,
  });
  await provisionStaff(pool, {
    hospitalCode: code,
    hospitalName: 'Fictional Care Center',
    username: 'careclinician',
    displayName: 'Fictional care clinician',
    role: 'clinician',
    password,
  });
});
test.afterAll(async () => {
  await pool.end();
});
test('persistent patient profile correction and appointment arrival', async ({ page }, info) => {
  await page.goto('/staff/patients');
  await page.getByLabel('Hospital code', { exact: true }).fill(code);
  await page.getByLabel('Username', { exact: true }).fill('careadmin');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Patient directory' })).toBeVisible();
  const auth = await (await page.request.get('/api/auth/session')).json();
  const registered = await page.request.post('/api/patients', {
    headers: {
      Origin: new URL(page.url()).origin,
      'X-CSRF-Token': auth.csrfToken,
      'Idempotency-Key': randomUUID(),
    },
    data: { name: 'Fictional Browser Care', age: 30, contact: 'fictional' },
  });
  expect(registered.status()).toBe(201);
  await page.getByRole('link', { name: 'Patient care', exact: true }).click();
  await page.getByLabel('Find a patient').fill('Fictional Browser Care');
  await page.getByRole('button', { name: 'Search patients' }).click();
  await page.getByRole('button', { name: /Fictional Browser Care ·/ }).click();
  await page.getByRole('button', { name: 'Enter patient profile' }).click();
  await page.getByLabel('Patient name', { exact: true }).fill('Fictional Browser Corrected');
  await page
    .getByLabel('Entry / correction / cancellation reason')
    .fill('Synthetic verified name correction');
  await page.getByRole('button', { name: 'Sign and save' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved with your name' })).toBeVisible();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: /Revision 1 · Fictional care administrator/ }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Appointments', exact: true }).click();
  await page.getByRole('button', { name: 'New entry', exact: true }).click();
  await page
    .getByLabel('Responsible clinician', { exact: true })
    .selectOption({ label: 'Fictional care clinician' });
  await page.getByLabel('Service', { exact: true }).fill('Entered consultation');
  await page.getByLabel('Facility', { exact: true }).fill('Main');
  await page.getByLabel('Start (Addis Ababa, Gregorian)', { exact: true }).fill('2026-10-14T09:00');
  await page.getByLabel('End (Addis Ababa, Gregorian)', { exact: true }).fill('2026-10-14T10:00');
  await page.getByLabel('Entry / correction / cancellation reason').fill('Synthetic booking');
  await page.getByRole('button', { name: 'Sign and save' }).click();
  await expect(page.getByRole('cell', { name: 'booked', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  await page.getByLabel('Appointment status').selectOption('arrived');
  await page
    .getByLabel('Entry / correction / cancellation reason')
    .fill('Patient arrival confirmed by staff');
  await page.getByRole('button', { name: 'Sign and save' }).click();
  await expect(page.getByRole('cell', { name: 'arrived', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('link', { name: 'Patient care', exact: true }).click();
  await page.getByLabel('Find a patient').fill('Fictional Browser Corrected');
  await page.getByRole('button', { name: 'Search patients' }).click();
  await page.getByRole('button', { name: /Fictional Browser Corrected ·/ }).click();
  await expect(page.getByRole('cell', { name: /Fictional Browser Corrected/ })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await mkdir('artifacts/care-ui', { recursive: true });
  await page.screenshot({ path: `artifacts/care-ui/${info.project.name}.png`, fullPage: true });
});
test('duplicate resolution selects canonical identity by hospital-scoped name and MRN', async ({
  page,
}, info) => {
  await page.goto('/staff/patients');
  await page.getByLabel('Hospital code', { exact: true }).fill(code);
  await page.getByLabel('Username', { exact: true }).fill('careadmin');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Patient directory' })).toBeVisible();
  const auth = await (await page.request.get('/api/auth/session')).json();
  const names = ['Fictional Picker Duplicate', 'Fictional Picker Canonical'];
  const patients = [];
  for (const name of names) {
    const response = await page.request.post('/api/patients', {
      headers: {
        Origin: new URL(page.url()).origin,
        'X-CSRF-Token': auth.csrfToken,
        'Idempotency-Key': randomUUID(),
      },
      data: { name, age: 30, contact: 'fictional', confirmDuplicate: true },
    });
    expect(response.status()).toBe(201);
    patients.push((await response.json()).patient);
  }
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === '/api/patients/search') {
      expect(r.method()).toBe('POST');
      expect(new URL(r.url()).search).toBe('');
      expect(r.headers()['x-csrf-token']).toBeTruthy();
    }
  });
  await page.getByRole('link', { name: 'Patient care', exact: true }).click();
  await page.getByLabel('Find a patient').fill(names[0]);
  await page.getByRole('button', { name: 'Search patients', exact: true }).click();
  await page
    .getByRole('button', { name: `${names[0]} · ${patients[0].recordNumber}`, exact: true })
    .click();
  await page.getByText('Resolve a duplicate patient identity', { exact: true }).click();
  await page
    .getByLabel('Find canonical patient by name, MRN or contact', { exact: true })
    .fill(patients[1].recordNumber);
  await page.getByRole('button', { name: 'Search canonical patients', exact: true }).click();
  await page
    .getByRole('button', {
      name: `Select canonical: ${names[1]} · ${patients[1].recordNumber}`,
      exact: true,
    })
    .click();
  await expect(page.locator('.care-identity')).toContainText(`${names[0]}`);
  await expect(page.getByRole('status').filter({ hasText: 'Canonical:' })).toContainText(
    `${names[1]} · ${patients[1].recordNumber}`,
  );
  await expect(page.getByLabel('Canonical patient ID', { exact: true })).toHaveCount(0);
  await page
    .getByLabel('Resolution reason', { exact: true })
    .fill('Verified synthetic duplicate with original MRNs retained');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await mkdir('artifacts/care-ui', { recursive: true });
  await page.screenshot({
    path: `artifacts/care-ui/${info.project.name}-identity-picker.png`,
    fullPage: true,
  });
  await page
    .getByRole('button', { name: 'Link duplicate to canonical identity', exact: true })
    .click();
  await expect(page.getByRole('status').filter({ hasText: 'Identities linked.' })).toBeVisible();
  await expect(page.getByText(/Linked identities \(2\)/)).toBeVisible();
});
