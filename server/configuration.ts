import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { configurationCommandSchema, configurationQuerySchema, type ConfigurationItem, type ConfigurationResult } from '../shared/configuration.ts';
import type { Session } from '../shared/registration.ts';
import { ApiError } from './app.ts';
import { currentActor, digest } from './auth.ts';
const invalid = () => new ApiError(400, 'INVALID_REQUEST', 'Check the configuration fields and try again.');
const missing = () => new ApiError(404, 'NOT_FOUND', 'The configuration entry was not found.');
const forbidden = () => new ApiError(403, 'FORBIDDEN', 'Administrator access is required.');
const conflict = () => new ApiError(409, 'REVISION_CONFLICT', 'This entry changed. Reload its current revision and review your retained draft.');
const empty = z.strictObject({});
const tables = { departments: 'hospital_departments', services: 'hospital_services' } as const;
type Kind = keyof typeof tables;
const select = (kind: Kind) => kind === 'departments' ? 'SELECT d.* FROM hospital_departments d' : `SELECT s.id,s.code,s.revision,v.name,v.active,v.department_id,d.code AS department_code,d.name AS department_name,v.price_minor,v.currency,v.effective_at,d.active AS department_active FROM hospital_services s JOIN hospital_service_versions v ON (v.hospital_id,v.service_id,v.revision)=(s.hospital_id,s.id,s.revision) JOIN hospital_departments d ON (d.hospital_id,d.id)=(v.hospital_id,v.department_id)`;
const alias = (kind: Kind) => kind === 'departments' ? 'd' : 's';
const project = (row: Record<string, any>, kind: Kind): ConfigurationItem => ({ id: row.id, code: row.code, name: row.name, revision: row.revision, active: row.active,
  ...(kind === 'services' ? { departmentId: row.department_id, departmentCode: row.department_code, departmentName: row.department_name, departmentActive: row.department_active, priceMinor: row.price_minor, currency: 'ETB' as const, effectiveAt: row.effective_at.toISOString() } : {}) });
