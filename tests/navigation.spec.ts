import { accountItem, accountNavigate } from './account-helpers';
import { chooseLanguage } from './preference-helpers';
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { experienceFixture } from './experience-fixture';
const { pool, prepare, roles, signIn } = experienceFixture();
const expectedRoutes = {
  admin: [
    '',
    'patients',
    'visits',
    'care',
    'departments',
    'configuration',
    'inventory',
    'reports',
    'hospital',
    'staff',
  ],
  auditor: [
    '',
    'patients',
    'visits',
    'care',
    'departments',
    'configuration',
    'inventory',
    'reports',
    'hospital',
  ],
  clinician: ['', 'patients', 'visits', 'care', 'departments', 'configuration', 'reports'],
  nurse: ['', 'patients', 'visits', 'care', 'configuration', 'reports'],
  receptionist: ['', 'patients', 'visits', 'care', 'configuration'],
  cashier: ['', 'patients', 'visits', 'departments', 'configuration', 'reports'],
  lab: ['', 'patients', 'visits', 'departments', 'configuration'],
  pharmacist: [
    '',
    'patients',
    'visits',
    'care',
    'departments',
    'configuration',
    'inventory',
    'reports',
  ],
};
test.beforeAll(prepare);
test.afterAll(() => pool.end());
for (const role of roles)
  test(`${role} home exposes authorized destinations`, async ({ page }) => {
    await signIn(page, role);
    await expect(page.getByRole('heading', { name: 'Start your work' })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Staff workspace', exact: true });
    const expected = expectedRoutes[role].map((route) => (route ? `/staff/${route}` : '/staff'));
    expect(
      await nav.locator('a').evaluateAll((links) => links.map((a) => a.getAttribute('href'))),
    ).toEqual(expected);
    expect(await page.locator('html').getAttribute('lang')).toBe('en');
    await accountItem(page, 'Change password');
    expect(
      await page
        .getByRole('menu')
        .locator('a')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
    ).toEqual(['/staff/password', '/staff/mfa']);
    await expect(page.getByRole('menuitem', { name: 'Sign out', exact: true })).toHaveCount(1);
    await page.keyboard.press('Escape');
  });
test('deep links, refresh, unknown and forbidden routes', async ({ page }) => {
  await signIn(page, 'receptionist', '/staff/patients');
  await expect(page.getByRole('heading', { name: 'Patient directory', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Patient directory', exact: true })).toBeVisible();
  for (const path of ['/staff/hospital', '/staff/unknown']) {
    await page.goto(path);
    await expect(
      page.getByRole('heading', {
        name: 'This page is unavailable for your role or does not exist.',
      }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Return to workspace home' }).click();
    await expect(page).toHaveURL(/\/staff$/);
  }
});
test('links and Back/Forward preserve a cancelled registration draft and URL', async ({ page }) => {
  await signIn(page, 'receptionist');
  await page
    .getByRole('navigation', { name: 'Staff workspace', exact: true })
    .getByRole('link', { name: 'Patient directory', exact: true })
    .click();
  await page.getByRole('button', { name: 'Register patient', exact: true }).click();
  await page.getByLabel('Full name').fill('Fictional preserved name');
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('staff-session-activity', {
        detail: new Date(Date.now() + 86400000).toISOString(),
      }),
    ),
  );
  await expect(page.getByLabel('Full name')).toBeFocused();
  await page.getByLabel('Age (optional)', { exact: true }).fill('42');
  await page.getByLabel('Contact (optional)', { exact: true }).fill('Fictional contact');
  await page
    .getByRole('navigation', { name: 'Staff workspace', exact: true })
    .getByRole('link', { name: 'Patient directory', exact: true })
    .click();
  await expect(page.getByLabel('Full name')).toHaveValue('Fictional preserved name');
  page.once('dialog', (d) => d.dismiss());
  await page
    .getByRole('navigation', { name: 'Staff workspace', exact: true })
    .getByRole('link', { name: 'Outpatient visits', exact: true })
    .click();
  await expect(page).toHaveURL(/\/staff\/patients$/);
  await expect(page.getByLabel('Full name')).toHaveValue('Fictional preserved name');
  page.once('dialog', (d) => d.dismiss());
  await page.goBack();
  await expect(page).toHaveURL(/\/staff\/patients$/);
  await expect(page.getByLabel('Full name')).toHaveValue('Fictional preserved name');
  page.once('dialog', (d) => d.accept());
  await page.goBack();
  await expect(page).toHaveURL(/\/staff$/);
  await expect(page.getByRole('heading', { name: 'Start your work' })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/staff\/patients$/);
  await expect(page.getByRole('heading', { name: 'Patient directory', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Register patient', exact: true }).click();
  await expect(page.getByLabel('Full name')).toHaveValue('');
  await expect(page.getByLabel('Age (optional)', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Contact (optional)', { exact: true })).toHaveValue('');
});

test('modified true-link navigation opens another tab without discarding this draft', async ({
  page,
  context,
}) => {
  await signIn(page, 'receptionist', '/staff/patients');
  await page.getByRole('button', { name: 'Register patient', exact: true }).click();
  await page.getByLabel('Full name').fill('Fictional original-tab draft');
  const opened = context.waitForEvent('page');
  await page
    .getByRole('navigation', { name: 'Staff workspace', exact: true })
    .getByRole('link', { name: 'Outpatient visits', exact: true })
    .click({ modifiers: ['Control'] });
  const tab = await opened;
  await expect(tab).toHaveURL(/\/staff\/visits$/);
  await expect(page).toHaveURL(/\/staff\/patients$/);
  await expect(page.getByLabel('Full name')).toHaveValue('Fictional original-tab draft');
  await tab.close();
});

test('profile menu owns account links in header with keyboard and bilingual mobile containment', async ({
  page,
  context,
}, info) => {
  await signIn(page, 'admin');
  const trigger = page.locator('header .account-menu button[aria-haspopup="menu"]');
  await expect(trigger).toContainText('Fictional admin');
  await expect(trigger.locator('svg').first()).toBeVisible();
  await expect(
    page.locator('.staff-primary-navigation').getByText('Your account', { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator(
      '.staff-primary-navigation a[href="/staff/password"], .staff-primary-navigation a[href="/staff/mfa"]',
    ),
  ).toHaveCount(0);
  await expect(
    page.locator('#staff-main').getByRole('button', { name: 'Sign out', exact: true }),
  ).toHaveCount(0);
  await trigger.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Home');
  await expect(page.getByRole('menuitem', { name: 'Change password', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  for (const language of ['en', 'am']) {
    await chooseLanguage(page, language);
    await trigger.click();
    await expect(page.getByRole('menuitem')).toHaveCount(3);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    const position = await trigger.boundingBox();
    if (info.project.name === 'mobile') {
      const brand = await page.locator('header .staff-brand').boundingBox();
      expect(
        Math.abs(position!.y + position!.height / 2 - (brand!.y + brand!.height / 2)),
      ).toBeLessThan(4);
      expect(position!.x).toBeGreaterThan(brand!.x + brand!.width);
    }
    expect(position!.x + position!.width).toBeLessThanOrEqual(
      await page.evaluate(() => innerWidth),
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `.impeccable/review/profile-${info.project.name}-${language}.png`,
      fullPage: true,
    });
    await page.keyboard.press('Escape');
  }
  await chooseLanguage(page, 'en');
  const link = await accountItem(page, 'Authenticator security');
  await expect(link).toHaveAttribute('href', '/staff/mfa');
  const opened = context.waitForEvent('page');
  await link.click({ modifiers: ['ControlOrMeta'] });
  const other = await opened;
  await expect(other).toHaveURL(/\/staff\/mfa$/);
  await other.close();
  await expect(page).toHaveURL(/\/staff$/);
  await page.keyboard.press('Escape');
  await accountNavigate(page, 'Change password');
  await expect(page).toHaveURL(/\/staff\/password$/);
  await expect(page.getByRole('heading', { name: 'Change password', exact: true })).toBeVisible();
});

test('profile menu account navigation and sign-out preserve cancelled registration draft', async ({
  page,
}) => {
  await signIn(page, 'receptionist', '/staff/patients');
  await page.getByRole('button', { name: 'Register patient', exact: true }).click();
  await page.getByLabel('Full name').fill('Fictional profile draft');
  const original = page.url();
  for (const action of ['Change password', 'Authenticator security', 'Sign out']) {
    page.once('dialog', (dialog) => dialog.dismiss());
    await (await accountItem(page, action)).click();
    await expect(page).toHaveURL(original);
    await expect(page.getByLabel('Full name')).toHaveValue('Fictional profile draft');
  }
  page.once('dialog', (dialog) => dialog.accept());
  await accountNavigate(page, 'Change password');
  await expect(page).toHaveURL(/\/staff\/password$/);
});

test('profile menu hides settings during MFA and required-password authentication gates', async ({
  page,
}) => {
  await signIn(page, 'admin');
  const session = await (await page.request.get('/api/auth/session')).json();
  for (const state of [
    { authState: 'challenge', passwordChangeRequired: false },
    { authState: 'complete', passwordChangeRequired: true },
  ]) {
    await page.route('**/api/auth/session', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...session, ...state }),
      }),
    );
    await page.reload();
    await expect(await accountItem(page, 'Sign out')).toBeVisible();
    await expect(page.getByRole('menu').locator('a')).toHaveCount(0);
    await expect(page.locator('.staff-primary-navigation')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.unroute('**/api/auth/session');
  }
});
