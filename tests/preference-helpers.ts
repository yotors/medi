import { expect, type Page } from '@playwright/test';
export async function chooseLanguage(page: Page, language: string, expectChange = true) {
  await page.getByRole('button', { name: /^(Language|ቋንቋ)$/ }).click();
  await page
    .getByRole('menuitemradio', { name: language === 'am' ? 'አማርኛ' : 'English', exact: true })
    .click();
  if (expectChange) await expect(page.locator('html')).toHaveAttribute('lang', language);
}
export async function chooseAction(page: Page, action: string) {
  const selector = page.getByLabel('Action', { exact: true });
  if (await selector.count()) await selector.selectOption(action);
  else {
    const labels: Record<string, string> = {
      'lab.catalog': 'Configure laboratory test',
      'supplier.create': 'Add supplier',
    };
    await expect(page.locator('.department-form h2')).toHaveText(labels[action] ?? action);
  }
}
