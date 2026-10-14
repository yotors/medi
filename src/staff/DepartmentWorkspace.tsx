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
type Props = {
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
): Field => ({ key, label, kind, ...extra });
const hidden = (key: string, optional = false) => field(key, '', 'hidden', { optional });
const target = [field('id', 'Record', 'select', { source: 'current' }), hidden('expectedRevision')],
  reason = field('reason', 'Reason', 'textarea');
const specs: Record<string, { label: string; category: string; fields: Field[]; admin?: boolean }> =
  {
    'lab.catalog': {
      label: 'Configure laboratory test',
      category: 'catalog',
      admin: true,
      fields: [
        field('code', 'Test code'),
        field('name', 'Test name'),
        field('specimen', 'Specimen type'),
        field('unit', 'Result unit'),
        field('criticalLow', 'Critical lower threshold', 'number', { optional: true }),
        field('criticalHigh', 'Critical upper threshold', 'number', { optional: true }),
      ],
    },
    'lab.register': {
      label: 'Register specimen',
      category: 'specimen',
      fields: [
        field('orderId', 'Patient investigation order', 'select', { source: 'orders' }),
        hidden('visitId'),
        field('catalogId', 'Matching configured laboratory test', 'select', { source: 'catalog' }),
        field('accession', 'Accession'),
        field('clinicianId', 'Responsible clinician', 'select', { source: 'clinicians' }),
      ],
    },
    'lab.collect': { label: 'Record collection', category: 'specimen', fields: target },
    'lab.receive': { label: 'Record specimen receipt', category: 'specimen', fields: target },
    'lab.reject': { label: 'Reject specimen', category: 'specimen', fields: [...target, reason] },
    'lab.recollect': {
      label: 'Request recollection',
      category: 'specimen',
      fields: [...target, field('accession', 'New accession'), reason],
    },
    'lab.result': {
      label: 'Enter or correct result',
      category: 'specimen',
      fields: [
        ...target,
        field('value', 'Result', 'textarea'),
        field('numericValue', 'Numeric value', 'number', { optional: true }),
        field('critical', 'Flag critical result', 'checkbox'),
        field('reason', 'Correction reason (required for subsequent versions)', 'textarea', {
          optional: true,
        }),
      ],
    },
    'lab.release': { label: 'Release result', category: 'specimen', fields: target },
    'lab.acknowledge': {
      label: 'Acknowledge accountable result review',
      category: 'specimen',
      fields: [
        ...target,
        field('delivery', 'Delivery record', 'textarea'),
        field('acknowledgement', 'Acknowledgement and action', 'textarea'),
      ],
    },
    'supplier.create': {
      label: 'Add supplier',
      category: 'supplier',
      fields: [field('name', 'Supplier name'), field('contact', 'Supplier contact')],
    },
    'purchase.create': {
      label: 'Request purchase',
      category: 'purchase',
      fields: [field('supplierId', 'Supplier', 'select', { source: 'supplier' })],
    },
    'purchase.approve': {
      label: 'Approve purchase',
      category: 'purchase',
      admin: true,
      fields: [...target, reason],
    },
    'purchase.receive': {
      label: 'Receive purchase line',
      category: 'purchase',
      fields: [
        ...target,
        field('line', 'Purchase line', 'select'),
        field('batchId', 'Stock batch', 'select', { source: 'batches' }),
        hidden('expectedBatchRevision'),
        field('quantity', 'Packs received', 'number'),
        field('authorization', 'Responsible controlled-item authorization', 'textarea', {
          optional: true,
        }),
      ],
    },
    'purchase.cancel': {
      label: 'Cancel unreceived remainder',
      category: 'purchase',
      fields: [...target, reason],
    },
    'return.record': {
      label: 'Record patient return into quarantine',
      category: 'return',
      fields: [
        field('dispenseId', 'Patient dispense', 'select', { source: 'dispenses' }),
        field('quantity', 'Returned stock units', 'number'),
        reason,
      ],
    },
    'return.quality': {
      label: 'Authorize return quality decision',
      category: 'return',
      admin: true,
      fields: [
        ...target,
        field('qualityBatch', 'Original stock batch', 'select', {
          source: 'batches',
          virtual: true,
        }),
        hidden('expectedBatchRevision'),
        field('decision', 'Quality decision', 'select', { choices: ['restock', 'destroy'] }),
        reason,
      ],
    },
    'invoice.credit': {
      label: 'Approve invoice credit or discount',
      category: 'finance',
      admin: true,
      fields: [
        field('invoiceId', 'Patient invoice', 'select', { source: 'invoices' }),
        hidden('expectedRevision'),
        field('amountMinor', 'Amount (ETB)', 'money'),
        field('kind', 'Adjustment', 'select', { choices: ['credit', 'discount'] }),
        reason,
      ],
    },
    'payment.refund': {
      label: 'Approve recorded refund or reversal',
      category: 'finance',
      admin: true,
      fields: [
        field('invoiceId', 'Patient invoice', 'select', { source: 'invoices' }),
        hidden('expectedRevision'),
        field('paymentId', 'Original receipt', 'select', { source: 'payments' }),
        field('amountMinor', 'Amount (ETB)', 'money'),
        field('kind', 'Adjustment', 'select', { choices: ['refund', 'reversal'] }),
        field('method', 'Recorded outcome', 'select', { choices: ['cash', 'manual_transfer'] }),
        field('reference', 'Manual transfer reference', 'textarea', { optional: true }),
        reason,
      ],
    },
    'shift.open': {
      label: 'Open cashier shift',
      category: 'shift',
      fields: [field('openingMinor', 'Opening cash (ETB)', 'money')],
    },
    'shift.allocate': {
      label: 'Allocate cash entry to shift',
      category: 'shift',
      fields: [
        ...target,
        field('cashEntry', 'Cash receipt or refund', 'select', {
          source: 'cashEntries',
          virtual: true,
        }),
        hidden('paymentId', true),
        hidden('refundId', true),
      ],
    },
    'shift.close': {
      label: 'Sign and close shift',
      category: 'shift',
      fields: [
        ...target,
        field('countedMinor', 'Counted cash (ETB)', 'money'),
        field('signature', 'Closing signature'),
      ],
    },
    'shift.review': {
      label: 'Manager review of closed shift',
      category: 'shift',
      admin: true,
      fields: [...target, reason],
    },
  };
