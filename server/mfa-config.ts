import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { constants, openSync, closeSync, fstatSync, lstatSync, readSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type pg from 'pg';
import * as OTPAuth from 'otpauth';

export type Envelope = { keyId: string; nonce: string; ciphertext: string; tag: string };
type Ring = { current: string; keys: Record<string, string> };
const unavailable = () => new Error('Authentication configuration unavailable.');
export function syntheticPolicy() {
  const synthetic = process.env.STAFF_MFA_POLICY === 'synthetic';
  if (synthetic && process.env.NODE_ENV === 'production') throw unavailable();
  return synthetic;
}
export function trustedParents(path: string, privateDirectory = false) {
    const uid = process.getuid?.();
    const rootOwner = lstatSync('/').uid;
    // Trusted ancestors must be owned by root/current UID and not writable by others.
    // Root-owned sticky /tmp is safe: other users cannot replace our private child.
    for (let parent = dirname(path);;) {
      const stat = lstatSync(parent);
      if (!stat.isDirectory() || stat.isSymbolicLink() || ![rootOwner,uid].includes(stat.uid) || ((stat.mode & 0o022) && !(stat.uid === rootOwner && (stat.mode & 0o1000)))) throw unavailable();
      if (parent === dirname(parent)) break;
      parent = dirname(parent);
    }
  if(privateDirectory && (lstatSync(dirname(path)).mode & 0o077)) throw unavailable();
}
export function keyring(): Ring {
  try {
    const path = resolve(process.env.STAFF_MFA_KEYRING_FILE ?? '');
    trustedParents(path);
    const uid=process.getuid?.(),rootOwner=lstatSync('/').uid;
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let source: string;
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || ![rootOwner,uid].includes(stat.uid) || (stat.mode & 0o077) || stat.size < 1 || stat.size > 16384) throw unavailable();
      const data = Buffer.alloc(16385);
      let count = 0, read = 0;
      while ((read = readSync(fd,data,count,data.length-count,null)) > 0) { count += read; if (count > 16384) throw unavailable(); }
      source = data.subarray(0,count).toString('utf8');
    } finally { closeSync(fd); }
    const ring = JSON.parse(source) as Ring;
    if (!ring || Object.keys(ring).sort().join(',') !== 'current,keys' || typeof ring.current !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(ring.current) || !ring.keys || Array.isArray(ring.keys) || typeof ring.keys !== 'object' || Object.keys(ring.keys).length > 64 || !Object.hasOwn(ring.keys, ring.current)) throw unavailable();
    for (const [id, value] of Object.entries(ring.keys)) if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw unavailable();
    return ring;
  } catch { throw unavailable(); }
}
const aad = (hospital: string, user: string, purpose: 'factor' | 'pending') => Buffer.from(JSON.stringify(['staff-mfa-v1', hospital, user, purpose]));
export function seal(secret: string, hospital: string, user: string, purpose: 'factor' | 'pending'): Envelope {
  const ring = keyring(); const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(ring.keys[ring.current], 'hex'), nonce, { authTagLength:16 });
  cipher.setAAD(aad(hospital, user, purpose));
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return { keyId: ring.current, nonce: nonce.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}
export function unseal(envelope: Envelope, hospital: string, user: string, purpose: 'factor' | 'pending', ring = keyring()) {
  try {
    if (!envelope || Object.keys(envelope).sort().join(',') !== 'ciphertext,keyId,nonce,tag' || typeof envelope.keyId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(envelope.keyId)) throw unavailable();
    for (const [value,length] of [[envelope.nonce,12],[envelope.tag,16],[envelope.ciphertext,32]] as const) {
      if (typeof value !== 'string' || value.length > 44 || Buffer.from(value,'base64').length !== length || Buffer.from(value,'base64').toString('base64') !== value) throw unavailable();
    }
    if (!Object.hasOwn(ring.keys, envelope.keyId)) throw unavailable();
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(ring.keys[envelope.keyId], 'hex'), Buffer.from(envelope.nonce, 'base64'), { authTagLength:16 });
    decipher.setAAD(aad(hospital, user, purpose)); decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const secret=Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8');
    if (!/^[A-Z2-7]{32}$/.test(secret)) throw unavailable();
    return secret;
  } catch { throw unavailable(); }
}
export function newSecret() { return new OTPAuth.Secret({ size: 20 }).base32; }
export function totp(secret: string) { return new OTPAuth.TOTP({ issuer: 'Hospital workspace', algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) }); }
export function matchedCounter(secret: string, token: string, timestamp: number) {
  if (!/^\d{6}$/.test(token)) return null;
  const delta = totp(secret).validate({ token, timestamp, window: 1 });
  return delta === null ? null : Math.floor(timestamp / 30000) + delta;
}
// One snapshot, 128 envelopes per page, bounded connection/SQL/total time.
export async function validateEnvelopes(pool: pg.Pool) {
  syntheticPolicy();
  const deadline = Date.now()+5000;
  let abandoned = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const connection = pool.connect().then(client => { if (abandoned) { client.release(); throw unavailable(); } return client; });
  let client: pg.PoolClient;
  try { client = await Promise.race([connection,new Promise<never>((_,reject) => { timer=setTimeout(() => { abandoned=true; reject(unavailable()); },1000); })]); }
  catch { throw unavailable(); } finally { clearTimeout(timer); }
  let failed = false;
  try {
    const query = (text: string) => client.query({text,query_timeout:1000} as pg.QueryConfig & {query_timeout:number});
    await query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await query("SET LOCAL statement_timeout='900ms'");
    await query("SET LOCAL lock_timeout='500ms'");
    await query("DECLARE mfa_envelopes NO SCROLL CURSOR FOR SELECT hospital_id,user_id,envelope,'factor' AS purpose FROM staff_factors UNION ALL SELECT hospital_id,user_id,envelope,'pending' AS purpose FROM staff_mfa_pending");
    let ring: Ring | undefined;
    if (process.env.NODE_ENV === 'production' || !syntheticPolicy()) ring=keyring();
    for (;;) {
      if (Date.now() >= deadline) throw unavailable();
      const {rows} = await query('FETCH FORWARD 128 FROM mfa_envelopes');
      if (rows.length && !ring) ring=keyring();
      for (const row of rows) { if (Date.now() >= deadline) throw unavailable(); unseal(row.envelope,row.hospital_id,row.user_id,row.purpose,ring); }
      if (rows.length < 128) break;
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    await query('COMMIT');
  } catch { failed=true; throw unavailable(); }
  finally { client.release(failed); }
}
const readinessState = new WeakMap<pg.Pool,{until:number;error:boolean;pending?:Promise<void>}>();
// Cache either outcome for two seconds; a single shared scan serves concurrent probes.
export async function readiness(pool: pg.Pool) {
  let state=readinessState.get(pool);
  if (state?.pending) return state.pending;
  if (state && Date.now()<state.until) { if (state.error) throw unavailable(); return; }
  state={until:0,error:false}; readinessState.set(pool,state);
  const entry=state;
  entry.pending=validateEnvelopes(pool).then(() => { entry.error=false; },() => { entry.error=true; throw unavailable(); }).finally(() => { entry.until=Date.now()+2000;entry.pending=undefined; });
  return entry.pending;
}
