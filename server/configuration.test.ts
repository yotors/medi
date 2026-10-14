import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import pg from 'pg';
import { buildApp } from './app.ts';
import { digest } from './auth.ts';
import { migrate } from './db.ts';
import { configurationCommandSchema, formatETB, MAX_PRICE_MINOR, parseETB, type ConfigurationCommand, type Department, type Service } from '../shared/configuration.ts';
const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('PostgreSQL integration tests require a database.');
const schema = `configuration_test_${randomUUID().replaceAll('-', '')}`;
const database = new pg.Pool({ connectionString }); const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema} -c application_name=${schema}` });
const origin = 'http://127.0.0.1:5173'; const app = buildApp({ pool, origin });
type Auth = { id: string; hospital: string; cookie: string; csrf: string };
let admin: Auth; let other: Auth; let staff: Auth;
async function actor(hospital: string, role: 'admin' | 'clinician'): Promise<Auth> {
  const id = randomUUID(); const token = randomBytes(32).toString('base64url'); const csrf = randomBytes(32).toString('base64url');
  await pool.query('INSERT INTO staff_users(id,hospital_id,username,display_name,role,password_hash) VALUES($1,$2,$6,$3,$4,$5)', [id, hospital, `Fictional ${role}`, role, 'unused-test-hash', id]);
  await pool.query("INSERT INTO staff_sessions(token_hash,user_id,csrf_token,expires_at,auth_state) VALUES($1,$2,$3,now()+interval '1 hour','complete')", [digest(token), id, csrf]);
  return { id, hospital, cookie: `staff_session=${token}`, csrf };
}
const headers = (user: Auth, key = randomUUID()) => ({ origin, cookie: user.cookie, 'x-csrf-token': user.csrf, 'idempotency-key': key });
const get = (user: Auth, path: string) => app.inject({ url: `/api/configuration/${path}`, headers: { cookie: user.cookie } });
const command = (user: Auth, value: ConfigurationCommand, key = randomUUID()) => app.inject({ method: 'POST', url: '/api/configuration/commands', headers: headers(user, key), payload: value });
async function department(user = admin, code = 'OPD'): Promise<Department> { const response = await command(user, { type: 'department.create', name: 'Fictional Outpatient', code }); assert.equal(response.statusCode, 200, response.body); return response.json().entry; }
async function service(dept: Department, user = admin, code = 'CONSULT'): Promise<Service> { const response = await command(user, { type: 'service.create', code, name: 'Fictional Consultation', departmentId: dept.id, priceMinor: 12345 }); assert.equal(response.statusCode, 200, response.body); return response.json().entry; }
const updateService = (entry: Service, fields: Partial<{ name: string; departmentId: string; active: boolean; priceMinor: number; expectedRevision: number }> = {}): ConfigurationCommand => ({ type: 'service.update', id: entry.id, expectedRevision: entry.revision, name: entry.name, departmentId: entry.departmentId, active: entry.active, priceMinor: entry.priceMinor, ...fields });
before(async () => { await database.query(`CREATE SCHEMA ${schema}`); await migrate(pool); });
beforeEach(async () => {
  await pool.query('TRUNCATE hospitals CASCADE');
  const alpha = randomUUID(); const beta = randomUUID();
  await pool.query("INSERT INTO hospitals(id,code,name) VALUES($1,'alpha','Fictional Alpha'),($2,'beta','Fictional Beta')", [alpha, beta]);
  admin = await actor(alpha, 'admin'); staff = await actor(alpha, 'clinician'); other = await actor(beta, 'admin');
});
after(async () => { await app.close(); await pool.end(); await database.query(`DROP SCHEMA ${schema} CASCADE`); await database.end(); });

test('exact money parsing rejects negative, rounding, exponent, whitespace and overflow', () => {
  for (const [text, minor] of [['0', 0], ['0.0', 0], ['0.00', 0], ['1.01', 101], ['10.5', 1050], ['9999999.99', MAX_PRICE_MINOR]] as const) assert.equal(parseETB(text), minor);
  for (const minor of [0, 1, 10, 100, 12345, MAX_PRICE_MINOR]) assert.equal(parseETB(formatETB(minor)), minor);
  for (const text of ['', '-1', '+1', '.01', '1.', '01', '1.001', '1e2', ' 1', '1 ', '10000000', 'Infinity', 'NaN']) assert.equal(parseETB(text), null);
  for (const minor of [-1, 0.1, NaN, Infinity, MAX_PRICE_MINOR + 1]) assert.throws(() => formatETB(minor));
  assert.equal(configurationCommandSchema.safeParse({ type: 'department.create', code: 'OP', name: 'Name', hospitalId: randomUUID() }).success, false);
});
test('department stable codes, strict validation, duplicate and stale conflicts; immutable history', async () => {
  const dep = await department(); assert.equal((await department(other)).code, dep.code);
  const update = { type: 'department.update', id: dep.id, expectedRevision: 1, name: 'Renamed department', active: true } as const;
  assert.equal((await command(admin, update)).json().entry.revision, 2);
  assert.equal((await command(admin, update)).json().code, 'REVISION_CONFLICT');
  assert.equal((await command(admin, { type: 'department.create', name: 'Duplicate', code: dep.code })).json().code, 'CODE_CONFLICT');
  const history = await get(admin, `departments/${dep.id}/history`); assert.equal(history.json().events[1].snapshot.name, dep.name); assert.equal(history.json().events[0].actorName, 'Fictional admin');
  for (const extra of [{ code: 'EDIT' }, { hospitalId: other.hospital }, { currency: 'USD' }]) assert.equal((await app.inject({ method: 'POST', url: '/api/configuration/commands', headers: headers(admin), payload: { ...update, ...extra } })).statusCode, 400);
  await assert.rejects(pool.query('UPDATE hospital_configuration_events SET actor_name=$1', ['changed']), /immutable/);
});
test('versioned ETB prices retain original department/name/author and active staff projection', async () => {
  const dep = await department(); const svc = await service(dep);
  await command(admin, { type: 'department.update', id: dep.id, expectedRevision: 1, name: 'New department name', active: true });
  for (const reader of [admin, staff]) {
    assert.equal((await get(reader, 'services')).json().entries[0].departmentName, 'New department name');
    const current = (await get(reader, `services/${svc.id}`)).json().entry;
    assert.equal(current.departmentName, 'New department name'); assert.equal(current.revision, 1);
  }
  assert.equal((await get(admin, `services/${svc.id}/history`)).json().events[0].snapshot.departmentName, dep.name);
  assert.equal((await pool.query('SELECT department_name FROM hospital_service_versions WHERE service_id=$1', [svc.id])).rows[0].department_name, dep.name);
  const result = await command(admin, updateService(svc, { name: 'Updated consultation', priceMinor: 0 })); assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().entry.revision, 2);
  const history = (await get(admin, `services/${svc.id}/history`)).json(); assert.equal(history.events.length, 2);
  assert.equal(history.events[1].snapshot.priceMinor, 12345); assert.equal(history.events[1].snapshot.departmentName, dep.name); assert.equal(history.events[1].snapshot.name, svc.name);
  assert.equal(history.events[0].snapshot.departmentName, 'New department name'); assert.equal(history.events[0].snapshot.priceMinor, 0);
  assert.equal((await get(staff, 'services')).json().total, 1);
  await command(admin, { type: 'department.update', id: dep.id, expectedRevision: 2, name: 'New department name', active: false });
  assert.equal((await get(staff, 'services')).json().total, 0); assert.equal((await get(staff, 'departments')).json().total, 0);
  assert.equal((await get(staff, `services/${svc.id}`)).statusCode, 404); assert.equal((await get(admin, 'services')).json().total, 1);
  const fresh = result.json().entry; assert.equal((await command(admin, updateService(fresh, { priceMinor: 50 }))).json().code, 'INVALID_DEPARTMENT');
  assert.equal((await command(admin, updateService(fresh, { active: false }))).statusCode, 200);
  await assert.rejects(pool.query('UPDATE hospital_service_versions SET price_minor=1'), /immutable/);
  await assert.rejects(pool.query('DELETE FROM hospital_service_versions'), /immutable/);
  const rows = await pool.query('SELECT * FROM hospital_service_versions ORDER BY revision'); assert.equal(rows.rows[0].price_minor, 12345); assert.equal(rows.rows[0].actor_id, admin.id);
});
test('hospital and role boundaries, CSRF/origin and foreign/inactive department rejection', async () => {
  const dep = await department(); const foreign = await department(other); const svc = await service(dep);
  assert.equal((await get(other, `departments/${dep.id}`)).statusCode, 404); assert.equal((await get(other, `services/${svc.id}/history`)).statusCode, 404);
  assert.equal((await command(other, updateService(svc))).statusCode, 404);
  assert.equal((await get(staff, `departments/${dep.id}/history`)).statusCode, 403); assert.equal((await get(staff, `services/${svc.id}/history`)).statusCode, 403);
  assert.equal((await command(staff, { type: 'department.create', name: 'Denied', code: 'NO' })).statusCode, 403);
  assert.equal((await command(admin, { type: 'service.create', name: 'Denied', code: 'NO', departmentId: foreign.id, priceMinor: 10 })).json().code, 'INVALID_DEPARTMENT');
  for (const bad of [-1, 1.1, MAX_PRICE_MINOR + 1]) assert.equal((await command(admin, updateService(svc, { priceMinor: bad }))).statusCode, 400);
  for (const path of ['services?hospitalId=x', 'departments?page=0', `services/${svc.id}/history?unexpected=yes`]) assert.equal((await get(admin, path)).statusCode, 400);
  for (const h of [{ cookie: admin.cookie }, { ...headers(admin), origin: 'https://evil.invalid' }, { ...headers(admin), 'x-csrf-token': 'bad' }]) assert.equal((await app.inject({ method: 'POST', url: '/api/configuration/commands', headers: h, payload: { type: 'department.create', name: 'Denied', code: 'NO' } })).statusCode, 403);
  assert.equal((await get(other, 'services')).json().total, 0);
});
test('identical retries return original saved projection after subsequent edit; changed payload or actor conflicts', async () => {
  const dep = await department(); const key = randomUUID(); const input = { type: 'service.create', name: 'First name', code: 'TEST', departmentId: dep.id, priceMinor: 1 } as const;
  const first = await command(admin, input, key); const svc = first.json().entry;
  await command(admin, updateService(svc, { name: 'Second name', priceMinor: 99 }));
  const replay = await command(admin, input, key); assert.deepEqual(replay.json(), first.json());
  assert.equal((await command(admin, { ...input, priceMinor: 2 }, key)).json().code, 'IDEMPOTENCY_CONFLICT');
  const secondAdmin = await actor(admin.hospital, 'admin'); assert.equal((await command(secondAdmin, input, key)).statusCode, 409);
  assert.equal((await pool.query('SELECT * FROM hospital_service_versions WHERE service_id=$1', [svc.id])).rowCount, 2);
  assert.equal((await get(admin, `services/${svc.id}/history`)).json().total, 2);
});
test('overlapping edits advance once and simultaneous same-key creates replay atomically', async () => {
  const dep = await department(); const svc = await service(dep);
  const edits = await Promise.all([command(admin, updateService(svc, { priceMinor: 9 })), command(admin, updateService(svc, { priceMinor: 10 }))]);
  assert.deepEqual(edits.map(row => row.statusCode).sort(), [200, 409]);
  const key = randomUUID(); const input = { type: 'department.create', name: 'Concurrent', code: 'RACE' } as const;
  const results = await Promise.all([command(admin, input, key), command(admin, input, key)]); assert.deepEqual(results[0].json(), results[1].json());
  assert.equal((await pool.query('SELECT * FROM hospital_configuration_requests WHERE idempotency_key=$1', [key])).rowCount, 1);
});
test('audit failure rolls back current revision, version and idempotency receipt', async () => {
  const dep = await department(); const svc = await service(dep); const key = randomUUID();
  await pool.query("ALTER TABLE hospital_configuration_events ADD CONSTRAINT reject_test CHECK(action <> 'service.update')");
  try {
    const response = await command(admin, updateService(svc), key); assert.equal(response.statusCode, 500); assert.equal(response.body.includes('reject_test'), false);
    assert.equal((await get(admin, `services/${svc.id}`)).json().entry.revision, 1);
    assert.equal((await pool.query('SELECT * FROM hospital_service_versions WHERE service_id=$1', [svc.id])).rowCount, 1);
    assert.equal((await pool.query('SELECT * FROM hospital_configuration_requests WHERE idempotency_key=$1', [key])).rowCount, 0);
  } finally { await pool.query('ALTER TABLE hospital_configuration_events DROP CONSTRAINT reject_test'); }
  assert.equal((await command(admin, updateService(svc), key)).statusCode, 200);
});
async function waitForLock(mode: 'UPDATE' | 'SHARE' = 'UPDATE') {
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = await database.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND query LIKE $2 AND wait_event_type='Lock' AND pid <> pg_backend_pid()", [schema, `SELECT id FROM hospitals%FOR ${mode}`]);
    if (result.rowCount) return; await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Configuration request did not wait on hospital ${mode} lock.`);
}
test('revoked administrator cannot commit after hospital lock wait', async () => {
  const blocker = await pool.connect(); await blocker.query('BEGIN'); await blocker.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [admin.hospital]);
  const waiting = command(admin, { type: 'department.create', name: 'Must not exist', code: 'DENIED' }).then(value => value);
  try { await waitForLock(); await blocker.query('UPDATE staff_users SET active=false WHERE id=$1', [admin.id]); await blocker.query('DELETE FROM staff_sessions WHERE user_id=$1', [admin.id]); await blocker.query('COMMIT');
    assert.equal((await waiting).statusCode, 401); assert.equal((await pool.query('SELECT * FROM hospital_departments')).rowCount, 0);
  } finally { await blocker.query('ROLLBACK'); blocker.release(); }
});
test('pagination/search are literal and hospital scoped; history paginates', async () => {
  for (let i = 0; i < 27; i++) await department(admin, `DEP${String(i).padStart(2, '0')}`);
  assert.equal((await get(admin, 'departments')).json().entries.length, 25); assert.equal((await get(admin, 'departments?page=2')).json().entries.length, 2);
  assert.equal((await get(admin, 'departments?q=DEP26')).json().total, 1); assert.equal((await get(admin, 'departments?q=%25')).json().total, 0); assert.equal((await get(other, 'departments')).json().total, 0);
  const dep = await department(admin, 'HISTORY');
  for (let revision = 1; revision <= 26; revision++) assert.equal((await command(admin, { type: 'department.update', id: dep.id, expectedRevision: revision, name: `Revision ${revision + 1}`, active: true })).statusCode, 200);
  assert.equal((await get(admin, `departments/${dep.id}/history`)).json().events.length, 25); assert.equal((await get(admin, `departments/${dep.id}/history?page=2`)).json().events.length, 2);
});
test('current authority check rejects role demotion and forced password replacement after lock wait', async () => {
  for (const assignment of ["role='clinician'", 'password_change_required=true']) {
    const user = await actor(admin.hospital, 'admin');
    const blocker = await pool.connect(); await blocker.query('BEGIN'); await blocker.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [admin.hospital]);
    const waiting = command(user, { type: 'department.create', name: 'Forbidden pending write', code: 'WAIT' }).then(value => value);
    try { await waitForLock(); await blocker.query(`UPDATE staff_users SET ${assignment} WHERE id=$1`, [user.id]); await blocker.query('COMMIT'); assert.equal((await waiting).statusCode, 401); }
    finally { await blocker.query('ROLLBACK'); blocker.release(); }
  }
  assert.equal((await pool.query('SELECT * FROM hospital_configuration_requests')).rowCount, 0);
});
test('session expiration during hospital lock wait cannot authorize a later commit', async () => {
  const blocker = await pool.connect(); await blocker.query('BEGIN'); await blocker.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [admin.hospital]);
  const waiting = command(admin, { type: 'department.create', name: 'Expired pending write', code: 'EXPIRED' }).then(value => value);
  try {
    await waitForLock(); await blocker.query('UPDATE staff_sessions SET expires_at=clock_timestamp() WHERE user_id=$1', [admin.id]); await blocker.query('COMMIT');
    assert.equal((await waiting).statusCode, 401); assert.equal((await pool.query('SELECT * FROM hospital_departments')).rowCount, 0);
  } finally { await blocker.query('ROLLBACK'); blocker.release(); }
});

