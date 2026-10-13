import { test, expect } from '@playwright/test';

test('failed saves keep the draft and displayed records unchanged, then retry once', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open visit for Liya Demo' }).click();
  const dialog = page.getByRole('dialog');
  const before = await page.evaluate(() => localStorage.getItem('hospital-workspace-demo-v1'));
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Object.defineProperty(window, '__blockDemoWrites', { value: true, writable: true });
    Storage.prototype.setItem = function (key, value) {
      if ((window as unknown as Record<string, unknown>).__blockDemoWrites) throw new DOMException('Test quota', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await dialog.getByLabel('New consultation note').fill('Retry this fictional note');
  await dialog.getByRole('button', { name: 'Save note' }).click();
  await expect(dialog.getByRole('alert')).toContainText('could not save');
  await expect(dialog.getByLabel('New consultation note')).toHaveValue('Retry this fictional note');
  await expect(dialog.locator('.note').filter({ hasText: 'Retry this fictional note' })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('hospital-workspace-demo-v1'))).toBe(before);
  await page.evaluate(() => { (window as unknown as Record<string, unknown>).__blockDemoWrites = false; });
  await dialog.getByRole('button', { name: 'Save note' }).click();
  await expect(dialog.locator('.note').filter({ hasText: 'Retry this fictional note' })).toHaveCount(1);
  await expect(dialog.getByLabel('New consultation note')).toHaveValue('');
});

test('department membership follows completion and missing triggers return focus to workspace', async ({ page }) => {
  await page.goto('/'); const nav = page.getByRole('navigation'); const dialog = page.getByRole('dialog');
  await nav.getByRole('button', { name: 'Pharmacy', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Hana Fiction' })).toHaveCount(1);
  await expect(page.getByRole('row').filter({ hasText: 'Liya Demo' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open visit for Hana Fiction' }).click();
  await expect(dialog.getByRole('heading', { name: 'Prescription fulfillment' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Mark fulfilled' }).click();
  await expect(dialog.getByText('fulfilled', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.locator('#main')).toBeFocused();
  await expect(page.getByRole('row').filter({ hasText: 'Hana Fiction' })).toHaveCount(0);
  await nav.getByRole('button', { name: 'Billing', exact: true }).click();
  await page.getByRole('button', { name: 'Open visit for Liya Demo' }).click();
  await dialog.getByRole('button', { name: 'Record demo settlement' }).click();
  await expect(dialog.getByRole('button', { name: 'Balance settled' })).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(page.locator('#main')).toBeFocused();
  await expect(page.getByRole('row').filter({ hasText: 'Liya Demo' })).toHaveCount(0);
  await nav.getByRole('button', { name: 'Diagnostics', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Hana Fiction' })).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'Dawit Sample' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Open visit for Liya Demo' }).click();
  await dialog.getByRole('button', { name: 'Mark collected' }).click();
  await dialog.getByLabel('Fictional result').fill('Synthetic result for review testing');
  await dialog.getByRole('button', { name: 'Release result' }).click();
  await dialog.getByRole('button', { name: 'Mark reviewed' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('row').filter({ hasText: 'Liya Demo' })).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'Dawit Sample' })).toHaveCount(1);
});

test('visit drafts survive dismissal, reset clears registration drafts, and long activity fits', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Open visit for Liya Demo' }).click();
  await page.getByLabel('New consultation note').fill('Unsaved fictional draft'); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open visit for Liya Demo' }).click();
  await expect(page.getByLabel('New consultation note')).toHaveValue('Unsaved fictional draft'); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Register patient' }).click();
  await page.getByLabel('Full name').fill('A'.repeat(100)); await page.getByRole('button', { name: 'Create patient' }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Activity', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Register patient' }).click(); await page.getByLabel('Full name').fill('Draft before reset');
  await page.getByRole('button', { name: 'About this demo' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reset fictional data' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm reset' }).click();
  await page.getByRole('button', { name: 'Register patient' }).click(); await expect(page.getByLabel('Full name')).toHaveValue('');
});