async function readEntry(client: pg.PoolClient, kind: Kind, hospitalId: string, id: string, admin = true) {
  const result = await client.query(`${select(kind)} WHERE ${alias(kind)}.hospital_id=$1 AND ${alias(kind)}.id=$2${admin ? '' : kind === 'departments' ? ' AND d.active' : ' AND v.active AND d.active'}`, [hospitalId, id]);
  if (!result.rows[0]) throw missing();
  return project(result.rows[0], kind);
}
export function registerConfigurationRoutes(app: FastifyInstance, pool: pg.Pool, sessions: WeakMap<FastifyRequest, Session>) {
  // Shared hospital locks also prevent an in-flight privileged read from passing a committed revocation.
  async function transaction<T>(session: Session, admin: boolean, write: boolean, work: (client: pg.PoolClient, actor: Record<string, any>) => Promise<T>) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '10s'");
      await client.query(`SELECT id FROM hospitals WHERE id=$1 FOR ${write ? 'UPDATE' : 'SHARE'}`, [session.user.hospital.id]);
      const actor = await currentActor(client, session);
      if (!actor || actor.password_change_required) throw new ApiError(401, 'UNAUTHENTICATED', 'Your session ended. Sign in again.');
      if (admin && actor.role !== 'admin') throw forbidden();
      const result = await work(client, actor); await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); if (['55P03', '57014'].includes((error as { code?: string }).code ?? '')) throw new ApiError(503, 'CONFIGURATION_BUSY', 'Configuration is temporarily busy. Retry the same request.'); if ((error as { code?: string }).code === '23505') throw new ApiError(409, 'CODE_CONFLICT', 'That code is already in use. Choose a different code.'); throw error; }
    finally { client.release(); }
  }
  for (const kind of ['departments', 'services'] as const) {
    app.get(`/api/configuration/${kind}`, async request => {
      const query = configurationQuerySchema.safeParse(request.query); if (!query.success) throw invalid();
      const session = sessions.get(request)!; const { q, page, active } = query.data;
      return transaction(session, false, false, async (client, actor) => {
        const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
        const activeOnly = actor.role !== 'admin' || active === 'true';
        const predicate = `${alias(kind)}.hospital_id=$1 AND (${alias(kind)}.code ILIKE $2 OR ${kind === 'departments' ? 'd' : 'v'}.name ILIKE $2)${!activeOnly ? '' : kind === 'departments' ? ' AND d.active' : ' AND v.active AND d.active'}`;
        const sql = `${select(kind)} WHERE ${predicate}`;
        const { rows: [count] } = await client.query(`SELECT count(*)::integer AS total FROM (${sql}) entries`, [session.user.hospital.id, pattern]);
        const { rows } = await client.query(`${sql} ORDER BY ${alias(kind)}.code LIMIT 25 OFFSET $3`, [session.user.hospital.id, pattern, (page - 1) * 25]);
        return { entries: rows.map(row => project(row, kind)), total: count.total, page, pageSize: 25 };
      });
    });
    app.get<{ Params: { id: string } }>(`/api/configuration/${kind}/:id`, async request => {
      if (!empty.safeParse(request.query).success) throw invalid(); if (!z.uuid().safeParse(request.params.id).success) throw missing();
      const session = sessions.get(request)!;
      return transaction(session, false, false, async (client, actor) => ({ entry: await readEntry(client, kind, session.user.hospital.id, request.params.id, actor.role === 'admin') }));
    });
    app.get<{ Params: { id: string } }>(`/api/configuration/${kind}/:id/history`, async request => {
      const session = sessions.get(request)!; if (session.user.role !== 'admin') throw forbidden();
      const parsed = z.strictObject({ page: z.coerce.number().int().min(1).max(10000).default(1) }).safeParse(request.query);
      if (!parsed.success) throw invalid(); if (!z.uuid().safeParse(request.params.id).success) throw missing();
      return transaction(session, true, false, async client => {
        await readEntry(client, kind, session.user.hospital.id, request.params.id);
        const column = kind === 'departments' ? 'department_id' : 'service_id';
        const args = [session.user.hospital.id, request.params.id];
        const { rows: [count] } = await client.query(`SELECT count(*)::integer AS total FROM hospital_configuration_events WHERE hospital_id=$1 AND ${column}=$2`, args);
        const { rows } = await client.query(`SELECT * FROM hospital_configuration_events WHERE hospital_id=$1 AND ${column}=$2 ORDER BY revision DESC LIMIT 25 OFFSET $3`, [...args, (parsed.data.page - 1) * 25]);
        return { events: rows.map(row => ({ id: row.id, action: row.action, actorId: row.actor_id, actorName: row.actor_name, revision: row.revision, createdAt: row.created_at.toISOString(), snapshot: row.snapshot })), total: count.total, page: parsed.data.page, pageSize: 25 };
      });
    });
  }
  app.post('/api/configuration/commands', async request => {
    const session = sessions.get(request)!; if (session.user.role !== 'admin') throw forbidden();
    const parsed = configurationCommandSchema.safeParse(request.body); const key = z.uuid().safeParse(request.headers['idempotency-key']);
    if (!parsed.success || !key.success || !empty.safeParse(request.query).success) throw invalid();
    const command = parsed.data; const hospital = session.user.hospital.id; const hash = digest(JSON.stringify(command));
    return transaction(session, true, true, async (client, actor): Promise<ConfigurationResult> => {
      const { rows: [receipt] } = await client.query('SELECT * FROM hospital_configuration_requests WHERE hospital_id=$1 AND idempotency_key=$2', [hospital, key.data]);
      if (receipt) {
        if (receipt.actor_id !== actor.id || receipt.payload_hash !== hash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This retry key belongs to different details.');
        return receipt.result;
      }
      const kind: Kind = command.type.startsWith('department.') ? 'departments' : 'services';
      const id = 'id' in command ? command.id : randomUUID();
      let revision = 1;
      if ('expectedRevision' in command) {
        const previous = await readEntry(client, kind, hospital, id);
        if (previous.revision !== command.expectedRevision) throw conflict(); revision = previous.revision + 1;
      }
      if (command.type === 'department.create') await client.query('INSERT INTO hospital_departments(id,hospital_id,code,name) VALUES($1,$2,$3,$4)', [id, hospital, command.code, command.name]);
      else if (command.type === 'department.update') await client.query('UPDATE hospital_departments SET name=$3,active=$4,revision=$5 WHERE hospital_id=$1 AND id=$2', [hospital, id, command.name, command.active, revision]);
      else {
        const { rows: [department] } = await client.query('SELECT * FROM hospital_departments WHERE hospital_id=$1 AND id=$2', [hospital, command.departmentId]);
        // Retirement is permitted for an existing service whose department has already retired.
        const retiring = command.type === 'service.update' && !command.active && (await readEntry(client, kind, hospital, id) as { departmentId?: string }).departmentId === command.departmentId;
        if (!department || (!department.active && !retiring)) throw new ApiError(400, 'INVALID_DEPARTMENT', 'Choose an active department in this hospital.');
        if (command.type === 'service.create') await client.query('INSERT INTO hospital_services(id,hospital_id,code) VALUES($1,$2,$3)', [id, hospital, command.code]);
        else await client.query('UPDATE hospital_services SET revision=$3 WHERE hospital_id=$1 AND id=$2', [hospital, id, revision]);
        await client.query(`INSERT INTO hospital_service_versions(hospital_id,service_id,revision,name,active,department_id,department_code,department_name,price_minor,actor_id,actor_name)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [hospital, id, revision, command.name, command.type === 'service.create' || command.active, department.id, department.code, department.name, command.priceMinor, actor.id, actor.display_name]);
      }
      const entry = await readEntry(client, kind, hospital, id); const result = { entry };
      await client.query(`INSERT INTO hospital_configuration_events(id,hospital_id,actor_id,actor_name,department_id,service_id,revision,action,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [randomUUID(), hospital, actor.id, actor.display_name, kind === 'departments' ? id : null, kind === 'services' ? id : null, revision, command.type, JSON.stringify(entry)]);
      await client.query('INSERT INTO hospital_configuration_requests(hospital_id,idempotency_key,actor_id,payload_hash,result) VALUES($1,$2,$3,$4,$5)', [hospital, key.data, actor.id, hash, JSON.stringify(result)]);
      return result;
    });
  });
}
