import type { OperationalReport } from '../../shared/reports';
type ClockReport = Pick<OperationalReport, 'range' | 'generatedAt'>;

/** Only bounded, independently truncated ratios become numbers; amounts stay exact. */
export function collectionShares(cash: string, transfer: string): [number, number] {
  const a = BigInt(cash),
    b = BigInt(transfer),
    total = a + b;
  if (total <= 0n) return [0, 0];
  return [a, b].map((value) => Number((value * 1_000_000n) / total) / 10_000) as [number, number];
}
export function reportCapturedDate(report: ClockReport): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: report.range.timezone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(report.generatedAt));
  const get = (key: string) => parts.find((part) => part.type === key)!.value;
  return `${get('year').padStart(4, '0')}-${get('month')}-${get('day')}`;
}
const exposures = new WeakMap<ClockReport, number[][]>();
/** Resolve selected local hours against IANA offsets, including historical minute/
 * second offsets and transition hours. At most 366 days × 24 hours; cached per report. */
export function openingExposure(report: ClockReport, weekday: number, hour: number): number {
  let grid = exposures.get(report);
  if (!grid) {
    grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: report.range.timezone,
      calendar: 'iso8601',
      numberingSystem: 'latn',
      era: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const civil = (instant: number) => {
      const parts = formatter.formatToParts(new Date(instant));
      const get = (key: string) => parts.find((part) => part.type === key)!.value;
      const year = Number(get('year'));
      const value = new Date(0);
      value.setUTCFullYear(
        parts.find((part) => part.type === 'era')?.value === 'BC' ? 1 - year : year,
        Number(get('month')) - 1,
        Number(get('day')),
      );
      value.setUTCHours(Number(get('hour')), Number(get('minute')), Number(get('second')), 0);
      return value.getTime();
    };
    const start = Date.parse(report.range.start),
      end = Date.parse(report.range.endExclusive),
      captured = Date.parse(report.generatedAt);
    const from = Date.parse(`${report.range.from}T00:00:00Z`),
      to = Date.parse(`${report.range.to}T00:00:00Z`);
    for (let day = from, index = 0; day <= to && index < 366; day += 86_400_000, index++) {
      // Neighboring offsets cover both sides of historical Addis transitions.
      const offsets = [
        ...new Set(
          [-1, 0, 1].map((delta) => {
            const sample = day + 43_200_000 + delta * 86_400_000;
            return civil(sample) - sample;
          }),
        ),
      ];
      for (let h = 0; h < 24; h++) {
        const target = day + h * 3_600_000;
        const observed = offsets.some((offset) => {
          const instant = target - offset;
          if (instant < start || instant >= end || instant > captured) return false;
          const local = civil(instant);
          return local >= target && local < target + 3_600_000;
        });
        if (observed) grid[(new Date(day).getUTCDay() || 7) - 1][h]++;
      }
    }
    exposures.set(report, grid);
  }
  return grid[weekday - 1]?.[hour] ?? 0;
}
