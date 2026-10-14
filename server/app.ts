import { compatibleSchema, schemaReady } from './schema.ts';
import { boundedMfa } from './mfa-db.ts';
import { registerMfaRoutes, securityEvent } from './mfa.ts';
import { instrument, type Telemetry } from './observability.ts';
import { syntheticPolicy, keyring, validateEnvelopes, readiness } from './mfa-config.ts';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import type pg from 'pg';
import { z } from 'zod';
import {
  loginSchema,
  registrationSchema,
  type RegisteredPatient,
  type Session,
} from '../shared/registration.ts';
import {
  allowLogin,
  currentActor,
  digest,
  DUMMY_PASSWORD_HASH,
  randomToken,
  readSession,
  safeEqual,
  SESSION_COOKIE,
  SESSION_SECONDS,
  verifyPassword,
} from './auth.ts';
import { registerAdministrationRoutes } from './administration.ts';
import { registerOutpatientRoutes } from './outpatient.ts';
import { registerClinicalRoutes } from './clinical.ts';
import { registerReportRoutes } from './reports.ts';
import { registerInventoryRoutes } from './inventory.ts';
import { registerBillingRoutes } from './billing.ts';
import { registerCareRoutes } from './care.ts';
import { registerDepartmentRoutes } from './departments.ts';
import { registerHospitalRoutes } from './hospital.ts';
import { registerConfigurationRoutes } from './configuration.ts';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const readUnavailable = () =>
  new ApiError(
    503,
    'READ_UNAVAILABLE',
    'The workspace is temporarily unavailable. Retry the exact same request.',
  );
const uuid = z.uuid();
const directoryQuery = z.strictObject({
  q: z
    .string()
    .max(100)
    .refine((value) => !value.includes('\u0000'))
    .default(''),
  page: z.number().int().min(1).max(10000).default(1),
});
const emptyQuery = z.strictObject({});
const normalizeName = (value: string) =>
  value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const literalPattern = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;
const patient = (row: Record<string, unknown>): RegisteredPatient => ({
  id: row.id as string,
  recordNumber: row.record_number as string,
  name: row.name as string,
  ...(row.age === null ? {} : { age: row.age as number }),
  contact: row.contact as string,
  createdAt: (row.created_at as Date).toISOString(),
  ...(row.canonical_id
    ? {
        canonicalId: row.canonical_id as string,
        canonicalRecordNumber: row.canonical_record_number as string,
      }
    : {}),
});
const invalid = () =>
  new ApiError(400, 'INVALID_REQUEST', 'Check the request fields and try again.');

