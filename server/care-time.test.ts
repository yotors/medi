import assert from 'node:assert/strict';
import { test } from 'node:test';
import { careTimeInput, careTimePayload, displayCareTime } from '../shared/care-time.ts';
test('Addis clinical time controls ignore workstation timezone and preserve unchanged precision', () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
      process.env.TZ = zone;
      assert.equal(careTimeInput('2026-10-14T09:12:34.567Z'), '2026-10-14T12:12');
      assert.equal(careTimePayload('2026-10-14T12:12'), '2026-10-14T09:12:00.000Z');
      assert.equal(careTimePayload('2026-10-14T09:12:34.567Z'), '2026-10-14T09:12:34.567Z');
      assert.equal(
        careTimePayload('2026-10-14T12:12:34.567+03:00'),
        '2026-10-14T12:12:34.567+03:00',
      );
      assert.match(displayCareTime('2026-10-14T09:12:34Z'), /12:12:34/);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
