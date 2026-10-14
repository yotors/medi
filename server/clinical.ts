import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import {
  clinicalCommandSchema,
  clinicalUuid,
  type ClinicalDetail,
  type ClinicalAssignment,
  type ClinicalHistoryPage,
  type ClinicalRecord,
  type ClinicalResult,
} from '../shared/clinical.ts';
import type { Session, StaffRole } from '../shared/registration.ts';
import type { Visit } from '../shared/visit-domain.ts';
import { ApiError } from './app.ts';
import { currentActor, digest } from './auth.ts';
const empty = z.strictObject({});
const missing = () => new ApiError(404, 'NOT_FOUND', 'The clinical record was not found.');
const invalid = () =>
  new ApiError(400, 'INVALID_REQUEST', 'Check the correction fields and try again.');
const stale = () =>
  new ApiError(
    409,
    'STALE_CLINICAL_VERSION',
    'This clinical record changed. Refresh and review the latest correction before saving again.',
  );
const forbidden = () =>
  new ApiError(403, 'FORBIDDEN', 'This account cannot perform this clinical action.');
// A review applies to one immutable correction, never to a later correction.
const pendingPredicate = `c.action='result.correct'
  AND NOT EXISTS(SELECT 1 FROM clinical_events newer WHERE newer.hospital_id=c.hospital_id AND newer.visit_id=c.visit_id AND newer.kind=c.kind AND newer.subject_id=c.subject_id AND newer.action='result.correct' AND newer.version>c.version)
  AND NOT EXISTS(SELECT 1 FROM clinical_events reviewed WHERE reviewed.hospital_id=c.hospital_id AND reviewed.amendment_id=c.amendment_id AND reviewed.action='result.review')`;
