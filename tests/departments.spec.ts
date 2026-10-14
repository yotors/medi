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
  hospitalCode = `department-${randomUUID().slice(0, 8)}`,
  password = randomBytes(24).toString('hex');
test.beforeAll(async () => {
  test.setTimeout(120000);
  await prepareBrowserFixture(pool);
  for (const role of ['admin', 'lab', 'cashier', 'pharmacist', 'clinician'] as const)
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
  await page.getByRole('link', { name: 'Department operations', exact: true }).click();
}
async function save(page: Page) {
  await page.getByRole('button', { name: 'Save accountable record', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Saved accountable record' }),
  ).toBeVisible();
}
test('laboratory catalog form preserves explicitly configured thresholds with accessible mobile layout', async ({
  page,
}, info) => {
  await signIn(page);
  await page
    .getByRole('navigation', { name: 'Department workflows' })
    .getByRole('button', { name: 'Laboratory catalog', exact: true })
    .click();
  await page.getByLabel('Action', { exact: true }).selectOption('lab.catalog');
  const code = `L${randomUUID().slice(0, 8)}`;
  await page.getByLabel('Test code', { exact: true }).fill(code);
  await page.getByLabel('Test name', { exact: true }).fill(`Fictional laboratory ${code}`);
  await page.getByLabel('Specimen type', { exact: true }).fill('Fictional specimen');
  await page.getByLabel('Result unit', { exact: true }).fill('Configured unit');
  await page.getByLabel('Critical upper threshold (optional)', { exact: true }).fill('123');
  await save(page);
  await expect(page.getByRole('region', { name: 'Laboratory catalog', exact: true })).toContainText(
    `Fictional laboratory ${code}`,
  );
  const row = page.getByRole('row').filter({ hasText: `Fictional laboratory ${code}` });
  await row.getByRole('button', { name: 'View record and history', exact: true }).click();
  await expect(page.getByText('123', { exact: true }).first()).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await mkdir('artifacts/departments-ui', { recursive: true });
  await page.screenshot({
    path: `artifacts/departments-ui/${info.project.name}-laboratory.png`,
    fullPage: true,
  });
});
test('cashier opens signs and closes a real shift and history retains ETB difference', async ({
  page,
}) => {
  await signIn(page, 'cashier');
  await page.getByLabel('Action', { exact: true }).selectOption('shift.open');
  await page.getByLabel('Opening cash (ETB)', { exact: true }).fill('200.00');
  await save(page);
  await page.getByLabel('Action', { exact: true }).selectOption('shift.close');
  const records = await (await page.request.get('/api/departments?kind=shift&page=1')).json();
  const shift = records.entries.find((r: any) => r.data.status === 'open');
  await page.getByLabel('Cashier shift', { exact: true }).selectOption(shift.id);
  await page.getByLabel('Counted cash (ETB)', { exact: true }).fill('199.50');
  await page.getByLabel('Closing signature', { exact: true }).fill('Fictional cashier signature');
  await save(page);
  await page
    .getByRole('row')
    .filter({ hasText: 'Cashier shift' })
    .filter({ hasText: 'closed' })
    .getByRole('button', { name: 'View record and history', exact: true })
    .click();
  await expect(page.getByText('-0.50 ETB', { exact: true }).first()).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test('pharmacy supplier draft departure is explicit and supplier creation persists', async ({
  page,
}) => {
  await signIn(page, 'pharmacist');
  const navigation = page.getByRole('navigation', { name: 'Department workflows' });
  await navigation.getByRole('button', { name: 'Suppliers', exact: true }).click();
  await page.getByLabel('Action', { exact: true }).selectOption('supplier.create');
  await page.getByLabel('Supplier name', { exact: true }).fill('Fictional unsaved supplier');
  page.once('dialog', (d) => d.dismiss());
  await navigation.getByRole('button', { name: 'Purchase orders', exact: true }).click();
  await expect(page.getByLabel('Supplier name', { exact: true })).toHaveValue(
    'Fictional unsaved supplier',
  );
  await page.getByLabel('Supplier contact', { exact: true }).fill('Fictional contact');
  await save(page);
  await expect(page.getByRole('region', { name: 'Suppliers', exact: true })).toContainText(
    'Fictional unsaved supplier',
  );
});

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
async function choose(page: Page, label: string, needle: string) {
  const select = page.getByLabel(label, { exact: true }),
    option = select.locator('option').filter({ hasText: needle });
  await expect(option).toHaveCount(1);
  await select.selectOption({ label: (await option.textContent())!.trim() });
}
async function openVisit(page: Page, name: string) {
  await page
    .getByRole('navigation', { name: 'Staff workspace' })
    .getByRole('link', { name: 'Outpatient visits', exact: true })
    .click();
  await page.getByRole('button', { name, exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Visit sections' })
    .getByRole('button', { name: 'Diagnostics', exact: true })
    .click();
}
async function workflow(page: Page, category: string, action: string) {
  await page.getByRole('link', { name: 'Department operations', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Department workflows' })
    .getByRole('button', { name: category, exact: true })
    .click();
  await page.getByLabel('Action', { exact: true }).selectOption(action);
}
test('configured custom test orders and specimen handoffs use patient and clinician choices without identifier entry', async ({
  page,
}, info) => {
  await signIn(page);
  const code = `C${randomUUID().slice(0, 8).toUpperCase()}`,
    name = `Fictional configured test ${code}`,
    patientName = `Fictional catalog patient ${code}`;
  await post(page, '/api/departments/commands', {
    type: 'lab.catalog',
    code,
    name,
    specimen: 'Configured specimen',
    unit: 'Configured unit',
  });
  const patient = await post(page, '/api/patients', { name: patientName, contact: '' }),
    v = (await post(page, `/api/patients/${patient.patient.id}/visits`, {})).visit;
  await openVisit(page, patientName);
  await page.getByLabel('Find a configured investigation', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'Find tests', exact: true }).click();
  await choose(page, 'Investigation', name);
  await page.getByRole('button', { name: 'Request investigation', exact: true }).click();
  await expect(
    page.getByRole('article', { name: `${name} investigation`, exact: true }),
  ).toContainText('requested');
  await workflow(page, 'Laboratory specimens', 'lab.register');
  await page.getByLabel('Find patient investigation order', { exact: true }).fill(patientName);
  await page
    .getByRole('button', { name: 'Find choices for patient investigation order', exact: true })
    .click();
  await choose(page, 'Patient investigation order', patientName);
  await expect(page.getByText('Configured test:', { exact: false })).toContainText(name);
  await page.getByLabel('Accession', { exact: true }).fill(`ACCESSION-${code}`);
  await choose(page, 'Responsible clinician', 'Fictional clinician');
  await expect(page.getByLabel(/Encounter ID|order ID|Expected.*revision/)).toHaveCount(0);
  await save(page);
  for (const action of ['lab.collect', 'lab.receive', 'lab.result', 'lab.release']) {
    await page.getByLabel('Action', { exact: true }).selectOption(action);
    await choose(page, 'Specimen', `ACCESSION-${code}`);
    if (action === 'lab.collect') {
      const selected = await page.getByLabel('Specimen', { exact: true }).inputValue();
      await page.getByLabel('Language', { exact: true }).selectOption('am');
      const specimen = page.getByLabel('ናሙና', { exact: true });
      await expect(specimen).toHaveValue(selected);
      await expect(specimen.locator('option:checked')).toContainText(patientName);
      await expect(specimen.locator('option:checked')).toContainText(name);
      await expect(specimen.locator('option:checked')).toContainText('ተመዝግቧል');
      await expect(specimen.locator('option:checked')).toContainText('የናሙና መለያ');
      await page.getByLabel('ቋንቋ', { exact: true }).selectOption('en');
      await expect(page.getByLabel('Specimen', { exact: true })).toHaveValue(selected);
    }

    if (action === 'lab.result')
      await page.getByLabel('Result', { exact: true }).fill('Fictional configured result');
    await save(page);
  }
  await openVisit(page, patientName);
  await expect(
    page.getByRole('article', { name: `${name} investigation`, exact: true }),
  ).toContainText('Fictional configured result');
  await page
    .getByRole('article', { name: `${name} investigation`, exact: true })
    .getByRole('button', { name: 'Mark reviewed', exact: true })
    .click();
  await expect(
    page.getByRole('article', { name: `${name} investigation`, exact: true }),
  ).toContainText('reviewed');
  const current = (await (await page.request.get(`/api/visits/${v.id}`)).json()).visit;
  expect(current.orders[0].catalogId).toBeTruthy();
  expect(current.orders[0].test).toBe(name);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await mkdir('artifacts/departments-ui', { recursive: true });
  await page.screenshot({
    path: `artifacts/departments-ui/${info.project.name}-configured-order.png`,
    fullPage: true,
  });
});
test('invoice credit refund and cash allocation use factual patient invoice receipt choices', async ({
  page,
}) => {
  await signIn(page);
  const code = `F${randomUUID().slice(0, 8).toUpperCase()}`,
    patientName = `Fictional finance picker ${code}`,
    patient = await post(page, '/api/patients', { name: patientName, contact: '' }),
    v = (await post(page, `/api/patients/${patient.patient.id}/visits`, {})).visit,
    dep = await post(page, '/api/configuration/commands', {
      type: 'department.create',
      code,
      name: 'Fictional finance department',
    }),
    service = await post(page, '/api/configuration/commands', {
      type: 'service.create',
      departmentId: dep.entry.id,
      code,
      name: 'Fictional actual service',
      priceMinor: 10000,
    }),
    invoice = await post(page, `/api/visits/${v.id}/billing/commands`, {
      type: 'invoice.issue',
      lines: [{ serviceId: service.entry.id, serviceRevision: 1, quantity: 1 }],
    });
  await post(page, `/api/visits/${v.id}/billing/commands`, {
    type: 'payment.record',
    invoiceId: invoice.invoiceId,
    expectedRevision: 1,
    amountMinor: 10000,
    method: 'cash',
  });
  await workflow(page, 'Financial adjustments', 'invoice.credit');
  await choose(page, 'Patient invoice', patientName);
  await page.getByLabel('Amount (ETB)', { exact: true }).fill('20.00');
  await page.getByLabel('Reason', { exact: true }).fill('Approved fictional credit');
  await save(page);
  await page.getByLabel('Action', { exact: true }).selectOption('payment.refund');
  await choose(page, 'Patient invoice', patientName);
  await choose(page, 'Original receipt', '100.00 ETB');
  await page.getByLabel('Amount (ETB)', { exact: true }).fill('20.00');
  await page.getByLabel('Reason', { exact: true }).fill('Fictional completed cash refund');
  await save(page);
  const detail = await (
    await page.request.get(`/api/billing/invoices/${invoice.invoiceId}`)
  ).json();
  expect(detail.invoice.totalMinor).toBe(8000);
  expect(detail.invoice.paidMinor).toBe(8000);
  await workflow(page, 'Cashier shifts', 'shift.open');
  await page.getByLabel('Opening cash (ETB)', { exact: true }).fill('0.00');
  await save(page);
  for (const needle of ['cash received', 'cash paid out']) {
    await page.getByLabel('Action', { exact: true }).selectOption('shift.allocate');
    await choose(page, 'Cashier shift', 'Opening 0.00 ETB');
    await page.getByLabel('Find cash receipt or refund', { exact: true }).fill(patientName);
    await page
      .getByRole('button', { name: 'Find choices for cash receipt or refund', exact: true })
      .click();
    await choose(page, 'Cash receipt or refund', needle);
    const sources = await post(page, '/api/departments/sources', {
      kind: 'cashEntries',
      q: patientName,
      page: 1,
    });
    expect(sources.entries.length).toBeGreaterThan(0);
    expect(
      sources.entries.every(
        (entry: any) =>
          entry.presentation?.kind === 'cashEntries' &&
          entry.presentation.values.patientName === patientName,
      ),
    ).toBe(true);
    const selectedCash = await page
      .getByLabel('Cash receipt or refund', { exact: true })
      .inputValue();
    await page.getByLabel('Language', { exact: true }).selectOption('am');
    const cashChoice = page.getByLabel('የጥሬ ገንዘብ ማረጋገጫ ወይም ተመላሽ', { exact: true });
    await expect(cashChoice).toHaveValue(selectedCash);
    await expect(cashChoice.locator('option:checked')).toContainText(patientName);
    await expect(cashChoice.locator('option:checked')).toContainText('ጥሬ ገንዘብ');
    await page.getByLabel('ቋንቋ', { exact: true }).selectOption('en');

    await expect(
      page.getByLabel(/Expected.*revision|Invoice ID|Payment ID|Cash payment ID/),
    ).toHaveCount(0);
    await save(page);
  }
  await page.getByLabel('Action', { exact: true }).selectOption('shift.close');
  await choose(page, 'Cashier shift', 'Opening 0.00 ETB');
  await page.getByLabel('Counted cash (ETB)', { exact: true }).fill('80.00');
  await page.getByLabel('Closing signature', { exact: true }).fill('Fictional signed cash count');
  await save(page);
  const shifts = await (await page.request.get('/api/departments?kind=shift&page=1')).json();
  expect(shifts.entries.find((r: any) => r.data.openingMinor === 0).data.differenceMinor).toBe(0);
});
test('patient dispense return and original batch quality decision need no copied stock identifiers', async ({
  page,
}, info) => {
  await signIn(page);
  const code = `R${randomUUID().slice(0, 8).toUpperCase()}`,
    patientName = `Fictional return picker ${code}`,
    product = await post(page, '/api/inventory/commands', {
      type: 'product.create',
      code,
      name: `Fictional product ${code}`,
      unit: 'tablet',
    }),
    batch = await post(page, '/api/inventory/commands', {
      type: 'batch.create',
      productId: product.productId,
      lot: code,
      expiry: '2099-12-31',
    });
  await post(page, '/api/inventory/commands', {
    type: 'stock.receive',
    batchId: batch.batchId,
    expectedRevision: 1,
    quantity: 10,
    reference: 'Fictional receipt',
  });
  const p = await post(page, '/api/patients', { name: patientName, contact: '' });
  let v = (await post(page, `/api/patients/${p.patient.id}/visits`, {})).visit;
  v = (
    await post(page, `/api/visits/${v.id}/commands`, {
      expectedRevision: v.revision,
      command: { type: 'prescribe', instruction: 'Fictional accountable supply' },
    })
  ).visit;
  await post(page, `/api/visits/${v.id}/inventory/commands`, {
    type: 'authorize',
    prescriptionId: v.prescriptions[0].id,
    expectedVisitRevision: v.revision,
    productId: product.productId,
    quantity: 3,
  });
  v = (await (await page.request.get(`/api/visits/${v.id}`)).json()).visit;
  await post(page, `/api/visits/${v.id}/inventory/commands`, {
    type: 'dispense',
    prescriptionId: v.prescriptions[0].id,
    expectedVisitRevision: v.revision,
    batchId: batch.batchId,
    expectedBatchRevision: 2,
    quantity: 3,
  });
  await workflow(page, 'Patient returns', 'return.record');
  await choose(page, 'Patient dispense', code);
  await page.getByLabel('Returned stock units', { exact: true }).fill('2');
  await page.getByLabel('Reason', { exact: true }).fill('Fictional patient return for quarantine');
  await save(page);
  let stock = await (
    await page.request.get(`/api/inventory/products/${product.productId}/batches`)
  ).json();
  expect(stock.entries[0].balance).toBe(7);
  await page.getByLabel('Action', { exact: true }).selectOption('return.quality');
  await choose(page, 'Patient return', patientName);
  await expect(page.getByLabel('Original stock batch', { exact: true })).toContainText(code);
  await expect(page.getByLabel('Original stock batch', { exact: true })).not.toHaveValue('');
  await page.getByLabel('Quality decision', { exact: true }).selectOption('restock');
  await page.getByLabel('Reason', { exact: true }).fill('Authorized fictional inspection decision');
  await save(page);
  stock = await (
    await page.request.get(`/api/inventory/products/${product.productId}/batches`)
  ).json();
  expect(stock.entries[0].balance).toBe(9);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await mkdir('artifacts/departments-ui', { recursive: true });
  await page.screenshot({
    path: `artifacts/departments-ui/${info.project.name}-return-picker.png`,
    fullPage: true,
  });
});
