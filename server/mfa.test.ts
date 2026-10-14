import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, beforeEach, after, test } from 'node:test';
import pg from 'pg';
import * as OTPAuth from 'otpauth';
import { buildApp } from './app.ts';
import { migrate } from './db.ts';
import { digest, hashPassword } from './auth.ts';
import { matchedCounter, newSecret, seal, unseal, totp, validateEnvelopes } from './mfa-config.ts';
import { issueGrant } from './mfa.ts';
const directory = mkdtempSync(join(tmpdir(), 'mfa-test-'));
process.env.STAFF_MFA_KEYRING_FILE = join(directory, 'keys.json');
writeFileSync(
  process.env.STAFF_MFA_KEYRING_FILE,
  JSON.stringify({ current: 'test', keys: { test: randomBytes(32).toString('hex') } }),
  { mode: 0o600 },
);
process.env.STAFF_MFA_POLICY = 'required';
const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const schema = `mfa_test_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString });
const pool = new pg.Pool({
  connectionString,
  application_name: schema,
  options: `-c search_path=${schema}`,
});
const origin = 'http://127.0.0.1:5173';
const hospital = randomUUID(),
  user = randomUUID();
const password = 'Synthetic-MFA-password-42';
const app = buildApp({ pool, origin });
type Auth = { cookie: string; csrf: string };
const headers = (auth: Auth) => ({ origin, cookie: auth.cookie, 'x-csrf-token': auth.csrf });
const auth = (r: any, nested = false): Auth => ({
  cookie: String(r.headers['set-cookie']).split(';')[0],
  csrf: (nested ? r.json().session : r.json()).csrfToken,
});
const login = () =>
  app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin },
    payload: { hospitalCode: 'mfa', username: 'admin', password },
  });
const post = (a: Auth, action: string, body: object) =>
  app.inject({
    method: 'POST',
    url: `/api/auth/mfa/${action}`,
    headers: headers(a),
    payload: body,
  });
let secret: string;
let codes: string[];
let complete: Auth;
async function waitForHospitalLock(count = 1) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await admin.query(
      "SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
      [schema],
    );
    if ((result.rowCount ?? 0) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('The request did not reach its hospital lock.');
}
before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
  await pool.query('INSERT INTO hospitals(id,code,name) VALUES ($1,$2,$3)', [
    hospital,
    'mfa',
    'MFA synthetic',
  ]);
  await pool.query(
    "INSERT INTO staff_users(id,hospital_id,username,display_name,role,password_hash) VALUES ($1,$2,'admin','Synthetic','admin',$3)",
    [user, hospital, await hashPassword(password)],
  );
});
beforeEach(async () => {
  await pool.query('DELETE FROM login_buckets');
  await pool.query('UPDATE staff_factors SET last_counter=-1');
});
after(async () => {
  await app.close();
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
  rmSync(directory, { recursive: true, force: true });
});
test('RFC6238 SHA1 vectors and six-digit skew boundaries', () => {
  const seed = OTPAuth.Secret.fromUTF8('12345678901234567890');
  const otp = new OTPAuth.TOTP({ secret: seed, algorithm: 'SHA1', digits: 8, period: 30 });
  for (const [seconds, expected] of [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ] as const)
    assert.equal(otp.generate({ timestamp: seconds * 1000 }), expected);
  const now = 1234567890000;
  const token = totp(seed.base32).generate({ timestamp: now });
  assert.equal(matchedCounter(seed.base32, token, now), Math.floor(now / 30000));
  assert.notEqual(matchedCounter(seed.base32, token, now + 30000), null);
  assert.equal(matchedCounter(seed.base32, token, now + 60000), null);
});
test('encrypted secrets bind tenant, account, purpose and key; tampering fails closed', () => {
  const value = seal(newSecret(), hospital, user, 'factor');
  assert.ok(unseal(value, hospital, user, 'factor'));
  for (const [h, u, p] of [
    [randomUUID(), user, 'factor'],
    [hospital, randomUUID(), 'factor'],
    [hospital, user, 'pending'],
  ] as const)
    assert.throws(() => unseal(value, h, u, p), /unavailable/);
  for (const bytes of [0, 1, 4, 8, 12, 15])
    assert.throws(
      () =>
        unseal(
          { ...value, tag: Buffer.from(value.tag, 'base64').subarray(0, bytes).toString('base64') },
          hospital,
          user,
          'factor',
        ),
      /unavailable/,
    );
  assert.throws(
    () => unseal({ ...value, nonce: randomBytes(8).toString('base64') }, hospital, user, 'factor'),
    /unavailable/,
  );
  assert.throws(
    () => unseal({ ...value, ciphertext: 'A'.repeat(10000) }, hospital, user, 'factor'),
    /unavailable/,
  );
  assert.throws(
    () => unseal({ ...value, keyId: 'absent' }, hospital, user, 'factor'),
    /unavailable/,
  );
  assert.throws(
    () => unseal({ ...value, tag: randomBytes(16).toString('base64') }, hospital, user, 'factor'),
    /unavailable/,
  );
});
test('password alone cannot access records; grant binds pending to one session and confirmation rotates', async () => {
  let r = await login();
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().authState, 'enrollment');
  let a = auth(r);
  assert.equal((await app.inject({ url: '/api/patients', headers: headers(a) })).statusCode, 403);
  assert.equal((await post(a, 'start', { grant: 'invalid' })).statusCode, 403);
  const client = await pool.connect();
  let grant: string;
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [hospital]);
    grant = (await issueGrant(client, hospital, user, null, 'test-operator', 'initial_enrollment'))
      .grant;
    await client.query('COMMIT');
  } finally {
    client.release();
  }
  r = await login();
  a = auth(r);
  r = await post(a, 'start', { grant });
  assert.equal(r.statusCode, 200);
  secret = r.json().secret;
  const status = await app.inject({ url: '/api/auth/mfa/status', headers: headers(a) });
  assert.equal(status.statusCode, 200);
  assert.ok(status.json().secret === secret);
  const other = auth(await login());
  assert.equal((await post(other, 'start', { grant })).statusCode, 403);
  r = await post(a, 'confirm', { code: totp(secret).generate() });
  assert.equal(r.statusCode, 200);
  complete = auth(r, true);
  codes = r.json().recoveryCodes;
  assert.equal(codes.length, 10);
  assert.notEqual(complete.csrf, a.csrf);
  assert.equal(
    (await app.inject({ url: '/api/auth/session', headers: headers(other) })).statusCode,
    401,
  );
  assert.equal(
    (await app.inject({ url: '/api/patients', headers: headers(complete) })).statusCode,
    200,
  );
});
test('concurrent factor proofs have one winner and replay across uses fails', async () => {
  const first = auth(await login()),
    second = auth(await login());
  const code = totp(secret).generate();
  const replies = await Promise.all([
    post(first, 'verify', { code }),
    post(second, 'verify', { code }),
  ]);
  assert.deepEqual(replies.map((r) => r.statusCode).sort(), [200, 403]);
  complete = auth(
    replies.find((r) => r.statusCode === 200),
    true,
  );
  assert.equal((await post(complete, 'regenerate', { password, code })).statusCode, 403);
});
test('polling cannot refresh idle expiry; stale generation and queued requests fail before records', async () => {
  const {
    rows: [before],
  } = await pool.query('SELECT idle_expires_at FROM staff_sessions WHERE csrf_token=$1', [
    complete.csrf,
  ]);
  await app.inject({ url: '/api/auth/session', headers: headers(complete) });
  const {
    rows: [after],
  } = await pool.query('SELECT idle_expires_at FROM staff_sessions WHERE csrf_token=$1', [
    complete.csrf,
  ]);
  assert.equal(before.idle_expires_at.getTime(), after.idle_expires_at.getTime());
  const lock = await pool.connect();
  await lock.query('BEGIN');
  await lock.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [hospital]);
  const queued = app.inject({
    method: 'POST',
    url: '/api/patients',
    headers: { ...headers(complete), 'idempotency-key': randomUUID() },
    payload: { name: 'Must not save' },
  });
  // Start the request while the hospital lock is held, then invalidate its generation.
  const running = queued.then((r) => r);
  try {
    await waitForHospitalLock();
    await lock.query('UPDATE staff_users SET factor_generation=factor_generation+1 WHERE id=$1', [
      user,
    ]);
    await lock.query('COMMIT');
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
  }
  assert.equal((await running).statusCode, 401);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM patients')).rows[0].count, 0);
  const a = auth(await login());
  await pool.query(
    "UPDATE staff_sessions SET idle_expires_at=clock_timestamp()-interval '1 second' WHERE csrf_token=$1",
    [a.csrf],
  );
  assert.equal(
    (await app.inject({ url: '/api/auth/session', headers: headers(a) })).statusCode,
    401,
  );
});
test('concurrent recovery consumes once, revokes sessions, preserves remaining codes and resumes pending', async () => {
  const first = auth(await login()),
    second = auth(await login());
  const replies = await Promise.all([
    post(first, 'recover', { code: codes[0] }),
    post(second, 'recover', { code: codes[0] }),
  ]);
  assert.equal(replies.filter((r) => r.statusCode === 200).length, 1);
  const index = replies.findIndex((r) => r.statusCode === 200),
    a = index === 0 ? first : second;
  assert.equal(replies[index].json().session.authState, 'recovery_enrollment');
  assert.equal(
    (await pool.query('SELECT count(*)::int AS count FROM staff_recovery_codes')).rows[0].count,
    9,
  );
  const status = await app.inject({ url: '/api/auth/mfa/status', headers: headers(a) });
  assert.equal(status.statusCode, 200);
  const replacement = status.json().secret;
  const r = await post(a, 'confirm', { code: totp(replacement).generate() });
  assert.equal(r.statusCode, 200);
  secret = replacement;
  complete = auth(r, true);
  const stale = auth(await login());
  assert.equal((await post(stale, 'recover', { code: codes[1] })).statusCode, 403);
  await validateEnvelopes(pool);
});
test('ordinary password change preserves factor and enrollment replacement requires fresh proofs', async () => {
  const code = totp(secret).generate();
  const r = await post(complete, 'replace', { password, code });
  assert.equal(r.statusCode, 200);
  const a = auth(await login());
  assert.equal((await post(a, 'verify', { code })).statusCode, 403);
  assert.equal((await post(complete, 'confirm', { code: '000000' })).statusCode, 403);
  assert.equal(
    (await pool.query('SELECT count(*)::int AS count FROM staff_factors')).rows[0].count,
    1,
  );
  const changed = await app.inject({
    method: 'POST',
    url: '/api/auth/password',
    headers: headers(complete),
    payload: { currentPassword: password, newPassword: password + 'new' },
  });
  assert.equal(changed.statusCode, 200);
  assert.equal(
    (await pool.query('SELECT count(*)::int AS count FROM staff_factors')).rows[0].count,
    1,
  );
  assert.equal(
    (await pool.query('SELECT count(*)::int AS count FROM staff_mfa_pending')).rows[0].count,
    0,
  );
  assert.equal(
    (
      await pool.query(
        'SELECT count(*)::int AS count FROM identity_security_events WHERE actor_id IS NULL AND operator_reference IS NULL',
      )
    ).rows[0].count,
    0,
  );
});
test('production rejects synthetic policy and missing keys; old referenced keys survive rotation', async () => {
  const previousPolicy = process.env.STAFF_MFA_POLICY,
    previousEnv = process.env.NODE_ENV,
    previousFile = process.env.STAFF_MFA_KEYRING_FILE;
  try {
    process.env.NODE_ENV = 'production';
    process.env.STAFF_MFA_POLICY = 'synthetic';
    assert.throws(() => buildApp({ pool, origin: 'https://staff.example.test' }), /unavailable/);
    process.env.STAFF_MFA_POLICY = 'required';
    process.env.STAFF_MFA_KEYRING_FILE = join(directory, 'missing');
    assert.throws(() => buildApp({ pool, origin: 'https://staff.example.test' }), /unavailable/);
  } finally {
    process.env.STAFF_MFA_POLICY = previousPolicy;
    if (previousEnv) process.env.NODE_ENV = previousEnv;
    else delete process.env.NODE_ENV;
    process.env.STAFF_MFA_KEYRING_FILE = previousFile;
  }
  const { readFileSync } = await import('node:fs');
  const ring = JSON.parse(readFileSync(previousFile!, 'utf8'));
  ring.current = 'next';
  ring.keys.next = randomBytes(32).toString('hex');
  writeFileSync(previousFile!, JSON.stringify(ring), { mode: 0o600 });
  await validateEnvelopes(pool);
  const {
    rows: [factor],
  } = await pool.query('SELECT envelope FROM staff_factors WHERE user_id=$1', [user]);
  const seed = unseal(factor.envelope, hospital, user, 'factor');
  const envelope = seal(seed, hospital, user, 'factor');
  assert.equal(envelope.keyId, 'next');
  const wrong = { ...ring, keys: { next: ring.keys.next } };
  writeFileSync(previousFile!, JSON.stringify(wrong), { mode: 0o600 });
  await assert.rejects(validateEnvelopes(pool), /unavailable/);
  writeFileSync(previousFile!, JSON.stringify(ring), { mode: 0o600 });
  await pool.query('UPDATE staff_factors SET envelope=$2 WHERE user_id=$1', [user, envelope]);
  await validateEnvelopes(pool);
});
test('unenrolled temporary password remains restricted; enrolled temporary password needs factor first', async () => {
  const fresh = randomUUID(),
    uname = 'temporary',
    hash = await hashPassword(password);
  await pool.query(
    "INSERT INTO staff_users(id,hospital_id,username,display_name,role,password_hash,password_change_required) VALUES ($1,$2,$3,'Temporary synthetic','admin',$4,true)",
    [fresh, hospital, uname, hash],
  );
  const sign = () =>
    app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin },
      payload: { hospitalCode: 'mfa', username: uname, password },
    });
  let a = auth(await sign());
  assert.equal((await app.inject({ url: '/api/patients', headers: headers(a) })).statusCode, 403);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/password',
        headers: headers(a),
        payload: { currentPassword: password, newPassword: password + 'changed' },
      })
    ).statusCode,
    200,
  );
  await pool.query(
    'UPDATE staff_users SET password_hash=$2,password_change_required=true WHERE id=$1',
    [fresh, hash],
  );
  const seed = newSecret();
  await pool.query('INSERT INTO staff_factors(hospital_id,user_id,envelope) VALUES ($1,$2,$3)', [
    hospital,
    fresh,
    seal(seed, hospital, fresh, 'factor'),
  ]);
  a = auth(await sign());
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/password',
        headers: headers(a),
        payload: { currentPassword: password, newPassword: password + 'changed' },
      })
    ).statusCode,
    403,
  );
  const verified = await post(a, 'verify', { code: totp(seed).generate() });
  assert.equal(verified.statusCode, 200);
  a = auth(verified, true);
  assert.equal((await app.inject({ url: '/api/patients', headers: headers(a) })).statusCode, 403);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/password',
        headers: headers(a),
        payload: { currentPassword: password, newPassword: password + 'changed' },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await pool.query('SELECT count(*)::int AS count FROM staff_factors WHERE user_id=$1', [fresh]))
      .rows[0].count,
    1,
  );
});
test('queued idle expiry denies domain commands without writes or audit', async () => {
  // An independently seeded factor/session models a completed proof; production gates still apply.
  const csrf = randomBytes(32).toString('base64url'),
    token = randomBytes(32).toString('base64url');
  const generation = (
    await pool.query('SELECT factor_generation FROM staff_users WHERE id=$1', [user])
  ).rows[0].factor_generation;
  await pool.query(
    "INSERT INTO staff_sessions(token_hash,user_id,csrf_token,expires_at,auth_state,factor_generation) VALUES ($1,$2,$3,clock_timestamp()+interval '1 hour','complete',$4)",
    [digest(token), user, csrf, generation],
  );
  const a = { cookie: 'staff_session=' + token, csrf };
  const lock = await pool.connect();
  await lock.query('BEGIN');
  await lock.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [hospital]);
  const running = app
    .inject({
      method: 'POST',
      url: '/api/patients',
      headers: { ...headers(a), 'idempotency-key': randomUUID() },
      payload: { name: 'No audit' },
    })
    .then((r) => r);
  try {
    await waitForHospitalLock();
    await lock.query(
      "UPDATE staff_sessions SET idle_expires_at=clock_timestamp()-interval '1 second' WHERE csrf_token=$1",
      [csrf],
    );
    await lock.query('COMMIT');
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
  }
  assert.equal((await running).statusCode, 401);
  assert.equal(
    (await pool.query('SELECT count(*)::int AS count FROM audit_events')).rows[0].count,
    0,
  );
});
test('admin grants require current password, reject tenant/factor reset, and access changes invalidate pending setup', async () => {
  const csrf = randomBytes(32).toString('base64url'),
    token = randomBytes(32).toString('base64url'),
    target = randomUUID();
  const generation = (
    await pool.query('SELECT factor_generation FROM staff_users WHERE id=$1', [user])
  ).rows[0].factor_generation;
  await pool.query(
    "INSERT INTO staff_sessions(token_hash,user_id,csrf_token,expires_at,auth_state,factor_generation) VALUES ($1,$2,$3,clock_timestamp()+interval '1 hour','complete',$4)",
    [digest(token), user, csrf, generation],
  );
  const a = { cookie: 'staff_session=' + token, csrf };
  await pool.query(
    "INSERT INTO staff_users(id,hospital_id,username,display_name,role,password_hash) VALUES ($1,$2,'grant-target','Grant target','receptionist',$3)",
    [target, hospital, await hashPassword(password)],
  );
  const eligible = (await app.inject({ url: `/api/staff/${target}`, headers: headers(a) })).json()
    .account;
  assert.equal(eligible.firstEnrollmentEligible, true);
  assert.equal('factor_generation' in eligible, false);
  const enrolled = (await app.inject({ url: `/api/staff/${user}`, headers: headers(a) })).json()
    .account;
  assert.equal(enrolled.firstEnrollmentEligible, false);
  const grant = (id: string, pw = password + 'new') =>
    app.inject({
      method: 'POST',
      url: '/api/staff/mfa/grant',
      headers: headers(a),
      payload: { accountId: id, password: pw },
    });
  assert.equal((await grant(target, 'wrong')).statusCode, 403);
  assert.equal((await grant(randomUUID())).statusCode, 403);
  assert.equal((await grant(user)).statusCode, 403);
  const foreignHospital = randomUUID(),
    foreignUser = randomUUID();
  await pool.query('INSERT INTO hospitals(id,code,name) VALUES ($1,$2,$3)', [
    foreignHospital,
    'foreign-' + foreignHospital,
    'Foreign synthetic',
  ]);
  await pool.query(
    "INSERT INTO staff_users(id,hospital_id,username,display_name,role,password_hash) VALUES ($1,$2,'foreign','Foreign synthetic','admin','unused')",
    [foreignUser, foreignHospital],
  );
  assert.equal((await grant(foreignUser)).statusCode, 403);
  const expiredGrant = await grant(target);
  assert.equal(expiredGrant.statusCode, 200);
  await pool.query(
    "UPDATE staff_mfa_grants SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",
    [target],
  );
  const staleLogin = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin },
    payload: { hospitalCode: 'mfa', username: 'grant-target', password },
  });
  assert.equal(
    (await post(auth(staleLogin), 'start', { grant: expiredGrant.json().grant })).statusCode,
    403,
  );
  const issued = await grant(target);
  assert.equal(issued.statusCode, 200);
  assert.equal(
    (await app.inject({ url: '/api/auth/session', headers: headers(auth(staleLogin)) })).statusCode,
    401,
  );
  const loginTarget = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin },
    payload: { hospitalCode: 'mfa', username: 'grant-target', password },
  });
  const restricted = auth(loginTarget);
  assert.equal((await post(restricted, 'start', { grant: issued.json().grant })).statusCode, 200);
  const update = await app.inject({
    method: 'POST',
    url: '/api/staff/commands',
    headers: { ...headers(a), 'idempotency-key': randomUUID() },
    payload: {
      currentPassword: password + 'new',
      command: {
        type: 'update',
        accountId: target,
        expectedRevision: 1,
        role: 'auditor',
        active: true,
      },
    },
  });
  assert.equal(update.statusCode, 200);
  assert.equal(
    (await app.inject({ url: '/api/auth/session', headers: headers(restricted) })).statusCode,
    401,
  );
  assert.equal(
    (
      await pool.query('SELECT count(*)::int AS count FROM staff_mfa_pending WHERE user_id=$1', [
        target,
      ])
    ).rows[0].count,
    0,
  );
  assert.equal(
    (
      await pool.query('SELECT count(*)::int AS count FROM staff_mfa_grants WHERE user_id=$1', [
        target,
      ])
    ).rows[0].count,
    0,
  );
});
test('private operator rotation and reset preserve attribution, revoke proofs and never print grants', async () => {
  const { spawnSync } = await import('node:child_process');
  const { readFileSync, statSync, existsSync } = await import('node:fs');
  const url = new URL(connectionString!);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const run = (mode: string, reason: string, output: string) =>
    spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        'server/mfa-setup.ts',
        mode,
        'mfa',
        'admin',
        reason,
        'test-independent-operator',
        output,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: url.toString() },
        encoding: 'utf8',
        timeout: 15000,
      },
    );
  await pool.query(
    'INSERT INTO staff_factors(hospital_id,user_id,envelope) VALUES ($1,$2,$3) ON CONFLICT (user_id) DO NOTHING',
    [hospital, user, seal(newSecret(), hospital, user, 'factor')],
  );
  const refused = join(directory, 'refused.json');
  assert.equal(run('grant', 'initial_enrollment', refused).status, 1);
  assert.equal(existsSync(refused), false);
  const originalRing = JSON.parse(readFileSync(process.env.STAFF_MFA_KEYRING_FILE!, 'utf8'));
  const oldRing = {
    current: 'inactive-old',
    keys: { ...originalRing.keys, 'inactive-old': randomBytes(32).toString('hex') },
  };
  writeFileSync(process.env.STAFF_MFA_KEYRING_FILE!, JSON.stringify(oldRing));
  await pool.query('UPDATE staff_factors SET envelope=$2 WHERE user_id=$1', [
    user,
    seal(newSecret(), hospital, user, 'factor'),
  ]);
  writeFileSync(
    process.env.STAFF_MFA_KEYRING_FILE!,
    JSON.stringify({ ...oldRing, current: originalRing.current }),
  );
  await pool.query('UPDATE staff_users SET active=false WHERE id=$1', [user]);
  assert.equal(run('grant', 'lost_all_factors', join(directory, 'inactive-grant.json')).status, 1);
  const rotation = join(directory, 'rotation.json');
  const rotated = run('rotate-keys', 'initial_enrollment', rotation);
  assert.equal(rotated.status, 0);
  assert.equal(JSON.parse(readFileSync(rotation, 'utf8')).reencrypted, 1);
  writeFileSync(process.env.STAFF_MFA_KEYRING_FILE!, JSON.stringify(originalRing));
  await validateEnvelopes(pool);
  await pool.query('UPDATE staff_users SET active=true WHERE id=$1', [user]);
  const output = join(directory, 'grant.json'),
    result = run('grant', 'lost_all_factors', output);
  assert.equal(result.status, 0);
  assert.equal(statSync(output).mode & 0o777, 0o600);
  const privateResult = JSON.parse(readFileSync(output, 'utf8'));
  assert.ok(privateResult.grant);
  assert.equal((result.stdout + result.stderr).includes(privateResult.grant), false);
  assert.equal(
    (await pool.query('SELECT count(*)::int AS count FROM staff_factors WHERE user_id=$1', [user]))
      .rows[0].count,
    0,
  );
  assert.equal(
    (
      await pool.query('SELECT count(*)::int AS count FROM staff_recovery_codes WHERE user_id=$1', [
        user,
      ])
    ).rows[0].count,
    0,
  );
  assert.equal(
    (await pool.query('SELECT count(*)::int AS count FROM staff_sessions WHERE user_id=$1', [user]))
      .rows[0].count,
    0,
  );
  const events = (
    await pool.query(
      "SELECT actor_id,operator_reference,reason FROM identity_security_events WHERE user_id=$1 AND event='factor.reset'",
      [user],
    )
  ).rows;
  assert.deepEqual(events, [
    { actor_id: null, operator_reference: 'test-independent-operator', reason: 'lost_all_factors' },
  ]);
});
test('MFA attempt exhaustion is bounded and does not consume password-sign-in budget', async () => {
  const id = randomUUID(),
    seed = newSecret();
  await pool.query(
    "INSERT INTO staff_users(id,hospital_id,username,display_name,role,password_hash) VALUES ($1,$2,'limited','Limited synthetic','admin',$3)",
    [id, hospital, await hashPassword(password)],
  );
  await pool.query('INSERT INTO staff_factors(hospital_id,user_id,envelope) VALUES ($1,$2,$3)', [
    hospital,
    id,
    seal(seed, hospital, id, 'factor'),
  ]);
  const sign = () =>
    app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin },
      payload: { hospitalCode: 'mfa', username: 'limited', password },
    });
  const a = auth(await sign());
  for (let i = 0; i < 10; i++)
    assert.equal((await post(a, 'verify', { code: 'invalid' })).statusCode, 403);
  assert.equal((await post(a, 'verify', { code: totp(seed).generate() })).statusCode, 429);
  assert.equal((await sign()).statusCode, 200);
  assert.equal(
    (await pool.query('SELECT last_counter FROM staff_factors WHERE user_id=$1', [id])).rows[0]
      .last_counter,
    '-1',
  );
});

test('logout revokes a rotating family in both orderings, including a delayed elevation response', async () => {
  for (const ordering of ['queued', 'committed'] as const) {
    const id = randomUUID(),
      seed = newSecret(),
      username = 'race-' + ordering;
    await pool.query(
      "INSERT INTO staff_users(id,hospital_id,username,display_name,role,password_hash) VALUES ($1,$2,$3,'Race synthetic','admin',$4)",
      [id, hospital, username, await hashPassword(password)],
    );
    await pool.query('INSERT INTO staff_factors(hospital_id,user_id,envelope) VALUES ($1,$2,$3)', [
      hospital,
      id,
      seal(seed, hospital, id, 'factor'),
    ]);
    const token = randomBytes(32).toString('base64url'),
      csrf = randomBytes(32).toString('base64url');
    await pool.query(
      "INSERT INTO staff_sessions(token_hash,user_id,csrf_token,expires_at,auth_state) VALUES ($1,$2,$3,clock_timestamp()+interval '1 hour','complete')",
      [digest(token), id, csrf],
    );
    const other = { cookie: 'staff_session=' + token, csrf };
    let releaseResponse!: () => void, responseReady!: () => void;
    const heldResponse = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      responseReady = resolve;
    });
    const raceApp = buildApp({ pool, origin });
    raceApp.addHook('onSend', async (request, _reply, payload) => {
      if (request.url === '/api/auth/mfa/verify') {
        responseReady();
        await heldResponse;
      }
      return payload;
    });
    const loginReply = await raceApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin },
      payload: { hospitalCode: 'mfa', username, password },
    });
    const original = auth(loginReply);
    const lock = ordering === 'queued' ? await pool.connect() : null;
    try {
      if (lock) {
        await lock.query('BEGIN');
        await lock.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [hospital]);
      }
      const elevation = raceApp
        .inject({
          method: 'POST',
          url: '/api/auth/mfa/verify',
          headers: headers(original),
          payload: { code: totp(seed).generate() },
        })
        .then((r) => r);
      if (lock) await waitForHospitalLock();
      else {
        await ready;
        assert.equal(
          (await raceApp.inject({ url: '/api/auth/session', headers: headers(original) }))
            .statusCode,
          401,
        );
        assert.equal(
          (await raceApp.inject({ url: '/api/patients', headers: headers(original) })).statusCode,
          401,
        );
        assert.equal(
          (
            await raceApp.inject({
              method: 'POST',
              url: '/api/auth/logout',
              headers: { ...headers(original), 'x-csrf-token': 'wrong' },
            })
          ).statusCode,
          403,
        );
      }
      const logout = raceApp
        .inject({ method: 'POST', url: '/api/auth/logout', headers: headers(original) })
        .then((r) => r);
      if (lock) {
        await waitForHospitalLock(2);
        await lock.query('COMMIT');
      }
      assert.equal((await logout).statusCode, 204);
      releaseResponse();
      const elevated = await elevation;
      assert.equal(elevated.statusCode, 200);
      assert.equal(elevated.json().session.sessionFamily, loginReply.json().sessionFamily);
      assert.equal(
        (await raceApp.inject({ url: '/api/patients', headers: headers(auth(elevated, true)) }))
          .statusCode,
        401,
      );
      assert.equal(
        (await raceApp.inject({ url: '/api/auth/session', headers: headers(original) })).statusCode,
        401,
      );
      assert.equal(
        (await raceApp.inject({ url: '/api/patients', headers: headers(other) })).statusCode,
        200,
      );
    } finally {
      releaseResponse();
      if (lock) {
        await lock.query('ROLLBACK');
        lock.release();
      }
      await raceApp.close();
    }
  }
});

test('late domain response cannot refresh logout-only predecessor authority', async () => {
  const id = randomUUID(),
    seed = newSecret(),
    token = randomBytes(32).toString('base64url'),
    csrf = randomBytes(32).toString('base64url');
  await pool.query(
    "INSERT INTO staff_users(id,hospital_id,username,display_name,role,password_hash) VALUES ($1,$2,'late-response','Late synthetic','admin',$3)",
    [id, hospital, await hashPassword(password)],
  );
  await pool.query('INSERT INTO staff_factors(hospital_id,user_id,envelope) VALUES ($1,$2,$3)', [
    hospital,
    id,
    seal(seed, hospital, id, 'factor'),
  ]);
  await pool.query(
    "INSERT INTO staff_sessions(token_hash,user_id,csrf_token,expires_at,auth_state) VALUES ($1,$2,$3,clock_timestamp()+interval '1 hour','complete')",
    [digest(token), id, csrf],
  );
  const a = { cookie: 'staff_session=' + token, csrf };
  let release!: () => void, reached!: () => void;
  const hold = new Promise<void>((resolve) => {
      release = resolve;
    }),
    ready = new Promise<void>((resolve) => {
      reached = resolve;
    });
  const lateApp = buildApp({ pool, origin });
  lateApp.get('/api/mfa-test-activity', async () => {
    reached();
    await hold;
    return { ok: true };
  });
  try {
    const activity = lateApp
      .inject({ url: '/api/mfa-test-activity', headers: headers(a) })
      .then((r) => r);
    await ready;
    const rotated = await lateApp.inject({
      method: 'POST',
      url: '/api/auth/mfa/regenerate',
      headers: headers(a),
      payload: { password, code: totp(seed).generate() },
    });
    assert.equal(rotated.statusCode, 200);
    const before = (
      await pool.query(
        'SELECT logout_only,idle_expires_at FROM staff_sessions WHERE csrf_token=$1',
        [csrf],
      )
    ).rows[0];
    assert.equal(before.logout_only, true);
    assert.ok(before.idle_expires_at.getTime() - Date.now() <= 600000);
    release();
    const response = await activity;
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['x-session-expires-at'], undefined);
    const after = (
      await pool.query('SELECT idle_expires_at FROM staff_sessions WHERE csrf_token=$1', [csrf])
    ).rows[0];
    assert.equal(after.idle_expires_at.getTime(), before.idle_expires_at.getTime());
    await pool.query(
      "UPDATE staff_sessions SET idle_expires_at=clock_timestamp()-interval '1 second' WHERE csrf_token=$1",
      [csrf],
    );
    assert.equal(
      (await lateApp.inject({ method: 'POST', url: '/api/auth/logout', headers: headers(a) }))
        .statusCode,
      401,
    );
    assert.equal(
      (await lateApp.inject({ url: '/api/patients', headers: headers(auth(rotated, true)) }))
        .statusCode,
      200,
    );
  } finally {
    release();
    await lateApp.close();
  }
});

test('final recovery code abandoned replacement preserves enrollment requirement under both policies', async () => {
  for (const policy of ['synthetic', 'required']) {
    process.env.STAFF_MFA_POLICY = policy;
    const local = buildApp({ pool, origin });
    const id = randomUUID(),
      seed = newSecret(),
      recovery = randomBytes(16).toString('hex'),
      username = 'last-' + randomUUID();
    try {
      await pool.query(
        "INSERT INTO staff_users(id,hospital_id,username,display_name,role,password_hash,factor_generation) VALUES ($1,$2,$3,'Last recovery','admin',$4,1)",
        [id, hospital, username, await hashPassword(password)],
      );
      await pool.query(
        'INSERT INTO staff_factors(hospital_id,user_id,envelope) VALUES ($1,$2,$3)',
        [hospital, id, seal(seed, hospital, id, 'factor')],
      );
      await pool.query(
        'INSERT INTO staff_recovery_codes(hospital_id,user_id,code_hash) VALUES ($1,$2,$3)',
        [hospital, id, digest(recovery)],
      );
      const signIn = () =>
        local.inject({
          method: 'POST',
          url: '/api/auth/login',
          headers: { origin },
          payload: { hospitalCode: 'mfa', username, password },
        });
      const first = await signIn();
      assert.equal(first.json().authState, 'challenge');
      const a = auth(first);
      const consumed = await local.inject({
        method: 'POST',
        url: '/api/auth/mfa/recover',
        headers: headers(a),
        payload: { code: recovery },
      });
      assert.equal(consumed.statusCode, 200);
      await local.inject({ method: 'POST', url: '/api/auth/logout', headers: headers(a) });
      const again = await signIn();
      assert.equal(again.json().authState, 'enrollment');
      assert.equal(
        (await local.inject({ url: '/api/patients', headers: headers(auth(again)) })).statusCode,
        403,
      );
      assert.equal(
        (
          await local.inject({
            method: 'POST',
            url: '/api/auth/mfa/start',
            headers: headers(auth(again)),
            payload: { grant: 'invalid' },
          })
        ).statusCode,
        403,
      );
    } finally {
      await local.close();
      process.env.STAFF_MFA_POLICY = 'required';
    }
  }
});

test('another hospital locked expired pending row cannot block session lookup or MFA', async () => {
  const otherHospital = randomUUID(),
    otherUser = randomUUID(),
    token = randomBytes(32).toString('hex');
  await pool.query('INSERT INTO hospitals(id,code,name) VALUES ($1,$2,$3)', [
    otherHospital,
    'locked-' + randomUUID(),
    'Locked synthetic',
  ]);
  await pool.query(
    "INSERT INTO staff_users(id,hospital_id,username,display_name,role,password_hash) VALUES ($1,$2,'locked','Locked','admin',$3)",
    [otherUser, otherHospital, await hashPassword(password)],
  );
  await pool.query(
    "INSERT INTO staff_sessions(token_hash,user_id,csrf_token,expires_at,auth_state) VALUES ($1,$2,$3,clock_timestamp()+interval '1 hour','enrollment')",
    [digest(token), otherUser, randomUUID()],
  );
  await pool.query(
    "INSERT INTO staff_mfa_pending(hospital_id,user_id,session_hash,envelope,expires_at) VALUES ($1,$2,$3,$4,clock_timestamp()-interval '1 minute')",
    [
      otherHospital,
      otherUser,
      digest(token),
      seal(newSecret(), otherHospital, otherUser, 'pending'),
    ],
  );
  const localToken = randomBytes(32).toString('base64url'),
    localCsrf = randomBytes(32).toString('hex');
  await pool.query(
    "INSERT INTO staff_sessions(token_hash,user_id,csrf_token,expires_at,auth_state,factor_generation) SELECT $1,id,$2,clock_timestamp()+interval '1 hour','enrollment',factor_generation FROM staff_users WHERE id=$3",
    [digest(localToken), localCsrf, user],
  );
  await pool.query(
    "INSERT INTO staff_mfa_pending(hospital_id,user_id,session_hash,envelope,expires_at) VALUES ($1,$2,$3,$4,clock_timestamp()-interval '1 second') ON CONFLICT (user_id) DO UPDATE SET session_hash=EXCLUDED.session_hash,envelope=EXCLUDED.envelope,expires_at=EXCLUDED.expires_at",
    [hospital, user, digest(localToken), seal(newSecret(), hospital, user, 'pending')],
  );
  const a = { cookie: 'staff_session=' + localToken, csrf: localCsrf };
  const lock = await pool.connect();
  await lock.query('BEGIN');
  await lock.query('SELECT user_id FROM staff_mfa_pending WHERE user_id=$1 FOR UPDATE', [
    otherUser,
  ]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        assert.equal(
          (await app.inject({ url: '/api/auth/session', headers: headers(a) })).statusCode,
          200,
        );
        assert.equal(
          (await app.inject({ url: '/api/auth/mfa/status', headers: headers(a) })).statusCode,
          200,
        );
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('Unrelated row blocked request')), 1500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    await lock.query('ROLLBACK');
    lock.release();
  }
  assert.equal(
    (await pool.query('SELECT count(*)::int AS n FROM staff_mfa_pending WHERE user_id=$1', [user]))
      .rows[0].n,
    1,
  );
  const ownGrant = randomBytes(32).toString('base64url');
  await pool.query(
    "INSERT INTO staff_mfa_grants VALUES ($1,$2,$3,clock_timestamp()+interval '1 minute') ON CONFLICT(user_id) DO UPDATE SET grant_hash=EXCLUDED.grant_hash,expires_at=EXCLUDED.expires_at",
    [hospital, user, digest(ownGrant)],
  );
  assert.equal((await post(a, 'start', { grant: ownGrant })).statusCode, 200);
  assert.equal(
    (
      await pool.query(
        'SELECT 1 FROM staff_mfa_pending WHERE user_id=$1 AND expires_at<=clock_timestamp()',
        [user],
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await pool.query('SELECT count(*)::int AS n FROM staff_mfa_pending WHERE user_id=$1', [
        otherUser,
      ])
    ).rows[0].n,
    1,
  );
});

async function isolatedMfa(enrolled = true) {
  const id = randomUUID(),
    username = 'correction-' + randomUUID(),
    seed = newSecret();
  await pool.query(
    "INSERT INTO staff_users(id,hospital_id,username,display_name,role,password_hash,factor_generation) VALUES ($1,$2,$3,'Correction fixture','admin',$4,$5)",
    [id, hospital, username, await hashPassword(password), enrolled ? 1 : 0],
  );
  if (enrolled)
    await pool.query('INSERT INTO staff_factors(hospital_id,user_id,envelope) VALUES ($1,$2,$3)', [
      hospital,
      id,
      seal(seed, hospital, id, 'factor'),
    ]);
  const sign = () =>
    app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin },
      payload: { hospitalCode: 'mfa', username, password },
    });
  return { id, username, seed, sign, a: auth(await sign()) };
}
test('MFA hospital lock deadline rolls back and returns pool capacity; status has its own shared budget', async () => {
  const fixture = await isolatedMfa(),
    statusFixture = await isolatedMfa(false);
  const lock = await pool.connect();
  await lock.query('BEGIN');
  await lock.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [hospital]);
  try {
    const start = Date.now();
    const results = await Promise.all([
      post(fixture.a, 'verify', { code: totp(fixture.seed).generate() }),
      ...Array.from({ length: 4 }, () =>
        app.inject({ url: '/api/auth/mfa/status', headers: headers(statusFixture.a) }),
      ),
    ]);
    assert.deepEqual(
      results.map((r) => r.statusCode),
      [503, 503, 503, 503, 503],
    );
    assert.ok(Date.now() - start < 2500);
    assert.equal(
      (await pool.query('SELECT last_counter FROM staff_factors WHERE user_id=$1', [fixture.id]))
        .rows[0].last_counter,
      '-1',
    );
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
  }
  assert.equal(
    (await post(fixture.a, 'verify', { code: totp(fixture.seed).generate() })).statusCode,
    200,
  );
  const fresh = auth(await statusFixture.sign());
  const shared = await pool.connect();
  await shared.query('BEGIN');
  await shared.query('SELECT id FROM hospitals WHERE id=$1 FOR SHARE', [hospital]);
  try {
    for (let i = 0; i < 12; i++)
      assert.equal(
        (await app.inject({ url: '/api/auth/mfa/status', headers: headers(fresh) })).statusCode,
        200,
      );
  } finally {
    await shared.query('ROLLBACK');
    shared.release();
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='200ms'");
    await client.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [hospital]);
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
});
test('bounded MFA acquisition and total deadline abandon safely without late commits', async () => {
  const { boundedMfa } = await import('./mfa-db.ts');
  const tiny = new pg.Pool({ connectionString, max: 1, options: `-c search_path=${schema}` });
  const held = await tiny.connect();
  let called = false;
  try {
    await assert.rejects(
      boundedMfa(tiny, 'status', async () => {
        called = true;
      }),
      { status: 503 },
    );
  } finally {
    held.release();
  }
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(called, false);
  let resume!: () => void;
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const pending = boundedMfa(tiny, 'evidence', async (client) => {
    await client.query(
      "INSERT INTO mfa_rejection_buckets VALUES ('verify','denied',23,-100,1) ON CONFLICT DO NOTHING",
    );
    await gate;
    await client.query('UPDATE mfa_rejection_buckets SET attempts=55 WHERE bucket_hour=-100');
  });
  await assert.rejects(pending, { status: 503 });
  resume();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(
    (await tiny.query('SELECT 1 FROM mfa_rejection_buckets WHERE bucket_hour=-100')).rowCount,
    0,
  );
  await tiny.end();
});
test('rejected MFA and throttling survive rollback as fixed bounded evidence; telemetry failure cannot authorize', async () => {
  const f = await isolatedMfa();
  await pool.query('DELETE FROM mfa_rejection_buckets');
  for (let i = 0; i < 10; i++)
    assert.equal((await post(f.a, 'verify', { code: 'private-invalid-marker' })).statusCode, 403);
  assert.equal((await post(f.a, 'verify', { code: totp(f.seed).generate() })).statusCode, 429);
  assert.deepEqual(
    (await pool.query('SELECT outcome,attempts FROM mfa_rejection_buckets ORDER BY outcome')).rows,
    [
      { outcome: 'denied', attempts: 10 },
      { outcome: 'limited', attempts: 1 },
    ],
  );
  assert.equal(
    JSON.stringify((await pool.query('SELECT * FROM mfa_rejection_buckets')).rows).includes(
      'private-invalid-marker',
    ),
    false,
  );
  const malformed = await app.inject({
    method: 'POST',
    url: '/api/auth/mfa/verify',
    headers: { ...headers(f.a), 'content-type': 'application/json' },
    payload: '{invalid-json-marker',
  });
  assert.equal(malformed.statusCode, 400);
  assert.equal(
    (
      await pool.query(
        "SELECT attempts FROM mfa_rejection_buckets WHERE operation='verify' AND outcome='denied'",
      )
    ).rows[0].attempts,
    11,
  );
  assert.equal(
    (await pool.query("SELECT 1 FROM mfa_rejection_buckets WHERE outcome='unavailable'")).rowCount,
    0,
  );
  await pool.query("INSERT INTO mfa_rejection_buckets VALUES ('start','denied',0,-100,1)");
  await post(f.a, 'verify', { code: 'invalid' });
  assert.equal(
    (await pool.query('SELECT 1 FROM mfa_rejection_buckets WHERE bucket_hour=-100')).rowCount,
    0,
  );
  await assert.rejects(
    pool.query("INSERT INTO mfa_rejection_buckets VALUES ('guessed','denied',0,1,1)"),
  );
  const lock = await pool.connect();
  await lock.query('BEGIN');
  await lock.query('LOCK TABLE mfa_rejection_buckets IN ACCESS EXCLUSIVE MODE');
  try {
    const start = Date.now();
    assert.equal((await post(f.a, 'verify', { code: 'invalid' })).statusCode, 429);
    assert.ok(Date.now() - start < 1500);
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
  }
});
test('setup reports session-capped deadline and regenerated codes recover while retired codes fail', async () => {
  const f = await isolatedMfa(false),
    grant = randomBytes(32).toString('base64url');
  await pool.query(
    "INSERT INTO staff_mfa_grants VALUES ($1,$2,$3,clock_timestamp()+interval '30 minutes')",
    [hospital, f.id, digest(grant)],
  );
  await pool.query(
    "UPDATE staff_sessions SET restricted_expires_at=clock_timestamp()+interval '40 seconds' WHERE csrf_token=$1",
    [f.a.csrf],
  );
  const start = await post(f.a, 'start', { grant });
  assert.equal(start.statusCode, 200);
  assert.ok(Date.parse(start.json().setupExpiresAt) - Date.now() < 41000);
  const seed = start.json().secret;
  const confirm = await post(f.a, 'confirm', { code: totp(seed).generate() });
  assert.equal(confirm.statusCode, 200);
  const oldCodes = confirm.json().recoveryCodes;
  let a = auth(confirm, true);
  await pool.query('UPDATE staff_factors SET last_counter=-1 WHERE user_id=$1', [f.id]);
  const regenerated = await post(a, 'regenerate', { password, code: totp(seed).generate() });
  assert.equal(regenerated.statusCode, 200);
  const newCodes = regenerated.json().recoveryCodes;
  a = auth(regenerated, true);
  await pool.query('UPDATE staff_factors SET last_counter=-1 WHERE user_id=$1', [f.id]);
  const replacement = await post(a, 'replace', { password, code: totp(seed).generate() });
  assert.equal(replacement.statusCode, 200);
  assert.ok(Date.parse(replacement.json().setupExpiresAt) - Date.now() > 590000);
  const challenge = auth(await f.sign());
  assert.equal((await post(challenge, 'recover', { code: oldCodes[0] })).statusCode, 403);
  const recovery = await post(challenge, 'recover', { code: newCodes[0] });
  assert.equal(recovery.statusCode, 200);
  assert.equal(recovery.json().session.authState, 'recovery_enrollment');
  assert.equal(
    (await app.inject({ url: '/api/patients', headers: headers(challenge) })).statusCode,
    403,
  );
});

test('operator durable enrollment reason, trusted output ancestry, and partial-write/commit rollback', async () => {
  const { spawnSync } = await import('node:child_process');
  const { existsSync, mkdirSync, chmodSync, symlinkSync, readFileSync } = await import('node:fs');
  const f = await isolatedMfa(false);
  await pool.query('UPDATE staff_users SET factor_generation=2 WHERE id=$1', [f.id]);
  const url = new URL(connectionString!);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const run = (output: string, reason = 'initial_enrollment', hook?: string) =>
    spawnSync(
      process.execPath,
      [
        ...(hook ? ['--import', hook] : []),
        '--import',
        'tsx',
        'server/mfa-setup.ts',
        'grant',
        'mfa',
        f.username,
        reason,
        'test-operator',
        output,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: url.toString() },
        encoding: 'utf8',
        timeout: 15000,
      },
    );
  const rejected = join(directory, 'durable-refused.json');
  assert.equal(run(rejected).status, 1);
  assert.equal(existsSync(rejected), false);
  await pool.query('UPDATE staff_users SET factor_generation=0 WHERE id=$1', [f.id]);
  const unsafe = join(directory, 'unsafe');
  mkdirSync(unsafe);
  chmodSync(unsafe, 0o777);
  mkdirSync(join(unsafe, 'private'), { mode: 0o700 });
  assert.equal(run(join(unsafe, 'private', 'grant')).status, 1);
  const linked = join(directory, 'linked');
  symlinkSync(directory, linked);
  assert.equal(run(join(linked, 'symlink-grant')).status, 1);
  const existing = join(directory, 'existing');
  writeFileSync(existing, 'retain', { mode: 0o600 });
  assert.equal(run(existing).status, 1);
  assert.equal(readFileSync(existing, 'utf8'), 'retain');
  for (const failure of ['write', 'commit']) {
    const output = join(directory, failure + '-output.json'),
      hook = join(directory, failure + '-hook.mjs');
    // Fault injection exists only in this private test preload, never production CLI.
    writeFileSync(
      hook,
      `import fs from 'node:fs';import {syncBuiltinESMExports,createRequire} from 'node:module';const pg=createRequire(${JSON.stringify(join(process.cwd(), 'package.json'))})('pg');let written=false;const original=fs.writeFileSync;fs.writeFileSync=(...args)=>{if(typeof args[0]==='number'){written=true;${failure === 'write' ? "original(args[0],args[1].slice(0,8));throw Error('injected');" : 'return original(...args);'}}return original(...args);};syncBuiltinESMExports();const query=pg.Client.prototype.query;pg.Client.prototype.query=function(...args){if(written&&args[0]==='COMMIT'&&${failure === 'commit'})return Promise.reject(Error('injected'));return query.apply(this,args);};`,
    );
    const result = run(output, 'initial_enrollment', hook);
    assert.equal(result.status, 1);
    assert.equal(existsSync(output), false);
    assert.equal(
      (await pool.query('SELECT 1 FROM staff_mfa_grants WHERE user_id=$1', [f.id])).rowCount,
      0,
    );
    assert.deepEqual(
      (await pool.query('SELECT event FROM identity_security_events WHERE user_id=$1', [f.id]))
        .rows,
      [{ event: 'password.accepted' }],
    );
  }
});
test('MFA limiter and password reauthentication locks have bounded admission', async () => {
  const f = await isolatedMfa();
  const lock = await pool.connect();
  await lock.query('BEGIN');
  await lock.query('SELECT pg_advisory_xact_lock(71934103)');
  try {
    const start = Date.now();
    assert.equal((await post(f.a, 'verify', { code: totp(f.seed).generate() })).statusCode, 503);
    assert.ok(Date.now() - start < 2000);
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
  }
  const verified = await post(f.a, 'verify', { code: totp(f.seed).generate() });
  assert.equal(verified.statusCode, 200);
  const complete = auth(verified, true),
    reauthLock = await pool.connect();
  await reauthLock.query('BEGIN');
  await reauthLock.query('SELECT pg_advisory_xact_lock(71934103)');
  try {
    const start = Date.now();
    const denied = await app.inject({
      method: 'POST',
      url: '/api/staff/mfa/grant',
      headers: headers(complete),
      payload: { accountId: randomUUID(), password },
    });
    assert.equal(denied.statusCode, 503);
    assert.ok(Date.now() - start < 2000);
  } finally {
    await reauthLock.query('ROLLBACK');
    reauthLock.release();
  }
});
test('status flood budget is account-scoped and leaves proof admission available', async () => {
  const f = await isolatedMfa(false),
    other = auth(await f.sign()),
    grant = randomBytes(32).toString('base64url');
  for (let i = 0; i < 30; i++)
    assert.equal(
      (await app.inject({ url: '/api/auth/mfa/status', headers: headers(i % 2 ? f.a : other) }))
        .statusCode,
      200,
    );
  assert.equal(
    (await app.inject({ url: '/api/auth/mfa/status', headers: headers(other) })).statusCode,
    429,
  );
  await pool.query(
    "INSERT INTO staff_mfa_grants VALUES ($1,$2,$3,clock_timestamp()+interval '30 minutes')",
    [hospital, f.id, digest(grant)],
  );
  assert.equal((await post(f.a, 'start', { grant })).statusCode, 200);
});

test('predecessor and missing-session rejections never clear an elevated cookie', async () => {
  const f = await isolatedMfa();
  const elevated = await post(f.a, 'verify', { code: totp(f.seed).generate() });
  assert.equal(elevated.statusCode, 200);
  for (const cookie of [f.a.cookie, 'staff_session=invalid']) {
    const r = await app.inject({ url: '/api/auth/session', headers: { cookie } });
    assert.equal(r.statusCode, 401);
    assert.equal(r.headers['set-cookie'], undefined);
  }
  assert.equal(
    (await app.inject({ url: '/api/auth/session', headers: headers(auth(elevated, true)) }))
      .statusCode,
    200,
  );
});
test('shared-IP successful enrollment reservations refund; concurrent failures keep charges', async () => {
  const hash = await hashPassword(password);
  for (let i = 0; i < 26; i++) {
    const id = randomUUID(),
      token = randomBytes(32).toString('base64url'),
      csrf = randomUUID(),
      grant = randomBytes(32).toString('base64url');
    await pool.query(
      "INSERT INTO staff_users(id,hospital_id,username,display_name,role,password_hash) VALUES ($1,$2,$3,'Shared IP','admin',$4)",
      [id, hospital, 'shared-' + id, hash],
    );
    await pool.query(
      "INSERT INTO staff_sessions(token_hash,user_id,csrf_token,expires_at,auth_state,restricted_expires_at) VALUES ($1,$2,$3,clock_timestamp()+interval '1 hour','enrollment',clock_timestamp()+interval '10 minutes')",
      [digest(token), id, csrf],
    );
    await pool.query(
      "INSERT INTO staff_mfa_grants VALUES ($1,$2,$3,clock_timestamp()+interval '30 minutes')",
      [hospital, id, digest(grant)],
    );
    const a = { cookie: 'staff_session=' + token, csrf };
    const start = await post(a, 'start', { grant });
    assert.equal(start.statusCode, 200);
    assert.equal(
      (await post(a, 'confirm', { code: totp(start.json().secret).generate() })).statusCode,
      200,
    );
  }
  assert.equal(
    (
      await pool.query('SELECT attempts FROM login_buckets WHERE bucket_hash=$1', [
        digest('mfa-ip:127.0.0.1'),
      ])
    ).rows[0].attempts,
    0,
  );
  const f = await isolatedMfa();
  const attempts = await Promise.all(
    Array.from({ length: 12 }, () => post(f.a, 'verify', { code: 'wrong' })),
  );
  assert.equal(attempts.filter((r) => r.statusCode === 403).length, 10);
  assert.equal(attempts.filter((r) => r.statusCode === 429).length, 2);
  assert.equal((await post(f.a, 'verify', { code: totp(f.seed).generate() })).statusCode, 429);
});
test('login does not cascade cleanup into another hospital locked expired session', async () => {
  const f = await isolatedMfa(false),
    h = randomUUID(),
    u = randomUUID(),
    token = randomUUID();
  await pool.query('INSERT INTO hospitals(id,code,name) VALUES ($1,$2,$3)', [
    h,
    'cleanup-' + h,
    'Cleanup fixture',
  ]);
  await pool.query(
    "INSERT INTO staff_users(id,hospital_id,username,display_name,role,password_hash) VALUES ($1,$2,'other','Other','admin','unused')",
    [u, h],
  );
  await pool.query(
    "INSERT INTO staff_sessions(token_hash,user_id,csrf_token,expires_at,auth_state) VALUES ($1,$2,$3,clock_timestamp()-interval '1 second','enrollment')",
    [digest(token), u, randomUUID()],
  );
  await pool.query(
    "INSERT INTO staff_mfa_pending(hospital_id,user_id,session_hash,envelope,expires_at) VALUES ($1,$2,$3,$4,clock_timestamp()-interval '1 second')",
    [h, u, digest(token), seal(newSecret(), h, u, 'pending')],
  );
  const lock = await pool.connect();
  await lock.query('BEGIN');
  await lock.query('SELECT * FROM staff_mfa_pending WHERE user_id=$1 FOR UPDATE', [u]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      app
        .inject({
          method: 'POST',
          url: '/api/auth/login',
          headers: { origin, cookie: 'staff_session=' + token },
          payload: { hospitalCode: 'mfa', username: f.username, password },
        })
        .then((r) => assert.equal(r.statusCode, 200)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('Cross-hospital login contention')), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    await lock.query('ROLLBACK');
    lock.release();
  }
});
test('operator held hospital lock fails boundedly without output or mutation and permits retry', async () => {
  const { spawn } = await import('node:child_process');
  const { existsSync } = await import('node:fs');
  const f = await isolatedMfa(false);
  const url = new URL(connectionString!);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const output = join(directory, 'bounded-operator.json');
  const run = () =>
    new Promise<number | null>((resolve) => {
      const child = spawn(
        process.execPath,
        [
          '--import',
          'tsx',
          'server/mfa-setup.ts',
          'grant',
          'mfa',
          f.username,
          'initial_enrollment',
          'test-operator',
          output,
        ],
        { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'ignore', timeout: 12000 },
      );
      child.on('exit', resolve);
    });
  const lock = await pool.connect();
  await lock.query('BEGIN');
  await lock.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [hospital]);
  try {
    const start = Date.now();
    assert.equal(await run(), 1);
    assert.ok(Date.now() - start < 5000);
    assert.equal(existsSync(output), false);
    assert.equal(
      (await pool.query('SELECT 1 FROM staff_mfa_grants WHERE user_id=$1', [f.id])).rowCount,
      0,
    );
    assert.deepEqual(
      (await pool.query('SELECT event FROM identity_security_events WHERE user_id=$1', [f.id]))
        .rows,
      [{ event: 'password.accepted' }],
    );
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
  }
  assert.equal(await run(), 0);
  assert.equal(existsSync(output), true);
});
test('operator rotates established and pending envelopes; retired key removal preserves confirmation', async () => {
  const { spawnSync } = await import('node:child_process');
  const { readFileSync } = await import('node:fs');
  const f = await isolatedMfa();
  const verified = await post(f.a, 'verify', { code: totp(f.seed).generate() });
  const a = auth(verified, true);
  await pool.query('UPDATE staff_factors SET last_counter=-1 WHERE user_id=$1', [f.id]);
  const ring = JSON.parse(readFileSync(process.env.STAFF_MFA_KEYRING_FILE!, 'utf8'));
  const old = {
    ...ring,
    keys: { ...ring.keys, retiring: randomBytes(32).toString('hex') },
    current: 'retiring',
  };
  writeFileSync(process.env.STAFF_MFA_KEYRING_FILE!, JSON.stringify(old));
  await pool.query('UPDATE staff_factors SET envelope=$2 WHERE user_id=$1', [
    f.id,
    seal(f.seed, hospital, f.id, 'factor'),
  ]);
  const pending = await post(a, 'replace', { password, code: totp(f.seed).generate() });
  assert.equal(pending.statusCode, 200);
  writeFileSync(
    process.env.STAFF_MFA_KEYRING_FILE!,
    JSON.stringify({ ...old, current: ring.current }),
  );
  const url = new URL(connectionString!);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const output = join(directory, 'pending-rotation.json');
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      'server/mfa-setup.ts',
      'rotate-keys',
      'mfa',
      f.username,
      'compromised_factor',
      'test-operator',
      output,
    ],
    { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8', timeout: 12000 },
  );
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(readFileSync(output, 'utf8')).reencrypted, 2);
  writeFileSync(process.env.STAFF_MFA_KEYRING_FILE!, JSON.stringify(ring));
  await validateEnvelopes(pool);
  assert.equal(
    (await post(a, 'confirm', { code: totp(pending.json().secret).generate() })).statusCode,
    200,
  );
});

test('MFA refunds cannot decrement a replacement budget window and refund failure preserves committed success', async () => {
  const { reserveReauthentication } = await import('./auth.ts');
  const f = await isolatedMfa();
  const refund = await reserveReauthentication(pool, f.id, 'reservation-fixture', undefined, 'mfa');
  assert.ok(refund);
  const hashes = [digest('mfa-account:' + f.id), digest('mfa-ip:reservation-fixture')];
  await pool.query(
    "UPDATE login_buckets SET expires_at=expires_at+interval '1 second',attempts=7 WHERE bucket_hash=ANY($1::text[])",
    [hashes],
  );
  await refund();
  await refund();
  assert.deepEqual(
    (
      await pool.query('SELECT attempts FROM login_buckets WHERE bucket_hash=ANY($1::text[])', [
        hashes,
      ])
    ).rows.map((r) => r.attempts),
    [7, 7],
  );
  const query = pg.Client.prototype.query;
  let refunds = 0;
  pg.Client.prototype.query = function (this: pg.Client, ...args: any[]) {
    if (
      typeof args[0] === 'string' &&
      args[0].startsWith('UPDATE login_buckets SET attempts=GREATEST')
    ) {
      refunds++;
      return Promise.reject(Error('test storage failure'));
    }
    return (query as any).apply(this, args);
  } as typeof query;
  try {
    const response = await post(f.a, 'verify', { code: totp(f.seed).generate() });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().session.authState, 'complete');
    assert.equal(refunds, 1);
    assert.equal(
      (await app.inject({ url: '/api/patients', headers: headers(auth(response, true)) }))
        .statusCode,
      200,
    );
  } finally {
    pg.Client.prototype.query = query;
  }
});
