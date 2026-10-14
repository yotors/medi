import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { constants, fstatSync, lstatSync, openSync, closeSync, readFileSync, writeFileSync, fsyncSync, linkSync, unlinkSync, createReadStream, createWriteStream, mkdtempSync, rmSync } from 'node:fs';
import { dirname, resolve, parse, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { operationSignal } from './release-cancellation.mjs';
import { Readable, Transform } from 'node:stream';
export const MAX_ARCHIVE = 1024 ** 3, MAX_MANIFEST = 4 * 1024 ** 2;
const MAGIC = Buffer.from('MEDIBAK1');
export const check = value => { if (!value) throw Error('Release recovery validation failed; diagnostics withheld.'); };
export function privatePath(path, file = true, limit = MAX_ARCHIVE) {
  path = resolve(path);
  let current = parse(path).root;
  const systemOwner = lstatSync(current).uid;
  const parts = path.slice(current.length).split('/');
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    const s = lstatSync(current);
    check(!s.isSymbolicLink());
    check(s.uid === process.getuid() || s.uid === systemOwner);
    if (i < parts.length - 1 || !file) {
      const safeTemporaryRoot = current === '/tmp' && s.uid === systemOwner && (s.mode & 0o1000);
      check(s.isDirectory() && (!(s.mode & 0o022) || safeTemporaryRoot));
    }
    if (i === parts.length - 1) check(file ? s.isFile() && s.size <= limit && !(s.mode & 0o077) : s.isDirectory() && !(s.mode & 0o077));
  }
  if (file) privatePath(dirname(path), false);
  return path;
}
export function readPrivate(path, limit) {
  privatePath(path, true, limit);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { return readFileSync(fd); } finally { closeSync(fd); }
}
export function initKey(path) {
  privatePath(dirname(resolve(path)), false);
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, randomBytes(32)); fsyncSync(fd); } finally { closeSync(fd); }
}
export function loadKey(path) { const key = readPrivate(path, 32); check(key.length === 32); return key; }
export function configValues(config) {
  check(typeof config === 'string' && /^MEDI_MIGRATION_PASSWORD=[a-f0-9]{64}\nMEDI_RUNTIME_PASSWORD=[a-f0-9]{64}\nMEDI_RELEASE_TAG=[a-z0-9][a-z0-9_.-]{0,63}\n$/.test(config));
  return Object.fromEntries(config.trim().split('\n').map(line => line.split('=')));
}
export function scratch(parent) { privatePath(parent, false); return mkdtempSync(join(parent, 'recovery-')); }
function bound(max) { let size = 0; return new Transform({ transform(chunk, encoding, done) { size += chunk.length; done(size > max ? Error('Archive limit exceeded.') : null, chunk); } }); }
export async function encryptArchive(path, key, manifest, dump, completion = Promise.resolve(), options = {}) {
  const signal = operationSignal(options); signal.throwIfAborted();
  privatePath(dirname(resolve(path)), false);
  const temporary = `${path}.${randomBytes(12).toString('hex')}.partial`;
  const fd = openSync(temporary, 'wx', 0o600);
  const owned = fstatSync(fd); let published = false;
  const cancelDump = () => dump.destroy?.(Error('Archive operation cancelled.'));
  signal.addEventListener('abort', cancelDump, { once: true });
  try {
    const metadata = Buffer.from(JSON.stringify(manifest)); check(metadata.length <= MAX_MANIFEST);
    const length = Buffer.alloc(4); length.writeUInt32BE(metadata.length);
    const nonce = randomBytes(12), header = Buffer.concat([MAGIC, nonce]);
    const cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(header);
    writeFileSync(fd, header);
    const input = Readable.from((async function* () { yield length; yield metadata; for await (const chunk of dump) yield chunk; })());
    await pipeline(input, bound(MAX_ARCHIVE - 36), cipher, createWriteStream(temporary, { fd, autoClose: false }), { signal });
    await Promise.race([completion, new Promise((_, reject) => { if(signal.aborted) reject(signal.reason); else signal.addEventListener('abort', () => reject(signal.reason), { once: true }); })]);
    signal.throwIfAborted();
    writeFileSync(fd, cipher.getAuthTag()); fsyncSync(fd);
    await new Promise(resolve => setImmediate(resolve));
    // Hard-link publication is atomic and cannot replace an existing archive.
    signal.throwIfAborted();
    linkSync(temporary, path); published = true;
    const parent = openSync(dirname(resolve(path)), 'r'); try { (options.syncDirectory ?? fsyncSync)(parent); } finally { closeSync(parent); }
  } catch (error) {
    if (published) { const current = lstatSync(path); if (current.dev === owned.dev && current.ino === owned.ino) unlinkSync(path); }
    throw error;
  } finally { signal.removeEventListener('abort', cancelDump); try { closeSync(fd); } catch {} finally { unlinkSync(temporary); } }
}
export async function authenticateArchive(path, key, directory, options = {}) {
  const signal = operationSignal(options); signal.throwIfAborted();
  privatePath(path); privatePath(directory, false);
  const size = lstatSync(path).size; check(size > 40 && size <= MAX_ARCHIVE);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const plain = join(directory, 'authenticated');
  try {
    const { readSync } = await import('node:fs');
    const header = Buffer.alloc(20), tag = Buffer.alloc(16);
    check(readSync(fd, header, 0, 20, 0) === 20 && header.subarray(0, 8).equals(MAGIC));
    check(readSync(fd, tag, 0, 16, size - 16) === 16);
    const cipher = createDecipheriv('aes-256-gcm', key, header.subarray(8)); cipher.setAAD(header); cipher.setAuthTag(tag);
    await pipeline(createReadStream(path, { fd, autoClose: false, start: 20, end: size - 17 }), cipher, createWriteStream(plain, { flags: 'wx', mode: 0o600 }), { signal });
    signal.throwIfAborted();
    // No manifest bytes are interpreted until final GCM authentication succeeds.
    const pfd = openSync(plain, 'r');
    try {
      const length = Buffer.alloc(4); check(readSync(pfd, length, 0, 4, 0) === 4);
      const count = length.readUInt32BE(); check(count > 0 && count <= MAX_MANIFEST && count + 40 < size);
      const data = Buffer.alloc(count); check(readSync(pfd, data, 0, count, 4) === count);
      return { manifest: JSON.parse(data.toString()), dump: plain, offset: count + 4 };
    } finally { closeSync(pfd); }
  } catch { rmSync(plain, { force: true }); throw Error('Archive authentication or format rejected.'); }
  finally { closeSync(fd); }
}
export function validateManifest(m) {
  check(m && [1,2].includes(m.format) && typeof m.createdAt === 'string' && Number.isFinite(Date.parse(m.createdAt)));
  configValues(m.config);
  if (m.format === 2) {
    check(m.mfaKeyring && Buffer.byteLength(JSON.stringify(m.mfaKeyring))<=16384 && Object.keys(m.mfaKeyring).sort().join(',')==='current,keys' && typeof m.mfaKeyring.current==='string' && /^[A-Za-z0-9_-]{1,64}$/.test(m.mfaKeyring.current) && m.mfaKeyring.keys && typeof m.mfaKeyring.keys==='object' && !Array.isArray(m.mfaKeyring.keys) && Object.keys(m.mfaKeyring.keys).length<=64 && Object.hasOwn(m.mfaKeyring.keys,m.mfaKeyring.current));
    for (const [id,key] of Object.entries(m.mfaKeyring.keys)) check(/^[A-Za-z0-9_-]{1,64}$/.test(id) && typeof key==='string' && /^[a-f0-9]{64}$/.test(key));
  }
  check(m.images && Object.keys(m.images).sort().join(',') === 'api,database,migrate,web');
  for(const id of Object.values(m.images)) check(typeof id === 'string' && /^sha256:[a-f0-9]{64}$/.test(id));
  check(m.images.api === m.images.migrate && typeof m.version === 'string' && /^16\./.test(m.version));
  const names=['views','tables','columns','constraints','indexes','triggers','functions','schemas','roles','memberships','database','versions','extensions','records'];
  check(m.inventory && Object.keys(m.inventory).sort().join(',') === names.sort().join(','));
  for(const name of names) check(Array.isArray(m.inventory[name]) && m.inventory[name].length <= 10000);
  check(m.inventory.database.length === 1 && m.inventory.database[0].datname === 'product_studio_release');
  for(const r of m.inventory.records) check(typeof r.table === 'string' && /^[a-z_][a-z0-9_]*$/.test(r.table) && Number.isSafeInteger(r.count) && r.count >= 0 && /^[a-f0-9]{64}$/.test(r.sha256));
  if(m.fixture !== null) check(m.fixture && /^release-[a-f0-9-]{8}$/.test(m.fixture.hospitalCode) && m.fixture.username === 'admin' && /^[a-f0-9]{64}$/.test(m.fixture.password) && (m.fixture.patientId === undefined || /^[a-f0-9-]{36}$/.test(m.fixture.patientId)));
}
