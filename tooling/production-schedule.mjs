// systemd invokes this fixed code; failures never expose private child output.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installation } from './production-install.mjs';
import { backup } from './production-backup.mjs';
export async function scheduledBackup(
  path,
  key,
  {
    mounted = (destination) => spawnSync('mountpoint', ['-q', destination]).status === 0,
    notify = async (url, body) => {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw Error();
    },
  } = {},
) {
  let i;
  try {
    i = installation(path);
    if (!mounted(i.c.backupDirectory)) throw Error();
    const archive = join(
      i.c.backupDirectory,
      new Date().toISOString().replaceAll(':', '-') +
        '-' +
        randomBytes(8).toString('hex') +
        '.medibak',
    );
    const result = await backup(path, key, archive);
    return { archive, ...result };
  } catch {
    if (i)
      try {
        await notify(i.c.webhook, { event: 'medi.backup.failed', project: i.c.project });
      } catch {
        console.error('Protected backup failure notification failed; inspect service journal.');
      }
    throw Error('Scheduled production backup failed; previous archives retained.');
  }
}
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const [path, key, ...extra] = process.argv.slice(2);
  try {
    if (extra.length || !path || !key) throw Error();
    await scheduledBackup(path, key);
    console.log('Scheduled encrypted production backup published.');
  } catch {
    process.exitCode = 1;
    console.error('Scheduled production backup failed; previous archives retained.');
  }
}
