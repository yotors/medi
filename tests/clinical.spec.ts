import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomBytes, randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { mkdir } from 'node:fs/promises';
import { digest } from '../server/auth';
import { createPool } from '../server/db';
import { prepareBrowserFixture } from './browser-fixture';
import { provisionStaff } from '../server/setup';
import type { VisitView, VisitCommand } from '../shared/outpatient';
import type { ClinicalDetail } from '../shared/clinical';
try { loadEnvFile('.env'); } catch { /* CI supplies environment. */ }
const pool = createPool(); const hospitalCode = `clinical-${randomUUID().slice(0, 8)}`;
const password = randomBytes(24).toString('hex'); const origin = 'http://127.0.0.1:5173';
test.beforeAll(async () => {
  test.setTimeout(120000); await prepareBrowserFixture(pool);
  for (const role of ['admin', 'clinician', 'lab'] as const) await provisionStaff(pool, { hospitalCode, hospitalName: 'Clinical Fiction Medical Center', username: role, displayName: `Fictional ${role}`, role, password });
});
test.beforeEach(async () => { await pool.query('DELETE FROM login_buckets WHERE bucket_hash=ANY($1::text[])', [['admin','clinician','lab'].map(role => digest(`account:${hospitalCode}:${role}`))]); });
test.afterAll(async () => { await pool.end(); });
async function signIn(page: Page, role = 'admin') {
  await page.goto('/staff'); await page.getByLabel('Hospital code', { exact: true }).fill(hospitalCode); await page.getByLabel('Username', { exact: true }).fill(role); await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Patient directory', exact: true })).toBeVisible();
}
async function post(page: Page, path: string, data: object) {
  const session = await (await page.request.get('/api/auth/session')).json();
  const response = await page.request.post(path, { headers: { Origin: origin, 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': randomUUID() }, data }); expect(response.ok(), await response.text()).toBe(true); return response.json();
}
async function apply(page: Page, v: VisitView, command: VisitCommand): Promise<VisitView> { return (await post(page, `/api/visits/${v.id}/commands`, { expectedRevision: v.revision, command })).visit; }
async function seed(page: Page, closed = true) {
  const name = `Clinical Fiction ${randomUUID().slice(0,8)}`; const { patient } = await post(page, '/api/patients', { name, contact: '' });
  let v: VisitView = (await post(page, `/api/patients/${patient.id}/visits`, {})).visit;
  v = await apply(page, v, { type: 'note', body: 'Original fictional note.' }); v = await apply(page, v, { type: 'order', test: 'Blood count' }); const orderId = v.orders![0].id;
  v = await apply(page, v, { type: 'advanceOrder', orderId, next: 'collected' }); v = await apply(page, v, { type: 'advanceOrder', orderId, next: 'released', result: 'Original fictional result.' }); v = await apply(page, v, { type: 'advanceOrder', orderId, next: 'reviewed' });
  if (closed) v = await apply(page, v, { type: 'close' });
  await open(page, name, closed ? 'closed' : 'active'); return { v, name, orderId, noteId: v.notes![0].id };
}
async function open(page: Page, name: string, status: string) {
  await page.getByRole('navigation', { name: 'Staff workspace' }).getByRole('button', { name: 'Outpatient visits', exact: true }).click(); await page.getByLabel('Visit status', { exact: true }).selectOption(status); await page.getByRole('button', { name, exact: true }).click();
}
async function section(page: Page, name: string) { await page.getByRole('navigation', { name: 'Visit sections' }).getByRole('button', { name, exact: true }).click(); }
async function amend(page: Page) {
  await page.getByRole('button', { name: 'Amend note 1', exact: true }).click(); await page.getByLabel('Amended note text', { exact: true }).fill('Corrected fictional note.'); await page.getByLabel('Reason for correction', { exact: true }).fill('Fictional transcription correction.');
}
async function correct(page: Page, owner = 'Fictional admin') {
  await section(page, 'Diagnostics'); await page.getByRole('button', { name: 'Correct Blood count result', exact: true }).click(); await page.getByLabel('Corrected result text', { exact: true }).fill('Corrected fictional result.'); await page.getByLabel('Reason for correction', { exact: true }).fill('Fictional corrected value.'); await page.getByLabel('Assign correction reviewer', { exact: true }).selectOption({ label: `${owner} · @${owner.replace('Fictional ', '')} · ${owner.replace('Fictional ', '')}` });
}
async function detail(page: Page, id: string): Promise<ClinicalDetail> { return (await page.request.get(`/api/visits/${id}/clinical`)).json(); }

async function captureClinical(page: Page, path: string) {
  await mkdir('artifacts/clinical-ui', { recursive: true });
  await page.getByRole('heading', { level: 1 }).evaluate(heading => (heading as HTMLElement).focus({ preventScroll: true }));
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await page.screenshot({ path, fullPage: true });
}

test('closed note amendment and corrected result stay discoverable until assigned review; keyboard and accessible layouts', async ({ page }, info) => {
  await signIn(page); const { v, name } = await seed(page); await amend(page);
  await page.getByRole('button', { name: 'Save note amendment', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Note amendment saved.' })).toBeVisible(); await expect(page.getByText('Original fictional note.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Latest amended note', exact: true })).toBeVisible();
  await correct(page); await page.getByRole('button', { name: 'Save result correction', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Latest corrected result', exact: true })).toBeVisible(); await expect(page.getByText('Original fictional result.', { exact: true })).toBeVisible();
  await expect(page.getByText('This correction still needs acknowledgement. The visit remains closed; this follow-up stays outstanding.', { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]); expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await captureClinical(page, `artifacts/clinical-ui/${info.project.name}-pending.png`);
  await page.getByRole('button', { name: 'Back to visit queue', exact: true }).click(); await page.getByLabel('Visit status', { exact: true }).selectOption('corrections'); await page.getByRole('button', { name, exact: true }).click();
  await section(page, 'Diagnostics'); await page.getByRole('button', { name: 'Acknowledge Blood count correction', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('article', { name: 'Blood count corrections' }).locator('.badge').filter({ hasText: /^Correction reviewed$/ })).toBeVisible(); expect((await detail(page, v.id)).pendingReviews).toBe(0);
  await page.getByText('View amendment and review history (2)', { exact: true }).click(); expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await captureClinical(page, `artifacts/clinical-ui/${info.project.name}-reviewed.png`);
  const saved = (await (await page.request.get(`/api/visits/${v.id}`)).json()).visit; expect(saved.revision).toBe(v.revision); expect(saved.status).toBe('closed'); expect(saved.orders[0].result).toBe('Original fictional result.');
});

test('lost correction response preserves exact payload and draft while navigation remains blocked', async ({ page }) => {
  await signIn(page); const { v } = await seed(page); await correct(page); const submissions: { key?: string; body: string | null }[] = []; let lose = true;
  await page.route('**/api/visits/*/clinical/commands', async route => { submissions.push({ key: route.request().headers()['idempotency-key'], body: route.request().postData() }); const response = await route.fetch(); expect(response.ok()).toBe(true); if (lose) { lose = false; await route.abort('failed'); } else await route.fulfill({ response }); });
  await page.getByRole('button', { name: 'Save result correction', exact: true }).click(); await expect(page.getByRole('button', { name: 'Retry clinical save', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Corrected result text', { exact: true })).toHaveValue('Corrected fictional result.'); await expect(page.getByLabel('Corrected result text', { exact: true })).toBeDisabled();
  for (const label of ['Sign out','Back to visit queue','Refresh visit']) await expect(page.getByRole('button', { name: label, exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry clinical save', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Latest corrected result', exact: true })).toBeVisible();
  expect(submissions).toHaveLength(2); expect(submissions[0]).toEqual(submissions[1]); expect((await detail(page, v.id)).records[0].version).toBe(1);
});

test('stale amendment retains draft and requires explicit latest-version review', async ({ page }, info) => {
  await signIn(page); const { v, noteId } = await seed(page); await amend(page);
  await post(page, `/api/visits/${v.id}/clinical/commands`, { type: 'note.amend', subjectId: noteId, expectedVersion: 0, body: 'Concurrent fictional amendment.', reason: 'Other synthetic author.' });
  await page.getByRole('button', { name: 'Save note amendment', exact: true }).click(); await expect(page.getByRole('button', { name: 'Use latest clinical version', exact: true })).toBeVisible();
  await expect(page.getByLabel('Amended note text', { exact: true })).toHaveValue('Corrected fictional note.'); await expect(page.getByRole('button', { name: 'Save note amendment', exact: true })).toBeDisabled();
  await expect(page.getByText('Concurrent fictional amendment.', { exact: true }).first()).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]); await captureClinical(page, `artifacts/clinical-ui/${info.project.name}-draft.png`);
  await page.getByRole('button', { name: 'Use latest clinical version', exact: true }).click(); await page.getByRole('button', { name: 'Save note amendment', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Note amendment saved.' })).toBeVisible(); expect((await detail(page, v.id)).records[0].version).toBe(2);
});

test('unavailable reviewer can be explicitly taken over and pending correction blocks active closure', async ({ page }) => {
  await signIn(page); const { v } = await seed(page, false); await correct(page, 'Fictional clinician'); await page.getByRole('button', { name: 'Save result correction', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Take over Blood count review', exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Close visit', exact: true })).toBeDisabled();
  const ownerId = (await detail(page, v.id)).records[0].review!.ownerId; await pool.query('UPDATE staff_users SET active=false WHERE id=$1', [ownerId]);
  try {
    await page.getByRole('button', { name: 'Refresh visit', exact: true }).click(); await expect(page.getByText(/Unavailable — another clinician must take over/)).toBeVisible();
    await page.getByRole('button', { name: 'Take over Blood count review', exact: true }).click(); await expect(page.getByRole('button', { name: 'Take responsibility', exact: true })).toBeDisabled();
    await page.getByLabel('Reason for taking over', { exact: true }).fill('Fictional shift handover.'); await page.getByRole('button', { name: 'Take responsibility', exact: true }).click();
    await page.getByRole('button', { name: 'Acknowledge Blood count correction', exact: true }).click(); await expect(page.getByRole('button', { name: 'Close visit', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Close visit', exact: true }).click(); await expect(page.getByText(/Clinical visit closed/)).toBeVisible();
  } finally { await pool.query('UPDATE staff_users SET active=true WHERE id=$1', [ownerId]); }
});

test('reviewer loading failure has recovery and unsaved draft survives tab navigation', async ({ page }) => {
  await signIn(page); await page.route('**/api/clinical/reviewers', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic read outage' }) }));
  await seed(page); await section(page, 'Diagnostics'); await page.getByRole('button', { name: 'Correct Blood count result', exact: true }).click();
  await page.getByLabel('Corrected result text', { exact: true }).fill('Preserved fictional draft.'); await page.getByLabel('Reason for correction', { exact: true }).fill('Preserved reason.');
  await expect(page.getByText('Reviewers could not be loaded. Retry before saving a correction.')).toBeVisible(); await expect(page.getByRole('button', { name: 'Save result correction', exact: true })).toBeDisabled();
  await section(page, 'Consultation'); await section(page, 'Diagnostics'); await expect(page.getByLabel('Corrected result text', { exact: true })).toHaveValue('Preserved fictional draft.');
  await page.unroute('**/api/clinical/reviewers'); await page.getByRole('button', { name: 'Refresh reviewers', exact: true }).click(); await page.getByLabel('Assign correction reviewer', { exact: true }).selectOption({ label: 'Fictional admin · @admin · admin' });
  await page.getByRole('button', { name: 'Save result correction', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Latest corrected result', exact: true })).toBeVisible();
});

test('laboratory correction reaches assigned clinician in separate sessions with role-specific controls', async ({ page, browser }, info) => {
  await signIn(page); const { v, name } = await seed(page);
  const labContext = await browser.newContext({ baseURL: origin }); const clinicianContext = await browser.newContext({ baseURL: origin });
  try {
    const lab = await labContext.newPage(); await signIn(lab, 'lab'); await open(lab, name, 'closed');
    await expect(lab.getByRole('button', { name: 'Amend note 1', exact: true })).toHaveCount(0);
    await correct(lab, 'Fictional clinician'); await lab.getByRole('button', { name: 'Save result correction', exact: true }).click();
    await expect(lab.getByRole('heading', { name: 'Latest corrected result', exact: true })).toBeVisible();
    await expect(lab.getByRole('button', { name: /Acknowledge Blood count|Take over Blood count/ })).toHaveCount(0);
    const clinician = await clinicianContext.newPage(); await signIn(clinician, 'clinician');
    await clinician.getByRole('navigation', { name: 'Staff workspace' }).getByRole('button', { name: 'Outpatient visits', exact: true }).click();
    await clinician.getByLabel('Visit status', { exact: true }).selectOption('corrections'); await clinician.getByLabel('Review assignment', { exact: true }).selectOption('me');
    await expect(clinician.getByRole('row').filter({ hasText: name })).toContainText('@clinician'); await clinician.getByRole('button', { name, exact: true }).click(); await section(clinician, 'Diagnostics');
    await expect(clinician.getByRole('button', { name: 'Correct Blood count result', exact: true })).toHaveCount(0);
    await clinician.getByRole('button', { name: 'Read latest Blood count correction', exact: true }).click(); await expect(clinician.locator('[id^="result-correction-subject-"]')).toBeFocused();
    await expect(clinician.getByText('This original result has been corrected.', { exact: false })).toBeVisible();
    await captureClinical(clinician, `artifacts/clinical-ui/${info.project.name}-clinician-handoff.png`);
    await clinician.getByRole('button', { name: 'Acknowledge Blood count correction', exact: true }).click(); await expect(clinician.getByRole('status').filter({ hasText: 'Corrected result reviewed.' })).toBeVisible(); expect((await detail(clinician, v.id)).pendingReviews).toBe(0);
    await clinician.getByRole('button', { name: 'Back to visit queue', exact: true }).click(); await expect(clinician.getByText('No corrected results are currently assigned to you.', { exact: true })).toBeVisible();
  } finally { await labContext.close(); await clinicianContext.close(); }
});

test('paged subject history reaches earliest immutable amendment while current text remains latest', async ({ page }, info) => {
  test.setTimeout(90000); await signIn(page); const { v, noteId } = await seed(page);
  for (let version = 0; version < 27; version++) await post(page, `/api/visits/${v.id}/clinical/commands`, { type: 'note.amend', subjectId: noteId, expectedVersion: version, body: `Fictional history entry ${version}`, reason: 'Fictional history verification.' });
  await page.getByRole('button', { name: 'Refresh visit', exact: true }).click(); await page.getByRole('button', { name: 'Read latest amendment for note 1', exact: true }).click(); await expect(page.locator('[id^="note-amendment-subject-"]')).toBeFocused();
  await page.getByText('View amendment and review history (27)', { exact: true }).click(); const history = page.getByRole('region', { name: 'Clinical history pages', exact: true });
  await expect(history.getByText('27 events · Page 1 of 2', { exact: true })).toBeVisible(); await history.getByRole('button', { name: 'Next clinical history', exact: true }).click();
  await expect(history.getByText('27 events · Page 2 of 2', { exact: true })).toBeVisible(); await expect(history.getByText('Fictional history entry 0', { exact: true })).toBeVisible();
  await expect(page.getByText('Fictional history entry 26', { exact: true })).toBeVisible(); await expect(page.getByText('Original note — amended.', { exact: false })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]); await captureClinical(page, `artifacts/clinical-ui/${info.project.name}-original-amendment.png`);
  await history.getByRole('button', { name: 'Previous clinical history', exact: true }).click(); await expect(history.getByText('27 events · Page 1 of 2', { exact: true })).toBeVisible();
});

test('new correction clears an older review success notice and empty reviewer list explains recovery', async ({ page }) => {
  await signIn(page); const { v, orderId } = await seed(page); await correct(page); await page.getByRole('button', { name: 'Save result correction', exact: true }).click();
  await page.getByRole('button', { name: 'Acknowledge Blood count correction', exact: true }).click(); await expect(page.getByRole('status').filter({ hasText: 'Corrected result reviewed.' })).toBeVisible();
  const session = await (await page.request.get('/api/auth/session')).json();
  await post(page, `/api/visits/${v.id}/clinical/commands`, { type: 'result.correct', subjectId: orderId, expectedVersion: 2, body: 'New fictional correction.', reason: 'New value.', ownerId: session.user.id });
  await page.getByRole('button', { name: 'Refresh visit', exact: true }).click(); await expect(page.getByText('New fictional correction.', { exact: true })).toBeVisible(); await expect(page.getByRole('status').filter({ hasText: 'Corrected result reviewed.' })).toHaveCount(0);
  await page.route('**/api/clinical/reviewers', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reviewers: [] }) }));
  await page.getByRole('button', { name: 'Correct Blood count result', exact: true }).click(); await page.getByRole('button', { name: 'Refresh reviewers', exact: true }).click();
  await expect(page.getByText(/No eligible reviewers are available/)).toBeVisible(); await expect(page.getByRole('button', { name: 'Save result correction', exact: true })).toBeDisabled();
  await page.unroute('**/api/clinical/reviewers'); await page.getByRole('button', { name: 'Refresh reviewers', exact: true }).click(); await expect(page.getByLabel('Assign correction reviewer').getByRole('option', { name: 'Fictional admin · @admin · admin', exact: true })).toHaveCount(1);
});

test('duplicate reviewer display names expose username and role in the actual selection control', async ({ page }) => {
  await signIn(page); const { name } = await seed(page); const session = await (await page.request.get('/api/auth/session')).json();
  await pool.query("UPDATE staff_users SET display_name='Shared fictional name' WHERE hospital_id=$1 AND role IN ('admin','clinician')", [session.user.hospital.id]);
  try {
    await page.getByRole('button', { name: 'Back to visit queue', exact: true }).click(); await page.getByRole('button', { name, exact: true }).click(); await section(page, 'Diagnostics');
    await page.getByRole('button', { name: 'Correct Blood count result', exact: true }).click();
    const choices = page.getByLabel('Assign correction reviewer', { exact: true });
    await expect(choices.getByRole('option', { name: 'Shared fictional name · @admin · admin', exact: true })).toHaveCount(1); await expect(choices.getByRole('option', { name: 'Shared fictional name · @clinician · clinician', exact: true })).toHaveCount(1);
    await choices.selectOption({ label: 'Shared fictional name · @clinician · clinician' }); await page.getByLabel('Reason for correction', { exact: true }).fill('Fictional identity check.');
    await page.getByRole('button', { name: 'Save result correction', exact: true }).click(); await expect(page.getByRole('status').filter({ hasText: 'Result correction saved.' })).toBeVisible();
  } finally { for (const role of ['admin','clinician']) await pool.query('UPDATE staff_users SET display_name=$2 WHERE hospital_id=$1 AND username=$3', [session.user.hospital.id, `Fictional ${role}`, role]); }
});
