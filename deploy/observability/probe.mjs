import { createServer } from 'node:http';
let ready = 0;
async function probe() {
  try {
    ready = (await fetch('http://api:3100/api/health', { signal: AbortSignal.timeout(2000) })).ok
      ? 1
      : 0;
  } catch {
    ready = 0;
  }
}
void probe();
setInterval(() => void probe(), 5000).unref();
createServer((req, res) => {
  if (req.method !== 'GET' || req.url !== '/metrics') {
    res.writeHead(404).end();
    return;
  }
  res.setHeader('content-type', 'text/plain; version=0.0.4');
  res.end('medi_api_ready ' + ready + '\n');
}).listen(9094, '0.0.0.0');
