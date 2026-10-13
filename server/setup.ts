import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type pg from 'pg';
import { z } from 'zod';
import { hashPassword, randomToken } from './auth.ts';
import { createPool, migrate } from './db.ts';
import { staffUsernameSchema } from '../shared/registration.ts';

const noNul = (value: string) => !value.includes('\0');
const staffSchema = z.strictObject({
  hospitalCode: z.string().trim().toLowerCase().min(1).max(60).regex(/^[a-z0-9-]+$/),
  hospitalName: z.string().trim().min(1).max(100).refine(noNul),
  username: staffUsernameSchema,
  displayName: z.string().trim().min(1).max(100).refine(noNul),
  role: z.enum(['admin', 'receptionist', 'auditor', 'clinician', 'lab', 'pharmacist', 'cashier']),
  password: z.string().min(12).max(256).refine(noNul),
});
export const decodePasswordFile = (contents: string) => contents.replace(/\r?\n$/, '');
export type StaffProvisioning = z.infer<typeof staffSchema>;
export async function provisionStaff(pool: pg.Pool, input: StaffProvisioning) {
  const parsed = staffSchema.safeParse(input);
  if (!parsed.success) throw new Error('Invalid provisioning fields; password must contain 12–256 characters.');
  const fields = parsed.data;
  const passwordHash = await hashPassword(fields.password);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO hospitals(id,code,name) VALUES ($1,$2,$3) ON CONFLICT(code) DO NOTHING', [randomUUID(), fields.hospitalCode, fields.hospitalName]);
    const { rows: [hospital] } = await client.query('SELECT id,name FROM hospitals WHERE code=$1 FOR UPDATE', [fields.hospitalCode]);
    if (hospital.name !== fields.hospitalName) throw new Error('Hospital code already exists with a different name.');
    const existing = await client.query('SELECT 1 FROM staff_users WHERE hospital_id=$1 AND username=$2', [hospital.id, fields.username]);
    if (existing.rowCount) throw new Error('Staff account already exists; it was not changed.');
    const id = randomUUID();
    await client.query('INSERT INTO staff_users(id,hospital_id,username,display_name,role,password_hash) VALUES ($1,$2,$3,$4,$5,$6)', [id, hospital.id, fields.username, fields.displayName, fields.role, passwordHash]);
    await client.query('COMMIT');
    return { id, hospitalId: hospital.id };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!['migrate', 'staff'].includes(command ?? '')) throw new Error('Use setup.ts migrate or setup.ts staff with explicit account flags.');
  const pool = createPool();
  try {
    await migrate(pool);
    if (command === 'migrate') { process.stdout.write('Registration database migrations applied.\n'); return; }
    const values: Record<string, string> = {};
    const allowed = ['hospital-code', 'hospital-name', 'username', 'display-name', 'role', 'password-file'];
    for (let index = 0; index < args.length; index += 2) {
      const flag = args[index].replace(/^--/, '');
      if (!args[index].startsWith('--') || !allowed.includes(flag) || !args[index + 1] || values[flag]) throw new Error('Invalid or repeated provisioning flag.');
      values[flag] = args[index + 1];
    }
    if (allowed.some(flag => !values[flag])) throw new Error('Required flags: --hospital-code --hospital-name --username --display-name --role --password-file.');
    const passwordPath = values['password-file'];
    if (!isAbsolute(passwordPath)) throw new Error('--password-file must be an absolute path to an ignored private file.');
    const projectRoot = fileURLToPath(new URL('../', import.meta.url));
    const relativePath = relative(projectRoot, passwordPath);
    if (!relativePath.startsWith('..') && !isAbsolute(relativePath)) {
      try { await promisify(execFile)('git', ['check-ignore', '--quiet', '--', passwordPath], { cwd: projectRoot }); }
      catch { throw new Error('Password files inside this project must be ignored by Git.'); }
    }
    let password: string;
    try {
      const info = await lstat(passwordPath);
      if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error('Password file must be a private file (chmod 600).');
      password = decodePasswordFile(await readFile(passwordPath, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      password = randomToken();
      await writeFile(passwordPath, `${password}\n`, { flag: 'wx', mode: 0o600 });
    }
    await provisionStaff(pool, { hospitalCode: values['hospital-code'], hospitalName: values['hospital-name'], username: values.username,
      displayName: values['display-name'], role: values.role as StaffProvisioning['role'], password });
    process.stdout.write('Staff account created. Password remains only in the specified private file.\n');
  } finally { await pool.end(); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => { process.stderr.write('Setup failed. Check the dedicated database, flags, private password file and whether the account already exists. No accounts were overwritten.\n'); process.exitCode = 1; });
}
