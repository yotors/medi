import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import pg from 'pg';
import { buildApp } from './app.ts';
import { digest } from './auth.ts';
import { migrate } from './db.ts';

import { exportTables } from '../shared/hospital.ts';
import type { StaffRole } from '../shared/registration.ts';
const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw Error('Hospital tests require a database.');
const schema = `hospital_test_${randomUUID().replaceAll('-', '')}`,
  database = new pg.Pool({ connectionString }),
  pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}` }),
  origin = 'http://127.0.0.1:5173',
  app = buildApp({ pool, origin });
type Auth = { id: string; hospital: string; cookie: string; csrf: string };
let users: Record<string, Auth>, other: Auth;
async function actor(hospital: string, role: StaffRole) {
  const id = randomUUID(),
    token = randomBytes(32).toString('base64url'),
    csrf = randomBytes(32).toString('base64url');
  await pool.query(
    'INSERT INTO staff_users(id,hospital_id,username,display_name,role,password_hash) VALUES($1,$2,$6,$3,$4,$5)',
    [id, hospital, `Fictional ${role}`, role, 'unused', id],
  );
  await pool.query(
    "INSERT INTO staff_sessions(token_hash,user_id,csrf_token,expires_at,auth_state) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour','complete')",
    [digest(token), id, csrf],
  );
  return { id, hospital, cookie: `staff_session=${token}`, csrf };
}
const get = (u: Auth, path: string) => app.inject({ url: path, headers: { cookie: u.cookie } });
const post = (u: Auth, path: string, payload: object, key: string = randomUUID()) =>
  app.inject({
    method: 'POST',
    url: path,
    headers: { cookie: u.cookie, origin, 'x-csrf-token': u.csrf, 'idempotency-key': key },
    payload,
  });
async function ok(u: Auth, path: string, value: object, key?: string) {
  const r = await post(u, path, value, key);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
before(async () => {
  await database.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
});
beforeEach(async () => {
  await pool.query('TRUNCATE hospitals CASCADE');
  const h = randomUUID(),
    b = randomUUID();
  await pool.query(
    "INSERT INTO hospitals(id,code,name) VALUES($1,'fiction-a','Fictional A'),($2,'fiction-b','Fictional B')",
    [h, b],
  );
  users = {};
  for (const role of [
    'admin',
    'lab',
    'clinician',
    'pharmacist',
    'cashier',
    'auditor',
  ] as StaffRole[])
    users[role] = await actor(h, role);
  other = await actor(b, 'admin');
});
after(async () => {
  await app.close();
  await pool.end();
  await database.query(`DROP SCHEMA ${schema} CASCADE`);
  await database.end();
});

const command = (value: object, key?: string, u = users.admin) =>
  ok(u, '/api/hospital/commands', value, key);
async function patient() {
  const r = await post(users.admin, '/api/patients', {
    name: 'Fictional governance ' + randomUUID().slice(0, 8),
    contact: '',
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json().patient.id;
}
test('settings facilities stale/hash retries and safe appearance', async () => {
  const cmd = {
      type: 'profile.update',
      expectedRevision: 1,
      reason: 'Fictional authorized settings',
      name: 'Fictional renamed hospital',
      phone: '',
      address: '',
      timezone: 'Africa/Addis_Ababa',
      locale: 'am-ET',
      calendar: 'ethiopic',
    },
    key = randomUUID();
  await command(cmd, key);
  await command(cmd, key);
  assert.equal(
    (await post(users.admin, '/api/hospital/commands', { ...cmd, name: 'Changed' }, key))
      .statusCode,
    409,
  );
  assert.equal((await post(users.admin, '/api/hospital/commands', cmd)).statusCode, 409);
  const display = (await get(users.lab, '/api/hospital/appearance')).json();
  assert.deepEqual(display, {
    locale: 'am-ET',
    calendar: 'ethiopic',
    timezone: 'Africa/Addis_Ababa',
  });
  const f = await command({
    type: 'facility.create',
    code: 'F1',
    name: 'Fictional facility',
    address: '',
    reason: 'Approved fictional facility',
  });
  await command({
    type: 'facility.update',
    id: f.id,
    expectedRevision: 1,
    name: f.name,
    address: 'Updated address',
    active: false,
    reason: 'Closure',
  });
  assert.equal((await get(users.auditor, '/api/hospital')).json().facilities[0].active, false);
  assert.equal((await post(users.lab, '/api/hospital/commands', cmd)).statusCode, 403);
});
test('verified privacy requests aliases holds bounded exports repeat and tenant isolation', async () => {
  const id = await patient(),
    alias = await patient();
  await pool.query(
    'INSERT INTO care_identity_links(hospital_id,duplicate_id,canonical_id,actor_id,actor_name,reason) VALUES($1,$2,$3,$4,$5,$6)',
    [
      users.admin.hospital,
      alias,
      id,
      users.admin.id,
      'Fictional admin',
      'Verified same fictional person',
    ],
  );
  const r = await command({
    type: 'record.request',
    patientId: id,
    requester: 'Fictional requester',
    purpose: 'Verified patient access',
    identityVerification: 'Identity and legal authority checked',
    reason: 'Approved intake',
  });
  assert.equal(
    (await post(users.admin, '/api/hospital/record-export', { requestId: r.id, reason: 'Fulfill' }))
      .statusCode,
    404,
  );
  await command({
    type: 'record.decide',
    id: r.id,
    expectedRevision: 1,
    status: 'approved',
    reason: 'Verified authority and purpose',
  });
  for (let i = 0; i < 2; i++) {
    const data = await ok(users.admin, '/api/hospital/record-export', {
      requestId: r.id,
      reason: 'Verified download',
    });
    assert.equal(data.collections.patients.length, 2);
    assert.equal(data.collections.care_identity_links.length, 1);
    assert.equal(data.hasMore.patients, false);
  }
  assert.equal(
    (
      await post(other, '/api/hospital/record-export', {
        requestId: r.id,
        reason: 'Foreign attempt',
      })
    ).statusCode,
    404,
  );
  const hold = await command({
    type: 'hold.place',
    patientId: id,
    reason: 'Fictional retention authority',
  });
  await command({
    type: 'hold.release',
    id: hold.id,
    expectedRevision: 1,
    reason: 'Authority released hold',
  });
  const data = await ok(users.admin, '/api/hospital/export', {
    table: 'care_identity_links',
    purpose: 'Approved migration',
  });
  assert.equal(data.records.length, 1);
  assert.equal(
    (
      await post(users.admin, '/api/hospital/export', {
        table: 'staff_sessions',
        purpose: 'Forbidden',
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await post(users.auditor, '/api/hospital/export', { table: 'patients', purpose: 'Forbidden' }))
      .statusCode,
    403,
  );
});
test('audit rejection rolls governance and idempotency receipt back', async () => {
  await pool.query(
    "CREATE FUNCTION fail_governance_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected audit failure'; END; $$",
  );
  await pool.query(
    'CREATE TRIGGER fail_governance_audit BEFORE INSERT ON hospital_governance_events FOR EACH ROW EXECUTE FUNCTION fail_governance_audit()',
  );
  try {
    const key = randomUUID();
    assert.equal(
      (
        await post(
          users.admin,
          '/api/hospital/commands',
          {
            type: 'facility.create',
            code: 'ROLLBACK',
            name: 'Fictional',
            address: '',
            reason: 'Audit test',
          },
          key,
        )
      ).statusCode,
      500,
    );
    assert.equal(
      (await pool.query('SELECT count(*)::integer n FROM hospital_facilities')).rows[0].n,
      0,
    );
    assert.equal(
      (await pool.query('SELECT count(*)::integer n FROM hospital_governance_requests')).rows[0].n,
      0,
    );
  } finally {
    await pool.query('DROP TRIGGER fail_governance_audit ON hospital_governance_events');
  }
});
test('support grant and revoke end sessions and expired support authority is denied', async () => {
  const auditor = users.auditor;
  await command({
    type: 'support.grant',
    accountId: auditor.id,
    durationMinutes: 5,
    reason: 'Named fictional support',
  });
  assert.equal((await get(auditor, '/api/hospital')).statusCode, 401);
  // Recreate a normal complete synthetic session only to exercise expiry enforcement.
  await pool.query(
    "INSERT INTO staff_sessions(token_hash,user_id,csrf_token,expires_at,auth_state) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour','complete')",
    [digest(auditor.cookie.split('=')[1]), auditor.id, auditor.csrf],
  );
  assert.equal(
    (await get(auditor, '/api/hospital')).statusCode,
    401,
    'Synthetic policy never bypasses support MFA',
  );
  await pool.query('INSERT INTO staff_factors(hospital_id,user_id,envelope) VALUES($1,$2,$3)', [
    auditor.hospital,
    auditor.id,
    { fixture: 'No authenticator secret; precompleted session fixture' },
  ]);
  assert.equal((await get(auditor, '/api/hospital')).statusCode, 200);
  await pool.query(
    "UPDATE hospital_support_grants SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",
    [auditor.id],
  );
  assert.equal((await get(auditor, '/api/hospital')).statusCode, 401);
  await command({ type: 'support.revoke', accountId: auditor.id, reason: 'Support ended' });
  assert.equal(
    (
      await pool.query('SELECT count(*)::integer n FROM staff_sessions WHERE user_id=$1', [
        auditor.id,
      ])
    ).rows[0].n,
    0,
  );
});
test('post-lock revoked actor cannot write governance', async () => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [users.admin.hospital]);
    const pending = post(users.admin, '/api/hospital/commands', {
      type: 'facility.create',
      code: 'RACE',
      name: 'Fictional',
      address: '',
      reason: 'Race',
    });
    await c.query('UPDATE staff_users SET active=false WHERE id=$1', [users.admin.id]);
    await c.query('COMMIT');
    assert.equal((await pending).statusCode, 401);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
});
test('restricted nonowner RLS denies unset and foreign tenants and permits own', async () => {
  const role = `hospital_rls_${randomUUID().replaceAll('-', '')}`,
    c = await pool.connect();
  try {
    await database.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
    await database.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    await database.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
    await command({
      type: 'facility.create',
      code: 'RLS',
      name: 'Fictional RLS facility',
      address: '',
      reason: 'Isolation fixture',
    });
    await c.query('BEGIN');
    await c.query(`SET LOCAL ROLE ${role}`);
    assert.equal(
      (await c.query('SELECT count(*)::integer n FROM hospital_facilities')).rows[0].n,
      0,
    );
    await c.query("SELECT set_config('medi.hospital_id',$1,true)", [users.admin.hospital]);
    assert.equal(
      (await c.query('SELECT count(*)::integer n FROM hospital_facilities')).rows[0].n,
      1,
    );
    await c.query("SELECT set_config('medi.hospital_id',$1,true)", [other.hospital]);
    assert.equal(
      (await c.query('SELECT count(*)::integer n FROM hospital_facilities')).rows[0].n,
      0,
    );
    await c.query('ROLLBACK');
  } finally {
    await c.query('ROLLBACK');
    c.release();
    await database.query(`DROP OWNED BY ${role}`);
    await database.query(`DROP ROLE ${role}`);
  }
});

test('every approved organization collection exports with valid bounded ordering', async () => {
  for (const table of exportTables) {
    const r = await post(users.admin, '/api/hospital/export', {
      table,
      purpose: 'Verified collection migration',
    });
    assert.equal(r.statusCode, 200, table + ': ' + r.body);
    assert.ok(r.json().records.length <= 250);
  }
});
test('patient histories paginate without omission and exclude unrelated patients', async () => {
  const id = await patient(),
    unrelated = await patient();
  const r = await command({
    type: 'record.request',
    patientId: id,
    requester: 'Fictional patient',
    purpose: 'Access',
    identityVerification: 'Verified fictional authority',
    reason: 'Intake',
  });
  await command({
    type: 'record.decide',
    id: r.id,
    expectedRevision: 1,
    status: 'approved',
    reason: 'Verified',
  });
  for (let i = 0; i < 251; i++)
    await pool.query(
      "INSERT INTO audit_events(id,hospital_id,actor_id,patient_id,action) VALUES($1,$2,$3,$4,'patient.registered')",
      [randomUUID(), users.admin.hospital, users.admin.id, id],
    );
  const first = await ok(users.admin, '/api/hospital/record-export', {
    requestId: r.id,
    reason: 'Verified chunk',
    page: 1,
  });
  const second = await ok(users.admin, '/api/hospital/record-export', {
    requestId: r.id,
    reason: 'Verified chunk',
    page: 2,
  });
  assert.equal(first.collections.audit_events.length, 250);
  assert.equal(first.hasMore.audit_events, true);
  assert.equal(second.collections.audit_events.length, 2);
  assert.equal(second.hasMore.audit_events, false);
  assert.ok(first.collections.patients.every((p: { id: string }) => p.id !== unrelated));
});

test('support revocation after a blocked read rejects former authority', async () => {
  const u = users.auditor;
  await command({
    type: 'support.grant',
    accountId: u.id,
    durationMinutes: 5,
    reason: 'Approved named support',
  });
  await pool.query('INSERT INTO staff_factors(hospital_id,user_id,envelope) VALUES($1,$2,$3)', [
    u.hospital,
    u.id,
    { fixture: 'Precompleted session fixture' },
  ]);
  await pool.query(
    "INSERT INTO staff_sessions(token_hash,user_id,csrf_token,expires_at,auth_state) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour','complete')",
    [digest(u.cookie.split('=')[1]), u.id, u.csrf],
  );
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [u.hospital]);
    const response = get(u, '/api/hospital');
    await new Promise((resolve) => setTimeout(resolve, 25));
    await c.query('UPDATE hospital_support_grants SET revoked=true WHERE user_id=$1', [u.id]);
    await c.query('COMMIT');
    assert.equal((await response).statusCode, 401);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
});

test('patient export includes return quality and restock history without another patient on the same batch', async () => {
  const product = await ok(users.pharmacist, '/api/inventory/commands', {
    type: 'product.create',
    code: 'RET',
    name: 'Fictional shared medicine',
    unit: 'tablet',
  });
  const batch = await ok(users.pharmacist, '/api/inventory/commands', {
    type: 'batch.create',
    productId: product.productId,
    lot: 'Fictional shared lot',
    expiry: '2099-12-31',
  });
  await ok(users.pharmacist, '/api/inventory/commands', {
    type: 'stock.receive',
    batchId: batch.batchId,
    expectedRevision: 1,
    quantity: 20,
    reference: 'Fictional stock',
  });
  async function dispense() {
    const id = await patient();
    let response = await post(users.admin, `/api/patients/${id}/visits`, {});
    assert.equal(response.statusCode, 201, response.body);
    let v = response.json().visit;
    v = (
      await ok(users.clinician, `/api/visits/${v.id}/commands`, {
        expectedRevision: v.revision,
        command: { type: 'prescribe', instruction: 'Fictional instruction' },
      })
    ).visit;
    await ok(users.clinician, `/api/visits/${v.id}/inventory/commands`, {
      type: 'authorize',
      prescriptionId: v.prescriptions[0].id,
      expectedVisitRevision: v.revision,
      productId: product.productId,
      quantity: 3,
    });
    v = (await get(users.admin, `/api/visits/${v.id}`)).json().visit;
    const revision = (
      await pool.query('SELECT revision FROM inventory_batches WHERE id=$1', [batch.batchId])
    ).rows[0].revision;
    const d = await ok(users.pharmacist, `/api/visits/${v.id}/inventory/commands`, {
      type: 'dispense',
      prescriptionId: v.prescriptions[0].id,
      expectedVisitRevision: v.revision,
      batchId: batch.batchId,
      expectedBatchRevision: revision,
      quantity: 3,
    });
    const r = await ok(users.pharmacist, '/api/departments/commands', {
      type: 'return.record',
      dispenseId: d.eventId,
      quantity: 2,
      reason: 'Fictional patient returned units',
    });
    const updated = (
      await pool.query('SELECT revision FROM inventory_batches WHERE id=$1', [batch.batchId])
    ).rows[0].revision;
    await ok(users.admin, '/api/departments/commands', {
      type: 'return.quality',
      id: r.id,
      expectedRevision: 1,
      expectedBatchRevision: updated,
      decision: 'restock',
      reason: 'Authorized fictional inspection',
    });
    const movement = (
      await pool.query("SELECT id FROM inventory_events WHERE snapshot->>'departmentRecordId'=$1", [
        r.id,
      ])
    ).rows[0].id;
    return { id, returnId: r.id, movement, dispenseId: d.eventId };
  }
  const own = await dispense(),
    foreign = await dispense();
  const request = await command({
    type: 'record.request',
    patientId: own.id,
    requester: 'Fictional requester',
    purpose: 'Verified access',
    identityVerification: 'Verified fictional patient authority',
    reason: 'Intake',
  });
  await command({
    type: 'record.decide',
    id: request.id,
    expectedRevision: 1,
    status: 'approved',
    reason: 'Verified authority',
  });
  const result = await ok(users.admin, '/api/hospital/record-export', {
    requestId: request.id,
    reason: 'Verified fulfillment',
  });
  const records = result.collections;
  assert.ok(
    records.department_records.some(
      (r: { id: string; data: { status: string } }) =>
        r.id === own.returnId && r.data.status === 'restock',
    ),
  );
  assert.deepEqual(records.department_events.map((r: { action: string }) => r.action).sort(), [
    'return.quality',
    'return.record',
  ]);
  assert.ok(records.inventory_events.some((r: { id: string }) => r.id === own.movement));
  assert.ok(
    records.inventory_movements.some(
      (r: { id: string; quantity: number }) => r.id === own.movement && r.quantity === 2,
    ),
  );
  for (const collection of [
    'department_records',
    'department_events',
    'department_links',
    'inventory_events',
    'inventory_movements',
  ])
    assert.ok(
      records[collection].every(
        (r: { id?: string; entity_id?: string; record_id?: string }) =>
          ![foreign.returnId, foreign.movement, foreign.dispenseId].includes(
            r.id ?? r.entity_id ?? r.record_id ?? '',
          ),
      ),
      collection + ' leaked unrelated same-batch activity',
    );
});
