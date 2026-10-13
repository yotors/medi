import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomBytes, randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { mkdir } from 'node:fs/promises';
import { createPool, migrate } from '../server/db';
import { provisionStaff } from '../server/setup';
try { loadEnvFile('.env'); } catch { /* CI may supply environment directly. */ }
const pool = createPool();
const suffix = randomUUID().slice(0, 8);
const hospitalCode = `browser-${suffix}`;
const password = randomBytes(24).toString('hex');
let receptionistId = '';

test.beforeAll(async () => {
  await migrate(pool);
  receptionistId = (await provisionStaff(pool, { hospitalCode, hospitalName: 'Browser Fiction Medical Center', username: 'reception', displayName: 'Fictional Reception', role: 'receptionist', password })).id;
  await provisionStaff(pool, { hospitalCode, hospitalName: 'Browser Fiction Medical Center', username: 'auditor', displayName: 'Fictional Auditor', role: 'auditor', password });
  await provisionStaff(pool, { hospitalCode: `${hospitalCode}-other`, hospitalName: 'Other Fictional Hospital', username: 'reception', displayName: 'Other Reception', role: 'receptionist', password });
});
test.afterAll(async () => { await pool.end(); });
async function signIn(page: Page, username = 'reception', hospital = hospitalCode) {
  await page.goto('/staff');
  await page.getByLabel('Hospital code', { exact: true }).fill(hospital);
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Patient directory' })).toBeVisible();
}
async function addPatient(page: Page, name: string) {
  await page.getByRole('button', { name: 'Register patient', exact: true }).click();
  await page.getByLabel('Full name').fill(name);
  await page.getByRole('button', { name: 'Save patient', exact: true }).click();
}

