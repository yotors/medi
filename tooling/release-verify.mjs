// Verify only the isolated local release project, never an arbitrary remote URL.
import { randomBytes, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, copyFileSync, rmSync, openSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
process.env.PLAYWRIGHT_BROWSERS_PATH ??= fileURLToPath(new URL('../.cache/ms-playwright', import.meta.url));
const { chromium } = await import('@playwright/test');
class VerificationError extends Error {}
const check = (condition, message) => { if (!condition) throw new VerificationError(message); };
const privateFile = path => {
  const info = lstatSync(path);
  check(info.isFile() && !info.isSymbolicLink() && !(info.mode & 0o077), 'Private verification file permissions are required.');
};
const directory = lstatSync('.local');
check(directory.isDirectory() && !directory.isSymbolicLink() && !(directory.mode & 0o077), 'Private local directory is required.');
privateFile('.local/release.env');
const config = readFileSync('.local/release.env', 'utf8');
check(/^MEDI_MIGRATION_PASSWORD=[a-f0-9]{64}\nMEDI_RUNTIME_PASSWORD=[a-f0-9]{64}\nMEDI_RELEASE_TAG=[a-z0-9][a-z0-9_.-]{0,63}\n$/.test(config), 'Unexpected private release configuration.');
const environment = { ...process.env, ...Object.fromEntries(config.trim().split('\n').map(line => line.split('='))) };
const compose = ['compose', '--project-name', 'medi-release-local', '--env-file', '.local/release.env', '-f', 'compose.release.yaml'];
function docker(args, input) {
  const result = spawnSync('docker', [...compose, ...args], { input, env: environment, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
  check(!result.error && result.status === 0, 'Release verification command failed; sensitive diagnostics withheld.');
  return result.stdout;
}
function saveFixture(path, fixture) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let file;
  try {
    file = openSync(temporary, 'wx', 0o600);
    writeFileSync(file, `${JSON.stringify(fixture)}\n`);
    fsyncSync(file);
    closeSync(file); file = undefined;
    renameSync(temporary, path);
    const directory = openSync('.local', 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally {
    if (file !== undefined) closeSync(file);
    rmSync(temporary, { force: true });
  }
}
// Store only digests of synthetic records. Compare the complete previous run's
// rows before generating new ones, so a restart cannot pass by replacing them.
function persistenceSnapshot(hospitalCode, records) {
  const script = `import pg from 'pg'; import {createHash} from 'node:crypto';
    let input=''; for await(const chunk of process.stdin) input+=chunk;
    const {hospitalCode,records}=JSON.parse(input);
    const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
    try {
      const hospital=(await pool.query('SELECT id FROM hospitals WHERE code=$1',[hospitalCode])).rows[0];
      if(!hospital) throw Error();
      const values=[hospital.id,records.patientId,records.visitId,records.accountId,records.departmentId,records.serviceId];
      const queries=[
        ['patients','id=$2',1],
        ['outpatient_visits','id=$3',1],
        ['audit_events','visit_id=$3',records.clinical ? 7 : 2],
        ['staff_users','id=$4',1],
        ['staff_administration_events','account_id=$4',2],
        ['hospital_departments','id=$5',1],
        ['hospital_services','id=$6',1],
        ['hospital_service_versions','service_id=$6',2],
        ['hospital_configuration_events','department_id=$5 OR service_id=$6',4],
        ['registration_requests','patient_id=$2',1],
        ['outpatient_requests','visit_id=$3',records.clinical ? 7 : 2],
        ['staff_administration_requests','account_id=$4',1],
        ['hospital_configuration_requests',"result->'entry'->>'id' IN ($5::text,$6::text)",4]
      ];
      if(records.billing) queries.push(
        ['billing_invoices','visit_id=$3',1],
        ['billing_lines','invoice_id IN (SELECT id FROM billing_invoices WHERE visit_id=$3)',1],
        ['billing_payments','invoice_id IN (SELECT id FROM billing_invoices WHERE visit_id=$3)',2],
        ['billing_receipts','payment_id IN (SELECT id FROM billing_payments WHERE invoice_id IN (SELECT id FROM billing_invoices WHERE visit_id=$3))',2],
        ['billing_events','invoice_id IN (SELECT id FROM billing_invoices WHERE visit_id=$3)',3],
        ['billing_requests','visit_id=$3',3]
      );
      if(records.clinical) queries.push(
        ['clinical_amendments','visit_id=$3',2],
        ['clinical_events','visit_id=$3',3],
        ['clinical_requests','visit_id=$3',3]
      );
      const snapshots=[];
      for(const [table,where,count] of queries) {
        // Cast every parameter in the CTE, even if this row set uses only some.
        const sql='WITH p AS (SELECT $1::uuid h,$2::uuid patient,$3::uuid visit,$4::uuid account,$5::uuid department,$6::uuid service) SELECT to_jsonb(r)::text AS record FROM '+table+' r,p WHERE hospital_id=$1 AND ('+where+') ORDER BY to_jsonb(r)::text';
        const rows=(await pool.query(sql,values)).rows;
        if(rows.length!==count) throw Error();
        snapshots.push(createHash('sha256').update(JSON.stringify(rows)).digest('hex'));
      }
      process.stdout.write(JSON.stringify(snapshots));
    } catch {process.exitCode=1;} finally {await pool.end();}`;
  return JSON.parse(docker(['exec', '-T', 'api', 'node', '--input-type=module', '-e', script], JSON.stringify({ hospitalCode, records })));
}
const ca = docker(['exec', '-T', 'web', 'cat', '/data/caddy/pki/authorities/local/root.crt']);
const origin = 'https://localhost:8443';
function request(path, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = https.request({ hostname: '127.0.0.1', servername: 'localhost', port: 8443, path, ca, method,
      headers: { host: 'localhost:8443', ...headers, ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) }, timeout: 15000 }, response => {
      const chunks = []; let length = 0;
      response.on('data', chunk => { length += chunk.length; if (length > 1024 * 1024) req.destroy(new Error('Oversized response.')); else chunks.push(chunk); });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString() }));
    });
    req.on('timeout', () => req.destroy(new Error('Timed out.')));
    req.on('error', () => reject(new VerificationError('Local HTTPS request failed.')));
    req.end(data);
  });
}
let cookie;
let csrf;
try {
  const status = spawnSync(process.execPath, ['tooling/release-local.mjs', 'status'], { encoding: 'utf8', env: { ...environment, COMPOSE_PROJECT_NAME: 'unrelated-project-must-not-be-selected' }, timeout: 60000 });
  check(status.status === 0 && status.stdout.includes('medi-release-local-api'), 'Ambient Compose project override was not ignored.');
  const recoveryProbe = mkdtempSync(join(tmpdir(), 'medi-release-recovery-'));
  try {
    mkdirSync(join(recoveryProbe, 'tooling'));
    copyFileSync('tooling/release-local.mjs', join(recoveryProbe, 'tooling/release-local.mjs'));
    const missingConfig = spawnSync(process.execPath, [join(recoveryProbe, 'tooling/release-local.mjs'), 'build'], { encoding: 'utf8', env: environment, timeout: 60000 });
    check(missingConfig.status !== 0 && missingConfig.stderr.includes('original private configuration') && !existsSync(join(recoveryProbe, '.local/release.env')), 'Missing configuration generated credentials against existing release storage.');
  } finally { rmSync(recoveryProbe, { recursive: true, force: true }); }
  const html = await request('/staff');
  check(html.status === 200 && html.text.includes('/assets/') && !html.text.includes('/@vite/client'), 'Built UI was not served.');
  check(html.headers['content-security-policy']?.includes("frame-ancestors 'none'"), 'Browser policy header is missing.');
  check((await request('/api/health')).status === 200, 'API readiness failed.');
  check((await request('/api/patients')).status === 401, 'Anonymous records access was not denied.');

  const path = '.local/release-verification.json';
  let fixture;
  if (existsSync(path)) {
    privateFile(path);
    fixture = JSON.parse(readFileSync(path, 'utf8'));
  } else {
    fixture = { hospitalCode: `release-${randomUUID().slice(0, 8)}`, hospitalName: 'Release Synthetic Medical Center',
      username: 'admin', displayName: 'Release Administrator', role: 'admin', password: randomBytes(32).toString('hex') };
    const provision = `import { provisionStaff } from './compiled/server/setup.js';
      import { createPool } from './compiled/server/db.js';
      let input=''; for await (const chunk of process.stdin) input+=chunk;
      const pool=createPool();
      try { await provisionStaff(pool, JSON.parse(input)); }
      catch { process.exitCode=1; }
      finally { await pool.end(); }`;
    docker(['run', '--rm', '--no-deps', '-T', '--entrypoint', 'node', 'migrate', '--input-type=module', '-e', provision], JSON.stringify(fixture));
    writeFileSync(path, `${JSON.stringify(fixture)}\n`, { flag: 'wx', mode: 0o600 });
  }
  check(/^release-[a-f0-9-]{8}$/.test(fixture.hospitalCode) && fixture.username === 'admin', 'Unexpected release fixture.');
  const login = await request('/api/auth/login', { method: 'POST', headers: { origin }, body: {
    hospitalCode: fixture.hospitalCode, username: fixture.username, password: fixture.password,
  } });
  check(login.status === 200, 'Release sign-in failed.');
  const setCookie = login.headers['set-cookie']?.[0] ?? '';
  check(/; Secure/.test(setCookie) && /; HttpOnly/.test(setCookie) && /; SameSite=Strict/i.test(setCookie), 'Session cookie protection failed.');
  cookie = setCookie.split(';')[0]; csrf = JSON.parse(login.text).csrfToken;
  const headers = { cookie, origin, 'x-csrf-token': csrf };
  const body = { name: 'Release Synthetic Patient', contact: '', confirmDuplicate: true };
  if (fixture.patientId) check((await request(`/api/patients/${fixture.patientId}`, { headers: { cookie } })).status === 200, 'Previously saved release patient is missing.');
  if (fixture.records) {
    check(isDeepStrictEqual(persistenceSnapshot(fixture.hospitalCode, fixture.records), fixture.recordDigests), 'Previous staff, clinical, catalog, history or retry records changed or disappeared.');
    const previousVisit = await request(`/api/visits/${fixture.records.visitId}`, { headers });
    check(previousVisit.status === 200 && JSON.parse(previousVisit.text).visit.notes.some(note => note.body === 'Synthetic release verification note.'), 'Previous clinical note is unavailable through the API.');
  }
  const key = randomUUID();
  check((await request('/api/patients', { method: 'POST', headers: { ...headers, origin: 'https://untrusted.invalid', 'idempotency-key': key }, body })).status === 403, 'Foreign Origin was accepted.');
  check((await request('/api/patients', { method: 'POST', headers: { ...headers, 'x-csrf-token': 'incorrect', 'idempotency-key': key }, body })).status === 403, 'Incorrect CSRF token was accepted.');
  const created = await request('/api/patients', { method: 'POST', headers: { ...headers, 'idempotency-key': key }, body });
  check(created.status === 201, 'Runtime account could not register a patient.');
  const replay = await request('/api/patients', { method: 'POST', headers: { ...headers, 'idempotency-key': key }, body });
  check(replay.status === 200 && JSON.parse(replay.text).patient.id === JSON.parse(created.text).patient.id, 'Registration retry was not idempotent.');
  fixture.patientId = JSON.parse(created.text).patient.id;

  const checkedIn = await request(`/api/patients/${fixture.patientId}/visits`, {
    method: 'POST', headers: { ...headers, 'idempotency-key': randomUUID() }, body: {},
  });
  check(checkedIn.status === 201, 'Restricted runtime could not check in a patient.');
  const visit = JSON.parse(checkedIn.text).visit;
  const suffix = randomUUID().slice(0, 8);
  const accountCommand = { type: 'create', username: `verify-${suffix}`, displayName: 'Release Synthetic Clinician', role: 'clinician', temporaryPassword: randomBytes(32).toString('base64url') };
  const accountHeaders = { ...headers, 'idempotency-key': randomUUID() };
  const accountBody = { currentPassword: fixture.password, command: accountCommand };
  const accountResponse = await request('/api/staff/commands', { method: 'POST', headers: accountHeaders, body: accountBody });
  check(accountResponse.status === 201, 'Restricted runtime could not create staff.');
  const account = JSON.parse(accountResponse.text).account;
  const accountReplay = await request('/api/staff/commands', { method: 'POST', headers: accountHeaders, body: accountBody });
  check(accountReplay.status === 200 && JSON.parse(accountReplay.text).account.id === account.id, 'Staff creation replay failed.');
  const staffLogin = async password => request('/api/auth/login', { method: 'POST', headers: { origin }, body: { hospitalCode: fixture.hospitalCode, username: account.username, password } });
  const temporarySession = await staffLogin(accountCommand.temporaryPassword);
  check(temporarySession.status === 200 && JSON.parse(temporarySession.text).passwordChangeRequired, 'Temporary staff credential was not gated.');
  const temporaryHeaders = { origin, cookie: temporarySession.headers['set-cookie'][0].split(';')[0], 'x-csrf-token': JSON.parse(temporarySession.text).csrfToken };
  check((await request('/api/patients', { headers: temporaryHeaders })).status === 403, 'Temporary staff account gained patient access.');
  const replacement = randomBytes(32).toString('base64url');
  check((await request('/api/auth/password', { method: 'POST', headers: temporaryHeaders, body: { currentPassword: accountCommand.temporaryPassword, newPassword: replacement } })).status === 200, 'Restricted runtime password replacement failed.');
  check((await request('/api/auth/session', { headers: temporaryHeaders })).status === 401, 'Password replacement retained the old session.');
  const clinicianSession = await staffLogin(replacement);
  check(clinicianSession.status === 200 && !JSON.parse(clinicianSession.text).passwordChangeRequired, 'Replacement credential could not access the workspace.');
  const clinicianHeaders = { origin, cookie: clinicianSession.headers['set-cookie'][0].split(';')[0], 'x-csrf-token': JSON.parse(clinicianSession.text).csrfToken };
  try {
    const note = await request(`/api/visits/${visit.id}/commands`, { method: 'POST', headers: { ...clinicianHeaders, 'idempotency-key': randomUUID() }, body: { expectedRevision: visit.revision, command: { type: 'note', body: 'Synthetic release verification note.' } } });
    check(note.status === 200 && JSON.parse(note.text).visit.revision === visit.revision + 1, 'Restricted runtime could not save a clinical command.');
    check((await request('/api/staff', { headers: clinicianHeaders })).status === 403, 'Clinical staff accessed administration.');
  } finally { await request('/api/auth/logout', { method: 'POST', headers: clinicianHeaders }); }
  const staffHistory = await request(`/api/staff/${account.id}/history`, { headers });
  check(staffHistory.status === 200 && JSON.parse(staffHistory.text).events.length === 2, 'Administrative history did not persist creation and password replacement.');

  const configuration = async command => {
    const commandHeaders = { ...headers, 'idempotency-key': randomUUID() };
    const saved = await request('/api/configuration/commands', { method: 'POST', headers: commandHeaders, body: command });
    check(saved.status === 200, 'Restricted runtime configuration save failed.');
    const retried = await request('/api/configuration/commands', { method: 'POST', headers: commandHeaders, body: command });
    check(retried.status === 200 && isDeepStrictEqual(JSON.parse(retried.text), JSON.parse(saved.text)), 'Configuration retry did not preserve its original result.');
    return JSON.parse(saved.text).entry;
  };
  const department = await configuration({ type: 'department.create', code: `D${suffix.toUpperCase()}`, name: 'Release Synthetic Department' });
  const service = await configuration({ type: 'service.create', code: `S${suffix.toUpperCase()}`, name: 'Release Synthetic Service', departmentId: department.id, priceMinor: 12500 });
  await configuration({ type: 'department.update', id: department.id, expectedRevision: department.revision, name: 'Release Updated Department', active: true });
  await configuration({ type: 'service.update', id: service.id, expectedRevision: service.revision, name: service.name, departmentId: department.id, priceMinor: 13000, active: true });
  const serviceHistory = await request(`/api/configuration/services/${service.id}/history`, { headers });
  check(serviceHistory.status === 200 && JSON.parse(serviceHistory.text).events.length === 2 && JSON.parse(serviceHistory.text).events[1].snapshot.priceMinor === 12500, 'Versioned service history did not preserve the original price.');

  const financial = async command => {
    const commandHeaders = { ...headers, 'idempotency-key': randomUUID() };
    const saved = await request(`/api/visits/${visit.id}/billing/commands`, { method: 'POST', headers: commandHeaders, body: command });
    check(saved.status === 200, 'Restricted runtime billing save failed.');
    const retried = await request(`/api/visits/${visit.id}/billing/commands`, { method: 'POST', headers: commandHeaders, body: command });
    const original = JSON.parse(saved.text), replayed = JSON.parse(retried.text);
    check(retried.status === 200 && replayed.replayed && original.invoiceId === replayed.invoiceId && original.receiptId === replayed.receiptId && original.receiptNumber === replayed.receiptNumber, 'Billing replay did not preserve the original operation.');
    return original;
  };
  const issued = await financial({ type: 'invoice.issue', lines: [{ serviceId: service.id, serviceRevision: 2, quantity: 1 }] });
  const firstPayment = await financial({ type: 'payment.record', invoiceId: issued.invoiceId, expectedRevision: 1, amountMinor: 5000, method: 'cash' });
  const secondPayment = await financial({ type: 'payment.record', invoiceId: issued.invoiceId, expectedRevision: 2, amountMinor: 8000, method: 'manual_transfer', reference: 'SYNTHETIC-RELEASE-TRANSFER' });
  check(firstPayment.receiptId !== secondPayment.receiptId, 'Distinct payments did not receive distinct receipts.');
  const financialDetail = await request(`/api/billing/invoices/${issued.invoiceId}`, { headers });
  check(financialDetail.status === 200 && JSON.parse(financialDetail.text).invoice.balanceMinor === 0 && JSON.parse(financialDetail.text).events.length === 3, 'Restricted runtime billing history or balance failed.');

  // Exercise corrections after closure using the restricted runtime account.
  let clinicalVisit = JSON.parse((await request(`/api/visits/${visit.id}`, { headers })).text).visit;
  const visitCommand = async command => {
    const response = await request(`/api/visits/${visit.id}/commands`, { method: 'POST', headers: { ...headers, 'idempotency-key': randomUUID() }, body: { expectedRevision: clinicalVisit.revision, command } });
    check(response.status === 200, 'Restricted runtime clinical fixture transition failed.');
    clinicalVisit = JSON.parse(response.text).visit;
  };
  await visitCommand({ type: 'order', test: 'Blood count' });
  const orderId = clinicalVisit.orders.at(-1).id;
  await visitCommand({ type: 'advanceOrder', orderId, next: 'collected' });
  await visitCommand({ type: 'advanceOrder', orderId, next: 'released', result: 'Synthetic original result.' });
  await visitCommand({ type: 'advanceOrder', orderId, next: 'reviewed' });
  await visitCommand({ type: 'close' });
  const closedRevision = clinicalVisit.revision;
  const clinical = async command => {
    const commandHeaders = { ...headers, 'idempotency-key': randomUUID() };
    const response = await request(`/api/visits/${visit.id}/clinical/commands`, { method: 'POST', headers: commandHeaders, body: command });
    check(response.status === 200, 'Restricted runtime clinical correction failed.');
    const replay = await request(`/api/visits/${visit.id}/clinical/commands`, { method: 'POST', headers: commandHeaders, body: command });
    check(replay.status === 200 && isDeepStrictEqual(JSON.parse(replay.text), JSON.parse(response.text)), 'Clinical correction replay changed its receipt.');
    return JSON.parse(response.text);
  };
  await clinical({ type: 'note.amend', subjectId: clinicalVisit.notes[0].id, expectedVersion: 0, body: 'Synthetic amended note.', reason: 'Synthetic release correction.' });
  const correction = await clinical({ type: 'result.correct', subjectId: orderId, expectedVersion: 0, body: 'Synthetic corrected result.', reason: 'Synthetic release correction.', ownerId: JSON.parse(login.text).user.id });
  const beforeReview = await request(`/api/visits/${visit.id}/clinical`, { headers });
  check(beforeReview.status === 200 && JSON.parse(beforeReview.text).pendingReviews === 1, 'Closed result correction did not require fresh review.');
  await clinical({ type: 'result.review', subjectId: orderId, expectedVersion: correction.version, amendmentId: correction.eventId });
  const afterReview = await request(`/api/visits/${visit.id}/clinical`, { headers });
  check(afterReview.status === 200 && JSON.parse(afterReview.text).pendingReviews === 0, 'Corrected result review remained unresolved.');
  const preserved = JSON.parse((await request(`/api/visits/${visit.id}`, { headers })).text).visit;
  check(preserved.status === 'closed' && preserved.revision === closedRevision && preserved.notes[0].body === 'Synthetic release verification note.' && preserved.orders.at(-1).result === 'Synthetic original result.', 'Correction changed the closed original record.');

  const packaging = `import {existsSync,readdirSync} from 'node:fs';
    const forbidden=['/app/.env','/app/.local','/app/.agents','/app/.codex','/app/tests','/app/artifacts','/app/node_modules/tsx','/app/node_modules/@playwright/test'];
    const walk=p=>readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(p+'/'+e.name):[p+'/'+e.name]);
    if(process.getuid()===0||forbidden.some(existsSync)||walk('/app/compiled').some(p=>/\\.test\\./.test(p))) process.exit(1);`;
  docker(['exec', '-T', 'api', 'node', '--input-type=module', '-e', packaging]);
  const grants = `import pg from 'pg'; const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
    const client=await pool.connect(); let failed=false;
    try {
      const r=(await client.query("SELECT current_user AS name,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user")).rows[0];
      if(r.name!=='medi_runtime'||r.rolsuper||r.rolcreatedb||r.rolcreaterole) throw Error();
      for(const sql of ["CREATE TABLE forbidden_release_probe(id integer)","ALTER TABLE patients ADD COLUMN forbidden_release_probe integer","UPDATE audit_events SET action=action WHERE false","DELETE FROM audit_events WHERE false","DELETE FROM staff_users WHERE false","UPDATE staff_administration_events SET role=role WHERE false","DELETE FROM staff_administration_events WHERE false","UPDATE hospital_configuration_events SET action=action WHERE false","DELETE FROM hospital_configuration_events WHERE false","UPDATE hospital_service_versions SET name=name WHERE false","DELETE FROM hospital_service_versions WHERE false","UPDATE billing_invoices SET number=number WHERE false","DELETE FROM billing_invoices WHERE false","UPDATE billing_lines SET name=name WHERE false","DELETE FROM billing_payments WHERE false","UPDATE billing_receipts SET number=number WHERE false","DELETE FROM billing_events WHERE false","UPDATE billing_requests SET result=result WHERE false","UPDATE clinical_amendments SET body=body WHERE false","DELETE FROM clinical_amendments WHERE false","UPDATE clinical_events SET actor_name=actor_name WHERE false","DELETE FROM clinical_events WHERE false","UPDATE clinical_requests SET result=result WHERE false","DELETE FROM clinical_requests WHERE false","INSERT INTO registration_migrations(version) VALUES (99999)"]) {
        await client.query('BEGIN'); let denied=false;
        try { await client.query(sql); } catch(e) { denied=e.code==='42501'; }
        finally { await client.query('ROLLBACK'); }
        if(!denied) throw Error();
      }
    } catch { failed=true; }
    finally { client.release(); await pool.end(); }
    process.exitCode=failed?1:0;`;
  docker(['exec', '-T', 'api', 'node', '--input-type=module', '-e', grants]);
  check((await request('/api/auth/logout', { method: 'POST', headers })).status === 204, 'Release logout failed.');
  check((await request('/api/patients', { headers: { cookie } })).status === 401, 'Logged-out release session remained usable.');
  cookie = undefined;
  const browser = await chromium.launch();
  try {
    // The HTTPS requests above verify the actual private CA. Chromium uses a
    // throwaway context only; never install the rehearsal CA into the host OS.
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', () => errors.push('runtime'));
    await page.goto(`${origin}/staff`);
    await page.getByLabel('Hospital code', { exact: true }).fill(fixture.hospitalCode);
    await page.getByLabel('Username', { exact: true }).fill(fixture.username);
    await page.getByLabel('Password', { exact: true }).fill(fixture.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('heading', { name: 'Patient directory', exact: true }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: 'Patient directory', exact: true }).waitFor();
    check(errors.length === 0, 'Built browser application reported a runtime error.');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('heading', { name: 'Staff sign-in', exact: true }).waitFor();
    await context.close();
  } finally { await browser.close(); }
  try {
    docker(['stop', 'database']);
    check((await request('/api/health')).status !== 200, 'Readiness incorrectly passed with the database stopped.');
  } finally { docker(['up', '-d', '--wait', '--wait-timeout', '60', 'database']); }
  check((await request('/api/health')).status === 200, 'API did not recover after the database returned.');
  fixture.records = { patientId: fixture.patientId, visitId: visit.id, accountId: account.id, departmentId: department.id, serviceId: service.id, billing: true, clinical: true };
  fixture.recordDigests = persistenceSnapshot(fixture.hospitalCode, fixture.records);
  saveFixture(path, fixture);
  console.log('PASS: isolated project/configuration recovery guards, image contents and database-outage readiness/recovery.');
  console.log('PASS: built HTTPS UI, protected session, Origin/CSRF, persisted registration/retry, restricted runtime SQL, logout.');
  console.log('PASS: restricted-runtime check-in/clinical note, staff onboarding/password replacement, configuration versions/history and retries.');
  console.log('PASS: catalog invoice, partial cash/manual-transfer payments, stable replay receipts, immutable ledger grants and restart digests.');
  console.log('PASS: closed-record note/result corrections, fresh review, stable retries, original preservation and clinical-history grants/digests.');
  console.log('PASS: built browser sign-in, session restoration on refresh, and sign-out with no runtime errors.');
  console.log('Private synthetic administrator details: .local/release-verification.json. Prior saved records are checked on each subsequent run.');
} catch (error) {
  // Browser diagnostics can contain filled values; never forward their errors.
  console.error(error instanceof VerificationError ? error.message : 'Release verification failed; sensitive diagnostics withheld.');
  process.exitCode = 1;
} finally {
  if (cookie && csrf) await request('/api/auth/logout', { method: 'POST', headers: { origin, cookie, 'x-csrf-token': csrf } }).catch(() => {});
}