export const pendingClinicalVisitPredicate = `EXISTS(SELECT 1 FROM clinical_events c WHERE c.hospital_id=v.hospital_id AND c.visit_id=v.id AND ${pendingPredicate})`;
export async function readClinicalCounts(
  client: pg.PoolClient,
  hospital: string,
  visits: string[],
): Promise<Map<string, number>> {
  if (!visits.length) return new Map();
  const { rows } = await client.query(
    `SELECT c.visit_id,count(*)::integer AS count FROM clinical_events c WHERE c.hospital_id=$1 AND c.visit_id=ANY($2::uuid[]) AND ${pendingPredicate} GROUP BY c.visit_id`,
    [hospital, visits],
  );
  return new Map(rows.map((row) => [row.visit_id, row.count]));
}
// Read one current amendment and exact current review state per subject. History
// bodies never participate in a visit read or write, regardless of ledger size.
export async function readClinicalDetail(
  client: pg.PoolClient,
  hospital: string,
  visit: string,
  role: StaffRole,
  subjectId?: string,
): Promise<ClinicalDetail> {
  const kinds =
    role === 'admin' || role === 'clinician'
      ? ['note', 'result']
      : role === 'lab'
        ? ['result']
        : [];
  const { rows } = await client.query(
    `SELECT subject.kind,subject.id AS subject_id,last.version,
    amendment.id AS amendment_id,amendment.body,amendment.reason,created.version AS amendment_version,
    created.actor_id,created.actor_name,created.created_at,
    owner.owner_id,owner.owner_name,u.active,u.role,u.password_change_required,
    reviewed.actor_name AS reviewer_name,reviewed.created_at AS reviewed_at,
    original.actor_id AS original_actor_id,original.created_at AS original_at,author.display_name AS original_name,author.username AS original_username
    FROM outpatient_visits v
    CROSS JOIN LATERAL (
      SELECT 'note' AS kind,(item->>'id')::uuid AS id FROM jsonb_array_elements(v.data->'notes') item
      UNION ALL SELECT 'result',(item->>'id')::uuid FROM jsonb_array_elements(v.data->'orders') item
    ) subject
    CROSS JOIN LATERAL (SELECT version FROM clinical_events WHERE hospital_id=v.hospital_id AND visit_id=v.id AND kind=subject.kind AND subject_id=subject.id ORDER BY version DESC LIMIT 1) last
    CROSS JOIN LATERAL (SELECT * FROM clinical_events WHERE hospital_id=v.hospital_id AND visit_id=v.id AND kind=subject.kind AND subject_id=subject.id AND action IN ('note.amend','result.correct') ORDER BY version DESC LIMIT 1) created
    JOIN clinical_amendments amendment ON amendment.hospital_id=v.hospital_id AND amendment.id=created.amendment_id
    LEFT JOIN LATERAL (SELECT owner_id,owner_name FROM clinical_events WHERE hospital_id=v.hospital_id AND amendment_id=created.amendment_id AND owner_id IS NOT NULL ORDER BY version DESC LIMIT 1) owner ON true
    LEFT JOIN staff_users u ON u.hospital_id=v.hospital_id AND u.id=owner.owner_id
    LEFT JOIN LATERAL (SELECT actor_name,created_at FROM clinical_events WHERE hospital_id=v.hospital_id AND amendment_id=created.amendment_id AND action='result.review' ORDER BY version DESC LIMIT 1) reviewed ON true
    LEFT JOIN LATERAL (SELECT actor_id,created_at FROM audit_events WHERE hospital_id=v.hospital_id AND visit_id=v.id AND subject_id=subject.id AND (action='visit.note' OR (action='visit.advanceOrder' AND transition_to='released')) ORDER BY visit_revision LIMIT 1) original ON true
    LEFT JOIN staff_users author ON author.hospital_id=v.hospital_id AND author.id=original.actor_id
    WHERE v.hospital_id=$1 AND v.id=$2 AND subject.kind=ANY($3::text[]) AND ($4::uuid IS NULL OR subject.id=$4)
    ORDER BY subject.kind,subject.id`,
    [hospital, visit, kinds, subjectId ?? null],
  );
  const records: ClinicalRecord[] = rows.map((row) => ({
    kind: row.kind,
    subjectId: row.subject_id,
    version: row.version,
    latest: {
      id: row.amendment_id,
      body: row.body,
      reason: row.reason,
      version: row.amendment_version,
      actorId: row.actor_id,
      actorName: row.actor_name,
      at: row.created_at.toISOString(),
    },
    ...(row.original_actor_id
      ? {
          originalActor: {
            id: row.original_actor_id,
            username: row.original_username,
            currentName: row.original_name,
          },
          originalAt: row.original_at.toISOString(),
        }
      : {}),
    ...(row.kind === 'result'
      ? {
          review: {
            amendmentId: row.amendment_id,
            ownerId: row.owner_id,
            ownerName: row.owner_name,
            ownerActive:
              row.active &&
              !row.password_change_required &&
              ['admin', 'clinician'].includes(row.role),
            reviewed: Boolean(row.reviewed_at),
            ...(row.reviewed_at
              ? { reviewerName: row.reviewer_name, reviewedAt: row.reviewed_at.toISOString() }
              : {}),
          },
        }
      : {}),
  }));
  return {
    records,
    pendingReviews: subjectId
      ? records.filter((record) => record.review && !record.review.reviewed).length
      : ((await readClinicalCounts(client, hospital, [visit])).get(visit) ?? 0),
  };
}
export const pendingClinicalVisitTime = `(SELECT max(c.created_at) FROM clinical_events c WHERE c.hospital_id=v.hospital_id AND c.visit_id=v.id AND ${pendingPredicate})`;
export const assignedClinicalVisitPredicate = `EXISTS(SELECT 1 FROM clinical_events c WHERE c.hospital_id=v.hospital_id AND c.visit_id=v.id AND ${pendingPredicate}
  AND (SELECT owner_id FROM clinical_events owned WHERE owned.hospital_id=c.hospital_id AND owned.amendment_id=c.amendment_id AND owned.owner_id IS NOT NULL ORDER BY owned.version DESC LIMIT 1)=$6::uuid)`;