test('staff sign-in, duplicate confirmation, search, reload and sign-out', async ({ page }, info) => {
  await page.goto('/staff');
  await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await mkdir('artifacts/staff-ui', { recursive: true });
  await page.screenshot({ path: `artifacts/staff-ui/${info.project.name}-login.png`, fullPage: true });
  await page.getByLabel('Hospital code', { exact: true }).fill(hospitalCode);
  await page.getByLabel('Username', { exact: true }).fill('reception');
  await page.getByLabel('Password', { exact: true }).fill('incorrect-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('not accepted');
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Password', { exact: true }).press('Enter');
  const name = `Fictional Patient ${suffix}`;
  await page.getByRole('button', { name: 'Register patient', exact: true }).click();
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Age', { exact: false }).fill('0');
  await page.getByLabel('Contact', { exact: false }).fill('Fictional contact 0900000000');
  await page.getByRole('button', { name: 'Save patient', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: name }).getByRole('cell', { name: '0', exact: true })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: name })).toContainText('Fictional contact 0900000000');
  await expect(page.getByRole('status').filter({ hasText: 'Patient registered' })).toBeVisible();
  await expect(page.getByRole('cell', { name, exact: true })).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('cell', { name, exact: true })).toHaveCount(1);
  await expect(page.getByRole('row').filter({ hasText: name }).getByRole('cell', { name: '0', exact: true })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: name })).toContainText('Fictional contact 0900000000');
  await addPatient(page, name);
  await expect(page.getByRole('alert')).toContainText('already exists');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Save patient', exact: true }).click();
  await expect(page.getByRole('cell', { name, exact: true })).toHaveCount(2);
  await page.getByLabel('Search name or record number').fill('no-such-patient');
  await page.getByLabel('Search name or record number').press('Enter');
  await expect(page.getByRole('heading', { name: 'No matching patients' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByRole('cell', { name, exact: true })).toHaveCount(2);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('heading', { name: 'Patient directory' }).focus();
  await page.screenshot({ path: `artifacts/staff-ui/${info.project.name}-directory.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toBeVisible();
  expect((await page.request.get('/api/patients')).status()).toBe(401);
});

test('lost registration response retries the original write exactly once', async ({ page }) => {
  await signIn(page); const name = `Retry Fiction ${randomUUID()}`;
  let loseResponse = true;
  await page.route('**/api/patients', async route => {
    if (route.request().method() === 'POST' && loseResponse) {
      loseResponse = false;
      const response = await route.fetch(); expect(response.status()).toBe(201);
      await route.abort('failed');
    } else await route.continue();
  });
  await addPatient(page, name);
  await expect(page.getByRole('button', { name: 'Retry registration' })).toBeVisible();
  await expect(page.getByLabel('Full name')).toHaveValue(name);
  await expect(page.getByLabel('Full name')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeDisabled();
  await page.getByRole('link', { name: 'View outpatient walkthrough' }).click();
  await expect(page).toHaveURL(/\/staff$/);
  await expect(page.getByRole('alert')).toContainText('pending registration');
  await page.getByRole('button', { name: 'Retry registration' }).click();
  await expect(page.getByRole('cell', { name, exact: true })).toHaveCount(1);
  const data = await (await page.request.get(`/api/patients?q=${encodeURIComponent(name)}`)).json();
  expect(data.total).toBe(1);
});

test('hospital boundary and read-only permissions are enforced by the API', async ({ page }) => {
  await signIn(page); const name = `Boundary Fiction ${randomUUID()}`; await addPatient(page, name);
  await expect(page.getByRole('cell', { name, exact: true })).toHaveCount(1);
  const original = await (await page.request.get(`/api/patients?q=${encodeURIComponent(name)}`)).json();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page, 'reception', `${hospitalCode}-other`);
  await expect(page.getByRole('cell', { name, exact: true })).toHaveCount(0);
  expect((await page.request.get(`/api/patients/${original.patients[0].id}`)).status()).toBe(404);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page, 'auditor');
  await expect(page.getByRole('button', { name: 'Register patient', exact: true })).toHaveCount(0);
  const session = await (await page.request.get('/api/auth/session')).json();
  const forbidden = await page.request.post('/api/patients', { headers: { Origin: 'http://127.0.0.1:5173', 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': randomUUID() }, data: { name: 'Forbidden Fiction', contact: '' } });
  expect(forbidden.status()).toBe(403);
});

test('revoked sessions clear patient data and logout clears another open tab', async ({ page, context }) => {
  await signIn(page);
  await pool.query('DELETE FROM staff_sessions WHERE user_id=$1', [receptionistId]);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Registered patients' })).toHaveCount(0);
  await signIn(page);
  const other = await context.newPage(); await other.goto('/staff');
  await expect(other.getByRole('heading', { name: 'Patient directory' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(other.getByRole('heading', { name: 'Staff sign-in' })).toBeVisible();
  await expect(other.getByRole('region', { name: 'Registered patients' })).toHaveCount(0);
});


test('directory pagination changes rows and search resets to first page', async ({ page }) => {
  await signIn(page);
  const session = await (await page.request.get('/api/auth/session')).json();
  for (let index = 0; index < 26; index++) {
    const response = await page.request.post('/api/patients', { headers: { Origin: 'http://127.0.0.1:5173', 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': randomUUID() }, data: { name: `Pagination Fiction ${String(index).padStart(2, '0')} ${suffix}`, contact: '' } });
    expect(response.status()).toBe(201);
  }
  await page.reload();
  await expect(page.getByRole('cell', { name: `Pagination Fiction 25 ${suffix}`, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Page 2' })).toBeVisible();
  await expect(page.getByRole('cell', { name: `Pagination Fiction 25 ${suffix}`, exact: true })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: `Pagination Fiction 00 ${suffix}`, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(page.getByRole('cell', { name: `Pagination Fiction 25 ${suffix}`, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByLabel('Search name or record number').fill(`Pagination Fiction 25 ${suffix}`);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Page 1 of 1' })).toBeVisible();
  await expect(page.getByRole('cell', { name: `Pagination Fiction 25 ${suffix}`, exact: true })).toBeVisible();
});

test('delayed session restoration cannot undo a cross-tab logout', async ({ page }) => {
  await signIn(page);
  let release!: () => void; let intercepted!: () => void;
  const waiting = new Promise<void>(resolve => { intercepted = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/auth/session', async route => {
    const response = await route.fetch(); intercepted(); await gate;
    await route.fulfill({ response });
  });
  await page.reload(); await waiting;
  await page.evaluate(() => { const channel = new BroadcastChannel('hospital-staff-session'); channel.postMessage('logout'); channel.close(); });
  await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toBeVisible();
  release(); await page.unrouteAll({ behavior: 'wait' });
  await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Patient directory' })).toHaveCount(0);
});

test('a lost logout response clears both tabs and can confirm revocation on retry', async ({ page, context }) => {
  await signIn(page);
  const other = await context.newPage(); await other.goto('/staff');
  await expect(other.getByRole('heading', { name: 'Patient directory' })).toBeVisible();
  await page.route('**/api/auth/logout', async route => {
    const response = await route.fetch(); expect(response.status()).toBe(204); await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toBeVisible();
  await expect(other.getByRole('heading', { name: 'Staff sign-in' })).toBeVisible();
  await page.unroute('**/api/auth/logout');
  await page.getByRole('button', { name: 'Retry sign-out' }).click();
  await expect(page.getByRole('status')).toHaveText('You have signed out.');
  await expect(page.getByRole('button', { name: 'Retry sign-out' })).toHaveCount(0);
});
