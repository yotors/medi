import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomBytes, randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { mkdir } from 'node:fs/promises';
import { createPool } from '../server/db';
import { prepareBrowserFixture } from './browser-fixture';
import { provisionStaff } from '../server/setup';
import type { ConfigurationCommand, Department, Service } from '../shared/configuration';
try {
  loadEnvFile('.env');
} catch {
  /* CI supplies environment. */
}
test.use({ screenshot: 'off' });
test.setTimeout(90000);
const pool = createPool();
const hospitalCode = `configuration-browser-${randomUUID().slice(0, 8)}`;
const password = randomBytes(24).toString('hex');
test.beforeAll(async () => {
  await prepareBrowserFixture(pool);
  for (const role of ['admin', 'clinician'] as const)
    await provisionStaff(pool, {
      hospitalCode,
      hospitalName: 'Fictional Configuration Hospital',
      username: role,
      displayName: `Fictional ${role}`,
      role,
      password,
    });
});
test.afterAll(async () => {
  await pool.end();
});
async function signIn(page: Page, username = 'admin', code = hospitalCode) {
  await page.goto('/staff/patients');
  await page.getByLabel('Hospital code', { exact: true }).fill(code);
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page
    .getByRole('link', {
      name: username === 'admin' ? 'Hospital configuration' : 'Service catalog',
      exact: true,
    })
    .click();
}
async function createDepartment(page: Page, code: string, name: string) {
  await page.getByRole('button', { name: 'Departments', exact: true }).click();
  await page.getByRole('button', { name: 'Add department', exact: true }).click();
  await page.getByLabel('Stable code').fill(code);
  await page.getByLabel('Department name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Save configuration', exact: true }).click();
  await expect(
    page.getByText('Configuration saved. Earlier versions remain in history.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back to catalog', exact: true }).click();
}
async function apiCommand(page: Page, data: ConfigurationCommand) {
  const session = await (await page.request.get('/api/auth/session')).json();
  const response = await page.request.post('/api/configuration/commands', {
    headers: {
      Origin: 'http://127.0.0.1:5173',
      'X-CSRF-Token': session.csrfToken,
      'Idempotency-Key': randomUUID(),
    },
    data,
  });
  expect(response.status()).toBe(200);
  return (await response.json()).entry;
}
test('keyboard department and service configuration, immutable prices, retirement and accessible catalog', async ({
  page,
}, info) => {
  await signIn(page);
  await expect(
    page.getByText('No services have been configured yet.', { exact: false }),
  ).toBeVisible();
  await createDepartment(page, 'OPD', 'Fictional Outpatient');
  await page.getByRole('button', { name: 'Services', exact: true }).click();
  await page.getByRole('button', { name: 'Add service', exact: true }).click();
  await page.getByLabel('Stable code').fill('CONSULT');
  await page.getByLabel('Service name', { exact: true }).fill('Fictional Consultation');
  await page
    .getByLabel('Department', { exact: true })
    .selectOption({ label: 'Fictional Outpatient · OPD' });
  await page.getByLabel('Price (ETB)', { exact: true }).fill('1.001');
  await page.getByRole('button', { name: 'Save configuration', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('at most two decimal places');
  await page.getByLabel('Price (ETB)', { exact: true }).fill('123.45');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Save configuration', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Revision 1 · Fictional Consultation')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Edit service' })).toBeFocused();
  await page.getByRole('button', { name: 'Back to catalog', exact: true }).click();
  await expect(
    page
      .getByRole('row', { name: /Fictional Consultation/ })
      .getByRole('cell', { name: '123.45', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page, 'clinician');
  const clinicianRow = page.getByRole('row', { name: /Fictional Consultation/ });
  await expect(clinicianRow.getByRole('cell', { name: '123.45', exact: true })).toBeVisible();
  await expect(clinicianRow.getByRole('button')).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page);
  await page.getByRole('button', { name: 'Fictional Consultation', exact: true }).click();
  await page.getByLabel('Price (ETB)', { exact: true }).fill('0.00');
  await page.getByRole('button', { name: 'Save configuration', exact: true }).click();
  await expect(page.getByText('Revision 2 · Fictional Consultation')).toBeVisible();
  await expect(
    page.getByText('Active · 123.45 ETB · Fictional Outpatient (OPD)', { exact: true }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir('artifacts/staff-ui', { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `artifacts/staff-ui/${info.project.name}-configuration-editor.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Back to catalog', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Hospital configuration', exact: true }),
  ).toBeFocused();
  await expect(
    page
      .getByRole('row', { name: /Fictional Consultation/ })
      .getByRole('cell', { name: '0.00', exact: true }),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `artifacts/staff-ui/${info.project.name}-configuration-catalog.png`,
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Departments', exact: true }).click();
  await page.getByRole('button', { name: 'Fictional Outpatient', exact: true }).click();
  await page.getByLabel('Active department', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Save configuration', exact: true }).click();
  await expect(page.getByText('Revision 2 · Fictional Outpatient')).toBeVisible();
  await page.getByRole('button', { name: 'Back to catalog', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page, 'clinician');
  await expect(
    page.getByText('No services are currently available.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add service', exact: true })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test('load recovery, guarded draft, lost-response idempotency and session-loss clearing', async ({
  page,
}) => {
  await signIn(page);
  let fail = true;
  await page.route(/\/api\/configuration\/departments\?/, async (route) => {
    if (fail)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Catalog temporarily unavailable' }),
      });
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Departments', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
  fail = false;
  await page.getByRole('button', { name: 'Retry catalog' }).click();
  await page.getByRole('button', { name: 'Add department', exact: true }).click();
  await page.getByLabel('Stable code').fill('RETRY');
  await page.getByLabel('Department name', { exact: true }).fill('Fictional Retry');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('link', { name: 'Patient directory', exact: true }).click();
  await expect(page.getByLabel('Department name', { exact: true })).toHaveValue('Fictional Retry');
  let lose = true;
  let body = '';
  let key = '';
  await page.route('**/api/configuration/commands', async (route) => {
    if (lose) {
      lose = false;
      body = route.request().postData()!;
      key = route.request().headers()['idempotency-key'];
      await route.fetch();
      await route.abort('failed');
    } else {
      expect(route.request().postData()).toBe(body);
      expect(route.request().headers()['idempotency-key']).toBe(key);
      await route.continue();
    }
  });
  await page.getByRole('button', { name: 'Save configuration', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry configuration save' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Patient directory', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Department name', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry configuration save' }).click();
  await expect(page.getByText('Revision 1 · Fictional Retry')).toHaveCount(1);
  const {
    rows: [count],
  } = await pool.query(
    'SELECT count(*)::integer AS count FROM hospital_configuration_requests r JOIN hospitals h ON h.id=r.hospital_id WHERE h.code=$1 AND r.idempotency_key=$2',
    [hospitalCode, key],
  );
  expect(count.count).toBe(1);
  await page.getByLabel('Department name', { exact: true }).fill('Unsaved private draft');
  await pool.query(
    'DELETE FROM staff_sessions WHERE user_id IN (SELECT u.id FROM staff_users u JOIN hospitals h ON h.id=u.hospital_id WHERE h.code=$1 AND u.username=$2)',
    [hospitalCode, 'admin'],
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toBeVisible();
  await expect(page.getByLabel('Department name', { exact: true })).toHaveCount(0);
});
test('stale edits preserve draft for explicit revision reload', async ({ page }, info) => {
  await signIn(page);
  await createDepartment(page, 'STALE', 'Fictional Original');
  await page.getByRole('button', { name: 'Fictional Original', exact: true }).click();
  await page.getByLabel('Department name', { exact: true }).fill('Retained draft');
  const session = await (await page.request.get('/api/auth/session')).json();
  const list = await (await page.request.get('/api/configuration/departments?q=STALE')).json();
  const entry = list.entries[0];
  const remote = await page.request.post('/api/configuration/commands', {
    headers: {
      Origin: 'http://127.0.0.1:5173',
      'X-CSRF-Token': session.csrfToken,
      'Idempotency-Key': randomUUID(),
    },
    data: {
      type: 'department.update',
      id: entry.id,
      expectedRevision: entry.revision,
      name: 'Colleague edit',
      active: true,
    },
  });
  expect(remote.status()).toBe(200);
  await page.getByRole('button', { name: 'Save configuration', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('This entry changed');
  await expect(page.getByLabel('Department name', { exact: true })).toHaveValue('Retained draft');
  await page.getByRole('button', { name: 'Reload current revision' }).click();
  await expect(page.getByRole('alert')).toContainText('Your draft is retained');
  await expect(page.getByLabel('Department name', { exact: true })).toHaveValue('Retained draft');
  await expect(
    page.getByRole('region', { name: 'Current values for overlapping edits' }),
  ).toContainText('Name: Colleague edit');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await mkdir('artifacts/staff-ui', { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `artifacts/staff-ui/${info.project.name}-configuration-overlap.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Save configuration', exact: true }).click();
  await expect(page.getByText('Revision 3 · Retained draft')).toBeVisible();
  await expect(page.getByText('Revision 2 · Colleague edit')).toBeVisible();
});

test('price-only draft refreshes concurrent name and department changes on revision reload', async ({
  page,
}) => {
  await signIn(page);
  const first: Department = await apiCommand(page, {
    type: 'department.create',
    code: 'MERGE_A',
    name: 'Fictional first department',
  });
  const second: Department = await apiCommand(page, {
    type: 'department.create',
    code: 'MERGE_B',
    name: 'Fictional second department',
  });
  const svc: Service = await apiCommand(page, {
    type: 'service.create',
    code: 'MERGE',
    name: 'Fictional merge service',
    departmentId: first.id,
    priceMinor: 100,
  });
  await page.getByLabel('Search services by name or code').fill('MERGE');
  await page.getByRole('button', { name: 'Search catalog', exact: true }).click();
  await page.getByRole('button', { name: svc.name, exact: true }).click();
  await page.getByLabel('Price (ETB)', { exact: true }).fill('7.89');
  await apiCommand(page, {
    type: 'service.update',
    id: svc.id,
    expectedRevision: 1,
    name: 'Colleague service name',
    departmentId: second.id,
    active: true,
    priceMinor: 100,
  });
  await page.getByRole('button', { name: 'Save configuration', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('This entry changed');
  await page.getByRole('button', { name: 'Reload current revision' }).click();
  await expect(page.getByRole('alert')).toContainText('Your draft is retained');
  await expect(page.getByLabel('Service name', { exact: true })).toHaveValue(
    'Colleague service name',
  );
  await expect(page.getByLabel('Department', { exact: true })).toHaveValue(second.id);
  await expect(page.getByLabel('Price (ETB)', { exact: true })).toHaveValue('7.89');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Back to catalog', exact: true }).click();
  await expect(page.getByLabel('Price (ETB)', { exact: true })).toHaveValue('7.89');
  await page.getByRole('button', { name: 'Save configuration', exact: true }).click();
  await expect(page.getByText('Revision 3 · Colleague service name')).toBeVisible();
  const current = (await (await page.request.get(`/api/configuration/services/${svc.id}`)).json())
    .entry;
  expect(current).toMatchObject({
    name: 'Colleague service name',
    departmentId: second.id,
    priceMinor: 789,
    revision: 3,
  });
});

test('catalog recovers from an empty second page and history pages show distinct revisions', async ({
  page,
}) => {
  await signIn(page);
  let last!: Department;
  for (let index = 0; index < 26; index++)
    last = await apiCommand(page, {
      type: 'department.create',
      code: `PAGE${String(index).padStart(2, '0')}`,
      name: `Fictional page match ${index}`,
    });
  for (let revision = 1; revision <= 26; revision++)
    last = await apiCommand(page, {
      type: 'department.update',
      id: last.id,
      expectedRevision: revision,
      name: 'Fictional page match 25',
      active: true,
    });
  await page.getByRole('button', { name: 'Departments', exact: true }).click();
  await page.getByLabel('Search departments by name or code').fill('Fictional page match');
  await page.getByRole('button', { name: 'Search catalog', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: last.name, exact: true }).click();
  await page.getByLabel('Department name', { exact: true }).fill('Renamed outside the search');
  await page.getByRole('button', { name: 'Save configuration', exact: true }).click();
  await expect(page.getByText('Revision 28 · Renamed outside the search')).toBeVisible();
  await page.getByRole('button', { name: 'Back to catalog', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: '25 departments · Page 1' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Fictional page match 0', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Search departments by name or code').fill('PAGE25');
  await page.getByRole('button', { name: 'Search catalog', exact: true }).click();
  await page.getByRole('button', { name: 'Renamed outside the search', exact: true }).click();
  const history = page.getByRole('region', { name: 'Configuration history' });
  await expect(history.getByRole('listitem')).toHaveCount(25);
  await expect(
    history.getByText('Revision 28 · Renamed outside the search', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Newer history' })).toBeDisabled();
  await page.getByRole('button', { name: 'Older history' }).click();
  await expect(history.getByRole('listitem')).toHaveCount(3);
  await expect(
    history.getByText('Revision 1 · Fictional page match 25', { exact: true }),
  ).toBeVisible();
  await expect(
    history.getByText('Revision 28 · Renamed outside the search', { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Older history' })).toBeDisabled();
  await page.getByRole('button', { name: 'Newer history' }).click();
  await expect(history.getByRole('listitem')).toHaveCount(25);
  await expect(
    history.getByText('Revision 28 · Renamed outside the search', { exact: true }),
  ).toBeVisible();
  await expect(
    history.getByText('Revision 1 · Fictional page match 25', { exact: true }),
  ).toHaveCount(0);
});

test('active department pages retain selection through search, loading and retry', async ({
  page,
}, info) => {
  const pickerCode = `picker-${randomUUID().slice(0, 8)}`;
  await provisionStaff(pool, {
    hospitalCode: pickerCode,
    hospitalName: 'Fictional Department Picker Hospital',
    username: 'admin',
    displayName: 'Fictional Picker Admin',
    role: 'admin',
    password,
  });
  const {
    rows: [hospital],
  } = await pool.query('SELECT id FROM hospitals WHERE code=$1', [pickerCode]);
  for (let index = 0; index < 25; index++)
    await pool.query(
      'INSERT INTO hospital_departments(id,hospital_id,code,name,active) VALUES($1,$2,$3,$4,false)',
      [randomUUID(), hospital.id, `A${String(index).padStart(2, '0')}`, `Inactive picker ${index}`],
    );
  const ids: string[] = [];
  for (let index = 0; index < 27; index++) {
    const id = randomUUID();
    ids.push(id);
    await pool.query(
      'INSERT INTO hospital_departments(id,hospital_id,code,name) VALUES($1,$2,$3,$4)',
      [
        id,
        hospital.id,
        `Z${String(index).padStart(2, '0')}`,
        `Fictional picker ${String(index).padStart(2, '0')}`,
      ],
    );
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page, 'admin', pickerCode);
  await page.evaluate(() => {
    const calls: { q: string; signal: AbortSignal | null | undefined }[] = [];
    Object.assign(window, { departmentSearchCalls: calls });
    const original = window.fetch.bind(window);
    window.fetch = (input, options) => {
      if (
        typeof input === 'string' &&
        input.startsWith('/api/configuration/departments?active=true')
      )
        calls.push({
          q: new URL(input, location.origin).searchParams.get('q') ?? '',
          signal: options?.signal,
        });
      return original(input, options);
    };
  });
  await page.getByRole('button', { name: 'Add service', exact: true }).click();
  await page.getByLabel('Stable code').fill('PICKER');
  await page.getByLabel('Service name', { exact: true }).fill('Fictional paginated service');
  await page.getByLabel('Price (ETB)', { exact: true }).fill('123.45');
  const picker = page.getByLabel('Department', { exact: true });
  const next = page.getByRole('button', { name: 'Next departments', exact: true });
  const previous = page.getByRole('button', { name: 'Previous departments', exact: true });
  await expect(page.getByRole('status')).toContainText('27 active departments · Page 1 of 2');
  await expect(picker.locator('option')).toHaveCount(26);
  await expect(picker.locator('option', { hasText: 'Inactive picker' })).toHaveCount(0);
  await expect(previous).toBeDisabled();
  await picker.selectOption(ids[0]);
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('Page 2 of 2');
  await expect(picker).toHaveValue(ids[0]);
  await expect(picker.locator('option')).toHaveCount(4);
  await expect(next).toBeDisabled();
  await picker.selectOption(ids[26]);
  await previous.click();
  await expect(page.getByRole('status')).toContainText('Page 1 of 2');
  await expect(picker).toHaveValue(ids[26]);
  await page.getByLabel('Find department', { exact: true }).fill('Missing match');
  await expect(page.getByRole('status')).toContainText('No active departments match this search.');
  await expect(picker).toHaveValue(ids[26]);
  await expect(picker.locator('option')).toHaveCount(2);
  await page.getByLabel('Find department', { exact: true }).fill('Z00');
  await expect(page.getByRole('status')).toContainText('1 active department · Page 1 of 1');
  await expect(picker).toHaveValue(ids[26]);
  let releaseSearch!: () => void;
  const heldSearch = new Promise<void>((resolve) => {
    releaseSearch = resolve;
  });
  await page.route(
    /\/api\/configuration\/departments\?active=true&q=Delayed&page=1$/,
    async (route) => {
      await heldSearch;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ entries: [], total: 0, page: 1, pageSize: 25 }),
      });
    },
  );
  try {
    const started = page.waitForRequest(/q=Delayed/);
    await page.getByLabel('Find department', { exact: true }).fill('Delayed');
    await started;
    await page.getByLabel('Find department', { exact: true }).fill('');
    await page
      .getByLabel('Find department', { exact: true })
      .pressSequentially('Z00', { delay: 20 });
    await expect(page.getByRole('status')).toContainText('1 active department · Page 1 of 1');
    const calls = await page.evaluate(() =>
      (
        window as unknown as { departmentSearchCalls: { q: string; signal: AbortSignal }[] }
      ).departmentSearchCalls.map((call) => ({ q: call.q, aborted: call.signal.aborted })),
    );
    const delayed = calls.findIndex((call) => call.q === 'Delayed');
    expect(calls[delayed].aborted).toBe(true);
    expect(calls.slice(delayed + 1).map((call) => call.q)).toEqual(['Z00']);
    await expect(picker).toHaveValue(ids[26]);
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally {
    releaseSearch();
  }
  await page.getByLabel('Find department', { exact: true }).fill('');
  await expect(page.getByRole('status')).toContainText('27 active departments · Page 1 of 2');
  let releaseLoading!: () => void;
  const loading = new Promise<void>((resolve) => {
    releaseLoading = resolve;
  });
  let fail = true;
  await page.route(/\/api\/configuration\/departments\?active=true.*page=2$/, async (route) => {
    if (fail) {
      await loading;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Department results temporarily unavailable' }),
      });
    } else await route.continue();
  });
  try {
    await next.click();
    await expect(page.getByRole('status')).toContainText('Loading departments');
    await expect(picker).toBeDisabled();
    await expect(picker).toHaveValue(ids[26]);
  } finally {
    releaseLoading();
  }
  await expect(page.getByRole('alert')).toContainText(
    'The workspace is temporarily unavailable. Retry the exact same request.',
  );
  await expect(picker).toHaveValue(ids[26]);
  await expect(page.getByLabel('Service name', { exact: true })).toHaveValue(
    'Fictional paginated service',
  );
  fail = false;
  await page.getByRole('button', { name: 'Retry departments', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Page 2 of 2');
  await expect(picker).toBeEnabled();
  await expect(picker).toHaveValue(ids[26]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir('artifacts/staff-ui', { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `artifacts/staff-ui/${info.project.name}-configuration-picker.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Save configuration', exact: true }).click();
  await expect(page.getByText('Revision 1 · Fictional paginated service')).toBeVisible();
  await expect(
    page.getByText('Active · 123.45 ETB · Fictional picker 26 (Z26)', { exact: true }),
  ).toBeVisible();
  await expect(picker).toHaveValue(ids[26]);
});

test('Amharic catalog keeps protocol routes through history revision reload and write', async ({
  page,
}) => {
  await signIn(page);
  const code = `AM${randomUUID().slice(0, 6).toUpperCase()}`;
  await createDepartment(page, code, 'Fictional Amharic catalog');
  await page.getByLabel('Language', { exact: true }).selectOption('am');
  await expect(page.locator('html')).toHaveAttribute('lang', 'am');
  const read = page.waitForResponse(
    (r) => r.url().includes('/api/configuration/departments?') && r.status() === 200,
  );
  await page.reload();
  await page.getByRole('button', { name: 'ክፍሎች', exact: true }).click();
  await read;
  await page.getByRole('button', { name: 'Fictional Amharic catalog', exact: true }).click();
  await expect(page.getByRole('region', { name: 'የቅንብር ታሪክ' })).toContainText(
    'Fictional Amharic catalog',
  );
  const input = page.locator('#configuration-name');
  await input.fill('Fictional retained Amharic draft');
  const entry = (await (await page.request.get(`/api/configuration/departments?q=${code}`)).json())
    .entries[0];
  await apiCommand(page, {
    type: 'department.update',
    id: entry.id,
    expectedRevision: entry.revision,
    name: 'Fictional colleague revision',
    active: true,
  });
  await page.getByRole('button', { name: 'ቅንብር ያስቀምጡ', exact: true }).click();
  const revision = page.waitForResponse(
    (r) => r.url().endsWith(`/api/configuration/departments/${entry.id}`) && r.status() === 200,
  );
  await page.getByRole('button', { name: 'ወቅታዊ ስሪት እንደገና ይጫኑ', exact: true }).click();
  await revision;
  await expect(input).toHaveValue('Fictional retained Amharic draft');
  await page.getByRole('button', { name: 'ቅንብር ያስቀምጡ', exact: true }).click();
  await expect(page.getByRole('region', { name: 'የቅንብር ታሪክ' })).toContainText(
    'Fictional retained Amharic draft',
  );
});
