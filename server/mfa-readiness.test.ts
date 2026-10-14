import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type pg from 'pg';
import { keyring, readiness, validateEnvelopes, newSecret, seal } from './mfa-config.ts';
const directory = mkdtempSync(join(tmpdir(), 'mfa-admission-'));
const path = join(directory, 'keys.json');
process.env.STAFF_MFA_KEYRING_FILE = path;
process.env.STAFF_MFA_POLICY = 'required';
const content = JSON.stringify({ current: 'test', keys: { test: '1'.repeat(64) } });
function reset() {
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
}
test('direct keyring admission rejects unsafe files and accepts private operator/runtime files', () => {
  try {
    reset();
    assert.ok(keyring());
    chmodSync(path, 0o400);
    assert.ok(keyring());
    chmodSync(path, 0o644);
    assert.throws(keyring, /unavailable/);
    chmodSync(path, 0o600);
    writeFileSync(path, ' '.repeat(16385));
    assert.throws(keyring, /unavailable/);
    reset();
    const link = join(directory, 'link');
    symlinkSync(path, link);
    process.env.STAFF_MFA_KEYRING_FILE = link;
    assert.throws(keyring, /unavailable/);
    const fifo = join(directory, 'fifo');
    assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
    process.env.STAFF_MFA_KEYRING_FILE = fifo;
    assert.throws(keyring, /unavailable/);
    process.env.STAFF_MFA_KEYRING_FILE = directory;
    assert.throws(keyring, /unavailable/);
    process.env.STAFF_MFA_KEYRING_FILE = path;
    chmodSync(directory, 0o777);
    assert.throws(keyring, /unavailable/);
    chmodSync(directory, 0o700);
  } finally {
    reset();
  }
});
test('readiness pages a complete scan, coalesces calls, caches briefly and recovers after failure', async () => {
  reset();
  const envelope = seal(newSecret(), 'hospital', 'user', 'factor');
  let scans = 0,
    fetches = 0,
    released = 0,
    bad = false;
  const client = {
    query: async ({ text }: { text: string }) => {
      if (text.startsWith('DECLARE')) {
        scans++;
        fetches = 0;
      }
      if (text.startsWith('FETCH')) {
        fetches++;
        return {
          rows: Array.from({ length: fetches === 1 ? 128 : 1 }, () => ({
            hospital_id: 'hospital',
            user_id: 'user',
            purpose: 'factor',
            envelope: bad ? { ...envelope, keyId: 'missing' } : envelope,
          })),
        };
      }
      return { rows: [] };
    },
    release: () => {
      released++;
    },
  };
  const pool = { connect: async () => client } as unknown as pg.Pool;
  await Promise.all(Array.from({ length: 20 }, () => readiness(pool)));
  assert.equal(scans, 1);
  assert.equal(fetches, 2);
  assert.equal(released, 1);
  await readiness(pool);
  assert.equal(scans, 1);
  bad = true;
  await assert.rejects(validateEnvelopes(pool), /unavailable/);
  await new Promise((r) => setTimeout(r, 2050));
  await assert.rejects(readiness(pool), /unavailable/);
  const failedScans = scans;
  await assert.rejects(readiness(pool), /unavailable/);
  assert.equal(scans, failedScans);
  bad = false;
  await new Promise((r) => setTimeout(r, 2050));
  await readiness(pool);
  assert.equal(scans, failedScans + 1);
});
test('readiness total deadline rejects unfinished scan without skipping records', async () => {
  reset();
  const envelope = seal(newSecret(), 'hospital', 'user', 'factor');
  const now = Date.now;
  let elapsed = 0,
    fetches = 0,
    destroyed = false;
  const client = {
    query: async ({ text }: { text: string }) => {
      if (text.startsWith('FETCH')) {
        fetches++;
        elapsed += 1100;
        return {
          rows: Array.from({ length: 128 }, () => ({
            hospital_id: 'hospital',
            user_id: 'user',
            purpose: 'factor',
            envelope,
          })),
        };
      }
      return { rows: [] };
    },
    release: (error: boolean) => {
      destroyed = error;
    },
  };
  Date.now = () => now() + elapsed;
  try {
    await assert.rejects(
      validateEnvelopes({ connect: async () => client } as unknown as pg.Pool),
      /unavailable/,
    );
    assert.equal(fetches, 5);
    assert.equal(destroyed, true);
  } finally {
    Date.now = now;
  }
});
test('readiness bounds pool wait and releases a late connection', async () => {
  let released = false;
  let finish!: (client: unknown) => void;
  const pool = {
    connect: () =>
      new Promise((r) => {
        finish = r;
      }),
  } as unknown as pg.Pool;
  const start = Date.now();
  await assert.rejects(validateEnvelopes(pool), /unavailable/);
  assert.ok(Date.now() - start < 1500);
  finish({
    release: () => {
      released = true;
    },
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(released, true);
  rmSync(directory, { recursive: true, force: true });
});
