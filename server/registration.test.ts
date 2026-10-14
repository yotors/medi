import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import pg from 'pg';
import { buildApp } from './app.ts';
import { digest, hashPassword, SESSION_COOKIE, verifyPassword } from './auth.ts';
import { createPool, migrate } from './db.ts';
import { decodePasswordFile, provisionStaff } from './setup.ts';

const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('PostgreSQL integration tests require TEST_DATABASE_URL or DATABASE_URL.');
const schema = `registration_test_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString });
const pool = new pg.Pool({ connectionString, application_name: schema, options: `-c search_path=${schema}` });
const origin = 'http://127.0.0.1:5173';
const password = 'Synthetic-test-password-42';
let app = buildApp({ pool, origin });
let ids: { receptionist: string; auditor: string; admin: string; other: string };
type Auth = { cookie: string; csrf: string; userId: string };
async function login(username = 'reception', hospitalCode = 'alpha', suppliedPassword = password) {
  return app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin }, payload: { hospitalCode, username, password: suppliedPassword } });
}
async function signedIn(username = 'reception', hospitalCode = 'alpha'): Promise<Auth> {
  const response = await login(username, hospitalCode);
  assert.equal(response.statusCode, 200, response.body);
  return { cookie: String(response.headers['set-cookie']).split(';')[0], csrf: response.json().csrfToken, userId: response.json().user.id };
}
const headers = (auth: Auth, key: string = randomUUID()) => ({ origin, cookie: auth.cookie, 'x-csrf-token': auth.csrf, 'idempotency-key': key });
const create = (auth: Auth, body: Record<string, unknown> = { name: 'Synthetic Patient', contact: '' }, key?: string) => app.inject({ method: 'POST', url: '/api/patients', headers: headers(auth, key), payload: body });
const search = (auth: Auth, payload: Record<string, unknown> = {}) => app.inject({ method: 'POST', url: '/api/patients/search', headers: headers(auth), payload });
const get = (auth: Auth, url = '/api/patients') => app.inject({ method: 'GET', url, headers: { cookie: auth.cookie } });

before(async () => {
  // Schema name contains only a fixed prefix and random hex; never user input.
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
  const hash = await hashPassword(password);
  const alpha = randomUUID(); const beta = randomUUID();
  await pool.query('INSERT INTO hospitals(id,code,name) VALUES ($1,$2,$3),($4,$5,$6)', [alpha, 'alpha', 'Alpha Synthetic Hospital', beta, 'beta', 'Beta Synthetic Hospital']);
  ids = { receptionist: randomUUID(), auditor: randomUUID(), admin: randomUUID(), other: randomUUID() };
  for (const [id, hospital, username, role] of [[ids.receptionist, alpha, 'reception', 'receptionist'], [ids.auditor, alpha, 'audit', 'auditor'], [ids.admin, alpha, 'admin', 'admin'], [ids.other, beta, 'reception', 'receptionist']]) {
    await pool.query('INSERT INTO staff_users(id,hospital_id,username,display_name,role,password_hash) VALUES ($1,$2,$3,$4,$5,$6)', [id, hospital, username, 'Synthetic Staff', role, hash]);
  }
});
beforeEach(async () => {
  await pool.query('TRUNCATE outpatient_requests,outpatient_visits,audit_events,registration_requests,patients,staff_sessions,login_buckets CASCADE');
  await pool.query('UPDATE hospitals SET next_record_number=1');
  await pool.query('UPDATE staff_users SET active=true');
});
after(async () => {
  await app.close();
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

test('passwords use per-password salt and scrypt verification', async () => {
  const a = await hashPassword(password); const b = await hashPassword(password);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword(password, a), true);
  assert.equal(await verifyPassword('incorrect', a), false);
});

test('authentication is generic, JSON-only, strict, origin-bound and no-store', async () => {
  for (const url of ['/api/patients', `/api/patients/${randomUUID()}`, '/api/auth/session']) {
    const response = await app.inject(url);
    assert.equal(response.statusCode, 401); assert.equal(response.headers['cache-control'], 'no-store');
  }
  const wrong = await login('reception', 'alpha', 'incorrect');
  const missing = await login('missing', 'alpha');
  assert.equal(wrong.statusCode, 401); assert.deepEqual(wrong.json(), missing.json());
  const forbidden = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { hospitalCode: 'alpha', username: 'reception', password } });
  assert.equal(forbidden.statusCode, 403);
  const text = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin, 'content-type': 'text/plain' }, payload: '{}' });
  assert.equal(text.statusCode, 400);
  const extra = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin }, payload: { hospitalCode: 'alpha', username: 'reception', password, hospitalId: randomUUID() } });
  assert.equal(extra.statusCode, 400);
  const malformed = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin, 'content-type': 'application/json' }, payload: '{"password":"secret-invalid-json"' });
  assert.equal(malformed.statusCode, 400); assert.doesNotMatch(malformed.body, /secret-invalid-json/);
});

test('sessions are hashed, absolute-bounded with idle expiry, survive application restart and revoke on logout', async () => {
  const response = await login();
  assert.equal(response.statusCode, 200);
  const setCookie = String(response.headers['set-cookie']);
  assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Strict/);
  const auth = { cookie: setCookie.split(';')[0], csrf: response.json().csrfToken, userId: response.json().user.id };
  const token = auth.cookie.slice(`${SESSION_COOKIE}=`.length);
  const { rows: [stored] } = await pool.query('SELECT * FROM staff_sessions');
  assert.equal(stored.token_hash, digest(token)); assert.notEqual(stored.token_hash, token);
  assert.equal(response.json().expiresAt, stored.idle_expires_at.toISOString());
  assert.equal(stored.expires_at.getTime()-stored.created_at.getTime() <= 8*60*60*1000+1000,true);
  const registered = await create(auth);
  assert.equal(registered.statusCode, 201);
  await app.close(); app = buildApp({ pool, origin });
  assert.equal((await get(auth)).json().patients[0].id, registered.json().patient.id);
  const effective=(await get(auth, '/api/auth/session')).json().expiresAt;
  assert.ok(Date.parse(effective)>=stored.idle_expires_at.getTime() && Date.parse(effective)<stored.expires_at.getTime());
  assert.equal((await pool.query('SELECT expires_at FROM staff_sessions')).rows[0].expires_at.getTime(), stored.expires_at.getTime());
  const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: headers(auth) });
  assert.equal(logout.statusCode, 204);
  assert.equal((await get(auth)).statusCode, 401);
});

test('expired and inactive sessions deny access and inactive accounts cannot login', async () => {
  const auth = await signedIn();
  await pool.query("UPDATE staff_sessions SET expires_at=now()-interval '1 second'");
  assert.equal((await get(auth)).statusCode, 401);
  const second = await signedIn();
  await pool.query('UPDATE staff_users SET active=false WHERE id=$1', [ids.receptionist]);
  assert.equal((await get(second)).statusCode, 401);
  assert.equal((await login()).statusCode, 401);
});

test('hospital isolation holds for IDs, headers, queries and bodies; auditor is read-only', async () => {
  const alpha = await signedIn(); const beta = await signedIn('reception', 'beta'); const audit = await signedIn('audit');
  const created = await create(alpha); assert.equal(created.statusCode, 201);
  const id = created.json().patient.id;
  assert.equal((await get(beta, `/api/patients/${id}`)).statusCode, 404);
  assert.deepEqual((await get(beta)).json().patients, []);
  const injected = await app.inject({ url: '/api/patients', headers: { cookie: beta.cookie, 'x-hospital-id': (await get(alpha, '/api/auth/session')).json().user.hospital.id } });
  assert.equal(injected.json().total, 0);
  assert.equal((await get(beta, `/api/patients?hospitalId=${randomUUID()}`)).statusCode, 400);
  assert.equal((await create(beta, { name: 'Injected', hospitalId: randomUUID() })).statusCode, 400);
  assert.equal((await get(audit)).json().total, 1);
  assert.equal((await create(audit)).statusCode, 403);
  const adminAuth = await signedIn('admin'); assert.equal((await create(adminAuth, { name: 'Admin patient' })).statusCode, 201);
});

test('mutations require exact Origin and session CSRF; errors do not echo patient fields', async () => {
  const auth = await signedIn();
  for (const override of [{ origin: 'http://localhost:5173' }, { origin: `${origin}.evil.test` }, { 'x-csrf-token': 'wrong' }]) {
    const response = await app.inject({ method: 'POST', url: '/api/patients', headers: { ...headers(auth), ...override }, payload: { name: 'Private synthetic name' } });
    assert.equal(response.statusCode, 403); assert.doesNotMatch(response.body, /Private synthetic/);
  }
  assert.equal((await get(auth)).json().total, 0);
});

test('registration is atomic, attributable, idempotent across concurrent requests and payload conflicts', async () => {
  const auth = await signedIn(); const key = randomUUID(); const body = { name: 'Concurrent Patient', age: 0, contact: 'Synthetic contact' };
  const responses = await Promise.all(Array.from({ length: 5 }, () => create(auth, body, key)));
  assert.equal(responses.filter(response => response.statusCode === 201).length, 1);
  assert.equal(new Set(responses.map(response => response.json().patient.id)).size, 1);
  assert.equal((await pool.query('SELECT * FROM patients')).rowCount, 1);
  const events = await pool.query('SELECT * FROM audit_events');
  assert.equal(events.rowCount, 1); assert.equal(events.rows[0].actor_id, auth.userId);
  const conflict = await create(auth, { ...body, age: 1 }, key);
  assert.equal(conflict.statusCode, 409); assert.equal(conflict.json().code, 'IDEMPOTENCY_CONFLICT');
});

test('same-hospital concurrent duplicate names require explicit confirmation', async () => {
  const auth = await signedIn();
  const responses = await Promise.all([create(auth, { name: 'Synthetic Same' }), create(auth, { name: 'synthetic   same' })]);
  assert.deepEqual(responses.map(response => response.statusCode).sort(), [201, 409]);
  const conflict = responses.find(response => response.statusCode === 409)!;
  assert.equal(conflict.json().code, 'DUPLICATE_PATIENT');
  const confirmed = await create(auth, { name: 'Synthetic Same', confirmDuplicate: true });
  assert.equal(confirmed.statusCode, 201);
  assert.equal(confirmed.json().patient.recordNumber, 'MRN-000002');
  const other = await signedIn('reception', 'beta');
  assert.equal((await create(other, { name: 'Synthetic Same' })).statusCode, 201);
});

test('audit failure rolls back patient, counter and replay key; retry succeeds once repaired', async () => {
  const auth = await signedIn(); const key = randomUUID();
  await pool.query("ALTER TABLE audit_events ADD CONSTRAINT test_reject_audit CHECK (action <> 'patient.registered')");
  try {
    const response = await create(auth, { name: 'Rollback Patient' }, key);
    assert.equal(response.statusCode, 500); assert.doesNotMatch(response.body, /Rollback Patient|constraint|INSERT/);
    assert.equal((await pool.query('SELECT * FROM patients')).rowCount, 0);
    assert.equal((await pool.query('SELECT * FROM registration_requests')).rowCount, 0);
  } finally { await pool.query('ALTER TABLE audit_events DROP CONSTRAINT test_reject_audit'); }
  const retried = await create(auth, { name: 'Rollback Patient' }, key);
  assert.equal(retried.statusCode, 201); assert.equal(retried.json().patient.recordNumber, 'MRN-000001');
});

test('field bounds, unknown fields, query bounds, UUID keys and literal SQL search are enforced', async () => {
  const auth = await signedIn();
  for (const body of [{ name: 'bad\u0000name' }, { name: 'X', contact: 'bad\u0000contact' }, { name: '' }, { name: 'x'.repeat(101) }, { name: 'X', age: -1 }, { name: 'X', age: 121 }, { name: 'X', age: 1.5 }, { name: 'X', contact: 'x'.repeat(101) }, { name: 'X', email: 'extra' }]) {
    assert.equal((await create(auth, body)).statusCode, 400);
  }
  assert.equal((await create(auth, { name: 'X' }, 'bad')).statusCode, 400);
  for (const query of ['q=%00', 'page=0', 'page=10001', 'page=abc', `q=${'x'.repeat(101)}`]) assert.equal((await get(auth, `/api/patients?${query}`)).statusCode, 400);
  const injection = "Robert'); DROP TABLE patients;--";
  assert.equal((await create(auth, { name: injection, age: 120 })).statusCode, 201);
  assert.equal((await search(auth, { q: injection })).json().total, 1);
  assert.equal((await search(auth, { q: '%' })).json().total, 0);
});

test('directory pagination is stable newest-first with fixed page size and hospital scope', async () => {
  const auth = await signedIn();
  for (let index = 0; index < 27; index++) assert.equal((await create(auth, { name: `Patient ${index}` })).statusCode, 201);
  const first = (await search(auth)).json(); const second = (await search(auth, { page: 2 })).json();
  assert.equal(first.total, 27); assert.equal(first.pageSize, 25); assert.equal(first.patients.length, 25); assert.equal(second.patients.length, 2);
  assert.equal(first.patients[0].name, 'Patient 26');
  assert.equal(new Set([...first.patients, ...second.patients].map(p => p.id)).size, 27);
  assert.deepEqual((await get(auth)).json(), first);
});

test('login rate buckets persist through restart, conceal identifiers and expire', async () => {
  for (let index = 0; index < 10; index++) assert.equal((await login('missing-user', 'alpha', 'incorrect')).statusCode, 401);
  await app.close(); app = buildApp({ pool, origin });
  assert.equal((await login('missing-user')).statusCode, 429);
  const { rows } = await pool.query('SELECT * FROM login_buckets');
  assert.equal(rows.length, 2); assert.ok(rows.every(row => /^[a-f0-9]{64}$/.test(row.bucket_hash)));
  assert.doesNotMatch(JSON.stringify(rows), /missing-user|127\.0\.0\.1/);
  await pool.query("UPDATE login_buckets SET expires_at=now()-interval '1 second'");
  assert.equal((await login('missing-user')).statusCode, 401);
});

test('provisioning never overwrites accounts and migrations are replay-safe', async () => {
  await migrate(pool);
  await assert.rejects(provisionStaff(pool, { hospitalCode: 'alpha', hospitalName: 'Alpha Synthetic Hospital', username: 'reception', displayName: 'Changed', role: 'admin', password }), /already exists/);
  assert.equal((await pool.query('SELECT role FROM staff_users WHERE id=$1', [ids.receptionist])).rows[0].role, 'receptionist');
  const staff = await provisionStaff(pool, { hospitalCode: 'alpha', hospitalName: 'Alpha Synthetic Hospital', username: 'new-staff', displayName: 'New staff', role: 'auditor', password });
  assert.ok(staff.id);
});

test('production configuration rejects HTTP and insecure cookies', () => {
  const prior = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(() => buildApp({ pool, origin }), /HTTPS/);
    assert.throws(() => buildApp({ pool, origin: 'https://staff.example.test', secureCookies: false }), /HTTPS/);
  } finally { if (prior === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prior; }
});

test('directory finds normalized duplicate names with double spaces and fullwidth case while escaping wildcards', async () => {
  const auth = await signedIn();
  const created = await create(auth, { name: 'Ｓｙｎｔｈｅｔｉｃ   Ｐａｔｉｅｎｔ' });
  assert.equal(created.statusCode, 201);
  const duplicate = await create(auth, { name: 'synthetic patient' });
  assert.equal(duplicate.json().code, 'DUPLICATE_PATIENT');
  for (const query of ['synthetic patient', 'SYNTHETIC  PATIENT', 'ＳＹＮＴＨＥＴＩＣ　ＰＡＴＩＥＮＴ']) {
    const directory = (await search(auth, { q: query })).json();
    assert.equal(directory.total, 1); assert.equal(directory.patients[0].id, created.json().patient.id);
  }
  for (const query of ['%', '_', '％', '＿']) assert.equal((await search(auth, { q: query })).json().total, 0);
});

test('idle pool errors are handled with sanitized output', async context => {
  const messages: string[] = [];
  const write = context.mock.method(process.stderr, 'write', ((chunk: unknown) => { messages.push(String(chunk)); return true; }) as typeof process.stderr.write);
  const idlePool = createPool(connectionString);
  try {
    assert.doesNotThrow(() => idlePool.emit('error', new Error('postgres://secret-user:secret-password@private-host/database')));
    assert.match(messages.join(''), /idle database connection failed/);
    assert.doesNotMatch(messages.join(''), /secret-user|secret-password|private-host/);
  } finally { write.mock.restore(); await idlePool.end(); }
});

test('password file preserves spaces and strips only one LF or CRLF; provisioning rejects NUL fields', async () => {
  const spaced = `  ${password}  `;
  for (const ending of ['', '\n', '\r\n']) assert.equal(decodePasswordFile(`${spaced}${ending}`), spaced);
  assert.equal(decodePasswordFile(`${spaced}\n\n`), `${spaced}\n`);
  const input = { hospitalCode: 'alpha', hospitalName: 'Alpha Synthetic Hospital', username: 'spaced-password', displayName: 'Staff', role: 'auditor' as const, password: decodePasswordFile(`${spaced}\r\n`) };
  for (const field of ['hospitalCode', 'hospitalName', 'username', 'displayName', 'password'] as const) {
    await assert.rejects(provisionStaff(pool, { ...input, [field]: `${input[field]}\0` }), /Invalid provisioning/);
  }
  await provisionStaff(pool, input);
  assert.equal((await login(input.username, 'alpha', spaced)).statusCode, 200);
  assert.equal((await login(input.username, 'alpha', spaced.trim())).statusCode, 401);
});

test('migration refuses an unrelated populated schema without changing its sentinel or creating a marker', async () => {
  const unrelatedSchema = `unrelated_test_${randomUUID().replaceAll('-', '')}`;
  const unrelated = new pg.Pool({ connectionString, options: `-c search_path=${unrelatedSchema}` });
  await admin.query(`CREATE SCHEMA ${unrelatedSchema}`);
  try {
    await unrelated.query('CREATE TABLE sentinel (value text NOT NULL)');
    await unrelated.query('INSERT INTO sentinel(value) VALUES ($1)', ['keep unchanged']);
    await assert.rejects(migrate(unrelated), /unrelated database schema/);
    assert.deepEqual((await unrelated.query('SELECT * FROM sentinel')).rows, [{ value: 'keep unchanged' }]);
    assert.deepEqual((await unrelated.query('SELECT tablename FROM pg_tables WHERE schemaname=current_schema()')).rows, [{ tablename: 'sentinel' }]);
  } finally {
    await unrelated.end();
    await admin.query(`DROP SCHEMA ${unrelatedSchema} CASCADE`);
  }
});

test('private patient search is strict JSON, session protected and rejects every legacy q', async () => {
  const auth = await signedIn();
  await create(auth);
  for (const payload of [{ q: '\0' }, { q: 'x'.repeat(101) }, { page: '1' }, { page: null }, { page: 0 }, { page: 10001 }, { unknown: true }, { q: null }]) assert.equal((await search(auth, payload)).statusCode, 400);
  for (const url of ['/api/patients?q=', '/api/patients?q=anything', '/api/patients/search?page=1']) {
    const response = url.includes('/search') ? await app.inject({ method: 'POST', url, headers: headers(auth), payload: {} }) : await get(auth, url);
    assert.equal(response.statusCode, 400);
  }
  for (const override of [{ origin: 'https://wrong.invalid' }, { 'x-csrf-token': '' }, { cookie: '' }]) {
    const response = await app.inject({ method: 'POST', url: '/api/patients/search', headers: { ...headers(auth), ...override }, payload: {} });
    assert.equal(response.statusCode, 'cookie' in override ? 401 : 403);
  }
  assert.equal((await app.inject({ method: 'POST', url: '/api/patients/search', headers: { ...headers(auth), 'content-type': 'text/plain' }, payload: '{}' })).statusCode, 400);
  assert.equal((await search(await signedIn('reception', 'beta'), { q: 'Synthetic' })).json().total, 0);
  await pool.query('UPDATE staff_users SET password_change_required=true WHERE id=$1', [auth.userId]);
  try { assert.equal((await search(auth)).statusCode, 403); }
  finally { await pool.query('UPDATE staff_users SET password_change_required=false WHERE id=$1', [auth.userId]); }
});

test('patient search and detail recheck every authority change after waiting for SHARE lock', async () => {
  for (const mutation of ["UPDATE staff_users SET active=false WHERE id=$1", "UPDATE staff_users SET role='auditor' WHERE id=$1", "UPDATE staff_users SET password_change_required=true WHERE id=$1", 'DELETE FROM staff_sessions WHERE user_id=$1']) {
    const auth = await signedIn();
    const p = (await create(auth, { name: `Race ${randomUUID()}` })).json().patient;
    const hospital = (await get(auth, '/api/auth/session')).json().user.hospital.id;
    const blocker = await pool.connect();
    const pending: Promise<Awaited<ReturnType<typeof get>>>[] = [];
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [hospital]);
      pending.push(search(auth).then(r => r), get(auth).then(r => r), get(auth, `/api/patients/${p.id}`).then(r => r));
      let waiting = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const result = await admin.query("SELECT 1 FROM pg_stat_activity WHERE query LIKE 'SELECT%FROM hospitals%FOR SHARE%' AND wait_event_type='Lock' AND application_name=$1", [schema]);
        if (result.rowCount! >= pending.length) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.ok(waiting);
      await blocker.query(mutation, [auth.userId]);
      await blocker.query('COMMIT');
      for (const response of await Promise.all(pending)) { assert.equal(response.statusCode, 401); assert.doesNotMatch(response.body, /patients|recordNumber|total/); }
    } finally {
      await blocker.query('ROLLBACK'); blocker.release(); await Promise.all(pending);
      await pool.query("UPDATE staff_users SET active=true,role='receptionist',password_change_required=false WHERE id=$1", [auth.userId]);
    }
  }
});

test('contended patient search and detail return bounded retryable errors and release clients', async () => {
  const auth = await signedIn(); const p = (await create(auth)).json().patient;
  const hospital = (await get(auth, '/api/auth/session')).json().user.hospital.id;
  const blocker = await pool.connect();
  try {
    await blocker.query('BEGIN'); await blocker.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [hospital]);
    const results = await Promise.all([search(auth), get(auth, `/api/patients/${p.id}`)]);
    for (const response of results) { assert.equal(response.statusCode, 503); assert.equal(response.json().code, 'PATIENTS_BUSY'); }
  } finally { await blocker.query('ROLLBACK'); blocker.release(); }
  assert.equal((await search(auth)).statusCode, 200);
  assert.equal((await get(auth, `/api/patients/${p.id}`)).statusCode, 200);
});

test('private reads bound pool saturation at session entry and route acquisition and recover without PHI', async () => {
  const auth = await signedIn(); const p = (await create(auth, { name: 'Private saturation fixture' })).json().patient;
  const hospital = (await get(auth, '/api/auth/session')).json().user.hospital.id;
  const limited = new pg.Pool({ connectionString, max: 2, connectionTimeoutMillis: 150, application_name: `${schema}_limited`, options: `-c search_path=${schema}` });
  const isolated = buildApp({ pool: limited, origin });
  const held: pg.PoolClient[] = []; let occupyAfterSession = false;
  isolated.addHook('preHandler', async () => { if (occupyAfterSession) { held.push(await limited.connect(), await limited.connect()); } });
  const requests = [
    { method: 'POST' as const, url: '/api/patients/search', payload: { q: 'Private saturation fixture' } },
    { method: 'POST' as const, url: '/api/visits/search', payload: {} },
    { method: 'GET' as const, url: `/api/patients/${p.id}` },
  ];
  const read = (input: typeof requests[number]) => isolated.inject({ ...input, headers: headers(auth) });
  const blocker = await pool.connect();
  try {
    await blocker.query('BEGIN'); await blocker.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [hospital]);
    const pending = Array.from({ length: 8 }, (_, index) => read(requests[index % requests.length]).then(r => r));
    const responses = await Promise.all(pending);
    assert.ok(responses.some(response => response.json().code === 'READ_UNAVAILABLE'));
    for (const response of responses) { assert.equal(response.statusCode, 503); assert.doesNotMatch(response.body, /Private saturation|patients|recordNumber|total|SELECT|timeout|connection/); }
    await blocker.query('ROLLBACK');
    for (const input of requests) assert.equal((await read(input)).statusCode, 200);
    // All sessions have already been read when preHandler exhausts this pool.
    occupyAfterSession = true;
    for (const input of requests) {
      const response = await read(input); assert.equal(response.statusCode, 503); assert.equal(response.json().code, 'READ_UNAVAILABLE');
      held.splice(0).forEach(client => client.release());
    }
    occupyAfterSession = false;
    for (const input of requests) assert.equal((await read(input)).statusCode, 200);
  } finally { held.splice(0).forEach(client => client.release()); await blocker.query('ROLLBACK'); blocker.release(); await isolated.close(); await limited.end(); }
});

test('natural wall-clock session expiry denies patient list, search and detail after lock wait', async () => {
  const auth = await signedIn(); const p = (await create(auth)).json().patient;
  const hospital = (await get(auth, '/api/auth/session')).json().user.hospital.id;
  await pool.query("UPDATE staff_sessions SET expires_at=clock_timestamp()+interval '1500 milliseconds' WHERE user_id=$1", [auth.userId]);
  const blocker = await pool.connect(); const pending: Promise<Awaited<ReturnType<typeof get>>>[] = [];
  try {
    await blocker.query('BEGIN'); await blocker.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [hospital]);
    pending.push(get(auth).then(r => r), search(auth).then(r => r), get(auth, `/api/patients/${p.id}`).then(r => r));
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await admin.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE '%FOR SHARE%'", [schema]);
      if (result.rowCount === 3) { waiting = true; break; } await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(waiting); await new Promise(resolve => setTimeout(resolve, 1600)); await blocker.query('COMMIT');
    for (const response of await Promise.all(pending)) { assert.equal(response.statusCode, 401); assert.doesNotMatch(response.body, /recordNumber|patients|total/); }
  } finally { await blocker.query('ROLLBACK'); blocker.release(); await Promise.all(pending); }
});

test('private patient search treats backslashes and combined wildcards literally', async () => {
  const auth = await signedIn(); await create(auth, { name: 'Fictional \\%_ patient' }); await create(auth, { name: 'Fictional other patient' });
  for (const q of ['\\', '\\%_', '%_']) assert.equal((await search(auth, { q })).json().total, 1);
  for (const q of ['\\\\', '\\_%', '\\%x']) assert.equal((await search(auth, { q })).json().total, 0);
});

test('identity event failure rolls back login and logout without cookie success',async()=>{
 await pool.query("CREATE FUNCTION reject_identity_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit unavailable'; END $$");
 const fail=()=>pool.query('CREATE TRIGGER reject_identity_event BEFORE INSERT ON identity_security_events FOR EACH ROW EXECUTE FUNCTION reject_identity_event()');
 try{
  await fail();const denied=await login();assert.equal(denied.statusCode,500);assert.equal(denied.headers['set-cookie'],undefined);assert.equal(Number((await pool.query('SELECT count(*) n FROM staff_sessions')).rows[0].n),0);
  await pool.query('DROP TRIGGER reject_identity_event ON identity_security_events');const auth=await signedIn();await fail();
  const logout=await app.inject({method:'POST',url:'/api/auth/logout',headers:headers(auth)});assert.equal(logout.statusCode,500);assert.equal(logout.headers['set-cookie'],undefined);assert.equal((await get(auth)).statusCode,200);
 }finally{await pool.query('DROP TRIGGER IF EXISTS reject_identity_event ON identity_security_events');await pool.query('DROP FUNCTION reject_identity_event()');}
});
