import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import pg from 'pg';
import { buildApp } from './app.ts';
import { hashPassword } from './auth.ts';
import { migrate } from './db.ts';
import type { CareKind, CareRecord } from '../shared/care.ts';
const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString)
  throw new Error('Care integration tests require TEST_DATABASE_URL or DATABASE_URL.');
const schema = `care_test_${randomUUID().replaceAll('-', '')}`,
  database = new pg.Pool({ connectionString }),
  pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}` }),
  app = buildApp({ pool, origin: 'http://127.0.0.1:5173' });
const roles = ['admin', 'receptionist', 'clinician', 'nurse', 'auditor', 'pharmacist'] as const;
type Auth = { cookie: string; csrf: string; id: string; hospitalId: string };
const auth = {} as Record<(typeof roles)[number], Auth>;
let other: Auth;
const password = 'Synthetic-care-password-42',
  origin = 'http://127.0.0.1:5173';
const headers = (a: Auth, key: string = randomUUID()) => ({
  origin,
  cookie: a.cookie,
  'x-csrf-token': a.csrf,
  'idempotency-key': key,
});
const post = (a: Auth, url: string, payload: unknown, key?: string) =>
  app.inject({
    method: 'POST',
    url,
    headers: { ...headers(a, key), 'content-type': 'application/json' },
    payload: JSON.stringify(payload),
  });
const get = (a: Auth, url: string) => app.inject({ method: 'GET', url, headers: headers(a) });
async function login(role: string, code = 'care-alpha'): Promise<Auth> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin },
    payload: { hospitalCode: code, username: role, password },
  });
  assert.equal(r.statusCode, 200, r.body);
  return {
    cookie: String(r.headers['set-cookie']).split(';')[0],
    csrf: r.json().csrfToken,
    id: r.json().user.id,
    hospitalId: r.json().user.hospital.id,
  };
}
before(async () => {
  await database.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
  const hash = await hashPassword(password);
  for (const code of ['care-alpha', 'care-beta']) {
    const h = randomUUID();
    await pool.query('INSERT INTO hospitals(id,code,name) VALUES($1,$2,$3)', [
      h,
      code,
      'Synthetic Care Hospital',
    ]);
    for (const role of roles)
      await pool.query(
        'INSERT INTO staff_users(id,hospital_id,username,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5,$6)',
        [randomUUID(), h, role, `Synthetic ${role}`, role, hash],
      );
  }
  for (const role of roles) auth[role] = await login(role);
  other = await login('admin', 'care-beta');
});
beforeEach(async () => {
  await pool.query(
    'TRUNCATE care_events,care_requests,care_identity_links,care_records,outpatient_requests,outpatient_visits,audit_events,registration_requests,patients CASCADE',
  );
});
after(async () => {
  await app.close();
  await pool.end();
  await database.query(`DROP SCHEMA ${schema} CASCADE`);
  await database.end();
});
async function patient() {
  const r = await post(auth.receptionist, '/api/patients', {
    name: 'Fictional Care Patient',
    age: 34,
    contact: 'fictional',
    confirmDuplicate: true,
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json().patient;
}
const at = '2026-10-14T09:00:00Z';
function payload(kind: CareKind, data: unknown, p?: string, r?: CareRecord) {
  return {
    kind,
    data,
    ...(p ? { patientId: p } : {}),
    ...(r ? { id: r.id } : {}),
    expectedRevision: r?.revision ?? 0,
    reason: 'Synthetic accountable entry',
  };
}
async function save(
  kind: CareKind,
  data: unknown,
  p?: string,
  r?: CareRecord,
  actor: Auth = auth.admin,
) {
  const response = await post(actor, '/api/care/records', payload(kind, data, p, r));
  assert.equal(response.statusCode, 200, response.body);
  return response.json().record as CareRecord;
}
async function bed(name = 'Bed A') {
  const w = await save('ward', { name: 'Ward A', facility: 'Main', active: true });
  return save('bed', { wardId: w.id, name, active: true });
}
async function admission(p: string, b: CareRecord) {
  return save(
    'admission',
    {
      bedId: b.id,
      clinicianId: auth.clinician.id,
      reason: 'Entered admission reason',
      eventAt: at,
      status: 'active',
    },
    p,
  );
}
test('profile revisions preserve registration and reject changed retries and stale drafts', async () => {
  const p = await patient(),
    key = randomUUID(),
    data = {
      name: 'Fictional corrected name',
      contact: 'corrected',
      dateOfBirth: '1992-01-01',
      sex: 'unknown',
      address: 'fictional',
      emergencyContact: 'fictional',
      identity: 'verified',
      allergiesStatus: 'not-entered',
      allergies: '',
    },
    body = payload('profile', data, p.id);
  const a = await post(auth.receptionist, '/api/care/records', body, key),
    b = await post(auth.receptionist, '/api/care/records', body, key);
  assert.equal(a.statusCode, 200, a.body);
  assert.deepEqual(a.json(), b.json());
  assert.equal(
    (await post(auth.receptionist, '/api/care/records', { ...body, reason: 'Changed reason' }, key))
      .statusCode,
    409,
  );
  const record = a.json().record;
  await save(
    'profile',
    { ...data, allergiesStatus: 'entered', allergies: 'Staff entered allergy' },
    p.id,
    record,
  );
  assert.equal(
    (await post(auth.admin, '/api/care/records', payload('profile', data, p.id, record)))
      .statusCode,
    409,
  );
  const original = (await pool.query('SELECT * FROM patients WHERE id=$1', [p.id])).rows[0];
  assert.equal(original.name, p.name);
  assert.equal(original.record_number, p.recordNumber);
  assert.equal(
    (await get(auth.clinician, `/api/care/${record.id}/history`)).json().events.length,
    2,
  );
});
test('appointment race commits one booking; durable arrival creates one outpatient check-in', async () => {
  const p = await patient(),
    p2 = await patient(),
    data = {
      clinicianId: auth.clinician.id,
      service: 'Entered consultation',
      facility: 'Main',
      start: at,
      end: '2026-10-14T10:00:00Z',
      status: 'booked',
    };
  const results = await Promise.all([
    post(auth.receptionist, '/api/care/records', payload('appointment', data, p.id)),
    post(auth.receptionist, '/api/care/records', payload('appointment', data, p2.id)),
  ]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
  const r = results.find((r) => r.statusCode === 200)!.json().record as CareRecord;
  const key = randomUUID(),
    body = payload('appointment', { ...r.data, status: 'arrived' }, r.patientId!, r);
  const a = await post(auth.receptionist, '/api/care/records', body, key),
    b = await post(auth.receptionist, '/api/care/records', body, key);
  assert.equal(a.statusCode, 200, a.body);
  assert.deepEqual(a.json(), b.json());
  assert.equal(
    (await pool.query('SELECT count(*)::integer n FROM outpatient_visits')).rows[0].n,
    1,
  );
  assert.equal(
    (await pool.query("SELECT count(*)::integer n FROM audit_events WHERE action='visit.checkIn'"))
      .rows[0].n,
    1,
  );
});
test('triage records staff urgency, bounds measurements, and preserves amendments', async () => {
  const p = await patient();
  assert.equal(
    (
      await post(
        auth.nurse,
        '/api/care/records',
        payload(
          'triage',
          { urgency: 'routine', symptoms: 'Entered symptoms', eventAt: at, oxygenPercent: 101 },
          p.id,
        ),
      )
    ).statusCode,
    400,
  );
  const r = await save(
    'triage',
    { urgency: 'urgent', symptoms: 'Entered symptoms', eventAt: at, pulsePerMinute: 90 },
    p.id,
    undefined,
    auth.nurse,
  );
  await save('triage', { ...r.data, pulsePerMinute: 92 }, p.id, r, auth.nurse);
  const events = (await get(auth.clinician, `/api/care/${r.id}/history`)).json().events;
  assert.equal(events[1].data.pulsePerMinute, 90);
  assert.equal(events[0].data.urgency, 'urgent');
  assert.equal(
    (await post(auth.receptionist, '/api/care/search', { kind: 'triage', patientId: p.id }))
      .statusCode,
    403,
  );
});
test('inpatient workflow blocks occupancy and unfinished tasks then retains transfer, outcome and discharge', async () => {
  const p = await patient(),
    p2 = await patient(),
    b = await bed();
  const results = await Promise.all([
    post(
      auth.admin,
      '/api/care/records',
      payload(
        'admission',
        {
          bedId: b.id,
          clinicianId: auth.clinician.id,
          reason: 'Admit',
          eventAt: at,
          status: 'active',
        },
        p.id,
      ),
    ),
    post(
      auth.admin,
      '/api/care/records',
      payload(
        'admission',
        {
          bedId: b.id,
          clinicianId: auth.clinician.id,
          reason: 'Admit',
          eventAt: at,
          status: 'active',
        },
        p2.id,
      ),
    ),
  ]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
  let a = results.find((r) => r.statusCode === 200)!.json().record as CareRecord;
  const patientId = a.patientId!;
  const b2 = await save('bed', { wardId: (b.data as any).wardId, name: 'Bed B', active: true });
  a = await save(
    'admission',
    { ...a.data, bedId: b2.id, eventAt: '2026-10-14T11:00:00Z' },
    patientId,
    a,
  );
  await save(
    'nursing',
    {
      admissionId: a.id,
      eventAt: at,
      shift: 'Day shift',
      observation: 'Signed entered observation',
    },
    patientId,
    undefined,
    auth.nurse,
  );
  const m = await save(
    'medication',
    {
      admissionId: a.id,
      drug: 'Fictional entered drug',
      dose: 1,
      unit: 'entered unit',
      route: 'entered route',
      scheduledAt: at,
      instructions: 'Entered instructions',
      status: 'ordered',
    },
    patientId,
    undefined,
    auth.clinician,
  );
  const discharge = {
    ...a.data,
    status: 'discharged',
    summary: 'Signed discharge summary',
    disposition: 'Home',
    followUp: 'Entered follow-up',
  };
  assert.equal(
    (await post(auth.clinician, '/api/care/records', payload('admission', discharge, patientId, a)))
      .statusCode,
    409,
  );
  const outcome = {
    medicationId: m.id,
    eventAt: at,
    outcome: 'withheld',
    reason: 'Entered accountable reason',
  };
  const outcomes = await Promise.all([
    post(auth.nurse, '/api/care/records', payload('administration', outcome, patientId)),
    post(auth.nurse, '/api/care/records', payload('administration', outcome, patientId)),
  ]);
  assert.deepEqual(outcomes.map((r) => r.statusCode).sort(), [200, 409]);
  await save('admission', discharge, patientId, a, auth.clinician);
  assert.equal((await get(auth.clinician, `/api/care/${a.id}/history`)).json().events.length, 3);
});
test('nurse cannot prescribe; cross-hospital references and content are rejected', async () => {
  const p = await patient(),
    b = await bed(),
    a = await admission(p.id, b);
  const order = {
    admissionId: a.id,
    drug: 'Fictional drug',
    dose: 1,
    unit: 'unit',
    route: 'route',
    scheduledAt: at,
    instructions: 'Entered instruction',
    status: 'ordered',
  };
  assert.equal(
    (await post(auth.nurse, '/api/care/records', payload('medication', order, p.id))).statusCode,
    403,
  );
  assert.equal(
    (await post(other, '/api/care/search', { kind: 'admission', patientId: p.id })).statusCode,
    404,
  );
  assert.equal((await get(other, `/api/care/${a.id}/history`)).statusCode, 404);
  assert.equal(
    (
      await post(
        auth.admin,
        '/api/care/records',
        payload(
          'referral',
          {
            type: 'referral',
            destination: 'Fictional service',
            reason: 'Referral reason',
            dueAt: at,
            ownerId: other.id,
            status: 'pending',
          },
          p.id,
        ),
      )
    ).statusCode,
    400,
  );
});
test('duplicate resolution preserves both source histories and prevents cycles and multiple active admissions', async () => {
  const p = await patient(),
    p2 = await patient(),
    b = await bed();
  await admission(p.id, b);
  await save(
    'triage',
    { urgency: 'routine', symptoms: 'Original identity symptoms', eventAt: at },
    p2.id,
  );
  const key = randomUUID(),
    body = { duplicateId: p2.id, canonicalId: p.id, reason: 'Verified synthetic duplicate' };
  const a = await post(auth.admin, '/api/care/identity-links', body, key);
  assert.equal(a.statusCode, 200, a.body);
  assert.deepEqual(
    a.json(),
    (await post(auth.admin, '/api/care/identity-links', body, key)).json(),
  );
  assert.equal(
    (
      await post(auth.admin, '/api/care/identity-links', {
        duplicateId: p.id,
        canonicalId: p2.id,
        reason: 'Cycle',
      })
    ).statusCode,
    409,
  );
  const view = (
    await post(auth.clinician, '/api/care/search', { kind: 'triage', patientId: p.id })
  ).json();
  assert.equal(view.records[0].patient.id, p2.id);
  assert.equal(
    (await get(auth.clinician, `/api/care/patients/${p.id}/identity`)).json().identities.length,
    2,
  );
  const b2 = await save('bed', { wardId: (b.data as any).wardId, name: 'Bed B', active: true });
  assert.equal(
    (
      await post(
        auth.admin,
        '/api/care/records',
        payload(
          'admission',
          {
            bedId: b2.id,
            clinicianId: auth.clinician.id,
            reason: 'Admit linked duplicate',
            eventAt: at,
            status: 'active',
          },
          p2.id,
        ),
      )
    ).statusCode,
    409,
  );
});
test('audit insertion failure rolls back record and receipt', async () => {
  const p = await patient(),
    key = randomUUID();
  await pool.query(
    "CREATE FUNCTION reject_care_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic audit outage'; END; $$",
  );
  await pool.query(
    'CREATE TRIGGER reject_care_audit BEFORE INSERT ON care_events FOR EACH ROW EXECUTE FUNCTION reject_care_audit()',
  );
  try {
    const r = await post(
      auth.nurse,
      '/api/care/records',
      payload('triage', { urgency: 'routine', symptoms: 'Entered symptoms', eventAt: at }, p.id),
      key,
    );
    assert.equal(r.statusCode, 500);
    assert.equal((await pool.query('SELECT count(*)::integer n FROM care_records')).rows[0].n, 0);
    assert.equal((await pool.query('SELECT count(*)::integer n FROM care_requests')).rows[0].n, 0);
  } finally {
    await pool.query('DROP TRIGGER reject_care_audit ON care_events');
    await pool.query('DROP FUNCTION reject_care_audit()');
  }
});
test('referral completion remains accountable and revoked authority cannot replay a write', async () => {
  const p = await patient(),
    data = {
      type: 'follow-up',
      destination: 'Entered service',
      reason: 'Entered follow-up reason',
      dueAt: at,
      ownerId: auth.clinician.id,
      status: 'pending',
    },
    key = randomUUID(),
    body = payload('referral', data, p.id);
  const response = await post(auth.clinician, '/api/care/records', body, key);
  assert.equal(response.statusCode, 200, response.body);
  const r = response.json().record;
  await save('referral', { ...data, status: 'completed' }, p.id, r, auth.clinician);
  assert.equal((await get(auth.auditor, `/api/care/${r.id}/history`)).json().events.length, 2);
  await pool.query('UPDATE staff_users SET active=false WHERE id=$1', [auth.clinician.id]);
  try {
    assert.equal((await post(auth.clinician, '/api/care/records', body, key)).statusCode, 401);
  } finally {
    await pool.query('UPDATE staff_users SET active=true WHERE id=$1', [auth.clinician.id]);
  }
});
test('authority revoked while waiting for the hospital lock rejects without mutation', async () => {
  const p = await patient(),
    block = await pool.connect();
  await block.query('BEGIN');
  await block.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [auth.nurse.hospitalId]);
  const inFlight = post(
    auth.nurse,
    '/api/care/records',
    payload('triage', { urgency: 'routine', symptoms: 'Entered symptoms', eventAt: at }, p.id),
  );
  try {
    await new Promise((resolve) => setTimeout(resolve, 200));
    await block.query('UPDATE staff_users SET active=false WHERE id=$1', [auth.nurse.id]);
    await block.query('COMMIT');
    const response = await inFlight;
    assert.equal(response.statusCode, 401, response.body);
    assert.equal((await pool.query('SELECT count(*)::integer n FROM care_records')).rows[0].n, 0);
    assert.equal((await pool.query('SELECT count(*)::integer n FROM care_requests')).rows[0].n, 0);
  } finally {
    await block.query('ROLLBACK');
    block.release();
    await pool.query('UPDATE staff_users SET active=true WHERE id=$1', [auth.nurse.id]);
  }
});
test('merged duplicate cannot receive an independent outpatient visit through check-in or appointment arrival', async () => {
  const canonical = await patient(),
    duplicate = await patient();
  const linked = await post(auth.admin, '/api/care/identity-links', {
    duplicateId: duplicate.id,
    canonicalId: canonical.id,
    reason: 'Verified synthetic duplicate',
  });
  assert.equal(linked.statusCode, 200, linked.body);
  const rejected = await post(auth.receptionist, `/api/patients/${duplicate.id}/visits`, {});
  assert.equal(rejected.statusCode, 409, rejected.body);
  assert.equal(rejected.json().code, 'IDENTITY_LINKED');
  const appointment = await save(
    'appointment',
    {
      clinicianId: auth.clinician.id,
      service: 'Entered service',
      facility: 'Main',
      start: at,
      end: '2026-10-14T10:00:00Z',
      status: 'booked',
    },
    duplicate.id,
  );
  const arrival = await post(
    auth.receptionist,
    '/api/care/records',
    payload('appointment', { ...appointment.data, status: 'arrived' }, duplicate.id, appointment),
  );
  assert.equal(arrival.statusCode, 409, arrival.body);
  assert.equal(arrival.json().code, 'IDENTITY_LINKED');
  assert.equal(
    (await pool.query('SELECT count(*)::integer n FROM outpatient_visits')).rows[0].n,
    0,
  );
  const accepted = await post(auth.receptionist, `/api/patients/${canonical.id}/visits`, {});
  assert.equal(accepted.statusCode, 201, accepted.body);
  assert.equal(
    (await pool.query('SELECT patient_id FROM outpatient_visits')).rows[0].patient_id,
    canonical.id,
  );
});
test('corrected identity appears in searchable directory and encounters while originals and RLS boundaries persist', async () => {
  const original = await patient(),
    corrected = {
      name: 'Fictional Current Directory Identity',
      contact: 'corrected-directory-contact',
      dateOfBirth: null,
      sex: 'unknown',
      address: '',
      emergencyContact: '',
      identity: 'verified',
      allergiesStatus: 'not-entered',
      allergies: '',
    };
  await save('profile', corrected, original.id, undefined, auth.receptionist);
  for (const q of [corrected.name, corrected.contact]) {
    const response = await post(auth.receptionist, '/api/patients/search', { q, page: 1 });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().total, 1);
    assert.equal(response.json().patients[0].name, corrected.name);
    assert.equal(response.json().patients[0].contact, corrected.contact);
    assert.equal(response.json().patients[0].recordNumber, original.recordNumber);
  }
  const detail = await get(auth.receptionist, `/api/patients/${original.id}`);
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(detail.json().patient.name, corrected.name);
  const checked = await post(auth.receptionist, `/api/patients/${original.id}/visits`, {});
  assert.equal(checked.statusCode, 201, checked.body);
  assert.equal(checked.json().visit.patient.name, corrected.name);
  assert.equal(checked.json().visit.patient.contact, corrected.contact);
  assert.equal(checked.json().visit.patient.recordNumber, original.recordNumber);
  const encounter = await get(auth.clinician, `/api/visits/${checked.json().visit.id}`);
  assert.equal(encounter.statusCode, 200, encounter.body);
  assert.equal(encounter.json().visit.patient.name, corrected.name);
  const raw = (await pool.query('SELECT * FROM patients WHERE id=$1', [original.id])).rows[0];
  assert.equal(raw.name, original.name);
  assert.equal(raw.contact, original.contact);
  assert.equal(raw.record_number, original.recordNumber);
  assert.equal(raw.age, original.age);
  assert.equal(raw.created_at.toISOString(), original.createdAt);
  const foreign = await post(other, '/api/patients', {
    name: 'Foreign Fictional Identity',
    contact: 'foreign',
    confirmDuplicate: true,
  });
  assert.equal(foreign.statusCode, 201, foreign.body);
  const foreignId = foreign.json().patient.id;
  const role = `care_directory_${randomUUID().replaceAll('-', '')}`,
    client = await pool.connect();
  try {
    await database.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
    await database.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    await database.query(
      `GRANT SELECT ON ${schema}.patient_directory,${schema}.patients,${schema}.care_records,${schema}.care_identity_links TO ${role}`,
    );
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    assert.equal(
      (await client.query('SELECT count(*)::integer n FROM patient_directory')).rows[0].n,
      0,
    );
    await client.query("SELECT set_config('medi.hospital_id',$1,true)", [
      auth.receptionist.hospitalId,
    ]);
    const own = (await client.query('SELECT * FROM patient_directory WHERE id=$1', [original.id]))
      .rows[0];
    assert.equal(own.name, corrected.name);
    assert.equal(own.contact, corrected.contact);
    assert.equal(own.record_number, original.recordNumber);
    assert.equal(
      (await client.query('SELECT * FROM patient_directory WHERE id=$1', [foreignId])).rowCount,
      0,
    );
    assert.equal(
      (await client.query('SELECT * FROM patients WHERE hospital_id=$1', [other.hospitalId]))
        .rowCount,
      0,
    );
    await client.query('ROLLBACK');
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await database.query(`DROP OWNED BY ${role}`);
    await database.query(`DROP ROLE ${role}`);
  }
});
test('pharmacist reads profile allergies and medication orders only, while staff-entered triage remains decision-free', async () => {
  const p = await patient();
  const profile = await save(
    'profile',
    {
      name: p.name,
      contact: p.contact,
      dateOfBirth: null,
      sex: 'unknown',
      address: '',
      emergencyContact: '',
      identity: 'provisional',
      allergiesStatus: 'entered',
      allergies: 'Fictional entered allergy',
    },
    p.id,
    undefined,
    auth.clinician,
  );
  const b = await bed(),
    a = await admission(p.id, b),
    medication = await save(
      'medication',
      {
        admissionId: a.id,
        drug: 'Fictional clinician-entered drug',
        dose: 2,
        unit: 'entered unit',
        route: 'entered route',
        scheduledAt: at,
        instructions: 'Explicit entered instructions',
        status: 'ordered',
      },
      p.id,
      undefined,
      auth.clinician,
    );
  const triage = await save(
    'triage',
    {
      urgency: 'routine',
      symptoms: 'Observed values entered by staff',
      eventAt: at,
      temperatureC: 50,
      systolicMmHg: 5,
      diastolicMmHg: 500,
      pulsePerMinute: 1000,
      respiratoryPerMinute: 300,
      weightKg: 1000,
    },
    p.id,
    undefined,
    auth.nurse,
  );
  assert.equal((triage.data as any).urgency, 'routine');
  for (const kind of ['profile', 'medication']) {
    const response = await post(auth.pharmacist, '/api/care/search', { kind, patientId: p.id });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().records.length, 1);
  }
  assert.equal(
    (await get(auth.pharmacist, `/api/care/${profile.id}/history`)).json().events[0].data.allergies,
    'Fictional entered allergy',
  );
  assert.equal((await get(auth.pharmacist, `/api/care/${medication.id}/history`)).statusCode, 200);
  for (const kind of [
    'appointment',
    'triage',
    'ward',
    'bed',
    'admission',
    'nursing',
    'administration',
    'referral',
  ])
    assert.equal(
      (await post(auth.pharmacist, '/api/care/search', { kind, patientId: p.id })).statusCode,
      403,
      kind,
    );
  assert.equal(
    (
      await post(
        auth.pharmacist,
        '/api/care/records',
        payload('profile', profile.data, p.id, profile),
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await post(
        auth.pharmacist,
        '/api/care/records',
        payload('medication', medication.data, p.id, medication),
      )
    ).statusCode,
    403,
  );
  assert.equal((await get(auth.pharmacist, `/api/care/${triage.id}/history`)).statusCode, 403);
  assert.deepEqual(
    (await get(auth.pharmacist, `/api/care/patients/${p.id}/identity`)).json().visits,
    [],
  );
});
