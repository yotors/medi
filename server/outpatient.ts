import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { balance, blockers, DomainError, execute, type State, type Visit } from '../src/domain.ts';
import { commandAction, commandRequestSchema, roleActions, roleSections, type VisitCommand, type VisitSummary, type VisitView } from '../shared/outpatient.ts';
import type { RegisteredPatient, Session, StaffRole } from '../shared/registration.ts';
import { readBillingSummaries, readBillingSummary } from './billing.ts';
import { ApiError } from './app.ts';
import { currentActor, digest } from './auth.ts';

const uuid = z.uuid();
const empty = z.strictObject({});
const querySchema = z.strictObject({
  q: z.string().max(100).refine(value => !value.includes('\0')).default(''),
  status: z.enum(['active', 'closed', 'all']).default('active'),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});
type Row = { id: string; revision: number; data: Visit; patient: Record<string, unknown> };
const selectVisit = `SELECT v.id,v.revision,v.data,to_jsonb(p) AS patient FROM outpatient_visits v
  JOIN patients p ON p.id=v.patient_id AND p.hospital_id=v.hospital_id`;
const invalid = () => new ApiError(400, 'INVALID_REQUEST', 'Check the request fields and try again.');
const notFound = () => new ApiError(404, 'NOT_FOUND', 'The requested resource was not found.');
const literal = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;
function patient(row: Record<string, unknown>): RegisteredPatient {
  return { id: row.id as string, name: row.name as string, recordNumber: row.record_number as string,
    ...(row.age === null ? {} : { age: row.age as number }), contact: row.contact as string,
    createdAt: new Date(row.created_at as string).toISOString() };
}
function summary(row: Row): VisitSummary {
  const v = row.data;
  const pendingInvestigations = v.orders.filter(o => !['reviewed', 'cancelled'].includes(o.status)).length;
  const pendingPrescriptions = v.prescriptions.filter(p => p.status === 'pending').length;
  return { id: v.id, financialMode: v.financialMode === 'catalog' ? 'catalog' : 'legacy_demo', patient: patient(row.patient), status: v.status, revision: row.revision,
    openedAt: v.openedAt, ...(v.closedAt ? { closedAt: v.closedAt } : {}), balance: balance(v), blockers: blockers(v),
    pendingInvestigations, pendingPrescriptions,
    stage: v.status === 'closed' ? 'Closed' : !v.notes.length ? 'Consultation' : pendingInvestigations ? 'Diagnostics'
      : pendingPrescriptions ? 'Pharmacy' : balance(v) > 0 ? 'Billing' : 'Ready to close' };
}
async function project(client: pg.PoolClient, row: Row, role: StaffRole, hospitalId: string): Promise<VisitView> {
  const sections = roleSections[role];
  const view: VisitView = { ...summary(row), sections, allowedActions: row.data.status === 'closed' ? [] : roleActions[role].filter(action => row.data.financialMode !== 'catalog' || action !== 'settle') };
  if (row.data.financialMode === 'catalog') {
    view.billing = await readBillingSummary(client, hospitalId, row.id);
    view.balance = view.billing.balanceMinor;
  }
  if (sections.includes('Consultation')) view.notes = row.data.notes;
  if (sections.includes('Diagnostics')) view.orders = row.data.orders;
  if (sections.includes('Pharmacy')) view.prescriptions = row.data.prescriptions;
  if (sections.includes('Billing')) { view.charges = row.data.charges; view.payments = row.data.payments; }
  if (sections.includes('History')) {
    const { rows } = await client.query(`SELECT e.id,e.created_at,u.display_name,e.detail FROM audit_events e
      JOIN staff_users u ON u.id=e.actor_id AND u.hospital_id=e.hospital_id
      WHERE e.hospital_id=$1 AND e.visit_id=$2 ORDER BY e.visit_revision`, [hospitalId, row.id]);
    view.history = rows.map(e => ({ id: e.id, at: e.created_at.toISOString(), actor: e.display_name, detail: e.detail }));
  }
  return view;
}
async function load(client: pg.PoolClient, hospitalId: string, id: string, lock = false): Promise<Row> {
  const { rows: [row] } = await client.query<Row>(`${selectVisit} WHERE v.hospital_id=$1 AND v.id=$2${lock ? ' FOR UPDATE OF v' : ''}`, [hospitalId, id]);
  if (!row) throw notFound();
  return row;
}
function transition(state: State, command: Parameters<typeof execute>[1]): State {
  try { return execute(state, command); }
  catch (error) {
    if (error instanceof DomainError) throw new ApiError(409, 'TRANSITION_BLOCKED', error.message);
    if (error instanceof z.ZodError) throw invalid();
    throw error;
  }
}
function auditSubject(command: VisitCommand | { type: 'checkIn' }, visit: Visit, previous?: Visit): [string, string, string | null, string] {
  switch (command.type) {
    case 'checkIn': return ['visit', visit.id, null, 'active'];
    case 'note': return ['note', visit.notes.at(-1)!.id, null, 'saved'];
    case 'order': return ['investigation', visit.orders.at(-1)!.id, null, 'requested'];
    case 'advanceOrder': return ['investigation', command.orderId, previous!.orders.find(o => o.id === command.orderId)!.status, command.next];
    case 'prescribe': return ['prescription', visit.prescriptions.at(-1)!.id, null, 'pending'];
    case 'fulfill': return ['prescription', command.prescriptionId, previous!.prescriptions.find(p => p.id === command.prescriptionId)!.status, command.next];
    case 'settle': return ['payment', visit.payments.at(-1)!.id, null, 'recorded'];
    case 'close': return ['visit', visit.id, previous!.status, 'closed'];
  }
}
async function record(client: pg.PoolClient, session: Session, state: State, visit: Visit, key: string, hash: string, command: VisitCommand | { type: 'checkIn' }, previous?: Visit) {
  const event = state.events.at(-1)!;
  await client.query(`INSERT INTO audit_events(id,hospital_id,actor_id,patient_id,action,created_at,visit_id,visit_revision,detail,subject_type,subject_id,transition_from,transition_to)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [randomUUID(), session.user.hospital.id, session.user.id, visit.patientId,
    `visit.${command.type}`, event.at, visit.id, state.revision, event.detail, ...auditSubject(command, visit, previous)]);
  await client.query('INSERT INTO outpatient_requests(hospital_id,idempotency_key,payload_hash,visit_id) VALUES ($1,$2,$3,$4)',
    [session.user.hospital.id, key, hash, visit.id]);
}
export function registerOutpatientRoutes(app: FastifyInstance, pool: pg.Pool, sessions: WeakMap<FastifyRequest, Session>) {
  app.get('/api/visits', async request => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) throw invalid();
    const { q, status, page } = parsed.data;
    const session = sessions.get(request)!;
    const hospitalId = session.user.hospital.id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SET LOCAL statement_timeout='10s'");
      await client.query('SELECT id FROM hospitals WHERE id=$1 FOR SHARE', [session.user.hospital.id]);
      const actor = await currentActor(client, session);
      if (!actor || actor.password_change_required) throw new ApiError(401, 'UNAUTHENTICATED', 'Your session ended. Sign in again.');
      const predicate = `v.hospital_id=$1 AND ($2='all' OR v.status=$2)
        AND (p.name ILIKE $3 OR p.record_number ILIKE $3 OR p.contact ILIKE $3 OR p.normalized_name LIKE $4)`;
      const args = [hospitalId, status, literal(q), literal(q.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim())];
      const { rows: [count] } = await client.query(`SELECT count(*)::integer AS total FROM outpatient_visits v
        JOIN patients p ON p.id=v.patient_id AND p.hospital_id=v.hospital_id WHERE ${predicate}`, args);
      const { rows } = await client.query<Row>(`${selectVisit} WHERE ${predicate} ORDER BY v.opened_at DESC,v.id DESC LIMIT 25 OFFSET $5`, [...args, (page - 1) * 25]);
      const billing = await readBillingSummaries(client, hospitalId, rows.filter(row => row.data.financialMode === 'catalog').map(row => row.id));
      const visits: VisitSummary[] = [];
      for (const row of rows) {
        const view = summary(row);
        if (view.financialMode === 'catalog') { view.billing = billing.get(row.id)!; view.balance = view.billing.balanceMinor; }
        visits.push(view);
      }
      await client.query('COMMIT');
      return { visits, total: count.total, page, pageSize: 25 };
    } catch (error) {
      await client.query('ROLLBACK');
      if (['55P03', '57014', '40001', '40P01'].includes((error as { code?: string }).code ?? '')) throw new ApiError(503, 'OUTPATIENT_BUSY', 'The workspace is temporarily busy. Retry the exact same request.');
      throw error;
    }
    finally { client.release(); }
  });
  app.get<{ Params: { id: string } }>('/api/visits/:id', async request => {
    if (!empty.safeParse(request.query).success) throw invalid();
    if (!uuid.safeParse(request.params.id).success) throw notFound();
    const session = sessions.get(request)!;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SET LOCAL statement_timeout='10s'");
      await client.query('SELECT id FROM hospitals WHERE id=$1 FOR SHARE', [session.user.hospital.id]);
      const actor = await currentActor(client, session);
      if (!actor || actor.password_change_required) throw new ApiError(401, 'UNAUTHENTICATED', 'Your session ended. Sign in again.');
      const row = await load(client, session.user.hospital.id, request.params.id);
      const visit = await project(client, row, session.user.role, session.user.hospital.id);
      await client.query('COMMIT');
      return { visit };
    } catch (error) {
      await client.query('ROLLBACK');
      if (['55P03', '57014', '40001', '40P01'].includes((error as { code?: string }).code ?? '')) throw new ApiError(503, 'OUTPATIENT_BUSY', 'The workspace is temporarily busy. Retry the exact same request.');
      throw error;
    }
    finally { client.release(); }
  });
  app.post<{ Params: { id: string } }>('/api/patients/:id/visits', async (request, reply) => {
    const session = sessions.get(request)!;
    if (!roleActions[session.user.role].includes('checkIn')) throw new ApiError(403, 'FORBIDDEN', 'This account cannot check in patients.');
    const key = uuid.safeParse(request.headers['idempotency-key']);
    if (!key.success || !empty.safeParse(request.query).success || !empty.safeParse(request.body).success) throw invalid();
    if (!uuid.safeParse(request.params.id).success) throw notFound();
    const hospitalId = session.user.hospital.id;
    const hash = digest(JSON.stringify({ actor: session.user.id, patientId: request.params.id, action: 'checkIn' }));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SET LOCAL statement_timeout='10s'");
      // Hospital-first locks serialize receipt keys, including keys reused on a
      // different patient/visit, and share registration's lock ordering.
      await client.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [hospitalId]);
      const actor = await currentActor(client, session);
      if (!actor || actor.password_change_required) throw new ApiError(401, 'UNAUTHENTICATED', 'Your session ended. Sign in again.');
      // Patient records are append-only. The hospital lock already serializes
      // check-ins, so reading the patient does not require UPDATE privileges.
      const { rows: [p] } = await client.query('SELECT * FROM patients WHERE hospital_id=$1 AND id=$2', [hospitalId, request.params.id]);
      if (!p) throw notFound();
      const { rows: [prior] } = await client.query('SELECT * FROM outpatient_requests WHERE hospital_id=$1 AND idempotency_key=$2', [hospitalId, key.data]);
      if (prior) {
        if (prior.payload_hash !== hash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This retry key was already used for different details.');
        const visit = await project(client, await load(client, hospitalId, prior.visit_id), session.user.role, hospitalId);
        await client.query('COMMIT'); return { visit };
      }
      const existing = await client.query("SELECT 1 FROM outpatient_visits WHERE hospital_id=$1 AND patient_id=$2 AND status='active'", [hospitalId, p.id]);
      if (existing.rowCount) throw new ApiError(409, 'ACTIVE_VISIT', 'This patient already has an active visit. Open the existing visit.');
      const state = transition({ version: 1, revision: 0, patients: [patient(p)], visits: [], events: [] }, { type: 'checkIn', patientId: p.id, financialMode: 'catalog' });
      const data = state.visits[0];
      await client.query('INSERT INTO outpatient_visits(id,hospital_id,patient_id,revision,status,opened_at,data) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [data.id, hospitalId, p.id, state.revision, data.status, data.openedAt, JSON.stringify(data)]);
      await record(client, session, state, data, key.data, hash, { type: 'checkIn' });
      const visit = await project(client, { id: data.id, revision: state.revision, data, patient: p }, session.user.role, hospitalId);
      await client.query('COMMIT'); return reply.code(201).send({ visit });
    } catch (error) {
      await client.query('ROLLBACK');
      if (['55P03', '57014', '40001', '40P01'].includes((error as { code?: string }).code ?? '')) throw new ApiError(503, 'OUTPATIENT_BUSY', 'The workspace is temporarily busy. Retry the exact same request.');
      throw error;
    }
    finally { client.release(); }
  });
  app.post<{ Params: { id: string } }>('/api/visits/:id/commands', { bodyLimit: 32768 }, async request => {
    const session = sessions.get(request)!;
    const parsed = commandRequestSchema.safeParse(request.body);
    const key = uuid.safeParse(request.headers['idempotency-key']);
    if (!parsed.success || !key.success || !empty.safeParse(request.query).success) throw invalid();
    const { expectedRevision, command } = parsed.data;
    if (!roleActions[session.user.role].includes(commandAction(command))) throw new ApiError(403, 'FORBIDDEN', 'This account cannot perform this action.');
    if (!uuid.safeParse(request.params.id).success) throw notFound();
    const hospitalId = session.user.hospital.id;
    const hash = digest(JSON.stringify({ actor: session.user.id, visitId: request.params.id, expectedRevision, command }));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SET LOCAL statement_timeout='10s'");
      await client.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [hospitalId]);
      const actor = await currentActor(client, session);
      if (!actor || actor.password_change_required) throw new ApiError(401, 'UNAUTHENTICATED', 'Your session ended. Sign in again.');
      const row = await load(client, hospitalId, request.params.id, true);
      const { rows: [prior] } = await client.query('SELECT * FROM outpatient_requests WHERE hospital_id=$1 AND idempotency_key=$2', [hospitalId, key.data]);
      if (prior) {
        if (prior.payload_hash !== hash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This retry key was already used for different details.');
        const visit = await project(client, row, session.user.role, hospitalId);
        await client.query('COMMIT'); return { visit };
      }
      if (row.revision !== expectedRevision) throw new ApiError(409, 'STALE_REVISION', 'This visit changed. Reload the latest visit before saving your draft again.');
      const state = transition({ version: 1, revision: row.revision, patients: [patient(row.patient)], visits: [row.data], events: [] }, { ...command, visitId: row.id });
      const data = state.visits[0];
      await client.query('UPDATE outpatient_visits SET revision=$3,status=$4,data=$5 WHERE hospital_id=$1 AND id=$2', [hospitalId, row.id, state.revision, data.status, JSON.stringify(data)]);
      await record(client, session, state, data, key.data, hash, command, row.data);
      const visit = await project(client, { ...row, revision: state.revision, data }, session.user.role, hospitalId);
      await client.query('COMMIT'); return { visit };
    } catch (error) {
      await client.query('ROLLBACK');
      if (['55P03', '57014', '40001', '40P01'].includes((error as { code?: string }).code ?? '')) throw new ApiError(503, 'OUTPATIENT_BUSY', 'The workspace is temporarily busy. Retry the exact same request.');
      throw error;
    }
    finally { client.release(); }
  });
}
