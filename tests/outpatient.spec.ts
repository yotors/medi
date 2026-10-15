import { signOut, accountItem } from './account-helpers';
import { test, expect, type Page, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomBytes, randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { mkdir } from 'node:fs/promises';
import { createPool } from '../server/db';
import { prepareBrowserFixture } from './browser-fixture';
import { provisionStaff } from '../server/setup';
import type { VisitCommand, VisitView } from '../shared/outpatient';
import type { StaffRole } from '../shared/registration';
try {
  loadEnvFile('.env');
} catch {
  /* CI supplies environment. */
}
const pool = createPool();
const hospitalCode = `outpatient-${randomUUID().slice(0, 8)}`;
const password = randomBytes(24).toString('hex');
const legacyHospitalCode = `${hospitalCode}-legacy`;
const origin = 'http://127.0.0.1:5173';
const roles: StaffRole[] = [
  'admin',
  'receptionist',
  'clinician',
  'lab',
  'pharmacist',
  'cashier',
  'auditor',
];
test.beforeAll(async ({ request }) => {
  test.setTimeout(120000);
  await prepareBrowserFixture(pool);
  for (const role of roles)
    await provisionStaff(pool, {
      hospitalCode,
      hospitalName: 'Outpatient Fiction Medical Center',
      username: role,
      displayName: `Fictional ${role}`,
      role,
      password,
    });
  await provisionStaff(pool, {
    hospitalCode: legacyHospitalCode,
    hospitalName: 'Fictional legacy compatibility center',
    username: 'admin',
    displayName: 'Fictional admin',
    role: 'admin',
    password,
  });
  const login = await request.post('/api/auth/login', {
    headers: { Origin: origin },
    data: { hospitalCode, username: 'admin', password },
  });
  expect(login.status()).toBe(200);
  const session = await login.json();
  for (const [code, name] of [
    ['CBC', 'Blood count'],
    ['UA', 'Urinalysis'],
    ['GLU', 'Blood glucose'],
  ]) {
    const configured = await request.post('/api/departments/commands', {
      headers: {
        Origin: origin,
        'X-CSRF-Token': session.csrfToken,
        'Idempotency-Key': randomUUID(),
      },
      data: {
        type: 'lab.catalog',
        code,
        name,
        specimen: 'Fictional specimen',
        unit: 'Fictional unit',
      },
    });
    expect(configured.status()).toBe(200);
  }
});
test.beforeEach(async ({ page }) => {
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      ['/api/patients', '/api/visits', '/api/patients/search', '/api/visits/search'].includes(
        url.pathname,
      )
    )
      expect(url.searchParams.has('q')).toBe(false);
    if (['/api/patients/search', '/api/visits/search'].includes(url.pathname)) {
      expect(request.method()).toBe('POST');
      expect(url.search).toBe('');
      expect(request.headers()['x-csrf-token']).toBeTruthy();
      expect(request.headers()['content-type']).toContain('application/json');
      expect(typeof request.postDataJSON().q).toBe('string');
    }
  });
});
test.afterAll(async () => {
  await pool.end();
});
async function activate(control: Locator) {
  await expect(control).toBeEnabled();
  await control.focus();
  await control.press('Enter');
}
async function signIn(page: Page, role: StaffRole = 'admin', code = hospitalCode) {
  await page.goto('/staff/patients');
  await page.getByLabel('Hospital code', { exact: true }).fill(code);
  await page.getByLabel('Username', { exact: true }).fill(role);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await activate(page.getByRole('button', { name: 'Sign in', exact: true }));
  await expect(page.getByRole('heading', { name: 'Patient directory', exact: true })).toBeVisible();
}
async function chooseInvestigation(page: Page, name: string) {
  const select = page.getByLabel('Investigation', { exact: true });
  const option = select.locator('option').filter({ hasText: name });
  await expect(option).toHaveCount(1);
  await select.selectOption({ label: (await option.textContent())!.trim() });
}
async function checkIn(page: Page) {
  const name = `Outpatient Fiction ${randomUUID().slice(0, 8)}`;
  await activate(page.getByRole('button', { name: 'Register patient', exact: true }));
  await page.getByLabel('Full name').fill(name);
  await activate(page.getByRole('button', { name: 'Save patient', exact: true }));
  await activate(
    page
      .getByRole('row')
      .filter({ hasText: name })
      .getByRole('button', { name: /Check in/ }),
  );
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  return name;
}
async function section(page: Page, name: string) {
  await activate(
    page
      .getByRole('navigation', { name: 'Visit sections' })
      .getByRole('button', { name, exact: true }),
  );
}
async function apiSession(page: Page) {
  return (await page.request.get('/api/auth/session')).json();
}
async function currentVisit(page: Page, name: string) {
  const data = await (
    await page.request.post('/api/visits/search', {
      headers: {
        Origin: 'http://127.0.0.1:5173',
        'X-CSRF-Token': (await (await page.request.get('/api/auth/session')).json()).csrfToken,
      },
      data: { q: name },
    })
  ).json();
  return (await page.request.get(`/api/visits/${data.visits[0].id}`)).json();
}

