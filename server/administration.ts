import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { administrationRequestSchema, passwordChangeSchema, staffQuerySchema, staffHistoryQuerySchema, staffAccountQuerySchema, staffAccountParamsSchema, type StaffAccount } from '../shared/administration.ts';
import type { Session } from '../shared/registration.ts';
import { ApiError } from './app.ts';
import { reserveReauthentication, currentActor, hashPassword, verifyPassword } from './auth.ts';
const empty = z.strictObject({});
const account = (row: Record<string, unknown>): StaffAccount => ({ id: row.id as string, username: row.username as string, displayName: row.display_name as string, role: row.role as StaffAccount['role'], active: row.active as boolean, revision: row.revision as number, passwordChangeRequired: row.password_change_required as boolean });
const invalid = () => new ApiError(400, 'INVALID_REQUEST', 'Check the account fields and try again.');
const forbidden = () => new ApiError(403, 'FORBIDDEN', 'This account cannot administer staff.');
const expired = () => new ApiError(401, 'UNAUTHENTICATED', 'Your session ended. Sign in again.');
const missing = () => new ApiError(404, 'NOT_FOUND', 'The staff account was not found.');

export function registerAdministrationRoutes(app: FastifyInstance, pool: pg.Pool, sessions: WeakMap<FastifyRequest, Session>) {
  const admin = (request: FastifyRequest) => { const session = sessions.get(request)!; if (session.user.role !== 'admin') throw forbidden(); return session; };
  async function reauthenticate(session: Session, password: string, ip: string) {
    const refund = await reserveReauthentication(pool, session.user.id, ip);
    if (!refund) throw new ApiError(429, 'RATE_LIMITED', 'Password verification is temporarily unavailable. Try again later.');
    const { rows: [row] } = await pool.query('SELECT password_hash FROM staff_users WHERE id=$1 AND hospital_id=$2', [session.user.id, session.user.hospital.id]);
    // Failed/aborted verifications retain their reservation until expiry.
    if (!row || !await verifyPassword(password, row.password_hash)) throw new ApiError(403, 'PASSWORD_INCORRECT', 'The current password was not accepted.');
    await refund();
    return row.password_hash as string;
  }
  async function readAsAdministrator<T>(session: Session, read: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // SHARE permits simultaneous reads but serializes them against revocation.
      // READ COMMITTED ensures authorization sees changes committed while waiting.
      await client.query('SELECT id FROM hospitals WHERE id=$1 FOR SHARE', [session.user.hospital.id]);
      const actor = await currentActor(client, session);
      if (!actor) throw expired();
      if (actor.role !== 'admin' || actor.password_change_required) throw forbidden();
      const result = await read(client);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  app.get('/api/staff', async request => {
    const session = admin(request);
    const parsed = staffQuerySchema.safeParse(request.query); if (!parsed.success) throw invalid();
    const { q, page } = parsed.data;
    const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    return readAsAdministrator(session, async client => {
      const { rows: [count] } = await client.query('SELECT count(*)::integer AS total FROM staff_users WHERE hospital_id=$1 AND (display_name ILIKE $2 OR username ILIKE $2)', [session.user.hospital.id, pattern]);
      const { rows } = await client.query('SELECT * FROM staff_users WHERE hospital_id=$1 AND (display_name ILIKE $2 OR username ILIKE $2) ORDER BY display_name,id LIMIT 25 OFFSET $3', [session.user.hospital.id, pattern, (page - 1) * 25]);
      return { accounts: rows.map(account), total: count.total, page, pageSize: 25 };
    });
  });
  app.get<{ Params: { id: string } }>('/api/staff/:id', async request => {
    const session = admin(request);
    if (!staffAccountParamsSchema.safeParse(request.params).success) throw missing();
    if (!staffAccountQuerySchema.safeParse(request.query).success) throw invalid();
    return readAsAdministrator(session, async client => {
      const { rows: [row] } = await client.query('SELECT * FROM staff_users WHERE hospital_id=$1 AND id=$2', [session.user.hospital.id, request.params.id]);
      if (!row) throw missing();
      return { account: account(row) };
    });
  });
  app.get<{ Params: { id: string } }>('/api/staff/:id/history', async request => {
    const session = admin(request);
    if (!staffAccountParamsSchema.safeParse(request.params).success) throw missing();
    const parsed = staffHistoryQuerySchema.safeParse(request.query); if (!parsed.success) throw invalid();
    const { page } = parsed.data;
    return readAsAdministrator(session, async client => {
      const found = await client.query('SELECT 1 FROM staff_users WHERE hospital_id=$1 AND id=$2', [session.user.hospital.id, request.params.id]);
      if (!found.rowCount) throw missing();
      const { rows: [count] } = await client.query('SELECT count(*)::integer AS total FROM staff_administration_events WHERE hospital_id=$1 AND account_id=$2', [session.user.hospital.id, request.params.id]);
      const { rows } = await client.query(`SELECT e.id,e.action,e.revision,e.role,e.active,e.created_at,e.actor_id,u.username AS actor_username,u.display_name AS actor_name
        FROM staff_administration_events e JOIN staff_users u ON u.id=e.actor_id AND u.hospital_id=e.hospital_id
        WHERE e.hospital_id=$1 AND e.account_id=$2 ORDER BY e.revision DESC LIMIT 25 OFFSET $3`, [session.user.hospital.id, request.params.id, (page - 1) * 25]);
      return { events: rows.map(row => ({ id: row.id, actorId: row.actor_id, actorUsername: row.actor_username, actorName: row.actor_name, action: row.action, revision: row.revision, role: row.role, active: row.active, createdAt: row.created_at.toISOString() })), total: count.total, page, pageSize: 25 };
    });
  });
  app.post('/api/staff/commands', async (request, reply) => {
    const session = admin(request); const parsed = administrationRequestSchema.safeParse(request.body); const key = z.uuid().safeParse(request.headers['idempotency-key']);
    if (!parsed.success || !key.success || !empty.safeParse(request.query).success) throw invalid();
    const { command, currentPassword } = parsed.data;
    const actorHash = await reauthenticate(session, currentPassword, request.ip);
    // Salted scrypt fingerprints protect temporary passwords in retry identities. Reauthentication is excluded.
    const identity = JSON.stringify(command);
    const fingerprint = await hashPassword(identity);
    const passwordHash = command.type === 'update' ? null : await hashPassword(command.temporaryPassword);
    const hospitalId = session.user.hospital.id; const client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [hospitalId]);
      const actor = await currentActor(client, session);
      if (!actor || actor.password_hash !== actorHash) throw expired();
      if (actor.role !== 'admin' || actor.password_change_required) throw forbidden();
      const { rows: [prior] } = await client.query('SELECT * FROM staff_administration_requests WHERE hospital_id=$1 AND idempotency_key=$2', [hospitalId, key.data]);
      if (prior) {
        if (prior.actor_id !== session.user.id || !await verifyPassword(identity, prior.payload_hash)) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This retry key was already used for different account details.');
        await client.query('COMMIT'); return { account: prior.result };
      }
      let row;
      if (command.type === 'create') {
        const duplicate = await client.query('SELECT 1 FROM staff_users WHERE hospital_id=$1 AND username=$2', [hospitalId, command.username]);
        if (duplicate.rowCount) throw new ApiError(409, 'USERNAME_CONFLICT', 'That username is already in use in this hospital.');
        ({ rows: [row] } = await client.query(`INSERT INTO staff_users(id,hospital_id,username,display_name,role,password_hash,password_change_required)
          VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING *`, [randomUUID(), hospitalId, command.username, command.displayName, command.role, passwordHash]));
      } else {
        const { rows: [target] } = await client.query('SELECT * FROM staff_users WHERE hospital_id=$1 AND id=$2 FOR UPDATE', [hospitalId, command.accountId]);
        if (!target) throw missing();
        if (target.revision !== command.expectedRevision) throw new ApiError(409, 'REVISION_CONFLICT', 'This account changed. Reload its current details before submitting again.');
        if (target.id === session.user.id && (command.type === 'reset' || !command.active || command.role !== 'admin')) throw new ApiError(409, 'SELF_CHANGE', 'Use Change password for your own credentials. You cannot remove your own administrator access.');
        if (command.type === 'update' && target.active && target.role === 'admin' && (!command.active || command.role !== 'admin')) {
          const { rows: [count] } = await client.query("SELECT count(*)::integer AS count FROM staff_users WHERE hospital_id=$1 AND active AND role='admin'", [hospitalId]);
          if (count.count <= 1) throw new ApiError(409, 'LAST_ADMIN', 'Keep at least one active hospital administrator.');
        }
        ({ rows: [row] } = command.type === 'update'
          ? await client.query('UPDATE staff_users SET role=$3,active=$4,revision=revision+1 WHERE hospital_id=$1 AND id=$2 RETURNING *', [hospitalId, target.id, command.role, command.active])
          : await client.query('UPDATE staff_users SET password_hash=$3,password_change_required=true,revision=revision+1 WHERE hospital_id=$1 AND id=$2 RETURNING *', [hospitalId, target.id, passwordHash]));
        await client.query('DELETE FROM staff_sessions WHERE user_id=$1', [target.id]);
      }
      const result = account(row);
      await client.query('INSERT INTO staff_administration_events(id,hospital_id,actor_id,account_id,action,revision,role,active,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp())', [randomUUID(), hospitalId, session.user.id, row.id, `staff.${command.type === 'create' ? 'created' : command.type === 'update' ? 'updated' : 'reset'}`, row.revision, row.role, row.active]);
      await client.query('INSERT INTO staff_administration_requests(hospital_id,idempotency_key,actor_id,payload_hash,account_id,result) VALUES ($1,$2,$3,$4,$5,$6)', [hospitalId, key.data, session.user.id, fingerprint, row.id, result]);
      await client.query('COMMIT'); return reply.code(command.type === 'create' ? 201 : 200).send({ account: result });
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  });
  app.post('/api/auth/password', async request => {
    const session = sessions.get(request)!; const parsed = passwordChangeSchema.safeParse(request.body);
    if (!parsed.success || !empty.safeParse(request.query).success) throw invalid();
    if (parsed.data.currentPassword === parsed.data.newPassword) throw new ApiError(400, 'PASSWORD_UNCHANGED', 'Choose a different password, with at least 12 characters.');
    const actorHash = await reauthenticate(session, parsed.data.currentPassword, request.ip);
    const newHash = await hashPassword(parsed.data.newPassword); const client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [session.user.hospital.id]);
      const actor = await currentActor(client, session); if (!actor || actor.password_hash !== actorHash) throw expired();
      const { rows: [row] } = await client.query('UPDATE staff_users SET password_hash=$2,password_change_required=false,revision=revision+1 WHERE id=$1 RETURNING *', [session.user.id, newHash]);
      await client.query('DELETE FROM staff_sessions WHERE user_id=$1', [session.user.id]);
      await client.query("INSERT INTO staff_administration_events(id,hospital_id,actor_id,account_id,action,revision,role,active,created_at) VALUES ($1,$2,$3,$3,'password.changed',$4,$5,$6,clock_timestamp())", [randomUUID(), session.user.hospital.id, session.user.id, row.revision, row.role, row.active]);
      await client.query('COMMIT'); return { changed: true };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  });
}
