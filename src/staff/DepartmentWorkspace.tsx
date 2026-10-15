import { choiceLabel } from './choice-label';
import { fieldLabel } from '../i18n';
import { uiMessage } from '../i18n';
import { presentationLabel } from '../i18n';
import { interfaceMessage } from '../i18n';
import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { hospitalDate } from './date';
import type { Session } from '../../shared/registration';
import {
  departmentCommandSchema,
  type DepartmentCommand,
  type DepartmentPage,
  type DepartmentRecord,
  type DepartmentEvent,
  type DepartmentChoice,
  type DepartmentSourceQuery,
} from '../../shared/departments';
import { formatETB, parseETB } from '../../shared/configuration';
import { request, ApiError } from './api';
import DepartmentPicker from './DepartmentPicker';
import './departments.css';
import { isPlainLinkClick } from './navigation';
type Props = {
  section: string;
  onSectionChange: (section: string, replace?: boolean) => boolean;
  session: Session;
  onSessionError: (error: unknown) => void;
  onDirty?: (value: boolean) => void;
  onPending?: (value: boolean) => void;
};
type Field = {
  key: string;
  label: string;
  kind?: 'number' | 'money' | 'checkbox' | 'textarea' | 'select' | 'hidden';
  choices?: string[];
  optional?: boolean;
  source?: DepartmentSourceQuery['kind'] | 'current';
  virtual?: boolean;
};
const field = (
  key: string,
  label: string,
  kind?: Field['kind'],
  extra: Partial<Field> = {},
): Field => ({
  key,
  get label() {
    return t(label);
  },
  kind,
  ...extra,
});
const hidden = (key: string, optional = false) => field(key, '', 'hidden', { optional });
const target = [
    field('id', 'labels:record', 'select', { source: 'current' }),
    hidden('expectedRevision'),
  ],
  reason = field('reason', 'labels:reason', 'textarea');
