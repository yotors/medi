import { isDeepStrictEqual } from 'node:util';
// Older production snapshots encoded PostgreSQL name[] as an array literal.
// Historical Medi policies used ordinary unquoted role names.
const policyRoles = (roles) =>
  typeof roles === 'string' &&
  roles.length <= 1048576 &&
  /^\{[A-Za-z_][A-Za-z0-9_]*(?:,[A-Za-z_][A-Za-z0-9_]*)*\}$/.test(roles)
    ? roles.slice(1, -1).split(',')
    : roles;
const check = (value) => {
  if (!value) throw Error('Archive inventory validation failed.');
};
// New release format4 captures policies and view options. Historical formats1/2
// admitted no policies; their original projection and record hashes remain exact.
export function releaseInventoryProjection(inventory, format) {
  if (format === 4) return inventory;
  check(format === 1 || format === 2);
  check(!inventory.policies?.length);
  const { policies, ...historical } = inventory;
  historical.views = inventory.views.map((view) => {
    check(
      view.reloptions === undefined ||
        view.reloptions === null ||
        (Array.isArray(view.reloptions) && view.reloptions.length === 0),
    );
    const { reloptions, ...original } = view;
    return original;
  });
  return historical;
}
export function compareReleaseInventory(actual, expected, format) {
  return isDeepStrictEqual(releaseInventoryProjection(actual, format), expected);
}
export function validateSecurityInventory(inventory, { legacyViewOptions = false } = {}) {
  const name = (x) =>
    typeof x === 'string' &&
    Buffer.byteLength(x) > 0 &&
    Buffer.byteLength(x) <= 63 &&
    !x.includes('\0');
  check(Array.isArray(inventory.policies) && inventory.policies.length <= 10000);
  const relations = new Map(inventory.tables.map((t) => [t.relname, t])),
    seen = new Set();
  for (const table of inventory.tables)
    check(
      typeof table.relrowsecurity === 'boolean' && typeof table.relforcerowsecurity === 'boolean',
    );
  for (const policy of inventory.policies) {
    check(
      policy &&
        Object.keys(policy).sort().join(',') ===
          'cmd,permissive,policyname,qual,roles,schemaname,tablename,with_check',
    );
    check(
      policy.schemaname === 'public' &&
        name(policy.tablename) &&
        relations.get(policy.tablename)?.relkind === 'r' &&
        name(policy.policyname) &&
        ['PERMISSIVE', 'RESTRICTIVE'].includes(policy.permissive) &&
        ['ALL', 'SELECT', 'INSERT', 'UPDATE', 'DELETE'].includes(policy.cmd),
    );
    check(
      Array.isArray(legacyViewOptions ? policyRoles(policy.roles) : policy.roles) &&
        policyRoles(policy.roles).length > 0 &&
        policyRoles(policy.roles).length <= 10000 &&
        policyRoles(policy.roles).every(name),
    );
    for (const expression of [policy.qual, policy.with_check])
      check(
        expression === null ||
          (typeof expression === 'string' &&
            Buffer.byteLength(expression) <= 1048576 &&
            !expression.includes('\0')),
      );
    const id = JSON.stringify([policy.tablename, policy.policyname]);
    check(!seen.has(id));
    seen.add(id);
  }
  for (const view of inventory.views) {
    check(name(view.viewname) && typeof view.definition === 'string');
    if (legacyViewOptions && !Object.hasOwn(view, 'reloptions')) continue;
    check(
      Object.hasOwn(view, 'reloptions') &&
        (view.reloptions === null ||
          (Array.isArray(view.reloptions) &&
            view.reloptions.length <= 64 &&
            view.reloptions.every(
              (x) => typeof x === 'string' && x.length <= 256 && !x.includes('\0'),
            ))),
    );
  }
}
// Format3 production archives predating reloptions keep their original projection;
// options are compared whenever that archive actually authenticated them.
export function compareProductionSecurity(actual, expected) {
  const views = actual.views.map((view) => {
    if (
      expected.views.find((v) => v.viewname === view.viewname) &&
      !Object.hasOwn(
        expected.views.find((v) => v.viewname === view.viewname),
        'reloptions',
      )
    ) {
      const { reloptions, ...old } = view;
      return old;
    }
    return view;
  });
  return (
    isDeepStrictEqual(
      actual.policies.map((p) => ({ ...p, roles: policyRoles(p.roles) })),
      expected.policies.map((p) => ({ ...p, roles: policyRoles(p.roles) })),
    ) &&
    isDeepStrictEqual(actual.tables, expected.tables) &&
    isDeepStrictEqual(views, expected.views)
  );
}
