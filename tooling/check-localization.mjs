import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { parse } from '@babel/parser';
const suffix = /_(zero|one|two|few|many|other)$/;
const tokens = (s) => [...s.matchAll(/{{\s*([^}]+)\s*}}/g)].map((m) => m[1]).sort();
export function validateCatalog(source, translated, language) {
  const categories = new Intl.PluralRules(language).resolvedOptions().pluralCategories;
  const base = (key) => key.replace(suffix, '');
  const bases = (catalog) => [...new Set(Object.keys(catalog).map(base))].sort();
  assert.deepEqual(bases(translated), bases(source), `${language}: semantic key parity`);
  const pluralBases = new Set(
    Object.keys(source)
      .filter((k) => suffix.test(k))
      .map(base),
  );
  for (const key of pluralBases)
    for (const category of categories)
      assert.ok(
        Object.hasOwn(translated, `${key}_${category}`),
        `${language}: missing ${key}_${category}`,
      );
  for (const [key, result] of Object.entries(translated)) {
    const sourceKey = Object.hasOwn(source, key) ? key : `${base(key)}_other`;
    const value = source[sourceKey];
    assert.equal(typeof value, 'string', `${language}: unknown ${key}`);
    assert.equal(typeof result, 'string');
    assert.ok(result.trim(), `${language}:${key} is empty`);
    assert.deepEqual(tokens(result), tokens(value), `${language}:${key} interpolation`);
    const script = new Intl.Locale(language).maximize().script;
    // Latin-script languages may legitimately share cognates with English. For other scripts,
    // unchanged English prose is a residue signal, not a claim of linguistic correctness.
    if (script !== 'Latn' && /[A-Za-z]/.test(value.replace(/{{[^}]+}}/g, '')))
      assert.notEqual(result, value, `${language}:${key} untranslated English placeholder`);
  }
}
// Exact rendered exceptions only: brand/technical identifiers and clearly fictional preview data.
export const renderedExclusions = new Map([
  ['Medi', 'Product brand'],
  ['Hana Tesfaye', 'Fictional preview person, never a translated interface label'],
  ['Dawit Bekele', 'Fictional preview person, never a translated interface label'],
  ['ETB', 'ISO currency code'],
  ['MRN', 'Medical record identifier acronym'],
  ['Medi · Africa/Addis_Ababa ·', 'Product brand and IANA timezone identifier'],
]);
export function renderedLiterals(source) {
  const tree = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const found = [];
  const add = (value) => {
    const text = value.replace(/\s+/g, ' ').trim();
    if (/[A-Za-z]/.test(text) && !renderedExclusions.has(text)) found.push(text);
  };
  function expression(node) {
    if (!node) return;
    if (node.type === 'StringLiteral') add(node.value);
    else if (node.type === 'ConditionalExpression') {
      expression(node.consequent);
      expression(node.alternate);
    } else if (node.type === 'LogicalExpression') expression(node.right);
    else if (node.type === 'ArrayExpression') node.elements.forEach(expression);
    else if (node.type === 'BinaryExpression' && node.operator === '+') {
      expression(node.left);
      expression(node.right);
    }
  }
  function visit(node, parent) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'JSXText') add(node.value);
    if (
      node.type === 'JSXExpressionContainer' &&
      (parent?.type !== 'JSXAttribute' ||
        ['aria-label', 'title', 'placeholder', 'alt'].includes(parent.name?.name))
    )
      expression(node.expression);
    if (
      node.type === 'JSXAttribute' &&
      ['aria-label', 'title', 'placeholder', 'alt'].includes(node.name?.name)
    ) {
      if (node.value?.type === 'StringLiteral') add(node.value.value);
    }
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'start', 'end', 'extra'].includes(key)) continue;
      if (Array.isArray(value)) value.forEach((child) => visit(child, node));
      else if (value && typeof value === 'object') visit(value, node);
    }
  }
  visit(tree);
  return found;
}
export function validateSourceKeys(source, catalogs, path = 'fixture') {
  const tree = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  function keys(node) {
    if (node?.type === 'StringLiteral') return [node.value];
    if (node?.type === 'ConditionalExpression')
      return [...keys(node.consequent), ...keys(node.alternate)];
    if (node?.type === 'LogicalExpression') return keys(node.right);
    return [];
  }
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && ['t', 'uiMessage'].includes(node.callee?.name))
      for (const value of keys(node.arguments[0])) {
        if (!value.includes(':')) continue;
        const [namespace, key] = value.split(':');
        const catalog = catalogs[namespace + '.json'] ?? {};
        assert.ok(
          Object.hasOwn(catalog, key) || Object.hasOwn(catalog, key + '_other'),
          `${path}: unknown key ${value}`,
        );
      }
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'start', 'end', 'extra'].includes(key)) continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(tree);
}
export function checkLocalization() {
  const root = new URL('../src/i18n/', import.meta.url);
  const catalogs = (language) =>
    Object.fromEntries(
      readdirSync(new URL(language + '/', root))
        .filter((f) => f.endsWith('.json'))
        .map((file) => [
          file,
          JSON.parse(readFileSync(new URL(language + '/' + file, root), 'utf8')),
        ]),
    );
  const english = catalogs('en');
  const languages = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  let count = 0;
  for (const language of languages) {
    const translated = catalogs(language);
    assert.deepEqual(
      Object.keys(translated).sort(),
      Object.keys(english).sort(),
      `${language}: namespaces`,
    );
    for (const [namespace, source] of Object.entries(english)) {
      validateCatalog(source, translated[namespace], language);
      count += Object.keys(translated[namespace]).length;
    }
  }
  function checkSource(path) {
    const source = readFileSync(path, 'utf8');
    validateSourceKeys(source, english, path);
    if (
      /(?:ProductHome|HospitalConfiguration|ClinicalCorrections|InventoryHistory|VisitPanel|StaffAdministration|StaffApp|DepartmentPicker)\.tsx$/.test(
        path,
      )
    )
      assert.deepEqual(renderedLiterals(source), [], `${path}: rendered English literals`);
  }
  function sources(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) sources(child);
      else if (/\.tsx?$/.test(entry.name)) checkSource(child);
    }
  }
  sources(new URL('../src', import.meta.url).pathname);
  console.log(
    `Localization catalogs passed: ${count} values across ${languages.length} languages. Static key and scoped rendered-literal checks passed; runtime and semantic review remain necessary.`,
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  checkLocalization();
