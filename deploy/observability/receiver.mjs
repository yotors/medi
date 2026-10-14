import { createServer } from 'node:http';
// Synthetic receipt counts only. No incoming body or headers are persisted.
let ready = 0;
const probe = async () => {
  try {
    ready = (await fetch('http://api:3100/api/health', { signal: AbortSignal.timeout(2000) })).ok
      ? 1
      : 0;
  } catch {
    ready = 0;
  }
};
void probe();
setInterval(() => {
  void probe();
}, 5000).unref();
const counts = {
  MediApiUnavailable: { firing: 0, resolved: 0 },
  MediCollectorUnavailable: { firing: 0, resolved: 0 },
};
createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/metrics') {
    res.setHeader('content-type', 'text/plain; version=0.0.4');
    res.end('medi_api_ready ' + ready + '\n');
    return;
  }
  if (req.method === 'GET' && req.url === '/receipts') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(counts));
    return;
  }
  if (req.method !== 'POST' || req.url !== '/alerts') {
    res.writeHead(404).end();
    return;
  }
  let data = '';
  try {
    for await (const chunk of req) {
      data += chunk;
      if (data.length > 65536) throw Error();
    }
    const body = JSON.parse(data);
    for (const alert of body.alerts ?? []) {
      const name = alert.labels?.alertname,
        status = alert.status;
      if (Object.hasOwn(counts, name) && ['firing', 'resolved'].includes(status))
        counts[name][status] = Math.min(1000000, counts[name][status] + 1);
    }
    res.writeHead(204).end();
  } catch {
    res.writeHead(400).end();
  }
}).listen(9094, '0.0.0.0');
