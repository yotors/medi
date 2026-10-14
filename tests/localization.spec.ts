import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';
import { experienceFixture } from './experience-fixture';
const { pool, prepare, signIn } = experienceFixture();
test.beforeAll(prepare);
test.afterAll(() => pool.end());
test('public page is bilingual, private-request free and accessible', async ({ page }, info) => {
  const protectedRequests: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api/')) protectedRequests.push(r.url());
  });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Keep every hospital handoff in view.' }),
  ).toBeVisible();
  await mkdir('.impeccable/review', { recursive: true });
  for (const language of ['en', 'am']) {
    await page.locator('.language-control select').selectOption(language);
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `.impeccable/review/public-${info.project.name}-${language}.png`,
      fullPage: true,
    });
  }
  expect(protectedRequests).toEqual([]);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'am');
  await page.evaluate(() => localStorage.setItem('medi.language', 'unavailable'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});
test('language changes preserve unsaved patient inputs and localize login and operational fields', async ({
  page,
}, info) => {
  await signIn(page, 'receptionist', '/staff/patients');
  await page.getByRole('button', { name: 'Register patient', exact: true }).click();
  await page.getByLabel('Full name').fill('Fictional Patient የሙከራ ስም');
  await page.screenshot({
    path: `.impeccable/review/staff-${info.project.name}-en.png`,
    fullPage: true,
  });
  await page.getByLabel('Language', { exact: true }).selectOption('am');
  await expect(page.getByLabel('ሙሉ ስም')).toHaveValue('Fictional Patient የሙከራ ስም');
  await expect(page.getByRole('button', { name: 'ታካሚ ያስቀምጡ', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: `.impeccable/review/staff-${info.project.name}-am.png`,
    fullPage: true,
  });
  await page.getByLabel('ቋንቋ', { exact: true }).selectOption('en');
  await expect(page.getByLabel('Full name')).toHaveValue('Fictional Patient የሙከራ ስም');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByLabel('Language', { exact: true }).selectOption('am');
  await expect(page.getByRole('heading', { name: 'የሠራተኞች መግቢያ' })).toBeVisible();
  await expect(page.getByLabel('የሆስፒታል ኮድ', { exact: true })).toBeVisible();
});

test('a visible safe sign-in error changes language with its inputs preserved', async ({
  page,
}) => {
  await page.goto('/staff');
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'INVALID_CREDENTIALS', message: 'untrusted server text' }),
    }),
  );
  await page.getByLabel('Hospital code', { exact: true }).fill('fictional-hospital');
  await page.getByLabel('Username', { exact: true }).fill('fictional-user');
  await page.getByLabel('Password', { exact: true }).fill('fictional-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('The sign-in details were not accepted.');
  await page.getByLabel('Language', { exact: true }).selectOption('am');
  await expect(page.getByRole('alert')).toHaveText('የመግቢያ ዝርዝሮች አልተቀበሉም።');
  await expect(page.getByLabel('የተጠቃሚ ስም', { exact: true })).toHaveValue('fictional-user');
});

test('an unavailable local language chunk preserves the current language and draft', async ({
  page,
}) => {
  await signIn(page, 'receptionist', '/staff/patients');
  await page.getByRole('button', { name: 'Register patient', exact: true }).click();
  await page.getByLabel('Full name').fill('Fictional preserved offline draft');
  await page.route('**/src/i18n/am/**', (route) => route.abort('failed'));
  await page.getByLabel('Language', { exact: true }).selectOption('am');
  await expect(page.getByRole('alert')).toHaveText(
    'The language file could not be loaded. Check the connection and choose it again.',
  );
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByLabel('Full name')).toHaveValue('Fictional preserved offline draft');
});

test('clinical protocol selections and entered content survive language changes independently of hospital dates', async ({
  page,
}) => {
  await signIn(page, 'admin', '/staff/patients');
  const auth = await (await page.request.get('/api/auth/session')).json();
  const appearance = await (await page.request.get('/api/hospital/appearance')).json();
  const name = 'Fictional bilingual profile ' + randomUUID().slice(0, 8);
  const registered = await page.request.post('/api/patients', {
    headers: {
      Origin: new URL(page.url()).origin,
      'X-CSRF-Token': auth.csrfToken,
      'Idempotency-Key': randomUUID(),
    },
    data: { name, contact: 'fictional' },
  });
  expect(registered.status()).toBe(201);
  await page.getByRole('link', { name: 'Patient care', exact: true }).click();
  await page.getByLabel('Find a patient').fill(name);
  await page.getByRole('button', { name: 'Search patients', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(name + ' ·') }).click();
  await page.getByRole('button', { name: 'Enter patient profile', exact: true }).click();
  await page.getByLabel('Patient name', { exact: true }).fill('active');
  await page.getByLabel('Sex', { exact: true }).selectOption('female');
  await page.getByLabel('Allergy information', { exact: true }).selectOption('entered');
  await page.getByLabel('Entered allergies (optional)', { exact: true }).fill('cash');
  await page.getByLabel('Language', { exact: true }).selectOption('am');
  await expect(page.getByLabel('ጾታ', { exact: true })).toHaveValue('female');
  await expect(page.getByLabel('ጾታ', { exact: true }).locator('option:checked')).toHaveText('ሴት');
  await expect(page.getByLabel('የገቡ አለርጂዎች (አማራጭ)', { exact: true })).toHaveValue('cash');
  await expect(page.getByLabel('የታካሚ ስም', { exact: true })).toHaveValue('active');
  expect(await (await page.request.get('/api/hospital/appearance')).json()).toEqual(appearance);
});
