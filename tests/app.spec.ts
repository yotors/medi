import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
test('keyboard registration, connected care journey, closure and reload', async ({ page }) => {
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Patient flow', exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Register patient' }).click();
  await page.getByLabel('Full name').fill('Keyboard Fiction'); await page.getByLabel('Full name').press('Tab'); await expect(page.getByLabel('Age (optional)')).toBeFocused();
  await page.getByRole('button', { name: 'Create patient' }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('row').filter({ hasText: 'Keyboard Fiction' })).toBeVisible();
  await page.getByRole('button', { name: 'Check in', exact: true }).click();
  const dialog = page.getByRole('dialog'); await expect(dialog.getByRole('heading', { name: 'Keyboard Fiction', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close visit', exact: true })).toBeDisabled();
  await dialog.getByLabel('New consultation note').fill('Fictional evaluation note.'); await dialog.getByRole('button', { name: 'Save note' }).click();
  await dialog.getByRole('button', { name: 'Request test' }).click();
  await dialog.getByLabel('Fictional prescription instructions').fill('Demo medicine A — fictional handoff.'); await dialog.getByRole('button', { name: 'Add prescription' }).click();
  await dialog.getByRole('button', { name: 'Diagnostics', exact: true }).click(); await dialog.getByRole('button', { name: 'Mark collected' }).click(); await dialog.getByLabel('Fictional result').fill('Fictional result: demonstration complete.'); await dialog.getByRole('button', { name: 'Release result' }).click(); await dialog.getByRole('button', { name: 'Mark reviewed' }).click();
  await dialog.getByRole('button', { name: 'Pharmacy', exact: true }).click(); await dialog.getByRole('button', { name: 'Mark fulfilled' }).click();
  await dialog.getByRole('button', { name: 'Billing', exact: true }).click(); await expect(dialog.getByText('430.00 ETB', { exact: true })).toBeVisible(); await dialog.getByRole('button', { name: 'Record demo settlement' }).click(); await expect(dialog.getByRole('button', { name: 'Balance settled' })).toBeDisabled();
  expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
  await dialog.getByRole('button', { name: 'Close visit', exact: true }).click(); await expect(dialog.getByText('This visit is closed. Its records are read-only.')).toBeVisible();
  await dialog.getByRole('button', { name: 'History', exact: true }).click(); const events = await dialog.locator('.timeline strong').allTextContents(); expect(events.at(-1)).toBe('Closed visit.'); expect(events.indexOf('Blood count: released.')).toBeLessThan(events.indexOf('Blood count: reviewed.'));
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await page.reload();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Directory' }).click(); await page.getByRole('row').filter({ hasText: 'Keyboard Fiction' }).getByRole('button', { name: 'Closed visit 1' }).click(); await expect(dialog.getByText('This visit is closed. Its records are read-only.')).toBeVisible();
});
test('filters, navigation, dialog focus and reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
  await page.getByRole('textbox', { name: 'Search patients' }).fill('no-such-fictional-name'); await expect(page.getByRole('heading', { name: 'No matching records' })).toBeVisible(); await page.getByRole('button', { name: 'Reset filters' }).click();
  const trigger = page.getByRole('button', { name: 'Open visit for Liya Demo' }); await trigger.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible(); await page.keyboard.press('Tab'); expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true); await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  for (const name of ['Directory', 'Diagnostics', 'Pharmacy', 'Billing', 'Activity']) { await page.getByRole('navigation').getByRole('button', { name, exact: true }).click(); await expect(page.getByRole('heading', { name, exact: true })).toBeVisible(); }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test('corrupt storage requires explicit reset and stale tabs cannot overwrite', async ({ page, context }) => {
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Patient flow', exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.setItem('hospital-workspace-demo-v1', '{broken')); await page.reload(); await expect(page.getByRole('heading', { name: 'Demo data needs attention' })).toBeVisible(); expect(await page.evaluate(() => localStorage.getItem('hospital-workspace-demo-v1'))).toBe('{broken');
  expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Reset fictional data' }).click(); await page.getByRole('button', { name: 'Confirm reset' }).click(); await expect(page.getByRole('heading', { name: 'Patient flow', exact: true })).toBeVisible();
  const second = await context.newPage(); await second.goto('/'); await expect(second.getByRole('heading', { name: 'Patient flow', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open visit for Liya Demo' }).click(); await page.getByLabel('New consultation note').fill('Another tab saved this fictional note'); await page.getByRole('button', { name: 'Save note' }).click(); await expect(second.getByText('Another tab changed these records. Reload before continuing.')).toBeVisible();
  await second.getByRole('button', { name: 'Reload latest records' }).click(); await second.getByRole('button', { name: 'Open visit for Liya Demo' }).click(); await expect(second.getByText('Another tab saved this fictional note', { exact: true })).toBeVisible(); await second.close();
});
