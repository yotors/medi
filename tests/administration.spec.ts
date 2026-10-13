import { test, expect, type Page, type Dialog } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomBytes, randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { mkdir } from 'node:fs/promises';
import { createPool } from '../server/db';
import { prepareBrowserFixture } from './browser-fixture';
import { provisionStaff } from '../server/setup';
try { loadEnvFile('.env'); } catch { /* CI supplies environment. */ }
// Automatic DOM/error snapshots can expose the intentionally visible temporary credential.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
test.use({ screenshot: 'off' });
test.setTimeout(90000);
const pool = createPool(); const hospitalCode = `admin-browser-${randomUUID().slice(0, 8)}`;
const password = randomBytes(24).toString('hex');
test.beforeAll(async () => {
  await prepareBrowserFixture(pool);
  await provisionStaff(pool, { hospitalCode, hospitalName: 'Fictional Staff Hospital', username: 'admin', displayName: 'Fictional Administrator', role: 'admin', password });
  await provisionStaff(pool, { hospitalCode, hospitalName: 'Fictional Staff Hospital', username: 'review2-admin', displayName: 'Fictional Review Administrator', role: 'admin', password });
});
test.afterAll(async () => { await pool.end(); });
async function signIn(page: Page, username = 'admin', value = password) {
  await page.goto('/staff'); await page.getByLabel('Hospital code', { exact: true }).fill(hospitalCode);
  await page.getByLabel('Username', { exact: true }).fill(username); await page.getByLabel('Password', { exact: true }).fill(value);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
async function createDraft(page: Page, username: string) {
  await page.getByRole('button', { name: 'Staff administration', exact: true }).click();
  await page.getByRole('button', { name: 'Create staff account', exact: true }).click();
  await page.getByLabel('Staff display name').fill(`Fictional ${username}`); await page.getByLabel('Staff username').fill(username);
  await page.getByLabel('Role', { exact: true }).selectOption('clinician');
  await page.getByLabel('Your current password').fill(password); await page.getByRole('checkbox', { name: 'Create this named account' }).check();
}
test('review2: keyboard create and back restore focus and a role-only draft is guarded', async ({ page }) => {
  await signIn(page, 'review2-admin');
  await page.getByRole('button', { name: 'Staff administration', exact: true }).click();
  await page.getByRole('button', { name: 'Create staff account', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Create staff account', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.getByLabel('Staff display name')).toBeFocused();
  await page.getByLabel('Role', { exact: true }).selectOption('clinician');
  let prompted = false;
  page.once('dialog', async dialog => { prompted = true; await dialog.dismiss(); });
  await page.getByRole('button', { name: 'Back to staff directory' }).focus(); await page.keyboard.press('Enter');
  expect(prompted).toBe(true); await expect(page.getByLabel('Role', { exact: true })).toHaveValue('clinician');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Back to staff directory' }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Staff administration', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: 'Create staff account', exact: true })).toBeFocused();
});

