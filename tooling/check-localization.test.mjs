import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCatalog, renderedLiterals, validateSourceKeys } from './check-localization.mjs';
const english = { action: 'Action', rows_one: '{{count}} row', rows_other: '{{count}} rows' };
test('French cognates and locale plural categories are valid', () => {
  validateCatalog(
    english,
    {
      action: 'Action',
      rows_one: '{{count}} ligne',
      rows_many: '{{count}} lignes',
      rows_other: '{{count}} lignes',
    },
    'fr',
  );
});
test('Arabic requires all six categories, Japanese only other', () => {
  const arabic = {
    action: 'إجراء',
    ...Object.fromEntries(
      ['zero', 'one', 'two', 'few', 'many', 'other'].map((category) => [
        'rows_' + category,
        '{{count}} صف',
      ]),
    ),
  };
  validateCatalog(english, arabic, 'ar');
  delete arabic.rows_few;
  assert.throws(() => validateCatalog(english, arabic, 'ar'), /missing rows_few/);
  validateCatalog(english, { action: '操作', rows_other: '{{count}} 行' }, 'ja');
  assert.throws(
    () => validateCatalog(english, { action: 'Action', rows_other: '{{count}} 行' }, 'ja'),
    /untranslated English/,
  );
});
test('rendered literals include JSX and conditional branches but exclude protocol props and translation arguments', () => {
  assert.deepEqual(
    renderedLiterals(
      `<div><p>English residue</p>{ok ? 'active' : 'inactive'}<input type={ok ? 'text' : 'number'} aria-label="English label" />{t('common:save')}<b>Medi</b></div>`,
    ),
    ['English residue', 'active', 'inactive', 'English label'],
  );
});

test('conditional translation calls cannot hide missing keys', () => {
  assert.throws(
    () =>
      validateSourceKeys("t(kind ? 'common:missing' : 'common:save')", {
        'common.json': { save: 'Save' },
      }),
    /unknown key common:missing/,
  );
  validateSourceKeys("t(kind ? 'common:save' : 'common:cancel')", {
    'common.json': { save: 'Save', cancel: 'Cancel' },
  });
});
