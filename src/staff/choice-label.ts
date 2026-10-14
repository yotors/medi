import type { DepartmentChoice } from '../../shared/departments';
import { t, presentationLabel, formatMinorCurrency, formatDate } from '../i18n';
/** Structured labels keep patient/catalog content separate from interface words. */
export function choiceLabel(choice: DepartmentChoice) {
  const presentation = choice.presentation;
  if (
    !presentation ||
    ![
      'specimen',
      'return',
      'purchase',
      'shift',
      'orders',
      'batches',
      'dispenses',
      'invoices',
      'payments',
      'cashEntries',
    ].includes(presentation.kind)
  )
    return choice.label;
  const values = presentation.values;
  const person =
    t('choices:patient', { name: values.patientName, number: values.recordNumber }) +
    (values.canonicalRecordNumber
      ? t('choices:linked', { number: values.canonicalRecordNumber })
      : '');
  const extra =
    presentation.kind === 'orders' && !values.catalogId
      ? t('choices:historical')
      : presentation.kind === 'batches' && values.quarantined
        ? t('choices:quarantined')
        : '';
  return t(`choices:${presentation.kind}`, {
    ...values,
    ...Object.fromEntries(
      ['opening', 'net', 'paid', 'amount', 'remaining'].map((key) => [
        key,
        formatMinorCurrency(String(values[key + 'Minor'] ?? '0')),
      ]),
    ),
    createdAt: values.createdAt
      ? formatDate(new Date(String(values.createdAt)), { dateStyle: 'medium', timeStyle: 'short' })
      : '',
    person,
    extra,
    status: presentationLabel(values.status),
    method: presentationLabel(values.method),
    kind: presentationLabel(values.kind),
    entry:
      values.entryLabel ||
      t('choices:recorded_kind', { kind: presentationLabel(values.financeKind) }),
    direction: values.direction === 'received' ? t('choices:received') : t('choices:paid_out'),
  });
}