const specs: Record<string, { label: string; category: string; fields: Field[]; admin?: boolean }> =
  {
    'lab.catalog': {
      get label() {
        return t('departments:configure_laboratory_test');
      },
      category: 'catalog',
      admin: true,
      fields: [
        field('code', 'labels:test_code'),
        field('name', 'labels:test_name'),
        field('specimen', 'labels:specimen_type'),
        field('unit', 'labels:result_unit'),
        field('criticalLow', 'labels:critical_lower_threshold', 'number', { optional: true }),
        field('criticalHigh', 'labels:critical_upper_threshold', 'number', { optional: true }),
      ],
    },
    'lab.register': {
      get label() {
        return t('departments:register_specimen');
      },
      category: 'specimen',
      fields: [
        field('orderId', 'labels:patient_investigation_order', 'select', { source: 'orders' }),
        hidden('visitId'),
        field('catalogId', 'labels:matching_configured_laboratory_test', 'select', {
          source: 'catalog',
        }),
        field('accession', 'labels:accession'),
        field('clinicianId', 'labels:responsible_clinician', 'select', { source: 'clinicians' }),
      ],
    },
    'lab.collect': {
      get label() {
        return t('common:record_collection');
      },
      category: 'specimen',
      fields: target,
    },
    'lab.receive': {
      get label() {
        return t('departments:record_specimen_receipt');
      },
      category: 'specimen',
      fields: target,
    },
    'lab.reject': {
      get label() {
        return t('departments:reject_specimen');
      },
      category: 'specimen',
      fields: [...target, reason],
    },
    'lab.recollect': {
      get label() {
        return t('departments:request_recollection');
      },
      category: 'specimen',
      fields: [...target, field('accession', 'labels:new_accession'), reason],
    },
    'lab.result': {
      get label() {
        return t('departments:enter_or_correct_result');
      },
      category: 'specimen',
      fields: [
        ...target,
        field('value', 'labels:result', 'textarea'),
        field('numericValue', 'labels:numeric_value', 'number', { optional: true }),
        field('critical', 'labels:flag_critical_result', 'checkbox'),
        field('reason', 'labels:correction_reason_required_for_subsequent_versions', 'textarea', {
          optional: true,
        }),
      ],
    },
    'lab.release': {
      get label() {
        return t('common:release_result');
      },
      category: 'specimen',
      fields: target,
    },
    'lab.acknowledge': {
      get label() {
        return t('departments:acknowledge_accountable_result_review');
      },
      category: 'specimen',
      fields: [
        ...target,
        field('delivery', 'labels:delivery_record', 'textarea'),
        field('acknowledgement', 'labels:acknowledgement_and_action', 'textarea'),
      ],
    },
    'supplier.create': {
      get label() {
        return t('departments:add_supplier');
      },
      category: 'supplier',
      fields: [field('name', 'labels:supplier_name'), field('contact', 'labels:supplier_contact')],
    },
    'purchase.create': {
      get label() {
        return t('departments:request_purchase');
      },
      category: 'purchase',
      fields: [field('supplierId', 'labels:supplier', 'select', { source: 'supplier' })],
    },
    'purchase.approve': {
      get label() {
        return t('departments:approve_purchase');
      },
      category: 'purchase',
      admin: true,
      fields: [...target, reason],
    },
    'purchase.receive': {
      get label() {
        return t('departments:receive_purchase_line');
      },
      category: 'purchase',
      fields: [
        ...target,
        field('line', 'labels:purchase_line', 'select'),
        field('batchId', 'labels:stock_batch', 'select', { source: 'batches' }),
        hidden('expectedBatchRevision'),
        field('quantity', 'labels:packs_received', 'number'),
        field('authorization', 'labels:responsible_controlled_item_authorization', 'textarea', {
          optional: true,
        }),
      ],
    },
    'purchase.cancel': {
      get label() {
        return t('departments:cancel_unreceived_remainder');
      },
      category: 'purchase',
      fields: [...target, reason],
    },
    'return.record': {
      get label() {
        return t('departments:record_patient_return_into_quarantine');
      },
      category: 'return',
      fields: [
        field('dispenseId', 'labels:patient_dispense', 'select', { source: 'dispenses' }),
        field('quantity', 'labels:returned_stock_units', 'number'),
        reason,
      ],
    },
    'return.quality': {
      get label() {
        return t('departments:authorize_return_quality_decision');
      },
      category: 'return',
      admin: true,
      fields: [
        ...target,
        field('qualityBatch', 'labels:original_stock_batch', 'select', {
          source: 'batches',
          virtual: true,
        }),
        hidden('expectedBatchRevision'),
        field('decision', 'labels:quality_decision', 'select', { choices: ['restock', 'destroy'] }),
        reason,
      ],
    },
    'invoice.credit': {
      get label() {
        return t('departments:approve_invoice_credit_or_discount');
      },
      category: 'finance',
      admin: true,
      fields: [
        field('invoiceId', 'labels:patient_invoice', 'select', { source: 'invoices' }),
        hidden('expectedRevision'),
        field('amountMinor', 'labels:amount_etb', 'money'),
        field('kind', 'labels:adjustment', 'select', { choices: ['credit', 'discount'] }),
        reason,
      ],
    },
    'payment.refund': {
      get label() {
        return t('departments:approve_recorded_refund_or_reversal');
      },
      category: 'finance',
      admin: true,
      fields: [
        field('invoiceId', 'labels:patient_invoice', 'select', { source: 'invoices' }),
        hidden('expectedRevision'),
        field('paymentId', 'labels:original_receipt', 'select', { source: 'payments' }),
        field('amountMinor', 'labels:amount_etb', 'money'),
        field('kind', 'labels:adjustment', 'select', { choices: ['refund', 'reversal'] }),
        field('method', 'labels:recorded_outcome', 'select', {
          choices: ['cash', 'manual_transfer'],
        }),
        field('reference', 'labels:manual_transfer_reference', 'textarea', { optional: true }),
        reason,
      ],
    },
    'shift.open': {
      get label() {
        return t('departments:open_cashier_shift');
      },
      category: 'shift',
      fields: [field('openingMinor', 'labels:opening_cash_etb', 'money')],
    },
    'shift.allocate': {
      get label() {
        return t('departments:allocate_cash_entry_to_shift');
      },
      category: 'shift',
      fields: [
        ...target,
        field('cashEntry', 'labels:cash_receipt_or_refund', 'select', {
          source: 'cashEntries',
          virtual: true,
        }),
        hidden('paymentId', true),
        hidden('refundId', true),
      ],
    },
    'shift.close': {
      get label() {
        return t('departments:sign_and_close_shift');
      },
      category: 'shift',
      fields: [
        ...target,
        field('countedMinor', 'labels:counted_cash_etb', 'money'),
        field('signature', 'labels:closing_signature'),
      ],
    },
    'shift.review': {
      get label() {
        return t('departments:manager_review_of_closed_shift');
      },
      category: 'shift',
      admin: true,
      fields: [...target, reason],
    },
  };
