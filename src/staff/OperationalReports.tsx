import { formatMinorCurrency, formatNumber, formatDate } from '../i18n';
import { uiMessage } from '../i18n';
import { interfaceMessage } from '../i18n';
import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import type { Session } from '../../shared/registration';
import { reportQuerySchema, type OperationalReport } from '../../shared/reports';
import { request, ApiError } from './api';
import './reports.css';
import { VisitAnalysis, CollectionAnalysis } from './ReportAnalysis';
export function reportMoney(minor: string) {
  return formatMinorCurrency(minor);
}

const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Addis_Ababa',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const quantity = (value: string) => formatNumber(BigInt(value));
export default function OperationalReports({
  session,
  onSessionError,
}: {
  session: Session;
  onSessionError: (error: unknown) => void;
}) {
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<OperationalReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestedPage = useRef(1);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
    return () => {
      generation.current++;
      controller.current?.abort();
    };
  }, [session.csrfToken]);
  function clear() {
    generation.current++;
    controller.current?.abort();
    setReport(null);
    setError('');
    setLoading(false);
  }
  async function run(page = 1) {
    clear();
    requestedPage.current = page;
    const parsed = reportQuerySchema.safeParse({ from, to, inventoryPage: page });
    if (!parsed.success) {
      setError(
        uiMessage('reports:choose_valid_gregorian_dates_in_order_covering_no_more_than_366_days'),
      );
      return;
    }
    const current = generation.current;
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    try {
      const value = await request<OperationalReport>(
        `/api/reports/operational?from=${parsed.data.from}&to=${parsed.data.to}&inventoryPage=${page}`,
        { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) },
      );
      if (current !== generation.current) return;
      setReport(value);
    } catch (e) {
      if (current !== generation.current) return;
      if (e instanceof ApiError && e.status === 401) onSessionError(e);
      else
        setError(
          e instanceof Error
            ? e.message
            : t('reports:the_report_could_not_be_loaded_retry_the_report'),
        );
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (report) resultHeading.current?.focus({ preventScroll: true });
  }, [report]);
  return (
    <div className="operational-reports">
      <div className="page-heading">
        <div>
          <h1 ref={heading} tabIndex={-1}>
            {' '}
            {t('reports:operational_reports')}{' '}
          </h1>
          <p>
            {t('reports:period_activity_and_current_outstanding_work_for')}{' '}
            {session.user.hospital.name}.
          </p>
        </div>
      </div>
      <form
        className="panel report-range"
        aria-label={t('reports:report_dates')}
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <div>
          <label htmlFor="report-from">{t('reports:from_date')}</label>
          <input
            id="report-from"
            type="date"
            required
            min="0001-01-01"
            max="9999-12-31"
            value={from}
            onChange={(event) => {
              clear();
              requestedPage.current = 1;
              setFrom(event.target.value);
            }}
          />
        </div>
        <div>
          <label htmlFor="report-to">{t('reports:through_date')}</label>
          <input
            id="report-to"
            type="date"
            required
            min="0001-01-01"
            max="9999-12-31"
            value={to}
            onChange={(event) => {
              clear();
              requestedPage.current = 1;
              setTo(event.target.value);
            }}
          />
        </div>
        <button className="primary" disabled={loading}>
          {' '}
          {t('reports:run_report')}{' '}
        </button>
        <p>
          {' '}
          {t(
            'reports:gregorian_dates_africa_addis_ababa_both_dates_included_up_to_366_days_each_successful_report_re',
          )}{' '}
        </p>
      </form>
      {loading && (
        <p role="status" className="notice">
          {' '}
          {t('reports:loading_report')}{' '}
        </p>
      )}
      {error && (
        <div className="notice error">
          <p role="alert">{interfaceMessage(error)}</p>
          <button onClick={() => void run(requestedPage.current)}>
            {t('reports:retry_report')}
          </button>
        </div>
      )}
      {!report && !loading && !error && (
        <p className="empty">
          {' '}
          {t(
            'reports:choose_your_dates_and_run_a_report_only_sections_available_to_your_role_will_appear',
          )}{' '}
        </p>
      )}
      {report && (
        <div className="report-results" aria-label={t('reports:report_results')}>
          <div className="report-context">
            <h2 ref={resultHeading} tabIndex={-1}>
              {' '}
              {t('reports:report_for')} {report.range.from} {t('reports:through')} {report.range.to}
            </h2>
            <p>
              {' '}
              {t('reports:generated')}{' '}
              {formatDate(new Date(report.generatedAt), {
                dateStyle: 'medium',
                timeStyle: 'medium',
              })}{' '}
              {t('reports:addis_ababa')}{' '}
            </p>
            <p>
              {' '}
              {t(
                'reports:period_activity_uses_the_selected_dates_current_outstanding_work_and_stock_reflect_this_generat',
              )}{' '}
            </p>
            <details>
              <summary>{t('reports:report_boundary_and_access_record')}</summary>
              <p>
                {' '}
                {t('reports:inclusive_start')} {report.range.start}
                <br /> {t('reports:exclusive_end')} {report.range.endExclusive}
                <br /> {t('reports:read_audit_id')} {report.auditId}
              </p>
            </details>
          </div>
          {report.operations && (
            <section className="panel" aria-labelledby="report-operations">
              <h2 id="report-operations">{t('reports:visit_operations')}</h2>
              <VisitAnalysis report={report} />
              <h3>{t('reports:selected_period_activity')}</h3>
              <dl className="report-values">
                <div>
                  <dt>{t('reports:visits_opened')}</dt>
                  <dd>{formatNumber(report.operations.period.visitsOpened)}</dd>
                </div>
                <div>
                  <dt>{t('reports:visits_closed')}</dt>
                  <dd>{formatNumber(report.operations.period.visitsClosed)}</dd>
                </div>
                <div>
                  <dt>{t('common:note_amendments')}</dt>
                  <dd>{formatNumber(report.operations.period.noteAmendments)}</dd>
                </div>
                <div>
                  <dt>{t('common:result_corrections')}</dt>
                  <dd>{formatNumber(report.operations.period.resultCorrections)}</dd>
                </div>
              </dl>
              <p className="report-definition">
                {' '}
                {t(
                  'reports:opening_and_closure_are_counted_independently_by_their_own_timestamps_amendments_and_correction',
                )}{' '}
              </p>
              <h3>{t('reports:current_outstanding_work')}</h3>
              <dl className="report-values">
                <div>
                  <dt>{t('reports:active_visits')}</dt>
                  <dd>{formatNumber(report.operations.current.activeVisits)}</dd>
                </div>
                <div>
                  <dt>{t('reports:investigations_awaiting_completion')}</dt>
                  <dd>{formatNumber(report.operations.current.pendingInvestigations)}</dd>
                </div>
                <div>
                  <dt>{t('reports:pending_prescriptions')}</dt>
                  <dd>{formatNumber(report.operations.current.pendingPrescriptions)}</dd>
                </div>
                <div>
                  <dt>{t('reports:corrected_results_awaiting_review')}</dt>
                  <dd>{formatNumber(report.operations.current.pendingCorrectedResultReviews)}</dd>
                </div>
              </dl>
              <p className="report-definition">
                {' '}
                {t(
                  'reports:investigations_exclude_reviewed_or_cancelled_orders_partial_prescription_supply_remains_pending',
                )}{' '}
              </p>
            </section>
          )}
          {report.finance && (
            <section className="panel" aria-labelledby="report-finance">
              <h2 id="report-finance">{t('common:recorded_payments')}</h2>
              <CollectionAnalysis report={report} />
              <h3>{t('reports:selected_period_receipts')}</h3>
              <div
                className="table-region"
                role="region"
                aria-label={t('reports:receipts_by_payment_method')}
                tabIndex={0}
              >
                <table className="report-receipts">
                  <thead>
                    <tr>
                      <th>{t('reports:method')}</th>
                      <th>{t('reports:receipts')}</th>
                      <th>{t('reports:collected_amount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(['cash', 'manual_transfer'] as const).map((method) => (
                      <tr key={method}>
                        <th scope="row">
                          {method === 'cash' ? t('common:cash') : t('common:manual_transfer')}
                        </th>
                        <td>{report.finance!.period.byMethod[method].receiptCount}</td>
                        <td>
                          {reportMoney(report.finance!.period.byMethod[method].collectedMinor)}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <th scope="row">{t('common:total')}</th>
                      <td>{report.finance.period.receiptCount}</td>
                      <td>{reportMoney(report.finance.period.collectedMinor)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="report-definition">
                {' '}
                {t(
                  'reports:counted_once_per_receipt_by_payment_recording_time_these_are_recorded_collections_not_revenue_b',
                )}{' '}
              </p>
              <dl className="report-values">
                <div>
                  <dt>{t('reports:refunds_and_reversals_in_selected_period')}</dt>
                  <dd>{reportMoney(report.finance.period.refundedMinor ?? '0')}</dd>
                </div>
                <div>
                  <dt>{t('reports:credits_and_discounts_in_selected_period')}</dt>
                  <dd>{reportMoney(report.finance.period.creditedMinor ?? '0')}</dd>
                </div>
                <div>
                  <dt>{t('reports:net_recorded_collections')}</dt>
                  <dd>
                    {reportMoney(
                      report.finance.period.netCollectedMinor ??
                        report.finance.period.collectedMinor,
                    )}
                  </dd>
                </div>
              </dl>
              <h3>{t('reports:current_invoice_balances')}</h3>
              <dl className="report-values">
                <div>
                  <dt>{t('reports:invoices_with_an_outstanding_balance')}</dt>
                  <dd>{report.finance.current.outstandingInvoiceCount}</dd>
                </div>
                <div>
                  <dt>{t('reports:outstanding_amount')}</dt>
                  <dd>{reportMoney(report.finance.current.outstandingMinor)}</dd>
                </div>
              </dl>
              <p className="report-definition">
                {' '}
                {t(
                  'reports:net_catalog_invoices_less_net_recorded_payments_after_credits_and_refunds_excluding_void_invoic',
                )}{' '}
              </p>
            </section>
          )}
          {report.inventory && (
            <section className="panel" aria-labelledby="report-inventory">
              <h2 id="report-inventory">{t('reports:product_stock')}</h2>
              <p className="report-definition">
                {' '}
                {t(
                  'reports:whole_base_units_per_product_different_units_are_never_added_together_current_eligibility_uses_',
                )}{' '}
                {report.inventory.today}
                {t(
                  'reports:exclusions_are_separate_categories_inactive_product_first_then_quarantine_expired_expiry_today_',
                )}{' '}
              </p>
              {!report.inventory.entries.length ? (
                <p className="empty-small">
                  {report.inventory.total === 0
                    ? t('reports:no_inventory_products_configured')
                    : t('reports:no_products_on_this_page_return_to_the_previous_page')}
                </p>
              ) : (
                <>
                  <h3>{t('reports:analysis_stock')}</h3>
                  <p className="report-definition">
                    {t('reports:analysis_stockHelp', { page: report.inventory.page })}
                  </p>
                  <div
                    className="table-region stock-matrix"
                    role="region"
                    aria-label={t('reports:current_product_stock')}
                    tabIndex={0}
                  >
                    <table>
                      <thead>
                        <tr>
                          <th>{t('reports:product_base_unit')}</th>
                          <th>{t('common:total')}</th>
                          <th>{t('reports:available')}</th>
                          <th>{t('common:inactive')}</th>
                          <th>{t('common:quarantined')}</th>
                          <th>{t('reports:expired')}</th>
                          <th>{t('reports:expires_today')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.inventory.entries.map((product) => (
                          <tr key={product.productId}>
                            <th scope="row">
                              {product.name}
                              <small>
                                {product.code} · {product.unit}
                                {!product.active ? t('reports:inactive_3') : ''}
                              </small>
                            </th>
                            {(
                              [
                                'total',
                                'available',
                                'inactive',
                                'quarantined',
                                'expired',
                                'expiryToday',
                              ] as const
                            ).map((key) => (
                              <td
                                key={key}
                                className={
                                  key === 'available' && BigInt(product.current[key]) === 0n
                                    ? 'stock-exception'
                                    : BigInt(product.current[key]) > 0n
                                      ? key === 'available'
                                        ? 'stock-available'
                                        : key === 'total'
                                          ? undefined
                                          : 'stock-exception'
                                      : undefined
                                }
                              >
                                {quantity(product.current[key])}
                                {key === 'available' && BigInt(product.current[key]) === 0n && (
                                  <small> {t('reports:analysis_stockUnavailable')}</small>
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {report.inventory.entries.some((p) => p.returns) && (
                    <>
                      <h3>{t('reports:patient_return_reconciliation')}</h3>
                      <p className="report-definition">
                        {' '}
                        {t(
                          'reports:returned_units_stay_outside_usable_stock_while_quarantined_authorized_restock_movements_are_inc',
                        )}{' '}
                      </p>
                      <div
                        className="table-region"
                        role="region"
                        aria-label={t('reports:patient_return_reconciliation')}
                        tabIndex={0}
                      >
                        <table>
                          <thead>
                            <tr>
                              <th>{t('reports:product_base_unit')}</th>
                              <th>{t('reports:returned_total')}</th>
                              <th>{t('reports:quarantined_returns')}</th>
                              <th>{t('reports:authorized_restock')}</th>
                              <th>{t('reports:authorized_disposal')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {report.inventory.entries
                              .filter((p) => p.returns)
                              .map((p) => (
                                <tr key={p.productId}>
                                  <th scope="row">
                                    {p.name}
                                    <small>{p.unit}</small>
                                  </th>
                                  {(
                                    ['total', 'quarantined', 'restocked', 'destroyed'] as const
                                  ).map((key) => (
                                    <td key={key}>{quantity(p.returns![key])}</td>
                                  ))}
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                  <h3>{t('reports:selected_period_stock_movements')}</h3>
                  <div
                    className="table-region"
                    role="region"
                    aria-label={t('reports:period_stock_movements')}
                    tabIndex={0}
                  >
                    <table>
                      <thead>
                        <tr>
                          <th>{t('reports:product_base_unit')}</th>
                          <th>{t('reports:received')}</th>
                          <th>{t('common:supplied')}</th>
                          <th>{t('reports:net_adjustments')}</th>
                          <th>{t('reports:net_movement')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.inventory.entries.map((product) => (
                          <tr key={product.productId}>
                            <th scope="row">
                              {product.name}
                              <small>
                                {product.code} · {product.unit}
                              </small>
                            </th>
                            {(
                              ['received', 'supplied', 'adjustmentNet', 'movementNet'] as const
                            ).map((key) => (
                              <td key={key}>{quantity(product.period[key])}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="report-definition">
                    {' '}
                    {t(
                      'reports:net_movement_received_supplied_signed_adjustments_cancelling_a_prescription_remainder_does_not_',
                    )}{' '}
                  </p>
                </>
              )}
              <div className="staff-pagination">
                <p>
                  {report.inventory.total} {t('common:products_page')} {report.inventory.page}{' '}
                  {t('common:of')} {Math.max(1, Math.ceil(report.inventory.total / 25))}
                </p>
                <div className="button-row">
                  <button
                    disabled={report.inventory.page === 1}
                    onClick={() => void run(report.inventory!.page - 1)}
                  >
                    {' '}
                    {t('reports:previous_report_products')}{' '}
                  </button>
                  <button
                    disabled={report.inventory.page * 25 >= report.inventory.total}
                    onClick={() => void run(report.inventory!.page + 1)}
                  >
                    {' '}
                    {t('reports:next_report_products')}{' '}
                  </button>
                </div>
              </div>
              <p className="report-definition">
                {' '}
                {t(
                  'reports:each_page_is_a_new_audited_snapshot_stock_may_change_between_pages',
                )}{' '}
              </p>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