export function buildApp({
  pool,
  origin,
  trustProxy = false,
  telemetry,
  secureCookies = process.env.NODE_ENV === 'production',
}: {
  pool: pg.Pool;
  origin: string;
  telemetry?: Telemetry;
  trustProxy?: false | 1;
  secureCookies?: boolean;
}) {
  const originUrl = new URL(origin);
  if (originUrl.origin !== origin || !['http:', 'https:'].includes(originUrl.protocol))
    throw new Error('APP_ORIGIN must be an exact HTTP origin.');
  if (process.env.NODE_ENV === 'production' && (!secureCookies || originUrl.protocol !== 'https:'))
    throw new Error('Production requires HTTPS and Secure cookies.');
  const synthetic = syntheticPolicy();
  if (!synthetic || process.env.NODE_ENV === 'production') keyring();
  // Request logging is deliberately disabled: URLs can contain patient search terms.
  const app = Fastify({
    logger: false,
    bodyLimit: 4096,
    trustProxy: trustProxy === 1 ? (_address: string, hop: number) => hop < 1 : false,
  });
  if (telemetry) instrument(app, telemetry);
  app.register(cookie);
  app.addHook('onReady', async () => {
    await schemaReady(pool);
    await validateEnvelopes(pool);
  });
  const sessions = new WeakMap<FastifyRequest, Session>();
  const cookieOptions = {
    path: '/api',
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: secureCookies,
  };

  app.addHook('onRequest', async (request, reply) => {
    await compatibleSchema(pool).catch(() => {
      throw readUnavailable();
    });
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.origin !== origin) {
      throw new ApiError(403, 'FORBIDDEN', 'This request is not allowed.');
    }
    const path = request.url.split('?')[0];
    if (path === '/api/auth/login' || (path === '/api/health' && request.method === 'GET')) return;
    const isPrivateRead =
      (request.method === 'POST' &&
        ['/api/patients/search', '/api/visits/search'].includes(path)) ||
      (['GET', 'HEAD'].includes(request.method) &&
        /^\/api\/(patients|visits)(\/[^/]+)?$/.test(path));
    const isMfa = path.startsWith('/api/auth/mfa/') || path === '/api/staff/mfa/grant';
    const session = await (
      isMfa
        ? boundedMfa(pool, 'status', (client) =>
            readSession(
              { query: client.query.bind(client) } as pg.Pool,
              request.cookies[SESSION_COOKIE],
            ),
          )
        : readSession(
            pool,
            request.cookies[SESSION_COOKIE],
            path === '/api/auth/logout' && request.method === 'POST',
          )
    ).catch((error) => {
      if (isPrivateRead && !(error instanceof ApiError)) throw readUnavailable();
      throw error;
    });
    if (!session) {
      // A delayed rejection may carry a predecessor cookie; never clear a newer login.
      throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    }
    sessions.set(request, session);
    const common = ['/api/auth/session', '/api/auth/logout'];
    const allowed =
      session.authState === 'challenge'
        ? ['/api/auth/mfa/verify', '/api/auth/mfa/recover']
        : session.authState === 'enrollment'
          ? [
              '/api/auth/mfa/start',
              '/api/auth/mfa/status',
              '/api/auth/mfa/confirm',
              ...(session.passwordChangeRequired ? ['/api/auth/password'] : []),
            ]
          : ['/api/auth/mfa/status', '/api/auth/mfa/confirm'];
    if (session.authState !== 'complete' && !common.includes(path) && !allowed.includes(path))
      throw new ApiError(
        403,
        'MFA_REQUIRED',
        'Complete authenticator sign-in before opening the workspace.',
      );
    if (
      session.authState === 'complete' &&
      session.passwordChangeRequired &&
      !['/api/auth/session', '/api/auth/logout', '/api/auth/password'].includes(path)
    )
      throw new ApiError(
        403,
        'PASSWORD_CHANGE_REQUIRED',
        'Change your temporary password before opening the workspace.',
      );
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const csrf = request.headers['x-csrf-token'];
      if (typeof csrf !== 'string' || !safeEqual(csrf, session.csrfToken))
        throw new ApiError(403, 'FORBIDDEN', 'This request is not allowed.');
    }
  });
  app.addHook('onSend', async (request, reply, payload) => {
    const session = sessions.get(request);
    if (
      session?.authState === 'complete' &&
      reply.statusCode < 400 &&
      !request.url.startsWith('/api/auth/') &&
      request.url.split('?')[0] !== '/api/staff/mfa/grant'
    ) {
      const {
        rows: [row],
      } = await pool.query(
        `UPDATE staff_sessions s SET idle_expires_at=LEAST(s.expires_at,clock_timestamp()+interval '30 minutes') FROM staff_users u WHERE s.user_id=u.id AND s.csrf_token=$1 AND u.id=$2 AND u.hospital_id=$3 AND u.role=$4 AND u.active AND s.factor_generation=$5 AND s.factor_generation=u.factor_generation AND NOT s.logout_only AND s.auth_state='complete' AND s.expires_at>clock_timestamp() AND s.idle_expires_at>clock_timestamp() RETURNING LEAST(s.expires_at,s.idle_expires_at) AS expiry`,
        [
          session.csrfToken,
          session.user.id,
          session.user.hospital.id,
          session.user.role,
          session.factorGeneration,
        ],
      );
      if (row) reply.header('X-Session-Expires-At', row.expiry.toISOString());
    }
    return payload;
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError)
      return reply.code(error.status).send({ code: error.code, message: error.message });
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 500)
      return reply
        .code(statusCode)
        .send({ code: 'INVALID_REQUEST', message: 'Check the request fields and try again.' });
    return reply
      .code(500)
      .send({ code: 'SERVER_ERROR', message: 'The request could not be completed. Try again.' });
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ code: 'NOT_FOUND', message: 'The requested resource was not found.' }),
  );

  app.get('/api/health', async () => {
    await readiness(pool);
    return { status: 'ok' };
  });

  app.post('/api/auth/login', async (request, reply) => {
    if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json')
      throw invalid();
    if (!emptyQuery.safeParse(request.query).success) throw invalid();
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) throw invalid();
    const { hospitalCode, username, password } = parsed.data;
    if (!(await allowLogin(pool, `${hospitalCode}:${username}`, request.ip))) {
      reply.header('Retry-After', '900');
      throw new ApiError(
        429,
        'RATE_LIMITED',
        'Sign-in is temporarily unavailable. Try again later.',
      );
    }
    const {
      rows: [user],
    } = await pool.query(
      `SELECT u.id, u.hospital_id, u.password_hash, u.active FROM staff_users u
      JOIN hospitals h ON h.id=u.hospital_id WHERE h.code=$1 AND u.username=$2`,
      [hospitalCode, username],
    );
    const valid = await verifyPassword(password, user?.password_hash ?? DUMMY_PASSWORD_HASH);
    if (!valid || !user?.active)
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'The sign-in details were not accepted.');
    const token = randomToken();
    const csrfToken = randomToken();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [user.hospital_id]);
      const {
        rows: [latest],
      } = await client.query(
        'SELECT password_hash,active,factor_generation,support_account FROM staff_users WHERE id=$1',
        [user.id],
      );
      if (!latest?.active || latest.password_hash !== user.password_hash)
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'The sign-in details were not accepted.');
      await client.query('DELETE FROM staff_sessions WHERE user_id=$1 AND expires_at <= now()', [
        user.id,
      ]);
      const oldToken = request.cookies[SESSION_COOKIE];
      if (oldToken)
        await client.query('DELETE FROM staff_sessions WHERE token_hash=$1 AND user_id=$2', [
          digest(oldToken),
          user.id,
        ]);
      const enrolled = await client.query(
        'SELECT 1 FROM staff_factors WHERE user_id=$1 UNION ALL SELECT 1 FROM staff_recovery_codes WHERE user_id=$1',
        [user.id],
      );
      const state = enrolled.rowCount
        ? 'challenge'
        : synthetic && !latest.support_account && Number(latest.factor_generation) === 0
          ? 'complete'
          : 'enrollment';
      await client.query(
        `INSERT INTO staff_sessions(token_hash,user_id,csrf_token,expires_at,auth_state,factor_generation,restricted_expires_at)
        VALUES ($1,$2,$3,clock_timestamp() + $4 * interval '1 second',$5,$6,CASE WHEN $5='complete' THEN NULL ELSE clock_timestamp()+interval '10 minutes' END)`,
        [digest(token), user.id, csrfToken, SESSION_SECONDS, state, latest.factor_generation],
      );
      await securityEvent(
        client,
        user.hospital_id,
        user.id,
        state === 'complete' ? 'authentication.completed' : 'password.accepted',
        user.id,
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: SESSION_SECONDS });
    return await readSession(pool, token);
  });

  app.get('/api/auth/session', async (request) => {
    if (!emptyQuery.safeParse(request.query).success) throw invalid();
    return sessions.get(request)!;
  });
  app.post('/api/auth/logout', async (request, reply) => {
    if (
      !emptyQuery.safeParse(request.query).success ||
      (request.body !== undefined && !emptyQuery.safeParse(request.body).success)
    )
      throw invalid();
    const session = sessions.get(request)!;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [
        session.user.hospital.id,
      ]);
      // A concurrent elevation preserves this family, so even a late Set-Cookie is revoked.
      await client.query('DELETE FROM staff_sessions WHERE user_id=$1 AND family_id=$2', [
        session.user.id,
        session.sessionFamily,
      ]);
      await securityEvent(
        client,
        session.user.hospital.id,
        session.user.id,
        'session.logout',
        session.user.id,
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    reply.clearCookie(SESSION_COOKIE, cookieOptions);
    return reply.code(204).send();
  });
  async function patientRead<T>(
    session: Session,
    read: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect().catch(() => {
      throw readUnavailable();
    });
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SET LOCAL statement_timeout='10s'");
      await client.query('SELECT id FROM hospitals WHERE id=$1 FOR SHARE', [
        session.user.hospital.id,
      ]);
      const actor = await currentActor(client, session);
      if (!actor || actor.password_change_required)
        throw new ApiError(401, 'UNAUTHENTICATED', 'Your session ended. Sign in again.');
      const result = await read(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (['55P03', '57014', '40001', '40P01'].includes((error as { code?: string }).code ?? ''))
        throw new ApiError(
          503,
          'PATIENTS_BUSY',
          'The workspace is temporarily busy. Retry the exact same request.',
        );
      throw error;
    } finally {
      client.release();
    }
  }
  const searchPatients = async (request: FastifyRequest) => {
    const isPost = request.method === 'POST';
    if (
      isPost &&
      (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json' ||
        !emptyQuery.safeParse(request.query).success)
    )
      throw invalid();
    const parsed = (
      isPost
        ? directoryQuery
        : directoryQuery
            .omit({ q: true })
            .extend({ page: z.coerce.number().int().min(1).max(10000).default(1) })
    ).safeParse(isPost ? request.body : request.query);
    if (!parsed.success) throw invalid();
    const { page } = parsed.data;
    const q = 'q' in parsed.data && typeof parsed.data.q === 'string' ? parsed.data.q : '';
    const hospitalId = sessions.get(request)!.user.hospital.id;
    // Escape LIKE syntax so searches are literal substrings.
    const pattern = literalPattern(q);
    const normalizedPattern = literalPattern(normalizeName(q));
    const predicate =
      'hospital_id=$1 AND (name ILIKE $2 OR record_number ILIKE $2 OR contact ILIKE $2 OR normalized_name LIKE $3)';
    return patientRead(sessions.get(request)!, async (client) => {
      const {
        rows: [count],
      } = await client.query(
        `SELECT count(*)::integer AS total FROM patient_directory WHERE ${predicate}`,
        [hospitalId, pattern, normalizedPattern],
      );
      const { rows } = await client.query(
        `SELECT * FROM patient_directory WHERE ${predicate} ORDER BY created_at DESC, id DESC LIMIT 25 OFFSET $4`,
        [hospitalId, pattern, normalizedPattern, (page - 1) * 25],
      );
      return { patients: rows.map(patient), total: count.total, page, pageSize: 25 };
    });
  };
  app.get('/api/patients', searchPatients);
  app.post('/api/patients/search', searchPatients);
  app.get<{ Params: { id: string } }>('/api/patients/:id', async (request) => {
    if (!emptyQuery.safeParse(request.query).success) throw invalid();
    if (!uuid.safeParse(request.params.id).success)
      throw new ApiError(404, 'NOT_FOUND', 'The patient was not found.');
    return patientRead(sessions.get(request)!, async (client) => {
      const {
        rows: [row],
      } = await client.query('SELECT * FROM patient_directory WHERE id=$1 AND hospital_id=$2', [
        request.params.id,
        sessions.get(request)!.user.hospital.id,
      ]);
      if (!row) throw new ApiError(404, 'NOT_FOUND', 'The patient was not found.');
      return { patient: patient(row) };
    });
  });
  app.post('/api/patients', async (request, reply) => {
    const session = sessions.get(request)!;
    if (!['receptionist', 'admin'].includes(session.user.role))
      throw new ApiError(403, 'FORBIDDEN', 'This account can view patients only.');
    const parsed = registrationSchema.safeParse(request.body);
    const key = uuid.safeParse(request.headers['idempotency-key']);
    if (!parsed.success || !key.success || !emptyQuery.safeParse(request.query).success)
      throw invalid();
    const { name, age, contact, confirmDuplicate = false } = parsed.data;
    const hash = digest(JSON.stringify({ name, age: age ?? null, contact, confirmDuplicate }));
    const hospitalId = session.user.hospital.id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // A hospital row lock serializes both new keys and duplicate-name checks.
      const {
        rows: [hospital],
      } = await client.query('SELECT next_record_number FROM hospitals WHERE id=$1 FOR UPDATE', [
        hospitalId,
      ]);
      const actor = await currentActor(client, session);
      if (!actor || actor.password_change_required)
        throw new ApiError(401, 'UNAUTHENTICATED', 'Your session ended. Sign in again.');
      const {
        rows: [prior],
      } = await client.query(
        'SELECT payload_hash,patient_id FROM registration_requests WHERE hospital_id=$1 AND idempotency_key=$2',
        [hospitalId, key.data],
      );
      if (prior) {
        if (prior.payload_hash !== hash)
          throw new ApiError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'This retry key was already used for different details. Start a new registration.',
          );
        const {
          rows: [row],
        } = await client.query('SELECT * FROM patient_directory WHERE hospital_id=$1 AND id=$2', [
          hospitalId,
          prior.patient_id,
        ]);
        await client.query('COMMIT');
        return { patient: patient(row) };
      }
      const normalizedName = normalizeName(name);
      const duplicate = await client.query(
        'SELECT 1 FROM patient_directory WHERE hospital_id=$1 AND normalized_name=$2 LIMIT 1',
        [hospitalId, normalizedName],
      );
      if (duplicate.rowCount && !confirmDuplicate)
        throw new ApiError(
          409,
          'DUPLICATE_PATIENT',
          'A patient with this name already exists. Confirm this is a different patient to continue.',
        );
      const id = randomUUID();
      const recordNumber = `MRN-${String(hospital.next_record_number).padStart(6, '0')}`;
      const {
        rows: [row],
      } = await client.query(
        `INSERT INTO patients(id,hospital_id,record_number,name,normalized_name,age,contact)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [id, hospitalId, recordNumber, name, normalizedName, age ?? null, contact],
      );
      await client.query(
        'UPDATE hospitals SET next_record_number=next_record_number+1 WHERE id=$1',
        [hospitalId],
      );
      await client.query(
        'INSERT INTO registration_requests(hospital_id,idempotency_key,payload_hash,patient_id) VALUES ($1,$2,$3,$4)',
        [hospitalId, key.data, hash, id],
      );
      await client.query(
        "INSERT INTO audit_events(id,hospital_id,actor_id,patient_id,action) VALUES ($1,$2,$3,$4,'patient.registered')",
        [randomUUID(), hospitalId, session.user.id, id],
      );
      await client.query('COMMIT');
      return reply.code(201).send({ patient: patient(row) });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
  registerOutpatientRoutes(app, pool, sessions);
  registerConfigurationRoutes(app, pool, sessions);
  registerBillingRoutes(app, pool, sessions);
  registerClinicalRoutes(app, pool, sessions);
  registerInventoryRoutes(app, pool, sessions);
  registerReportRoutes(app, pool, sessions);
  registerAdministrationRoutes(app, pool, sessions);
  registerMfaRoutes(app, pool, sessions, secureCookies);
  registerCareRoutes(app, pool, sessions);
  registerDepartmentRoutes(app, pool, sessions);
  registerHospitalRoutes(app, pool, sessions);
  return app;
}
