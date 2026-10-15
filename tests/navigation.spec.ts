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
  await expect(trigger).toHaveAccessibleName('Your account: Fictional admin');
  expect((await trigger.boundingBox())!.width).toBeLessThanOrEqual(44);
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
    await expect(
      page.getByRole('menu').getByText('Fictional admin', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('menuitem')).toHaveCount(3);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    const position = await trigger.boundingBox();
    if (info.project.name === 'mobile') {
      const brand = await page.locator('header .staff-brand').boundingBox();
      expect(
        Math.abs(position!.y + position!.height / 2 - (brand!.y + brand!.height / 2)),
      ).toBeLessThan(4);
      expect(position!.x).toBeGreaterThan(brand!.x + brand!.width);
      for (const icon of await page.locator('.staff-header .language-switcher button').all()) {
        const bounds = (await icon.boundingBox())!;
        expect(
          Math.abs(bounds.y + bounds.height / 2 - (brand!.y + brand!.height / 2)),
        ).toBeLessThan(4);
        expect(bounds.width).toBe(44);
      }
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

test('fixed workspace rail reserves content and footer through scroll and translated headers', async ({
  page,
}, info) => {
  await signIn(page, 'admin');
  for (const width of info.project.name === 'desktop' ? [1280, 901] : [390]) {
    await page.setViewportSize({ width, height: 780 });
    for (const language of ['en', 'am']) {
      await chooseLanguage(page, language);
      await page
        .locator('.staff-header')
        .evaluate((element) => (element.style.paddingBlock = '64px'));
      await page.locator('#staff-main').evaluate((element) => (element.style.minHeight = '180vh'));
      await page.evaluate(() => window.scrollTo(0, 0));
      const rail = page.locator('.staff-primary-navigation');
      const main = page.locator('#staff-main');
      if (width > 900) {
        await expect.poll(async () => (await rail.boundingBox())!.y).toBeGreaterThan(100);
        expect(
          (await rail.boundingBox())!.x + (await rail.boundingBox())!.width,
        ).toBeLessThanOrEqual((await main.boundingBox())!.x);
        await page.evaluate(() => window.scrollTo(0, 600));
        await expect.poll(async () => (await rail.boundingBox())!.y).toBe(0);
        expect(await rail.evaluate((element) => getComputedStyle(element).overflowY)).toBe('auto');
        const footer = await page.locator('.staff-footer').boundingBox();
        expect(footer!.x).toBeGreaterThanOrEqual((await rail.boundingBox())!.width);
      } else {
        expect(await rail.evaluate((element) => getComputedStyle(element).position)).toBe('static');
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  }
});

test('workspace section links support deep URLs, native tabs and guarded history', async ({
  page,
  context,
}) => {
  await signIn(page, 'admin', '/staff/hospital?section=Organization');
  const sections = page.getByRole('navigation', { name: 'Hospital management sections' });
  await expect(sections.getByRole('link', { name: 'Organization', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.reload();
  await expect(sections.getByRole('link', { name: 'Organization', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const facilities = sections.getByRole('link', { name: 'Facilities', exact: true });
  const opened = context.waitForEvent('page');
  await facilities.click({ modifiers: ['ControlOrMeta'] });
  const other = await opened;
  await expect(other).toHaveURL(/section=Facilities$/);
  await other.close();
  await facilities.click();
  await page.goBack();
  await expect(sections.getByRole('link', { name: 'Organization', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.goForward();
  await expect(facilities).toHaveAttribute('aria-current', 'page');
  const field = page.locator('#hospital-name');
  await field.fill('Fictional preserved facility');
  const original = page.url();
  page.once('dialog', (dialog) => dialog.dismiss());
  await sections.getByRole('link', { name: 'Organization', exact: true }).click();
  await expect(page).toHaveURL(original);
  await expect(field).toHaveValue('Fictional preserved facility');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.goBack();
  await expect(page).toHaveURL(original);
  await expect(field).toHaveValue('Fictional preserved facility');
});

test('care and catalog sections normalize deep links and preserve browser history', async ({
  page,
}) => {
  await signIn(page, 'admin', '/staff/care?section=appointment');
  await expect(page.getByRole('link', { name: 'Appointments', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.reload();
  await expect(page.getByRole('link', { name: 'Appointments', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.goto('/staff/configuration?section=departments');
  const sections = page.getByRole('navigation', { name: 'Catalog sections' });
  await expect(sections.getByRole('link', { name: 'Departments', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await sections.getByRole('link', { name: 'Services', exact: true }).click();
  await expect(page).toHaveURL(/section=services$/);
  await page.goBack();
  await expect(sections.getByRole('link', { name: 'Departments', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.goto('/staff/configuration?section=invalid');
  await expect(page).toHaveURL(/section=services$/);
});

test('an unresolved hospital command keeps section links and browser history locked', async ({
  page,
}) => {
  await signIn(page, 'admin', '/staff/hospital?section=Organization');
  await page.getByRole('link', { name: 'Facilities', exact: true }).click();
  await page.getByLabel('Facility code', { exact: true }).fill('FICTIONAL-PENDING');
  await page.getByLabel('Facility name', { exact: true }).fill('Fictional unresolved facility');
  await page.getByLabel('Reason', { exact: true }).fill('Synthetic pending navigation check');
  let calls = 0;
  await page.route('**/api/hospital/commands', (route) => {
    calls++;
    return route.abort('failed');
  });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Retry original request', exact: true }),
  ).toBeVisible();
  const original = page.url();
  await page.getByRole('link', { name: 'Organization', exact: true }).click({ force: true });
  await expect(page).toHaveURL(original);
  await page.goBack();
  await expect(page).toHaveURL(original);
  await expect(page.getByLabel('Facility name', { exact: true })).toHaveValue(
    'Fictional unresolved facility',
  );
  expect(calls).toBe(1);
});

test('review regression: accepted history and MFA return retain the selected section', async ({
  page,
}) => {
  await signIn(page, 'admin', '/staff/hospital?section=Organization');
  const sections = page.getByRole('navigation', { name: 'Hospital management sections' });
  await sections.getByRole('link', { name: 'Facilities', exact: true }).click();
  await page.goBack();
  await expect(sections.getByRole('link', { name: 'Organization', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const primary = page.getByRole('navigation', { name: 'Staff workspace', exact: true });
  await primary.getByRole('link', { name: 'Patient directory', exact: true }).click();
  await primary.getByRole('link', { name: 'Hospital management', exact: true }).click();
  await expect(page).toHaveURL(/section=Organization$/);
  await expect(sections.getByRole('link', { name: 'Organization', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const session = await (await page.request.get('/api/auth/session')).json();
  await page.route('**/api/auth/mfa/status', (route) => route.fulfill({ json: { secret: null } }));
  await page.route('**/api/auth/mfa/regenerate', (route) =>
    route.fulfill({
      json: { session, recoveryCodes: ['SYNTHETIC-TEST-ONLY'] },
    }),
  );
  await accountNavigate(page, 'Authenticator security');
  await page.getByLabel('Current password', { exact: true }).fill('Synthetic intercepted input');
  await page.getByLabel('Authenticator code', { exact: true }).fill('000000');
  await page.getByRole('button', { name: 'Generate new recovery codes', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to workspace', exact: true }).click();
  await expect(page).toHaveURL(/\/staff\/hospital\?section=Organization$/);
  await expect(sections.getByRole('link', { name: 'Organization', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('review regression: care draft and pending command survive links, native tabs and Back', async ({
  page,
  context,
}) => {
  await signIn(page, 'admin', '/staff/care?section=bed');
  const sections = page.getByRole('navigation', { name: 'Care workflows' });
  const ward = sections.locator('a[href="/staff/care?section=ward"]');
  await ward.click();
  await page.getByRole('button', { name: 'New entry', exact: true }).click();
  await page.getByLabel('Ward name', { exact: true }).fill('Fictional retained ward');
  await page.getByLabel('Facility', { exact: true }).fill('Fictional facility');
  await page
    .getByLabel('Entry / correction / cancellation reason')
    .fill('Synthetic pending navigation');
  const original = page.url();
  const bed = sections.locator('a[href="/staff/care?section=bed"]');
  page.once('dialog', (dialog) => dialog.dismiss());
  await bed.click();
  await expect(page).toHaveURL(original);
  await expect(page.getByLabel('Ward name', { exact: true })).toHaveValue(
    'Fictional retained ward',
  );
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.goBack();
  await expect(page).toHaveURL(original);
  const opened = context.waitForEvent('page');
  await bed.click({ modifiers: ['ControlOrMeta'] });
  const other = await opened;
  await expect(other).toHaveURL(/section=bed$/);
  await other.close();
  await expect(page).toHaveURL(original);
  await expect(page.getByLabel('Ward name', { exact: true })).toHaveValue(
    'Fictional retained ward',
  );
  let writes = 0;
  await page.route('**/api/care/records', (route) => {
    writes++;
    return route.abort('failed');
  });
  await page.getByRole('button', { name: 'Sign and save', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Retry the same save', exact: true }),
  ).toBeVisible();
  await bed.click({ force: true });
  await page.goBack();
  await expect(page).toHaveURL(original);
  await expect(page.getByLabel('Ward name', { exact: true })).toHaveValue(
    'Fictional retained ward',
  );
  expect(writes).toBe(1);
});

test('review regression: catalog mount, draft, native tab and pending history stay synchronized', async ({
  page,
  context,
}) => {
  await signIn(page, 'admin', '/staff/configuration?section=departments');
  const reads: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'GET' &&
      /\/api\/configuration\/(departments|services)\?/.test(request.url())
    )
      reads.push(new URL(request.url()).pathname);
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Add department', exact: true })).toBeVisible();
  expect(reads).toContain('/api/configuration/departments');
  expect(reads).not.toContain('/api/configuration/services');
  const sections = page.getByRole('navigation', { name: 'Catalog sections' });
  await sections.getByRole('link', { name: 'Services', exact: true }).click();
  await sections.getByRole('link', { name: 'Departments', exact: true }).click();
  await page.getByRole('button', { name: 'Add department', exact: true }).click();
  await page.getByLabel('Stable code').fill('FICTION-RETAINED');
  await page.getByLabel('Department name', { exact: true }).fill('Fictional retained department');
  const original = page.url();
  const primary = page.getByRole('navigation', { name: 'Staff workspace', exact: true });
  const care = primary.getByRole('link', { name: 'Patient care', exact: true });
  page.once('dialog', (dialog) => dialog.dismiss());
  await care.click();
  await expect(page).toHaveURL(original);
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.goBack();
  await expect(page).toHaveURL(original);
  const opened = context.waitForEvent('page');
  await care.click({ modifiers: ['ControlOrMeta'] });
  const other = await opened;
  await expect(other).toHaveURL(/\/staff\/care(?:\?section=profile)?$/);
  await other.close();
  await expect(page.getByLabel('Department name', { exact: true })).toHaveValue(
    'Fictional retained department',
  );
  let writes = 0;
  await page.route('**/api/configuration/commands', (route) => {
    writes++;
    return route.abort('failed');
  });
  await page.getByRole('button', { name: 'Save configuration', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Retry configuration save', exact: true }),
  ).toBeVisible();
  await care.click({ force: true });
  await page.goBack();
  await expect(page).toHaveURL(original);
  await expect(page.getByLabel('Department name', { exact: true })).toHaveValue(
    'Fictional retained department',
  );
  expect(writes).toBe(1);
});

test('review regression: restricted care sections normalize before rendering or requesting', async ({
  page,
}) => {
  const searched: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/care/search')) searched.push(request.postDataJSON().kind);
  });
  await signIn(page, 'pharmacist', '/staff/care?section=ward');
  await expect(page).toHaveURL(/section=profile$/);
  const sections = page.getByRole('navigation', { name: 'Care workflows' });
  await expect(sections.locator('a[aria-current="page"]')).toHaveAttribute(
    'href',
    '/staff/care?section=profile',
  );
  await expect(sections.locator('a')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'New entry', exact: true })).toHaveCount(0);
  expect(searched).not.toContain('ward');
});
