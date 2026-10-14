import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { configuration, immutable } from './production-install.mjs';
import {
  readPrivate,
  initKey,
  loadKey,
  encryptArchive,
  authenticateArchive,
} from './release-archive.mjs';
import { Readable } from 'node:stream';
test('strict production configuration and immutable identities', () => {
  const d = mkdtempSync('/tmp/medi-config-');
  try {
    const c = {
      project: 'medi-prod-test',
      apiImage: 'sha256:' + 'a'.repeat(64),
      webImage: 'registry.test/medi/web@sha256:' + 'b'.repeat(64),
      domain: 'hospital.example.org',
      tlsEmail: 'operator@example.org',
      webhook: 'https://alerts.example.org/private',
      backupDirectory: d,
      hospitalCode: 'hospital',
      hospitalName: 'Named hospital',
      username: 'named.admin',
      operator: 'named-operator',
    };
    assert.equal(configuration(c), c);
    for (const patch of [
      { apiImage: 'medi:latest' },
      { webImage: 'medi:v1' },
      { project: 'medi-release-local' },
      { domain: 'localhost' },
      { domain: 'a.example.org\nEVIL=x' },
      { webhook: 'http://alerts.example.org' },
      { operator: 'unnamed operator' },
      { unexpected: 1 },
    ])
      assert.throws(() => configuration({ ...c, ...patch }));
    assert.equal(immutable('sha256:' + 'a'.repeat(64)), true);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
test('private paths refuse symlinks/public modes and keys never overwrite', () => {
  const d = mkdtempSync('/tmp/medi-private-');
  try {
    const p = join(d, 'key');
    initKey(p);
    assert.equal(loadKey(p).length, 32);
    assert.throws(() => initKey(p));
    symlinkSync(p, join(d, 'link'));
    assert.throws(() => readPrivate(join(d, 'link'), 32));
    chmodSync(p, 0o644);
    assert.throws(() => loadKey(p));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
test('authenticated bounded archive, wrong key/tamper and publication rollback', async () => {
  const d = mkdtempSync('/tmp/medi-archive-');
  try {
    const key = Buffer.alloc(32, 1),
      a = join(d, 'archive');
    await encryptArchive(
      a,
      key,
      { format: 3, actualImage: 'sha256:' + 'a'.repeat(64) },
      Readable.from(['private dump']),
    );
    const good = mkdtempSync(join(d, 'good-'));
    assert.equal((await authenticateArchive(a, key, good)).manifest.format, 3);
    await assert.rejects(
      authenticateArchive(a, Buffer.alloc(32, 2), mkdtempSync(join(d, 'wrong-'))),
    );
    await assert.rejects(encryptArchive(a, key, {}, Readable.from(['overwrite'])));
    const failed = Promise.reject(Error('failed dump'));
    failed.catch(() => {});
    await assert.rejects(
      encryptArchive(join(d, 'rollback'), key, {}, Readable.from(['dump']), failed),
    );
    writeFileSync(a, Buffer.alloc(100, 1));
    await assert.rejects(authenticateArchive(a, key, mkdtempSync(join(d, 'tamper-'))));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
test('unmounted scheduled destination refuses backup and alerts only local synthetic receiver', async () => {
  const { createServer } = await import('node:http');
  const { scheduledBackup } = await import('./production-schedule.mjs');
  const { mkdirSync, readFileSync } = await import('node:fs');
  const d = mkdtempSync('/tmp/medi-schedule-');
  let received;
  const receiver = createServer(async (req, res) => {
    let body = '';
    for await (const part of req) body += part;
    received = JSON.parse(body);
    res.writeHead(204).end();
  });
  try {
    await new Promise((resolve, reject) => {
      receiver.once('error', reject);
      receiver.listen(0, '127.0.0.1', resolve);
    });
    mkdirSync(join(d, 'private'), { mode: 0o700 });
    const c = {
      project: 'medi-prod-schedule',
      apiImage: 'sha256:' + 'a'.repeat(64),
      webImage: 'sha256:' + 'b'.repeat(64),
      domain: 'hospital.example.org',
      tlsEmail: 'operator@example.org',
      webhook: 'https://synthetic.invalid/alerts',
      backupDirectory: d,
      hospitalCode: 'hospital',
      hospitalName: 'Named hospital',
      username: 'named.admin',
      operator: 'named-operator',
    };
    writeFileSync(join(d, 'installation.json'), JSON.stringify(c), { mode: 0o600 });
    writeFileSync(join(d, 'private/secrets.json'), '{}', { mode: 0o600 });
    writeFileSync(join(d, 'sole.medibak'), 'preserved encrypted fixture', { mode: 0o600 });
    await assert.rejects(
      scheduledBackup(d, join(d, 'key'), {
        mounted: () => false,
        notify: async (url, body) => {
          assert.equal(url, c.webhook);
          const r = await fetch('http://127.0.0.1:' + receiver.address().port + '/alerts', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
          assert.equal(r.status, 204);
        },
      }),
    );
    assert.deepEqual(received, { event: 'medi.backup.failed', project: c.project });
    assert.equal(readFileSync(join(d, 'sole.medibak'), 'utf8'), 'preserved encrypted fixture');
  } finally {
    if (receiver.listening) await new Promise((resolve) => receiver.close(resolve));
    rmSync(d, { recursive: true, force: true });
  }
});
