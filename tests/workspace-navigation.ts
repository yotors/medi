import { expect, type Page } from '@playwright/test';
/** Reveal the responsive workspace disclosure before using a primary link. */
export async function revealWorkspaceNavigation(
  page: Page,
  interaction: 'pointer' | 'keyboard' = 'pointer',
) {
  if (await page.evaluate(() => matchMedia('(max-width: 900px)').matches)) {
    const toggle = page.locator('button[aria-controls="workspace-navigation"]');
    await expect(toggle).toBeVisible();
    if ((await toggle.getAttribute('aria-expanded')) === 'false') {
      if (interaction === 'keyboard') {
        await toggle.focus();
        await toggle.press('Enter');
      } else await toggle.click();
    }
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  }
  await expect(page.locator('#workspace-navigation')).toBeVisible();
}
