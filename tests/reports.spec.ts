import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomBytes, randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { mkdir } from 'node:fs/promises';
import { createPool } from '../server/db';
import { digest } from '../server/auth';
import { provisionStaff } from '../server/setup';
import { prepareBrowserFixture } from './browser-fixture';
try {
  loadEnvFile('.env');
} catch {
  /* CI supplies the environment. */
}
const pool = createPool(),
  hospitalCode = `reports-${randomUUID().slice(0, 8)}`,
  emptyCode = `empty-${randomUUID().slice(0, 8)}`,
  password = randomBytes(24).toString('hex');
const roles = [
  'admin',
  'auditor',
  'clinician',
  'cashier',
  'pharmacist',
  'lab',
  'receptionist',
] as const;
test.beforeAll(async () => {
  test.setTimeout(120000);
  await prepareBrowserFixture(pool);
  for (const role of roles)
    await provisionStaff(pool, {
      hospitalCode,
      hospitalName: 'Fictional Report Center',
      username: role,
      displayName: `Fictional ${role}`,
      role,
      password,
    });
  await provisionStaff(pool, {
    hospitalCode: emptyCode,
    hospitalName: 'Fictional Empty Center',
    username: 'admin',
    displayName: 'Fictional admin',
    role: 'admin',
    password,
  });
});
test.beforeEach(async () => {
  await pool.query('DELETE FROM login_buckets WHERE bucket_hash=ANY($1::text[])', [
    [
      ...roles.map((role) => digest(`account:${hospitalCode}:${role}`)),
      digest(`account:${emptyCode}:admin`),
      digest('ip:127.0.0.1'),
    ],
  ]);
});
test.afterAll(async () => {
  await pool.end();
});
async function signIn(page: Page, role = 'admin', hospital = hospitalCode) {
  await page.goto('/staff/patients');
  await page.getByLabel('Hospital code', { exact: true }).fill(hospital);
  await page.getByLabel('Username', { exact: true }).fill(role);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Patient directory', exact: true })).toBeVisible();
}
async function open(page: Page) {
  await page.getByRole('link', { name: 'Operational reports', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Operational reports', exact: true }),
  ).toBeFocused();
}
async function run(page: Page) {
  await page.getByRole('button', { name: 'Run report', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Report for / })).toBeVisible();
}
async function post(page: Page, path: string, data: object) {
  const session = await (await page.request.get('/api/auth/session')).json();
  const response = await page.request.post(path, {
    headers: {
      Origin: 'http://127.0.0.1:5173',
      'X-CSRF-Token': session.csrfToken,
      'Idempotency-Key': randomUUID(),
    },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function capture(page: Page, name: string) {
  await mkdir('artifacts/reports-ui', { recursive: true });
  await page
    .getByRole('heading', { level: 1 })
    .evaluate((element) => (element as HTMLElement).focus({ preventScroll: true }));
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await page.screenshot({ path: `artifacts/reports-ui/${name}.png`, fullPage: true });
}

test('combined report uses keyboard, exact amounts, accessible tables and inventory pagination', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await signIn(page);
  const prefix = randomUUID().slice(0, 5).toUpperCase();
  let first = '';
  for (let i = 0; i < 26; i++) {
    const p = await post(page, '/api/inventory/commands', {
      type: 'product.create',
      code: `${prefix}${String(i).padStart(2, '0')}`,
      name: `Fictional report item ${i}`,
      unit: i % 2 ? 'vial' : 'tablet',
    });
    if (!i) first = p.productId;
  }
  const b = await post(page, '/api/inventory/commands', {
    type: 'batch.create',
    productId: first,
    lot: 'REPORT',
    expiry: '2099-12-31',
  });
  await post(page, '/api/inventory/commands', {
    type: 'stock.receive',
    batchId: b.batchId,
    expectedRevision: 1,
    quantity: 10,
    reference: 'Fictional receipt',
  });
  const p = (
    await post(page, '/api/patients', { name: 'Private fictional report patient', contact: '' })
  ).patient;
  const v = (await post(page, `/api/patients/${p.id}/visits`, {})).visit;
  const dep = (
    await post(page, '/api/configuration/commands', {
      type: 'department.create',
      code: `D${prefix}`,
      name: 'Fictional department',
    })
  ).entry;
  const service = (
    await post(page, '/api/configuration/commands', {
      type: 'service.create',
      departmentId: dep.id,
      code: `S${prefix}`,
      name: 'Fictional service',
      priceMinor: 12345,
    })
  ).entry;
  const invoice = await post(page, `/api/visits/${v.id}/billing/commands`, {
    type: 'invoice.issue',
    lines: [{ serviceId: service.id, serviceRevision: 1, quantity: 1 }],
  });
  await post(page, `/api/visits/${v.id}/billing/commands`, {
    type: 'payment.record',
    invoiceId: invoice.invoiceId,
    expectedRevision: 1,
    amountMinor: 12345,
    method: 'cash',
  });
  await post(page, '/api/inventory/commands', {
    type: 'stock.adjust',
    batchId: b.batchId,
    expectedRevision: 2,
    quantity: -2,
    reason: 'Fictional adjustment',
  });
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Addis_Ababa',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  for (const [lot, expiry, quantity, quarantined] of [
    ['EXPIRED', '2001-01-01', 3, false],
    ['TODAY', day, 4, false],
    ['QUARANTINED', '2099-12-31', 5, true],
  ] as const) {
    const batch = await post(page, '/api/inventory/commands', {
      type: 'batch.create',
      productId: first,
      lot,
      expiry,
    });
    await post(page, '/api/inventory/commands', {
      type: 'stock.receive',
      batchId: batch.batchId,
      expectedRevision: 1,
      quantity,
      reference: 'Fictional category receipt',
    });
    if (quarantined)
      await post(page, '/api/inventory/commands', {
        type: 'batch.status',
        batchId: batch.batchId,
        expectedRevision: 2,
        quarantined: true,
        reason: 'Fictional quarantine',
      });
  }
  const prescribed = (
    await post(page, `/api/visits/${v.id}/commands`, {
      expectedRevision: v.revision,
      command: { type: 'prescribe', instruction: 'Fictional report supply' },
    })
  ).visit;
  const authorized = await post(page, `/api/visits/${v.id}/inventory/commands`, {
    type: 'authorize',
    prescriptionId: prescribed.prescriptions[0].id,
    expectedVisitRevision: prescribed.revision,
    productId: first,
    quantity: 4,
  });
  await post(page, `/api/visits/${v.id}/inventory/commands`, {
    type: 'dispense',
    prescriptionId: prescribed.prescriptions[0].id,
    expectedVisitRevision: authorized.visitRevision,
    batchId: b.batchId,
    expectedBatchRevision: 3,
    quantity: 2,
  });
  await open(page);
  await page.getByRole('button', { name: 'Run report', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Visit operations', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recorded payments', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Product stock', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Receipts by payment method' })).toContainText(
    '123.45 ETB',
  );
  await expect(page.getByText('Private fictional report patient', { exact: true })).toHaveCount(0);
  const stockRow = page
    .getByRole('region', { name: 'Current product stock', exact: true })
    .getByRole('row')
    .filter({ hasText: 'Fictional report item 0' });
  await expect(stockRow.getByRole('cell')).toHaveText(['18', '6', '0', '5', '3', '4']);
  await expect(stockRow.getByRole('rowheader')).toContainText('tablet');
  const movementRow = page
    .getByRole('region', { name: 'Period stock movements', exact: true })
    .getByRole('row')
    .filter({ hasText: 'Fictional report item 0' });
  await expect(movementRow.getByRole('cell')).toHaveText(['22', '2', '-2', '18']);
  await expect(movementRow.getByRole('rowheader')).toContainText('tablet');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await capture(page, `${info.project.name}-combined`);
  await page.getByRole('button', { name: 'Next report products', exact: true }).click();
  await expect(page.getByText(/products · Page 2/)).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Report for / })).toBeFocused();
  await expect(page.getByRole('heading', { name: /^Report for / })).toBeInViewport();
  await page.getByRole('button', { name: 'Previous report products', exact: true }).click();
  await expect(page.getByText(/products · Page 1/)).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Staff sign-in', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Product stock', exact: true })).toHaveCount(0);
});
test('date edits clear stale results and loading requests; failed reads retry into explicit empty state', async ({
  page,
}, info) => {
  await signIn(page, 'admin', emptyCode);
  await open(page);
  await run(page);
  await expect(page.getByText('No inventory products configured.', { exact: true })).toBeVisible();
  await capture(page, `${info.project.name}-empty`);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/reports/operational?**', async (route) => {
    await gate;
    await route.continue().catch(() => {});
  });
  await page.getByRole('button', { name: 'Run report', exact: true }).click();
  await expect(page.getByText('Loading report…', { exact: true })).toBeVisible();
  await capture(page, `${info.project.name}-loading`);
  await page.getByLabel('From date', { exact: true }).fill('2024-02-29');
  await page.getByLabel('Through date', { exact: true }).fill('2024-02-29');
  await expect(page.getByRole('heading', { name: /^Report for / })).toHaveCount(0);
  release();
  await page.unroute('**/api/reports/operational?**');
  await page.route('**/api/reports/operational?**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'REPORT_BUSY',
        message: 'Reports are temporarily busy. Retry when the hospital workspace is available.',
      }),
    }),
  );
  await page.getByRole('button', { name: 'Run report', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('temporarily busy');
  await expect(page.getByRole('heading', { name: /^Report for / })).toHaveCount(0);
  await capture(page, `${info.project.name}-error`);
  await page.unroute('**/api/reports/operational?**');
  await page.getByRole('button', { name: 'Retry report', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Report for 2024-02-29 through 2024-02-29', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Through date', { exact: true }).fill('2026-02-28');
  await page.getByRole('button', { name: 'Run report', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('366 days');
  await expect(page.getByRole('heading', { name: /^Report for / })).toHaveCount(0);
});
test('each role sees only its authorized sections and denied roles have no report entry', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  for (const role of roles.filter((role) => role !== 'admin')) {
    await signIn(page, role);
    if (['lab', 'receptionist'].includes(role)) {
      await expect(
        page.getByRole('link', { name: 'Operational reports', exact: true }),
      ).toHaveCount(0);
      expect(
        (await page.request.get('/api/reports/operational?from=2026-10-14&to=2026-10-14')).status(),
      ).toBe(403);
    } else {
      await open(page);
      await run(page);
      for (const [section, allowed] of [
        ['Visit operations', ['auditor', 'clinician']],
        ['Recorded payments', ['auditor', 'cashier']],
        ['Product stock', ['auditor', 'pharmacist']],
      ] as const)
        await expect(page.getByRole('heading', { name: section, exact: true })).toHaveCount(
          (allowed as readonly string[]).includes(role) ? 1 : 0,
        );
      if (role !== 'auditor') {
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
        await capture(page, `${info.project.name}-${role}`);
      }
    }
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  }
});
test('navigation respects an existing inventory draft and session expiry clears report data', async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Pharmacy inventory', exact: true }).click();
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  await page.getByLabel('Product code', { exact: true }).fill('UNSAVED');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('link', { name: 'Operational reports', exact: true }).click();
  await expect(page.getByRole('form', { name: 'Inventory change' })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await open(page);
  await run(page);
  await page.route('**/api/reports/operational?**', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'UNAUTHENTICATED', message: 'Your session ended.' }),
    }),
  );
  await page.getByRole('button', { name: 'Run report', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Staff sign-in', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Report for / })).toHaveCount(0);
});

