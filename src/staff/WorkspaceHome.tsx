import { isPlainLinkClick, destinations, surfacePath, type Surface } from './navigation';
import { formatNumber, formatMinorCurrency, formatDate } from '../i18n';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, ArrowRight } from 'lucide-react';
import type { Session } from '../../shared/registration';
import type { VisitPage } from '../../shared/outpatient';
import { reportSections, type OperationalReport } from '../../shared/reports';
import { request, ApiError } from './api';
import { Chart } from './ReportAnalysis';
import './reports.css';
export default function WorkspaceHome({
  session,
  onNavigate,
  onSessionError,
}: {
  session: Session;
  onNavigate: (id: Surface) => void;
  onSessionError: (error: unknown) => void;
}) {
  const { t } = useTranslation();
  const [queue, setQueue] = useState<VisitPage | null>(null);
  const [queueLoadedAt, setQueueLoadedAt] = useState<string | null>(null);
  const [report, setReport] = useState<OperationalReport | null>(null);
  const [failed, setFailed] = useState(false);
  const [reportFailed, setReportFailed] = useState(false);
  const permitted = reportSections[session.user.role].length > 0;
  useEffect(() => {
    const abort = new AbortController();
    let active = true;
    setQueue(null);
    setQueueLoadedAt(null);
    setReport(null);
    setFailed(false);
    setReportFailed(false);
    const failure = (error: unknown, reportRead = false) => {
      if (!active) return;
      if (error instanceof ApiError && error.status === 401) onSessionError(error);
      else if (reportRead) setReportFailed(true);
      else setFailed(true);
    };
    void request<VisitPage>('/api/visits/search', {
      method: 'POST',
      headers: { 'X-CSRF-Token': session.csrfToken },
      body: JSON.stringify({ q: '', status: 'active', assigned: 'all', page: 1 }),
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
    })
      .then((value) => {
        if (active) {
          setQueue(value);
          setQueueLoadedAt(new Date().toISOString());
        }
      })
      .catch((error) => failure(error));
    if (permitted) {
      const to = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Addis_Ababa',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      const start = new Date(`${to}T12:00:00Z`);
      start.setUTCDate(start.getUTCDate() - 6);
      const from = start.toISOString().slice(0, 10);
      void request<OperationalReport>(
        `/api/reports/operational?from=${from}&to=${to}&inventoryPage=1`,
        { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) },
      )
        .then((value) => {
          if (active) setReport(value);
        })
        .catch((error) => failure(error, true));
    }
    return () => {
      active = false;
      abort.abort();
    };
  }, [session.csrfToken, session.user.role]);
  function link(id: Surface, label: string, className?: string) {
    return (
      <a
        className={className}
        href={surfacePath(id)}
        onClick={(event) => {
          if (!isPlainLinkClick(event)) return;
          event.preventDefault();
          onNavigate(id);
        }}
      >
        {label}
        <ArrowUpRight size={16} aria-hidden="true" />
      </a>
    );
  }
  const tasks = destinations(session.user.role).filter(
    (d) => d.group === 'work' && d.id !== 'home',
  );
  const inventoryOnly = report
    ? Boolean(report.inventory && !report.operations && !report.finance)
    : reportSections[session.user.role].length === 1 &&
      reportSections[session.user.role].includes('inventory');
  return (
    <section className="workspace-home">
      <div className="page-heading home-heading">
        <div>
          <h1>{t('home:title')}</h1>
          <p>
            {t('home:role', { role: t(`labels:roles.${session.user.role}`) })} ·{' '}
            {session.user.hospital.name}
          </p>
        </div>
        {link('patients', t('navigation:patients'), 'home-primary-action')}
      </div>
      <div className="home-current-strip" aria-label={t('home:current')}>
        <div>
          <span>{t('home:queue')}</span>
          <strong>{queue ? formatNumber(queue.total) : '—'}</strong>
          <small>{t('home:current')}</small>
        </div>
        {report?.operations && (
          <>
            <div>
              <span>{t('reports:investigations_awaiting_completion')}</span>
              <strong>{formatNumber(report.operations.current.pendingInvestigations)}</strong>
              <small>{t('home:current')}</small>
            </div>
            <div>
              <span>{t('reports:pending_prescriptions')}</span>
              <strong>{formatNumber(report.operations.current.pendingPrescriptions)}</strong>
              <small>{t('home:current')}</small>
            </div>
            <div>
              <span>{t('reports:corrected_results_awaiting_review')}</span>
              <strong>
                {formatNumber(report.operations.current.pendingCorrectedResultReviews)}
              </strong>
              <small>{t('home:current')}</small>
            </div>
          </>
        )}
        {report?.finance && (
          <div>
            <span>{t('reports:outstanding_amount')}</span>
            <strong>{formatMinorCurrency(report.finance.current.outstandingMinor)}</strong>
            <small>{t('home:current')}</small>
          </div>
        )}
      </div>
      <div className="home-work-grid">
        {permitted && (
          <section className="panel home-analysis">
            <div className="home-section-heading">
              <h2>{t(inventoryOnly ? 'home:stockOverview' : 'home:overview')}</h2>
              {link('reports', t('navigation:reports'))}
            </div>
            {reportFailed ? (
              <p role="alert">{t('home:reportFailed')}</p>
            ) : !report ? (
              <p role="status">{t('reports:loading_report')}</p>
            ) : (
              <>
                <p className="muted">
                  {inventoryOnly
                    ? `${t('home:current')} · ${report.inventory!.today}`
                    : `${report.range.from} – ${report.range.to}`}{' '}
                  {t('reports:addis_ababa')}
                </p>
                {report.operations ? (
                  <>
                    <p className="report-definition">{t('home:activityHelp')}</p>
                    <p className="chart-legend">
                      <span>
                        <i className="line-key" />
                        {t('reports:visits_opened')}:{' '}
                        {formatNumber(report.operations.period.visitsOpened)}
                      </span>
                      <span>
                        <i className="line-key dashed" />
                        {t('reports:visits_closed')}:{' '}
                        {formatNumber(report.operations.period.visitsClosed)}
                      </span>
                    </p>
                    <Chart report={report} kind="visits" />
                  </>
                ) : report.finance ? (
                  <>
                    <p>{t('reports:analysis_mixHelp')}</p>
                    <Chart report={report} kind="collections" />
                    <p>
                      {t('home:gross')}:{' '}
                      <strong>{formatMinorCurrency(report.finance.period.collectedMinor)}</strong>
                    </p>
                  </>
                ) : report.inventory ? (
                  <>
                    <p>{t('home:inventoryHelp')}</p>
                    <ul className="home-stock-list">
                      {report.inventory.entries.slice(0, 5).map((product) => (
                        <li key={product.productId}>
                          <span>
                            {product.name}
                            <small>{product.unit}</small>
                          </span>
                          <strong>
                            {formatNumber(BigInt(product.current.available))}{' '}
                            {t('reports:available')}
                          </strong>
                        </li>
                      ))}
                    </ul>
                    {!report.inventory.entries.length && <p>{t('reports:analysis_noStock')}</p>}
                  </>
                ) : null}
                <p className="home-generated">
                  {t('reports:generated')}{' '}
                  {formatDate(new Date(report.generatedAt), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}{' '}
                  · {t('home:entrySnapshot')}
                </p>
              </>
            )}
          </section>
        )}
        <section className="panel home-destinations">
          <h2>{t('home:tasks')}</h2>
          <p className="muted">{t('home:help')}</p>
          <ul className="home-tasks">
            {tasks.map((d) => (
              <li key={d.id}>{link(d.id, t(d.label))}</li>
            ))}
          </ul>
        </section>
      </div>
      <section className="panel home-queue-panel">
        <div className="home-section-heading">
          <h2>{t('home:queue')}</h2>
          {link('visits', t('navigation:visits'))}
        </div>
        <p className="muted">{t('home:queueHelp')}</p>
        {queueLoadedAt && (
          <p className="home-generated">
            {t('home:queueLoaded', {
              time: formatDate(new Date(queueLoadedAt), {
                dateStyle: 'medium',
                timeStyle: 'medium',
                timeZone: 'Africa/Addis_Ababa',
              }),
            })}
          </p>
        )}
        {failed ? (
          <p role="alert">{t('home:failed')}</p>
        ) : !queue ? (
          <p role="status">{t('home:loading')}</p>
        ) : !queue.visits.length ? (
          <p className="empty">{t('home:empty')}</p>
        ) : (
          <ul className="home-queue">
            {queue.visits.slice(0, 5).map((visit) => (
              <li key={visit.id}>
                <span>{visit.patient.name}</span>
                <span className="home-visit-status">{t('home:active')}</span>
                <a
                  href="/staff/visits"
                  onClick={(event) => {
                    if (!isPlainLinkClick(event)) return;
                    event.preventDefault();
                    onNavigate('visits');
                  }}
                >
                  {t('navigation:visits')}
                  <ArrowRight size={15} aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
