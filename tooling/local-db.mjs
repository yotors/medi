import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
if (!existsSync('.env')) {
  const password = randomBytes(32).toString('hex');
  writeFileSync('.env', `POSTGRES_PASSWORD=${password}\nDATABASE_URL=postgresql://hospital_dev:${password}@127.0.0.1:15432/hospital_dev\nAPP_ORIGIN=http://127.0.0.1:5173\nPORT=3100\nNODE_ENV=development\n`, { mode: 0o600, flag: 'wx' });
  console.log('Created local database configuration in ignored .env.');
}
const result = spawnSync('docker', ['compose', 'up', '-d', '--wait', 'database'], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
