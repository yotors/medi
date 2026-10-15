import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import type { OperationalReport } from '../../shared/reports';
import { t, formatNumber, formatMinorCurrency, formatDate } from '../i18n';
import { collectionShares, reportCapturedDate } from './report-analysis';

export default function ReportVisuals({
  report,
  kind,
}: {
  report: OperationalReport;
  kind: 'visits' | 'collections';
}) {
  if (kind === 'visits') {
    if (!report.operations?.activity) return <p>{t('reports:analysis_unavailable')}</p>;
    const cutoff = reportCapturedDate(report);
    const data = report.operations.activity.daily.map((day) => ({
      ...day,
      opened: day.date > cutoff ? null : day.opened,
      closed: day.date > cutoff ? null : day.closed,
    }));
    return (
      <div className="report-chart" role="group" aria-label={t('reports:analysis_trend')}>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart
            data={data}
            margin={{ top: 12, right: 18, bottom: 8, left: 0 }}
            accessibilityLayer
          >
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 5" />
            <XAxis
              dataKey="date"
              tick={{ fill: 'var(--muted)', fontSize: 11 }}
              minTickGap={35}
              tickFormatter={(v) =>
                formatDate(new Date(`${v}T12:00:00Z`), {
                  calendar: 'gregory',
                  timeZone: 'UTC',
                  month: 'short',
                  day: 'numeric',
                })
              }
            />
            <YAxis
              domain={[0, 'auto']}
              allowDecimals={false}
              tick={{ fill: 'var(--muted)', fontSize: 11 }}
              width={44}
              tickFormatter={(v) => formatNumber(v)}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--surface)',
                color: 'var(--ink)',
                borderColor: 'var(--border)',
              }}
              labelFormatter={(label) =>
                formatDate(new Date(`${label}T12:00:00Z`), {
                  calendar: 'gregory',
                  timeZone: 'UTC',
                  dateStyle: 'full',
                })
              }
              formatter={(v) => formatNumber(Number(v))}
            />
            <Line
              dataKey="opened"
              name={t('reports:visits_opened')}
              type="linear"
              stroke="var(--accent)"
              strokeWidth={2.5}
              dot={data.length < 32}
              isAnimationActive={false}
              connectNulls={false}
            />
            <Line
              dataKey="closed"
              name={t('reports:visits_closed')}
              type="linear"
              stroke="var(--muted)"
              strokeDasharray="6 4"
              strokeWidth={2}
              dot={data.length < 32}
              isAnimationActive={false}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }
  const finance = report.finance;
  if (!finance) return null;
  const methods = finance.period.byMethod;
  const [cash, transfer] = collectionShares(
    methods.cash.collectedMinor,
    methods.manual_transfer.collectedMinor,
  );
  if (cash + transfer === 0) return <p className="empty">{t('reports:analysis_noCollections')}</p>;
  const data = [
    { name: t('common:cash'), value: cash, exact: methods.cash.collectedMinor },
    {
      name: t('common:manual_transfer'),
      value: transfer,
      exact: methods.manual_transfer.collectedMinor,
    },
  ];
  return (
    <>
      <p className="report-definition">{t('reports:analysis_precision')}</p>
      <div className="report-composition">
        <div className="report-donut" role="img" aria-label={t('reports:analysis_mix')}>
          <ResponsiveContainer width="100%" height={230}>
            <PieChart accessibilityLayer>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius="61%"
                outerRadius="85%"
                isAnimationActive={false}
                stroke="var(--surface)"
                strokeWidth={3}
              >
                <Cell fill="var(--accent)" />
                <Cell fill="var(--muted)" />
              </Pie>
              <Tooltip
                contentStyle={{ background: 'var(--surface)', color: 'var(--ink)' }}
                formatter={(_value, _name, item) => formatMinorCurrency(item.payload.exact)}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <dl className="report-mix-labels">
          {data.map((item, index) => (
            <div key={item.name}>
              <dt>
                <span className={`chart-key key-${index}`} />
                {item.name}
              </dt>
              <dd>{formatMinorCurrency(item.exact)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </>
  );
}