const labels: Record<string, string> = {
  get catalog() {
    return t('labels:laboratory_catalog');
  },
  get specimen() {
    return t('labels:laboratory_specimens');
  },
  get supplier() {
    return t('labels:suppliers');
  },
  get purchase() {
    return t('labels:purchase_orders');
  },
  get return() {
    return t('labels:patient_returns');
  },
  get finance() {
    return t('labels:financial_adjustments');
  },
  get shift() {
    return t('labels:cashier_shifts');
  },
};
const recordLabels: Record<string, string> = {
  get specimen() {
    return t('labels:specimen');
  },
  get purchase() {
    return t('labels:purchase_order');
  },
  get return() {
    return t('labels:patient_return');
  },
  get shift() {
    return t('labels:cashier_shift');
  },
};
const title = (r: DepartmentRecord) =>
  r.data.name ??
  r.data.accession ??
  (r.kind === 'finance'
    ? `${presentationLabel(r.data.kind)} · ${formatETB(r.data.amountMinor ?? r.data.amount_minor)} ETB`
    : r.kind === 'shift'
      ? t('dynamic:cashier_opening', { amount: formatETB(r.data.openingMinor) })
      : r.kind === 'return'
        ? t('dynamic:patient_return_quantity', { count: r.data.quantity })
        : t('dynamic:purchase_lines_count', { count: r.data.lines?.length ?? 0 }));
