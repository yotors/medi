import { readFileSync, lstatSync } from 'node:fs';
import { resolve, dirname, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
export function validateInstall(input) {
  const failed = [];
  const check = (name, condition) => {
    if (!condition) failed.push(name);
  };
  check('bundle_version', input?.version === 1);
  let origin;
  try {
    origin = new URL(input.origin);
  } catch {}
  check(
    'https_origin',
    origin?.protocol === 'https:' &&
      origin.origin === input.origin &&
      !origin.username &&
      !origin.password &&
      !['localhost', '127.0.0.1'].includes(origin.hostname),
  );
  check(
    'proxy_boundary',
    input.proxyHops === 1 &&
      input.apiPrivate === true &&
      input.databasePrivate === true &&
      input.monitoringPrivate === true,
  );
  check('topology', ['dedicated-hosted', 'hospital-local'].includes(input.topology));
  check(
    'immutable_images',
    ['api', 'web', 'database', 'collector', 'prometheus', 'alertmanager'].every(
      (name) =>
        typeof input.images?.[name] === 'string' &&
        /^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(input.images[name]),
    ),
  );
  check('release_identity', /^[a-f0-9]{40}$/.test(input.git ?? '') && input.schema === 15);
  for (const name of ['mfaKeyring', 'backupKey', 'backupArchive']) {
    try {
      const path = resolve(input.privateFiles?.[name] ?? '');
      let parent = dirname(path);
      while (parent !== parse(parent).root) {
        if (lstatSync(parent).isSymbolicLink()) throw Error();
        parent = dirname(parent);
      }
      const stat = lstatSync(path);
      check(
        'private_' + name,
        stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0,
      );
    } catch {
      failed.push('private_' + name);
    }
  }
  for (const name of [
    'restrictedGrants',
    'schemaCompatible',
    'keyReferences',
    'restoreVerified',
    'backupImagesAvailable',
    'collectorHealthy',
    'diskBudget',
    'rotationConfigured',
  ])
    check(name, input.evidence?.[name] === true);
  // These decisions are explicitly external. This tool never invents acceptance.
  for (const name of [
    'operator',
    'domain',
    'tls',
    'dataLocation',
    'clinicalAcceptance',
    'legalAcceptance',
    'alertEscalation',
    'independentBackupCustody',
  ])
    check('decision_' + name, input.decisions?.[name] === true);
  return { configurationValid: failed.length === 0, runtimeVerified: false, ready: false, failed };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = validateInstall(JSON.parse(readFileSync(process.argv[2], 'utf8')));
    console.log(JSON.stringify(result));
    if (!result.ready) process.exitCode = 1;
  } catch {
    console.log(JSON.stringify({ ready: false, failed: ['input'] }));
    process.exitCode = 1;
  }
}
