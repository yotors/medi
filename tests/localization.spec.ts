import { signOut } from './account-helpers';
import { chooseLanguage, chooseAction } from './preference-helpers';
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';
import { experienceFixture } from './experience-fixture';
const { pool, prepare, signIn } = experienceFixture();
test.beforeAll(prepare);
test.afterAll(() => pool.end());
test('public page is bilingual, session-only and accessible', async ({ page }, info) => {
  const protectedRequests: string[] = [];
  page.on('request', (r) => {
    if (
      new URL(r.url()).pathname.startsWith('/api/') &&
      new URL(r.url()).pathname !== '/api/auth/session'
    )
      protectedRequests.push(r.url());
  });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Keep every hospital handoff in view.' }),
  ).toBeVisible();
  await mkdir('.impeccable/review', { recursive: true });
  for (const language of ['en', 'am']) {
    await chooseLanguage(page, language);
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
  await chooseLanguage(page, 'am');
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
  await chooseLanguage(page, 'en');
  await expect(page.getByLabel('Full name')).toHaveValue('Fictional Patient የሙከራ ስም');
  page.once('dialog', (d) => d.accept());
  await signOut(page);
  await chooseLanguage(page, 'am');
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
  await chooseLanguage(page, 'am');
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
  await chooseLanguage(page, 'am', false);
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
  await chooseLanguage(page, 'am');
  await expect(page.getByLabel('ጾታ', { exact: true })).toHaveValue('female');
  await expect(page.getByLabel('ጾታ', { exact: true }).locator('option:checked')).toHaveText('ሴት');
  await expect(page.getByLabel('የገቡ አለርጂዎች (አማራጭ)', { exact: true })).toHaveValue('cash');
  await expect(page.getByLabel('የታካሚ ስም', { exact: true })).toHaveValue('active');
  expect(await (await page.request.get('/api/hospital/appearance')).json()).toEqual(appearance);
});

test('appearance menus persist preferences, follow Device and return keyboard focus', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Appearance', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitemradio', { name: 'Light', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.screenshot({
    path: `.impeccable/review/menu-appearance-${test.info().project.name}-en.png`,
    fullPage: true,
  });
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: 'Dark', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await page.getByRole('button', { name: 'Language', exact: true }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: `.impeccable/review/menu-language-${test.info().project.name}-en.png`,
    fullPage: true,
  });
  await page.keyboard.press('Escape');
  for (const mode of ['Dark', 'Light', 'Device']) {
    await trigger.click();
    await page.getByRole('menuitemradio', { name: mode, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-mode', mode.toLowerCase());
    for (const accent of ['Teal', 'Blue', 'Violet']) {
      await trigger.click();
      await page.getByRole('menuitemradio', { name: accent, exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-accent', accent.toLowerCase());
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({
        path: `.impeccable/review/appearance-${mode}-${accent}-${test.info().project.name}.png`,
        fullPage: true,
      });
    }
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'violet');
  await page.emulateMedia({ media: 'print', colorScheme: 'dark' });
  const print = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    return {
      surface: css.getPropertyValue('--surface').trim(),
      accent: css.getPropertyValue('--accent').trim(),
      ink: css.getPropertyValue('--ink').trim(),
      scheme: css.colorScheme,
    };
  });
  expect(print).toEqual({ surface: 'white', accent: '#164e44', ink: 'black', scheme: 'light' });
  await page.emulateMedia({ media: 'screen', colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'violet');
  await page.evaluate(() => localStorage.setItem('medi.appearance', '{invalid'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'teal');
});

test('public entry labels use session authority and stay neutral on read failure', async ({
  page,
}) => {
  let reads = 0;
  let reply: { status: number; body: object } = { status: 503, body: {} };
  await page.route('**/api/auth/session', (route) => {
    reads++;
    return route.fulfill({
      ...reply,
      contentType: 'application/json',
      body: JSON.stringify(reply.body),
    });
  });
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Open workspace', exact: true })).toHaveCount(3);
  await expect.poll(() => reads).toBeGreaterThan(0);
  reply = { status: 401, body: {} };
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveCount(3);
  reply = { status: 200, body: { authState: 'complete', passwordChangeRequired: false } };
  const beforeVisibility = reads;
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(reads).toBe(beforeVisibility);
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveCount(3);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('link', { name: 'Dashboard', exact: true })).toHaveCount(3);
  reply = { status: 200, body: { authState: 'challenge', passwordChangeRequired: false } };
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('link', { name: 'Continue sign-in', exact: true })).toHaveCount(3);
  reply = { status: 200, body: { authState: 'complete', passwordChangeRequired: true } };
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('link', { name: 'Continue sign-in', exact: true })).toHaveCount(3);
  reply = { status: 401, body: {} };
  await page.evaluate(() => {
    const channel = new BroadcastChannel('hospital-staff-session');
    channel.postMessage('logout');
    channel.close();
  });
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveCount(3);
});

