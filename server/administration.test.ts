import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import pg from 'pg';
import { buildApp } from './app.ts';
import { digest, hashPassword, reserveReauthentication } from './auth.ts';
import { migrate } from './db.ts';
import { provisionStaff } from './setup.ts';
import { staffRoles, type AdministrationCommand } from '../shared/administration.ts';
const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('PostgreSQL integration tests require a database.');
const schema = `administration_test_${randomUUID().replaceAll('-', '')}`;
const database = new pg.Pool({ connectionString });
const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}` });
const app = buildApp({ pool, origin: 'http://127.0.0.1:5173' });
const origin = 'http://127.0.0.1:5173'; const password = 'Synthetic administration password 42';
const secret = () => randomBytes(32).toString('base64url');
type Auth = { cookie: string; csrf: string; id: string; hospital: string };
let admin: Auth; let beta: Auth; let accounts: Record<string, Auth>; let encoded: string;
async function login(username: string, supplied = password, hospitalCode = 'alpha') {
  return app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin }, payload: { hospitalCode, username, password: supplied } });
}
async function auth(username: string, supplied = password, hospitalCode = 'alpha'): Promise<Auth> {
  const response = await login(username, supplied, hospitalCode); assert.equal(response.statusCode, 200, response.body);
  return { cookie: String(response.headers['set-cookie']).split(';')[0], csrf: response.json().csrfToken, id: response.json().user.id, hospital: response.json().user.hospital.id };
}
const headers = (user: Auth, key = randomUUID()) => ({ origin, cookie: user.cookie, 'x-csrf-token': user.csrf, 'idempotency-key': key });
const get = (user: Auth, url: string) => app.inject({ url, headers: { cookie: user.cookie } });
const command = (user: Auth, value: AdministrationCommand, key = randomUUID(), currentPassword = password) => app.inject({ method: 'POST', url: '/api/staff/commands', headers: headers(user, key), payload: { command: value, currentPassword } });
const create = (username = `staff-${randomUUID()}`, temporaryPassword = secret()) => ({ type: 'create', username, displayName: 'Synthetic Staff', role: 'clinician', temporaryPassword }) as const;
const update = (id: string, expectedRevision = 1, active = false, role: 'admin' | 'clinician' = 'clinician') => ({ type: 'update', accountId: id, expectedRevision, role, active }) as const;
const changePassword = (user: Auth, currentPassword: string, newPassword: string) => app.inject({ method: 'POST', url: '/api/auth/password', headers: headers(user), payload: { currentPassword, newPassword } });
before(async () => {
  await database.query(`CREATE SCHEMA ${schema}`); await migrate(pool); encoded = await hashPassword(password);
});
beforeEach(async () => {
  await pool.query('TRUNCATE hospitals CASCADE');
  await pool.query('TRUNCATE login_buckets');
  for (const code of ['alpha', 'beta']) {
    const id = randomUUID(); await pool.query('INSERT INTO hospitals(id,code,name) VALUES ($1,$2,$3)', [id, code, `${code} Synthetic Hospital`]);
    for (const role of staffRoles) await pool.query('INSERT INTO staff_users(id,hospital_id,username,display_name,role,password_hash) VALUES ($1,$2,$3,$4,$3,$5)', [randomUUID(), id, role, `Synthetic ${role}`, encoded]);
  }
  accounts = {}; for (const role of staffRoles) accounts[role] = await auth(role);
  admin = accounts.admin; beta = await auth('admin', password, 'beta');
});
after(async () => { await app.close(); await pool.end(); await database.query(`DROP SCHEMA ${schema} CASCADE`); await database.end(); });

test('review2: username controls and lowercase expansion are rejected consistently at every account entry point', async () => {
  for (const username of ['line\nbreak', 'line\rbreak', 'tab\tname', 'name\u007f', 'name\u0085', '\nedge', 'line\u2028break', 'İ'.repeat(100)]) {
    assert.equal((await command(admin, create(username))).statusCode, 400);
    assert.equal((await login(username)).statusCode, 400);
    await assert.rejects(provisionStaff(pool, { hospitalCode: 'alpha', hospitalName: 'alpha Synthetic Hospital', username, displayName: 'Synthetic invalid username', role: 'clinician', password }), /Invalid provisioning fields/);
  }
  assert.equal((await pool.query('SELECT * FROM staff_administration_events')).rowCount, 0);
  assert.equal((await pool.query('SELECT * FROM staff_administration_requests')).rowCount, 0);
  assert.equal((await pool.query('SELECT * FROM staff_users')).rowCount, staffRoles.length * 2);
  const input = create('İ'.repeat(50));
  const created = await command(admin, input);
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json().account.username, 'i\u0307'.repeat(50));
  assert.equal((await login(input.username, input.temporaryPassword)).statusCode, 200);
  await provisionStaff(pool, { hospitalCode: 'alpha', hospitalName: 'alpha Synthetic Hospital', username: '  Mixed.Name  ', displayName: 'Synthetic normalized username', role: 'clinician', password });
  assert.equal((await login('  MIXED.NAME  ')).statusCode, 200);
});

test('review2: event time follows hospital lock acquisition and history follows revisions', async () => {
  const blocker = await pool.connect();
  try {
    for (const perform of [() => command(admin, update(accounts.lab.id)), () => changePassword(accounts.clinician, password, 'Replacement synthetic password 42')]) {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [admin.hospital]);
      const waiting = perform().then(value => value);
      await waitForHospitalWaiter();
      const { rows: [marker] } = await blocker.query('SELECT clock_timestamp()::text AS time');
      await blocker.query('COMMIT');
      const response = await waiting; assert.equal(response.statusCode, 200, response.body);
      const { rows: [event] } = await pool.query('SELECT created_at >= $1::timestamptz AS after_lock FROM staff_administration_events ORDER BY created_at DESC LIMIT 1', [marker.time]);
      assert.equal(event.after_lock, true);
    }
    assert.equal((await command(admin, update(accounts.lab.id, 2, true))).statusCode, 200);
    await pool.query("UPDATE staff_administration_events SET created_at=clock_timestamp() + interval '1 day' WHERE account_id=$1 AND revision=2", [accounts.lab.id]);
    const history = await get(admin, `/api/staff/${accounts.lab.id}/history`);
    assert.deepEqual(history.json().events.map((event: { revision: number }) => event.revision), [3, 2]);
  } finally { await blocker.query('ROLLBACK'); blocker.release(); }
});

test('onboard, replace temporary password, revoke sessions and keep secrets out of directory/history/receipts', async () => {
  const input = create('new-staff'); const key = randomUUID();
  const concurrent = await Promise.all([command(admin, input, key), command(admin, input, key)]);
  assert.deepEqual(concurrent.map(result => result.statusCode).sort(), [200, 201]);
  assert.deepEqual(concurrent[0].json(), concurrent[1].json());
  const response = concurrent.find(result => result.statusCode === 201)!; const account = response.json().account;
  const replay = await command(admin, input, key); assert.equal(replay.statusCode, 200); assert.deepEqual(replay.json(), response.json());
  assert.equal((await command(admin, { ...input, displayName: 'Changed' }, key)).statusCode, 409);
  assert.equal((await command(admin, input)).statusCode, 409);
  const directory = await get(admin, '/api/staff'); assert.equal(directory.json().total, 8);
  assert.equal(directory.body.includes(input.temporaryPassword), false); assert.equal(directory.body.includes('password_hash'), false);
  const history = await get(admin, `/api/staff/${account.id}/history`); assert.equal(history.json().events.length, 1); assert.equal(history.body.includes(input.temporaryPassword), false);
  const { rows: [receipt] } = await pool.query('SELECT * FROM staff_administration_requests WHERE idempotency_key=$1', [key]);
  assert.match(receipt.payload_hash, /^scrypt-v1:/); assert.equal(JSON.stringify(receipt).includes(input.temporaryPassword), false);
  const temporary = await auth(input.username, input.temporaryPassword);
  assert.equal((await get(temporary, '/api/auth/session')).json().passwordChangeRequired, true);
  for (const url of ['/api/patients', '/api/visits', '/api/staff']) assert.equal((await get(temporary, url)).json().code, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await changePassword(temporary, input.temporaryPassword, 'short')).statusCode, 400);
  assert.equal((await changePassword(temporary, 'wrong', password)).statusCode, 403);
  assert.equal((await changePassword(temporary, input.temporaryPassword, password)).statusCode, 200);
  assert.equal((await get(temporary, '/api/auth/session')).statusCode, 401);
  assert.equal((await login(input.username, input.temporaryPassword)).statusCode, 401);
  const fresh = await auth(input.username); assert.equal((await get(fresh, '/api/patients')).statusCode, 200);
});

test('tenant and all role boundaries, strict validation and CSRF', async () => {
  for (const role of staffRoles.filter(role => role !== 'admin')) {
    assert.equal((await get(accounts[role], '/api/staff')).statusCode, 403);
    assert.equal((await get(accounts[role], `/api/staff/${admin.id}/history`)).statusCode, 403);
    assert.equal((await command(accounts[role], create())).statusCode, 403);
  }
  assert.equal((await get(admin, `/api/staff/${beta.id}/history`)).statusCode, 404);
  assert.equal((await command(admin, update(beta.id))).statusCode, 404);
  assert.equal((await command(admin, update(randomUUID()))).statusCode, 404);
  assert.equal((await get(admin, '/api/staff?unexpected=yes')).statusCode, 400);
  for (const invalidHeaders of [{ cookie: admin.cookie }, { ...headers(admin), origin: 'https://evil.invalid' }, { ...headers(admin), 'x-csrf-token': 'wrong' }]) assert.equal((await app.inject({ method: 'POST', url: '/api/staff/commands', headers: invalidHeaders, payload: { command: create(), currentPassword: password } })).statusCode, 403);
});

test('deactivate/reactivate preserves clinical author and invalidates old sessions; stale revisions conflict', async () => {
  const patient = await app.inject({ method: 'POST', url: '/api/patients', headers: headers(accounts.receptionist), payload: { name: 'Fictional Patient' } }); assert.equal(patient.statusCode, 201);
  const checkIn = await app.inject({ method: 'POST', url: `/api/patients/${patient.json().patient.id}/visits`, headers: headers(accounts.receptionist), payload: {} }); assert.equal(checkIn.statusCode, 201);
  const note = await app.inject({ method: 'POST', url: `/api/visits/${checkIn.json().visit.id}/commands`, headers: headers(accounts.clinician), payload: { expectedRevision: 1, command: { type: 'note', body: 'Fictional authored note' } } }); assert.equal(note.statusCode, 200, note.body);
  const removed = await command(admin, update(accounts.clinician.id)); assert.equal(removed.statusCode, 200);
  assert.equal((await command(admin, update(accounts.clinician.id))).json().code, 'REVISION_CONFLICT');
  assert.equal((await get(accounts.clinician, '/api/auth/session')).statusCode, 401);
  assert.equal((await login('clinician')).statusCode, 401);
  assert.equal((await command(admin, update(accounts.clinician.id, 2, true))).statusCode, 200);
  assert.equal((await get(accounts.clinician, '/api/auth/session')).statusCode, 401);
  const fresh = await auth('clinician'); const visit = await get(fresh, `/api/visits/${checkIn.json().visit.id}`);
  assert.ok(visit.body.includes('Fictional authored note'));
  const history = await get(admin, `/api/visits/${checkIn.json().visit.id}`); assert.ok(history.body.includes('Synthetic clinician'));
});

test('self-removal is forbidden; overlapping admins cannot remove final administrator', async () => {
  assert.equal((await command(admin, update(admin.id))).json().code, 'SELF_CHANGE');
  await pool.query("UPDATE staff_users SET role='admin' WHERE id=$1", [accounts.auditor.id]); const second = await auth('auditor');
  const results = await Promise.all([command(admin, update(second.id)), command(second, update(admin.id))]);
  assert.deepEqual(results.map(result => result.statusCode).sort(), [200, 401]);
  const { rows: [count] } = await pool.query("SELECT count(*)::integer AS count FROM staff_users WHERE hospital_id=$1 AND active AND role='admin'", [admin.hospital]); assert.equal(count.count, 1);
});

test('credential reset revokes old sessions; stale self replacement cannot revive them', async () => {
  const value = secret(); const result = await command(admin, { type: 'reset', accountId: accounts.clinician.id, expectedRevision: 1, temporaryPassword: value }); assert.equal(result.statusCode, 200);
  assert.equal((await changePassword(accounts.clinician, password, 'Another synthetic password')).statusCode, 401);
  assert.equal((await login('clinician')).statusCode, 401);
  const reset = await auth('clinician', value); assert.equal((await get(reset, '/api/patients')).statusCode, 403);
});

test('transaction rolls back account, revocation and receipt when audit fails', async () => {
  await pool.query("ALTER TABLE staff_administration_events ADD CONSTRAINT reject_test CHECK (action <> 'staff.updated')");
  try {
    assert.equal((await command(admin, update(accounts.clinician.id))).statusCode, 500);
    assert.equal((await get(accounts.clinician, '/api/auth/session')).statusCode, 200);
    const { rows: [row] } = await pool.query('SELECT active,revision FROM staff_users WHERE id=$1', [accounts.clinician.id]); assert.deepEqual(row, { active: true, revision: 1 });
    assert.equal((await pool.query('SELECT * FROM staff_administration_requests')).rowCount, 0);
  } finally { await pool.query('ALTER TABLE staff_administration_events DROP CONSTRAINT reject_test'); }
});

async function waitForHospitalWaiter() {
  for (let attempt = 0; attempt < 200; attempt++) {
    const { rows } = await database.query("SELECT 1 FROM pg_stat_activity WHERE query LIKE 'SELECT%FROM hospitals%FOR UPDATE%' AND wait_event_type='Lock' AND pid <> pg_backend_pid()");
    if (rows.length) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Expected a transaction to wait on the hospital lock.');
}
test('a clinical write waiting on hospital lock rechecks session after revocation commits', async () => {
  const blocker = await pool.connect(); await blocker.query('BEGIN'); await blocker.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [admin.hospital]);
  const waiting = app.inject({ method: 'POST', url: '/api/patients', headers: headers(accounts.receptionist), payload: { name: 'Must not persist' } }).then(value => value);
  try {
    await waitForHospitalWaiter();
    await blocker.query('UPDATE staff_users SET active=false WHERE id=$1', [accounts.receptionist.id]);
    await blocker.query('DELETE FROM staff_sessions WHERE user_id=$1', [accounts.receptionist.id]); await blocker.query('COMMIT');
    assert.equal((await waiting).statusCode, 401); assert.equal((await pool.query('SELECT * FROM patients')).rowCount, 0);
  } finally { await blocker.query('ROLLBACK'); blocker.release(); }
});
test('login verifying old credentials cannot mint a session after reset commits', async () => {
  const blocker = await pool.connect(); await blocker.query('BEGIN'); await blocker.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [admin.hospital]);
  const waiting = login('clinician').then(value => value);
  try {
    await waitForHospitalWaiter();
    await blocker.query('UPDATE staff_users SET password_hash=$2 WHERE id=$1', [accounts.clinician.id, await hashPassword(secret())]);
    await blocker.query('DELETE FROM staff_sessions WHERE user_id=$1', [accounts.clinician.id]); await blocker.query('COMMIT');
    assert.equal((await waiting).statusCode, 401); assert.equal((await pool.query('SELECT * FROM staff_sessions WHERE user_id=$1', [accounts.clinician.id])).rowCount, 0);
  } finally { await blocker.query('ROLLBACK'); blocker.release(); }
});
test('reauthentication has bounded attempts without recording passwords', async () => {
  for (let i = 0; i < 10; i++) assert.equal((await command(admin, create(), randomUUID(), 'wrong')).statusCode, 403);
  assert.equal((await command(admin, create())).statusCode, 429);
  assert.equal((await pool.query('SELECT attempts FROM login_buckets WHERE bucket_hash=$1', [digest(`reauth-account:${admin.id}`)])).rows[0].attempts, 10);
});


test('exact account lookup and bounded history preserve stable attribution beyond fuzzy page one', async () => {
  await pool.query("UPDATE staff_users SET display_name='Same actor name' WHERE id=ANY($1::uuid[])", [[admin.id, accounts.auditor.id]]);
  const target = accounts.clinician.id;
  for (let i = 0; i < 30; i++) await pool.query(`INSERT INTO staff_users(id,hospital_id,username,display_name,role,password_hash)
    VALUES ($1,$2,$3,'AAA clinician match','clinician',$4)`, [randomUUID(), admin.hospital, `clinician-${i}`, encoded]);
  const fuzzy = await get(admin, '/api/staff?q=clinician');
  assert.equal(fuzzy.json().accounts.some((row: { id: string }) => row.id === target), false);
  const exact = await get(admin, `/api/staff/${target}`); assert.equal(exact.statusCode, 200); assert.equal(exact.json().account.id, target);
  assert.equal((await get(admin, `/api/staff/${beta.id}`)).statusCode, 404);
  assert.equal((await get(admin, `/api/staff/${randomUUID()}`)).statusCode, 404);
  assert.equal((await get(accounts.auditor, `/api/staff/${target}`)).statusCode, 403);
  assert.equal((await get(admin, `/api/staff/${target}?page=1`)).statusCode, 400);
  for (let revision = 1; revision <= 31; revision++) await pool.query(`INSERT INTO staff_administration_events(id,hospital_id,actor_id,account_id,action,revision,role,active)
    VALUES ($1,$2,$3,$4,'staff.updated',$5,'clinician',true)`, [randomUUID(), admin.hospital, revision % 2 ? admin.id : accounts.auditor.id, target, revision]);
  const first = (await get(admin, `/api/staff/${target}/history`)).json();
  const second = (await get(admin, `/api/staff/${target}/history?page=2`)).json();
  assert.deepEqual([first.total, first.pageSize, first.events.length, second.events.length], [31, 25, 25, 6]);
  const all = [...first.events, ...second.events]; assert.equal(new Set(all.map(row => row.id)).size, 31);
  assert.deepEqual(new Set(all.map(row => row.actorUsername)), new Set(['admin', 'auditor']));
  assert.deepEqual(new Set(all.map(row => row.actorId)), new Set([admin.id, accounts.auditor.id]));
  assert.ok(all.every(row => row.actorName === 'Same actor name'));
  assert.equal((await get(admin, `/api/staff/${target}/history?page=0`)).statusCode, 400);
});

test('privileged reads queued before revocation recheck authority after hospital SHARE lock', async () => {
  const blocker = await pool.connect(); await blocker.query('BEGIN');
  await blocker.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [admin.hospital]);
  const paths = ['/api/staff', `/api/staff/${accounts.clinician.id}`, `/api/staff/${accounts.clinician.id}/history`];
  const pendingReads = paths.map(url => get(admin, url).then(result => result));
  try {
    let waiting = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      const { rows } = await database.query("SELECT 1 FROM pg_stat_activity WHERE query LIKE 'SELECT%FROM hospitals%FOR SHARE%' AND wait_event_type='Lock'");
      if (rows.length >= paths.length) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(waiting, 'All privileged reads should wait on the hospital lock.');
    await blocker.query('UPDATE staff_users SET active=false WHERE id=$1', [admin.id]);
    await blocker.query('DELETE FROM staff_sessions WHERE user_id=$1', [admin.id]); await blocker.query('COMMIT');
    const results = await Promise.all(pendingReads); assert.deepEqual(results.map(result => result.statusCode), [401, 401, 401]);
  } finally { await blocker.query('ROLLBACK'); blocker.release(); }
});

test('successful reauthentication refunds its own budget without consuming sign-in or failed attempts', async () => {
  const signInBefore = (await pool.query('SELECT attempts FROM login_buckets WHERE bucket_hash=$1', [digest('ip:127.0.0.1')])).rows[0].attempts;
  for (let i = 0; i < 2; i++) assert.equal((await command(admin, update(accounts.clinician.id), randomUUID(), 'wrong')).statusCode, 403);
  for (let revision = 1; revision <= 11; revision++) assert.equal((await command(admin, update(accounts.clinician.id, revision, true))).statusCode, 200);
  assert.equal((await pool.query('SELECT attempts FROM login_buckets WHERE bucket_hash=$1', [digest(`reauth-account:${admin.id}`)])).rows[0].attempts, 2);
  assert.equal((await pool.query('SELECT attempts FROM login_buckets WHERE bucket_hash=$1', [digest('reauth-ip:127.0.0.1')])).rows[0].attempts, 2);
  assert.equal((await pool.query('SELECT attempts FROM login_buckets WHERE bucket_hash=$1', [digest('ip:127.0.0.1')])).rows[0].attempts, signInBefore);
});

test('reauthentication reservations bound parallel work and never refund a later expiry window', async () => {
  const reservations = await Promise.all(Array.from({ length: 11 }, () => reserveReauthentication(pool, 'reservation-test', '192.0.2.1')));
  assert.equal(reservations.filter(Boolean).length, 10);
  const successes = reservations.filter((value): value is () => Promise<void> => value !== null);
  await successes[0](); await successes[0]();
  const accountKey = digest('reauth-account:reservation-test'); const ipKey = digest('reauth-ip:192.0.2.1');
  assert.equal((await pool.query('SELECT attempts FROM login_buckets WHERE bucket_hash=$1', [accountKey])).rows[0].attempts, 9);
  await pool.query("UPDATE login_buckets SET expires_at=clock_timestamp()-interval '1 second' WHERE bucket_hash=ANY($1::text[])", [[accountKey, ipKey]]);
  const newReservation = await reserveReauthentication(pool, 'reservation-test', '192.0.2.1'); assert.ok(newReservation);
  await successes[1]();
  assert.equal((await pool.query('SELECT attempts FROM login_buckets WHERE bucket_hash=$1', [accountKey])).rows[0].attempts, 1);
  await newReservation(); assert.equal((await pool.query('SELECT attempts FROM login_buckets WHERE bucket_hash=$1', [accountKey])).rows[0].attempts, 0);
});