test('active filtering precedes pagination, preserves default catalogs and remains hospital scoped', async () => {
  for (let index = 0; index < 25; index++) {
    const dep = await department(admin, `A${String(index).padStart(2, '0')}`);
    assert.equal((await command(admin, { type: 'department.update', id: dep.id, expectedRevision: 1, name: dep.name, active: false })).statusCode, 200);
  }
  const active: Department[] = [];
  for (let index = 0; index < 27; index++) active.push(await department(admin, `Z${String(index).padStart(2, '0')}`));
  await department(other, 'ZOTHER');
  const defaults = (await get(admin, 'departments')).json();
  assert.equal(defaults.total, 52); assert.ok(defaults.entries.every((entry: Department) => !entry.active));
  for (const user of [admin, staff]) {
    const first = (await get(user, 'departments?active=true')).json(); const second = (await get(user, 'departments?active=true&page=2')).json();
    assert.equal(first.total, 27); assert.equal(first.entries.length, 25); assert.equal(first.entries[0].code, 'Z00');
    assert.equal(second.total, 27); assert.deepEqual(second.entries.map((entry: Department) => entry.code), ['Z25', 'Z26']);
    assert.equal((await get(user, 'departments?active=true&q=A00')).json().total, 0);
    assert.equal((await get(user, 'departments?active=true&q=Z26')).json().total, 1);
    assert.equal((await get(user, 'departments?active=true&q=%25')).json().total, 0);
    for (const value of ['false', '1', '', 'TRUE', 'true&active=true']) assert.equal((await get(user, `departments?active=${value}`)).statusCode, 400);
  }
  assert.equal((await get(staff, 'departments')).json().total, 27);
  assert.equal((await get(other, 'departments?active=true')).json().total, 1);
  const available = await service(active[0], admin, 'AVAILABLE'); const retired = await service(active[1], admin, 'RETIRED'); const hidden = await service(active[2], admin, 'HIDDEN');
  await command(admin, updateService(retired, { active: false }));
  await command(admin, { type: 'department.update', id: active[2].id, expectedRevision: 1, name: active[2].name, active: false });
  assert.equal((await get(admin, 'services')).json().total, 3);
  for (const path of ['services?active=true', 'services?active=true&q=AVAILABLE']) assert.deepEqual((await get(admin, path)).json().entries.map((entry: Service) => entry.id), [available.id]);
  assert.equal((await get(staff, 'services')).json().total, 1);
  assert.equal((await get(staff, `services/${hidden.id}`)).statusCode, 404);
});

