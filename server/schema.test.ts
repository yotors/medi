import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateHistory } from './schema.ts';
import { schemaManifest } from './schema-manifest.ts';
test('history refuses future, gaps, duplicates, missing history and changed checksums', () => {
  const full = schemaManifest.map((entry) => ({ version: entry.version, checksum: entry.sha256 }));
  assert.doesNotThrow(() => validateHistory(full, true));
  for (const bad of [
    [{ version: 999 }],
    full.slice(1),
    [full[0], full[0]],
    [...full, { version: 999, checksum: 'bad' }],
  ])
    assert.throws(() => validateHistory(bad));
  assert.throws(() => validateHistory(full.slice(0, -1), true));
  assert.throws(() =>
    validateHistory(
      full.map((row) => ({ ...row, checksum: 'bad' })),
      true,
    ),
  );
});