async function releaseConfiguredSpecimen(page: Page, name: string, value: string) {
  await expect(
    page.getByRole('article', { name: 'Blood count investigation', exact: true }),
  ).toBeVisible();
  const { visit } = await currentVisit(page, name),
    order = visit.orders!.find((order: any) => order.test === 'Blood count');
  expect(order.catalogId).toBeTruthy();
  const session = await apiSession(page),
    {
      rows: [clinician],
    } = await pool.query(
      "SELECT id FROM staff_users WHERE hospital_id=$1 AND role='clinician' AND active ORDER BY id LIMIT 1",
      [session.user.hospital.id],
    );
  const post = async (data: object) => {
    const response = await page.request.post('/api/departments/commands', {
      headers: {
        Origin: origin,
        'X-CSRF-Token': session.csrfToken,
        'Idempotency-Key': randomUUID(),
      },
      data,
    });
    expect(response.status()).toBe(200);
    return response.json();
  };
  let specimen = await post({
    type: 'lab.register',
    catalogId: order.catalogId,
    visitId: visit.id,
    orderId: order.id,
    accession: `Fictional-${randomUUID()}`,
    clinicianId: clinician.id,
  });
  for (const type of ['lab.collect', 'lab.receive', 'lab.result', 'lab.release'])
    specimen = await post({
      type,
      id: specimen.id,
      expectedRevision: specimen.revision,
      ...(type === 'lab.result' ? { value, critical: false } : {}),
    });
  await page.getByRole('button', { name: 'Refresh visit', exact: true }).click();
  await expect(
    page.getByRole('article', { name: 'Blood count investigation', exact: true }),
  ).toContainText(value);
}

