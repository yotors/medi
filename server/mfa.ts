import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import type { Session } from '../shared/registration.ts';
import { ApiError } from './app.ts';
import {
  authenticationIdentity,
  currentActor,
  digest,
  randomToken,
  readSession,
  reserveReauthentication,
  SESSION_COOKIE,
  verifyPassword,
} from './auth.ts';
import { matchedCounter, newSecret, seal, unseal } from './mfa-config.ts';

import { boundedMfa } from './mfa-db.ts';

const denied = () =>
  new ApiError(
    403,
    'MFA_REQUIRED',
    'The authentication proof was not accepted. Check the code or ask your account manager for help.',
  );
const expired = () => new ApiError(401, 'UNAUTHENTICATED', 'Your session ended. Sign in again.');
const text = z.string().min(1).max(256);
const proof = z.strictObject({ code: text });
export async function securityEvent(
  client: pg.PoolClient,
  hospital: string,
  user: string,
  event: string,
  actor: string | null,
  operator: string | null = null,
  reason: string | null = null,
) {
  await client.query(
    'INSERT INTO identity_security_events(id,hospital_id,user_id,event,actor_id,operator_reference,reason) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [randomUUID(), hospital, user, event, actor, operator, reason],
  );
}
export async function invalidateEnrollment(client: pg.PoolClient, user: string) {
  await client.query('DELETE FROM staff_mfa_pending WHERE user_id=$1', [user]);
  await client.query('DELETE FROM staff_mfa_grants WHERE user_id=$1', [user]);
}
export async function issueGrant(
  client: pg.PoolClient,
  hospital: string,
  user: string,
  actor: string | null,
  operator: string | null,
  reason: string,
) {
  await invalidateEnrollment(client, user);
  await client.query('DELETE FROM staff_sessions WHERE user_id=$1', [user]);
  const grant = randomToken();
  const {
    rows: [issued],
  } = await client.query(
    "INSERT INTO staff_mfa_grants(hospital_id,user_id,grant_hash,expires_at) VALUES ($1,$2,$3,clock_timestamp()+interval '30 minutes') RETURNING expires_at",
    [hospital, user, digest(grant)],
  );
  await securityEvent(client, hospital, user, 'grant.issued', actor, operator, reason);
  return { grant, expiresAt: issued.expires_at.toISOString() };
}
async function consumeFactor(
  client: pg.PoolClient,
  session: Session,
  code: string,
  timestamp: number,
) {
  const {
    rows: [factor],
  } = await client.query(
    'SELECT * FROM staff_factors WHERE hospital_id=$1 AND user_id=$2 FOR UPDATE',
    [session.user.hospital.id, session.user.id],
  );
  if (!factor) throw denied();
  const counter = matchedCounter(
    unseal(factor.envelope, session.user.hospital.id, session.user.id, 'factor'),
    code,
    timestamp,
  );
  if (counter === null || counter <= Number(factor.last_counter)) throw denied();
  const result = await client.query(
    'UPDATE staff_factors SET last_counter=$3 WHERE hospital_id=$1 AND user_id=$2 AND last_counter<$3',
    [session.user.hospital.id, session.user.id, counter],
  );
  if (result.rowCount !== 1) throw denied();
}
async function replaceCodes(client: pg.PoolClient, session: Session) {
  const codes = Array.from({ length: 10 }, () => randomBytes(16).toString('hex'));
  await client.query('DELETE FROM staff_recovery_codes WHERE user_id=$1', [session.user.id]);
  for (const code of codes)
    await client.query(
      'INSERT INTO staff_recovery_codes(hospital_id,user_id,code_hash) VALUES ($1,$2,$3)',
      [session.user.hospital.id, session.user.id, digest(code)],
    );
  return codes;
}
async function pendingSetup(client: pg.PoolClient, session: Session, tokenHash: string) {
  const {
    rows: [row],
  } = await client.query(
    'SELECT p.*,LEAST(p.expires_at,s.expires_at,s.idle_expires_at,s.restricted_expires_at) AS effective_expires_at FROM staff_mfa_pending p JOIN staff_sessions s ON s.token_hash=p.session_hash WHERE p.hospital_id=$1 AND p.user_id=$2 AND p.session_hash=$3 AND LEAST(p.expires_at,s.expires_at,s.idle_expires_at,s.restricted_expires_at)>clock_timestamp()',
    [session.user.hospital.id, session.user.id, tokenHash],
  );
  return row
    ? {
        secret: unseal(row.envelope, session.user.hospital.id, session.user.id, 'pending'),
        setupExpiresAt: row.effective_expires_at.toISOString(),
      }
    : { secret: null, setupExpiresAt: null };
}
async function createPending(client: pg.PoolClient, session: Session, tokenHash: string) {
  const secret = newSecret();
  const {
    rows: [row],
  } = await client.query(
    "INSERT INTO staff_mfa_pending(hospital_id,user_id,session_hash,envelope,expires_at) SELECT $1,$2,$3,$4,LEAST(clock_timestamp()+interval '10 minutes',expires_at,idle_expires_at,restricted_expires_at) FROM staff_sessions WHERE token_hash=$3 RETURNING expires_at",
    [
      session.user.hospital.id,
      session.user.id,
      tokenHash,
      seal(secret, session.user.hospital.id, session.user.id, 'pending'),
    ],
  );
  return {
    secret,
    setupExpiresAt: new Date(
      Math.min(row.expires_at.getTime(), Date.parse(session.expiresAt)),
    ).toISOString(),
  };
}
export function registerMfaRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  sessions: WeakMap<FastifyRequest, Session>,
  secure: boolean,
) {
  const statusBuckets = new Map<string, { until: number; attempts: number }>();
  function statusBudget(session: Session) {
    const now = Date.now();
    for (const [key, value] of statusBuckets) if (value.until <= now) statusBuckets.delete(key);
    const key = session.user.id;
    let bucket = statusBuckets.get(key);
    if (!bucket) {
      if (statusBuckets.size >= 4096)
        throw new ApiError(
          429,
          'RATE_LIMITED',
          'Setup status is temporarily unavailable. Try again in a minute.',
        );
      bucket = { until: now + 60000, attempts: 0 };
      statusBuckets.set(key, bucket);
    }
    if (++bucket.attempts > 30)
      throw new ApiError(
        429,
        'RATE_LIMITED',
        'Setup status is temporarily unavailable. Try again in a minute.',
      );
  }
  async function transaction<T>(
    session: Session,
    fn: (client: pg.PoolClient, actor: Record<string, any>, timestamp: number) => Promise<T>,
  ) {
    return boundedMfa(pool, 'proof', async (client) => {
      await client.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [
        session.user.hospital.id,
      ]);
      const actor = await authenticationIdentity(client, session);
      if (!actor) throw expired();
      await client.query(
        'DELETE FROM staff_mfa_pending WHERE user_id=$1 AND expires_at<=clock_timestamp()',
        [session.user.id],
      );
      await client.query(
        'DELETE FROM staff_mfa_grants WHERE user_id=$1 AND expires_at<=clock_timestamp()',
        [session.user.id],
      );
      return fn(client, actor, Date.now());
    });
  }
  // Deliberately aggregate only fixed operation/outcome/hour keys. No request
  // fields or identity are copied into failure evidence. Retention is 24 hours.
  app.addHook('onError', async (request, _reply, error) => {
    const path = request.url.split('?')[0];
    const operation =
      path === '/api/staff/mfa/grant'
        ? 'grant'
        : (/^\/api\/auth\/mfa\/(verify|start|recover|confirm|regenerate|replace)$/.exec(
            path,
          )?.[1] ?? (path === '/api/auth/login' ? 'login' : 'request'));
    const status = error instanceof ApiError ? error.status : error.statusCode;
    const outcome =
      status === 429
        ? 'limited'
        : typeof status === 'number' && status >= 400 && status < 500
          ? 'denied'
          : 'unavailable';
    try {
      await boundedMfa(pool, 'evidence', async (client) => {
        await client.query(
          'DELETE FROM mfa_rejection_buckets WHERE bucket_hour<=floor(extract(epoch FROM clock_timestamp())/3600)::bigint-24',
        );
        await client.query(
          `INSERT INTO mfa_rejection_buckets(operation,outcome,slot,bucket_hour,attempts)
        SELECT $1,$2,(h%24)::smallint,h,1 FROM (SELECT floor(extract(epoch FROM clock_timestamp())/3600)::bigint h) t
        ON CONFLICT(operation,outcome,slot) DO UPDATE SET bucket_hour=EXCLUDED.bucket_hour,
        attempts=CASE WHEN mfa_rejection_buckets.bucket_hour=EXCLUDED.bucket_hour THEN LEAST(mfa_rejection_buckets.attempts+1,1000000) ELSE 1 END`,
          [operation, outcome],
        );
      });
    } catch {
      /* Rejected proof stays rejected if evidence storage is unavailable. */
    }
  });

  async function budget(request: FastifyRequest) {
    const refund = await reserveReauthentication(
      pool,
      sessions.get(request)!.user.id,
      request.ip,
      (fn) => boundedMfa(pool, 'proof', fn),
      'mfa',
    );
    if (!refund)
      throw new ApiError(
        429,
        'RATE_LIMITED',
        'Authentication is temporarily unavailable. Try again later.',
      );
    return async () => {
      try {
        await refund();
      } catch {
        /* Committed proof remains successful if refund storage is unavailable. */
      }
    };
  }
  async function passwordProof(request: FastifyRequest, password: string) {
    const session = sessions.get(request)!;
    const refund = await reserveReauthentication(pool, session.user.id, request.ip, (fn) =>
      boundedMfa(pool, 'proof', fn),
    );
    if (!refund)
      throw new ApiError(
        429,
        'RATE_LIMITED',
        'Authentication is temporarily unavailable. Try again later.',
      );
    const {
      rows: [row],
    } = await boundedMfa(pool, 'status', (client) =>
      client.query('SELECT password_hash FROM staff_users WHERE hospital_id=$1 AND id=$2', [
        session.user.hospital.id,
        session.user.id,
      ]),
    );
    if (!row || !(await verifyPassword(password, row.password_hash))) throw denied();
    await refund();
    return row.password_hash as string;
  }
  async function elevate(client: pg.PoolClient, session: Session, revoke: boolean) {
    const token = randomToken(),
      csrf = randomToken();
    const {
      rows: [old],
    } = await client.query(
      'SELECT expires_at,family_id FROM staff_sessions WHERE csrf_token=$1 AND user_id=$2',
      [session.csrfToken, session.user.id],
    );
    const {
      rows: [user],
    } = await client.query('SELECT factor_generation FROM staff_users WHERE id=$1', [
      session.user.id,
    ]);
    if (revoke)
      await client.query('DELETE FROM staff_sessions WHERE user_id=$1 AND family_id<>$2', [
        session.user.id,
        old.family_id,
      ]);
    await client.query(
      "UPDATE staff_sessions SET logout_only=true,factor_generation=$3,idle_expires_at=LEAST(idle_expires_at,expires_at,clock_timestamp()+interval '10 minutes'),restricted_expires_at=NULL WHERE user_id=$1 AND family_id=$2",
      [session.user.id, old.family_id, user.factor_generation],
    );
    await client.query(
      "INSERT INTO staff_sessions(token_hash,user_id,csrf_token,expires_at,auth_state,factor_generation,family_id) VALUES ($1,$2,$3,$4,'complete',$5,$6)",
      [digest(token), session.user.id, csrf, old.expires_at, user.factor_generation, old.family_id],
    );
    return {
      token,
      session: await readSession({ query: client.query.bind(client) } as pg.Pool, token),
    };
  }
  function parse<T>(schema: z.ZodType<T>, request: FastifyRequest): T {
    const result = schema.safeParse(request.body);
    if (!result.success || !z.strictObject({}).safeParse(request.query).success)
      throw new ApiError(400, 'INVALID_REQUEST', 'Check the authentication fields and try again.');
    return result.data;
  }
  const setCookie = (reply: any, token: string) =>
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/api',
      httpOnly: true,
      sameSite: 'strict',
      secure,
    });
  app.post('/api/auth/mfa/verify', async (request, reply) => {
    const { code } = parse(proof, request);
    const refund = await budget(request);
    const session = sessions.get(request)!;
    const elevated = await transaction(session, async (client, _actor, timestamp) => {
      if (session.authState !== 'challenge') throw denied();
      await consumeFactor(client, session, code, timestamp);
      await securityEvent(
        client,
        session.user.hospital.id,
        session.user.id,
        'factor.verified',
        session.user.id,
      );
      return elevate(client, session, false);
    });
    await refund();
    setCookie(reply, elevated.token);
    return { session: elevated.session };
  });
  app.get('/api/auth/mfa/status', async (request) => {
    if (!z.strictObject({}).safeParse(request.query).success)
      throw new ApiError(400, 'INVALID_REQUEST', 'Check the authentication request.');
    const session = sessions.get(request)!;
    statusBudget(session);
    return boundedMfa(pool, 'status', async (client) => {
      await client.query('SELECT id FROM hospitals WHERE id=$1 FOR SHARE', [
        session.user.hospital.id,
      ]);
      const actor = await authenticationIdentity(client, session);
      if (!actor) throw expired();
      return {
        ...(await pendingSetup(client, session, actor.token_hash)),
        sessionFamily: session.sessionFamily,
        userId: session.user.id,
      };
    });
  });
  app.post('/api/auth/mfa/start', async (request) => {
    const { grant } = parse(z.strictObject({ grant: text }), request);
    const refund = await budget(request);
    const session = sessions.get(request)!;
    const result = await transaction(session, async (client, actor) => {
      if (session.authState !== 'enrollment' || actor.password_change_required) throw denied();
      const existing = await pendingSetup(client, session, actor.token_hash);
      if (existing.secret) return existing;
      const consumed = await client.query(
        'DELETE FROM staff_mfa_grants WHERE hospital_id=$1 AND user_id=$2 AND grant_hash=$3 AND expires_at>clock_timestamp() RETURNING user_id',
        [session.user.hospital.id, session.user.id, digest(grant)],
      );
      if (consumed.rowCount !== 1) throw denied();
      return createPending(client, session, actor.token_hash);
    });
    await refund();
    return result;
  });
  app.post('/api/auth/mfa/recover', async (request, reply) => {
    const { code } = parse(proof, request);
    const refund = await budget(request);
    const session = sessions.get(request)!;
    await transaction(session, async (client, actor) => {
      if (session.authState !== 'challenge') throw denied();
      const consumed = await client.query(
        'DELETE FROM staff_recovery_codes WHERE hospital_id=$1 AND user_id=$2 AND code_hash=$3 RETURNING user_id',
        [session.user.hospital.id, session.user.id, digest(code)],
      );
      if (consumed.rowCount !== 1) throw denied();
      await invalidateEnrollment(client, session.user.id);
      await client.query('DELETE FROM staff_factors WHERE user_id=$1', [session.user.id]);
      await client.query(
        'UPDATE staff_users SET factor_generation=factor_generation+1 WHERE id=$1',
        [session.user.id],
      );
      await client.query('DELETE FROM staff_sessions WHERE user_id=$1 AND token_hash<>$2', [
        session.user.id,
        actor.token_hash,
      ]);
      await client.query(
        "UPDATE staff_sessions SET auth_state='recovery_enrollment',factor_generation=factor_generation+1 WHERE token_hash=$1",
        [actor.token_hash],
      );
      await createPending(client, session, actor.token_hash);
      await securityEvent(
        client,
        session.user.hospital.id,
        session.user.id,
        'factor.recovered',
        session.user.id,
      );
    });
    await refund();
    return reply.send({
      session: await boundedMfa(pool, 'status', (client) =>
        readSession(
          { query: client.query.bind(client) } as pg.Pool,
          request.cookies[SESSION_COOKIE],
        ),
      ),
    });
  });
  app.post('/api/auth/mfa/confirm', async (request, reply) => {
    const { code } = parse(proof, request);
    const refund = await budget(request);
    const session = sessions.get(request)!;
    const result = await transaction(session, async (client, actor, timestamp) => {
      if (!['enrollment', 'recovery_enrollment', 'complete'].includes(session.authState))
        throw denied();
      const { secret } = await pendingSetup(client, session, actor.token_hash);
      if (!secret) throw denied();
      const counter = matchedCounter(secret, code, timestamp);
      if (counter === null) throw denied();
      await client.query(
        'INSERT INTO staff_factors(hospital_id,user_id,envelope,last_counter) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id) DO UPDATE SET envelope=EXCLUDED.envelope,last_counter=EXCLUDED.last_counter',
        [
          session.user.hospital.id,
          session.user.id,
          seal(secret, session.user.hospital.id, session.user.id, 'factor'),
          counter,
        ],
      );
      await client.query(
        'UPDATE staff_users SET factor_generation=factor_generation+1 WHERE id=$1',
        [session.user.id],
      );
      const recoveryCodes = await replaceCodes(client, session);
      await invalidateEnrollment(client, session.user.id);
      await securityEvent(
        client,
        session.user.hospital.id,
        session.user.id,
        session.authState === 'complete' ? 'factor.replaced' : 'factor.enrolled',
        session.user.id,
      );
      return { ...(await elevate(client, session, true)), recoveryCodes };
    });
    await refund();
    setCookie(reply, result.token);
    return { session: result.session, recoveryCodes: result.recoveryCodes };
  });
  for (const operation of ['regenerate', 'replace'] as const)
    app.post(`/api/auth/mfa/${operation}`, async (request, reply) => {
      const { password, code } = parse(z.strictObject({ password: text, code: text }), request);
      const refund = await budget(request);
      const hash = await passwordProof(request, password);
      const session = sessions.get(request)!;
      const result = await transaction(session, async (client, actor, timestamp) => {
        if (
          session.authState !== 'complete' ||
          actor.password_change_required ||
          actor.password_hash !== hash
        )
          throw denied();
        await consumeFactor(client, session, code, timestamp);
        if (operation === 'replace') {
          await invalidateEnrollment(client, session.user.id);
          return createPending(client, session, actor.token_hash);
        }
        const recoveryCodes = await replaceCodes(client, session);
        await securityEvent(
          client,
          session.user.hospital.id,
          session.user.id,
          'codes.regenerated',
          session.user.id,
        );
        return { ...(await elevate(client, session, true)), recoveryCodes };
      });
      await refund();
      if ('token' in result && result.token) {
        setCookie(reply, result.token);
        return { recoveryCodes: result.recoveryCodes, session: result.session };
      }
      return result;
    });
  app.post('/api/staff/mfa/grant', async (request) => {
    const { accountId, password } = parse(
      z.strictObject({ accountId: z.uuid(), password: text }),
      request,
    );
    const session = sessions.get(request)!;
    const hash = await passwordProof(request, password);
    return transaction(session, async (client, actor) => {
      if (
        !(await currentActor(client, session)) ||
        actor.role !== 'admin' ||
        actor.password_change_required ||
        actor.password_hash !== hash
      )
        throw denied();
      const target = await client.query(
        'SELECT 1 FROM staff_users WHERE hospital_id=$1 AND id=$2 AND active AND factor_generation=0',
        [session.user.hospital.id, accountId],
      );
      const factor = await client.query(
        'SELECT 1 FROM staff_factors WHERE user_id=$1 UNION ALL SELECT 1 FROM staff_recovery_codes WHERE user_id=$1',
        [accountId],
      );
      if (!target.rowCount || factor.rowCount) throw denied();
      return issueGrant(
        client,
        session.user.hospital.id,
        accountId,
        session.user.id,
        null,
        'initial_enrollment',
      );
    });
  });
}
