import { beforeAll, afterAll, expect, test, vi } from 'vitest';
import { choiceLabel } from './choice-label';
import { initializeI18n, changeLanguage, formatDate, formatMinorCurrency } from '../i18n';
import type { DepartmentChoice } from '../../shared/departments';
beforeAll(async () => {
  vi.stubGlobal('document', { documentElement: { lang: '', dir: '' } });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  await initializeI18n();
});
afterAll(() => vi.unstubAllGlobals());
test('cash labels distinguish refund and reversal while preserving content and exact amounts', async () => {
  await changeLanguage('am');
  const choice = (financeKind: string): DepartmentChoice => ({
    id: financeKind,
    label: 'legacy untouched',
    values: { refundId: financeKind },
    presentation: {
      kind: 'cashEntries',
      values: {
        kind: 'refund',
        financeKind,
        amountMinor: '900719925474099301',
        patientName: 'active',
        recordNumber: '42',
      },
    },
  });
  const refund = choice('refund'),
    reversal = choice('reversal');
  expect(choiceLabel(refund)).toContain('ተመላሽ ክፍያ');
  expect(choiceLabel(reversal)).toContain('መቀልበስ');
  expect(choiceLabel(refund)).toContain('active');
  expect(choiceLabel(refund)).toContain(formatMinorCurrency('900719925474099301'));
  expect(refund.label).toBe('legacy untouched');
  expect(refund.values).toEqual({ refundId: 'refund' });
});
test('shift full timestamps format in selected locale and Addis timezone', async () => {
  const at = '2026-10-14T22:30:45.123Z';
  const choice: DepartmentChoice = {
    id: 'shift',
    label: 'legacy',
    values: {},
    presentation: {
      kind: 'shift',
      values: { ownerName: 'cash', openingMinor: '12345', createdAt: at, status: 'open' },
    },
  };
  for (const language of ['en', 'am']) {
    await changeLanguage(language);
    expect(choiceLabel(choice)).toContain(
      formatDate(new Date(at), { dateStyle: 'medium', timeStyle: 'short' }),
    );
    expect(choiceLabel(choice)).toContain(formatMinorCurrency('12345'));
    expect(choiceLabel(choice)).toContain('cash');
  }
});