test('list, detail and history reads recheck authority after their shared hospital lock wait', async () => {
  const dep = await department(); const svc = await service(dep);
  const paths = ['departments?active=true', 'services', `departments/${dep.id}`, `services/${svc.id}`, `departments/${dep.id}/history`, `services/${svc.id}/history`];
  for (const path of paths) {
    for (const change of ['revoke', 'demote', 'password', 'expire', 'move'] as const) {
      const reader = await actor(admin.hospital, 'admin'); const blocker = await pool.connect();
      await blocker.query('BEGIN'); await blocker.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [admin.hospital]);
      const waiting = get(reader, path).then(value => value);
      try {
        await waitForLock('SHARE');
        if (change === 'revoke') { await blocker.query('UPDATE staff_users SET active=false WHERE id=$1', [reader.id]); await blocker.query('DELETE FROM staff_sessions WHERE user_id=$1', [reader.id]); }
        else if (change === 'demote') await blocker.query("UPDATE staff_users SET role='clinician' WHERE id=$1", [reader.id]);
        else if (change === 'password') await blocker.query('UPDATE staff_users SET password_change_required=true WHERE id=$1', [reader.id]);
        else if (change === 'expire') await blocker.query('UPDATE staff_sessions SET expires_at=clock_timestamp() WHERE user_id=$1', [reader.id]);
        else await blocker.query('UPDATE staff_users SET hospital_id=$2 WHERE id=$1', [reader.id, other.hospital]);
        await blocker.query('COMMIT');
        const response = await waiting;
        assert.equal(response.statusCode, 401, `${path}: ${change}`); assert.equal(response.json().code, 'UNAUTHENTICATED');
        assert.equal(response.body.includes(dep.name), false); assert.equal(response.body.includes(svc.name), false);
      } finally { await blocker.query('ROLLBACK'); blocker.release(); }
    }
  }
});

