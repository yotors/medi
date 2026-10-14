import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { buildApp } from './app.ts';
import { digest, hashPassword } from './auth.ts';
import { migrate } from './db.ts';
import { provisionStaff } from './setup.ts';
import type { StaffRole } from '../shared/registration.ts';
import { execute } from '../src/domain.ts';
import type { VisitCommand, VisitView } from '../shared/outpatient.ts';

const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('PostgreSQL integration tests require TEST_DATABASE_URL or DATABASE_URL.');
const schema = `outpatient_test_${randomUUID().replaceAll('-', '')}`;
const database = new pg.Pool({ connectionString });
const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}` });
const origin = 'http://127.0.0.1:5173';
const password = 'Synthetic-outpatient-password-42';
const roles: StaffRole[] = ['admin', 'receptionist', 'clinician', 'lab', 'pharmacist', 'cashier', 'auditor'];
let app = buildApp({ pool, origin });
type Auth = { cookie: string; csrf: string; id: string; hospitalId: string };
let auth: Record<StaffRole, Auth>;
let other: Auth;
async function login(role: StaffRole, hospitalCode = 'alpha'): Promise<Auth> {
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin }, payload: { hospitalCode, username: role, password } });
  assert.equal(response.statusCode, 200, response.body);
  return { cookie: String(response.headers['set-cookie']).split(';')[0], csrf: response.json().csrfToken,
    id: response.json().user.id, hospitalId: response.json().user.hospital.id };
}
const headers = (user: Auth, key: string = randomUUID()) => ({ origin, cookie: user.cookie, 'x-csrf-token': user.csrf, 'idempotency-key': key });
const get = (user: Auth, url: string) => app.inject({ url, headers: { cookie: user.cookie } });
const checkIn = (user: Auth, id: string, key: string = randomUUID(), payload: unknown = {}) => app.inject({ method: 'POST', url: `/api/patients/${id}/visits`, headers: headers(user, key), payload: payload as object });
const command = (user: Auth, visit: Pick<VisitView, 'id' | 'revision'>, value: VisitCommand, key: string = randomUUID()) => app.inject({
  method: 'POST', url: `/api/visits/${visit.id}/commands`, headers: headers(user, key), payload: { expectedRevision: visit.revision, command: value },
});
async function patient(user = auth.receptionist, name = 'Synthetic Outpatient') {
  const response = await app.inject({ method: 'POST', url: '/api/patients', headers: headers(user), payload: { name, age: 33, contact: 'fictional contact' } });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().patient;
}
async function visit(legacy = false): Promise<VisitView> {
  const p = await patient();
  if (legacy) {
    const state = execute({ version: 1, revision: 0, patients: [p], visits: [], events: [] }, { type: 'checkIn', patientId: p.id });
    const v = state.visits[0];
    await pool.query('INSERT INTO outpatient_visits(id,hospital_id,patient_id,revision,status,opened_at,data) VALUES($1,$2,$3,1,$4,$5,$6)', [v.id, auth.admin.hospitalId, p.id, v.status, v.openedAt, JSON.stringify(v)]);
    await pool.query("INSERT INTO audit_events(id,hospital_id,actor_id,patient_id,action,visit_id,visit_revision,detail) VALUES($1,$2,$3,$4,'visit.checkIn',$5,1,'Historical demonstration check-in')", [randomUUID(), auth.admin.hospitalId, auth.admin.id, p.id, v.id]);
    return (await get(auth.admin, `/api/visits/${v.id}`)).json().visit;
  }
  const response = await checkIn(auth.admin, p.id);
  assert.equal(response.statusCode, 201, response.body); return response.json().visit;
}
async function apply(user: Auth, v: VisitView, value: VisitCommand): Promise<VisitView> {
  const response = await command(user, v, value);
  assert.equal(response.statusCode, 200, response.body); return response.json().visit;
}
function assertSummary(v: VisitView, stage: string, investigations = 0, prescriptions = 0) {
  assert.deepEqual([v.stage, v.pendingInvestigations, v.pendingPrescriptions], [stage, investigations, prescriptions]);
}

before(async () => {
  await database.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
  const hash = await hashPassword(password);
  for (const code of ['alpha', 'beta']) {
    const hospitalId = randomUUID();
    await pool.query('INSERT INTO hospitals(id,code,name) VALUES ($1,$2,$3)', [hospitalId, code, `${code} Synthetic Hospital`]);
    for (const role of roles) await pool.query(`INSERT INTO staff_users(id,hospital_id,username,display_name,role,password_hash)
      VALUES ($1,$2,$3,$4,$5,$6)`, [randomUUID(), hospitalId, role, `Synthetic ${role}`, role, hash]);
  }
  auth = {} as Record<StaffRole, Auth>;
  for (const role of roles) auth[role] = await login(role);
  other = await login('admin', 'beta');
});
beforeEach(async () => {
  await pool.query('TRUNCATE outpatient_requests,outpatient_visits,audit_events,registration_requests,patients CASCADE');
});
after(async () => {
  await app.close(); await pool.end(); await database.query(`DROP SCHEMA ${schema} CASCADE`); await database.end();
});

test('department handoffs persist a complete closed visit and attributable history across restart', async () => {
  const p = await patient();
  const start = await checkIn(auth.receptionist, p.id);
  assert.equal(start.statusCode, 201);
  let v: VisitView = start.json().visit;
  assert.equal(v.revision, 1); assert.equal(v.balance, 0); assert.equal(v.financialMode, 'catalog'); assert.equal(v.billing?.state, 'unbilled');
  assertSummary(v, 'Consultation');
  v = await apply(auth.clinician, v, { type: 'note', body: 'Synthetic consultation text' });
  assertSummary(v, 'Ready to close');
  v = await apply(auth.clinician, v, { type: 'order', test: 'Blood count' });
  assertSummary(v, 'Diagnostics', 1);
  const orderId = v.orders![0].id;
  v = await apply(auth.lab, v, { type: 'advanceOrder', orderId, next: 'collected' });
  assertSummary(v, 'Diagnostics', 1);
  v = await apply(auth.lab, v, { type: 'advanceOrder', orderId, next: 'released', result: 'Synthetic result text' });
  assertSummary(v, 'Diagnostics', 1);
  v = await apply(auth.clinician, v, { type: 'advanceOrder', orderId, next: 'reviewed' });
  assertSummary(v, 'Ready to close');
  v = await apply(auth.clinician, v, { type: 'prescribe', instruction: 'Synthetic prescription text' });
  assertSummary(v, 'Pharmacy', 0, 1);
  v = await apply(auth.pharmacist, v, { type: 'fulfill', prescriptionId: v.prescriptions![0].id, next: 'fulfilled' });
  assertSummary(v, 'Ready to close');
  assert.equal((await command(auth.cashier, v, { type: 'settle' })).statusCode, 409);
  assertSummary(v, 'Ready to close');
  assert.equal((await get(auth.admin, `/api/visits/${v.id}`)).json().visit.payments.length, 0);
  v = await apply(auth.clinician, v, { type: 'close' });
  assert.equal(v.status, 'closed'); assert.deepEqual(v.blockers, []); assert.deepEqual(v.allowedActions, []);
  assertSummary(v, 'Closed');
  await app.close(); app = buildApp({ pool, origin });
  const persisted = (await get(auth.admin, `/api/visits/${v.id}`)).json().visit;
  assert.equal(persisted.revision, 9); assert.equal(persisted.history.length, 9);
  assert.equal(persisted.notes[0].body, 'Synthetic consultation text');
  assert.equal(persisted.orders[0].result, 'Synthetic result text');
  assert.equal(persisted.prescriptions[0].status, 'fulfilled');
  assert.equal((await get(auth.admin, '/api/visits')).json().total, 0);
  const closedQueue = (await get(auth.admin, '/api/visits?status=closed')).json();
  assert.equal(closedQueue.total, 1); assertSummary(closedQueue.visits[0], 'Closed');
  const events = (await pool.query('SELECT * FROM audit_events WHERE visit_id=$1 ORDER BY visit_revision', [v.id])).rows;
  assert.deepEqual(events.map(e => e.actor_id), ['receptionist','clinician','clinician','lab','lab','clinician','clinician','pharmacist','clinician'].map(role => auth[role as StaffRole].id));
  assert.deepEqual(events.map(e => [e.subject_type, e.subject_id, e.transition_from, e.transition_to]), [
    ['visit', v.id, null, 'active'], ['note', persisted.notes[0].id, null, 'saved'],
    ['investigation', orderId, null, 'requested'], ['investigation', orderId, 'requested', 'collected'],
    ['investigation', orderId, 'collected', 'released'], ['investigation', orderId, 'released', 'reviewed'],
    ['prescription', persisted.prescriptions[0].id, null, 'pending'], ['prescription', persisted.prescriptions[0].id, 'pending', 'fulfilled'],
    ['visit', v.id, 'active', 'closed'],
  ]);
  assert.doesNotMatch(JSON.stringify(events), /Synthetic consultation text|Synthetic result text|Synthetic prescription text/);
  for (const event of persisted.history) assert.deepEqual(Object.keys(event).sort(), ['actor','at','detail','id']);
  for (const value of [{ type: 'note', body: 'Cannot change closed' }, { type: 'settle' }, { type: 'close' }] as VisitCommand[]) {
    assert.equal((await command(auth.admin, v, value)).statusCode, 409);
  }
  await assert.rejects(pool.query("UPDATE outpatient_visits SET revision=revision+1 WHERE id=$1", [v.id]), /immutable/);
  assert.equal((await checkIn(auth.receptionist, p.id)).statusCode, 201);
});

test('role projections contain only authorized sections; queue never exposes clinical text', async () => {
  let v = await visit();
  v = await apply(auth.admin, v, { type: 'note', body: 'SECRET CONSULTATION' });
  v = await apply(auth.admin, v, { type: 'order', test: 'Urinalysis' });
  const orderId = v.orders![0].id;
  v = await apply(auth.admin, v, { type: 'advanceOrder', orderId, next: 'collected' });
  v = await apply(auth.admin, v, { type: 'advanceOrder', orderId, next: 'released', result: 'SECRET RESULT' });
  v = await apply(auth.admin, v, { type: 'prescribe', instruction: 'SECRET PRESCRIPTION' });
  const keys = ['notes', 'orders', 'prescriptions', 'charges', 'payments', 'history'];
  const permitted: Record<StaffRole, string[]> = { admin: keys, receptionist: [], clinician: ['notes','orders','prescriptions'], lab: ['orders'], pharmacist: ['prescriptions'], cashier: ['charges','payments'], auditor: ['charges','payments','history'] };
  for (const role of roles) {
    const response = await get(auth[role], `/api/visits/${v.id}`);
    assert.equal(response.statusCode, 200);
    const view = response.json().visit;
    assert.deepEqual(keys.filter(key => key in view), permitted[role]);
    const queue = await get(auth[role], '/api/visits?status=all');
    assert.equal(queue.json().total, 1); assert.doesNotMatch(queue.body, /SECRET|"(?:notes|orders|prescriptions|payments|charges|history)":/);
    assert.equal(queue.headers['cache-control'], 'no-store');
  }
});

test('every command role boundary denies unauthorized mutations and hospital IDs stay isolated', async () => {
  const v = await visit();
  const cases: [VisitCommand, StaffRole[]][] = [
    [{ type: 'note', body: 'Forbidden text' }, ['admin','clinician']],
    [{ type: 'order', test: 'Blood count' }, ['admin','clinician']],
    [{ type: 'prescribe', instruction: 'Forbidden text' }, ['admin','clinician']],
    [{ type: 'advanceOrder', orderId: randomUUID(), next: 'collected' }, ['admin','lab']],
    [{ type: 'advanceOrder', orderId: randomUUID(), next: 'released', result: 'Forbidden text' }, ['admin','lab']],
    [{ type: 'advanceOrder', orderId: randomUUID(), next: 'reviewed' }, ['admin','clinician']],
    [{ type: 'advanceOrder', orderId: randomUUID(), next: 'cancelled' }, ['admin','clinician']],
    [{ type: 'fulfill', prescriptionId: randomUUID(), next: 'cancelled' }, ['admin','pharmacist']],
    [{ type: 'settle' }, ['admin','cashier']], [{ type: 'close' }, ['admin','clinician']],
  ];
  for (const [value, allowed] of cases) for (const role of roles.filter(role => !allowed.includes(role))) {
    assert.equal((await command(auth[role], v, value)).statusCode, 403, `${role} ${value.type}`);
  }
  for (const role of roles.filter(role => !['receptionist','admin'].includes(role))) assert.equal((await checkIn(auth[role], v.patient.id)).statusCode, 403);
  assert.equal((await get(other, `/api/visits/${v.id}`)).statusCode, 404);
  assert.equal((await checkIn(other, v.patient.id)).statusCode, 404);
  assert.equal((await command(other, v, { type: 'settle' })).statusCode, 404);
  assert.equal((await get(other, '/api/visits?status=all')).json().total, 0);
  assert.equal((await pool.query('SELECT count(*)::integer AS n FROM audit_events WHERE visit_id=$1', [v.id])).rows[0].n, 1);
});

test('concurrent check-ins serialize to one active visit and one event with or without a shared key', async () => {
  const p = await patient(); const key = randomUUID();
  const repeated = await Promise.all(Array.from({ length: 5 }, () => checkIn(auth.receptionist, p.id, key)));
  assert.deepEqual(repeated.map(r => r.statusCode).sort(), [200,200,200,200,201]);
  assert.equal(new Set(repeated.map(r => r.json().visit.id)).size, 1);
  const p2 = await patient(auth.receptionist, 'Another synthetic');
  const competing = await Promise.all(Array.from({ length: 5 }, () => checkIn(auth.receptionist, p2.id)));
  assert.deepEqual(competing.map(r => r.statusCode).sort(), [201,409,409,409,409]);
  assert.equal((await pool.query('SELECT * FROM outpatient_visits')).rowCount, 2);
  assert.equal((await pool.query("SELECT * FROM audit_events WHERE action='visit.checkIn'")).rowCount, 2);
  assert.equal((await checkIn(auth.receptionist, p2.id, key)).json().code, 'IDEMPOTENCY_CONFLICT');
});

test('legacy concurrent note/payment keys have one effect; retries work after revisions advance', async () => {
  const initial = await visit(true); const key = randomUUID();
  const value: VisitCommand = { type: 'note', body: 'Exactly one note' };
  const saves = await Promise.all(Array.from({ length: 5 }, () => command(auth.clinician, initial, value, key)));
  assert.ok(saves.every(r => r.statusCode === 200));
  let v: VisitView = saves[0].json().visit;
  assert.equal(v.notes!.length, 1); assert.equal(v.revision, 2);
  const beforePayment = v;
  const paymentKey = randomUUID();
  const payments = await Promise.all(Array.from({ length: 5 }, () => command(auth.cashier, v, { type: 'settle' }, paymentKey)));
  assert.ok(payments.every(r => r.statusCode === 200));
  v = payments[0].json().visit;
  assert.equal(v.payments!.length, 1); assert.equal(v.revision, 3);
  v = await apply(auth.clinician, v, { type: 'close' });
  const paymentRetry = await command(auth.cashier, beforePayment, { type: 'settle' }, paymentKey);
  assert.equal(paymentRetry.statusCode, 200); assert.equal(paymentRetry.json().visit.status, 'closed');
  assert.equal(paymentRetry.json().visit.payments.length, 1);
  const retry = await command(auth.clinician, initial, value, key);
  assert.equal(retry.statusCode, 200); assert.equal(retry.json().visit.revision, 4);
  assert.equal(retry.json().visit.notes.length, 1);
  const changed = await command(auth.clinician, initial, { ...value, body: 'Changed' }, key);
  assert.equal(changed.statusCode, 409); assert.equal(changed.json().code, 'IDEMPOTENCY_CONFLICT');
  const alteredRevision = await command(auth.clinician, v, value, key);
  assert.equal(alteredRevision.json().code, 'IDEMPOTENCY_CONFLICT');
  assert.equal((await pool.query('SELECT * FROM audit_events WHERE visit_id=$1', [v.id])).rowCount, 4);
  const subjects = (await pool.query("SELECT subject_type,subject_id,actor_id FROM audit_events WHERE visit_id=$1 AND subject_type IN ('note','payment') ORDER BY visit_revision", [v.id])).rows;
  assert.deepEqual(subjects, [
    { subject_type: 'note', subject_id: beforePayment.notes![0].id, actor_id: auth.clinician.id },
    { subject_type: 'payment', subject_id: paymentRetry.json().visit.payments[0].id, actor_id: auth.cashier.id },
  ]);
});

test('stale commands lose no writes and concurrent distinct commands yield one revision winner', async () => {
  const v = await visit();
  const responses = await Promise.all(['One','Two'].map(body => command(auth.clinician, v, { type: 'note', body })));
  assert.deepEqual(responses.map(r => r.statusCode).sort(), [200,409]);
  assert.equal(responses.find(r => r.statusCode === 409)!.json().code, 'STALE_REVISION');
  assert.equal((await get(auth.clinician, `/api/visits/${v.id}`)).json().visit.notes.length, 1);
  assert.equal((await pool.query('SELECT * FROM outpatient_requests WHERE visit_id=$1', [v.id])).rowCount, 2);
});

test('legacy unresolved closure is blocked, cancellations follow existing charge rules and released results cannot change', async () => {
  let v = await visit(true);
  const blocked = await command(auth.clinician, v, { type: 'close' });
  assert.equal(blocked.statusCode, 409); assert.match(blocked.json().message, /consultation note|balance/);
  v = await apply(auth.admin, v, { type: 'order', test: 'Blood glucose' });
  assertSummary(v, 'Consultation', 1);
  const firstId = v.orders![0].id;
  v = await apply(auth.clinician, v, { type: 'advanceOrder', orderId: firstId, next: 'cancelled' });
  assert.equal(v.balance, 25000);
  assertSummary(v, 'Consultation');
  v = await apply(auth.admin, v, { type: 'order', test: 'Blood count' });
  const orderId = v.orders![1].id;
  v = await apply(auth.admin, v, { type: 'advanceOrder', orderId, next: 'collected' });
  v = await apply(auth.admin, v, { type: 'advanceOrder', orderId, next: 'released', result: 'Locked result' });
  assertSummary(v, 'Consultation', 1);
  assert.equal((await command(auth.admin, v, { type: 'advanceOrder', orderId, next: 'released', result: 'Overwrite' })).statusCode, 409);
  assert.equal((await command(auth.admin, v, { type: 'advanceOrder', orderId, next: 'cancelled' })).statusCode, 409);
  const tampered = structuredClone((await pool.query('SELECT data FROM outpatient_visits WHERE id=$1', [v.id])).rows[0].data);
  tampered.orders[1].result = 'Tampered result';
  await assert.rejects(pool.query('UPDATE outpatient_visits SET data=$2 WHERE id=$1', [v.id, JSON.stringify(tampered)]), /immutable/);
  v = await apply(auth.clinician, v, { type: 'advanceOrder', orderId, next: 'reviewed' });
  assertSummary(v, 'Consultation');
  v = await apply(auth.clinician, v, { type: 'note', body: 'Reviewed fictional consultation' });
  assertSummary(v, 'Billing');
  v = await apply(auth.clinician, v, { type: 'prescribe', instruction: 'Cancel fictional prescription' });
  assertSummary(v, 'Pharmacy', 0, 1);
  v = await apply(auth.pharmacist, v, { type: 'fulfill', prescriptionId: v.prescriptions![0].id, next: 'cancelled' });
  assertSummary(v, 'Billing');
  v = await apply(auth.cashier, v, { type: 'settle' });
  assertSummary(v, 'Ready to close');
  v = await apply(auth.clinician, v, { type: 'close' });
  assert.equal(v.status, 'closed');
  assertSummary(v, 'Closed');
});

test('audit failure atomically rolls back check-in/command/receipt and exact retry succeeds', async () => {
  const p = await patient(); const checkKey = randomUUID();
  await pool.query("ALTER TABLE audit_events ADD CONSTRAINT reject_outpatient CHECK (action='patient.registered')");
  try {
    assert.equal((await checkIn(auth.admin, p.id, checkKey)).statusCode, 500);
    assert.equal((await pool.query('SELECT * FROM outpatient_visits')).rowCount, 0);
    assert.equal((await pool.query('SELECT * FROM outpatient_requests')).rowCount, 0);
  } finally { await pool.query('ALTER TABLE audit_events DROP CONSTRAINT reject_outpatient'); }
  const v: VisitView = (await checkIn(auth.admin, p.id, checkKey)).json().visit;
  const key = randomUUID();
  await pool.query("ALTER TABLE audit_events ADD CONSTRAINT reject_note CHECK (action<>'visit.note')");
  try {
    const response = await command(auth.clinician, v, { type: 'note', body: 'Private rollback text' }, key);
    assert.equal(response.statusCode, 500); assert.doesNotMatch(response.body, /Private|constraint|INSERT/);
    const persisted = (await get(auth.admin, `/api/visits/${v.id}`)).json().visit;
    assert.equal(persisted.revision, 1); assert.equal(persisted.notes.length, 0);
    assert.equal((await pool.query('SELECT * FROM outpatient_requests')).rowCount, 1);
    assert.equal((await pool.query("SELECT * FROM audit_events WHERE subject_type='note'")).rowCount, 0);
  } finally { await pool.query('ALTER TABLE audit_events DROP CONSTRAINT reject_note'); }
  const retry = await command(auth.clinician, v, { type: 'note', body: 'Private rollback text' }, key);
  assert.equal(retry.statusCode, 200); assert.equal(retry.json().visit.notes.length, 1);
  assert.deepEqual((await pool.query("SELECT subject_id,actor_id FROM audit_events WHERE subject_type='note'")).rows,
    [{ subject_id: retry.json().visit.notes[0].id, actor_id: auth.clinician.id }]);
});

test('strict validation, session, Origin and CSRF checks apply to every outpatient mutation', async () => {
  const v = await visit();
  const url = `/api/visits/${v.id}/commands`;
  const body = { expectedRevision: v.revision, command: { type: 'note', body: 'Synthetic note' } };
  for (const payload of [
    { ...body, extra: true }, { ...body, expectedRevision: -1 }, { ...body, expectedRevision: 1.5 },
    { ...body, command: { type: 'note', body: 'bad\0value' } }, { ...body, command: { type: 'note', body: '' } },
    { ...body, command: { type: 'note', body: 'x'.repeat(4001) } }, { ...body, command: { type: 'note', body: 'valid', visitId: v.id } },
    { ...body, command: { type: 'advanceOrder', orderId: 'invalid', next: 'released', result: 'test' } },
    { ...body, command: { type: 'advanceOrder', orderId: randomUUID(), next: 'released', result: '\0' } },
  ]) assert.equal((await app.inject({ method: 'POST', url, headers: headers(auth.admin), payload })).statusCode, 400);
  for (const query of ['extra=1','page=0','page=10001','q=%00','status=invalid']) assert.equal((await get(auth.admin, `/api/visits?${query}`)).statusCode, 400);
  assert.equal((await get(auth.admin, `/api/visits/${v.id}?extra=1`)).statusCode, 400);
  assert.equal((await get(auth.admin, '/api/visits/not-a-uuid')).statusCode, 404);
  assert.equal((await checkIn(auth.admin, v.patient.id, randomUUID(), { extra: true })).statusCode, 400);
  assert.equal((await command(auth.admin, v, { type: 'settle' }, 'invalid')).statusCode, 400);
  for (const override of [{ origin: 'http://evil.invalid' }, { 'x-csrf-token': 'incorrect' }]) {
    assert.equal((await app.inject({ method: 'POST', url, headers: { ...headers(auth.admin), ...override }, payload: body })).statusCode, 403);
  }
  assert.equal((await app.inject('/api/visits')).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url, headers: { origin }, payload: body })).statusCode, 401);
  // Maximum-length Unicode text remains valid despite exceeding 4 KiB in UTF-8.
  assert.equal((await command(auth.clinician, v, { type: 'note', body: 'ሀ'.repeat(4000) })).statusCode, 200);
});

test('queue pagination and literal normalized search stay stable and hospital scoped', async () => {
  for (let i = 0; i < 27; i++) { const p = await patient(auth.receptionist, `Synthetic ${i}`); assert.equal((await checkIn(auth.receptionist, p.id)).statusCode, 201); }
  const first = (await get(auth.admin, '/api/visits')).json();
  const second = (await get(auth.admin, '/api/visits?page=2')).json();
  assert.equal(first.total, 27); assert.equal(first.pageSize, 25); assert.equal(first.visits.length, 25); assert.equal(second.visits.length, 2);
  assert.equal(new Set([...first.visits, ...second.visits].map(v => v.id)).size, 27);
  for (const query of ['%', '_']) assert.equal((await get(auth.admin, `/api/visits?q=${encodeURIComponent(query)}`)).json().total, 0);
  const p = await patient(auth.receptionist, 'Ｓｙｎｔｈｅｔｉｃ   Ｎｏｒｍａｌ'); await checkIn(auth.receptionist, p.id);
  assert.equal((await get(auth.admin, '/api/visits?q=synthetic%20normal')).json().total, 1);
  assert.equal((await get(other, '/api/visits')).json().total, 0);
});

test('003 rejects missing/null visit identities and null visit audit revisions on direct inserts', async () => {
  const p = await patient();
  for (const field of ['id','patientId','status']) for (const value of [undefined, null]) {
    const id = randomUUID();
    const data = { id, patientId: p.id, status: 'active', [field]: value };
    await assert.rejects(pool.query(`INSERT INTO outpatient_visits(id,hospital_id,patient_id,revision,status,opened_at,data)
      VALUES ($1,$2,$3,1,'active',now(),$4)`, [id, auth.admin.hospitalId, p.id, JSON.stringify(data)]),
    (error: unknown) => error instanceof Error && (error as { code?: string }).code === '23514'
      && (error as { constraint?: string }).constraint === 'outpatient_identity_required');
  }
  assert.equal((await pool.query('SELECT * FROM outpatient_visits')).rowCount, 0);
  const v: VisitView = (await checkIn(auth.admin, p.id)).json().visit;
  await assert.rejects(pool.query(`INSERT INTO audit_events(id,hospital_id,actor_id,patient_id,action,visit_id,visit_revision,detail)
    VALUES ($1,$2,$3,$4,'visit.note',$5,NULL,'Malformed event')`, [randomUUID(), auth.admin.hospitalId, auth.admin.id, p.id, v.id]),
  (error: unknown) => error instanceof Error && (error as { code?: string }).code === '23514'
    && (error as { constraint?: string }).constraint === 'outpatient_audit_revision_required');
  assert.equal((await pool.query('SELECT * FROM audit_events WHERE visit_id=$1', [v.id])).rowCount, 1);
});

test('migrations 002 through 010 preserve populated registration/visit data and legacy audit metadata across replay', async () => {
  const oldSchema = `outpatient_migration_${randomUUID().replaceAll('-', '')}`;
  await database.query(`CREATE SCHEMA ${oldSchema}`);
  const old = new pg.Pool({ connectionString, options: `-c search_path=${oldSchema}` });
  try {
    await old.query('CREATE TABLE registration_migrations(version integer PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
    await old.query(await readFile(new URL('./migrations/001_registration.sql', import.meta.url), 'utf8'));
    await old.query('INSERT INTO registration_migrations(version) VALUES (1)');
    const staff = await provisionStaff(old, { hospitalCode: 'legacy', hospitalName: 'Legacy Synthetic', username: 'admin', displayName: 'Legacy', role: 'admin', password });
    const patientId = randomUUID();
    await old.query("INSERT INTO patients(id,hospital_id,record_number,name,normalized_name) VALUES ($1,$2,'MRN-000001','Legacy patient','legacy patient')", [patientId, staff.hospitalId]);
    await old.query("INSERT INTO audit_events(id,hospital_id,actor_id,patient_id,action) VALUES ($1,$2,$3,$4,'patient.registered')", [randomUUID(), staff.hospitalId, staff.id, patientId]);
    await old.query(await readFile(new URL('./migrations/002_outpatient.sql', import.meta.url), 'utf8'));
    await old.query('INSERT INTO registration_migrations(version) VALUES (2)');
    const legacyVisitId = randomUUID();
    const legacyVisit = { id: legacyVisitId, patientId, status: 'active', openedAt: new Date().toISOString(),
      notes: [], orders: [], prescriptions: [], charges: [], payments: [] };
    await old.query(`INSERT INTO outpatient_visits(id,hospital_id,patient_id,revision,status,opened_at,data)
      VALUES ($1,$2,$3,1,'active',$4,$5)`, [legacyVisitId, staff.hospitalId, patientId, legacyVisit.openedAt, JSON.stringify(legacyVisit)]);
    const legacyEventId = randomUUID();
    await old.query(`INSERT INTO audit_events(id,hospital_id,actor_id,patient_id,action,visit_id,visit_revision,detail)
      VALUES ($1,$2,$3,$4,'visit.checkIn',$5,1,'Legacy check-in')`, [legacyEventId, staff.hospitalId, staff.id, patientId, legacyVisitId]);
    const oldEvents = (await old.query('SELECT id,actor_id,action,visit_id,visit_revision,detail FROM audit_events ORDER BY id')).rows;
    await migrate(old); await migrate(old);
    assert.deepEqual((await old.query('SELECT version FROM registration_migrations ORDER BY version')).rows, [{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }, { version: 7 }, { version: 8 }, { version: 9 }, { version: 10 }]);
    assert.equal((await old.query("SELECT 1 FROM pg_indexes WHERE schemaname=current_schema() AND indexname IN ('configuration_department_search','configuration_service_search')")).rowCount, 0);
    assert.equal((await old.query('SELECT id FROM patients')).rows[0].id, patientId);
    assert.deepEqual((await old.query('SELECT data FROM outpatient_visits WHERE id=$1', [legacyVisitId])).rows[0].data, legacyVisit);
    assert.deepEqual((await old.query('SELECT id,actor_id,action,visit_id,visit_revision,detail FROM audit_events ORDER BY id')).rows, oldEvents);
    assert.deepEqual((await old.query('SELECT subject_type,subject_id,transition_from,transition_to FROM audit_events WHERE id=$1', [legacyEventId])).rows,
      [{ subject_type: null, subject_id: null, transition_from: null, transition_to: null }]);
    for (const role of ['clinician','lab','pharmacist','cashier'] as const) await provisionStaff(old, { hospitalCode: 'legacy', hospitalName: 'Legacy Synthetic', username: role, displayName: role, role, password });
    assert.equal((await old.query('SELECT * FROM staff_users')).rowCount, 5);
  } finally { await old.end(); await database.query(`DROP SCHEMA ${oldSchema} CASCADE`); }
});

async function raceActor(role: 'receptionist' | 'clinician'): Promise<Auth> {
  const id = randomUUID(); const token = randomBytes(32).toString('base64url'); const csrf = randomBytes(32).toString('base64url');
  await pool.query('INSERT INTO staff_users(id,hospital_id,username,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5,$6)',
    [id, auth.admin.hospitalId, `race-${id}`, 'Synthetic revoked staff', role, 'unused-test-hash']);
  await pool.query("INSERT INTO staff_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')", [digest(token), id, csrf]);
  return { id, hospitalId: auth.admin.hospitalId, cookie: `staff_session=${token}`, csrf };
}
async function waitForHospitalLock(blockerPid: number) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const waiting = await database.query("SELECT 1 FROM pg_stat_activity WHERE query = 'SELECT id FROM hospitals WHERE id=$1 FOR UPDATE' AND $1 = ANY(pg_blocking_pids(pid))", [blockerPid]);
    if (waiting.rowCount) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Expected an outpatient write to wait on the hospital lock.');
}

test('check-in queued on hospital lock rejects revoked actor without visit, audit or receipt', async () => {
  const p = await patient(); const user = await raceActor('receptionist'); const key = randomUUID();
  const beforeAudit = (await pool.query('SELECT * FROM audit_events ORDER BY id')).rows;
  const blocker = await pool.connect();
  await blocker.query('BEGIN'); await blocker.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [user.hospitalId]);
  const { rows: [{ pid }] } = await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
  const waiting = checkIn(user, p.id, key).then(response => response);
  try {
    await waitForHospitalLock(pid);
    await blocker.query('UPDATE staff_users SET active=false WHERE id=$1', [user.id]);
    await blocker.query('DELETE FROM staff_sessions WHERE user_id=$1', [user.id]);
    await blocker.query('COMMIT');
    const response = await waiting; assert.equal(response.statusCode, 401, response.body);
    assert.equal((await pool.query('SELECT * FROM outpatient_visits')).rowCount, 0);
    assert.equal((await pool.query('SELECT * FROM outpatient_requests')).rowCount, 0);
    assert.deepEqual((await pool.query('SELECT * FROM audit_events ORDER BY id')).rows, beforeAudit);
  } finally { await blocker.query('ROLLBACK'); blocker.release(); }
});

test('clinical command queued on hospital lock rejects revoked actor without visit change, audit or receipt', async () => {
  const v = await visit(); const user = await raceActor('clinician'); const key = randomUUID();
  const beforeVisit = (await pool.query('SELECT * FROM outpatient_visits WHERE id=$1', [v.id])).rows;
  const beforeAudit = (await pool.query('SELECT * FROM audit_events ORDER BY id')).rows;
  const beforeReceipts = (await pool.query('SELECT * FROM outpatient_requests ORDER BY idempotency_key')).rows;
  const blocker = await pool.connect();
  await blocker.query('BEGIN'); await blocker.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [user.hospitalId]);
  const { rows: [{ pid }] } = await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
  const waiting = command(user, v, { type: 'note', body: 'Synthetic revoked draft must not persist' }, key).then(response => response);
  try {
    await waitForHospitalLock(pid);
    await blocker.query('UPDATE staff_users SET active=false WHERE id=$1', [user.id]);
    await blocker.query('DELETE FROM staff_sessions WHERE user_id=$1', [user.id]);
    await blocker.query('COMMIT');
    const response = await waiting; assert.equal(response.statusCode, 401, response.body);
    assert.deepEqual((await pool.query('SELECT * FROM outpatient_visits WHERE id=$1', [v.id])).rows, beforeVisit);
    assert.deepEqual((await pool.query('SELECT * FROM audit_events ORDER BY id')).rows, beforeAudit);
    assert.deepEqual((await pool.query('SELECT * FROM outpatient_requests ORDER BY idempotency_key')).rows, beforeReceipts);
  } finally { await blocker.query('ROLLBACK'); blocker.release(); }
});

test('check-in and clinical writes work with SELECT/INSERT-only patient privileges', async () => {
  const p = await patient(); const role = `${schema}_runtime`;
  await database.query(`CREATE ROLE ${role} NOLOGIN`);
  const restrictedPool = new pg.Pool({ connectionString, options: `-c search_path=${schema} -c role=${role}` });
  const restrictedApp = buildApp({ pool: restrictedPool, origin });
  try {
    await database.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    await database.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
    await pool.query(`GRANT INSERT ON patients,outpatient_visits,audit_events,outpatient_requests TO ${role}`);
    await pool.query(`GRANT UPDATE ON hospitals,staff_users,outpatient_visits TO ${role}`);
    const permissions = await restrictedPool.query("SELECT has_table_privilege(current_user,'patients','UPDATE') AS can_update, has_table_privilege(current_user,'patients','INSERT') AS can_insert");
    assert.deepEqual(permissions.rows, [{ can_update: false, can_insert: true }]);
    const response = await restrictedApp.inject({ method: 'POST', url: `/api/patients/${p.id}/visits`, headers: headers(auth.receptionist), payload: {} });
    assert.equal(response.statusCode, 201, response.body);
    const v = response.json().visit;
    const note = await restrictedApp.inject({ method: 'POST', url: `/api/visits/${v.id}/commands`, headers: headers(auth.clinician), payload: { expectedRevision: v.revision, command: { type: 'note', body: 'Synthetic restricted runtime note' } } });
    assert.equal(note.statusCode, 200, note.body); assert.equal(note.json().visit.revision, 2);
    assert.equal((await pool.query('SELECT * FROM outpatient_requests')).rowCount, 2);
    assert.equal((await pool.query("SELECT * FROM audit_events WHERE action IN ('visit.checkIn','visit.note')")).rowCount, 2);
  } finally {
    await restrictedApp.close(); await restrictedPool.end();
    await database.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${schema} FROM ${role}`);
    await database.query(`REVOKE USAGE ON SCHEMA ${schema} FROM ${role}`);
    await database.query(`DROP ROLE ${role}`);
  }
});