test('keyboard admin journey persists a closed visit, with accessible desktop and mobile views', async ({
  page,
}, info) => {
  await signIn(page);
  const name = await checkIn(page);
  await expect(page.getByRole('button', { name: 'Close visit', exact: true })).toBeDisabled();
  await expect(page.getByRole('heading', { name, exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Refresh visit', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Back to visit queue', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Refresh visit', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(
    page
      .getByRole('navigation', { name: 'Visit sections' })
      .getByRole('button', { name: 'Consultation', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Investigation', { exact: true })).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  for (const label of ['Diagnostics', 'Pharmacy', 'Billing', 'History']) {
    await page.keyboard.press('Tab');
    await expect(
      page
        .getByRole('navigation', { name: 'Visit sections' })
        .getByRole('button', { name: label, exact: true }),
    ).toBeFocused();
  }
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Consultation note', { exact: true })).toBeFocused();
  await page
    .getByLabel('Consultation note', { exact: true })
    .fill('Synthetic consultation for the connected journey.');
  await page.getByLabel('Consultation note', { exact: true }).press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Consultation note', { exact: true })).toHaveValue('');
  await expect(
    page.getByText('Synthetic consultation for the connected journey.', { exact: true }),
  ).toBeVisible();
  await section(page, 'Diagnostics');
  await chooseInvestigation(page, 'Blood count');
  await page.getByRole('button', { name: 'Request investigation', exact: true }).focus();
  await page.keyboard.press('Enter');
  await releaseConfiguredSpecimen(page, name, 'Fictional released result.');
  await activate(page.getByRole('button', { name: 'Mark reviewed', exact: true }));
  await expect(page.getByText('reviewed', { exact: true })).toBeVisible();
  await section(page, 'Pharmacy');
  await page
    .getByLabel('Prescription instructions')
    .fill('Synthetic medicine instructions for demonstration.');
  await activate(page.getByRole('button', { name: 'Add prescription', exact: true }));
  await activate(page.getByRole('button', { name: 'Complete unlinked handoff 1', exact: true }));
  await expect(page.getByText('fulfilled', { exact: true })).toBeVisible();
  await section(page, 'Billing');
  await expect(
    page
      .getByRole('region', { name: 'Visit billing' })
      .getByText('Not yet billed', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close visit', exact: true })).toBeEnabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await mkdir('artifacts/outpatient-ui', { recursive: true });
  await page.getByRole('heading', { name, exact: true }).focus();
  await page.screenshot({
    path: `artifacts/outpatient-ui/${info.project.name}-visit.png`,
    fullPage: true,
  });
  await activate(page.getByRole('button', { name: 'Close visit', exact: true }));
  await expect(
    page.getByText(
      'Clinical visit closed. Original clinical records remain unchanged; corrections and billing remain available.',
    ),
  ).toBeVisible();
  await page.reload();
  await activate(
    page
      .getByRole('navigation', { name: 'Staff workspace' })
      .getByRole('link', { name: 'Outpatient visits', exact: true }),
  );
  await page.getByLabel('Visit status', { exact: true }).selectOption('closed');
  await activate(page.getByRole('button', { name, exact: true }));
  await expect(
    page.getByText(
      'Clinical visit closed. Original clinical records remain unchanged; corrections and billing remain available.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save note', exact: true })).toHaveCount(0);
  await section(page, 'History');
  await expect(page.getByText('Closed visit.', { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('heading', { name, exact: true }).focus();
  await page.screenshot({
    path: `artifacts/outpatient-ui/${info.project.name}-closed-history.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
});

test('lost check-in and note responses retain one request and block navigation', async ({
  page,
}) => {
  await signIn(page);
  let loseCheckIn = true;
  await page.route('**/api/patients/*/visits', async (route) => {
    const response = await route.fetch();
    if (loseCheckIn) {
      loseCheckIn = false;
      expect(response.ok()).toBe(true);
      await route.abort('failed');
    } else await route.fulfill({ response });
  });
  const name = `Retry visit fiction ${randomUUID().slice(0, 8)}`;
  await page.getByRole('button', { name: 'Register patient', exact: true }).click();
  await page.getByLabel('Full name').fill(name);
  await page.getByRole('button', { name: 'Save patient', exact: true }).click();
  await page
    .getByRole('row')
    .filter({ hasText: name })
    .getByRole('button', { name: /Check in/ })
    .click();
  await page.getByRole('button', { name: 'Retry visit save', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  const initial = await currentVisit(page, name);
  const requests: { body: string; key: string | undefined }[] = [];
  let lose = true;
  await page.route('**/api/visits/*/commands', async (route) => {
    requests.push({
      body: route.request().postData()!,
      key: route.request().headers()['idempotency-key'],
    });
    const response = await route.fetch();
    if (lose) {
      lose = false;
      expect(response.ok()).toBe(true);
      await route.abort('failed');
    } else await route.fulfill({ response });
  });
  await page
    .getByLabel('Consultation note', { exact: true })
    .fill('One durable note despite a lost response.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry visit save', exact: true })).toBeVisible();
  await expect(page.getByLabel('Consultation note', { exact: true })).toHaveValue(
    'One durable note despite a lost response.',
  );
  await expect(page.getByLabel('Consultation note', { exact: true })).toBeDisabled();
  await expect(await accountItem(page, 'Sign out')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Back to visit queue', exact: true }),
  ).toBeDisabled();
  await page.getByRole('link', { name: 'Inside the workspace' }).click();
  await expect(page).toHaveURL(/\/staff\/visits$/);
  await page.getByRole('button', { name: 'Retry visit save', exact: true }).click();
  await expect(page.getByLabel('Consultation note', { exact: true })).toHaveValue('');
  expect(requests[0]).toEqual(requests[1]);
  const final = await currentVisit(page, name);
  expect(final.visit.id).toBe(initial.visit.id);
  expect(final.visit.notes).toHaveLength(1);
  expect(final.visit.financialMode).toBe('catalog');
  expect(final.visit.history).toHaveLength(2);
});

test('stale revision refresh preserves the typed draft and session change clears clinical state', async ({
  page,
}) => {
  await signIn(page);
  const name = await checkIn(page);
  await page
    .getByLabel('Consultation note', { exact: true })
    .fill('Draft survives a concurrent update.');
  const { visit } = await currentVisit(page, name);
  const session = await apiSession(page);
  const response = await page.request.post(`/api/visits/${visit.id}/commands`, {
    headers: { Origin: origin, 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': randomUUID() },
    data: {
      expectedRevision: visit.revision,
      command: { type: 'note', body: 'A colleague saved this first.' },
    },
  });
  expect(response.ok()).toBe(true);
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByText(/The visit changed. Your draft is still here/)).toBeVisible();
  await expect(page.getByLabel('Consultation note', { exact: true })).toHaveValue(
    'Draft survives a concurrent update.',
  );
  await expect(page.getByText('A colleague saved this first.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByLabel('Consultation note', { exact: true })).toHaveValue('');
  expect((await currentVisit(page, name)).visit.notes).toHaveLength(2);
  await page
    .getByLabel('Consultation note', { exact: true })
    .fill('Clear this confidential draft on sign-out.');
  await page.evaluate(() => {
    const channel = new BroadcastChannel('hospital-staff-session');
    channel.postMessage('logout');
    channel.close();
  });
  await expect(page.getByRole('heading', { name: 'Staff sign-in', exact: true })).toBeVisible();
  await expect(page.getByLabel('Consultation note', { exact: true })).toHaveCount(0);
  await expect(page.getByText('A colleague saved this first.', { exact: true })).toHaveCount(0);
});

test('department handoffs complete a visit with permitted API sections and private queue rows', async ({
  page,
}) => {
  await signIn(page);
  const name = await checkIn(page);
  await page
    .getByLabel('Consultation note', { exact: true })
    .fill('Private synthetic consultation text.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByLabel('Consultation note', { exact: true })).toHaveValue('');
  const { visit } = await currentVisit(page, name);
  const allowed: Record<StaffRole, string[]> = {
    admin: ['notes', 'orders', 'prescriptions', 'history'],
    receptionist: [],
    clinician: ['notes', 'orders', 'prescriptions'],
    lab: ['orders'],
    pharmacist: ['prescriptions'],
    cashier: [],
    auditor: ['history'],
    nurse: ['notes'],
  };
  for (const role of roles.filter((role) => role !== 'admin')) {
    if (role === 'auditor') {
      await signOut(page);
      await signIn(page, 'clinician');
      await page
        .getByRole('navigation', { name: 'Staff workspace' })
        .getByRole('link', { name: 'Outpatient visits', exact: true })
        .click();
      await page.getByRole('button', { name, exact: true }).click();
      await section(page, 'Diagnostics');
      await page.getByRole('button', { name: 'Mark reviewed', exact: true }).click();
      await page.getByRole('button', { name: 'Close visit', exact: true }).click();
      await expect(
        page.getByText(
          'Clinical visit closed. Original clinical records remain unchanged; corrections and billing remain available.',
        ),
      ).toBeVisible();
    }
    await signOut(page);
    await signIn(page, role);
    const body = await (await page.request.get(`/api/visits/${visit.id}`)).json();
    for (const field of allowed.admin)
      expect(Object.hasOwn(body.visit, field), `${role}: ${field}`).toBe(
        allowed[role].includes(field),
      );
    const queue = await (await page.request.get('/api/visits?status=all')).json();
    for (const field of allowed.admin) expect(Object.hasOwn(queue.visits[0], field)).toBe(false);
    expect(JSON.stringify(queue)).not.toContain('Private synthetic consultation text.');
    await page
      .getByRole('navigation', { name: 'Staff workspace' })
      .getByRole('link', { name: 'Outpatient visits', exact: true })
      .click();
    await page.getByLabel('Visit status', { exact: true }).selectOption('all');
    await page.getByRole('button', { name, exact: true }).click();
    if (role === 'receptionist')
      await expect(page.getByRole('navigation', { name: 'Visit sections' })).toHaveCount(0);
    else
      await expect(
        page.getByRole('navigation', { name: 'Visit sections' }).getByRole('button'),
      ).toHaveCount(body.visit.sections.length);
    if (role === 'clinician') {
      await section(page, 'Diagnostics');
      await chooseInvestigation(page, 'Blood count');
      await page.getByRole('button', { name: 'Request investigation', exact: true }).click();
      await expect(page.getByText('requested', { exact: true })).toBeVisible();
      await section(page, 'Pharmacy');
      await page.getByLabel('Prescription instructions').fill('Fictional handoff prescription.');
      await page.getByRole('button', { name: 'Add prescription', exact: true }).click();
      await expect(page.getByLabel('Prescription instructions')).toHaveValue('');
      await expect(
        page.getByText('Fictional handoff prescription.', { exact: true }),
      ).toBeVisible();
    } else if (role === 'lab') {
      await releaseConfiguredSpecimen(page, name, 'Fictional handoff result.');
      await expect(page.getByText('released', { exact: true })).toBeVisible();
    } else if (role === 'pharmacist') {
      await page.getByRole('button', { name: 'Complete unlinked handoff 1', exact: true }).click();
      await expect(page.getByText('fulfilled', { exact: true })).toBeVisible();
    } else if (role === 'cashier') {
      await expect(
        page
          .getByRole('region', { name: 'Visit billing' })
          .getByText('Not yet billed', { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Prepare invoice', exact: true }),
      ).toBeEnabled();
    } else if (role === 'auditor') {
      await section(page, 'History');
      await expect(page.getByText('Closed visit.', { exact: true })).toBeVisible();
    }
  }
});

async function seedVisit(page: Page, name: string): Promise<VisitView> {
  const session = await apiSession(page);
  const headers = {
    Origin: origin,
    'X-CSRF-Token': session.csrfToken,
    'Idempotency-Key': randomUUID(),
  };
  const registered = await page.request.post('/api/patients', {
    headers,
    data: { name, contact: '' },
  });
  expect(registered.ok()).toBe(true);
  const { patient } = await registered.json();
  const checkedIn = await page.request.post(`/api/patients/${patient.id}/visits`, {
    headers: { ...headers, 'Idempotency-Key': randomUUID() },
    data: {},
  });
  expect(checkedIn.ok()).toBe(true);
  return (await checkedIn.json()).visit;
}
async function externalCommand(
  page: Page,
  visit: VisitView,
  command: VisitCommand,
): Promise<VisitView> {
  const session = await apiSession(page);
  const response = await page.request.post(`/api/visits/${visit.id}/commands`, {
    headers: { Origin: origin, 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': randomUUID() },
    data: { expectedRevision: visit.revision, command },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).visit;
}

test('late detail responses cannot reopen an abandoned visit or replace another patient draft', async ({
  page,
}) => {
  await signIn(page);
  const firstName = await checkIn(page);
  const { visit: first } = await currentVisit(page, firstName);
  const second = await seedVisit(page, `Second patient ${randomUUID().slice(0, 8)}`);
  let release!: () => void;
  let intercepted!: () => void;
  let gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let waiting = new Promise<void>((resolve) => {
    intercepted = resolve;
  });
  await page.route(`**/api/visits/${first.id}`, async (route) => {
    const response = await route.fetch();
    intercepted();
    await gate;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Refresh visit', exact: true }).click();
  await waiting;
  await page.getByRole('button', { name: 'Back to visit queue', exact: true }).click();
  await page.getByRole('button', { name: second.patient.name, exact: true }).click();
  await page
    .getByLabel('Consultation note', { exact: true })
    .fill('Draft belongs to the second patient only.');
  const lateRefresh = page.waitForResponse((response) =>
    response.url().endsWith(`/api/visits/${first.id}`),
  );
  release();
  await (await lateRefresh).finished();
  await page.unrouteAll({ behavior: 'wait' });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await expect(page.getByRole('heading', { name: second.patient.name, exact: true })).toBeVisible();
  await expect(page.getByLabel('Consultation note', { exact: true })).toHaveValue(
    'Draft belongs to the second patient only.',
  );
  await page.getByRole('button', { name: 'Discard unsaved drafts', exact: true }).click();
  await page.getByRole('button', { name: 'Back to visit queue', exact: true }).click();
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  waiting = new Promise<void>((resolve) => {
    intercepted = resolve;
  });
  await page.route(`**/api/visits/${first.id}`, async (route) => {
    const response = await route.fetch();
    intercepted();
    await gate;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: firstName, exact: true }).click();
  await waiting;
  await page.getByRole('button', { name: 'Cancel opening visit', exact: true }).click();
  const lateOpen = page.waitForResponse((response) =>
    response.url().endsWith(`/api/visits/${first.id}`),
  );
  release();
  await (await lateOpen).finished();
  await page.unrouteAll({ behavior: 'wait' });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await expect(page.getByRole('heading', { name: 'Outpatient visits', exact: true })).toBeVisible();
  await expect(page.getByLabel('Consultation note', { exact: true })).toHaveCount(0);
});

test('non-stale rejections explain the failure and an active-visit conflict leaves the queue usable', async ({
  page,
}) => {
  await signIn(page);
  const name = await checkIn(page);
  await page
    .getByRole('navigation', { name: 'Staff workspace' })
    .getByRole('link', { name: 'Patient directory', exact: true })
    .click();
  await page
    .getByRole('row')
    .filter({ hasText: name })
    .getByRole('button', { name: /Check in/ })
    .click();
  await expect(page.getByRole('alert')).toContainText('already has an active visit');
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByLabel('Consultation note', { exact: true }).fill('Keep this rejected draft.');
  await page.route('**/api/visits/*/commands', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'TRANSITION_BLOCKED',
        message: 'This transition is blocked by the current investigation status.',
      }),
    }),
  );
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('This transition is blocked');
  await expect(page.getByText(/The visit changed. Your draft is still here/)).toHaveCount(0);
  await expect(page.getByLabel('Consultation note', { exact: true })).toHaveValue(
    'Keep this rejected draft.',
  );
  await expect(page.getByRole('button', { name: 'Save note', exact: true })).toBeEnabled();
});

test('refresh preserves drafts and conflicting result drafts stay copyable until explicit discard', async ({
  page,
}) => {
  await signIn(page, 'admin', legacyHospitalCode);
  const name = await checkIn(page);
  await page.getByLabel('Consultation note', { exact: true }).fill('Unsaved consultation draft.');
  await section(page, 'Pharmacy');
  await page.getByLabel('Prescription instructions').fill('Unsaved prescription draft.');
  await section(page, 'Diagnostics');
  await externalCommand(page, (await currentVisit(page, name)).visit, {
    type: 'order',
    test: 'Blood count',
  });
  await page.getByRole('button', { name: 'Refresh visit', exact: true }).click();
  const blood = page.getByRole('article', { name: 'Blood count investigation' });
  await blood.getByRole('button', { name: 'Mark collected', exact: true }).click();
  await page.getByLabel('Blood count result', { exact: true }).fill('Unsaved blood draft.');
  await externalCommand(page, (await currentVisit(page, name)).visit, {
    type: 'order',
    test: 'Urinalysis',
  });
  await page.getByRole('button', { name: 'Refresh visit', exact: true }).click();
  const urine = page.getByRole('article', { name: 'Urinalysis investigation' });
  await urine.getByRole('button', { name: 'Mark collected', exact: true }).click();
  await page.getByLabel('Urinalysis result', { exact: true }).fill('Unsaved urine draft.');
  await page.getByRole('button', { name: 'Refresh visit', exact: true }).click();
  await expect(page.getByLabel('Blood count result', { exact: true })).toHaveValue(
    'Unsaved blood draft.',
  );
  await expect(page.getByLabel('Urinalysis result', { exact: true })).toBeEnabled();
  let { visit } = await currentVisit(page, name);
  visit = await externalCommand(page, visit, {
    type: 'advanceOrder',
    orderId: visit.orders.find((order: { test: string }) => order.test === 'Blood count').id,
    next: 'released',
    result: 'Colleague released this result.',
  });
  await externalCommand(page, visit, {
    type: 'advanceOrder',
    orderId: visit.orders!.find((order: { test: string }) => order.test === 'Urinalysis')!.id,
    next: 'cancelled',
  });
  await blood.getByRole('button', { name: 'Release result', exact: true }).click();
  const preservedBlood = page.getByLabel('Unsaved Blood count result draft', { exact: true });
  await expect(preservedBlood).toHaveValue('Unsaved blood draft.');
  await expect(preservedBlood).toHaveAttribute('readonly', '');
  await expect(page.getByLabel('Unsaved Urinalysis result draft', { exact: true })).toHaveValue(
    'Unsaved urine draft.',
  );
  await preservedBlood.focus();
  expect(
    await preservedBlood.evaluate(
      (element: HTMLTextAreaElement) =>
        element.selectionStart === 0 && element.selectionEnd === element.value.length,
    ),
  ).toBe(true);
  await section(page, 'Consultation');
  await expect(page.getByLabel('Consultation note', { exact: true })).toHaveValue(
    'Unsaved consultation draft.',
  );
  await section(page, 'Pharmacy');
  await expect(page.getByLabel('Prescription instructions')).toHaveValue(
    'Unsaved prescription draft.',
  );
  for (const control of [
    page.getByRole('button', { name: 'Back to visit queue', exact: true }),
    page
      .getByRole('navigation', { name: 'Staff workspace' })
      .getByRole('link', { name: 'Patient directory', exact: true }),
    page.getByRole('link', { name: 'Inside the workspace' }),
  ]) {
    page.once('dialog', (dialog) => dialog.dismiss());
    await control.click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  page.once('dialog', (dialog) => dialog.dismiss());
  await signOut(page);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Discard result draft', exact: true }).first().click();
  await expect(preservedBlood).toHaveCount(0);
  await expect(page.getByLabel('Unsaved Urinalysis result draft', { exact: true })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page
    .getByRole('navigation', { name: 'Staff workspace' })
    .getByRole('link', { name: 'Patient directory', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Staff workspace' })
    .getByRole('link', { name: 'Outpatient visits', exact: true })
    .click();
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page.getByLabel('Consultation note', { exact: true })).toHaveValue('');
  await expect(page.getByRole('region', { name: 'Preserved unsaved drafts' })).toHaveCount(0);
  await section(page, 'Pharmacy');
  await expect(page.getByLabel('Prescription instructions')).toHaveValue('');
});

test('visit pagination changes rows and search and status reset the second page', async ({
  page,
}) => {
  test.setTimeout(90000);
  const bodies: object[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/visits/search')
      bodies.push(request.postDataJSON());
  });
  await signIn(page);
  const prefix = `Queue pagination ${randomUUID().slice(0, 8)}`;
  for (let index = 0; index < 26; index++)
    await seedVisit(page, `${prefix} ${String(index).padStart(2, '0')}`);
  await page
    .getByRole('navigation', { name: 'Staff workspace' })
    .getByRole('link', { name: 'Outpatient visits', exact: true })
    .click();
  await page.getByLabel('Search visits by patient or record number').fill(prefix);
  await page.getByRole('button', { name: 'Search visits', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: '26 visits · Page 1 of 2' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await expect(page.getByRole('button', { name: `${prefix} 25`, exact: true })).toBeVisible();
  await activate(page.getByRole('button', { name: 'Next visits', exact: true }));
  await expect(page.getByRole('status').filter({ hasText: 'Page 2 of 2' })).toBeVisible();
  await expect(page.getByRole('button', { name: `${prefix} 00`, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: `${prefix} 25`, exact: true })).toHaveCount(0);
  await activate(page.getByRole('button', { name: 'Previous visits', exact: true }));
  await expect(page.getByRole('button', { name: `${prefix} 25`, exact: true })).toBeVisible();
  await activate(page.getByRole('button', { name: 'Next visits', exact: true }));
  await page.getByLabel('Visit status', { exact: true }).selectOption('all');
  await expect(page.getByRole('status').filter({ hasText: 'Page 1 of 2' })).toBeVisible();
  await activate(page.getByRole('button', { name: 'Next visits', exact: true }));
  await page.getByLabel('Search visits by patient or record number').fill(`${prefix} 25`);
  await page.getByRole('button', { name: 'Search visits', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: '1 visits · Page 1 of 1' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: `${prefix} 25`, exact: true })).toBeVisible();
  expect(bodies).toContainEqual({ q: prefix, status: 'active', assigned: 'all', page: 2 });
  expect(bodies).toContainEqual({ q: prefix, status: 'all', assigned: 'all', page: 1 });
  expect(bodies.at(-1)).toEqual({ q: `${prefix} 25`, status: 'all', assigned: 'all', page: 1 });
});

test('delayed private queue search respects changed filters and logout', async ({ page }) => {
  await signIn(page);
  const name = await checkIn(page);
  await activate(page.getByRole('button', { name: 'Back to visit queue', exact: true }));
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  let release!: () => void;
  let intercepted!: () => void;
  let gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let received = new Promise<void>((resolve) => {
    intercepted = resolve;
  });
  await page.route('**/api/visits/search', async (route) => {
    const input = route.request().postDataJSON();
    if (input.q !== name || input.status !== 'active') return route.continue();
    const response = await route.fetch();
    intercepted();
    await gate;
    await route.fulfill({ response });
  });
  await page.getByLabel('Search visits by patient or record number').fill(name);
  await activate(page.getByRole('button', { name: 'Search visits', exact: true }));
  await received;
  await page.getByLabel('Visit status', { exact: true }).selectOption('closed');
  await expect(page.getByRole('heading', { name: 'No matching visits' })).toBeVisible();
  const late = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/visits/search') &&
      response.request().postDataJSON().status === 'active',
  );
  release();
  await late;
  await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  received = new Promise<void>((resolve) => {
    intercepted = resolve;
  });
  await page.getByLabel('Visit status', { exact: true }).selectOption('active');
  await received;
  await activate(await accountItem(page, 'Sign out'));
  const loggedOutResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/visits/search'),
  );
  release();
  await loggedOutResponse;
  await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toBeVisible();
  expect(
    await page.evaluate(
      (value) =>
        [location.href, JSON.stringify(localStorage), JSON.stringify(sessionStorage)].some((text) =>
          text.includes(value),
        ),
      name,
    ),
  ).toBe(false);
});

test('private queue name contact and MRN stay in exact bodies while authenticated', async ({
  page,
}) => {
  await signIn(page);
  const marker = `Private${randomUUID().replaceAll('-', '')}`;
  const session = await apiSession(page);
  const headers = {
    Origin: origin,
    'X-CSRF-Token': session.csrfToken,
    'Idempotency-Key': randomUUID(),
  };
  const patient = (
    await (
      await page.request.post('/api/patients', {
        headers,
        data: { name: `${marker} Name`, contact: `${marker} Contact` },
      })
    ).json()
  ).patient;
  expect(
    (
      await page.request.post(`/api/patients/${patient.id}/visits`, {
        headers: { ...headers, 'Idempotency-Key': randomUUID() },
        data: {},
      })
    ).status(),
  ).toBe(201);
  await page
    .getByRole('navigation', { name: 'Staff workspace' })
    .getByRole('link', { name: 'Outpatient visits', exact: true })
    .click();
  const urls: string[] = [];
  page.on('request', (request) => urls.push(decodeURIComponent(request.url())));
  for (const q of [patient.name, patient.contact, patient.recordNumber]) {
    const sent = page.waitForRequest(
      (request) => new URL(request.url()).pathname === '/api/visits/search',
    );
    await page.getByLabel('Search visits by patient or record number').fill(q);
    await activate(page.getByRole('button', { name: 'Search visits', exact: true }));
    const request = await sent;
    expect(request.postDataJSON()).toEqual({ q, page: 1, status: 'active', assigned: 'all' });
    expect(request.method()).toBe('POST');
    expect(new URL(request.url()).search).toBe('');
    await expect(page.getByRole('button', { name: patient.name, exact: true })).toBeVisible();
    expect(
      urls.some((url) => [marker, patient.recordNumber].some((term) => url.includes(term))),
    ).toBe(false);
    expect(
      await page.evaluate(
        (terms) =>
          [location.href, JSON.stringify(localStorage), JSON.stringify(sessionStorage)].some(
            (value) => terms.some((term) => value.includes(term)),
          ),
        [marker, patient.recordNumber],
      ),
    ).toBe(false);
  }
});