test('dark operational surfaces preserve drafts and contain bilingual controls', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await page.addInitScript(() =>
    localStorage.setItem('medi.appearance', JSON.stringify({ mode: 'dark', accent: 'blue' })),
  );
  await page.goto('/staff');
  await expect(page.getByRole('heading', { name: 'Staff sign-in', exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: `.impeccable/review/theme-login-${info.project.name}.png`,
    fullPage: true,
  });
  await signIn(page, 'admin', '/staff/patients');
  await page.getByRole('button', { name: 'Register patient', exact: true }).click();
  await page.getByLabel('Full name').fill('Fictional appearance draft');
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Violet', exact: true }).click();
  await chooseLanguage(page, 'am');
  await expect(page.getByLabel('ሙሉ ስም')).toHaveValue('Fictional appearance draft');
  for (const [label, menu] of [
    ['ገጽታ', 'appearance'],
    ['ቋንቋ', 'language'],
  ]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `.impeccable/review/menu-${menu}-${info.project.name}-am.png`,
      fullPage: true,
    });
    await page.keyboard.press('Escape');
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: `.impeccable/review/theme-registration-${info.project.name}.png`,
    fullPage: true,
  });
  await chooseLanguage(page, 'en');
  page.once('dialog', (dialog) => dialog.accept());
  for (const [name, path] of [
    ['Department operations', 'departments'],
    ['Pharmacy inventory', 'inventory'],
    ['Operational reports', 'reports'],
  ]) {
    await page
      .getByRole('navigation', { name: 'Staff workspace', exact: true })
      .getByRole('link', { name, exact: true })
      .click();
    await expect(page.locator('#staff-main h1')).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `.impeccable/review/theme-${path}-${info.project.name}.png`,
      fullPage: true,
    });
  }
});

test('blocked preference storage still permits in-memory appearance and menu dismissal', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    Storage.prototype.setItem = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const trigger = page.getByRole('button', { name: 'Appearance', exact: true });
  await trigger.click();
  await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await trigger.click();
  const heading = await page.locator('.product-hero h1').boundingBox();
  await page.mouse.click(heading!.x + 10, heading!.y + 10);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('preference read guards label groups reset cross-tab clear and hide portaled print menu', async ({
  page,
  context,
}) => {
  await page.goto('/');
  const appearance = page.getByRole('button', { name: 'Appearance', exact: true });
  await appearance.click();
  await expect(page.getByRole('group', { name: 'Mode', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Accent', exact: true })).toBeVisible();
  await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click();
  await appearance.click();
  await page.getByRole('menuitemradio', { name: 'Blue', exact: true }).click();
  await appearance.click();
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.preference-menu')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'blue');
  const other = await context.newPage();
  await other.goto('/');
  await other.evaluate(() => localStorage.clear());
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'teal');
  await other.close();
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/src/i18n/am/**', async (route) => {
    await delayed;
    await route.continue();
  });
  const language = page.getByRole('button', { name: 'Language', exact: true });
  await language.click();
  await page.getByRole('menuitemradio', { name: 'አማርኛ', exact: true }).click();
  await expect(language).toBeDisabled();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  release();
  await expect(page.locator('html')).toHaveAttribute('lang', 'am');
  await expect(page.getByRole('button', { name: 'ቋንቋ', exact: true })).toBeEnabled();
});
