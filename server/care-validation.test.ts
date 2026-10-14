import assert from 'node:assert/strict';
import { test } from 'node:test';
import { careSchemas } from '../shared/care.ts';
test('triage accepts representable entered observations without clinical thresholds and rejects malformed or overflow values', () => {
  const base = {
    urgency: 'routine',
    symptoms: 'Entered observations',
    eventAt: '2026-10-14T09:00:00Z',
  };
  assert.equal(
    careSchemas.triage.safeParse({
      ...base,
      temperatureC: 50,
      pulsePerMinute: 1000,
      systolicMmHg: 5,
      diastolicMmHg: 500,
      respiratoryPerMinute: 300,
      weightKg: 1000,
      oxygenPercent: 100,
    }).success,
    true,
  );
  assert.equal(
    careSchemas.triage.safeParse({ ...base, temperatureC: -100, systolicMmHg: 400, weightKg: 0 })
      .success,
    true,
  );
  for (const invalid of [
    { temperatureC: '37' },
    { temperatureC: NaN },
    { temperatureC: Infinity },
    { temperatureC: Number.MAX_SAFE_INTEGER * 2 },
    { pulsePerMinute: -1 },
    { pulsePerMinute: 0.5 },
    { weightKg: -1 },
    { oxygenPercent: 101 },
    { oxygenPercent: -1 },
    { oxygenPercent: NaN },
  ])
    assert.equal(
      careSchemas.triage.safeParse({ ...base, ...invalid }).success,
      false,
      JSON.stringify(invalid),
    );
});
