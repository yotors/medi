import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import pg from 'pg';
import { buildApp } from './app.ts';
import { hashPassword } from './auth.ts';
import { migrate } from './db.ts';
import type { StaffRole } from '../shared/registration.ts';
import { execute } from '../src/domain.ts';
import type { VisitCommand, VisitView } from '../shared/outpatient.ts';

const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('PostgreSQL integration tests require TEST_DATABASE_URL or DATABASE_URL.');
const schema = `clinical_test_${randomUUID().replaceAll('-', '')}`;
const database = new pg.Pool({ connectionString });
const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema} -c application_name=${schema}` });
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
async function patient(user = auth.receptionist, name = `Synthetic Outpatient ${randomUUID().slice(0,8)}`) {
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

const clinical = (user: Auth, v: Pick<VisitView, 'id'>, value: object, key: string = randomUUID()) => app.inject({ method: 'POST', url: `/api/visits/${v.id}/clinical/commands`, headers: headers(user, key), payload: value });
async function correction(user: Auth, v: Pick<VisitView, 'id'>, value: object, key: string = randomUUID()) { const response = await clinical(user, v, value, key); assert.equal(response.statusCode, 200, response.body); return response.json(); }
async function detail(v: Pick<VisitView, 'id'>, user = auth.admin) { const response = await get(user, `/api/visits/${v.id}/clinical`); assert.equal(response.statusCode, 200, response.body); return response.json(); }
async function history(v: Pick<VisitView, 'id'>, user = auth.admin, query = '') { const response = await get(user, `/api/visits/${v.id}/clinical/history${query}`); assert.equal(response.statusCode, 200, response.body); return response.json(); }
async function prepared(closed = false) {
  let v = await visit(); v = await apply(auth.clinician, v, { type: 'note', body: 'Original synthetic note' });
  v = await apply(auth.clinician, v, { type: 'order', test: 'Blood count' }); const orderId = v.orders![0].id;
  v = await apply(auth.lab, v, { type: 'advanceOrder', orderId, next: 'collected' });
  v = await apply(auth.lab, v, { type: 'advanceOrder', orderId, next: 'released', result: 'Original synthetic result' });
  v = await apply(auth.clinician, v, { type: 'advanceOrder', orderId, next: 'reviewed' });
  if (closed) v = await apply(auth.clinician, v, { type: 'close' });
  return { v, orderId, noteId: v.notes![0].id };
}
const noteBody = (subjectId: string, expectedVersion = 0) => ({ type: 'note.amend', subjectId, expectedVersion, body: 'Corrected synthetic note', reason: 'Synthetic transcription correction' });
const resultBody = (subjectId: string, expectedVersion = 0) => ({ type: 'result.correct', subjectId, expectedVersion, body: 'Corrected synthetic result', reason: 'Synthetic transcription correction', ownerId: auth.clinician.id });

test('active and closed amendments retain original JSON/revision, attribution and ordered history across restart', async () => {
  for (const closed of [false, true]) {
    const { v, noteId, orderId } = await prepared(closed); const before = (await pool.query('SELECT revision,data FROM outpatient_visits WHERE id=$1', [v.id])).rows[0];
    await correction(auth.clinician, v, noteBody(noteId)); await correction(auth.clinician, v, { ...noteBody(noteId, 1), body: 'Second amendment' });
    await correction(auth.lab, v, resultBody(orderId));
    assert.deepEqual((await pool.query('SELECT revision,data FROM outpatient_visits WHERE id=$1', [v.id])).rows[0], before);
    await app.close(); app = buildApp({ pool, origin });
    const saved = await detail(v); assert.equal(saved.pendingReviews, 1); assert.equal(saved.records.length, 2);
    const note = saved.records.find((record: any) => record.kind === 'note'); assert.equal(note.latest.body, 'Second amendment'); assert.deepEqual((await history(v, auth.admin, `?kind=note&subjectId=${noteId}`)).events.map((entry: any) => entry.amendment.body), ['Second amendment', 'Corrected synthetic note']);
    assert.equal(note.originalActor.currentName, 'Synthetic clinician'); assert.equal(note.originalActor.id, auth.clinician.id); assert.equal(note.latest.actorId, auth.clinician.id); assert.ok(note.latest.reason && note.latest.at);
    const projected = (await get(auth.clinician, `/api/visits/${v.id}`)).json().visit;
    assert.equal(projected.pendingClinicalReviews, 1); assert.equal(projected.status, closed ? 'closed' : 'active');
    assert.match(projected.stage, /review/i);
  }
});

test('corrections queue discovers closed review work and counts contain no narratives', async () => {
  const { v, orderId } = await prepared(true); await correction(auth.lab, v, resultBody(orderId));
  const response = await get(auth.clinician, '/api/visits?status=corrections'); assert.equal(response.statusCode, 200); assert.equal(response.json().total, 1);
  assert.equal(response.json().visits[0].pendingClinicalReviews, 1); assert.doesNotMatch(response.body, /Original synthetic|Corrected synthetic|transcription/);
  const responseOther = await get(other, '/api/visits?status=corrections'); assert.equal(responseOther.json().total, 0);
});

test('review acknowledges exact latest correction, assigned owner and later correction requires fresh review', async () => {
  const { v, orderId } = await prepared(); const first = await correction(auth.lab, v, resultBody(orderId));
  assert.equal((await clinical(auth.admin, v, { type: 'result.review', subjectId: orderId, expectedVersion: 1, amendmentId: first.eventId })).json().code, 'REVIEW_OWNER_REQUIRED');
  await correction(auth.clinician, v, { type: 'result.review', subjectId: orderId, expectedVersion: 1, amendmentId: first.eventId });
  assert.equal((await detail(v)).pendingReviews, 0);
  const second = await correction(auth.lab, v, resultBody(orderId, 2));
  assert.equal((await detail(v)).pendingReviews, 1);
  assert.equal((await clinical(auth.clinician, v, { type: 'result.review', subjectId: orderId, expectedVersion: 2, amendmentId: first.eventId })).json().code, 'STALE_CLINICAL_VERSION');
  assert.equal((await clinical(auth.clinician, v, { type: 'result.review', subjectId: orderId, expectedVersion: 3, amendmentId: first.eventId })).json().code, 'STALE_CLINICAL_VERSION');
  await correction(auth.clinician, v, { type: 'result.review', subjectId: orderId, expectedVersion: 3, amendmentId: second.eventId });
  assert.equal((await detail(v)).pendingReviews, 0);
});

test('deactivated owner remains visible; explicit attributable takeover restores review path', async () => {
  const { v, orderId } = await prepared(true); const first = await correction(auth.lab, v, resultBody(orderId));
  await pool.query('UPDATE staff_users SET active=false WHERE id=$1', [auth.clinician.id]);
  try {
    const record = (await detail(v)).records[0]; assert.equal(record.review.ownerActive, false); assert.equal(record.review.ownerName, 'Synthetic clinician');
    const takeover = await correction(auth.admin, v, { type: 'result.takeover', subjectId: orderId, expectedVersion: 1, amendmentId: first.eventId, reason: 'Synthetic shift reassignment' });
    assert.equal(takeover.version, 2); await correction(auth.admin, v, { type: 'result.review', subjectId: orderId, expectedVersion: 2, amendmentId: first.eventId });
    const saved = (await detail(v)).records[0]; assert.equal(saved.review.reviewed, true); assert.equal(saved.review.ownerId, auth.admin.id); assert.equal((await history(v)).events.find((entry: any) => entry.action === 'result.takeover').reason, 'Synthetic shift reassignment');
  } finally { await pool.query('UPDATE staff_users SET active=true WHERE id=$1', [auth.clinician.id]); }
});

test('review and corrections do not replace original unreviewed-result requirement', async () => {
  let v = await visit(); v = await apply(auth.clinician, v, { type: 'note', body: 'Synthetic' }); v = await apply(auth.clinician, v, { type: 'order', test: 'Urinalysis' }); const subjectId = v.orders![0].id;
  v = await apply(auth.lab, v, { type: 'advanceOrder', orderId: subjectId, next: 'collected' }); v = await apply(auth.lab, v, { type: 'advanceOrder', orderId: subjectId, next: 'released', result: 'Synthetic' });
  const saved = await correction(auth.lab, v, resultBody(subjectId)); await correction(auth.clinician, v, { type: 'result.review', subjectId, expectedVersion: 1, amendmentId: saved.eventId });
  assert.equal((await command(auth.clinician, v, { type: 'close' })).statusCode, 409);
  v = await apply(auth.clinician, v, { type: 'advanceOrder', orderId: subjectId, next: 'reviewed' }); await apply(auth.clinician, v, { type: 'close' });
});

test('correction and closure serialize: pending blocks close; closed result accepts visible follow-up', async () => {
  const { v, orderId } = await prepared(); const [closed, corrected] = await Promise.all([command(auth.clinician, v, { type: 'close' }), clinical(auth.lab, v, resultBody(orderId))]);
  assert.equal(corrected.statusCode, 200, corrected.body); assert.ok([200,409].includes(closed.statusCode));
  const current = (await get(auth.clinician, `/api/visits/${v.id}`)).json().visit; assert.equal(current.pendingClinicalReviews, 1);
  if (closed.statusCode === 409) assert.equal(closed.json().code, 'CORRECTION_REVIEW_PENDING');
  else assert.equal(current.status, 'closed');
  const second = await prepared(); await correction(auth.lab, second.v, resultBody(second.orderId));
  assert.equal((await command(auth.clinician, second.v, { type: 'close' })).json().code, 'CORRECTION_REVIEW_PENDING');
});

test('role projections and foreign-hospital targets never disclose narratives or owner choices', async () => {
  const { v, noteId, orderId } = await prepared(); await correction(auth.clinician, v, noteBody(noteId)); await correction(auth.lab, v, resultBody(orderId));
  const lab = await detail(v, auth.lab); assert.deepEqual(lab.records.map((record: any) => record.kind), ['result']);
  const auditor = await detail(v, auth.auditor); assert.deepEqual(auditor.records, []); const audited = await history(v, auth.auditor); assert.equal(audited.events.length, 2); assert.doesNotMatch(JSON.stringify(audited), /Corrected synthetic|transcription/);
  for (const role of ['receptionist','pharmacist','cashier'] as StaffRole[]) assert.equal((await get(auth[role], `/api/visits/${v.id}/clinical`)).statusCode, 403);
  assert.equal((await get(other, `/api/visits/${v.id}/clinical`)).statusCode, 404); assert.equal((await clinical(other, v, noteBody(noteId))).statusCode, 404);
  for (const role of roles) {
    if (!['admin','clinician'].includes(role)) assert.equal((await clinical(auth[role], v, noteBody(noteId, 1))).statusCode, 403);
    if (!['admin','lab'].includes(role)) assert.equal((await clinical(auth[role], v, resultBody(orderId, 1))).statusCode, 403);
  }
  const reviewers = (await get(auth.lab, '/api/clinical/reviewers')).json().reviewers; assert.equal(reviewers.length, 2); assert.ok(reviewers.every((row: any) => row.id !== other.id));
});

test('validation rejects wrong targets, unreleased orders and inactive or foreign owners without effects', async () => {
  const { v, noteId, orderId } = await prepared();
  for (const value of [{ ...noteBody(noteId), reason: '' }, { ...noteBody(noteId), body: 'bad\0' }, { ...noteBody(noteId), extra: true }, { ...resultBody(orderId), expectedVersion: -1 }]) assert.equal((await clinical(auth.admin, v, value)).statusCode, 400);
  assert.equal((await clinical(auth.admin, v, noteBody(orderId))).statusCode, 404);
  for (const ownerId of [other.id, auth.lab.id, randomUUID()]) assert.equal((await clinical(auth.lab, v, { ...resultBody(orderId), ownerId })).json().code, 'REVIEWER_UNAVAILABLE');
  const next = await apply(auth.clinician, v, { type: 'order', test: 'Urinalysis' }); const second = next.orders!.find(order => order.test === 'Urinalysis')!;
  assert.equal((await clinical(auth.lab, next, resultBody(second.id))).json().code, 'RESULT_NOT_RELEASED');
  assert.equal((await detail(v)).records.length, 0);
});

test('same-key concurrent retry, uppercase UUIDs and stale writers produce one append', async () => {
  const { v, noteId } = await prepared(); const key = randomUUID(); const value = noteBody(noteId);
  const [first, second] = await Promise.all([clinical(auth.clinician, v, value, key), clinical(auth.clinician, v, value, key)]);
  assert.equal(first.statusCode, 200); assert.deepEqual(first.json(), second.json());
  const upper = await clinical(auth.clinician, { id: v.id.toUpperCase() }, { ...value, subjectId: noteId.toUpperCase() }, key.toUpperCase()); assert.deepEqual(upper.json(), first.json());
  assert.equal((await clinical(auth.admin, v, value, key)).json().code, 'IDEMPOTENCY_CONFLICT');
  assert.equal((await clinical(auth.clinician, v, { ...value, body: 'Different' }, key)).json().code, 'IDEMPOTENCY_CONFLICT');
  const responses = await Promise.all([1,2].map(index => clinical(auth.clinician, v, { ...noteBody(noteId, 1), body: `Concurrent ${index}` })));
  assert.deepEqual(responses.map(response => response.statusCode).sort(), [200,409]); assert.equal((await history(v)).total, 2);
});

test('concurrent newer correction and old acknowledgement cannot hide outstanding work', async () => {
  const { v, orderId } = await prepared(); const original = await correction(auth.lab, v, resultBody(orderId));
  const [corrected, reviewed] = await Promise.all([clinical(auth.lab, v, resultBody(orderId, 1)), clinical(auth.clinician, v, { type: 'result.review', subjectId: orderId, expectedVersion: 1, amendmentId: original.eventId })]);
  assert.deepEqual([corrected.statusCode, reviewed.statusCode].sort(), [200,409]);
  if (corrected.statusCode === 200) assert.equal((await detail(v)).pendingReviews, 1);
  else { await correction(auth.lab, v, resultBody(orderId, 2)); assert.equal((await detail(v)).pendingReviews, 1); }
});

test('failed event insertion rolls back amendment and receipt; exact retry succeeds', async () => {
  const { v, noteId } = await prepared(); const key = randomUUID();
  await pool.query("ALTER TABLE clinical_events ADD CONSTRAINT reject_amendment CHECK(action<>'note.amend')");
  try { assert.equal((await clinical(auth.clinician, v, noteBody(noteId), key)).statusCode, 500); assert.equal((await pool.query('SELECT * FROM clinical_amendments')).rowCount, 0); assert.equal((await pool.query('SELECT * FROM clinical_requests')).rowCount, 0); }
  finally { await pool.query('ALTER TABLE clinical_events DROP CONSTRAINT reject_amendment'); }
  await correction(auth.clinician, v, noteBody(noteId), key);
});

test('clinical ledgers reject UPDATE and DELETE even through owner SQL', async () => {
  const { v, noteId } = await prepared(); await correction(auth.clinician, v, noteBody(noteId));
  for (const table of ['clinical_amendments','clinical_events','clinical_requests']) {
    await assert.rejects(pool.query(`UPDATE ${table} SET hospital_id=hospital_id`), /immutable/);
    await assert.rejects(pool.query(`DELETE FROM ${table}`), /immutable/);
  }
});

test('revoked actor waiting on hospital lock cannot append, audit or create retry receipt', async () => {
  const { v, noteId } = await prepared(); const client = await pool.connect(); const key = randomUUID();
  await client.query('BEGIN'); await client.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [auth.clinician.hospitalId]);
  const waiting = clinical(auth.clinician, v, noteBody(noteId), key).then(response => response);
  try {
    await waitForBlocked(client);
    await client.query('UPDATE staff_users SET active=false WHERE id=$1', [auth.clinician.id]); await client.query('COMMIT');
    const response = await waiting; assert.equal(response.statusCode, 401); assert.equal((await pool.query('SELECT * FROM clinical_requests WHERE idempotency_key=$1', [key])).rowCount, 0); assert.equal((await detail(v)).records.length, 0);
  } finally { await client.query('ROLLBACK'); client.release(); await pool.query('UPDATE staff_users SET active=true WHERE id=$1', [auth.clinician.id]); }
});

async function waitForBlocked(blocker: pg.PoolClient) {
  const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  let reached = false;
  for (let index = 0; index < 150; index++) {
    const blocked = await database.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))', [schema, pid]);
    if (blocked.rowCount) { reached = true; break; } await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(reached, 'The target clinical request must reach this exact hospital lock before revocation.');
}

test('all seven ordinary visit projections protect populated correction narratives and auditor history stays metadata-only', async () => {
  const { v, noteId, orderId } = await prepared();
  await correction(auth.clinician, v, { ...noteBody(noteId), body: 'PRIVATE NOTE AMENDMENT', reason: 'PRIVATE NOTE REASON' });
  await correction(auth.lab, v, { ...resultBody(orderId), body: 'PRIVATE RESULT CORRECTION', reason: 'PRIVATE RESULT REASON' });
  for (const role of roles) {
    const response = await get(auth[role], `/api/visits/${v.id}`); assert.equal(response.statusCode, 200);
    const projected = response.json().visit;
    if (['admin','clinician'].includes(role)) assert.deepEqual(projected.clinical.records.map((record: any) => record.kind), ['note','result']);
    else if (role === 'lab') { assert.deepEqual(projected.clinical.records.map((record: any) => record.kind), ['result']); assert.doesNotMatch(response.body, /PRIVATE NOTE/); }
    else { assert.equal(projected.clinical, undefined); assert.doesNotMatch(response.body, /PRIVATE NOTE|PRIVATE RESULT/); }
    const queue = await get(auth[role], '/api/visits?status=corrections'); assert.doesNotMatch(queue.body, /PRIVATE NOTE|PRIVATE RESULT/);
    assert.equal(Boolean(queue.json().visits[0].clinicalAssignments), ['admin','clinician','lab'].includes(role));
  }
  const audited = await history(v, auth.auditor); assert.equal(audited.total, 2); assert.doesNotMatch(JSON.stringify(audited), /PRIVATE|body|reason/);
});

test('inactive, reset and changed-role reviewer eligibility matches choices, direct assignment and existing-owner availability', async () => {
  const { v, orderId } = await prepared(); await correction(auth.lab, v, resultBody(orderId));
  for (const change of ["active=false", "password_change_required=true", "role='lab'"]) {
    await pool.query(`UPDATE staff_users SET ${change} WHERE id=$1`, [auth.clinician.id]);
    try {
      const choices = (await get(auth.lab, '/api/clinical/reviewers')).json().reviewers; assert.ok(!choices.some((row: any) => row.id === auth.clinician.id));
      const rejected = await clinical(auth.lab, v, resultBody(orderId, 1)); assert.equal(rejected.json().code, 'REVIEWER_UNAVAILABLE');
      const record = (await detail(v)).records[0]; assert.equal(record.review.ownerActive, false); assert.equal(record.review.ownerId, auth.clinician.id); assert.equal(record.version, 1); assert.equal((await history(v)).total, 1);
    } finally { await pool.query("UPDATE staff_users SET active=true,password_change_required=false,role='clinician' WHERE id=$1", [auth.clinician.id]); }
  }
});

test('renamed original actors retain identity, immutable amendment names and duplicate reviewer names remain distinguishable', async () => {
  const { v, noteId } = await prepared(); await correction(auth.clinician, v, noteBody(noteId));
  await pool.query("UPDATE staff_users SET display_name='Same synthetic name' WHERE id=ANY($1::uuid[])", [[auth.admin.id, auth.clinician.id]]);
  try {
    const note = (await detail(v)).records[0]; assert.deepEqual(note.originalActor, { id: auth.clinician.id, username: 'clinician', currentName: 'Same synthetic name' }); assert.equal(note.latest.actorName, 'Synthetic clinician');
    const choices = (await get(auth.lab, '/api/clinical/reviewers')).json().reviewers;
    assert.deepEqual(choices.map((row: any) => [row.username,row.role]).sort(), [['admin','admin'],['clinician','clinician']]); assert.ok(choices.every((row: any) => row.name === 'Same synthetic name'));
  } finally { for (const role of ['admin','clinician'] as const) await pool.query('UPDATE staff_users SET display_name=$2 WHERE id=$1', [auth[role].id, `Synthetic ${role}`]); }
});

test('substantial immutable history pages independently of bounded exact latest state, review and ownership', async () => {
  const { v, noteId, orderId } = await prepared(true);
  for (let version = 0; version < 53; version++) await correction(auth.clinician, v, { ...noteBody(noteId, version), body: `Synthetic amendment ${version}` });
  const corrected = await correction(auth.lab, v, resultBody(orderId));
  await correction(auth.admin, v, { type: 'result.takeover', subjectId: orderId, expectedVersion: 1, amendmentId: corrected.eventId, reason: 'Synthetic reassignment' });
  await correction(auth.admin, v, { type: 'result.review', subjectId: orderId, expectedVersion: 2, amendmentId: corrected.eventId });
  const current = await detail(v); const note = current.records.find((record: any) => record.kind === 'note'); const result = current.records.find((record: any) => record.kind === 'result');
  assert.equal(note.version, 53); assert.equal(note.latest.body, 'Synthetic amendment 52'); assert.equal(note.events, undefined); assert.equal(note.amendments, undefined);
  assert.equal(result.review.reviewed, true); assert.equal(result.review.ownerId, auth.admin.id); assert.equal(result.version, 3);
  const pages = await Promise.all([1,2,3].map(page => history(v, auth.clinician, `?kind=note&subjectId=${noteId}&page=${page}`)));
  assert.deepEqual(pages.map(page => page.events.length), [25,25,3]); assert.ok(pages.every(page => page.total === 53)); assert.equal(new Set(pages.flatMap(page => page.events.map((event: any) => event.id))).size, 53);
  assert.equal(pages[2].events.at(-1).amendment.body, 'Synthetic amendment 0');
  const audited = await history(v, auth.auditor); assert.equal(audited.total, 56); assert.equal(audited.events.length, 25); assert.doesNotMatch(JSON.stringify(audited), /amendment 52|body|reason/);
  assert.equal((await get(auth.lab, `/api/visits/${v.id}/clinical/history?kind=note&subjectId=${noteId}`)).statusCode, 403);
  assert.equal((await get(other, `/api/visits/${v.id}/clinical/history`)).statusCode, 404);
});

test('corrections queue prioritizes a fresh correction on an old visit and assigned work follows takeover', async () => {
  const old = await prepared(true); const recent = await prepared(true);
  await correction(auth.lab, recent.v, { ...resultBody(recent.orderId), ownerId: auth.admin.id });
  const correctionOld = await correction(auth.lab, old.v, resultBody(old.orderId));
  const all = (await get(auth.admin, '/api/visits?status=corrections')).json(); assert.deepEqual(all.visits.map((row: any) => row.id), [old.v.id, recent.v.id]);
  assert.equal(all.visits[0].clinicalAssignments[0].ownerId, auth.clinician.id); assert.ok(all.visits[0].clinicalAssignments[0].correctedAt);
  const mine = (await get(auth.clinician, '/api/visits?status=corrections&assigned=me')).json(); assert.deepEqual(mine.visits.map((row: any) => row.id), [old.v.id]);
  await correction(auth.admin, old.v, { type: 'result.takeover', subjectId: old.orderId, expectedVersion: 1, amendmentId: correctionOld.eventId, reason: 'Synthetic handover' });
  assert.equal((await get(auth.clinician, '/api/visits?status=corrections&assigned=me')).json().total, 0); assert.equal((await get(auth.admin, '/api/visits?status=corrections&assigned=me')).json().total, 2);
  assert.equal((await get(auth.receptionist, '/api/visits?status=corrections&assigned=me')).statusCode, 403);
});

test('post-lock role, password-reset and expiry changes reject writes, reads and revoked receipt replay', async () => {
  const { v, noteId } = await prepared(); const key = randomUUID(); const savedCommand = noteBody(noteId); await correction(auth.clinician, v, savedCommand, key);
  const changes = ['role', 'reset', 'expiry'] as const;
  for (const change of changes) for (const operation of ['write','read','replay']) {
    const blocker = await pool.connect(); await blocker.query('BEGIN'); await blocker.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [auth.clinician.hospitalId]);
    const responsePromise = operation === 'read' ? get(auth.clinician, `/api/visits/${v.id}/clinical`).then(response => response)
      : clinical(auth.clinician, v, operation === 'replay' ? savedCommand : noteBody(noteId, 1), operation === 'replay' ? key : randomUUID()).then(response => response);
    try {
      await waitForBlocked(blocker);
      if (change === 'role') await blocker.query("UPDATE staff_users SET role='lab' WHERE id=$1", [auth.clinician.id]);
      else if (change === 'reset') await blocker.query('UPDATE staff_users SET password_change_required=true WHERE id=$1', [auth.clinician.id]);
      else await blocker.query("UPDATE staff_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1", [auth.clinician.id]);
      await blocker.query('COMMIT'); assert.equal((await responsePromise).statusCode, 401);
      assert.equal((await history(v)).total, 1); assert.equal((await pool.query('SELECT * FROM clinical_requests')).rowCount, 1);
    } finally {
      await blocker.query('ROLLBACK'); blocker.release();
      await pool.query("UPDATE staff_users SET role='clinician',password_change_required=false WHERE id=$1", [auth.clinician.id]);
      await pool.query("UPDATE staff_sessions SET expires_at=clock_timestamp()+interval '1 hour' WHERE user_id=$1", [auth.clinician.id]);
    }
  }
});
