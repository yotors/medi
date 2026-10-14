import { randomBytes, randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { type Page, expect } from '@playwright/test';
import { createPool } from '../server/db';
import { provisionStaff } from '../server/setup';
import { prepareBrowserFixture } from './browser-fixture';
import type { StaffRole } from '../shared/registration';
try {
  loadEnvFile('.env');
} catch {
  /* CI provides the environment. */
}
/** Each spec owns its pool and isolated hospital, even when a worker runs both specs. */
export function experienceFixture() {
  const pool = createPool(),
    hospitalCode = 'experience-' + randomUUID().slice(0, 8),
    password = randomBytes(24).toString('hex');
  const roles: StaffRole[] = [
    'admin',
    'receptionist',
    'auditor',
    'clinician',
    'lab',
    'pharmacist',
    'cashier',
    'nurse',
  ];
  async function prepare() {
    await prepareBrowserFixture(pool);
    for (const role of roles)
      await provisionStaff(pool, {
        hospitalCode,
        hospitalName: 'Fictional Experience Hospital',
        username: role,
        displayName: 'Fictional ' + role,
        role,
        password,
      });
  }
  async function signIn(page: Page, role: StaffRole = 'admin', path = '/staff') {
    await page.goto(path);
    await page.getByLabel('Hospital code', { exact: true }).fill(hospitalCode);
    await page.getByLabel('Username', { exact: true }).fill(role);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  }
  return { pool, hospitalCode, password, roles, prepare, signIn };
}
