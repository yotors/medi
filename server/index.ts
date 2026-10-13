import { buildApp } from './app.ts';
import { createPool } from './db.ts';

const pool = createPool();
try {
  const app = buildApp({ pool, origin: process.env.APP_ORIGIN ?? 'http://127.0.0.1:5173' });
  const port = Number(process.env.PORT ?? 3100);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port.');
  const close = async () => { await app.close(); await pool.end(); };
  process.once('SIGINT', () => { void close(); });
  process.once('SIGTERM', () => { void close(); });
  await app.listen({ host: '127.0.0.1', port });
  process.stdout.write(`Staff API listening on loopback port ${port}.\n`);
} catch {
  await pool.end();
  process.stderr.write('Staff API could not start. Check the local configuration and database.\n');
  process.exitCode = 1;
}
