import { describe, expect, it } from 'vitest';
import { collectionShares, openingExposure } from './report-analysis';
describe('exact financial ratio bounds', () => {
  it('retains bounded shares even beyond Number limits', () => {
    expect(collectionShares('0', '0')).toEqual([0, 0]);
    expect(collectionShares('9'.repeat(400), '9'.repeat(400))).toEqual([50, 50]);
    expect(collectionShares('100', '300')).toEqual([25, 75]);
    expect(collectionShares('1', '0')).toEqual([100, 0]);
  });
});
describe('Addis weekday/hour exposure', () => {
  const report = {
    range: {
      from: '2026-10-14',
      to: '2026-10-16',
      timezone: 'Africa/Addis_Ababa' as const,
      start: '2026-10-13T21:00:00Z',
      endExclusive: '2026-10-16T21:00:00Z',
    },
    generatedAt: '2026-10-15T09:30:00Z',
  };
  it('distinguishes a future hour from a measured zero, including Addis midnight', () => {
    expect(openingExposure(report, 3, 0)).toBe(1);
    expect(openingExposure(report, 4, 12)).toBe(1);
    expect(openingExposure(report, 4, 13)).toBe(0);
    expect(openingExposure(report, 5, 0)).toBe(0);
    expect(openingExposure(report, 1, 12)).toBe(0);
  });
});

it('does not manufacture a visible minimum for an asymmetric positive amount', () => {
  expect(collectionShares('1', '100000000000000000000')).toEqual([0, 99.9999]);
  expect(collectionShares('100000000000000000000', '1')).toEqual([99.9999, 0]);
});
it('uses historical Addis offsets at a partially observed local hour', () => {
  const report = {
    range: {
      from: '1900-01-02',
      to: '1900-01-02',
      timezone: 'Africa/Addis_Ababa' as const,
      start: '1900-01-01T21:32:44Z',
      endExclusive: '1900-01-02T21:32:44Z',
    },
    generatedAt: '1900-01-01T22:50:00Z',
  };
  // IANA local time is Tuesday 01:17:16, not modern UTC+03's01:50.
  expect(openingExposure(report, 2, 0)).toBe(1);
  expect(openingExposure(report, 2, 1)).toBe(1);
  expect(openingExposure(report, 2, 2)).toBe(0);
});

it('counts the historical1928 forward offset transition before the old UTC-step would', () => {
  const report = {
    range: {
      from: '1928-06-30',
      to: '1928-07-01',
      timezone: 'Africa/Addis_Ababa' as const,
      start: '1928-06-29T21:30:00Z',
      endExclusive: '1928-07-01T21:00:00Z',
    },
    generatedAt: '1928-06-30T22:05:00Z',
  };
  expect(openingExposure(report, 7, 0)).toBe(1);
  expect(openingExposure(report, 7, 1)).toBe(1);
  expect(openingExposure(report, 7, 2)).toBe(0);
});
