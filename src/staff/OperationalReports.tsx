import { useEffect, useRef, useState } from 'react';
import type { Session } from '../../shared/registration';
import { reportQuerySchema, type OperationalReport } from '../../shared/reports';
import { request, ApiError } from './api';
import './reports.css';
export function reportMoney(minor: string) {
  const amount = BigInt(minor),
    absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? '-' : ''}${(absolute / 100n).toLocaleString('en-US')}.${(absolute % 100n).toString().padStart(2, '0')} ETB`;
}
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Addis_Ababa',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const quantity = (value: string) => BigInt(value).toLocaleString('en-US');
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
      setError('Choose valid Gregorian dates in order, covering no more than 366 days.');
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
          e instanceof Error ? e.message : 'The report could not be loaded. Retry the report.',
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
            Operational reports
          </h1>
          <p>Period activity and current outstanding work for {session.user.hospital.name}.</p>
        </div>
      </div>
      <form
        className="panel report-range"
        aria-label="Report dates"
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <div>
          <label htmlFor="report-from">From date</label>
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
          <label htmlFor="report-to">Through date</label>
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
          Run report
        </button>
        <p>
          Gregorian dates · Africa/Addis_Ababa · Both dates included, up to 366 days. Each
          successful report read is recorded.
        </p>
      </form>
      {loading && (
        <p role="status" className="notice">
          Loading report…
        </p>
      )}
      {error && (
        <div className="notice error">
          <p role="alert">{error}</p>
          <button onClick={() => void run(requestedPage.current)}>Retry report</button>
        </div>
      )}
      {!report && !loading && !error && (
        <p className="empty">
          Choose your dates and run a report. Only sections available to your role will appear.
        </p>
      )}
      {report && (
        <div className="report-results" aria-label="Report results">
          <div className="report-context">
            <h2 ref={resultHeading} tabIndex={-1}>
              Report for {report.range.from} through {report.range.to}
            </h2>
            <p>
              Generated{' '}
              {new Intl.DateTimeFormat('en-GB', {
                timeZone: 'Africa/Addis_Ababa',
                dateStyle: 'medium',
                timeStyle: 'medium',
              }).format(new Date(report.generatedAt))}{' '}
              · Addis Ababa
            </p>
            <p>
              Period activity uses the selected dates. Current outstanding work and stock reflect
              this generation time, regardless of those dates.
            </p>
            <details>
              <summary>Report boundary and access record</summary>
              <p>
                Inclusive start: {report.range.start}
                <br />
                Exclusive end: {report.range.endExclusive}
                <br />
                Read audit ID: {report.auditId}
              </p>
            </details>
          </div>
          {report.operations && (
            <section className="panel" aria-labelledby="report-operations">
              <h2 id="report-operations">Visit operations</h2>
              <h3>Selected period activity</h3>
              <dl className="report-values">
                <div>
                  <dt>Visits opened</dt>
                  <dd>{report.operations.period.visitsOpened.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Visits closed</dt>
                  <dd>{report.operations.period.visitsClosed.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Note amendments</dt>
                  <dd>{report.operations.period.noteAmendments.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Result corrections</dt>
                  <dd>{report.operations.period.resultCorrections.toLocaleString()}</dd>
                </div>
              </dl>
              <p className="report-definition">
                Opening and closure are counted independently by their own timestamps. Amendments
                and corrections count recorded changes, including changes after closure.
              </p>
              <h3>Current outstanding work</h3>
              <dl className="report-values">
                <div>
                  <dt>Active visits</dt>
                  <dd>{report.operations.current.activeVisits.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Investigations awaiting completion</dt>
                  <dd>{report.operations.current.pendingInvestigations.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Pending prescriptions</dt>
                  <dd>{report.operations.current.pendingPrescriptions.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Corrected results awaiting review</dt>
                  <dd>
                    {report.operations.current.pendingCorrectedResultReviews.toLocaleString()}
                  </dd>
                </div>
              </dl>
              <p className="report-definition">
                Investigations exclude reviewed or cancelled orders. Partial prescription supply
                remains pending. Corrected-result reviews include closed visits and count the latest
                correction awaiting review.
              </p>
            </section>
          )}
          {report.finance && (
            <section className="panel" aria-labelledby="report-finance">
              <h2 id="report-finance">Recorded payments</h2>
              <h3>Selected period receipts</h3>
              <div
                className="table-region"
                role="region"
                aria-label="Receipts by payment method"
                tabIndex={0}
              >
                <table className="report-receipts">
                  <thead>
                    <tr>
                      <th>Method</th>
                      <th>Receipts</th>
                      <th>Collected amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(['cash', 'manual_transfer'] as const).map((method) => (
                      <tr key={method}>
                        <th scope="row">{method === 'cash' ? 'Cash' : 'Manual transfer'}</th>
                        <td>{report.finance!.period.byMethod[method].receiptCount}</td>
                        <td>
                          {reportMoney(report.finance!.period.byMethod[method].collectedMinor)}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <th scope="row">Total</th>
                      <td>{report.finance.period.receiptCount}</td>
                      <td>{reportMoney(report.finance.period.collectedMinor)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="report-definition">
                Counted once per receipt by payment recording time. These are recorded collections,
                not revenue, bank reconciliation or tax reporting. Legacy demonstration payments are
                excluded.
              </p>
              <dl className="report-values">
                <div>
                  <dt>Refunds and reversals in selected period</dt>
                  <dd>{reportMoney(report.finance.period.refundedMinor ?? '0')}</dd>
                </div>
                <div>
                  <dt>Credits and discounts in selected period</dt>
                  <dd>{reportMoney(report.finance.period.creditedMinor ?? '0')}</dd>
                </div>
                <div>
                  <dt>Net recorded collections</dt>
                  <dd>
                    {reportMoney(
                      report.finance.period.netCollectedMinor ??
                        report.finance.period.collectedMinor,
                    )}
                  </dd>
                </div>
              </dl>
              <h3>Current invoice balances</h3>
              <dl className="report-values">
                <div>
                  <dt>Invoices with an outstanding balance</dt>
                  <dd>{report.finance.current.outstandingInvoiceCount}</dd>
                </div>
                <div>
                  <dt>Outstanding amount</dt>
                  <dd>{reportMoney(report.finance.current.outstandingMinor)}</dd>
                </div>
              </dl>
              <p className="report-definition">
                Net catalog invoices less net recorded payments, after credits and refunds,
                excluding void invoices. This includes collectible balances after clinical closure.
              </p>
            </section>
          )}
          {report.inventory && (
            <section className="panel" aria-labelledby="report-inventory">
              <h2 id="report-inventory">Product stock</h2>
              <p className="report-definition">
                Whole base units per product; different units are never added together. Current
                eligibility uses Addis Ababa date {report.inventory.today}. Exclusions are separate
                categories: inactive product first, then quarantine, expired, expiry today, or
                available.
              </p>
              {!report.inventory.entries.length ? (
                <p className="empty-small">
                  {report.inventory.total === 0
                    ? 'No inventory products configured.'
                    : 'No products on this page. Return to the previous page.'}
                </p>
              ) : (
                <>
                  <h3>Current stock</h3>
                  <div
                    className="table-region"
                    role="region"
                    aria-label="Current product stock"
                    tabIndex={0}
                  >
                    <table>
                      <thead>
                        <tr>
                          <th>Product / base unit</th>
                          <th>Total</th>
                          <th>Available</th>
                          <th>Inactive</th>
                          <th>Quarantined</th>
                          <th>Expired</th>
                          <th>Expires today</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.inventory.entries.map((product) => (
                          <tr key={product.productId}>
                            <th scope="row">
                              {product.name}
                              <small>
                                {product.code} · {product.unit}
                                {!product.active ? ' · Inactive' : ''}
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
                              <td key={key}>{quantity(product.current[key])}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {report.inventory.entries.some((p) => p.returns) && (
                    <>
                      <h3>Patient return reconciliation</h3>
                      <p className="report-definition">
                        Returned units stay outside usable stock while quarantined. Authorized
                        restock movements are included in received stock; they are shown here for
                        lineage and are not added again.
                      </p>
                      <div
                        className="table-region"
                        role="region"
                        aria-label="Patient return reconciliation"
                        tabIndex={0}
                      >
                        <table>
                          <thead>
                            <tr>
                              <th>Product / base unit</th>
                              <th>Returned total</th>
                              <th>Quarantined returns</th>
                              <th>Authorized restock</th>
                              <th>Authorized disposal</th>
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
                  <h3>Selected period stock movements</h3>
                  <div
                    className="table-region"
                    role="region"
                    aria-label="Period stock movements"
                    tabIndex={0}
                  >
                    <table>
                      <thead>
                        <tr>
                          <th>Product / base unit</th>
                          <th>Received</th>
                          <th>Supplied</th>
                          <th>Net adjustments</th>
                          <th>Net movement</th>
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
                    Net movement = received − supplied + signed adjustments. Cancelling a
                    prescription remainder does not return supplied stock.
                  </p>
                </>
              )}
              <div className="staff-pagination">
                <p>
                  {report.inventory.total} products · Page {report.inventory.page} of{' '}
                  {Math.max(1, Math.ceil(report.inventory.total / 25))}
                </p>
                <div className="button-row">
                  <button
                    disabled={report.inventory.page === 1}
                    onClick={() => void run(report.inventory!.page - 1)}
                  >
                    Previous report products
                  </button>
                  <button
                    disabled={report.inventory.page * 25 >= report.inventory.total}
                    onClick={() => void run(report.inventory!.page + 1)}
                  >
                    Next report products
                  </button>
                </div>
              </div>
              <p className="report-definition">
                Each page is a new audited snapshot. Stock may change between pages.
              </p>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