export async function readClinicalAssignments(
  client: pg.PoolClient,
  hospital: string,
  visits: string[],
): Promise<Map<string, ClinicalAssignment[]>> {
  const grouped = new Map<string, ClinicalAssignment[]>();
  if (!visits.length) return grouped;
  const { rows } = await client.query(
    `SELECT c.visit_id,c.subject_id,c.created_at,owner.owner_id,owner.owner_name,u.username,u.role FROM clinical_events c
    JOIN LATERAL (SELECT owner_id,owner_name FROM clinical_events WHERE hospital_id=c.hospital_id AND amendment_id=c.amendment_id AND owner_id IS NOT NULL ORDER BY version DESC LIMIT 1) owner ON true
    JOIN staff_users u ON u.hospital_id=c.hospital_id AND u.id=owner.owner_id
    WHERE c.hospital_id=$1 AND c.visit_id=ANY($2::uuid[]) AND ${pendingPredicate} ORDER BY c.created_at DESC,c.id`,
    [hospital, visits],
  );
  for (const row of rows) {
    const values = grouped.get(row.visit_id) ?? [];
    values.push({
      subjectId: row.subject_id,
      correctedAt: row.created_at.toISOString(),
      ownerId: row.owner_id,
      ownerName: row.owner_name,
      ownerUsername: row.username,
      ownerRole: row.role,
    });
    grouped.set(row.visit_id, values);
  }
  return grouped;
}
const historyQuery = z
  .strictObject({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    kind: z.enum(['note', 'result']).optional(),
    subjectId: clinicalUuid.optional(),
  })
  .refine((value) => Boolean(value.kind) === Boolean(value.subjectId));
