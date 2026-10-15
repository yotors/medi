import { Component, lazy, Suspense, type ReactNode } from 'react';
import type { OperationalReport } from '../../shared/reports';
import { t, formatNumber, formatDate } from '../i18n';
import { openingExposure, reportCapturedDate } from './report-analysis';
const Visuals = lazy(() => import('./ReportVisuals'));
class ChartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p role="status">{t('reports:analysis_chartFailed')}</p>
    ) : (
      this.props.children
    );
  }
}
export function Chart({
  report,
  kind,
}: {
  report: OperationalReport;
  kind: 'visits' | 'collections';
}) {
  return (
    <ChartBoundary key={report.auditId}>
      <Suspense fallback={<p role="status">{t('reports:analysis_loading')}</p>}>
        <Visuals report={report} kind={kind} />
      </Suspense>
    </ChartBoundary>
  );
}
export function VisitAnalysis({ report }: { report: OperationalReport }) {
  const activity = report.operations?.activity;
  if (!activity) return <p className="notice">{t('reports:analysis_unavailable')}</p>;
  const cutoff = reportCapturedDate(report);
  const days = Array.from({ length: 7 }, (_, i) => i + 1);
  const weekday = (day: number) =>
    formatDate(new Date(Date.UTC(2026, 9, 11 + day)), { weekday: 'short', timeZone: 'UTC' });
  const max = Math.max(1, ...activity.openings.map((v) => v.count));
  const counts = new Map(activity.openings.map((v) => [`${v.weekday}-${v.hour}`, v.count]));
  return (
    <div className="visit-analysis">
      <h3>{t('reports:analysis_trend')}</h3>
      <p className="report-definition">{t('reports:analysis_trendHelp')}</p>
      <p className="chart-legend">
        <span>
          <i className="line-key" />
          {t('reports:visits_opened')}
        </span>
        <span>
          <i className="line-key dashed" />
          {t('reports:visits_closed')}
        </span>
      </p>
      <Chart report={report} kind="visits" />
      {report.operations!.period.visitsOpened === 0 &&
        report.operations!.period.visitsClosed === 0 && <p>{t('reports:analysis_noActivity')}</p>}
      {activity.daily.length === 1 && <p>{t('reports:analysis_oneDay')}</p>}
      <details className="analysis-table">
        <summary>{t('reports:analysis_dailyTable')}</summary>
        <p>{t('reports:analysis_unobserved')}</p>
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label={t('reports:analysis_dailyTable')}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">{t('reports:analysis_date')}</th>
                <th scope="col">{t('reports:visits_opened')}</th>
                <th scope="col">{t('reports:visits_closed')}</th>
              </tr>
            </thead>
            <tbody>
              {activity.daily.map((day) => (
                <tr key={day.date}>
                  <th scope="row">{day.date}</th>
                  <td>
                    {day.date > cutoff ? (
                      <span role="img" aria-label={t('reports:analysis_unobserved')}>
                        —
                      </span>
                    ) : (
                      formatNumber(day.opened)
                    )}
                  </td>
                  <td>
                    {day.date > cutoff ? (
                      <span role="img" aria-label={t('reports:analysis_unobserved')}>
                        —
                      </span>
                    ) : (
                      formatNumber(day.closed)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <h3>{t('reports:analysis_pattern')}</h3>
      <p className="report-definition">{t('reports:analysis_patternHelp')}</p>
      <p className="report-definition">{t('reports:analysis_exposure')}</p>
      <div
        className="table-scroll opening-pattern"
        tabIndex={0}
        role="region"
        aria-label={t('reports:analysis_pattern')}
      >
        <table>
          <caption>{t('reports:analysis_patternCaption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('reports:analysis_weekday')}</th>
              {Array.from({ length: 24 }, (_, h) => (
                <th scope="col" key={h}>
                  {String(h).padStart(2, '0')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day}>
                <th scope="row">{weekday(day)}</th>
                {Array.from({ length: 24 }, (_, hour) => {
                  const exposure = openingExposure(report, day, hour),
                    value = counts.get(`${day}-${hour}`) ?? 0;
                  return (
                    <td
                      key={hour}
                      className={
                        exposure
                          ? `heat-${value === 0 ? 0 : value / max < 0.34 ? 1 : value / max < 0.67 ? 2 : 3}`
                          : 'unobserved'
                      }
                    >
                      <span>{exposure ? formatNumber(value) : '—'}</span>
                      <span className="sr-only">
                        {t('reports:analysis_observed', { count: exposure })}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="analysis-table">
        <summary>{t('reports:analysis_occurrences')}</summary>
        <p>{t('reports:analysis_occurrencesHelp')}</p>
        <div
          className="table-scroll opening-exposure"
          role="region"
          tabIndex={0}
          aria-label={t('reports:analysis_occurrences')}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">{t('reports:analysis_weekday')}</th>
                {Array.from({ length: 24 }, (_, h) => (
                  <th scope="col" key={h}>
                    {String(h).padStart(2, '0')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day}>
                  <th scope="row">{weekday(day)}</th>
                  {Array.from({ length: 24 }, (_, hour) => (
                    <td key={hour}>{formatNumber(openingExposure(report, day, hour))}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
export function CollectionAnalysis({ report }: { report: OperationalReport }) {
  return (
    <>
      <h3>{t('reports:analysis_mix')}</h3>
      <p className="report-definition">{t('reports:analysis_mixHelp')}</p>
      <Chart report={report} kind="collections" />
    </>
  );
}
