import { formatMinorCurrency } from '../i18n';
import { presentationLabel } from '../i18n';
import { uiMessage } from '../i18n';
import { interfaceMessage } from '../i18n';
import { t } from '../i18n';
import { hospitalDate } from './date';
import { useEffect, useRef, useState } from 'react';
import type { Session } from '../../shared/registration';
import {
  billingCommandSchema,
  type BillingCommand,
  type BillingDetail,
  type BillingPage,
  type BillingResult,
} from '../../shared/billing';
import {
  MAX_PRICE_MINOR,
  formatETB,
  parseETB,
  type ConfigurationList,
  type ConfigurationResult,
  type Service,
} from '../../shared/configuration';
import { ApiError, request } from './api';
import './billing.css';

type DraftLine = { service: Service; quantity: number };
type Pending = { key: string; command: BillingCommand; uncertain: boolean };
const money = (value: number) => formatMinorCurrency(value);
const when = (value: string) => hospitalDate(value);
const failure = (error: unknown) =>
  error instanceof Error ? error.message : t('billing:billing_could_not_be_loaded_please_retry');

export default function BillingPanel({
  visitId,
  session,
  disabled,
  externalRefresh,
  onDirty,
  onPending,
  onSaved,
  onSessionError,
}: {
  visitId: string;
  session: Session;
  disabled: boolean;
  externalRefresh: number;
  onDirty: (value: boolean) => void;
  onPending: (value: boolean) => void;
  onSaved: () => void;
  onSessionError: (error: unknown) => void;
}) {
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [list, setList] = useState<BillingPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<BillingDetail | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [detailLoading, setDetailLoading] = useState(false);
  const [readError, setReadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [query, setQuery] = useState('');
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalog, setCatalog] = useState<ConfigurationList | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [pricesStale, setPricesStale] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'manual_transfer'>('cash');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [voidConfirmed, setVoidConfirmed] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [pricesLoading, setPricesLoading] = useState(false);
  const mounted = useRef(false);
  const inflight = useRef(false);
  const title = useRef<HTMLHeadingElement>(null);
  const dirty = Boolean(lines.length || amount || reference || reason);
  const locked = disabled || Boolean(pending) || busy || pricesLoading;
  const readsBlocked = loading || detailLoading || Boolean(readError);
  const total = lines.reduce((sum, line) => sum + line.service.priceMinor * line.quantity, 0);
  const validTotal = total <= MAX_PRICE_MINOR;
  const invoice = detail?.invoice;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => {
    onPending(Boolean(pending));
  }, [pending, onPending]);
  useEffect(() => {
    setPaymentConfirmed(false);
    setVoidConfirmed(false);
  }, [invoice?.revision]);
  useEffect(() => {
    if (preparing || selected) title.current?.focus();
  }, [preparing, selected]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setReadError('');
    void request<BillingPage>(`/api/visits/${visitId}/billing?page=${page}`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
    })
      .then((value) => {
        if (controller.signal.aborted) return;
        if (!value.invoices.length && page > 1) {
          setPage(Math.max(1, Math.ceil(value.total / value.pageSize)));
          return;
        }
        setList(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          if (e instanceof ApiError && e.status === 401) onSessionError(e);
          else setReadError(failure(e));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [visitId, page, refresh, externalRefresh]);
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      setDetailLoading(false);
      return;
    }
    const controller = new AbortController();
    setDetailLoading(true);
    void request<BillingDetail>(`/api/billing/invoices/${selected}?page=${historyPage}`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
    })
      .then((value) => {
        if (!controller.signal.aborted && value.invoice.id === selected) setDetail(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          if (e instanceof ApiError && e.status === 401) onSessionError(e);
          else setReadError(failure(e));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [selected, historyPage, refresh, externalRefresh]);
  useEffect(() => {
    if (!preparing) return;
    const controller = new AbortController();
    setCatalogLoading(true);
    setCatalogError('');
    const timer = window.setTimeout(() => {
      void request<ConfigurationList>(
        `/api/configuration/services?active=true&q=${encodeURIComponent(query.trim())}&page=${catalogPage}`,
        { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) },
      )
        .then((value) => {
          if (!controller.signal.aborted) setCatalog(value);
        })
        .catch((e) => {
          if (!controller.signal.aborted) {
            if (e instanceof ApiError && e.status === 401) onSessionError(e);
            else setCatalogError(failure(e));
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setCatalogLoading(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [preparing, query, catalogPage, refresh]);

  function clearDrafts() {
    setLines([]);
    setAmount('');
    setMethod('cash');
    setReference('');
    setReason('');
    setConfirmed(false);
    setPaymentConfirmed(false);
    setVoidConfirmed(false);
    setPricesStale(false);
  }
  function changeView(id: string | null, prepare = false) {
    if (locked || (dirty && !window.confirm(t('billing:discard_these_unsaved_billing_drafts'))))
      return;
    clearDrafts();
    setDetail(null);
    setSelected(id);
    setHistoryPage(1);
    setPreparing(prepare);
    setNotice('');
    setError('');
    setReadError('');
    setRefresh((n) => n + 1);
  }
  async function refreshPrices() {
    if (locked || !lines.length) return;
    setPricesLoading(true);
    setError('');
    try {
      const results = await Promise.allSettled(
        lines.map(async (line) => {
          try {
            const value = await request<ConfigurationResult>(
              `/api/configuration/services/${line.service.id}`,
            );
            return { ...line, service: value.entry as Service };
          } catch (e) {
            if (e instanceof ApiError && e.status === 404)
              return { ...line, service: { ...line.service, active: false } };
            throw e;
          }
        }),
      );
      if (!mounted.current) return;
      const failed = results.find((result) => result.status === 'rejected');
      const endedSession = results.find(
        (result) =>
          result.status === 'rejected' &&
          result.reason instanceof ApiError &&
          result.reason.status === 401,
      );
      if (endedSession?.status === 'rejected') {
        onSessionError(endedSession.reason);
        return;
      }
      setLines(
        results.map((result, index) =>
          result.status === 'fulfilled' ? result.value : lines[index],
        ),
      );
      setConfirmed(false);
      setPricesStale(Boolean(failed));
      if (failed)
        setError(
          t(
            'billing:some_prices_could_not_be_refreshed_successful_updates_are_retained_retry_before_issuing',
          ),
        );
      else
        setNotice(
          t(
            'billing:current_catalog_prices_loaded_review_every_line_and_the_total_again_remove_any_unavailable_serv',
          ),
        );
    } catch (e) {
      if (mounted.current) {
        if (e instanceof ApiError && e.status === 401) onSessionError(e);
        else setError(failure(e));
      }
    } finally {
      if (mounted.current) setPricesLoading(false);
    }
  }
  async function submit(submission: Pending) {
    if (inflight.current || disabled || pricesLoading) return;
    inflight.current = true;
    setBusy(true);
    setPending(submission);
    onPending(true);
    setError('');
    setNotice('');
    try {
      const result = await request<BillingResult>(`/api/visits/${visitId}/billing/commands`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': submission.key },
        body: JSON.stringify(submission.command),
      });
      if (!mounted.current) return;
      // Acknowledgement is final even if the separate refresh fails. Never resubmit an acknowledged payment.
      setPending(null);
      onPending(false);
      if (submission.command.type === 'invoice.issue') {
        setLines([]);
        setConfirmed(false);
        setPricesStale(false);
      }
      if (submission.command.type === 'payment.record') {
        setAmount('');
        setReference('');
        setMethod('cash');
        setPaymentConfirmed(false);
      }
      if (submission.command.type === 'invoice.void') {
        setReason('');
        setVoidConfirmed(false);
      }
      setPreparing(false);
      setSelected(result.invoiceId);
      setHistoryPage(1);
      setDetail(null);
      setNotice(
        result.receiptNumber
          ? uiMessage('dynamic:payment_receipt', { number: result.receiptNumber })
          : submission.command.type === 'invoice.void'
            ? t('billing:invoice_voided_its_original_lines_and_history_are_retained')
            : t('billing:invoice_issued'),
      );
      setRefresh((n) => n + 1);
      onSaved();
    } catch (e) {
      if (!mounted.current) return;
      const uncertain =
        !(e instanceof ApiError) ||
        e.status === 0 ||
        e.status >= 500 ||
        (submission.uncertain && e.status === 429);
      if (uncertain) setPending({ ...submission, uncertain: true });
      else {
        setPending(null);
        onPending(false);
      }
      if (e instanceof ApiError && e.status === 401) onSessionError(e);
      else {
        setError(failure(e));
        if (!uncertain && e instanceof ApiError && e.status === 409) {
          setConfirmed(false);
          setPaymentConfirmed(false);
          setVoidConfirmed(false);
          if (submission.command.type === 'invoice.issue') setPricesStale(true);
          setRefresh((n) => n + 1);
        }
      }
    } finally {
      inflight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function send(command: BillingCommand) {
    if (locked || readsBlocked) return;
    const parsed = billingCommandSchema.safeParse(command);
    if (!parsed.success) {
      setError(
        uiMessage(
          'billing:check_the_amounts_quantities_and_required_reference_or_reason_before_saving',
        ),
      );
      return;
    }
    void submit({ key: crypto.randomUUID(), command: parsed.data, uncertain: false });
  }
  const amountMinor = parseETB(amount.trim());
  return (
    <section className="billing-workspace" aria-label={t('billing:visit_billing')}>
      <div className="section-heading">
        <div>
          <h2 ref={title} tabIndex={-1}>
            {preparing
              ? t('billing:prepare_invoice')
              : invoice
                ? t('dynamic:invoice_number', { number: invoice.number })
                : t('billing:invoices_and_payments')}
          </h2>
          <p>ETB · Billing is separate from clinical completion.</p>
        </div>
        <div className="button-row">
          {(selected || preparing) && (
            <button disabled={locked} onClick={() => changeView(null)}>
              {' '}
              {t('billing:all_invoices')}{' '}
            </button>
          )}
          {!preparing && list?.permissions.issue && (
            <button disabled={locked} onClick={() => changeView(null, true)}>
              {' '}
              {t('billing:prepare_invoice')}{' '}
            </button>
          )}
          <button
            disabled={locked || loading || detailLoading}
            onClick={() => setRefresh((n) => n + 1)}
          >
            {' '}
            {t('billing:refresh_billing')}{' '}
          </button>
        </div>
      </div>
      {notice && (
        <p className="notice success" role="status">
          {interfaceMessage(notice)}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {interfaceMessage(error)}
        </p>
      )}
      {pending && (
        <div className="notice warning" role="status">
          <span>
            {busy
              ? t('billing:saving_billing_record')
              : t(
                  'billing:this_save_is_not_yet_confirmed_retry_the_same_request_to_find_or_finish_the_original_record',
                )}
          </span>
          <button disabled={busy || disabled} onClick={() => void submit(pending)}>
            {busy ? t('common:saving') : t('billing:retry_billing_save')}
          </button>
        </div>
      )}
      {readError && (
        <div className="notice error" role="alert">
          <span>
            {readError} {t('billing:saved_records_have_not_changed')}
          </span>
          <button
            disabled={locked || loading || detailLoading}
            onClick={() => setRefresh((n) => n + 1)}
          >
            {' '}
            {t('billing:retry_loading_billing')}{' '}
          </button>
        </div>
      )}
      {loading && (
        <p role="status" className="empty-small">
          {' '}
          {t('billing:loading_billing')}{' '}
        </p>
      )}
      {list && (
        <dl className="billing-summary">
          <div>
            <dt>{t('common:financial_status')}</dt>
            <dd>
              {list.summary.state === 'unbilled'
                ? t('common:not_yet_billed')
                : list.summary.state === 'settled'
                  ? t('common:settled')
                  : t('billing:payment_outstanding')}
            </dd>
          </div>
          <div>
            <dt>{t('billing:invoiced')}</dt>
            <dd>{money(list.summary.totalMinor)}</dd>
          </div>
          <div>
            <dt>{t('common:paid')}</dt>
            <dd>{money(list.summary.paidMinor)}</dd>
          </div>
          <div>
            <dt>{t('common:balance')}</dt>
            <dd>{money(list.summary.balanceMinor)}</dd>
          </div>
        </dl>
      )}
      {dirty && (
        <div className="notice warning">
          <span>{t('billing:unsaved_billing_draft')}</span>
          <button disabled={locked} onClick={clearDrafts}>
            {' '}
            {t('billing:discard_billing_draft')}{' '}
          </button>
        </div>
      )}
      {preparing && (
        <>
          <div className="billing-catalog">
            <label htmlFor="billing-service-search">
              {t('billing:find_a_service_by_name_or_code')}
            </label>
            <input
              id="billing-service-search"
              type="search"
              maxLength={120}
              value={query}
              disabled={locked}
              onChange={(e) => {
                setQuery(e.target.value);
                setCatalogPage(1);
              }}
            />
            {catalogLoading ? (
              <p role="status">{t('billing:loading_services')}</p>
            ) : catalogError ? (
              <div role="alert">
                <p>{catalogError}</p>
                <button disabled={locked} onClick={() => setRefresh((n) => n + 1)}>
                  {' '}
                  {t('billing:retry_loading_services')}{' '}
                </button>
              </div>
            ) : (
              catalog && (
                <>
                  {catalog.entries.length ? (
                    <ul className="billing-services">
                      {(catalog.entries as Service[]).map((service) => (
                        <li key={service.id}>
                          <div>
                            <strong>{service.name}</strong>
                            <small>
                              {service.code} · {service.departmentName}
                            </small>
                          </div>
                          <span>{money(service.priceMinor)}</span>
                          <button
                            disabled={
                              locked ||
                              lines.length >= 20 ||
                              lines.some((line) => line.service.id === service.id)
                            }
                            aria-label={t('dynamic:add_service', { name: service.name })}
                            onClick={() => {
                              setLines((previous) => [...previous, { service, quantity: 1 }]);
                              setConfirmed(false);
                            }}
                          >
                            {' '}
                            {t('common:add')}{' '}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="empty-small">
                      {' '}
                      {t(
                        'billing:no_active_services_match_an_administrator_can_configure_services_and_prices_in_hospital_setting',
                      )}{' '}
                    </p>
                  )}
                  <div className="staff-pagination">
                    <p>
                      {' '}
                      {t('billing:services_page')} {catalog.page} {t('common:of')}{' '}
                      {Math.max(1, Math.ceil(catalog.total / catalog.pageSize))}
                    </p>
                    <div className="button-row">
                      <button
                        disabled={locked || catalogPage === 1}
                        onClick={() => setCatalogPage((n) => n - 1)}
                      >
                        {' '}
                        {t('billing:previous_services')}{' '}
                      </button>
                      <button
                        disabled={locked || catalog.page * catalog.pageSize >= catalog.total}
                        onClick={() => setCatalogPage((n) => n + 1)}
                      >
                        {' '}
                        {t('billing:next_services')}{' '}
                      </button>
                    </div>
                  </div>
                </>
              )
            )}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (confirmed && validTotal && !pricesStale)
                send({
                  type: 'invoice.issue',
                  lines: lines.map((line) => ({
                    serviceId: line.service.id,
                    serviceRevision: line.service.revision,
                    quantity: line.quantity,
                  })),
                });
            }}
          >
            <h3>{t('billing:invoice_lines')}</h3>
            <p>
              {' '}
              {t(
                'billing:review_the_selected_service_versions_quantities_and_total_before_issuing_issued_lines_cannot_be',
              )}{' '}
            </p>
            {!lines.length && (
              <p className="empty-small">
                {' '}
                {t(
                  'billing:add_the_services_provided_during_this_visit_no_charges_are_added_automatically',
                )}{' '}
              </p>
            )}
            <ul className="billing-draft-lines">
              {lines.map((line) => (
                <li key={line.service.id}>
                  <div>
                    <strong>{line.service.name}</strong>
                    <small>
                      {line.service.code} {t('common:version')} {line.service.revision} ·{' '}
                      {money(line.service.priceMinor)} {t('billing:each')}{' '}
                    </small>
                    {(!line.service.active || !line.service.departmentActive) && (
                      <p className="billing-invalid">
                        {' '}
                        {t('billing:unavailable_remove_this_service_before_issuing')}{' '}
                      </p>
                    )}
                  </div>
                  <div>
                    <label htmlFor={`qty-${line.service.id}`}>
                      {' '}
                      {t('billing:quantity_for')} {line.service.name}
                    </label>
                    <input
                      id={`qty-${line.service.id}`}
                      type="number"
                      min="1"
                      max="100"
                      step="1"
                      required
                      disabled={locked}
                      value={line.quantity || ''}
                      onChange={(e) => {
                        const quantity = Number(e.target.value);
                        setLines((previous) =>
                          previous.map((item) =>
                            item.service.id === line.service.id ? { ...item, quantity } : item,
                          ),
                        );
                        setConfirmed(false);
                      }}
                    />
                  </div>
                  <span>
                    {line.service.priceMinor * line.quantity >= 0 &&
                    line.service.priceMinor * line.quantity <= MAX_PRICE_MINOR &&
                    Number.isSafeInteger(line.service.priceMinor * line.quantity)
                      ? money(line.service.priceMinor * line.quantity)
                      : t('billing:check_quantity')}
                  </span>
                  <button
                    type="button"
                    disabled={locked}
                    aria-label={t('dynamic:remove_service', { name: line.service.name })}
                    onClick={() => {
                      setLines((previous) =>
                        previous.filter((item) => item.service.id !== line.service.id),
                      );
                      setConfirmed(false);
                    }}
                  >
                    {' '}
                    {t('billing:remove')}{' '}
                  </button>
                </li>
              ))}
            </ul>
            {lines.length > 0 && (
              <>
                <div className="invoice-total">
                  <strong>{t('billing:invoice_total')}</strong>
                  <strong>
                    {validTotal && Number.isSafeInteger(total) && total >= 0
                      ? money(total)
                      : t('billing:total_exceeds_the_permitted_amount')}
                  </strong>
                </div>
                <div className="button-row">
                  <button type="button" disabled={locked} onClick={() => void refreshPrices()}>
                    {pricesLoading
                      ? t('billing:loading_prices')
                      : t('billing:refresh_selected_prices')}
                  </button>
                </div>
                {pricesStale && (
                  <p className="notice warning">
                    {' '}
                    {t(
                      'billing:the_catalog_or_visit_changed_refresh_selected_prices_and_review_the_invoice_again',
                    )}{' '}
                  </p>
                )}
                <label className="billing-confirm">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={locked || pricesStale}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />{' '}
                  {t('billing:i_reviewed_these_invoice_lines_and_the_total')}{' '}
                </label>
                <button
                  className="primary"
                  disabled={
                    locked ||
                    readsBlocked ||
                    !confirmed ||
                    !validTotal ||
                    pricesStale ||
                    lines.some(
                      (line) =>
                        !line.service.active ||
                        !line.service.departmentActive ||
                        !Number.isInteger(line.quantity) ||
                        line.quantity < 1 ||
                        line.quantity > 100,
                    )
                  }
                >
                  {' '}
                  {t('billing:issue_invoice')}{' '}
                </button>
              </>
            )}
          </form>
        </>
      )}
      {!preparing && !selected && list && !loading && (
        <>
          {list.invoices.length ? (
            <div
              role="region"
              aria-label={t('billing:invoices')}
              tabIndex={0}
              className="table-region"
            >
              <table>
                <thead>
                  <tr>
                    <th>{t('billing:invoice')}</th>
                    <th>{t('common:status')}</th>
                    <th>{t('common:total')}</th>
                    <th>{t('common:paid')}</th>
                    <th>{t('common:balance')}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.invoices.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <button
                          disabled={locked}
                          className="patient-visit-link"
                          onClick={() => changeView(item.id)}
                        >
                          {item.number}
                        </button>
                        <small>{when(item.issuedAt)}</small>
                      </td>
                      <td>
                        {item.status === 'void'
                          ? t('billing:void')
                          : item.balanceMinor
                            ? t('billing:payment_outstanding')
                            : t('common:settled')}
                      </td>
                      <td>{money(item.totalMinor)}</td>
                      <td>{money(item.paidMinor)}</td>
                      <td>{money(item.balanceMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty-small">
              {' '}
              {t(
                'billing:no_invoices_issued_prepare_an_invoice_from_the_hospital_s_service_catalog_when_the_charges_are_',
              )}{' '}
            </p>
          )}
          <div className="staff-pagination">
            <p>
              {list.total} {t('billing:invoices_page')} {list.page} {t('common:of')}{' '}
              {Math.max(1, Math.ceil(list.total / list.pageSize))}
            </p>
            <div className="button-row">
              <button disabled={locked || page === 1} onClick={() => setPage((n) => n - 1)}>
                {' '}
                {t('billing:previous_invoices')}{' '}
              </button>
              <button
                disabled={locked || list.page * list.pageSize >= list.total}
                onClick={() => setPage((n) => n + 1)}
              >
                {' '}
                {t('billing:next_invoices')}{' '}
              </button>
            </div>
          </div>
        </>
      )}
      {detailLoading && <p role="status">{t('billing:loading_invoice')}</p>}
      {!preparing && selected && detail && invoice && (
        <>
          <p>
            {' '}
            {t('billing:invoice_id')} <code>{invoice.id}</code> {t('common:revision')}{' '}
            {invoice.revision}
          </p>
          <button type="button" onClick={() => window.print()}>
            {' '}
            {t('billing:print_factual_invoice_statement')}{' '}
          </button>
          <p>
            {' '}
            {t('billing:issued')} {when(invoice.issuedAt)} {t('billing:by')} {invoice.actorName}.{' '}
            <strong>
              {invoice.status === 'void'
                ? t('billing:void')
                : invoice.balanceMinor
                  ? t('billing:payment_outstanding')
                  : t('common:settled')}
            </strong>
          </p>
          <div className="invoice">
            {detail.lines.map((line) => (
              <div key={line.id}>
                <span>
                  {line.name}
                  <small>
                    {line.code} · {line.quantity} × {money(line.unitPriceMinor)}{' '}
                    {t('common:version')} {line.serviceRevision}
                  </small>
                </span>
                <strong>{money(line.totalMinor)}</strong>
              </div>
            ))}
            <div>
              <span>{t('billing:original_charges')}</span>
              <strong>{money(invoice.chargeMinor ?? invoice.totalMinor)}</strong>
            </div>
            <div>
              <span>{t('billing:credits_and_discounts')}</span>
              <strong>{money(invoice.creditedMinor ?? 0)}</strong>
            </div>
            <div className="invoice-total">
              <strong>{t('billing:net_invoice_total')}</strong>
              <strong>{money(invoice.totalMinor)}</strong>
            </div>
            <div>
              <span>{t('billing:collected')}</span>
              <strong>{money(invoice.collectedMinor ?? invoice.paidMinor)}</strong>
            </div>
            <div>
              <span>{t('billing:refunded_or_reversed')}</span>
              <strong>{money(invoice.refundedMinor ?? 0)}</strong>
            </div>
            <div>
              <span>{t('billing:net_paid')}</span>
              <strong>{money(invoice.paidMinor)}</strong>
            </div>
            <div>
              <strong>{t('common:balance')}</strong>
              <strong>{money(invoice.balanceMinor)}</strong>
            </div>
          </div>
          {list?.permissions.pay && invoice.status === 'issued' && invoice.balanceMinor > 0 && (
            <form
              className="billing-payment-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (paymentConfirmed && amountMinor !== null)
                  send({
                    type: 'payment.record',
                    invoiceId: invoice.id,
                    expectedRevision: invoice.revision,
                    amountMinor,
                    method,
                    reference: reference.trim(),
                  });
              }}
            >
              <h3>{t('billing:record_a_payment')}</h3>
              <p>
                {' '}
                {t(
                  'billing:record_money_already_received_a_manual_transfer_record_does_not_verify_or_move_funds',
                )}{' '}
              </p>
              <div className="billing-form-grid">
                <div>
                  <label htmlFor="billing-amount">{t('billing:amount_received_etb')}</label>
                  <input
                    id="billing-amount"
                    inputMode="decimal"
                    required
                    maxLength={10}
                    value={amount}
                    disabled={locked}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setPaymentConfirmed(false);
                    }}
                  />
                </div>
                <div>
                  <label htmlFor="billing-method">{t('billing:payment_method')}</label>
                  <select
                    id="billing-method"
                    value={method}
                    disabled={locked}
                    onChange={(e) => {
                      setMethod(e.target.value as typeof method);
                      setPaymentConfirmed(false);
                    }}
                  >
                    <option value="cash">{t('common:cash')}</option>
                    <option value="manual_transfer">{t('common:manual_transfer')}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="billing-reference">
                    {method === 'manual_transfer'
                      ? t('billing:transfer_reference_required')
                      : t('billing:reference_optional')}
                  </label>
                  <input
                    id="billing-reference"
                    required={method === 'manual_transfer'}
                    maxLength={200}
                    value={reference}
                    disabled={locked}
                    onChange={(e) => {
                      setReference(e.target.value);
                      setPaymentConfirmed(false);
                    }}
                  />
                </div>
              </div>
              {amount &&
                (amountMinor === null ||
                  amountMinor <= 0 ||
                  amountMinor > invoice.balanceMinor) && (
                  <p className="billing-invalid">
                    {' '}
                    {t('billing:enter_a_positive_amount_up_to')} {money(invoice.balanceMinor)}
                    {t('billing:with_no_more_than_two_decimal_places')}{' '}
                  </p>
                )}
              <label className="billing-confirm">
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={paymentConfirmed}
                  onChange={(e) => setPaymentConfirmed(e.target.checked)}
                />{' '}
                {t('billing:i_confirm_this_money_was_received_and_the_details_are_correct')}{' '}
              </label>
              <button
                className="primary"
                disabled={
                  locked ||
                  readsBlocked ||
                  !paymentConfirmed ||
                  amountMinor === null ||
                  amountMinor <= 0 ||
                  amountMinor > invoice.balanceMinor ||
                  (method === 'manual_transfer' && !reference.trim())
                }
              >
                {' '}
                {t('billing:record_payment')}{' '}
              </button>
            </form>
          )}
          {list?.permissions.void &&
            invoice.status === 'issued' &&
            (invoice.collectedMinor ?? invoice.paidMinor) === 0 && (
              <form
                className="billing-void-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (voidConfirmed)
                    send({
                      type: 'invoice.void',
                      invoiceId: invoice.id,
                      expectedRevision: invoice.revision,
                      reason: reason.trim(),
                    });
                }}
              >
                <h3>{t('billing:void_unpaid_invoice')}</h3>
                <p>{t('billing:the_invoice_and_reason_remain_in_the_financial_history')}</p>
                <label htmlFor="billing-void-reason">{t('billing:reason_for_voiding')}</label>
                <input
                  id="billing-void-reason"
                  required
                  maxLength={200}
                  value={reason}
                  disabled={locked}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setVoidConfirmed(false);
                  }}
                />
                <label className="billing-confirm">
                  <input
                    type="checkbox"
                    disabled={locked}
                    checked={voidConfirmed}
                    onChange={(e) => setVoidConfirmed(e.target.checked)}
                  />{' '}
                  {t('billing:i_confirm_this_unpaid_invoice_should_be_voided')}{' '}
                </label>
                <button disabled={locked || readsBlocked || !reason.trim() || !voidConfirmed}>
                  {' '}
                  {t('billing:void_invoice')}{' '}
                </button>
              </form>
            )}
          {(((invoice.status === 'void' || invoice.balanceMinor === 0) && (amount || reference)) ||
            ((invoice.status === 'void' || invoice.paidMinor > 0) && reason)) && (
            <div className="notice warning">
              <p>
                {' '}
                {t(
                  'billing:the_invoice_changed_these_unsaved_details_cannot_be_recorded_here_copy_them_or_discard_the_bill',
                )}{' '}
              </p>
              {(invoice.status === 'void' || invoice.balanceMinor === 0) &&
                (amount || reference) && (
                  <p className="preserve">
                    {' '}
                    {t('billing:unsaved_payment')} {amount || t('billing:no_amount')} ETB ·{' '}
                    {method === 'cash' ? t('common:cash') : t('common:manual_transfer')} ·{' '}
                    {reference || t('billing:no_reference')}
                  </p>
                )}
              {(invoice.status === 'void' || invoice.paidMinor > 0) && reason && (
                <p className="preserve">
                  {t('billing:unsaved_void_reason')} {reason}
                </p>
              )}
            </div>
          )}
          <h3>{t('billing:financial_adjustments')}</h3>
          {!detail.adjustments?.length && (
            <p>{t('billing:no_credits_discounts_refunds_or_reversals_recorded')}</p>
          )}
          <ul className="timeline">
            {detail.adjustments?.map((entry) => (
              <li key={entry.id}>
                <strong>
                  {presentationLabel(entry.kind)} · {money(entry.amountMinor)}
                </strong>
                <small>
                  {when(entry.at)} · {entry.actorName} {t('billing:authority')} {entry.authorityId}
                </small>
                <p>
                  ID {entry.id}
                  {entry.paymentId ? t('dynamic:original_payment', { id: entry.paymentId }) : ''}
                </p>
                <p>{entry.reason}</p>
                {entry.reference && (
                  <p>
                    {t('billing:manual_transfer_reference')} {entry.reference}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <h3>{t('billing:financial_history')}</h3>
          <ul className="timeline">
            {detail.events.map((event) => (
              <li key={event.id}>
                <strong>
                  {event.action === 'invoice.issue'
                    ? t('billing:invoice_issued_2')
                    : event.action === 'invoice.void'
                      ? t('billing:invoice_voided')
                      : t('billing:payment_recorded')}
                </strong>
                <small>
                  {when(event.createdAt)} · {event.actorName}
                </small>
                {event.reason && <p className="preserve">{event.reason}</p>}
                {event.payment && (
                  <div>
                    <p>
                      <strong>
                        {t('billing:receipt')} {event.payment.receiptNumber}
                      </strong>
                      <small>
                        {' '}
                        {t('billing:payment_id')} {event.payment.id} {t('billing:receipt_id')}{' '}
                        {event.payment.receiptId} {t('billing:actor')} {event.payment.actorId}
                      </small>{' '}
                      · {money(event.payment.amountMinor)} ·{' '}
                      {event.payment.method === 'cash'
                        ? t('common:cash')
                        : t('common:manual_transfer')}
                    </p>
                    {event.payment.reference && (
                      <p className="preserve">
                        {t('billing:reference')} {event.payment.reference}
                      </p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="staff-pagination">
            <p>
              {' '}
              {t('billing:history_page')} {detail.page} {t('common:of')}{' '}
              {Math.max(1, Math.ceil(detail.total / detail.pageSize))}
            </p>
            <div className="button-row">
              <button
                disabled={locked || detailLoading || historyPage === 1}
                onClick={() => setHistoryPage((n) => n - 1)}
              >
                {' '}
                {t('billing:previous_billing_history')}{' '}
              </button>
              <button
                disabled={locked || detailLoading || detail.page * detail.pageSize >= detail.total}
                onClick={() => setHistoryPage((n) => n + 1)}
              >
                {' '}
                {t('billing:next_billing_history')}{' '}
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
