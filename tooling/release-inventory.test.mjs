import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateManifest } from './release-archive.mjs';
import {
  releaseInventoryProjection,
  compareReleaseInventory,
  validateSecurityInventory,
  compareProductionSecurity,
} from './release-inventory.mjs';
function inventory() {
  return {
    views: [
      {
        viewname: 'patient_directory',
        definition: 'SELECT id FROM patients;',
        reloptions: ['security_invoker=true'],
      },
    ],
    tables: [
      { relname: 'patients', relkind: 'r', relrowsecurity: true, relforcerowsecurity: false },
      {
        relname: 'patient_directory',
        relkind: 'v',
        relrowsecurity: false,
        relforcerowsecurity: false,
      },
    ],
    policies: [
      {
        schemaname: 'public',
        tablename: 'patients',
        policyname: 'tenant_isolation',
        permissive: 'PERMISSIVE',
        roles: ['public'],
        cmd: 'ALL',
        qual: "hospital_id::text = current_setting('medi.hospital_id'::text, true)",
        with_check: "hospital_id::text = current_setting('medi.hospital_id'::text, true)",
      },
    ],
    records: [{ table: 'patients', count: 2, sha256: 'f'.repeat(64) }],
  };
}
function archive(format = 4) {
  const i = inventory();
  for (const k of [
    'columns',
    'constraints',
    'indexes',
    'triggers',
    'functions',
    'schemas',
    'roles',
    'memberships',
    'versions',
    'extensions',
  ])
    i[k] = [];
  i.database = [{ datname: 'product_studio_release' }];
  return {
    format,
    createdAt: '2026-10-14T00:00:00Z',
    config:
      'MEDI_MIGRATION_PASSWORD=' +
      'a'.repeat(64) +
      '\nMEDI_RUNTIME_PASSWORD=' +
      'b'.repeat(64) +
      '\nMEDI_RELEASE_TAG=local\n',
    images: Object.fromEntries(
      ['api', 'database', 'migrate', 'web'].map((k) => [k, 'sha256:' + 'c'.repeat(64)]),
    ),
    version: '16.1',
    fixture: null,
    mfaKeyring: { current: 'old', keys: { old: 'd'.repeat(64) } },
    inventory: i,
  };
}
test('release format4 admits complete policy/view metadata and requires MFA keys', () => {
  assert.doesNotThrow(() => validateManifest(archive()));
  for (const mutate of [
    (m) => delete m.mfaKeyring,
    (m) => delete m.inventory.policies,
    (m) => delete m.inventory.views[0].reloptions,
    (m) => (m.inventory.tables[0].relrowsecurity = 'true'),
    (m) => (m.inventory.policies[0].roles = 'public'),
    (m) => (m.inventory.policies[0].schemaname = 'other'),
    (m) => (m.inventory.policies[0].cmd = 'TRUNCATE'),
    (m) => m.inventory.policies.push({ ...m.inventory.policies[0] }),
  ]) {
    const m = archive();
    mutate(m);
    assert.throws(() => validateManifest(m));
  }
});
test('format4 detects policy expressions/roles, RLS flags and security_invoker changes', () => {
  const expected = inventory();
  for (const mutate of [
    (a) => (a.policies[0].qual = 'true'),
    (a) => (a.policies[0].with_check = 'true'),
    (a) => (a.policies[0].roles = ['medi_runtime']),
    (a) => (a.tables[0].relrowsecurity = false),
    (a) => (a.tables[0].relforcerowsecurity = true),
    (a) => (a.views[0].reloptions = ['security_invoker=false']),
    (a) => (a.records[0].sha256 = 'e'.repeat(64)),
  ]) {
    const actual = structuredClone(expected);
    mutate(actual);
    assert.equal(compareReleaseInventory(actual, expected, 4), false);
  }
  assert.equal(compareReleaseInventory(expected, structuredClone(expected), 4), true);
});
test('historical authenticated formats1/2 preserve exact original projections/hashes', () => {
  for (const format of [1, 2]) {
    const m = archive(format);
    delete m.inventory.policies;
    m.inventory.views = [{ viewname: 'legacy_view', definition: 'SELECT 1;' }];
    m.inventory.tables.forEach((t) => {
      t.relrowsecurity = false;
      t.relforcerowsecurity = false;
    });
    assert.doesNotThrow(() => validateManifest(m));
    const actual = structuredClone(m.inventory);
    actual.policies = [];
    actual.views[0].reloptions = null;
    assert.equal(compareReleaseInventory(actual, m.inventory, format), true);
    const changed = structuredClone(actual);
    changed.records[0].sha256 = 'a'.repeat(64);
    assert.equal(compareReleaseInventory(changed, m.inventory, format), false);
    changed.policies = inventory().policies;
    assert.throws(() => releaseInventoryProjection(changed, format));
    const badView = structuredClone(actual);
    badView.views[0].reloptions = ['security_invoker=true'];
    assert.throws(() => releaseInventoryProjection(badView, format));
    assert.deepEqual(m.inventory.views, [{ viewname: 'legacy_view', definition: 'SELECT 1;' }]);
  }
});
test('production format3 prior view projection remains compatible; new options are enforced', () => {
  const actual = inventory(),
    prior = structuredClone(actual);
  delete prior.views[0].reloptions;
  prior.policies[0].roles = '{public}';
  assert.doesNotThrow(() => validateSecurityInventory(prior, { legacyViewOptions: true }));
  assert.equal(compareProductionSecurity(actual, prior), true);
  const altered = structuredClone(actual);
  altered.views[0].reloptions = ['security_invoker=false'];
  assert.equal(compareProductionSecurity(altered, actual), false);
  altered.policies[0].qual = 'true';
  assert.equal(compareProductionSecurity(altered, prior), false);
  altered.policies = actual.policies;
  altered.tables[0].relrowsecurity = false;
  assert.equal(compareProductionSecurity(altered, prior), false);
});
test('snapshot admits public RLS while retaining unsupported-object checks and view options', () => {
  for (const file of ['release-snapshot.mjs', 'production-snapshot.mjs']) {
    const s = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.ok(!s.includes("'SELECT 1 FROM pg_policy'"));
    assert.ok(s.includes("WHERE n.nspname<>'public'"));
    assert.ok(s.includes('roles::text[] AS roles'));
    assert.ok(s.includes('c.reloptions'));
    for (const catalog of [
      'pg_largeobject_metadata',
      'pg_default_acl',
      'pg_db_role_setting',
      'pg_collation',
      'pg_rewrite',
      'pg_type',
    ])
      assert.ok(s.includes(catalog));
    assert.ok(s.includes('relrowsecurity,c.relforcerowsecurity'));
  }
});