const labels: Record<string, string> = {
  catalog: 'Laboratory catalog',
  specimen: 'Laboratory specimens',
  supplier: 'Suppliers',
  purchase: 'Purchase orders',
  return: 'Patient returns',
  finance: 'Financial adjustments',
  shift: 'Cashier shifts',
};
const recordLabels: Record<string, string> = {
  specimen: 'Specimen',
  purchase: 'Purchase order',
  return: 'Patient return',
  shift: 'Cashier shift',
};
const title = (r: DepartmentRecord) =>
  r.data.name ??
  r.data.accession ??
  (r.kind === 'finance'
    ? `${r.data.kind} · ${formatETB(r.data.amountMinor ?? r.data.amount_minor)} ETB`
    : r.kind === 'shift'
      ? `Cashier shift · ${formatETB(r.data.openingMinor)} ETB opening`
      : r.kind === 'return'
        ? `Patient return · ${r.data.quantity} units`
        : `Purchase · ${r.data.lines?.length ?? 0} lines`);
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
            <dt>{k.replace(/([A-Z])/g, ' $1').replaceAll('_', ' ')}</dt>
            <dd>
              {v !== null && typeof v === 'object' ? (
                <Facts data={v} showIdentity={showIdentity} />
              ) : k.toLowerCase().includes('minor') && typeof v === 'number' ? (
                `${v < 0 ? '-' : ''}${formatETB(Math.abs(v))} ETB`
              ) : (
                String(v ?? '—')
              )}
            </dd>
          </div>
        ))}
      {!showIdentity && identities.length > 0 && (
        <div>
          <dt>Identity history</dt>
          <dd>
            <details>
              <summary>Recorded identifiers</summary>
              <Facts data={Object.fromEntries(identities)} showIdentity />
            </details>
          </dd>
        </div>
      )}
      {data.lines && (
        <div>
          <dt>Purchase lines</dt>
          <dd>
            {data.lines.map((l: any, i: number) => (
              <section key={i}>
                <strong>Line {i + 1}</strong>
                <Facts data={l} showIdentity={showIdentity} />
              </section>
            ))}
          </dd>
        </div>
      )}
      {data.versions && (
        <div>
          <dt>Retained result versions</dt>
          <dd>
            {data.versions.map((v: any, i: number) => (
              <section key={i}>
                <strong>
                  Version{' '}
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
  const [category, setCategory] = useState(categories[0]),
    [page, setPage] = useState(1),
    [list, setList] = useState<DepartmentPage | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0),
    [action, setAction] = useState(''),
    [draft, setDraft] = useState<Record<string, string>>({}),
    [choices, setChoices] = useState<Record<string, DepartmentChoice>>({}),
    [selected, setSelected] = useState<DepartmentRecord | null>(null),
    [history, setHistory] = useState<DepartmentEvent[]>([]),
    [historyPage, setHistoryPage] = useState(1),
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
    setCategory(categories[0]);
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
    if (e instanceof ApiError && [401, 403].includes(e.status)) onSessionError(e);
    setError(e instanceof Error ? e.message : 'Could not load department records.');
  };
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    request<DepartmentPage>(`/api/departments?kind=${category}&page=${page}`)
      .then((data) => {
        if (active) {
          setList(data);
          setSelected((old) => (old ? (data.entries.find((r) => r.id === old.id) ?? old) : null));
        }
      })
      .catch((e) => {
        if (active) fail(e);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [category, page, refresh, session.user.id, role]);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    request<{ entries: DepartmentEvent[] }>(
      `/api/departments/${selected.id}/history?page=${historyPage}`,
    )
      .then((r) => {
        if (active) setHistory(r.entries);
      })
      .catch((e) => {
        if (active) fail(e);
      });
    return () => {
      active = false;
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
      setNotice('Saved accountable record.');
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
    if (!action) return;
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
      setError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
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
  function navigate(next: string) {
    if (locked) return;
    if (dirty && !window.confirm('Discard unsaved department details?')) return;
    setDraft({});
    setChoices({});
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
          Configured test: <strong>{choices.orderId.data.test}</strong>
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
      const label = f.source === 'current' ? (recordLabels[category] ?? 'Record') : f.label;
      return (
        <div key={f.key}>
          {unavailable ? (
            <p>
              Select{' '}
              {f.source === 'payments'
                ? 'a patient invoice'
                : action === 'return.quality'
                  ? 'a patient return'
                  : 'a purchase order and line'}{' '}
              to load {label.toLowerCase()} choices.
            </p>
          ) : (
            <DepartmentPicker
              key={`${action}-${f.key}-${refresh}`}
              label={label}
              kind={kind}
              session={session}
              value={value}
              selectedLabel={choices[f.key]?.label}
              context={context}
              disabled={locked}
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
          <label htmlFor={ident}>{f.label}</label>
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
            <option value="">Choose an ordered product line</option>
            {lines.map((l: any, i: number) => (
              <option key={i} value={i}>
                {names[i] ?? `Line ${i + 1}`} · {l.quantity - l.received} packs remaining ·{' '}
                {l.packSize} {l.unit} per pack
              </option>
            ))}
          </select>
        </div>
      );
    }
    return (
      <div key={f.key} className="department-control">
        <label htmlFor={ident}>
          {f.label}
          {f.optional ? ' (optional)' : ''}
        </label>
        {f.kind === 'select' ? (
          <select
            id={ident}
            required={!f.optional}
            disabled={locked}
            value={value}
            onChange={(e) => change(f.key, e.target.value)}
          >
            {f.choices?.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        ) : f.kind === 'textarea' ? (
          <textarea
            id={ident}
            maxLength={f.key === 'value' ? 1000 : 500}
            required={!f.optional}
            disabled={locked}
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
            disabled={locked}
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
          <p className="eyebrow">Department operations</p>
          <h1>{labels[category]}</h1>
          <p>Accountable handoffs, retained history, and explicit approvals.</p>
        </div>
        <button disabled={locked} onClick={() => setRefresh((n) => n + 1)}>
          Refresh records
        </button>
      </header>
      <nav className="department-tabs" aria-label="Department workflows">
        {categories.map((k) => (
          <button
            key={k}
            disabled={locked}
            aria-current={category === k ? 'page' : undefined}
            onClick={() => navigate(k)}
          >
            {labels[k]}
          </button>
        ))}
      </nav>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {pending && (
        <aside className="notice warning">
          <p>
            Request retained for an exact retry. Key: <code>{pending.key}</code>
          </p>
          <Facts data={pending.command} />
          <button disabled={busy} onClick={() => void send(pending.command, pending.key)}>
            Retry exact request
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
          <label htmlFor="department-action">Action</label>
          <select
            id="department-action"
            disabled={locked}
            value={action}
            onChange={(e) => {
              if (dirty && !window.confirm('Discard unsaved action details?')) return;
              setAction(e.target.value);
              setDraft({});
              setChoices({});
            }}
          >
            <option value="">Choose a workflow</option>
            {actions.map(([key, s]) => (
              <option key={key} value={key}>
                {s.label}
              </option>
            ))}
          </select>
          {action && (
            <>
              <h2>{specs[action].label}</h2>
              <div className="department-fields">{specs[action].fields.map(renderField)}</div>
              {action === 'purchase.create' && (
                <>
                  <label>
                    Purchase line count
                    <input
                      type="number"
                      min={1}
                      max={20}
                      disabled={locked}
                      value={draft.lineCount ?? 1}
                      onChange={(e) => change('lineCount', e.target.value)}
                    />
                  </label>
                  {Array.from({
                    length: Math.min(20, Math.max(1, Number(draft.lineCount ?? 1))),
                  }).map((_, i) => (
                    <fieldset key={i}>
                      <legend>Purchase line {i + 1}</legend>
                      <DepartmentPicker
                        label={`Product for line ${i + 1}`}
                        kind="products"
                        session={session}
                        value={draft[`product${i}`] ?? ''}
                        selectedLabel={choices[`product${i}`]?.label}
                        disabled={locked}
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
                          Configured stock unit: <strong>{draft[`unit${i}`]}</strong>
                        </p>
                      )}
                      <div className="department-fields">
                        {[
                          ['quantity', 'Packs ordered'],
                          ['cost', 'Cost per pack (ETB)'],
                          ['pack', 'Stock units per pack'],
                        ].map(([key, label]) => (
                          <label key={key}>
                            {label}
                            <input
                              required
                              maxLength={100}
                              disabled={locked}
                              value={draft[`${key}${i}`] ?? ''}
                              onChange={(e) => change(`${key}${i}`, e.target.value)}
                              inputMode="decimal"
                            />
                          </label>
                        ))}
                        <label>
                          Controlled item
                          <input
                            type="checkbox"
                            disabled={locked}
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
                Review the details before saving. Records are attributed to{' '}
                {session.user.displayName}. Cash and manual transfers record completed outcomes.
              </p>
              <div className="button-row">
                <button className="primary" disabled={locked || loading}>
                  {busy ? 'Saving…' : 'Save accountable record'}
                </button>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    setDraft({});
                    setChoices({});
                  }}
                >
                  Discard draft
                </button>
              </div>
            </>
          )}
        </form>
      )}
      {loading ? (
        <p role="status">Loading department records…</p>
      ) : (
        list && (
          <>
            <div className="table-region" role="region" aria-label={labels[category]} tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th>Record</th>
                    <th>Status</th>
                    <th>Revision</th>
                    <th>History</th>
                  </tr>
                </thead>
                <tbody>
                  {list.entries.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{title(r)}</strong>
                      </td>
                      <td>
                        {r.data.status ?? r.data.kind ?? 'Configured'}
                        {r.data.review === 'pending' && (
                          <strong className="department-review">Accountable review pending</strong>
                        )}
                      </td>
                      <td>{r.revision}</td>
                      <td>
                        <button
                          disabled={locked}
                          onClick={() => {
                            setSelected(r);
                            setHistoryPage(1);
                            setHistory([]);
                          }}
                        >
                          View record and history
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!list.entries.length && (
              <p className="empty-small">No {labels[category].toLowerCase()} recorded yet.</p>
            )}
            <div className="staff-pagination">
              <p>
                {list.total} records · Page {page}
              </p>
              <div className="button-row">
                <button disabled={locked || page === 1} onClick={() => setPage((n) => n - 1)}>
                  Previous records
                </button>
                <button
                  disabled={locked || page * 25 >= list.total}
                  onClick={() => setPage((n) => n + 1)}
                >
                  Next records
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
        )
      )}
      {selected && (
        <article className="department-detail">
          <h2>{title(selected)}</h2>
          <Facts data={selected.data} />
          <details>
            <summary>Record identity</summary>
            <p>{selected.id}</p>
          </details>
          <h3>Immutable history</h3>
          <ol className="timeline">
            {history.map((e) => (
              <li key={e.id}>
                <strong>{specs[e.action]?.label ?? e.action}</strong>
                <small>
                  {hospitalDate(e.at)} · {e.actorName}
                </small>
                <Facts data={e.snapshot.command ?? e.snapshot} />
                <details>
                  <summary>Event and operator identity</summary>
                  <p>
                    {e.id} · {e.actorId}
                  </p>
                </details>
              </li>
            ))}
          </ol>
          <div className="button-row">
            <button
              disabled={locked || historyPage === 1}
              onClick={() => setHistoryPage((n) => n - 1)}
            >
              Previous history
            </button>
            <button
              disabled={locked || history.length < 25}
              onClick={() => setHistoryPage((n) => n + 1)}
            >
              Next history
            </button>
            <button onClick={() => window.print()}>Print factual record</button>
          </div>
        </article>
      )}
    </section>
  );
}
