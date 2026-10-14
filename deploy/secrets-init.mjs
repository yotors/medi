// Separate secret volumes keep owner credentials out of the application runtime.
import { randomBytes } from 'node:crypto';
import {
  lstatSync,
  fsyncSync,
  constants,
  openSync,
  fstatSync,
  readSync,
  closeSync,
  writeFileSync,
  renameSync,
  chmodSync,
  chownSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
const paths = [];
try {
  const fd = openSync(
    '/input/secrets.json',
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  let input;
  try {
    const s = fstatSync(fd);
    if (!s.isFile() || s.mode & 0o077 || s.size < 1 || s.size > 16384) throw Error();
    const data = Buffer.alloc(16385);
    let count = 0,
      read = 0;
    while ((read = readSync(fd, data, count, data.length - count, null)) > 0) {
      count += read;
      if (count > 16384) throw Error();
    }
    input = JSON.parse(data.subarray(0, count).toString());
  } finally {
    closeSync(fd);
  }
  const hex = (s) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
  if (Object.keys(input).sort().join(',') !== 'mfaKeyring,migrationPassword,runtimePassword')
    throw Error();
  if (
    !hex(input.migrationPassword) ||
    !hex(input.runtimePassword) ||
    input.migrationPassword === input.runtimePassword
  )
    throw Error();
  const ring = input.mfaKeyring;
  if (
    !ring ||
    Object.keys(ring).sort().join(',') !== 'current,keys' ||
    typeof ring.current !== 'string' ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(ring.current) ||
    !ring.keys ||
    typeof ring.keys !== 'object' ||
    Array.isArray(ring.keys) ||
    Object.keys(ring.keys).length < 1 ||
    Object.keys(ring.keys).length > 64 ||
    !Object.hasOwn(ring.keys, ring.current)
  )
    throw Error();
  for (const [k, v] of Object.entries(ring.keys))
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(k) || !hex(v)) throw Error();
  function publish(directory, name, contents, uid) {
    mkdirSync(directory, { recursive: true });
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw Error();
    chownSync(directory, uid, uid);
    chmodSync(directory, 0o700);
    const path = directory + '/' + name,
      temp = path + '.' + randomBytes(12).toString('hex') + '.pending';
    paths.push(temp);
    writeFileSync(temp, contents, { mode: 0o600, flag: 'wx' });
    chownSync(temp, uid, uid);
    chmodSync(temp, 0o400);
    const fd = openSync(temp, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
  }
  publish(
    '/api',
    'database-url',
    `postgresql://medi_runtime:${input.runtimePassword}@database:5432/product_studio_release`,
    1000,
  );
  publish('/api', 'mfa-keyring.json', JSON.stringify(ring), 1000);
  publish(
    '/owner',
    'database-url',
    `postgresql://medi_migrator:${input.migrationPassword}@database:5432/product_studio_release`,
    1000,
  );
  publish('/owner', 'runtime-password', input.runtimePassword, 1000);
  publish('/owner', 'mfa-keyring.json', JSON.stringify(ring), 1000);
  publish('/database', 'password', input.migrationPassword, 70);
  if (process.env.MEDI_PROVISION_ALERTS === '1') {
    const fd = openSync(
      '/input/alertmanager.yaml',
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    let config;
    try {
      const s = fstatSync(fd);
      if (!s.isFile() || s.mode & 0o077 || s.size < 1 || s.size > 16384) throw Error();
      const data = Buffer.alloc(16385);
      let count = 0,
        read = 0;
      while ((read = readSync(fd, data, count, data.length - count, null)) > 0) {
        count += read;
        if (count > 16384) throw Error();
      }
      config = data.subarray(0, count).toString();
    } finally {
      closeSync(fd);
    }
    publish('/alerts', 'config.yaml', config, 65534);
  }
} catch {
  for (const p of paths) rmSync(p, { force: true });
  process.stderr.write('Private installation secrets could not be provisioned.\n');
  process.exitCode = 1;
}
