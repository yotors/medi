import { buildApp } from './app.ts';
import { createTelemetry } from './observability.ts';
import { createPool } from './db.ts';

let pool: ReturnType<typeof createPool> | undefined;
let telemetry: ReturnType<typeof createTelemetry> | undefined;
try {
  pool = createPool();
  telemetry = createTelemetry({pool,enabled:process.env.MEDI_TELEMETRY === 'private'});
  const host = process.env.HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '0.0.0.0'].includes(host)) throw new Error('Invalid bind host.');
  const proxyHops = process.env.TRUST_PROXY_HOPS ?? '0';
  if (!['0', '1'].includes(proxyHops)) throw new Error('Invalid trusted proxy configuration.');
  const app = buildApp({ pool, telemetry, origin: process.env.APP_ORIGIN ?? 'http://127.0.0.1:5173', trustProxy: proxyHops === '1' ? 1 : false });
  const port = Number(process.env.PORT ?? 3100);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port.');
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => { process.stderr.write('API shutdown deadline exceeded.\n'); process.exit(1); }, 20000);
    deadline.unref();
    try { try { await app.close(); } finally { await telemetry?.shutdown(); await pool?.end(); } }
    catch { process.stderr.write('API shutdown could not complete cleanly.\n'); process.exitCode = 1; }
    finally { clearTimeout(deadline); }
  };
  const fatal=()=>{ process.stderr.write('{"event":"terminal_failure"}\n'); process.exitCode=1; void close(); };
  process.once('uncaughtException',fatal);
  process.once('unhandledRejection',fatal);
  process.once('SIGINT', () => { void close(); });
  process.once('SIGTERM', () => { void close(); });
  await app.listen({ host, port });
  process.stdout.write(`Staff API listening on ${host}:${port}.\n`);
} catch {
  await telemetry?.shutdown(); await pool?.end();
  process.stderr.write('Staff API could not start. Check the local configuration and database.\n');
  process.exitCode = 1;
}
