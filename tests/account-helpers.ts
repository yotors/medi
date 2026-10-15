import { type Page, expect } from '@playwright/test';
export async function accountItem(page: Page, name: string) {
  const trigger = page.locator('.account-menu button[aria-haspopup="menu"]');
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  return page.getByRole('menuitem', { name, exact: true });
}
export async function signOut(page: Page) {
  await (await accountItem(page, 'Sign out')).click();
}
export async function accountNavigate(page: Page, name: string) {
  await (await accountItem(page, name)).click();
}
export async function expectSignedIn(page: Page) {
  await expect(page.locator('header .account-menu button[aria-haspopup="menu"]')).toBeVisible();
}