test('service reassignment retains original version and rejects foreign or inactive departments', async () => {
  const original = await department(); const target = await department(admin, 'TARGET'); const foreign = await department(other);
  const inactive = await department(admin, 'INACTIVE'); const svc = await service(original);
  await command(admin, { type: 'department.update', id: inactive.id, expectedRevision: 1, name: inactive.name, active: false });
  const result = await command(admin, updateService(svc, { departmentId: target.id, priceMinor: 999 }));
  assert.equal(result.statusCode, 200); assert.equal(result.json().entry.departmentId, target.id);
  const history = (await get(admin, `services/${svc.id}/history`)).json().events;
  assert.equal(history[0].snapshot.departmentCode, target.code); assert.equal(history[0].snapshot.priceMinor, 999);
  assert.equal(history[1].snapshot.departmentId, original.id); assert.equal(history[1].snapshot.departmentCode, original.code); assert.equal(history[1].snapshot.priceMinor, 12345);
  const first = (await pool.query('SELECT department_id,price_minor FROM hospital_service_versions WHERE service_id=$1 AND revision=1', [svc.id])).rows[0];
  assert.equal(first.department_id, original.id); assert.equal(first.price_minor, 12345);
  for (const departmentId of [foreign.id, inactive.id]) {
    const rejected = await command(admin, updateService(result.json().entry, { departmentId }));
    assert.equal(rejected.statusCode, 400); assert.equal(rejected.json().code, 'INVALID_DEPARTMENT');
  }
  assert.equal((await get(admin, `services/${svc.id}/history`)).json().total, 2);
});

test('hospital lock timeout rolls back safely and the same request key can succeed after release', async () => {
  const blocker = await pool.connect(); const key = randomUUID(); const input = { type: 'department.create', name: 'Fictional timeout retry', code: 'TIMEOUT' } as const;
  await blocker.query('BEGIN'); await blocker.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [admin.hospital]);
  try {
    const waiting = command(admin, input, key).then(value => value); await waitForLock();
    const response = await waiting; assert.equal(response.statusCode, 503); assert.equal(response.json().code, 'CONFIGURATION_BUSY');
    assert.equal(response.body.includes('lock timeout'), false);
    for (const table of ['hospital_departments', 'hospital_configuration_events', 'hospital_configuration_requests']) assert.equal((await pool.query(`SELECT * FROM ${table}`)).rowCount, 0);
    await blocker.query('COMMIT');
    const retry = await command(admin, input, key); assert.equal(retry.statusCode, 200);
    for (const table of ['hospital_departments', 'hospital_configuration_events', 'hospital_configuration_requests']) assert.equal((await pool.query(`SELECT * FROM ${table}`)).rowCount, 1);
  } finally { await blocker.query('ROLLBACK'); blocker.release(); }
});
