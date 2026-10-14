import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { interrupt } from './release-cancellation.mjs';
import { check } from './release-archive.mjs';
const children = new Set();
let interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    interrupted = true;
    interrupt();
    for (const child of children) child.kill('SIGKILL');
  });
export const sourceCompose = [
  'compose',
  '--project-name',
  'medi-release-local',
  '--env-file',
  '.local/release.env',
  '-f',
  'compose.release.yaml',
];
export function docker(args, environment, input, { cleanup = false } = {}) {
  if (
    interrupted &&
    !cleanup &&
    !args.includes('down') &&
    !args.includes('rm') &&
    !args.includes('up')
  )
    throw Error('Release operation interrupted.');
  const r = spawnSync('docker', args, {
    env: environment,
    input,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 8 * 1024 * 1024,
  });
  check(!r.error && r.status === 0);
  return r.stdout;
}
export function child(args, environment) {
  check(!interrupted);
  const process = spawn('docker', args, { env: environment, stdio: ['pipe', 'pipe', 'ignore'] });
  process.stdin.on('error', () => {});
  children.add(process);
  const timer = setTimeout(() => process.kill('SIGKILL'), 240000);
  const done = new Promise((resolve, reject) => {
    process.on('error', () => reject(Error('Release subprocess failed.')));
    process.on('close', (code) => {
      clearTimeout(timer);
      children.delete(process);
      code === 0 ? resolve() : reject(Error('Release subprocess failed.'));
    });
  });
  done.catch(() => {});
  return { process, done };
}
export async function snapshot(compose, environment, name) {
  const script = readFileSync(new URL('./release-snapshot.mjs', import.meta.url), 'utf8');
  const handle = child(
    [
      ...compose,
      'run',
      '--rm',
      '--name',
      name,
      '--no-deps',
      '-T',
      '--entrypoint',
      'node',
      'migrate',
      '--input-type=module',
      '-e',
      script,
    ],
    environment,
  );
  handle.process.stdout.setEncoding('utf8');
  let data = '';
  const ready = new Promise((resolve, reject) => {
    handle.process.stdout.on('data', (chunk) => {
      data += chunk;
      if (data.length > 4 * 1024 * 1024) {
        handle.process.kill('SIGKILL');
        reject(Error('Inventory limit exceeded.'));
      }
      if (data.includes('\n')) {
        try {
          resolve(JSON.parse(data.trim()));
        } catch {
          reject(Error('Inventory rejected.'));
        }
      }
    });
    handle.done.then(() => reject(Error('Snapshot ended early.')), reject);
  });
  return { ...handle, result: await ready };
}
export function cleanupContainer(name, environment) {
  check(/^medi-(backup|recovery)-[a-z0-9-]+$/.test(name));
  try {
    docker(['rm', '-f', name], environment, undefined, { cleanup: true });
  } catch {
    try {
      check(
        !docker(['ps', '-aq', '--filter', `name=^/${name}$`], environment, undefined, {
          cleanup: true,
        }).trim(),
      );
    } catch {
      console.error(`Cleanup failed; inspect container ${name}.`);
      process.exitCode = 1;
    }
  }
}
