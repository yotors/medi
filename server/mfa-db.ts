import type pg from 'pg';
import { ApiError } from './app.ts';
export const mfaUnavailable = () =>
  new ApiError(503, 'AUTH_UNAVAILABLE', 'Authentication is temporarily unavailable. Try again.');
// These budgets are independent of proof-attempt limits. Destroying a timed-out
// connection aborts unfinished work; the callback cannot issue subsequent SQL.
// A lost COMMIT acknowledgement is an uncertain result, handled by the MFA UI.
export async function boundedMfa<T>(
  pool: pg.Pool,
  mode: 'proof' | 'status' | 'evidence',
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const total = mode === 'proof' ? 3000 : mode === 'status' ? 750 : 500;
  const deadline = performance.now() + total;
  let abandoned = false,
    released = false,
    timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const connection = pool.connect().then((client) => {
    if (abandoned) {
      client.release();
      throw mfaUnavailable();
    }
    return client;
  });
  let client: pg.PoolClient;
  try {
    client = await Promise.race([
      connection,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => {
            abandoned = true;
            reject(mfaUnavailable());
          },
          Math.min(total, 500),
        );
      }),
    ]);
  } catch {
    throw mfaUnavailable();
  } finally {
    clearTimeout(timer);
  }
  const query = client.query.bind(client);
  const guarded = Object.create(client) as pg.PoolClient;
  guarded.query = ((...args: any[]) => {
    if (timedOut || performance.now() >= deadline) return Promise.reject(mfaUnavailable());
    return (query as any)(...args);
  }) as typeof client.query;
  const work = (async () => {
    try {
      // PostgreSQL row SHARE locks require an ordinary transaction; status runs only SELECTs.
      await guarded.query('BEGIN');
      await guarded.query(`SET LOCAL statement_timeout='${mode === 'proof' ? 900 : 200}ms'`);
      await guarded.query(`SET LOCAL lock_timeout='${mode === 'proof' ? 500 : 100}ms'`);
      const result = await fn(guarded);
      await guarded.query('COMMIT');
      return result;
    } catch (error) {
      if (!timedOut) {
        try {
          await query('ROLLBACK');
        } catch {
          if (!released) {
            released = true;
            client.release(true);
          }
        }
      }
      if (!(error instanceof ApiError)) throw mfaUnavailable();
      throw error;
    } finally {
      if (!released) {
        released = true;
        client.release();
      }
    }
  })();
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => {
            timedOut = true;
            if (!released) {
              released = true;
              client.release(true);
            }
            reject(mfaUnavailable());
          },
          Math.max(1, deadline - performance.now()),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
