import { performance } from 'node:perf_hooks';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { ApiError } from './app.ts';

// Internal policy: one budget includes pool wait, all SQL and the audit commit.
export async function withReportBudget<T>(
  pool: pg.Pool,
  request: FastifyRequest,
  reply: FastifyReply,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const deadline = performance.now() + 10_000;
  const busy = () =>
    new ApiError(
      503,
      'REPORT_BUSY',
      'Reports are temporarily busy. Retry when the hospital workspace is available.',
    );
  let stopped = false;
  let raw: pg.PoolClient | undefined;
  let released = false;
  let rejectDeadline!: (error: Error) => void;
  const expiration = new Promise<never>((_, reject) => {
    rejectDeadline = reject;
  });
  const stop = () => {
    if (stopped) return;
    stopped = true;
    // Destroying a timed-out connection also rolls back its open transaction;
    // it must never return to the pool with live work or held hospital locks.
    if (raw && !released) {
      released = true;
      raw.release(true);
    }
    rejectDeadline(busy());
  };
  const remaining = () => {
    if (stopped || performance.now() >= deadline) {
      stop();
      throw busy();
    }
    return Math.max(1, Math.floor(deadline - performance.now()));
  };
  const onClose = () => {
    if (!reply.raw.writableEnded) stop();
  };
  const timer = setTimeout(stop, 10_000);
  request.raw.once('aborted', stop);
  reply.raw.once('close', onClose);
  if (request.raw.aborted || reply.raw.destroyed) stop();
  const run = async () => {
    remaining();
    const acquired = await pool.connect();
    if (stopped) {
      acquired.release();
      throw busy();
    }
    raw = acquired;
    const client = new Proxy(acquired, {
      get(target, key) {
        if (key === 'query')
          return async (sql: string, values?: unknown[]) => {
            remaining();
            // BEGIN has no lock-bearing application work. The wall timer bounds
            // it and SET LOCAL itself; every subsequent SQL gets time left only.
            if (sql !== 'BEGIN') {
              await target.query(`SET LOCAL statement_timeout='${remaining()}ms'`);
              remaining();
            }
            return target.query(sql, values);
          };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    try {
      return await work(client);
    } catch (error) {
      if (!released) await acquired.query('ROLLBACK');
      throw error;
    }
  };
  try {
    return await Promise.race([run(), expiration]);
  } finally {
    clearTimeout(timer);
    request.raw.off('aborted', stop);
    reply.raw.off('close', onClose);
    if (raw && !released) {
      released = true;
      raw.release();
    }
  }
}