test('failed later-page retry preserves the target and editing dates resets to page one', async ({
  page,
}) => {
  test.setTimeout(120000);
  await signIn(page);
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Addis_Ababa',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const existing = await (
    await page.request.get(`/api/reports/operational?from=${day}&to=${day}`)
  ).json();
  for (let i = existing.inventory.total; i < 26; i++)
    await post(page, '/api/inventory/commands', {
      type: 'product.create',
      code: `RETRY${randomUUID().slice(0, 8).toUpperCase()}`,
      name: 'Fictional retry product',
      unit: 'unit',
    });
  await open(page);
  await run(page);
  const requested: string[] = [];
  let fail = true;
  await page.route('**/api/reports/operational?**', async (route) => {
    const target = new URL(route.request().url()).searchParams.get('inventoryPage')!;
    requested.push(target);
    if (target === '2' && fail) {
      fail = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'REPORT_BUSY',
          message: 'Fictional interrupted product page. Retry the report.',
        }),
      });
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Next report products', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Reports are temporarily busy. Retry when the hospital workspace is available.',
  );
  await expect(page.getByRole('heading', { name: /^Report for / })).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry report', exact: true }).click();
  await expect(page.getByText(/products · Page 2/)).toBeVisible();
  expect(requested).toEqual(['2', '2']);
  await expect(page.getByRole('heading', { name: /^Report for / })).toBeFocused();
  await expect(page.getByRole('heading', { name: /^Report for / })).toBeInViewport();
  await page.getByLabel('From date', { exact: true }).fill('2001-01-01');
  await page.getByLabel('Through date', { exact: true }).fill('2001-01-01');
  await run(page);
  await expect(page.getByText(/products · Page 1/)).toBeVisible();
  expect(requested.at(-1)).toBe('1');
});

