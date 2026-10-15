import { expect, type Page } from '@playwright/test';
/** Reveal the responsive workspace disclosure before using a primary link. */
export async function revealWorkspaceNavigation(page: Page) {
  if (!(await page.evaluate(() => matchMedia('(max-width: 900px)').matches))) return;
  const toggle = page.locator('button[aria-controls="workspace-navigation"]');
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
}