test('review2: a reset with a lost response clears the obsolete displayed credential and retains its retry', async ({ page }) => {
  await signIn(page, 'review2-admin'); await createDraft(page, 'reset-review2');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  const previous = await page.getByLabel('Temporary password', { exact: true }).inputValue();
  await page.getByRole('checkbox', { name: 'Reset password with' }).check(); await page.getByLabel('Your current password').fill(password); await page.getByRole('checkbox', { name: 'Reset this account' }).check();
  let original = ''; let originalKey = ''; let replacement = ''; let first = true;
  await page.route('**/api/staff/commands', async route => {
    if (first) {
      first = false; original = route.request().postData()!; originalKey = route.request().headers()['idempotency-key']; replacement = JSON.parse(original).command.temporaryPassword;
      expect((await route.fetch()).status()).toBe(200); await route.abort('failed');
    } else {
      expect(route.request().postData() === original).toBe(true); expect(route.request().headers()['idempotency-key']).toBe(originalKey); await route.continue();
    }
  });
  await page.getByRole('button', { name: 'Reset credential', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry account save' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByLabel('Temporary password', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Patient directory', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry account save' }).click();
  await expect(page.getByLabel('Temporary password', { exact: true })).toBeVisible({ timeout: 15000 });
  expect((await page.getByLabel('Temporary password', { exact: true }).inputValue()) === replacement).toBe(true); expect(replacement !== previous).toBe(true);
  await expect(page.getByText('Credential reset', { exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'I have shared it' }).click();
});
test('keyboard onboarding, temporary password replacement, access management and history', async ({ page }, info) => {
  await signIn(page); await createDraft(page, 'new-clinician');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Create account', exact: true }).focus(); await page.keyboard.press('Enter');
  const temporary = await page.getByLabel('Temporary password', { exact: true }).inputValue(); expect(/^[A-Za-z0-9_-]{43}$/.test(temporary)).toBe(true);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]); expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
  await page.getByRole('button', { name: 'I have shared it' }).click();
  await expect(page.getByText('Account created', { exact: true })).toBeVisible();
  await mkdir('artifacts/staff-ui', { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `artifacts/staff-ui/${info.project.name}-staff-account.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Back to staff directory' }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `artifacts/staff-ui/${info.project.name}-staff-directory.png`, fullPage: true });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page, 'new-clinician', temporary);
  await expect(page.getByRole('heading', { name: 'Change password', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Patient directory', exact: true })).toHaveCount(0);
  expect((await page.request.get('/api/patients')).status()).toBe(403);
  await page.getByLabel('Current password', { exact: true }).fill(temporary);
  await page.getByLabel('New password', { exact: true }).fill(password);
  await page.getByLabel('Confirm new password').fill('different password');
  await page.getByRole('button', { name: 'Change password and sign out' }).click(); await expect(page.getByRole('alert')).toContainText('do not match');
  await page.getByLabel('Confirm new password').fill(password);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  // Capture empty password fields so exported screenshots never contain credentials.
  await page.getByLabel('Current password', { exact: true }).fill(''); await page.getByLabel('New password', { exact: true }).fill(''); await page.getByLabel('Confirm new password').fill('');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `artifacts/staff-ui/${info.project.name}-password-change.png`, fullPage: true });
  await page.getByLabel('Current password', { exact: true }).fill(temporary); await page.getByLabel('New password', { exact: true }).fill(password); await page.getByLabel('Confirm new password').fill(password);
  await page.getByRole('button', { name: 'Change password and sign out' }).click(); await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toBeVisible();
  await signIn(page, 'new-clinician'); await expect(page.getByRole('heading', { name: 'Patient directory', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Staff administration' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await signIn(page);
  await page.getByRole('button', { name: 'Staff administration', exact: true }).click(); await page.getByRole('button', { name: 'Fictional new-clinician', exact: true }).click();
  await page.getByLabel('Active account', { exact: true }).uncheck(); await page.getByLabel('Your current password').fill(password); await page.getByRole('checkbox', { name: 'Apply this role' }).check();
  await page.getByRole('button', { name: 'Save account', exact: true }).click(); await expect(page.getByText('Access updated', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Active account', { exact: true })).not.toBeChecked();
  await page.getByLabel('Active account', { exact: true }).check(); await page.getByLabel('Role', { exact: true }).selectOption('lab');
  await page.getByLabel('Your current password').fill(password); await page.getByRole('checkbox', { name: 'Apply this role' }).check();
  await page.getByRole('button', { name: 'Save account', exact: true }).click(); await expect(page.getByText('Access updated', { exact: true })).toHaveCount(2);
  await page.getByRole('checkbox', { name: 'Reset password with' }).check(); await page.getByLabel('Your current password').fill(password); await page.getByRole('checkbox', { name: 'Reset this account' }).check();
  await page.getByRole('button', { name: 'Reset credential', exact: true }).click(); await expect(page.getByText('Credential reset', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Temporary password', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'I have shared it' }).click();
});
test('lost command response retries once, failed load recovers and dirty draft blocks navigation', async ({ page }) => {
  await signIn(page);
  let fail = true; await page.route(/\/api\/staff\?/, async route => { if (fail) { await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Staff temporarily unavailable' }) }); } else await route.continue(); });
  await page.getByRole('button', { name: 'Staff administration', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
  fail = false; await page.getByRole('button', { name: 'Retry staff directory' }).click(); await expect(page.getByRole('button', { name: 'Fictional Administrator', exact: true })).toBeVisible();
  await createDraft(page, 'retry-clinician');
  page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('button', { name: 'Patient directory', exact: true }).click(); await expect(page.getByLabel('Staff username')).toHaveValue('retry-clinician');
  let lose = true; let original = ''; let originalKey = '';
  await page.route('**/api/staff/commands', async route => {
    if (lose) { lose = false; original = route.request().postData()!; originalKey = route.request().headers()['idempotency-key']; await route.fetch(); await route.abort('failed'); }
    else { expect(route.request().postData() === original).toBe(true); expect(route.request().headers()['idempotency-key']).toBe(originalKey); await route.continue(); }
  });
  await page.getByRole('button', { name: 'Create account', exact: true }).click(); await expect(page.getByRole('button', { name: 'Retry account save' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Patient directory', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry account save' }).click(); await expect(page.getByLabel('Temporary password', { exact: true })).toBeVisible();
  await expect(page.getByText('Account created', { exact: true })).toHaveCount(1);
  const { rows: [count] } = await pool.query('SELECT count(*)::integer AS count FROM staff_users u JOIN hospitals h ON h.id=u.hospital_id WHERE h.code=$1 AND u.username=$2', [hospitalCode, 'retry-clinician']); expect(count.count).toBe(1);
  await pool.query('DELETE FROM staff_sessions WHERE user_id IN (SELECT u.id FROM staff_users u JOIN hospitals h ON h.id=u.hospital_id WHERE h.code=$1 AND u.username=$2)', [hospitalCode, 'admin']);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toBeVisible(); await expect(page.getByLabel('Temporary password', { exact: true })).toHaveCount(0);
});

test('stale revision keeps the editable draft until current details are reviewed', async ({ page }) => {
  await signIn(page); await createDraft(page, 'conflict-clinician'); await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('button', { name: 'I have shared it' }).click();
  await page.getByLabel('Role', { exact: true }).selectOption('pharmacist');
  await pool.query('UPDATE staff_users SET revision=revision+1 WHERE hospital_id=(SELECT id FROM hospitals WHERE code=$1) AND username=$2', [hospitalCode, 'conflict-clinician']);
  await page.getByLabel('Your current password').fill(password); await page.getByRole('checkbox', { name: 'Apply this role' }).check();
  await page.getByRole('button', { name: 'Save account', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('account changed');
  await expect(page.getByLabel('Role', { exact: true })).toHaveValue('pharmacist'); await expect(page.getByLabel('Role', { exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Reload current revision' }).click(); await expect(page.getByRole('alert')).toContainText('Review your retained draft');
  await page.getByRole('checkbox', { name: 'Apply this role' }).check(); await page.getByRole('button', { name: 'Save account', exact: true }).click();
  await expect(page.getByText('Access updated', { exact: true })).toBeVisible(); await expect(page.getByLabel('Role', { exact: true })).toHaveValue('pharmacist');
});

async function assertSameSurfaceNoDialog(page: Page, label: string) {
  let dialogs = 0;
  const handler = (dialog: Dialog) => { dialogs++; void dialog.accept(); };
  page.on('dialog', handler);
  await page.getByRole('button', { name: label, exact: true }).click();
  page.off('dialog', handler);
  expect(dialogs).toBe(0);
}

test('review: same visit navigation retains dirty guard and generic navigation never repeats check-in', async ({ page }) => {
  await signIn(page); const name = `Navigation Fiction ${randomUUID().slice(0, 8)}`;
  let checkIns = 0;
  page.on('request', request => { if (request.method() === 'POST' && /\/api\/patients\/[^/]+\/visits$/.test(request.url())) checkIns++; });
  await page.getByRole('button', { name: 'Register patient', exact: true }).click();
  await page.getByLabel('Full name').fill(name); await page.getByRole('button', { name: 'Save patient', exact: true }).click();
  await page.getByRole('row').filter({ hasText: name }).getByRole('button', { name: /Check in/ }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await page.getByLabel('Consultation note', { exact: true }).fill('Unsaved navigation regression note.');
  await assertSameSurfaceNoDialog(page, 'Outpatient visits');
  await expect(page.getByLabel('Consultation note', { exact: true })).toHaveValue('Unsaved navigation regression note.');
  const rejected = page.waitForEvent('dialog'); const leave = page.getByRole('button', { name: 'Staff administration', exact: true }).click();
  await (await rejected).dismiss(); await leave;
  await expect(page.getByLabel('Consultation note', { exact: true })).toHaveValue('Unsaved navigation regression note.');
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Staff administration', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Staff administration', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Outpatient visits', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Outpatient visits', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible(); expect(checkIns).toBe(1);
});

test('review: same staff and password surfaces preserve dirty navigation protection', async ({ page }) => {
  await signIn(page); await createDraft(page, 'dirty-review');
  await assertSameSurfaceNoDialog(page, 'Staff administration');
  const rejected = page.waitForEvent('dialog'); const leave = page.getByRole('button', { name: 'Patient directory', exact: true }).click();
  await (await rejected).dismiss(); await leave; await expect(page.getByLabel('Staff username')).toHaveValue('dirty-review');
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Change password', exact: true }).click();
  await page.getByLabel('Current password', { exact: true }).fill('fictional-dirty-current');
  await assertSameSurfaceNoDialog(page, 'Change password');
  const passwordRejected = page.waitForEvent('dialog'); const passwordLeave = page.getByRole('button', { name: 'Patient directory', exact: true }).click();
  await (await passwordRejected).dismiss(); await passwordLeave;
  await expect(page.getByLabel('Current password', { exact: true })).not.toHaveValue('');
});

for (const initialCommitted of [true, false]) {
  test(`review: uncertain command survives throttling and corrected reauthentication, committed=${initialCommitted}`, async ({ page }) => {
    await signIn(page); await createDraft(page, `uncertain-${initialCommitted}`);
    if (!initialCommitted) await page.getByLabel('Your current password').fill('incorrect synthetic password');
    let attempts = 0; let originalCommand = ''; let originalKey = ''; let originalTemporary = '';
    await page.route('**/api/staff/commands', async route => {
      attempts++;
      const body = route.request().postDataJSON();
      if (attempts === 1) {
        originalCommand = JSON.stringify(body.command); originalKey = route.request().headers()['idempotency-key']; originalTemporary = body.command.temporaryPassword;
        const response = await route.fetch(); expect(response.status()).toBe(initialCommitted ? 201 : 403); await route.abort('failed'); return;
      }
      expect(JSON.stringify(body.command) === originalCommand).toBe(true); expect(route.request().headers()['idempotency-key']).toBe(originalKey);
      if (attempts === 2) { await route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ code: 'RATE_LIMITED', message: 'Verification temporarily unavailable.' }) }); return; }
      await route.continue();
    });
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retry account save' })).toBeVisible();
    await page.getByRole('button', { name: 'Retry account save' }).click(); await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
    await expect(page.getByLabel('Staff username')).toBeDisabled(); await expect(page.getByRole('button', { name: 'Patient directory', exact: true })).toBeDisabled();
    await page.getByLabel('Your current password').fill('incorrect synthetic password');
    await page.getByRole('button', { name: 'Retry account save' }).click(); await expect(page.getByRole('alert')).toContainText('not accepted');
    await expect(page.getByRole('button', { name: 'Retry account save' })).toBeVisible(); await expect(page.getByLabel('Staff username')).toBeDisabled();
    await expect(page.getByLabel('Your current password')).toBeEnabled(); await page.getByLabel('Your current password').fill(password);
    await page.getByRole('button', { name: 'Retry account save' }).click();
    const delivered = await page.getByLabel('Temporary password', { exact: true }).inputValue(); expect(delivered === originalTemporary).toBe(true);
    await expect(page.getByText('Account created', { exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: 'I have shared it' }).click();
  });
}

test('review: definitive self-password rejection releases fields after an uncertain response', async ({ page }) => {
  await signIn(page); await page.getByRole('button', { name: 'Change password', exact: true }).click();
  await page.getByLabel('Current password', { exact: true }).fill('incorrect synthetic password');
  await page.getByLabel('New password', { exact: true }).fill('Synthetic replacement password'); await page.getByLabel('Confirm new password').fill('Synthetic replacement password');
  let lost = false;
  await page.route('**/api/auth/password', async route => {
    if (!lost) { lost = true; const response = await route.fetch(); expect(response.status()).toBe(403); await route.abort('failed'); }
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Change password and sign out' }).click();
  await expect(page.getByLabel('Current password', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry password change' }).click(); await expect(page.getByRole('alert')).toContainText('not accepted');
  await expect(page.getByLabel('Current password', { exact: true })).toBeEnabled(); await expect(page.getByLabel('New password', { exact: true })).toBeEnabled();
  await page.getByLabel('Current password', { exact: true }).fill(password);
});

test('review: exact reload and history pagination work beyond the fuzzy first page', async ({ page }, info) => {
  await signIn(page); await createDraft(page, 'paged-review'); await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('button', { name: 'I have shared it' }).click();
  const { rows: [target] } = await pool.query('SELECT id,hospital_id,password_hash FROM staff_users WHERE hospital_id=(SELECT id FROM hospitals WHERE code=$1) AND username=$2', [hospitalCode, 'paged-review']);
  const { rows: [actor] } = await pool.query('SELECT id FROM staff_users WHERE hospital_id=$1 AND username=$2', [target.hospital_id, 'admin']);
  for (let i = 0; i < 30; i++) await pool.query("INSERT INTO staff_users(id,hospital_id,username,display_name,role,password_hash) VALUES ($1,$2,$3,'AAA paged-review match','auditor',$4)", [randomUUID(), target.hospital_id, `paged-review-${i}`, target.password_hash]);
  for (let revision = 2; revision <= 29; revision++) await pool.query("INSERT INTO staff_administration_events(id,hospital_id,actor_id,account_id,action,revision,role,active) VALUES ($1,$2,$3,$4,'staff.updated',$5,'clinician',true)", [randomUUID(), target.hospital_id, actor.id, target.id, revision]);
  await pool.query('UPDATE staff_users SET revision=29 WHERE id=$1', [target.id]);
  await page.getByLabel('Role', { exact: true }).selectOption('pharmacist'); await page.getByLabel('Your current password').fill(password); await page.getByRole('checkbox', { name: 'Apply this role' }).check();
  await page.getByRole('button', { name: 'Save account', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('account changed');
  await page.getByRole('button', { name: 'Reload current revision' }).click(); await expect(page.getByRole('alert')).toContainText('Review your retained draft');
  await expect(page.getByLabel('Role', { exact: true })).toHaveValue('pharmacist');
  const history = page.locator('.staff-account-history'); await expect(history.getByRole('listitem')).toHaveCount(25); await expect(history).toContainText('Fictional Administrator (admin)');
  await history.getByRole('button', { name: 'Next history' }).click(); await expect(history.getByRole('listitem')).toHaveCount(4); await expect(history).toContainText('Page 2 of 2');
  await history.getByRole('button', { name: 'Previous history' }).click(); await expect(history.getByRole('listitem')).toHaveCount(25);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await history.getByRole('button', { name: 'Next history' }).click(); await expect(history.getByRole('listitem')).toHaveCount(4);
  await page.getByLabel('Your current password').fill(''); await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `artifacts/staff-ui/${info.project.name}-staff-history-paged.png`, fullPage: true });
});