export async function readClinicalHistory(
  client: pg.PoolClient,
  hospital: string,
  visit: string,
  role: StaffRole,
  page: number,
  kind?: string,
  subjectId?: string,
): Promise<ClinicalHistoryPage> {
  const kinds = kind ? [kind] : role === 'lab' ? ['result'] : ['note', 'result'];
  const args = [hospital, visit, kinds, subjectId ?? null];
  const where =
    'e.hospital_id=$1 AND e.visit_id=$2 AND e.kind=ANY($3::text[]) AND ($4::uuid IS NULL OR e.subject_id=$4)';
  const {
    rows: [count],
  } = await client.query(
    `SELECT count(*)::integer AS total FROM clinical_events e WHERE ${where}`,
    args,
  );
  const narrative = role !== 'auditor';
  const { rows } = await client.query(
    `SELECT e.id,e.amendment_id,e.kind,e.subject_id,e.version,e.action,e.actor_id,e.actor_name,e.created_at,e.owner_id,e.owner_name,
    ${narrative ? 'e.reason,a.body,a.reason AS amendment_reason' : 'NULL AS reason,NULL AS body,NULL AS amendment_reason'}
    FROM clinical_events e ${narrative ? 'LEFT JOIN clinical_amendments a ON a.hospital_id=e.hospital_id AND a.id=e.id' : ''}
    WHERE ${where} ORDER BY e.created_at DESC,e.id DESC LIMIT 25 OFFSET $5`,
    [...args, (page - 1) * 25],
  );
  return {
    events: rows.map((row) => ({
      id: row.id,
      amendmentId: row.amendment_id,
      kind: row.kind,
      subjectId: row.subject_id,
      version: row.version,
      action: row.action,
      actorId: row.actor_id,
      actorName: row.actor_name,
      at: row.created_at.toISOString(),
      ...(row.reason ? { reason: row.reason } : {}),
      ...(row.owner_id ? { ownerId: row.owner_id, ownerName: row.owner_name } : {}),
      ...(row.body ? { amendment: { body: row.body, reason: row.amendment_reason } } : {}),
    })),
    total: count.total,
    page,
    pageSize: 25,
  };
}
export function registerClinicalRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  sessions: WeakMap<FastifyRequest, Session>,
) {
  async function transaction<T>(
    session: Session,
    write: boolean,
    roles: StaffRole[],
    work: (client: pg.PoolClient, actor: Record<string, any>) => Promise<T>,
  ) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SET LOCAL statement_timeout='10s'");
      await client.query(`SELECT id FROM hospitals WHERE id=$1 FOR ${write ? 'UPDATE' : 'SHARE'}`, [
        session.user.hospital.id,
      ]);
      const actor = await currentActor(client, session);
      if (!actor || actor.password_change_required)
        throw new ApiError(401, 'UNAUTHENTICATED', 'Your session ended. Sign in again.');
      if (!roles.includes(actor.role)) throw forbidden();
      const result = await work(client, actor);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (['55P03', '57014', '40001', '40P01'].includes((error as { code?: string }).code ?? ''))
        throw new ApiError(
          503,
          'CLINICAL_BUSY',
          'Clinical records are temporarily busy. Retry the exact same request.',
        );
      throw error;
    } finally {
      client.release();
    }
  }
  app.get('/api/clinical/reviewers', async (request) => {
    if (!empty.safeParse(request.query).success) throw invalid();
    const session = sessions.get(request)!;
    return transaction(session, false, ['admin', 'clinician', 'lab'], async (client) => {
      const { rows } = await client.query(
        "SELECT id,display_name,username,role FROM staff_users WHERE hospital_id=$1 AND active AND NOT password_change_required AND role IN ('admin','clinician') ORDER BY display_name,id",
        [session.user.hospital.id],
      );
      return {
        reviewers: rows.map((row) => ({
          id: row.id,
          name: row.display_name,
          username: row.username,
          role: row.role,
        })),
      };
    });
  });
  app.get<{ Params: { id: string } }>('/api/visits/:id/clinical', async (request) => {
    if (!empty.safeParse(request.query).success) throw invalid();
    const id = clinicalUuid.safeParse(request.params.id);
    if (!id.success) throw missing();
    const session = sessions.get(request)!;
    const hospital = session.user.hospital.id;
    return transaction(session, false, ['admin', 'clinician', 'lab', 'auditor'], async (client) => {
      if (
        !(
          await client.query('SELECT 1 FROM outpatient_visits WHERE hospital_id=$1 AND id=$2', [
            hospital,
            id.data,
          ])
        ).rowCount
      )
        throw missing();
      return readClinicalDetail(client, hospital, id.data, session.user.role);
    });
  });
  app.get<{ Params: { id: string } }>('/api/visits/:id/clinical/history', async (request) => {
    const query = historyQuery.safeParse(request.query);
    if (!query.success) throw invalid();
    const id = clinicalUuid.safeParse(request.params.id);
    if (!id.success) throw missing();
    const session = sessions.get(request)!;
    const hospital = session.user.hospital.id;
    return transaction(session, false, ['admin', 'clinician', 'lab', 'auditor'], async (client) => {
      if (session.user.role === 'lab' && query.data.kind === 'note') throw forbidden();
      if (
        !(
          await client.query('SELECT 1 FROM outpatient_visits WHERE hospital_id=$1 AND id=$2', [
            hospital,
            id.data,
          ])
        ).rowCount
      )
        throw missing();
      return readClinicalHistory(
        client,
        hospital,
        id.data,
        session.user.role,
        query.data.page,
        query.data.kind,
        query.data.subjectId,
      );
    });
  });
  app.post<{ Params: { id: string } }>(
    '/api/visits/:id/clinical/commands',
    { bodyLimit: 32768 },
    async (request) => {
      const parsed = clinicalCommandSchema.safeParse(request.body);
      const key = clinicalUuid.safeParse(request.headers['idempotency-key']);
      if (!parsed.success || !key.success || !empty.safeParse(request.query).success)
        throw invalid();
      const id = clinicalUuid.safeParse(request.params.id);
      if (!id.success) throw missing();
      const command = parsed.data;
      const session = sessions.get(request)!;
      const hospital = session.user.hospital.id;
      const hash = digest(JSON.stringify({ actor: session.user.id, visit: id.data, command }));
      const roles: StaffRole[] =
        command.type === 'result.correct' ? ['admin', 'lab'] : ['admin', 'clinician'];
      return transaction(session, true, roles, async (client, actor): Promise<ClinicalResult> => {
        const {
          rows: [visit],
        } = await client.query<{ data: Visit }>(
          'SELECT data FROM outpatient_visits WHERE hospital_id=$1 AND id=$2',
          [hospital, id.data],
        );
        if (!visit) throw missing();
        const {
          rows: [prior],
        } = await client.query(
          'SELECT payload_hash,result FROM clinical_requests WHERE hospital_id=$1 AND idempotency_key=$2',
          [hospital, key.data],
        );
        if (prior) {
          if (prior.payload_hash !== hash)
            throw new ApiError(
              409,
              'IDEMPOTENCY_CONFLICT',
              'This retry key was already used for different details.',
            );
          return prior.result;
        }
        const kind = command.type === 'note.amend' ? 'note' : 'result';
        const target =
          kind === 'note'
            ? visit.data.notes.find((note) => note.id === command.subjectId)
            : visit.data.orders.find((order) => order.id === command.subjectId);
        if (!target) throw missing();
        if (
          kind === 'result' &&
          !['released', 'reviewed'].includes((target as Visit['orders'][number]).status)
        )
          throw new ApiError(
            409,
            'RESULT_NOT_RELEASED',
            'Only a released result can be corrected or acknowledged.',
          );
        const detail = await readClinicalDetail(
          client,
          hospital,
          id.data,
          actor.role,
          command.subjectId,
        );
        const record = detail.records.find((record) => record.subjectId === command.subjectId);
        if ((record?.version ?? 0) !== command.expectedVersion) throw stale();
        const eventId = randomUUID();
        const version = command.expectedVersion + 1;
        let amendmentId: string;
        let owner: { id: string; display_name: string } | undefined;
        if (command.type === 'note.amend' || command.type === 'result.correct') {
          amendmentId = eventId;
          if (command.type === 'result.correct') {
            const {
              rows: [selected],
            } = await client.query(
              "SELECT id,display_name FROM staff_users WHERE hospital_id=$1 AND id=$2 AND active AND NOT password_change_required AND role IN ('admin','clinician')",
              [hospital, command.ownerId],
            );
            if (!selected)
              throw new ApiError(
                409,
                'REVIEWER_UNAVAILABLE',
                'Choose an active clinician or administrator to review this correction.',
              );
            owner = selected;
          }
          await client.query(
            'INSERT INTO clinical_amendments(id,hospital_id,visit_id,kind,subject_id,body,reason) VALUES($1,$2,$3,$4,$5,$6,$7)',
            [eventId, hospital, id.data, kind, command.subjectId, command.body, command.reason],
          );
        } else {
          if (!record?.review || record.review.amendmentId !== command.amendmentId) throw stale();
          if (record.review.reviewed)
            throw new ApiError(
              409,
              'ALREADY_REVIEWED',
              'This correction has already been reviewed.',
            );
          amendmentId = command.amendmentId;
          if (command.type === 'result.review') {
            if (record.review.ownerId !== actor.id)
              throw new ApiError(
                409,
                'REVIEW_OWNER_REQUIRED',
                'Take responsibility for this review with a reason before acknowledging it.',
              );
          } else {
            if (record.review.ownerId === actor.id)
              throw new ApiError(409, 'ALREADY_ASSIGNED', 'You already own this review.');
            owner = { id: actor.id, display_name: actor.display_name };
          }
        }
        await client.query(
          `INSERT INTO clinical_events(id,hospital_id,visit_id,kind,subject_id,amendment_id,version,action,actor_id,actor_name,owner_id,owner_name,reason)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            eventId,
            hospital,
            id.data,
            kind,
            command.subjectId,
            amendmentId,
            version,
            command.type,
            actor.id,
            actor.display_name,
            owner?.id ?? null,
            owner?.display_name ?? null,
            command.type === 'result.takeover' ? command.reason : null,
          ],
        );
        const result = { eventId, subjectId: command.subjectId, version };
        await client.query(
          'INSERT INTO clinical_requests(hospital_id,idempotency_key,actor_id,visit_id,payload_hash,result) VALUES($1,$2,$3,$4,$5,$6)',
          [hospital, key.data, actor.id, id.data, hash, result],
        );
        return result;
      });
    },
  );
}
