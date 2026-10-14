import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import pg from 'pg';
import { provisionStaff } from '../server/setup';
import { digest } from '../server/auth';
import { totp } from '../server/mfa-config';
try {
  loadEnvFile('.env');
} catch {}
let pool: pg.Pool;
test.beforeAll(() => {
  const schema = readFileSync('.local/mfa-browser-schema', 'utf8');
  if (!/^mfa_browser_[a-f0-9]{16}$/.test(schema)) throw Error();
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schema}`,
  });
});
test.afterAll(async () => {
  await pool.end();
});
async function capture(page: Page, name: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  mkdirSync('artifacts/mfa-ui', { recursive: true });
  await page.screenshot({
    path: `artifacts/mfa-ui/${name}.png`,
    fullPage: true,
    style:
      '[data-private] { color:transparent !important; background:#e6f2ee !important; } [data-private] * { visibility:hidden !important; } input { color:transparent !important; -webkit-text-fill-color:transparent !important; text-shadow:none !important; caret-color:transparent !important; }',
  });
}
test('keyboard enrollment, one-time saving, challenge errors, recovery and expiration', async ({
  page,
}, info) => {
  const hospitalCode = 'mfa-' + randomUUID().slice(0, 8),
    password = randomBytes(24).toString('hex'),
    grant = randomBytes(32).toString('base64url');
  const user = await provisionStaff(pool, {
    hospitalCode,
    hospitalName: 'Synthetic MFA hospital',
    username: 'staff',
    displayName: 'Synthetic staff',
    role: 'admin',
    password,
  });
  const hospital = (await pool.query('SELECT hospital_id FROM staff_users WHERE id=$1', [user.id]))
    .rows[0].hospital_id;
  await pool.query(
    "INSERT INTO staff_mfa_grants(hospital_id,user_id,grant_hash,expires_at) VALUES ($1,$2,$3,clock_timestamp()+interval '30 minutes')",
    [hospital, user.id, digest(grant)],
  );
  let patientRequests = 0;
  page.on('request', (r) => {
    if (r.url().includes('/api/patients')) patientRequests++;
  });
  const signIn = async () => {
    await page.goto('/staff/patients');
    await page.getByLabel('Hospital code', { exact: true }).fill(hospitalCode);
    await page.getByLabel('Username', { exact: true }).fill('staff');
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Password', { exact: true }).press('Enter');
  };
  await signIn();
  await expect(page.getByRole('heading', { name: 'Set up staff sign-in' })).toBeFocused();
  expect(patientRequests).toBe(0);
  await capture(page, info.project.name + '-grant');
  await page.getByLabel('Enrollment grant').fill(grant);
  await page.getByLabel('Enrollment grant').press('Enter');
  await expect(page.getByRole('heading', { name: 'Set up your authenticator' })).toBeFocused();
  const secret = await page.locator('.mfa-secret code').textContent();
  if (!secret) throw Error('Missing setup');
  const qr = PNG.sync.read(await page.locator('.mfa-qr svg').screenshot());
  const decoded = jsQR(new Uint8ClampedArray(qr.data), qr.width, qr.height);
  if (!decoded) throw Error('Enrollment QR could not be decoded');
  const enrollment = new URL(decoded.data);
  // Never print secret-bearing QR/URI values into browser artifacts or assertion logs.
  if (
    enrollment.protocol !== 'otpauth:' ||
    enrollment.hostname !== 'totp' ||
    enrollment.searchParams.get('secret') !== secret ||
    enrollment.searchParams.get('algorithm') !== 'SHA1' ||
    enrollment.searchParams.get('digits') !== '6' ||
    enrollment.searchParams.get('period') !== '30' ||
    enrollment.searchParams.get('issuer') !== 'Synthetic MFA hospital' ||
    decodeURIComponent(enrollment.pathname) !== `/${hospitalCode}:${user.id}`
  )
    throw Error('Enrollment QR protocol mismatch');

  expect(
    (await new AxeBuilder({ page }).analyze()).violations.map(({ id, impact }) => ({ id, impact })),
  ).toEqual([]);
  await capture(page, info.project.name + '-setup');
  let releasePoll!: () => void, pollReady!: () => void;
  const pollGate = new Promise<void>((resolve) => {
      releasePoll = resolve;
    }),
    pollStarted = new Promise<void>((resolve) => {
      pollReady = resolve;
    });
  await page.route('**/api/auth/session', async (route) => {
    pollReady();
    await pollGate;
    const response = await page.request.get('/api/auth/session');
    await route.fulfill({ response });
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await pollStarted;
  await page.getByLabel('Authenticator code', { exact: true }).fill(totp(secret).generate());
  await page.getByLabel('Authenticator code', { exact: true }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
  const stalePollFinished = page.waitForResponse((r) => r.url().endsWith('/api/auth/session'));
  releasePoll();
  await stalePollFinished;
  await page.unroute('**/api/auth/session');
  await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
  expect((await page.request.get('/api/auth/session')).status()).toBe(200);

  const recovery = await page.locator('.mfa-codes code').first().textContent();
  if (!recovery) throw Error('Missing recovery');
  expect(patientRequests).toBe(0);
  await capture(page, info.project.name + '-codes');
  await page.getByRole('button', { name: 'Continue to workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Patient directory' })).toBeVisible();
  const freshProof = async () => {
    await pool.query('UPDATE staff_factors SET last_counter=-1 WHERE user_id=$1', [user.id]);
  };
  let releaseStatus!: () => void;
  const statusGate = new Promise<void>((resolve) => {
    releaseStatus = resolve;
  });
  await page.route('**/api/auth/mfa/status', async (route) => {
    const response = await route.fetch();
    await statusGate;
    await route.fulfill({ response });
  });
  await page.getByRole('link', { name: 'Authenticator security', exact: true }).click();
  await expect(page.getByText('Loading authenticator setup…')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Replace authenticator', exact: true }),
  ).toHaveCount(0);
  await capture(page, info.project.name + '-maintenance-loading');
  releaseStatus();
  await expect(page.getByLabel('Current password', { exact: true })).toBeVisible();
  await page.unroute('**/api/auth/mfa/status');
  await capture(page, info.project.name + '-maintenance');
  await freshProof();
  await page.getByLabel('Current password', { exact: true }).fill(password);
  await page.getByLabel('Authenticator code', { exact: true }).fill(totp(secret).generate());
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let received!: () => void;
  const responseReady = new Promise<void>((resolve) => {
    received = resolve;
  });
  await page.route('**/api/auth/mfa/regenerate', async (route) => {
    const response = await route.fetch();
    received();
    await gate;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Generate new recovery codes' }).click();
  await responseReady;
  await expect(page.getByRole('link', { name: 'Patient directory', exact: true })).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('Generating new recovery codes…');
  await capture(page, info.project.name + '-maintenance-pending');
  release();
  await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
  await page.unroute('**/api/auth/mfa/regenerate');
  await page.getByRole('button', { name: 'Continue to workspace' }).click();
  await page.getByRole('link', { name: 'Authenticator security', exact: true }).click();
  await freshProof();
  await page.getByLabel('Current password', { exact: true }).fill(password);
  await page.getByLabel('Authenticator code', { exact: true }).fill(totp(secret).generate());
  let releaseReplacement!: () => void;
  const replacementGate = new Promise<void>((resolve) => {
    releaseReplacement = resolve;
  });
  await page.route('**/api/auth/mfa/replace', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await replacementGate;
    await route.fulfill({
      response,
      json: { ...body, setupExpiresAt: new Date(Date.now() + 800).toISOString() },
    });
  });
  await page.getByRole('button', { name: 'Replace authenticator', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Preparing replacement authenticator…');
  await capture(page, info.project.name + '-replacement-pending');
  releaseReplacement();
  await expect(page.getByRole('alert')).toContainText('Setup expired');
  await capture(page, info.project.name + '-replacement-expired');
  await page.unroute('**/api/auth/mfa/replace');
  await page.route('**/api/auth/mfa/replace', async (route) => {
    await route.fetch();
    await route.abort();
  });
  await freshProof();
  await page.getByLabel('Current password', { exact: true }).fill(password);
  await page.getByLabel('Authenticator code', { exact: true }).fill(totp(secret).generate());
  await page.getByRole('button', { name: 'Replace authenticator', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Set up your authenticator' })).toBeVisible();
  await page.unroute('**/api/auth/mfa/replace');
  const replacement = await page.locator('.mfa-secret code').textContent();
  if (!replacement) throw Error('Missing replacement');
  await capture(page, info.project.name + '-replacement');
  await page.getByLabel('Authenticator code', { exact: true }).fill(totp(replacement).generate());
  await page.getByLabel('Authenticator code', { exact: true }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
  const currentRecovery = await page.locator('.mfa-codes code').first().textContent();
  if (!currentRecovery) throw Error('Missing recovery');
  await page.getByRole('button', { name: 'Continue to workspace' }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn();
  await freshProof();
  await page.getByLabel('Authenticator code', { exact: true }).fill(totp(replacement).generate());
  await page.getByRole('button', { name: 'Verify code' }).click();
  await expect(page.getByRole('heading', { name: 'Patient directory' })).toBeVisible();
  const target = await provisionStaff(pool, {
    hospitalCode,
    hospitalName: 'Synthetic MFA hospital',
    username: 'grant-target',
    displayName: 'Grant recipient',
    role: 'receptionist',
    password: randomBytes(24).toString('hex'),
  });
  await page.route('**/api/staff/mfa/grant', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const {
      rows: [grantRow],
    } = await pool.query(
      "UPDATE staff_mfa_grants SET expires_at=clock_timestamp()+interval '2 seconds' WHERE user_id=$1 RETURNING expires_at",
      [target.id],
    );
    await route.fulfill({
      response,
      json: { ...body, expiresAt: grantRow.expires_at.toISOString() },
    });
  });
  await page.getByRole('link', { name: 'Staff administration', exact: true }).click();
  await page.getByRole('button', { name: 'Manage Grant recipient', exact: true }).click();
  await page.getByLabel('Your current password').fill(password);
  await page.getByRole('button', { name: 'Issue enrollment grant' }).click();
  await expect(
    page.getByRole('heading', { name: 'Deliver this enrollment grant privately' }),
  ).toBeVisible();
  await capture(page, info.project.name + '-admin-grant');
  expect(
    (
      await pool.query('SELECT count(*)::int AS n FROM staff_mfa_grants WHERE user_id=$1', [
        target.id,
      ])
    ).rows[0].n,
  ).toBe(1);
  await expect(
    page.getByText(
      'Enrollment grant expired. Verify the staff member’s identity and issue a replacement grant.',
    ),
  ).toBeVisible();
  await expect(page.locator('[data-private]')).toHaveCount(0);
  await capture(page, info.project.name + '-admin-grant-expired');
  await page.unroute('**/api/staff/mfa/grant');
  await page.getByLabel('Your current password').fill(password);
  await page.getByRole('button', { name: 'Issue enrollment grant' }).click();
  await expect(
    page.getByRole('heading', { name: 'Deliver this enrollment grant privately' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Clear enrollment grant' }).click();
  await expect(page.locator('[data-private]')).toHaveCount(0);
  await pool.query('UPDATE staff_users SET factor_generation=1 WHERE id=$1', [target.id]);
  await page.getByRole('button', { name: 'Back to staff directory' }).click();
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/staff?') && r.status() === 200),
    page.getByRole('button', { name: 'Search staff', exact: true }).click(),
  ]);
  await page.getByRole('button', { name: 'Manage Grant recipient', exact: true }).click();
  await expect(
    page.getByText(
      'This account needs independent operator recovery or its own recovery code. First enrollment grants are unavailable.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Issue enrollment grant' })).toBeDisabled();
  await capture(page, info.project.name + '-admin-ineligible');
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/patients') && r.status() === 200),
    page.getByRole('link', { name: 'Patient directory', exact: true }).click(),
  ]);
  await expect(page.getByText('Loading patients…', { exact: true })).toHaveCount(0);
  await pool.query(
    "UPDATE staff_sessions SET idle_expires_at=clock_timestamp()+interval '3 seconds' WHERE user_id=$1",
    [user.id],
  );
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/auth/session')),
    page.evaluate(() => window.dispatchEvent(new Event('focus'))),
  ]);
  const activity = page.waitForResponse(
    (r) => r.url().includes('/api/patients') && r.status() === 200,
  );
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const activityResponse = await activity;
  expect(activityResponse.headers()['x-session-expires-at']).toBeTruthy();
  await page.waitForTimeout(3500);
  await expect(page.getByRole('heading', { name: 'Patient directory' })).toBeVisible();
  const requestsBeforePoll = patientRequests;
  await pool.query(
    "UPDATE staff_sessions SET idle_expires_at=clock_timestamp()+interval '2 seconds' WHERE user_id=$1",
    [user.id],
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toBeVisible();
  expect(patientRequests).toBe(requestsBeforePoll);
  await capture(page, info.project.name + '-idle-expired');
  patientRequests = 0;
  await signIn();
  await expect(page.getByRole('heading', { name: 'Enter authenticator code' })).toBeFocused();
  await capture(page, info.project.name + '-challenge');
  await page.getByLabel('Authenticator code', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Verify code' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(patientRequests).toBe(0);
  await capture(page, info.project.name + '-error');
  await page.getByRole('button', { name: 'Use a recovery code' }).click();
  await capture(page, info.project.name + '-recovery');
  await pool.query('DELETE FROM staff_recovery_codes WHERE user_id=$1 AND code_hash<>$2', [
    user.id,
    digest(currentRecovery),
  ]);
  await page.route('**/api/auth/mfa/recover', async (route) => {
    await route.fetch();
    await route.abort();
  });
  await page.route('**/api/auth/session', (route) => route.abort());
  await page.getByLabel('Recovery code', { exact: true }).fill(currentRecovery);
  await page.getByRole('button', { name: 'Recover and replace authenticator' }).click();
  await expect(page.getByRole('button', { name: 'Resume authenticator setup' })).toBeVisible();
  await expect(page.getByLabel('Recovery code', { exact: true })).toHaveCount(0);
  await capture(page, info.project.name + '-recovery-resume');
  await page.unroute('**/api/auth/session');
  await page.unroute('**/api/auth/mfa/recover');
  await page.getByRole('button', { name: 'Resume authenticator setup' }).click();
  await expect(page.getByRole('heading', { name: 'Set up your authenticator' })).toBeVisible();
  expect(patientRequests).toBe(0);
  await pool.query(
    "UPDATE staff_sessions SET restricted_expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",
    [user.id],
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toBeVisible();
  await expect(page.locator('[data-private]')).toHaveCount(0);
  await capture(page, info.project.name + '-expired');
});

test('maintenance loading failure and interrupted committed regeneration recover safely', async ({
  page,
}, info) => {
  const hospitalCode = 'mfa-' + randomUUID().slice(0, 8),
    password = randomBytes(24).toString('hex'),
    grant = randomBytes(32).toString('base64url');
  const user = await provisionStaff(pool, {
    hospitalCode,
    hospitalName: 'Synthetic MFA hospital',
    username: 'staff',
    displayName: 'Synthetic staff',
    role: 'admin',
    password,
  });
  const hospital = (await pool.query('SELECT hospital_id FROM staff_users WHERE id=$1', [user.id]))
    .rows[0].hospital_id;
  await pool.query(
    "INSERT INTO staff_mfa_grants(hospital_id,user_id,grant_hash,expires_at) VALUES ($1,$2,$3,clock_timestamp()+interval '30 minutes')",
    [hospital, user.id, digest(grant)],
  );
  let patientRequests = 0;
  page.on('request', (r) => {
    if (r.url().includes('/api/patients')) patientRequests++;
  });
  const signIn = async () => {
    await page.goto('/staff/patients');
    await page.getByLabel('Hospital code', { exact: true }).fill(hospitalCode);
    await page.getByLabel('Username', { exact: true }).fill('staff');
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Password', { exact: true }).press('Enter');
  };
  await signIn();
  await expect(page.getByRole('heading', { name: 'Set up staff sign-in' })).toBeFocused();
  expect(patientRequests).toBe(0);
  await capture(page, info.project.name + '-grant');
  await page.getByLabel('Enrollment grant').fill(grant);
  await page.getByLabel('Enrollment grant').press('Enter');
  await expect(page.getByRole('heading', { name: 'Set up your authenticator' })).toBeFocused();
  const secret = await page.locator('.mfa-secret code').textContent();
  if (!secret) throw Error('Missing setup');
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.map(({ id, impact }) => ({ id, impact })),
  ).toEqual([]);
  await capture(page, info.project.name + '-setup');
  let releasePoll!: () => void, pollReady!: () => void;
  const pollGate = new Promise<void>((resolve) => {
      releasePoll = resolve;
    }),
    pollStarted = new Promise<void>((resolve) => {
      pollReady = resolve;
    });
  await page.route('**/api/auth/session', async (route) => {
    const headers = await route.request().allHeaders();
    pollReady();
    await pollGate;
    const response = await route.fetch({ headers });
    expect(response.status()).toBe(401);
    expect(response.headers()['set-cookie']).toBeUndefined();
    await route.fulfill({ response });
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await pollStarted;
  await page.getByLabel('Authenticator code', { exact: true }).fill(totp(secret).generate());
  await page.getByLabel('Authenticator code', { exact: true }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
  const stalePollFinished = page.waitForResponse((r) => r.url().endsWith('/api/auth/session'));
  releasePoll();
  await stalePollFinished;
  await page.unroute('**/api/auth/session');
  await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
  expect((await page.request.get('/api/auth/session')).status()).toBe(200);

  const recovery = await page.locator('.mfa-codes code').first().textContent();
  if (!recovery) throw Error('Missing recovery');
  expect(patientRequests).toBe(0);
  await capture(page, info.project.name + '-codes');
  await page.getByRole('button', { name: 'Continue to workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Patient directory' })).toBeVisible();
  const freshProof = async () => {
    await pool.query('UPDATE staff_factors SET last_counter=-1 WHERE user_id=$1', [user.id]);
  };
  await page.route('**/api/auth/mfa/status', (route) => route.abort());
  await page.getByRole('link', { name: 'Authenticator security', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry loading setup' })).toBeVisible();
  await capture(page, info.project.name + '-uncertain-maintenance-load-error');
  await page.unroute('**/api/auth/mfa/status');
  await page.getByRole('button', { name: 'Retry loading setup' }).click();
  await expect(page.getByLabel('Current password', { exact: true })).toBeVisible();
  await freshProof();
  await page.getByLabel('Current password', { exact: true }).fill(password);
  await page.getByLabel('Authenticator code', { exact: true }).fill(totp(secret).generate());
  await page.route('**/api/auth/mfa/regenerate', async (route) => {
    await route.fetch();
    await route.abort();
  });
  await page.getByRole('button', { name: 'Generate new recovery codes' }).click();
  await expect(page.getByRole('alert')).toContainText('The result could not be confirmed');
  await capture(page, info.project.name + '-uncertain-maintenance-uncertain');
  await page.unroute('**/api/auth/mfa/regenerate');
  await page.route('**/api/auth/session', (route) => route.abort());
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry sign-out' })).toBeVisible();
  await page.unroute('**/api/auth/session');
  let crossFamilyPosts = 0;
  await page.route('**/api/auth/logout', async (route) => {
    crossFamilyPosts++;
    await route.continue();
  });
  await page.route('**/api/auth/session', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, sessionFamily: randomUUID() } });
  });
  await page.getByRole('button', { name: 'Retry sign-out' }).click();
  await expect(page.getByRole('button', { name: 'Retry sign-out' })).toBeEnabled();
  expect(crossFamilyPosts).toBe(1);
  await page.unroute('**/api/auth/session');
  await page.unroute('**/api/auth/logout');
  await page.getByRole('button', { name: 'Retry sign-out' }).click();
  await expect(page.getByRole('button', { name: 'Retry sign-out' })).toHaveCount(0);
  await signIn();
  await freshProof();
  await page.getByLabel('Authenticator code', { exact: true }).fill(totp(secret).generate());
  await page.getByRole('button', { name: 'Verify code' }).click();
  await expect(page.getByRole('heading', { name: 'Patient directory' })).toBeVisible();
  await page.getByRole('link', { name: 'Authenticator security', exact: true }).click();
  await freshProof();
  await page.getByLabel('Current password', { exact: true }).fill(password);
  await page.getByLabel('Authenticator code', { exact: true }).fill(totp(secret).generate());
  await page.getByRole('button', { name: 'Generate new recovery codes' }).click();
  await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
  const recoveredCodes = await page.locator('.mfa-codes code').first().textContent();
  if (!recoveredCodes) throw Error('Missing recovered codes');
  await page.getByRole('button', { name: 'Continue to workspace' }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn();
  await page.getByRole('button', { name: 'Use a recovery code' }).click();
  await page.getByLabel('Recovery code', { exact: true }).fill(recovery);
  await page.getByRole('button', { name: 'Recover and replace authenticator' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel('Recovery code', { exact: true }).fill(recoveredCodes);
  await page.getByRole('button', { name: 'Recover and replace authenticator' }).click();
  await expect(page.getByRole('heading', { name: 'Set up your authenticator' })).toBeVisible();
  await capture(page, info.project.name + '-regenerated-code-recovery');
});
