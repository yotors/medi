import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomBytes, randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { mkdir } from 'node:fs/promises';
import { digest } from '../server/auth';
import { createPool } from '../server/db';
import { prepareBrowserFixture } from './browser-fixture';
import { provisionStaff } from '../server/setup';
import type { BillingCommand, BillingDetail, BillingResult } from '../shared/billing';
import type { ConfigurationCommand, Service } from '../shared/configuration';
try {
  loadEnvFile('.env');
} catch {
  /* CI supplies environment. */
}
const pool = createPool();
const hospitalCode = `billing-${randomUUID().slice(0, 8)}`;
const password = randomBytes(24).toString('hex');
const origin = 'http://127.0.0.1:5173';
test.beforeAll(async () => {
  test.setTimeout(120000);
  await prepareBrowserFixture(pool);
  for (const role of ['admin', 'cashier', 'auditor'] as const)
    await provisionStaff(pool, {
      hospitalCode,
      hospitalName: 'Billing Fiction Medical Center',
      username: role,
      displayName: `Fictional ${role}`,
      role,
      password,
    });
});
// These independent billing cases reuse fictional accounts. Keep their login
// budgets independent; rate-limit behavior is exercised in isolated API tests.
test.beforeEach(async () => {
  await pool.query('DELETE FROM login_buckets WHERE bucket_hash=ANY($1::text[])', [
    ['admin', 'cashier', 'auditor'].map((role) => digest(`account:${hospitalCode}:${role}`)),
  ]);
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
}
async function post(page: Page, path: string, data: object) {
  const session = await (await page.request.get('/api/auth/session')).json();
  const response = await page.request.post(path, {
    headers: { Origin: origin, 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': randomUUID() },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function configuration(page: Page, command: ConfigurationCommand) {
  return (await post(page, '/api/configuration/commands', command)).entry;
}
async function seed(page: Page) {
  const suffix = randomUUID().slice(0, 8);
  const name = `Billing Fiction ${suffix}`;
  const department = await configuration(page, {
    type: 'department.create',
    code: `D${suffix.toUpperCase()}`,
    name: `Fiction Department ${suffix}`,
  });
  const service: Service = await configuration(page, {
    type: 'service.create',
    code: `S${suffix.toUpperCase()}`,
    name: `Fiction Consultation ${suffix}`,
    departmentId: department.id,
    priceMinor: 12500,
  });
  const { patient } = await post(page, '/api/patients', { name, contact: '' });
  const { visit } = await post(page, `/api/patients/${patient.id}/visits`, {});
  await page
    .getByRole('navigation', { name: 'Staff workspace' })
    .getByRole('link', { name: 'Outpatient visits', exact: true })
    .click();
  await page.getByRole('button', { name, exact: true }).click();
  await page
    .getByLabel('Consultation note', { exact: true })
    .fill('Synthetic consultation complete for billing verification.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByLabel('Consultation note', { exact: true })).toHaveValue('');
  await page
    .getByRole('navigation', { name: 'Visit sections' })
    .getByRole('button', { name: 'Billing', exact: true })
    .click();
  await expect(
    page
      .getByRole('region', { name: 'Visit billing' })
      .getByText('Not yet billed', { exact: true }),
  ).toBeVisible();
  return { visit, service, name };
}
async function addService(page: Page, service: Service) {
  await page.getByRole('button', { name: 'Prepare invoice', exact: true }).click();
  await page.getByLabel('Find a service by name or code').fill(service.code);
  await page.getByRole('button', { name: `Add ${service.name} to invoice`, exact: true }).click();
}
async function issue(page: Page, service: Service) {
  await addService(page, service);
  await page.getByLabel('I reviewed these invoice lines and the total.').check();
  await page.getByRole('button', { name: 'Issue invoice', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Record a payment', exact: true })).toBeVisible();
}
async function payment(page: Page, amount: string) {
  await page.getByLabel('Amount received (ETB)', { exact: true }).fill(amount);
  await page.getByLabel('I confirm this money was received and the details are correct.').check();
  await page.getByRole('button', { name: 'Record payment', exact: true }).click();
}
async function billing(
  page: Page,
  visitId: string,
  command: BillingCommand,
): Promise<BillingResult> {
  return post(page, `/api/visits/${visitId}/billing/commands`, command);
}
async function invoice(page: Page, visitId: string): Promise<BillingDetail> {
  const list = await (await page.request.get(`/api/visits/${visitId}/billing`)).json();
  return (await page.request.get(`/api/billing/invoices/${list.invoices[0].id}`)).json();
}

test('catalog invoice, partial cash and transfer receipts remain collectible after clinical closure', async ({
  page,
}, info) => {
  await signIn(page);
  const { visit, service, name } = await seed(page);
  await issue(page, service);
  await expect(page.getByRole('button', { name: 'Close visit', exact: true })).toBeEnabled();
  await payment(page, '50.00');
  await expect(
    page.getByRole('status').filter({ hasText: 'Payment recorded. Receipt' }),
  ).toBeVisible();
  let detail = await invoice(page, visit.id);
  expect(detail.invoice.balanceMinor).toBe(7500);
  expect(detail.events.filter((event) => event.payment)).toHaveLength(1);
  await page.getByRole('button', { name: 'Close visit', exact: true }).click();
  await expect(
    page.getByText(
      'Clinical visit closed. Original clinical records remain unchanged; corrections and billing remain available.',
    ),
  ).toBeVisible();
  await page.getByLabel('Payment method', { exact: true }).selectOption('manual_transfer');
  await page.getByLabel('Amount received (ETB)', { exact: true }).fill('75.00');
  await page.getByLabel('I confirm this money was received and the details are correct.').check();
  await expect(page.getByRole('button', { name: 'Record payment', exact: true })).toBeDisabled();
  await page
    .getByLabel('Transfer reference (required)', { exact: true })
    .fill('FICTION-TRANSFER-001');
  await page.getByLabel('I confirm this money was received and the details are correct.').check();
  await page.getByRole('button', { name: 'Record payment', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Record a payment', exact: true })).toHaveCount(0);
  detail = await invoice(page, visit.id);
  expect(detail.invoice.paidMinor).toBe(12500);
  expect(detail.invoice.balanceMinor).toBe(0);
  expect(detail.events.filter((event) => event.payment)).toHaveLength(2);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await mkdir('artifacts/billing-ui', { recursive: true });
  await page.getByRole('heading', { level: 1 }).focus();
  await page.screenshot({
    path: `artifacts/billing-ui/${info.project.name}-paid.png`,
    fullPage: true,
  });
  await page.reload();
  await page
    .getByRole('navigation', { name: 'Staff workspace' })
    .getByRole('link', { name: 'Outpatient visits', exact: true })
    .click();
  await page.getByLabel('Visit status', { exact: true }).selectOption('closed');
  await page.getByRole('button', { name, exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Visit sections' })
    .getByRole('button', { name: 'Billing', exact: true })
    .click();
  await page.getByRole('button', { name: detail.invoice.number, exact: true }).click();
  await expect(page.getByText('Reference: FICTION-TRANSFER-001', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
});

test('lost payment response retains exact payload and key, locks navigation and returns one receipt', async ({
  page,
}) => {
  await signIn(page);
  const { visit, service } = await seed(page);
  await issue(page, service);
  const submissions: { key: string | undefined; body: string | null }[] = [];
  let lose = true;
  await page.route('**/api/visits/*/billing/commands', async (route) => {
    submissions.push({
      key: route.request().headers()['idempotency-key'],
      body: route.request().postData(),
    });
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    if (lose) {
      lose = false;
      await route.abort('failed');
    } else await route.fulfill({ response });
  });
  await payment(page, '20.00');
  await expect(page.getByRole('button', { name: 'Retry billing save', exact: true })).toBeEnabled();
  for (const label of [
    'Sign out',
    'Back to visit queue',
    'Refresh visit',
    'All invoices',
    'Record payment',
  ])
    await expect(page.getByRole('button', { name: label, exact: true })).toBeDisabled();
  await expect(page.getByLabel('Amount received (ETB)', { exact: true })).toHaveValue('20.00');
  await expect(page.getByLabel('Amount received (ETB)', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry billing save', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Payment recorded. Receipt' }),
  ).toBeVisible();
  expect(submissions).toHaveLength(2);
  expect(submissions[0]).toEqual(submissions[1]);
  const detail = await invoice(page, visit.id);
  expect(detail.invoice.paidMinor).toBe(2000);
  expect(detail.events.filter((event) => event.payment)).toHaveLength(1);
});

test('stale prices preserve selected lines, require explicit refresh and renewed review', async ({
  page,
}, info) => {
  await signIn(page);
  const { visit, service } = await seed(page);
  await addService(page, service);
  await page.getByLabel(`Quantity for ${service.name}`, { exact: true }).fill('2');
  await page.getByLabel('I reviewed these invoice lines and the total.').check();
  await configuration(page, {
    type: 'service.update',
    id: service.id,
    expectedRevision: service.revision,
    name: service.name,
    departmentId: service.departmentId,
    priceMinor: 15000,
    active: true,
  });
  await page.getByRole('button', { name: 'Issue invoice', exact: true }).click();
  await expect(
    page.getByText(
      'The catalog or visit changed. Refresh selected prices and review the invoice again.',
    ),
  ).toBeVisible();
  await expect(page.getByLabel(`Quantity for ${service.name}`, { exact: true })).toHaveValue('2');
  await expect(page.getByRole('button', { name: 'Issue invoice', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Refresh selected prices', exact: true }).click();
  await expect(
    page.getByText(
      'Current catalog prices loaded. Review every line and the total again. Remove any unavailable service.',
    ),
  ).toBeVisible();
  await expect(page.getByLabel('I reviewed these invoice lines and the total.')).not.toBeChecked();
  await expect(page.getByLabel(`Quantity for ${service.name}`, { exact: true })).toHaveValue('2');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await mkdir('artifacts/billing-ui', { recursive: true });
  await page.getByRole('heading', { level: 1 }).focus();
  await page.screenshot({
    path: `artifacts/billing-ui/${info.project.name}-draft.png`,
    fullPage: true,
  });
  await page.getByLabel('I reviewed these invoice lines and the total.').check();
  await page.getByRole('button', { name: 'Issue invoice', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Record a payment', exact: true })).toBeVisible();
  const detail = await invoice(page, visit.id);
  expect(detail.invoice.totalMinor).toBe(30000);
  expect(detail.lines[0].serviceRevision).toBe(2);
});

test('drafts survive section changes, guard leaving, and clear on session change', async ({
  page,
}) => {
  await signIn(page);
  const { service, name } = await seed(page);
  await addService(page, service);
  await page
    .getByRole('navigation', { name: 'Visit sections' })
    .getByRole('button', { name: 'Consultation', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Visit sections' })
    .getByRole('button', { name: 'Billing', exact: true })
    .click();
  await expect(page.getByLabel(`Quantity for ${service.name}`, { exact: true })).toHaveValue('1');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Back to visit queue', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await page.evaluate(() => {
    const channel = new BroadcastChannel('hospital-staff-session');
    channel.postMessage('logout');
    channel.close();
  });
  await expect(page.getByRole('heading', { name: 'Staff sign-in', exact: true })).toBeVisible();
  await expect(page.getByLabel(`Quantity for ${service.name}`, { exact: true })).toHaveCount(0);
});

test('void retains original invoice and reason, then permits an explicitly prepared replacement', async ({
  page,
}) => {
  await signIn(page);
  const { visit, service } = await seed(page);
  await issue(page, service);
  const original = await invoice(page, visit.id);
  await page
    .getByLabel('Reason for voiding', { exact: true })
    .fill('Synthetic duplicate charge correction.');
  await page.getByLabel('I confirm this unpaid invoice should be voided.').check();
  await page.getByRole('button', { name: 'Void invoice', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Invoice voided.' })).toBeVisible();
  await expect(
    page.getByText('Synthetic duplicate charge correction.', { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Visit billing' })
      .getByText('Not yet billed', { exact: true }),
  ).toBeVisible();
  await issue(page, service);
  const replacement = await invoice(page, visit.id);
  expect(replacement.invoice.id).not.toBe(original.invoice.id);
  const retained = await (
    await page.request.get(`/api/billing/invoices/${original.invoice.id}`)
  ).json();
  expect(retained.invoice.status).toBe('void');
  expect(retained.lines).toEqual(original.lines);
});

test('concurrent payment conflict preserves the draft and requires review of the reduced balance', async ({
  page,
}) => {
  await signIn(page);
  const { visit, service } = await seed(page);
  await issue(page, service);
  const current = await invoice(page, visit.id);
  await page.getByLabel('Amount received (ETB)', { exact: true }).fill('100.00');
  await page.getByLabel('I confirm this money was received and the details are correct.').check();
  await billing(page, visit.id, {
    type: 'payment.record',
    invoiceId: current.invoice.id,
    expectedRevision: current.invoice.revision,
    amountMinor: 5000,
    method: 'cash',
  });
  await page.getByRole('button', { name: 'Record payment', exact: true }).click();
  await expect(page.getByLabel('Amount received (ETB)', { exact: true })).toHaveValue('100.00');
  await expect(
    page.getByLabel('I confirm this money was received and the details are correct.'),
  ).not.toBeChecked();
  await expect(
    page.getByText(
      'Enter a positive amount up to 75.00 ETB, with no more than two decimal places.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record payment', exact: true })).toBeDisabled();
  expect((await invoice(page, visit.id)).events.filter((event) => event.payment)).toHaveLength(1);
});

test('acknowledged payment with failed refresh offers read recovery without another payment submission', async ({
  page,
}) => {
  await signIn(page);
  const { visit, service } = await seed(page);
  await issue(page, service);
  let writes = 0;
  await page.route('**/api/visits/*/billing/commands', async (route) => {
    writes++;
    await route.fulfill({ response: await route.fetch() });
  });
  await page.route('**/api/billing/invoices/*', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Synthetic read outage.' }),
    }),
  );
  await payment(page, '25.00');
  await expect(
    page.getByRole('status').filter({ hasText: 'Payment recorded. Receipt' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Retry loading billing', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry billing save', exact: true })).toHaveCount(
    0,
  );
  await page.unroute('**/api/billing/invoices/*');
  await page.getByRole('button', { name: 'Retry loading billing', exact: true }).click();
  await expect(page.getByLabel('Amount received (ETB)', { exact: true })).toHaveValue('');
  expect(writes).toBe(1);
  expect((await invoice(page, visit.id)).invoice.paidMinor).toBe(2500);
});

test('cashier cannot void and auditor can inspect receipts without financial mutation controls', async ({
  page,
}) => {
  await signIn(page);
  const { visit, service, name } = await seed(page);
  await issue(page, service);
  await payment(page, '25.00');
  await expect(
    page.getByRole('status').filter({ hasText: 'Payment recorded. Receipt' }),
  ).toBeVisible();
  const current = await invoice(page, visit.id);
  for (const role of ['cashier', 'auditor']) {
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await signIn(page, role);
    await page
      .getByRole('navigation', { name: 'Staff workspace' })
      .getByRole('link', { name: 'Outpatient visits', exact: true })
      .click();
    await page.getByRole('button', { name, exact: true }).click();
    await page.getByRole('button', { name: current.invoice.number, exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Financial history', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Void invoice', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Prepare invoice', exact: true })).toHaveCount(
      role === 'cashier' ? 1 : 0,
    );
    await expect(page.getByRole('button', { name: 'Record payment', exact: true })).toHaveCount(
      role === 'cashier' ? 1 : 0,
    );
  }
});

test('invoice and financial-history pagination expose older records without losing the selected invoice', async ({
  page,
}) => {
  test.setTimeout(90000);
  await signIn(page);
  const { visit, service } = await seed(page);
  const first = await billing(page, visit.id, {
    type: 'invoice.issue',
    lines: [{ serviceId: service.id, serviceRevision: 1, quantity: 1 }],
  });
  for (let index = 0; index < 25; index++)
    await billing(page, visit.id, {
      type: 'payment.record',
      invoiceId: first.invoiceId,
      expectedRevision: index + 1,
      amountMinor: 1,
      method: 'cash',
    });
  const firstDetail: BillingDetail = await (
    await page.request.get(`/api/billing/invoices/${first.invoiceId}`)
  ).json();
  for (let index = 0; index < 25; index++)
    await billing(page, visit.id, {
      type: 'invoice.issue',
      lines: [{ serviceId: service.id, serviceRevision: 1, quantity: 1 }],
    });
  await page.getByRole('button', { name: 'Refresh billing', exact: true }).click();
  await expect(page.getByText('26 invoices · Page 1 of 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next invoices', exact: true }).click();
  await expect(page.getByText('26 invoices · Page 2 of 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: firstDetail.invoice.number, exact: true }).click();
  await expect(page.getByText('History · Page 1 of 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next billing history', exact: true }).click();
  await expect(page.getByText('History · Page 2 of 2', { exact: true })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Invoice issued' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: `Invoice ${firstDetail.invoice.number}`, exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Previous billing history', exact: true }).click();
  await expect(page.getByText('History · Page 1 of 2', { exact: true })).toBeVisible();
});

test('lost invoice and void responses preserve exact retries and one effect each', async ({
  page,
}) => {
  await signIn(page);
  const { visit, service } = await seed(page);
  const submissions: { key: string | undefined; body: string | null }[] = [];
  let lose = true;
  await page.route('**/api/visits/*/billing/commands', async (route) => {
    submissions.push({
      key: route.request().headers()['idempotency-key'],
      body: route.request().postData(),
    });
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    if (lose) {
      lose = false;
      await route.abort('failed');
    } else await route.fulfill({ response });
  });
  await addService(page, service);
  await page.getByLabel('I reviewed these invoice lines and the total.').check();
  await page.getByRole('button', { name: 'Issue invoice', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry billing save', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeDisabled();
  await expect(page.getByLabel(`Quantity for ${service.name}`, { exact: true })).toHaveValue('1');
  await page.getByRole('button', { name: 'Retry billing save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Record a payment', exact: true })).toBeVisible();
  expect(submissions[0]).toEqual(submissions[1]);
  expect((await (await page.request.get(`/api/visits/${visit.id}/billing`)).json()).total).toBe(1);
  lose = true;
  await page.getByLabel('Reason for voiding', { exact: true }).fill('Synthetic void retry.');
  await page.getByLabel('I confirm this unpaid invoice should be voided.').check();
  await page.getByRole('button', { name: 'Void invoice', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry billing save', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Reason for voiding', { exact: true })).toHaveValue(
    'Synthetic void retry.',
  );
  await expect(page.getByRole('button', { name: 'All invoices', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry billing save', exact: true }).click();
  await expect(page.getByText('Synthetic void retry.', { exact: true })).toBeVisible();
  expect(submissions[2]).toEqual(submissions[3]);
  const detail = await invoice(page, visit.id);
  expect(detail.invoice.status).toBe('void');
  expect(detail.events.filter((event) => event.action === 'invoice.void')).toHaveLength(1);
});

test('leaving a delayed invoice read keeps list and invoice preparation usable', async ({
  page,
}) => {
  await signIn(page);
  const { visit, service } = await seed(page);
  await issue(page, service);
  const detail = await invoice(page, visit.id);
  await page.getByRole('button', { name: 'All invoices', exact: true }).click();
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const intercepted = new Promise<void>((resolve) => {
    reached = resolve;
  });
  await page.route(`**/api/billing/invoices/${detail.invoice.id}?*`, async (route) => {
    const response = await route.fetch();
    reached();
    await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  await page.getByRole('button', { name: detail.invoice.number, exact: true }).click();
  await intercepted;
  await page.getByRole('button', { name: 'All invoices', exact: true }).click();
  release();
  await page.unrouteAll({ behavior: 'wait' });
  await expect(page.getByRole('button', { name: 'Refresh billing', exact: true })).toBeEnabled();
  await addService(page, service);
  await page.getByLabel('I reviewed these invoice lines and the total.').check();
  await expect(page.getByRole('button', { name: 'Issue invoice', exact: true })).toBeEnabled();
});

test('visit refresh updates invoice balance and retains a payment draft; navigation clears the receipt notice', async ({
  page,
}) => {
  await signIn(page);
  const { visit, service } = await seed(page);
  await issue(page, service);
  let current = await invoice(page, visit.id);
  await page.getByLabel('Amount received (ETB)', { exact: true }).fill('100.00');
  await page.getByLabel('I confirm this money was received and the details are correct.').check();
  await billing(page, visit.id, {
    type: 'payment.record',
    invoiceId: current.invoice.id,
    expectedRevision: 1,
    amountMinor: 5000,
    method: 'cash',
  });
  await page.getByRole('button', { name: 'Refresh visit', exact: true }).click();
  await expect(
    page.getByText(
      'Enter a positive amount up to 75.00 ETB, with no more than two decimal places.',
    ),
  ).toBeVisible();
  await expect(page.getByLabel('Amount received (ETB)', { exact: true })).toHaveValue('100.00');
  await expect(
    page.getByLabel('I confirm this money was received and the details are correct.'),
  ).not.toBeChecked();
  await payment(page, '25.00');
  await expect(
    page.getByRole('status').filter({ hasText: 'Payment recorded. Receipt' }),
  ).toBeVisible();
  current = await invoice(page, visit.id);
  expect(current.invoice.balanceMinor).toBe(5000);
  await page.getByRole('button', { name: 'All invoices', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Payment recorded. Receipt' }),
  ).toHaveCount(0);
});

test('cashier price refresh identifies an unavailable line and retains other updated prices', async ({
  page,
  browser,
}) => {
  await signIn(page);
  const { visit, service, name } = await seed(page);
  const second: Service = await configuration(page, {
    type: 'service.create',
    code: `B${randomUUID().slice(0, 8).toUpperCase()}`,
    name: 'Fictional second billing service',
    departmentId: service.departmentId,
    priceMinor: 5000,
  });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page, 'cashier');
  await page
    .getByRole('navigation', { name: 'Staff workspace' })
    .getByRole('link', { name: 'Outpatient visits', exact: true })
    .click();
  await page.getByRole('button', { name, exact: true }).click();
  await addService(page, service);
  await page.getByLabel('Find a service by name or code').fill(second.code);
  await page.getByRole('button', { name: `Add ${second.name} to invoice`, exact: true }).click();
  const context = await browser.newContext();
  const adminPage = await context.newPage();
  try {
    await signIn(adminPage);
    await configuration(adminPage, {
      type: 'service.update',
      id: service.id,
      expectedRevision: 1,
      name: service.name,
      departmentId: service.departmentId,
      priceMinor: service.priceMinor,
      active: false,
    });
    await configuration(adminPage, {
      type: 'service.update',
      id: second.id,
      expectedRevision: 1,
      name: second.name,
      departmentId: second.departmentId,
      priceMinor: 6000,
      active: true,
    });
  } finally {
    await context.close();
  }
  await page.getByRole('button', { name: 'Refresh selected prices', exact: true }).click();
  await expect(
    page.getByText('Unavailable. Remove this service before issuing.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel(`Quantity for ${second.name}`, { exact: true })).toHaveValue('1');
  await page.getByRole('button', { name: `Remove ${service.name}`, exact: true }).click();
  await page.getByLabel('I reviewed these invoice lines and the total.').check();
  await page.getByRole('button', { name: 'Issue invoice', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Record a payment', exact: true })).toBeVisible();
  expect((await invoice(page, visit.id)).invoice.totalMinor).toBe(6000);
});
