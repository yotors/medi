import http from 'k6/http';
import { check, sleep } from 'k6';

if (!__ENV.BASE_URL) throw new Error('BASE_URL must identify an owned test deployment.');
// Harness defaults only; replace with an agreed workload and SLOs for capacity testing.
export const options = {
  vus: Number(__ENV.VUS || 1),
  duration: __ENV.DURATION || '10s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: [`p(95)<${Number(__ENV.P95_MS || 1000)}`],
    checks: ['rate==1'],
  },
};
export default function () {
  const response = http.get(__ENV.BASE_URL, { redirects: 0 });
  check(response, { 'returns 2xx': r => r.status >= 200 && r.status < 300 });
  sleep(1);
}