function Facts({
  data,
  showIdentity = false,
}: {
  data: Record<string, any>;
  showIdentity?: boolean;
}) {
  const identities = Object.entries(data).filter(([k]) => /(?:Id|_id)$/.test(k) || k === 'id');
  return (
    <dl className="department-facts">
      {Object.entries(data)
        .filter(
          ([k]) =>
            !['type', 'versions', 'lines', 'catalog'].includes(k) &&
            (showIdentity || (!/(?:Id|_id)$/.test(k) && k !== 'id')),
        )
        .map(([k, v]) => (
          <div key={k}>
            <dt>{fieldLabel(k)}</dt>
            <dd>
              {v !== null && typeof v === 'object' ? (
                <Facts data={v} showIdentity={showIdentity} />
              ) : k.toLowerCase().includes('minor') && typeof v === 'number' ? (
                `${v < 0 ? '-' : ''}${formatETB(Math.abs(v))} ETB`
              ) : ['status', 'kind', 'method', 'decision', 'calendar', 'locale'].includes(k) ? (
                presentationLabel(v)
              ) : typeof v === 'boolean' ? (
                t(v ? 'labels:enum.yes' : 'labels:enum.no')
              ) : (
                String(v ?? '—')
              )}
            </dd>
          </div>
        ))}
      {!showIdentity && identities.length > 0 && (
        <div>
          <dt>{t('departments:identity_history')}</dt>
          <dd>
            <details>
              <summary>{t('departments:recorded_identifiers')}</summary>
              <Facts data={Object.fromEntries(identities)} showIdentity />
            </details>
          </dd>
        </div>
      )}
      {data.lines && (
        <div>
          <dt>{t('departments:purchase_lines')}</dt>
          <dd>
            {data.lines.map((l: any, i: number) => (
              <section key={i}>
                <strong>
                  {t('departments:line')} {i + 1}
                </strong>
                <Facts data={l} showIdentity={showIdentity} />
              </section>
            ))}
          </dd>
        </div>
      )}
      {data.versions && (
        <div>
          <dt>{t('departments:retained_result_versions')}</dt>
          <dd>
            {data.versions.map((v: any, i: number) => (
              <section key={i}>
                <strong>
                  {' '}
                  {t('departments:version_2')}{' '}
                  {(data.versionCount ?? data.versions.length) - data.versions.length + i + 1}
                </strong>
                <Facts data={v} showIdentity={showIdentity} />
              </section>
            ))}
          </dd>
        </div>
      )}
    </dl>
  );
}
export default function DepartmentWorkspace({
  session,
  onSessionError,
  onDirty,
  onPending,
  section,
  onSectionChange,
}: Props) {
  const role = session.user.role,
    categories =
      role === 'admin' || role === 'auditor'
        ? Object.keys(labels)
        : role === 'lab' || role === 'clinician'
          ? ['specimen', 'catalog']
          : role === 'pharmacist'
            ? ['purchase', 'supplier', 'return']
            : ['shift', 'finance'];
  const [category, setCategory] = useState(categories.includes(section) ? section : categories[0]),
    [page, setPage] = useState(1),
    [loadedPage, setLoadedPage] = useState(1),
    [list, setList] = useState<DepartmentPage | null>(null),
    [loading, setLoading] = useState(true),
    [stale, setStale] = useState(false),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0),
    [action, setAction] = useState(''),
    [draft, setDraft] = useState<Record<string, string>>({}),
    [choices, setChoices] = useState<Record<string, DepartmentChoice>>({}),
    [selected, setSelected] = useState<DepartmentRecord | null>(null),
    [history, setHistory] = useState<DepartmentEvent[]>([]),
    [historyPage, setHistoryPage] = useState(1),
    [historyLoading, setHistoryLoading] = useState(false),
    [historyStale, setHistoryStale] = useState(false),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<{ key: string; command: DepartmentCommand } | null>(null),
    [notice, setNotice] = useState('');
  const identity = useRef(session.user.id),
    alive = useRef(true),
    dirty = Object.values(draft).some(Boolean),
    locked = busy || !!pending;
  const actions = Object.entries(specs).filter(
    ([key, s]) =>
      s.category === category &&
      role !== 'auditor' &&
      (!s.admin || role === 'admin') &&
      (role !== 'clinician' || key === 'lab.acknowledge'),
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    identity.current = session.user.id;
    setDraft({});
    setChoices({});
    setPending(null);
    setSelected(null);
    setHistory([]);
    setList(null);
    setCategory(categories.includes(section) ? section : categories[0]);
    setAction('');
  }, [session.user.id, role]);
  useEffect(() => {
    onDirty?.(dirty);
    onPending?.(locked);
  }, [dirty, locked, onDirty, onPending]);
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty || locked) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty, locked]);
  const fail = (e: unknown) => {
    if (e instanceof ApiError && [401, 403].includes(e.status)) {
      setList(null);
      setSelected(null);
      setHistory([]);
      setDraft({});
      setChoices({});
      onSessionError(e);
    }
    setError(e instanceof Error ? e.message : t('departments:could_not_load_department_records'));
  };
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    request<DepartmentPage>(`/api/departments?kind=${category}&page=${page}`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
    })
      .then((data) => {
        if (active) {
          setStale(false);
          setList(data);
          setLoadedPage(page);
          setSelected((old) => (old ? (data.entries.find((r) => r.id === old.id) ?? null) : null));
        }
      })
      .catch((e) => {
        if (active) {
          setStale(true);
          fail(e);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [category, page, refresh, session.user.id, role]);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    const controller = new AbortController();
    setHistoryLoading(true);
    request<{ entries: DepartmentEvent[] }>(
      `/api/departments/${selected.id}/history?page=${historyPage}`,
      { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) },
    )
      .then((r) => {
        if (active) {
          setHistory(r.entries);
          setHistoryStale(false);
        }
      })
      .catch((e) => {
        if (active) {
          setHistoryStale(true);
          fail(e);
        }
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [selected?.id, historyPage, refresh]);
  async function send(command: DepartmentCommand, key: string = crypto.randomUUID()) {
    setBusy(true);
    setError('');
    setNotice('');
    const actor = identity.current;
    setPending({ key, command });
    try {
      await request('/api/departments/commands', {
        method: 'POST',
        headers: { 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': key },
        body: JSON.stringify(command),
      });
      if (!alive.current || identity.current !== actor) return;
      setPending(null);
      setDraft({});
      setChoices({});
      setNotice(uiMessage('departments:saved_accountable_record'));
      setRefresh((n) => n + 1);
    } catch (e) {
      if (!alive.current || identity.current !== actor) return;
      fail(e);
      if (e instanceof ApiError && e.status > 0 && e.status < 500) setPending(null);
    } finally {
      if (alive.current && identity.current === actor) setBusy(false);
    }
  }
  function submit() {
    if (!action || loading || stale) return;
    const values: Record<string, any> = { type: action };
    for (const f of specs[action].fields) {
      if (f.virtual) continue;
      const raw = draft[f.key] ?? f.choices?.[0] ?? '';
      if (f.optional && !raw) continue;
      values[f.key] =
        f.kind === 'checkbox'
          ? raw === 'true'
          : f.kind === 'money'
            ? parseETB(raw)
            : f.kind === 'number' ||
                ['expectedRevision', 'expectedBatchRevision', 'line'].includes(f.key)
              ? Number(raw)
              : raw;
    }
    if (action === 'purchase.create') {
      values.lines = [];
      for (let i = 0; i < Number(draft.lineCount ?? 1); i++)
        values.lines.push({
          productId: draft[`product${i}`],
          unit: draft[`unit${i}`],
          quantity: Number(draft[`quantity${i}`]),
          costMinor: parseETB(draft[`cost${i}`] ?? ''),
          packSize: Number(draft[`pack${i}`]),
          controlled: draft[`controlled${i}`] === 'true',
        });
    }
    const parsed = departmentCommandSchema.safeParse(values);
    if (!parsed.success) {
      setError(uiMessage('errors:INVALID_REQUEST'));
      return;
    }
    void send(parsed.data);
  }
  const change = (key: string, value: string) => setDraft((old) => ({ ...old, [key]: value }));
  function choose(f: Field, choice: DepartmentChoice) {
    setChoices((old) => ({ ...old, [f.key]: choice }));
    setDraft((old) => {
      const next = { ...old, ...choice.values, [f.key]: choice.id };
      if (f.key === 'orderId') {
        next.catalogId = choice.values.catalogId ?? '';
        next.visitId = choice.values.visitId;
      }
      if (f.key === 'invoiceId') {
        next.paymentId = '';
        delete next.method;
      }
      if (f.key === 'cashEntry') {
        next.paymentId = choice.values.paymentId ?? '';
        next.refundId = choice.values.refundId ?? '';
      }
      if (f.key === 'id') {
        delete next.line;
        delete next.batchId;
        delete next.expectedBatchRevision;
        delete next.qualityBatch;
      }
      return next;
    });
  }
  useEffect(() => {
    const next = categories.includes(section) ? section : categories[0];
    if (next !== section) onSectionChange(next, true);
    if (next === category) return;
    setCategory(next);
    setList(null);
    setLoading(true);
    setDraft({});
    setChoices({});
    setPage(1);
    setAction('');
    setSelected(null);
    setHistory([]);
  }, [section]);
  useEffect(() => {
    if (actions.length === 1 && !action) setAction(actions[0][0]);
  }, [category, action]);
  function navigate(next: string) {
    if (next === category || locked) return;
    if (!onSectionChange(next)) return;
    setDraft({});
    setChoices({});
    setList(null);
    setLoading(true);
    setCategory(next);
    setPage(1);
    setAction('');
    setSelected(null);
    setHistory([]);
  }
  function renderField(f: Field) {
    if (f.kind === 'hidden') return null;
    if (f.key === 'catalogId' && choices.orderId?.data?.catalogId)
      return (
        <p key={f.key}>
          {' '}
          {t('departments:configured_test')} <strong>{choices.orderId.data.test}</strong>
        </p>
      );
    const ident = `department-${f.key}`,
      value = draft[f.key] ?? f.choices?.[0] ?? '';
    if (f.source) {
      const kind = f.source === 'current' ? (category as DepartmentSourceQuery['kind']) : f.source;
      let context: Partial<DepartmentSourceQuery> = {};
      let unavailable = false;
      if (f.source === 'current') context.action = action as DepartmentSourceQuery['action'];
      if (f.source === 'payments') {
        context.invoiceId = draft.invoiceId;
        unavailable = !draft.invoiceId;
      }
      if (f.source === 'batches' && action === 'purchase.receive') {
        context.productId = choices.id?.data?.lines?.[Number(draft.line)]?.productId;
        unavailable = !context.productId;
      }
      if (f.source === 'batches' && action === 'return.quality') {
        context.recordId = draft.id;
        unavailable = !draft.id;
      }
      const label =
        f.source === 'current' ? (recordLabels[category] ?? t('departments:record')) : f.label;
      return (
        <div key={f.key}>
          {unavailable ? (
            <p>
              {' '}
              {t('common:select')}{' '}
              {f.source === 'payments'
                ? t('departments:a_patient_invoice')
                : action === 'return.quality'
                  ? t('departments:a_patient_return')
                  : t('departments:a_purchase_order_and_line')}{' '}
              {t('departments:to_load')} {label.toLowerCase()} {t('departments:choices_3')}{' '}
            </p>
          ) : (
            <DepartmentPicker
              key={`${action}-${f.key}-${refresh}`}
              label={label}
              kind={kind}
              session={session}
              value={value}
              selectedLabel={choices[f.key] ? choiceLabel(choices[f.key]) : undefined}
              context={context}
              disabled={locked || loading || stale}
              required={!f.optional}
              automatic={action === 'return.quality' && f.key === 'qualityBatch'}
              onChoose={(choice) => choose(f, choice)}
              onError={fail}
            />
          )}
        </div>
      );
    }
    if (f.key === 'line') {
      const lines = choices.id?.data?.lines ?? [],
        names = choices.id?.data?.productNames ?? [];
      return (
        <div key={f.key}>
          <label htmlFor={ident}>{interfaceMessage(f.label)}</label>
          <select
            id={ident}
            required
            value={value}
            disabled={locked || !lines.length}
            onChange={(e) => {
              change('line', e.target.value);
              setDraft((old) => ({
                ...old,
                line: e.target.value,
                batchId: '',
                expectedBatchRevision: '',
              }));
            }}
          >
            <option value="">{t('departments:choose_an_ordered_product_line')}</option>
            {lines.map((l: any, i: number) => (
              <option key={i} value={i}>
                {names[i] ?? t('dynamic:line_number', { number: i + 1 })} ·{' '}
                {l.quantity - l.received} {t('departments:packs_remaining')} {l.packSize} {l.unit}{' '}
                {t('departments:per_pack')}{' '}
              </option>
            ))}
          </select>
        </div>
      );
    }
    return (
      <div key={f.key} className="department-control">
        <label htmlFor={ident}>
          {interfaceMessage(f.label)}
          {f.optional ? t('common:optional') : ''}
        </label>
        {f.kind === 'select' ? (
          <select
            id={ident}
            required={!f.optional}
            disabled={locked || loading || stale}
            value={value}
            onChange={(e) => change(f.key, e.target.value)}
          >
            {f.choices?.map((c) => (
              <option key={c} value={c}>
                {presentationLabel(c)}
              </option>
            ))}
          </select>
        ) : f.kind === 'textarea' ? (
          <textarea
            id={ident}
            maxLength={f.key === 'value' ? 1000 : 500}
            required={!f.optional}
            disabled={locked || loading || stale}
            value={value}
            onChange={(e) => change(f.key, e.target.value)}
          />
        ) : (
          <input
            id={ident}
            type={f.kind === 'checkbox' ? 'checkbox' : f.kind === 'number' ? 'number' : 'text'}
            step={
              f.key.startsWith('critical') || f.key === 'numericValue'
                ? 'any'
                : f.kind === 'number'
                  ? '1'
                  : undefined
            }
            maxLength={200}
            required={!f.optional && f.kind !== 'checkbox'}
            disabled={locked || loading || stale}
            checked={f.kind === 'checkbox' ? value === 'true' : undefined}
            value={f.kind === 'checkbox' ? undefined : value}
            onChange={(e) =>
              change(f.key, f.kind === 'checkbox' ? String(e.target.checked) : e.target.value)
            }
            inputMode={f.kind === 'money' ? 'decimal' : undefined}
          />
        )}
      </div>
    );
  }
  return (
    <section className="department-workspace">
      <header className="section-heading">
        <div>
          <p className="eyebrow">{t('departments:department_operations')}</p>
          <h1>{labels[category]}</h1>
          <p>{t('departments:accountable_handoffs_retained_history_and_explicit_approvals')}</p>
        </div>
        <button disabled={locked || loading} onClick={() => setRefresh((n) => n + 1)}>
          {' '}
          {t('departments:refresh_records')}{' '}
        </button>
      </header>
      <nav className="department-tabs" aria-label={t('departments:department_workflows')}>
        {categories.map((k) => (
          <a
            key={k}
            href={`/staff/departments?section=${k}`}
            aria-disabled={locked || undefined}
            aria-current={category === k ? 'page' : undefined}
            onClick={(event) => {
              if (isPlainLinkClick(event)) {
                event.preventDefault();
                navigate(k);
              }
            }}
          >
            {labels[k]}
          </a>
        ))}
      </nav>
      {error && (
        <p className="notice error" role="alert">
          {interfaceMessage(error)}
          {list && stale && <span> {t('departments:stale_records')}</span>}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {interfaceMessage(notice)}
        </p>
      )}
      {pending && (
        <aside className="notice warning">
          <p>
            {' '}
            {t('departments:request_retained_for_an_exact_retry_key')} <code>{pending.key}</code>
          </p>
          <Facts data={pending.command} />
          <button disabled={busy} onClick={() => void send(pending.command, pending.key)}>
            {' '}
            {t('departments:retry_exact_request')}{' '}
          </button>
        </aside>
      )}
      {actions.length > 0 && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="department-form"
        >
          {actions.length > 1 && (
            <>
              <label htmlFor="department-action">{t('departments:action')}</label>
              <select
                id="department-action"
                disabled={locked || loading || stale}
                value={action}
                onChange={(e) => {
                  if (dirty && !window.confirm(t('departments:discard_unsaved_action_details')))
                    return;
                  setAction(e.target.value);
                  setDraft({});
                  setChoices({});
                }}
              >
                <option value="">{t('departments:choose_a_workflow')}</option>
                {actions.map(([key, s]) => (
                  <option key={key} value={key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </>
          )}
          {action && (
            <>
              <h2>{specs[action].label}</h2>
              <div className="department-fields">{specs[action].fields.map(renderField)}</div>
              {action === 'purchase.create' && (
                <>
                  <label>
                    {' '}
                    {t('departments:purchase_line_count')}{' '}
                    <input
                      type="number"
                      min={1}
                      max={20}
                      disabled={locked || loading || stale}
                      value={draft.lineCount ?? 1}
                      onChange={(e) => change('lineCount', e.target.value)}
                    />
                  </label>
                  {Array.from({
                    length: Math.min(20, Math.max(1, Number(draft.lineCount ?? 1))),
                  }).map((_, i) => (
                    <fieldset key={i}>
                      <legend>
                        {t('departments:purchase_line')} {i + 1}
                      </legend>
                      <DepartmentPicker
                        label={t('dynamic:line_product', { number: i + 1 })}
                        kind="products"
                        session={session}
                        value={draft[`product${i}`] ?? ''}
                        selectedLabel={
                          choices[`product${i}`] ? choiceLabel(choices[`product${i}`]) : undefined
                        }
                        disabled={locked || loading || stale}
                        onError={fail}
                        onChoose={(choice) => {
                          setChoices((old) => ({ ...old, [`product${i}`]: choice }));
                          setDraft((old) => ({
                            ...old,
                            [`product${i}`]: choice.id,
                            [`unit${i}`]: choice.values.unit,
                          }));
                        }}
                      />
                      {draft[`unit${i}`] && (
                        <p>
                          {' '}
                          {t('departments:configured_stock_unit')}{' '}
                          <strong>{draft[`unit${i}`]}</strong>
                        </p>
                      )}
                      <div className="department-fields">
                        {[
                          ['quantity', 'Packs ordered'],
                          ['cost', 'Cost per pack (ETB)'],
                          ['pack', 'Stock units per pack'],
                        ].map(([key, label]) => (
                          <label key={key}>
                            {interfaceMessage(label)}
                            <input
                              required
                              maxLength={100}
                              disabled={locked || loading || stale}
                              value={draft[`${key}${i}`] ?? ''}
                              onChange={(e) => change(`${key}${i}`, e.target.value)}
                              inputMode="decimal"
                            />
                          </label>
                        ))}
                        <label>
                          {' '}
                          {t('departments:controlled_item')}{' '}
                          <input
                            type="checkbox"
                            disabled={locked || loading || stale}
                            checked={draft[`controlled${i}`] === 'true'}
                            onChange={(e) => change(`controlled${i}`, String(e.target.checked))}
                          />
                        </label>
                      </div>
                    </fieldset>
                  ))}
                </>
              )}
              <p>
                {' '}
                {t('departments:review_the_details_before_saving_records_are_attributed_to')}{' '}
                {session.user.displayName}
                {t('departments:cash_and_manual_transfers_record_completed_outcomes')}{' '}
              </p>
              <div className="button-row">
                <button className="primary" disabled={locked || loading || stale}>
                  {busy ? t('common:saving') : t('departments:save_accountable_record')}
                </button>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    setDraft({});
                    setChoices({});
                  }}
                >
                  {' '}
                  {t('common:discard_draft')}{' '}
                </button>
              </div>
            </>
          )}
        </form>
      )}
      <div className="department-read" aria-busy={loading}>
        <p className="department-read-status" role="status">
          {loading ? t('departments:loading_department_records') : ''}
        </p>
        {list && (
          <>
            <div
              className="table-region department-records"
              aria-busy={loading}
              role="region"
              aria-label={labels[category]}
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th>{t('departments:record')}</th>
                    <th>{t('common:status')}</th>
                    <th>{t('common:revision_2')}</th>
                    <th>{t('common:history')}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.entries.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{title(r)}</strong>
                      </td>
                      <td>
                        {presentationLabel(r.data.status ?? r.data.kind ?? 'configured')}
                        {r.data.review === 'pending' && (
                          <strong className="department-review">
                            {t('departments:accountable_review_pending')}
                          </strong>
                        )}
                      </td>
                      <td>{r.revision}</td>
                      <td>
                        <button
                          disabled={locked || loading || stale}
                          onClick={() => {
                            setSelected(r);
                            setHistoryPage(1);
                            setHistory([]);
                            setHistoryLoading(true);
                            setHistoryStale(false);
                          }}
                        >
                          {' '}
                          {t('departments:view_record_and_history')}{' '}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!list.entries.length && (
              <p className="empty-small">
                {t('common:no')} {labels[category].toLowerCase()} {t('departments:recorded_yet')}
              </p>
            )}
            <div className="staff-pagination">
              <p>
                {list.total} {t('departments:records_page')} {loadedPage}
              </p>
              <div className="button-row">
                <button
                  disabled={locked || loading || page === 1}
                  onClick={() => setPage((n) => n - 1)}
                >
                  {' '}
                  {t('departments:previous_records')}{' '}
                </button>
                <button
                  disabled={locked || loading || page * 25 >= list.total}
                  onClick={() => setPage((n) => n + 1)}
                >
                  {' '}
                  {t('departments:next_records')}{' '}
                </button>
              </div>
            </div>
            {category === 'finance' &&
              list.entries.map((r) => (
                <article key={r.id}>
                  <h2>{title(r)}</h2>
                  <Facts data={r.data} />
                </article>
              ))}
          </>
        )}
      </div>
      {selected && (
        <article
          className="department-detail"
          aria-busy={historyLoading}
          data-print-blocked={locked || loading || stale || historyLoading || historyStale}
        >
          <h2>{title(selected)}</h2>
          <Facts data={selected.data} />
          <details>
            <summary>{t('departments:record_identity')}</summary>
            <p>{selected.id}</p>
          </details>
          <h3>{t('departments:immutable_history_2')}</h3>
          {historyLoading && <p role="status">{t('departments:loading_history')}</p>}
          {historyStale && (
            <p className="notice error" role="alert">
              {t('departments:stale_history')}
            </p>
          )}
          {historyStale && (
            <button disabled={locked || historyLoading} onClick={() => setRefresh((n) => n + 1)}>
              {t('common:retry_loading')}
            </button>
          )}
          <ol className="timeline">
            {history.map((e) => (
              <li key={e.id}>
                <strong>{specs[e.action]?.label ?? e.action}</strong>
                <small>
                  {hospitalDate(e.at)} · {e.actorName}
                </small>
                <Facts data={e.snapshot.command ?? e.snapshot} />
                <details>
                  <summary>{t('departments:event_and_operator_identity')}</summary>
                  <p>
                    {e.id} · {e.actorId}
                  </p>
                </details>
              </li>
            ))}
          </ol>
          <div className="button-row">
            <button
              disabled={
                locked || loading || stale || historyLoading || historyStale || historyPage === 1
              }
              onClick={() => setHistoryPage((n) => n - 1)}
            >
              {' '}
              {t('common:previous_history')}{' '}
            </button>
            <button
              disabled={
                locked || loading || stale || historyLoading || historyStale || history.length < 25
              }
              onClick={() => setHistoryPage((n) => n + 1)}
            >
              {' '}
              {t('common:next_history')}{' '}
            </button>
            <button
              disabled={locked || loading || stale || historyLoading || historyStale}
              onClick={() => {
                if (!locked && !loading && !stale && !historyLoading && !historyStale)
                  window.print();
              }}
            >
              {t('departments:print_factual_record')}
            </button>
          </div>
        </article>
      )}
    </section>
  );
}
