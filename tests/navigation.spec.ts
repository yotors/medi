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
    'mfa',
    'password',
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
    'mfa',
    'password',
  ],
  clinician: [
    '',
    'patients',
    'visits',
    'care',
    'departments',
    'configuration',
    'reports',
    'mfa',
    'password',
  ],
  nurse: ['', 'patients', 'visits', 'care', 'configuration', 'reports', 'mfa', 'password'],
  receptionist: ['', 'patients', 'visits', 'care', 'configuration', 'mfa', 'password'],
  cashier: ['', 'patients', 'visits', 'departments', 'configuration', 'reports', 'mfa', 'password'],
  lab: ['', 'patients', 'visits', 'departments', 'configuration', 'mfa', 'password'],
  pharmacist: [
    '',
    'patients',
    'visits',
    'care',
    'departments',
    'configuration',
    'inventory',
    'reports',
    'mfa',
    'password',
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
