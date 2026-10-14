import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { docker, sourceCompose } from './release-process.mjs';
const call = (args) => docker([...sourceCompose, ...args], process.env);
const get = () =>
  JSON.parse(
    call([
      'exec',
      '-T',
      'receiver',
      'node',
      '--input-type=module',
      '-e',
      "process.stdout.write(await(await fetch('http://127.0.0.1:9094/receipts',{signal:AbortSignal.timeout(3000)})).text());",
    ]),
  ).MediApiUnavailable;
async function wait(predicate) {
  const end = Date.now() + 100000;
  while (Date.now() < end) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw Error();
}
export async function verifyReadinessAlert() {
  let stopped = false;
  let stage = 'initial-receipt';
  try {
    const before = get();
    stage = 'database-stop';
    call(['stop', 'database']);
    stopped = true;
    stage = 'firing-receipt';
    await wait(() => get().firing > before.firing);
    stage = 'database-start';
    call(['up', '-d', '--no-deps', '--wait', '--wait-timeout', '90', 'database']);
    stopped = false;
    stage = 'resolved-receipt';
    await wait(() => get().resolved > before.resolved);
    return {
      result: 'PASS',
      runningApiDatabaseOutage: true,
      firingReceipt: true,
      resolvedReceipt: true,
      humanNotification: false,
    };
  } catch {
    throw Error('Readiness alert drill failed at ' + stage + '; sensitive diagnostics withheld.');
  } finally {
    if (stopped) call(['up', '-d', '--no-deps', 'database']);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await verifyReadinessAlert()));
  } catch {
    console.error('Readiness alert drill failed; sensitive diagnostics withheld.');
    process.exitCode = 1;
  }
}
