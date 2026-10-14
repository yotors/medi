import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import pg from 'pg';
import { buildApp } from './app.ts';
import { digest } from './auth.ts';
import { migrate } from './db.ts';
import { billingCommandSchema, type BillingCommand } from '../shared/billing.ts';
import type { StaffRole } from '../shared/registration.ts';
import { execute } from '../src/domain.ts';
const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('PostgreSQL billing tests require a database.');
const schema = `billing_test_${randomUUID().replaceAll('-', '')}`;
const database = new pg.Pool({ connectionString });
const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema} -c application_name=${schema}` });
const origin = 'http://127.0.0.1:5173'; let app = buildApp({ pool, origin });
type Auth = { id: string; hospital: string; cookie: string; csrf: string };
let admin: Auth; let cashier: Auth; let auditor: Auth; let clinician: Auth; let other: Auth;
let visitId: string; let serviceId: string; let departmentId: string;
async function actor(hospital: string, role: StaffRole): Promise<Auth> {
  const id = randomUUID(); const token = randomBytes(32).toString('base64url'); const csrf = randomBytes(32).toString('base64url');
  await pool.query('INSERT INTO staff_users(id,hospital_id,username,display_name,role,password_hash) VALUES($1,$2,$6,$3,$4,$5)', [id, hospital, `Fictional ${role}`, role, 'unused-test-hash', id]);
  await pool.query("INSERT INTO staff_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')", [digest(token), id, csrf]);
  return { id, hospital, cookie: `staff_session=${token}`, csrf };
}
const headers = (user: Auth, key: string = randomUUID()) => ({ origin, cookie: user.cookie, 'x-csrf-token': user.csrf, 'idempotency-key': key });
const get = (user: Auth, path: string) => app.inject({ url: path, headers: { cookie: user.cookie } });
const command = (user: Auth, value: BillingCommand, key: string = randomUUID(), visit = visitId) => app.inject({ method: 'POST', url: `/api/visits/${visit}/billing/commands`, headers: headers(user, key), payload: value });
const issueCommand = (): BillingCommand => ({ type: 'invoice.issue', lines: [{ serviceId, serviceRevision: 1, quantity: 2 }] });
const payCommand = (invoiceId: string, amountMinor = 100, expectedRevision = 1): Extract<BillingCommand, { type: 'payment.record' }> => ({ type: 'payment.record', invoiceId, expectedRevision, amountMinor, method: 'cash' });
async function issue() { const response = await command(cashier, issueCommand()); assert.equal(response.statusCode, 200, response.body); return response.json().invoiceId as string; }
async function catalog(code = 'SERVICE', price = 12345) {
  const response = await app.inject({ method: 'POST', url: '/api/configuration/commands', headers: headers(admin), payload: { type: 'service.create', code, name: 'Fictional service', departmentId, priceMinor: price } });
  assert.equal(response.statusCode, 200, response.body); return response.json().entry.id as string;
}
async function newVisit(user = admin, legacy = false) {
  const patient = { id: randomUUID(), name: 'Fictional billing patient', contact: '', createdAt: new Date().toISOString() };
  await pool.query('INSERT INTO patients(id,hospital_id,record_number,name,normalized_name) VALUES($1,$2,$4,$3,$3)', [patient.id, user.hospital, patient.name, patient.id]);
  if (!legacy) {
    const response = await app.inject({ method: 'POST', url: `/api/patients/${patient.id}/visits`, headers: headers(user), payload: {} });
    assert.equal(response.statusCode, 201, response.body); return response.json().visit.id as string;
  }
  const state = execute({ version: 1, revision: 0, patients: [patient], visits: [], events: [] }, { type: 'checkIn', patientId: patient.id });
  const v = state.visits[0];
  await pool.query('INSERT INTO outpatient_visits(id,hospital_id,patient_id,revision,status,opened_at,data) VALUES($1,$2,$3,1,$4,$5,$6)', [v.id, user.hospital, patient.id, v.status, v.openedAt, JSON.stringify(v)]); return v.id;
}
before(async () => { await database.query(`CREATE SCHEMA ${schema}`); await migrate(pool); });
beforeEach(async () => {
  await pool.query('TRUNCATE hospitals CASCADE');
  const alpha = randomUUID(); const beta = randomUUID();
  await pool.query("INSERT INTO hospitals(id,code,name) VALUES($1,'alpha','Fictional Alpha'),($2,'beta','Fictional Beta')", [alpha, beta]);
  admin = await actor(alpha, 'admin'); cashier = await actor(alpha, 'cashier'); auditor = await actor(alpha, 'auditor'); clinician = await actor(alpha, 'clinician'); other = await actor(beta, 'admin');
  const dep = await app.inject({ method: 'POST', url: '/api/configuration/commands', headers: headers(admin), payload: { type: 'department.create', code: 'OPD', name: 'Fictional outpatient' } });
  assert.equal(dep.statusCode, 200, dep.body); departmentId = dep.json().entry.id;
  serviceId = await catalog(); visitId = await newVisit();
});
after(async () => { await app.close(); await pool.end(); await database.query(`DROP SCHEMA ${schema} CASCADE`); await database.end(); });

test('strict command contract denies fabricated prices, duplicate services and invalid money/reference', () => {
  for (const value of [
    { ...issueCommand(), totalMinor: 1 }, { type: 'invoice.issue', lines: [] },
    { type: 'invoice.issue', lines: Array(21).fill({ serviceId, serviceRevision: 1, quantity: 1 }) },
    ...[serviceId, serviceId.toUpperCase()].map(duplicate => ({ type: 'invoice.issue', lines: [{ serviceId, serviceRevision: 1, quantity: 1 }, { serviceId: duplicate, serviceRevision: 1, quantity: 1 }] })),
    ...[0, 101, 1.1].map(quantity => ({ type: 'invoice.issue', lines: [{ serviceId, serviceRevision: 1, quantity }] })),
    ...[0, -1, 1.1, 1000000000].map(amountMinor => payCommand(randomUUID(), amountMinor)),
    { ...payCommand(randomUUID()), method: 'manual_transfer' },
    { ...payCommand(randomUUID()), method: 'manual_transfer', reference: ' ' },
    { ...payCommand(randomUUID()), reference: 'bad\0reference' },
    { type: 'invoice.void', invoiceId: randomUUID(), expectedRevision: 1, reason: ' ' },
  ]) assert.equal(billingCommandSchema.safeParse(value).success, false, JSON.stringify(value));
  assert.equal(billingCommandSchema.safeParse({ ...payCommand(randomUUID()), method: 'manual_transfer', reference: 'Operator note 42' }).success, true);
});
test('within-limit duplicate services, including UUID case variants, return API400 without a ledger effect', async () => {
  for (const duplicate of [serviceId, serviceId.toUpperCase()]) {
    const response = await command(admin, { type: 'invoice.issue', lines: [{ serviceId, serviceRevision: 1, quantity: 1 }, { serviceId: duplicate, serviceRevision: 1, quantity: 1 }] });
    assert.equal(response.statusCode, 400, response.body); assert.equal(response.json().code, 'INVALID_REQUEST');
  }
  for (const table of ['billing_invoices', 'billing_lines', 'billing_requests']) assert.equal((await pool.query(`SELECT * FROM ${table}`)).rowCount, 0);
});
test('uppercase UUID paths, keys and command IDs preserve issue, payment and void replay identities', async () => {
  const issueKey = randomUUID();
  const upperIssue: BillingCommand = { type: 'invoice.issue', lines: [{ serviceId: serviceId.toUpperCase(), serviceRevision: 1, quantity: 2 }] };
  const issued = await command(admin, upperIssue, issueKey.toUpperCase(), visitId.toUpperCase());
  assert.equal(issued.statusCode, 200, issued.body);
  for (const retry of [await command(admin, upperIssue, issueKey.toUpperCase(), visitId.toUpperCase()), await command(admin, issueCommand(), issueKey)]) assert.deepEqual(retry.json(), { ...issued.json(), replayed: true });
  const invoiceId = issued.json().invoiceId as string; const paymentKey = randomUUID();
  const payment = await command(cashier, payCommand(invoiceId.toUpperCase()), paymentKey.toUpperCase(), visitId.toUpperCase());
  assert.equal(payment.statusCode, 200, payment.body);
  for (const retry of [await command(cashier, payCommand(invoiceId.toUpperCase()), paymentKey.toUpperCase(), visitId.toUpperCase()), await command(cashier, payCommand(invoiceId), paymentKey)]) assert.deepEqual(retry.json(), { ...payment.json(), replayed: true });
  const unpaid = await issue(); const voidKey = randomUUID();
  const voidCommand = { type: 'invoice.void', invoiceId: unpaid, expectedRevision: 1, reason: 'Fictional correction' } as const;
  const voided = await command(admin, { ...voidCommand, invoiceId: unpaid.toUpperCase() }, voidKey.toUpperCase(), visitId.toUpperCase());
  assert.equal(voided.statusCode, 200, voided.body);
  for (const retry of [await command(admin, { ...voidCommand, invoiceId: unpaid.toUpperCase() }, voidKey.toUpperCase(), visitId.toUpperCase()), await command(admin, voidCommand, voidKey)]) assert.deepEqual(retry.json(), { ...voided.json(), replayed: true });
  assert.equal((await get(admin, `/api/visits/${visitId.toUpperCase()}/billing`)).json().total, 2);
  assert.equal((await get(admin, `/api/billing/invoices/${invoiceId.toUpperCase()}`)).json().invoice.id, invoiceId);
  assert.equal((await pool.query('SELECT * FROM billing_payments')).rowCount, 1);
  assert.equal((await pool.query('SELECT * FROM billing_receipts')).rowCount, 1);
});
test('queue summaries track issue, partial payment, closed debt and settlement while preserving unbilled and legacy rows', async () => {
  const unbilled = await newVisit(); const legacy = await newVisit(admin, true); const foreign = await newVisit(other);
  const queue = async (state: 'unbilled' | 'outstanding' | 'settled', totalMinor: number, paidMinor: number, status = 'active') => {
    const response = await get(admin, '/api/visits?status=all'); assert.equal(response.statusCode, 200, response.body);
    const rows = response.json().visits;
    const current = rows.find((row: { id: string }) => row.id === visitId);
    assert.deepEqual(current.billing, { state, currency: 'ETB', totalMinor, paidMinor, balanceMinor: totalMinor - paidMinor });
    assert.equal(current.balance, totalMinor - paidMinor); assert.equal(current.status, status);
    const sibling = rows.find((row: { id: string }) => row.id === unbilled);
    assert.deepEqual(sibling.billing, { state: 'unbilled', currency: 'ETB', totalMinor: 0, paidMinor: 0, balanceMinor: 0 }); assert.equal(sibling.balance, 0);
    const historical = rows.find((row: { id: string }) => row.id === legacy);
    assert.equal(historical.financialMode, 'legacy_demo'); assert.equal(historical.balance, 25000); assert.equal(historical.billing, undefined);
    assert.equal(rows.some((row: { id: string }) => row.id === foreign), false);
  };
  await queue('unbilled', 0, 0);
  const invoiceId = await issue(); await queue('outstanding', 24690, 0);
  assert.equal((await command(cashier, payCommand(invoiceId, 10000))).statusCode, 200); await queue('outstanding', 24690, 10000);
  for (const [expectedRevision, value] of [[1, { type: 'note', body: 'Fictional completed consultation' }], [2, { type: 'close' }]] as const) {
    const response = await app.inject({ method: 'POST', url: `/api/visits/${visitId}/commands`, headers: headers(clinician), payload: { expectedRevision, command: value } });
    assert.equal(response.statusCode, 200, response.body);
  }
  await queue('outstanding', 24690, 10000, 'closed');
  assert.equal((await command(cashier, payCommand(invoiceId, 14690, 2))).statusCode, 200); await queue('settled', 24690, 24690, 'closed');
});
test('new clinical visits carry no invented money; issued snapshots and partial receipts survive restart/catalog changes', async () => {
  const start = (await get(admin, `/api/visits/${visitId}`)).json().visit;
  assert.equal(start.financialMode, 'catalog'); assert.deepEqual(start.charges, []); assert.deepEqual(start.payments, []); assert.equal(start.billing.state, 'unbilled');
  const issued = await issue();
  let detail = (await get(cashier, `/api/billing/invoices/${issued}`)).json();
  assert.equal(detail.invoice.totalMinor, 24690); assert.equal(detail.lines[0].unitPriceMinor, 12345); assert.equal(detail.lines[0].quantity, 2);
  assert.match(detail.invoice.number, /^INV-/); assert.equal(detail.events[0].actorId, cashier.id);
  const key: string = randomUUID(); const input = payCommand(issued, 10000);
  const first = await command(cashier, input, key); assert.equal(first.statusCode, 200, first.body); assert.match(first.json().receiptNumber, /^RCT-/);
  await app.inject({ method: 'POST', url: '/api/configuration/commands', headers: headers(admin), payload: { type: 'service.update', id: serviceId, expectedRevision: 1, name: 'Changed catalog', departmentId, priceMinor: 1, active: false } });
  await app.close(); app = buildApp({ pool, origin });
  const retry = await command(cashier, input, key); assert.deepEqual(retry.json(), { ...first.json(), replayed: true });
  detail = (await get(auditor, `/api/billing/invoices/${issued}`)).json();
  assert.equal(detail.invoice.revision, 2); assert.equal(detail.invoice.balanceMinor, 14690); assert.equal(detail.lines[0].name, 'Fictional service');
  assert.equal(detail.events[0].payment.receiptId, first.json().receiptId); assert.equal(detail.events[0].payment.amountMinor, 10000);
  assert.equal((await command(cashier, { ...payCommand(issued, 14690, 2), method: 'manual_transfer', reference: 'Manually noted transfer A' })).statusCode, 200);
  const summary = (await get(cashier, `/api/visits/${visitId}/billing`)).json().summary;
  assert.deepEqual(summary, { state: 'settled', currency: 'ETB', totalMinor: 24690, paidMinor: 24690, balanceMinor: 0 });
  const clinical = (await get(admin, `/api/visits/${visitId}`)).json().visit;
  assert.deepEqual(clinical.charges, []); assert.deepEqual(clinical.payments, []); assert.equal(clinical.revision, 1);
});
test('unprepared and outstanding billing do not block clinical closure or later authorized collection', async () => {
  for (const prepared of [false, true]) {
    if (prepared) visitId = await newVisit();
    const invoiceId = prepared ? await issue() : undefined;
    const clinical = async (expectedRevision: number, value: object) => app.inject({ method: 'POST', url: `/api/visits/${visitId}/commands`, headers: headers(clinician), payload: { expectedRevision, command: value } });
    assert.equal((await clinical(1, { type: 'close' })).statusCode, 409);
    assert.equal((await clinical(1, { type: 'note', body: 'Fictional completed consultation' })).statusCode, 200);
    const closed = await clinical(2, { type: 'close' }); assert.equal(closed.statusCode, 200, closed.body);
    assert.equal(closed.json().visit.billing.state, prepared ? 'outstanding' : 'unbilled');
    const before = (await pool.query('SELECT data FROM outpatient_visits WHERE id=$1', [visitId])).rows[0].data;
    const invoice = invoiceId ?? await issue();
    assert.equal((await command(cashier, payCommand(invoice, 24690))).statusCode, 200);
    assert.deepEqual((await pool.query('SELECT data FROM outpatient_visits WHERE id=$1', [visitId])).rows[0].data, before);
    const after = (await get(admin, `/api/visits/${visitId}`)).json().visit; assert.equal(after.status, 'closed'); assert.equal(after.billing.state, 'settled');
  }
});
test('catalog clinical cancellation handles absent charges and pending tasks still block closure', async () => {
  let revision = 1;
  const clinical = async (command: object) => {
    const response = await app.inject({ method: 'POST', url: `/api/visits/${visitId}/commands`, headers: headers(admin), payload: { expectedRevision: revision, command } });
    if (response.statusCode === 200) revision = response.json().visit.revision; return response;
  };
  await clinical({ type: 'note', body: 'Fictional note' });
  const order = await clinical({ type: 'order', test: 'Blood count' }); const orderId = order.json().visit.orders[0].id;
  assert.deepEqual(order.json().visit.charges, []); assert.equal((await clinical({ type: 'close' })).statusCode, 409);
  assert.equal((await clinical({ type: 'advanceOrder', orderId, next: 'cancelled' })).statusCode, 200);
  const prescribed = await clinical({ type: 'prescribe', instruction: 'Fictional instruction' });
  assert.equal((await clinical({ type: 'close' })).statusCode, 409);
  await clinical({ type: 'fulfill', prescriptionId: prescribed.json().visit.prescriptions[0].id, next: 'cancelled' });
  assert.equal((await clinical({ type: 'settle' })).statusCode, 409);
  assert.equal((await clinical({ type: 'close' })).statusCode, 200);
});
test('void requires admin, unpaid current revision and reason; preserves original and permits replacement', async () => {
  const invoiceId = await issue(); const input: BillingCommand = { type: 'invoice.void', invoiceId, expectedRevision: 1, reason: 'Fictional correction' };
  assert.equal((await command(cashier, input)).statusCode, 403);
  assert.equal((await command(admin, { ...input, expectedRevision: 2 })).statusCode, 409);
  assert.equal((await command(admin, input)).statusCode, 200);
  const detail = (await get(auditor, `/api/billing/invoices/${invoiceId}`)).json();
  assert.equal(detail.invoice.status, 'void'); assert.equal(detail.invoice.totalMinor, 24690); assert.equal(detail.lines.length, 1); assert.equal(detail.events[0].reason, input.reason);
  assert.equal((await get(admin, `/api/visits/${visitId}/billing`)).json().summary.state, 'unbilled');
  assert.equal((await command(admin, payCommand(invoiceId, 1, 2))).json().code, 'INVOICE_VOID');
  const replacement = await issue(); await command(cashier, payCommand(replacement, 1));
  assert.equal((await command(admin, { ...input, invoiceId: replacement, expectedRevision: 2 })).json().code, 'INVOICE_PAID');
});
test('stale, foreign, inactive services and retired departments cannot issue; invoice and aggregate bounds include zero prices', async () => {
  for (const lines of [[{ serviceId, serviceRevision: 2, quantity: 1 }], [{ serviceId: randomUUID(), serviceRevision: 1, quantity: 1 }]]) assert.equal((await command(admin, { type: 'invoice.issue', lines })).json().code, 'STALE_SERVICE');
  const zero = await catalog('ZERO', 0);
  assert.equal((await command(admin, { type: 'invoice.issue', lines: [{ serviceId: zero, serviceRevision: 1, quantity: 100 }] })).statusCode, 200);
  assert.equal((await get(admin, `/api/visits/${visitId}/billing`)).json().summary.state, 'settled');
  const large = await catalog('LARGE', 999999999);
  assert.equal((await command(admin, { type: 'invoice.issue', lines: [{ serviceId: large, serviceRevision: 1, quantity: 2 }] })).json().code, 'AMOUNT_LIMIT');
  const max = await command(admin, { type: 'invoice.issue', lines: [{ serviceId: large, serviceRevision: 1, quantity: 1 }] }); assert.equal(max.statusCode, 200);
  assert.equal((await command(admin, issueCommand())).json().code, 'AMOUNT_LIMIT');
  await command(admin, { type: 'invoice.void', invoiceId: max.json().invoiceId, expectedRevision: 1, reason: 'Correct large fictional bill' });
  assert.equal((await command(admin, issueCommand())).statusCode, 200);
  await app.inject({ method: 'POST', url: '/api/configuration/commands', headers: headers(admin), payload: { type: 'department.update', id: departmentId, expectedRevision: 1, name: 'Retired', active: false } });
  assert.equal((await command(admin, issueCommand())).json().code, 'STALE_SERVICE');
});
test('same-key concurrent payment records once; actor/payload conflicts and stale competing payments cannot overpay', async () => {
  const invoiceId = await issue(); const key: string = randomUUID(); const input = payCommand(invoiceId, 10000);
  const duplicates = await Promise.all([command(cashier, input, key), command(cashier, input, key)]);
  assert.ok(duplicates.every(r => r.statusCode === 200)); assert.equal(duplicates[0].json().receiptId, duplicates[1].json().receiptId);
  assert.equal((await command(admin, input, key)).json().code, 'IDEMPOTENCY_CONFLICT');
  assert.equal((await command(cashier, payCommand(invoiceId, 9999), key)).json().code, 'IDEMPOTENCY_CONFLICT');
  assert.equal((await command(cashier, payCommand(invoiceId, 20000, 2))).json().code, 'OVERPAYMENT');
  const racing = await Promise.all([command(cashier, payCommand(invoiceId, 10000, 2)), command(cashier, payCommand(invoiceId, 10000, 2))]);
  assert.deepEqual(racing.map(r => r.statusCode).sort(), [200, 409]);
  assert.equal((await get(cashier, `/api/billing/invoices/${invoiceId}`)).json().invoice.paidMinor, 20000);
  assert.equal((await pool.query('SELECT * FROM billing_receipts')).rowCount, 2);
});
test('simultaneous issue retries return one invoice; void/payment race records only one transition', async () => {
  const key: string = randomUUID(); const input = issueCommand();
  const issued = await Promise.all([command(admin, input, key), command(admin, input, key)]);
  assert.ok(issued.every(response => response.statusCode === 200));
  assert.equal(issued[0].json().invoiceId, issued[1].json().invoiceId);
  assert.equal((await pool.query('SELECT * FROM billing_invoices')).rowCount, 1);
  assert.equal((await command(cashier, input, key)).json().code, 'IDEMPOTENCY_CONFLICT');
  const invoiceId = issued[0].json().invoiceId;
  const race = await Promise.all([
    command(admin, { type: 'invoice.void', invoiceId, expectedRevision: 1, reason: 'Fictional correction' }),
    command(cashier, payCommand(invoiceId)),
  ]);
  assert.deepEqual(race.map(response => response.statusCode).sort(), [200, 409]);
  const detail = (await get(admin, `/api/billing/invoices/${invoiceId}`)).json();
  assert.equal(detail.invoice.revision, 2); assert.equal(detail.events.length, 2);
  if (detail.invoice.status === 'void') assert.equal(detail.invoice.paidMinor, 0);
  else assert.equal(detail.invoice.paidMinor, 100);
});
test('twenty unique zero-price lines permit quantity 100 and an inactive service cannot be issued', async () => {
  const lines = [];
  for (let i = 0; i < 20; i++) lines.push({ serviceId: await catalog(`FREE${i}`, 0), serviceRevision: 1, quantity: 100 });
  const issued = await command(admin, { type: 'invoice.issue', lines }); assert.equal(issued.statusCode, 200, issued.body);
  const detail = (await get(admin, `/api/billing/invoices/${issued.json().invoiceId}`)).json();
  assert.equal(detail.lines.length, 20); assert.equal(detail.invoice.totalMinor, 0);
  assert.equal((await command(cashier, payCommand(detail.invoice.id, 1))).json().code, 'OVERPAYMENT');
  await app.inject({ method: 'POST', url: '/api/configuration/commands', headers: headers(admin), payload: { type: 'service.update', id: serviceId, expectedRevision: 1, name: 'Retired service', departmentId, priceMinor: 12345, active: false } });
  assert.equal((await command(admin, { type: 'invoice.issue', lines: [{ serviceId, serviceRevision: 2, quantity: 1 }] })).json().code, 'STALE_SERVICE');
});
test('audit failure rolls back payments, receipt, counters and retry key before exact retry', async () => {
  const invoiceId = await issue(); const key: string = randomUUID(); const input = payCommand(invoiceId);
  await pool.query("ALTER TABLE billing_events ADD CONSTRAINT reject_test CHECK(action<>'payment.record')");
  try {
    assert.equal((await command(cashier, input, key)).statusCode, 500);
    assert.equal((await pool.query('SELECT * FROM billing_payments')).rowCount, 0); assert.equal((await pool.query('SELECT * FROM billing_receipts')).rowCount, 0);
    assert.equal((await pool.query('SELECT * FROM billing_requests WHERE idempotency_key=$1', [key])).rowCount, 0);
    assert.equal((await pool.query('SELECT next_receipt FROM billing_counters')).rows[0].next_receipt, '1');
  } finally { await pool.query('ALTER TABLE billing_events DROP CONSTRAINT reject_test'); }
  const retry = await command(cashier, input, key); assert.equal(retry.statusCode, 200); assert.equal(retry.json().receiptNumber, 'RCT-000001');
});
test('invoice audit failure leaves no header, lines, counter or retry record', async () => {
  await pool.query("ALTER TABLE billing_events ADD CONSTRAINT reject_issue CHECK(action<>'invoice.issue')");
  try {
    assert.equal((await command(admin, issueCommand())).statusCode, 500);
    for (const table of ['billing_invoices','billing_lines','billing_counters','billing_requests']) assert.equal((await pool.query(`SELECT * FROM ${table}`)).rowCount, 0);
  } finally { await pool.query('ALTER TABLE billing_events DROP CONSTRAINT reject_issue'); }
});
test('all ledger rows reject SQL update/delete and incomplete direct ledgers roll back', async () => {
  const invoiceId = await issue(); await command(cashier, payCommand(invoiceId));
  for (const table of ['billing_invoices','billing_lines','billing_payments','billing_receipts','billing_events','billing_requests']) {
    await assert.rejects(pool.query(`UPDATE ${table} SET hospital_id=hospital_id`), /immutable/);
    await assert.rejects(pool.query(`DELETE FROM ${table}`), /immutable/);
  }
  await assert.rejects(pool.query("UPDATE outpatient_visits SET data=jsonb_set(data,'{financialMode}','\"legacy_demo\"') WHERE id=$1", [visitId]), /immutable/);
  await assert.rejects(pool.query('INSERT INTO billing_payments(id,hospital_id,invoice_id,amount_minor,method,reference,actor_id,actor_name) VALUES($1,$2,$3,1,$4,$5,$6,$7)', [randomUUID(), admin.hospital, invoiceId, 'cash', '', admin.id, 'Fictional']), /event and receipt/);
  assert.equal((await pool.query('SELECT * FROM billing_payments')).rowCount, 1);
});
test('hospital, role, session and request security cover every billing surface', async () => {
  const invoiceId = await issue();
  for (const path of [`/api/visits/${visitId}/billing`, `/api/billing/invoices/${invoiceId}`]) {
    assert.equal((await get(other, path)).statusCode, 404); assert.equal((await get(clinician, path)).statusCode, 403);
    assert.equal((await app.inject({ url: path })).statusCode, 401);
  }
  assert.equal((await command(other, issueCommand())).statusCode, 404);
  assert.equal((await command(clinician, issueCommand())).statusCode, 403); assert.equal((await command(auditor, issueCommand())).statusCode, 403);
  const foreignVisit = await newVisit(other); assert.equal((await command(other, issueCommand(), randomUUID(), foreignVisit)).json().code, 'STALE_SERVICE');
  const sameHospitalVisit = await newVisit(); assert.equal((await command(admin, payCommand(invoiceId), randomUUID(), sameHospitalVisit)).statusCode, 404);
  for (const h of [{ cookie: admin.cookie }, { ...headers(admin), origin: 'https://evil.invalid' }, { ...headers(admin), 'x-csrf-token': 'wrong' }]) assert.equal((await app.inject({ method: 'POST', url: `/api/visits/${visitId}/billing/commands`, headers: h, payload: issueCommand() })).statusCode, 403);
  for (const path of [`/api/visits/${visitId}/billing?page=0`, `/api/visits/${visitId}/billing?hospitalId=${other.hospital}`, `/api/billing/invoices/${invoiceId}?extra=1`]) assert.equal((await get(admin, path)).statusCode, 400);
  await pool.query('UPDATE staff_users SET password_change_required=true WHERE id=$1', [cashier.id]);
  assert.equal((await command(cashier, payCommand(invoiceId))).json().code, 'PASSWORD_CHANGE_REQUIRED');
});
test('historical visits remain demonstrations and reject all catalog ledger commands', async () => {
  const legacy = await newVisit(admin, true); const before = (await pool.query('SELECT data FROM outpatient_visits WHERE id=$1', [legacy])).rows[0].data;
  const view = (await get(admin, `/api/visits/${legacy}`)).json().visit; assert.equal(view.financialMode, 'legacy_demo'); assert.equal(view.balance, 25000);
  for (const value of [issueCommand(), payCommand(randomUUID()), { type: 'invoice.void', invoiceId: randomUUID(), expectedRevision: 1, reason: 'Denied' } as const]) assert.equal((await command(admin, value, randomUUID(), legacy)).json().code, 'LEGACY_DEMO');
  assert.deepEqual((await pool.query('SELECT data FROM outpatient_visits WHERE id=$1', [legacy])).rows[0].data, before);
  assert.equal((await pool.query('SELECT * FROM billing_invoices')).rowCount, 0);
});
test('invoice and event histories paginate at 25 with stable identities', async () => {
  const invoiceId = await issue();
  for (let revision = 1; revision <= 26; revision++) assert.equal((await command(cashier, payCommand(invoiceId, 1, revision))).statusCode, 200);
  assert.equal((await get(auditor, `/api/billing/invoices/${invoiceId}`)).json().events.length, 25);
  const detail = (await get(auditor, `/api/billing/invoices/${invoiceId}?page=2`)).json(); assert.equal(detail.events.length, 2); assert.equal(detail.total, 27);
  for (let count = 0; count < 26; count++) await issue();
  const page = (await get(auditor, `/api/visits/${visitId}/billing?page=2`)).json(); assert.equal(page.invoices.length, 2); assert.equal(page.total, 27); assert.deepEqual(page.permissions, { issue: false, pay: false, void: false });
});
async function waitForLock(mode: 'UPDATE' | 'SHARE') {
  for (let attempt = 0; attempt < 200; attempt++) {
    if ((await database.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND query LIKE $2 AND wait_event_type='Lock'", [schema, `SELECT id FROM hospitals%FOR ${mode}`])).rowCount) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Billing request did not wait for hospital lock.');
}
test('waiting reads and writes reject revocation, role changes, password replacement and expiry', async () => {
  const invoiceId = await issue();
  for (const mode of ['UPDATE', 'SHARE'] as const) for (const change of ['revoke', 'role', 'password', 'expiry']) {
    const user = await actor(admin.hospital, 'cashier'); const blocker = await pool.connect();
    await blocker.query('BEGIN'); await blocker.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [admin.hospital]);
    const pending = (mode === 'UPDATE' ? command(user, payCommand(invoiceId)) : get(user, `/api/billing/invoices/${invoiceId}`)).then(r => r);
    try {
      await waitForLock(mode);
      if (change === 'revoke') await blocker.query('UPDATE staff_users SET active=false WHERE id=$1', [user.id]);
      if (change === 'role') await blocker.query("UPDATE staff_users SET role='clinician' WHERE id=$1", [user.id]);
      if (change === 'password') await blocker.query('UPDATE staff_users SET password_change_required=true WHERE id=$1', [user.id]);
      if (change === 'expiry') await blocker.query('UPDATE staff_sessions SET expires_at=clock_timestamp() WHERE user_id=$1', [user.id]);
      await blocker.query('COMMIT'); assert.equal((await pending).statusCode, 401);
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
  }
  assert.equal((await pool.query('SELECT * FROM billing_payments')).rowCount, 0);
});
test('restricted runtime needs insert-only ledger access; SQL immutability and hospital scope hold', async () => {
  const role = `${schema}_runtime`; await database.query(`CREATE ROLE ${role} NOLOGIN`);
  const restricted = new pg.Pool({ connectionString, options: `-c search_path=${schema} -c role=${role}` }); const restrictedApp = buildApp({ pool: restricted, origin });
  try {
    await database.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    await database.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
    await pool.query(`GRANT UPDATE ON hospitals,billing_counters TO ${role}`);
    await pool.query(`GRANT INSERT ON billing_counters,billing_invoices,billing_lines,billing_payments,billing_receipts,billing_events,billing_requests TO ${role}`);
    const issue = await restrictedApp.inject({ method: 'POST', url: `/api/visits/${visitId}/billing/commands`, headers: headers(cashier), payload: issueCommand() }); assert.equal(issue.statusCode, 200, issue.body);
    const payment = await restrictedApp.inject({ method: 'POST', url: `/api/visits/${visitId}/billing/commands`, headers: headers(cashier), payload: payCommand(issue.json().invoiceId) }); assert.equal(payment.statusCode, 200, payment.body);
    await assert.rejects(restricted.query('UPDATE billing_invoices SET number=number'), /permission denied/);
    await assert.rejects(restricted.query('DELETE FROM billing_payments'), /permission denied/);
  } finally {
    await restrictedApp.close(); await restricted.end();
    await database.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${schema} FROM ${role}`); await database.query(`REVOKE USAGE ON SCHEMA ${schema} FROM ${role}`); await database.query(`DROP ROLE ${role}`);
  }
});