test('large exact decimal-string report money survives display beyond Number precision', async ({
  page,
}) => {
  await signIn(page, 'cashier');
  await open(page);
  // This consumer fixture deliberately exceeds practical seed volume. The API
  // has separate real-ledger arithmetic tests; this checks lossless rendering.
  await page.route('**/api/reports/operational?**', async (route) => {
    const response = await route.fetch(),
      body = await response.json();
    body.finance.period.collectedMinor = '900719925474099312345';
    body.finance.period.byMethod.cash.collectedMinor = '900719925474099312345';
    body.finance.period.byMethod.manual_transfer.collectedMinor = '0';
    body.finance.current.outstandingMinor = '900719925474099312346';
    await route.fulfill({ response, json: body });
  });
  await run(page);
  const receipts = page.getByRole('region', { name: 'Receipts by payment method', exact: true });
  await expect(
    receipts
      .getByRole('row')
      .filter({ has: page.getByRole('rowheader', { name: 'Cash', exact: true }) })
      .getByRole('cell')
      .last(),
  ).toHaveText('9,007,199,254,740,993,123.45 ETB');
  await expect(page.getByText('9,007,199,254,740,993,123.46 ETB', { exact: true })).toBeVisible();
});

test('delayed completed report responses cannot restore results after navigation or cross-tab logout', async ({
  page,
}) => {
  for (const action of ['navigate', 'logout']) {
    await signIn(page);
    await open(page);
    await page.evaluate(() => {
      const state = window as unknown as {
        releaseReport: () => void;
        reportReady: boolean;
        reportDelivered: boolean;
        reportSignal?: AbortSignal;
      };
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const original = window.fetch.bind(window);
      state.releaseReport = release;
      state.reportReady = false;
      state.reportDelivered = false;
      window.fetch = async (input, init) => {
        if (!String(input).includes('/api/reports/operational')) return original(input, init);
        state.reportSignal = init?.signal ?? undefined;
        const response = await original(input, init),
          body = await response.text();
        state.reportReady = true;
        await gate;
        state.reportDelivered = true;
        return new Response(body, { status: response.status, headers: response.headers });
      };
    });
    await page.getByRole('button', { name: 'Run report', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { reportReady: boolean }).reportReady))
      .toBe(true);
    if (action === 'navigate') {
      await page.getByRole('link', { name: 'Patient directory', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Patient directory', exact: true }),
      ).toBeVisible();
    } else {
      await page.evaluate(() => {
        const channel = new BroadcastChannel('hospital-staff-session');
        channel.postMessage('logout');
        channel.close();
      });
      await expect(page.getByRole('heading', { name: 'Staff sign-in', exact: true })).toBeVisible();
    }
    expect(
      await page.evaluate(
        () => (window as unknown as { reportSignal: AbortSignal }).reportSignal.aborted,
      ),
    ).toBe(true);
    await page.evaluate(() => (window as unknown as { releaseReport: () => void }).releaseReport());
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { reportDelivered: boolean }).reportDelivered),
      )
      .toBe(true);
    await expect(page.getByRole('heading', { name: /^Report for / })).toHaveCount(0);
    if (action === 'navigate') {
      await open(page);
      await expect(page.getByRole('heading', { name: /^Report for / })).toHaveCount(0);
      await expect(
        page.getByText(
          'Choose your dates and run a report. Only sections available to your role will appear.',
          { exact: true },
        ),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    }
  }
});
