import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import {
  careSchemas,
  careWriteSchema,
  careSearchSchema,
  canReadCare,
  canWriteCare,
  type CareKind,
  type CareRecord,
} from '../shared/care.ts';
import type { Session } from '../shared/registration.ts';
import { ApiError } from './app.ts';
import { currentActor, digest } from './auth.ts';
import { withReportBudget } from './report-budget.ts';
import { execute } from '../shared/visit-domain.ts';
const empty = z.strictObject({});
const invalid = () =>
  new ApiError(400, 'INVALID_REQUEST', 'Check the entered values and try again.');
const missing = () => new ApiError(404, 'NOT_FOUND', 'The requested care record was not found.');
const conflict = (message: string) => new ApiError(409, 'CARE_CONFLICT', message);
type Row = {
  id: string;
  kind: CareKind;
  patient_id: string | null;
  parent_id: string | null;
  revision: number;
  data: Record<string, any>;
  actor_name: string;
  created_at: Date;
  updated_at: Date;
  patient_name?: string;
  record_number?: string;
};
const select = `SELECT c.*,p.name AS patient_name,p.record_number FROM care_records c LEFT JOIN patient_directory p ON p.hospital_id=c.hospital_id AND p.id=c.patient_id`;
function view(r: Row): CareRecord {
  return {
    id: r.id,
    kind: r.kind,
    patientId: r.patient_id,
    parentId: r.parent_id,
    revision: r.revision,
    data: r.data as CareRecord['data'],
    actorName: r.actor_name,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    ...(r.patient_id
      ? { patient: { id: r.patient_id, name: r.patient_name!, recordNumber: r.record_number! } }
      : {}),
  };
}
export function registerCareRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  sessions: WeakMap<FastifyRequest, Session>,
) {
  async function transaction<T>(
    request: FastifyRequest,
    reply: FastifyReply,
    write: boolean,
    work: (c: pg.PoolClient, s: Session) => Promise<T>,
  ): Promise<T> {
    const s = sessions.get(request);
    if (!s) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in again.');
    try {
      return await withReportBudget(pool, request, reply, async (c) => {
        await c.query('BEGIN');
        await c.query("SET LOCAL lock_timeout='5s'");
        await c.query(`SELECT id FROM hospitals WHERE id=$1 FOR ${write ? 'UPDATE' : 'SHARE'}`, [
          s.user.hospital.id,
        ]);
        const actor = await currentActor(c, s);
        if (!actor || actor.password_change_required)
          throw new ApiError(401, 'UNAUTHENTICATED', 'Your session ended. Sign in again.');
        const result = await work(c, s);
        await c.query('COMMIT');
        return result;
      });
    } catch (e) {
      if (
        ['55P03', '57014', '40001', '40P01', '23505'].includes((e as { code?: string }).code ?? '')
      )
        throw (e as { code?: string }).code === '23505'
          ? conflict('This resource was already reserved. Reload before continuing.')
          : new ApiError(
              503,
              'CARE_BUSY',
              'The care workspace is busy. Retry the exact same request.',
            );
      throw e;
    }
  }
  const authorize = (s: Session, kind: CareKind, write = false, data?: Record<string, unknown>) => {
    if (!(write ? canWriteCare(s.user.role, kind, data) : canReadCare(s.user.role, kind)))
      throw new ApiError(403, 'FORBIDDEN', 'This account cannot perform this care action.');
  };
  const load = async (c: pg.PoolClient, h: string, id: string, kind?: CareKind) => {
    const {
      rows: [r],
    } = await c.query<Row>(`${select} WHERE c.hospital_id=$1 AND c.id=$2`, [h, id]);
    if (!r || (kind && r.kind !== kind)) throw missing();
    return r;
  };
  const patient = async (c: pg.PoolClient, h: string, id: string) => {
    const {
      rows: [p],
    } = await c.query('SELECT * FROM patient_directory WHERE hospital_id=$1 AND id=$2', [h, id]);
    if (!p) throw missing();
    return p;
  };
  const linked = async (c: pg.PoolClient, h: string, id: string): Promise<string[]> => {
    const { rows } = await c.query(
      `WITH RECURSIVE family(id) AS (SELECT $2::uuid UNION SELECT CASE WHEN l.duplicate_id=f.id THEN l.canonical_id ELSE l.duplicate_id END FROM care_identity_links l JOIN family f ON l.duplicate_id=f.id OR l.canonical_id=f.id WHERE l.hospital_id=$1) SELECT id FROM family`,
      [h, id],
    );
    return rows.map((r) => r.id);
  };
  const responsible = async (c: pg.PoolClient, h: string, id: string, clinician = false) => {
    const {
      rows: [u],
    } = await c.query('SELECT role FROM staff_users WHERE hospital_id=$1 AND id=$2 AND active', [
      h,
      id,
    ]);
    if (!u || (clinician && u.role !== 'clinician')) throw invalid();
  };
  app.get('/api/care/options', async (request, reply) => {
    if (!empty.safeParse(request.query).success) throw invalid();
    return transaction(request, reply, false, async (c, s) => {
      authorize(s, 'profile');
      const { rows } = await c.query(
        'SELECT id,display_name AS name,role FROM staff_users WHERE hospital_id=$1 AND active ORDER BY display_name,id LIMIT 500',
        [s.user.hospital.id],
      );
      return { staff: rows };
    });
  });
  app.post('/api/care/search', async (request, reply) => {
    const parsed = careSearchSchema.safeParse(request.body);
    if (!parsed.success || !empty.safeParse(request.query).success) throw invalid();
    return transaction(request, reply, false, async (c, s) => {
      const q = parsed.data,
        h = s.user.hospital.id;
      authorize(s, q.kind);
      const ids = q.patientId
        ? (await patient(c, h, q.patientId), await linked(c, h, q.patientId))
        : null;
      const where = `c.hospital_id=$1 AND c.kind=$2 AND ($3::uuid[] IS NULL OR c.patient_id=ANY($3)) AND ($4::uuid IS NULL OR c.parent_id=$4) AND (NOT $5 OR (c.data->>'start')::timestamptz >= (date_trunc('day',clock_timestamp() AT TIME ZONE 'Africa/Addis_Ababa') AT TIME ZONE 'Africa/Addis_Ababa') AND (c.data->>'start')::timestamptz < (date_trunc('day',clock_timestamp() AT TIME ZONE 'Africa/Addis_Ababa') AT TIME ZONE 'Africa/Addis_Ababa')+interval '1 day')`;
      if (q.today && q.kind !== 'appointment') throw invalid();
      const args = [h, q.kind, ids, q.parentId ?? null, q.today];
      const {
        rows: [count],
      } = await c.query(`SELECT count(*)::integer total FROM care_records c WHERE ${where}`, args);
      const { rows } = await c.query<Row>(
        `${select} WHERE ${where} ORDER BY c.updated_at DESC,c.id DESC LIMIT 25 OFFSET $6`,
        [...args, (q.page - 1) * 25],
      );
      // Reception sees admission registration fields only, never discharge narrative.
      const records = rows.map((r) => {
        const v = view(r);
        if (s.user.role === 'receptionist' && r.kind === 'admission')
          v.data = { ...r.data, summary: '', disposition: '', followUp: '' } as CareRecord['data'];
        return v;
      });
      return { records, total: count.total, page: q.page, pageSize: 25 };
    });
  });
  app.get<{ Params: { id: string } }>('/api/care/:id/history', async (request, reply) => {
    const query = z
      .strictObject({ page: z.coerce.number().int().min(1).max(10000).default(1) })
      .safeParse(request.query);
    if (!z.uuid().safeParse(request.params.id).success || !query.success) throw invalid();
    return transaction(request, reply, false, async (c, s) => {
      const r = await load(c, s.user.hospital.id, request.params.id);
      authorize(s, r.kind);
      if (s.user.role === 'receptionist' && r.kind === 'admission')
        throw new ApiError(403, 'FORBIDDEN', 'Clinical history requires clinical authority.');
      const { rows } = await c.query(
        `SELECT id,record_id AS "recordId",revision,actor_name AS "actorName",created_at AS "createdAt",reason,data FROM care_events WHERE hospital_id=$1 AND record_id=$2 ORDER BY revision DESC LIMIT 25 OFFSET $3`,
        [s.user.hospital.id, r.id, (query.data.page - 1) * 25],
      );
      return { events: rows, total: r.revision, page: query.data.page, pageSize: 25 };
    });
  });
  app.get<{ Params: { id: string } }>('/api/care/patients/:id/identity', async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success || !empty.safeParse(request.query).success)
      throw invalid();
    return transaction(request, reply, false, async (c, s) => {
      authorize(s, 'profile');
      const h = s.user.hospital.id;
      await patient(c, h, request.params.id);
      const ids = await linked(c, h, request.params.id);
      const { rows } = await c.query(
        `SELECT p.id,p.record_number AS "recordNumber",p.name,p.age,p.contact,p.created_at AS "createdAt",l.canonical_id AS "canonicalId",l.reason AS "linkReason" FROM patients p LEFT JOIN care_identity_links l ON l.hospital_id=p.hospital_id AND l.duplicate_id=p.id WHERE p.hospital_id=$1 AND p.id=ANY($2::uuid[]) ORDER BY p.created_at LIMIT 100`,
        [h, ids],
      );
      const visits = ['receptionist', 'pharmacist'].includes(s.user.role)
        ? []
        : (
            await c.query(
              `SELECT v.id,v.patient_id AS "patientId",p.record_number AS "recordNumber",p.name,v.status,v.opened_at AS "openedAt" FROM outpatient_visits v JOIN patient_directory p ON p.id=v.patient_id AND p.hospital_id=v.hospital_id WHERE v.hospital_id=$1 AND v.patient_id=ANY($2::uuid[]) ORDER BY v.opened_at DESC LIMIT 100`,
              [h, ids],
            )
          ).rows;
      return { identities: rows, visits };
    });
  });
  app.post('/api/care/identity-links', async (request, reply) => {
    const schema = z.strictObject({
        duplicateId: z.uuid(),
        canonicalId: z.uuid(),
        reason: z.string().trim().min(1).max(1000),
      }),
      p = schema.safeParse(request.body),
      k = z.uuid().safeParse(request.headers['idempotency-key']);
    if (!p.success || !k.success || !empty.safeParse(request.query).success) throw invalid();
    return transaction(request, reply, true, async (c, s) => {
      if (s.user.role !== 'admin')
        throw new ApiError(
          403,
          'FORBIDDEN',
          'Only hospital administrators may resolve duplicate identities.',
        );
      const h = s.user.hospital.id,
        d = p.data,
        hash = digest(JSON.stringify({ actor: s.user.id, ...d }));
      const {
        rows: [prior],
      } = await c.query('SELECT * FROM care_requests WHERE hospital_id=$1 AND idempotency_key=$2', [
        h,
        k.data,
      ]);
      if (prior) {
        if (prior.payload_hash !== hash)
          throw conflict('This retry key was used for different details.');
        return prior.result;
      }
      await patient(c, h, d.duplicateId);
      await patient(c, h, d.canonicalId);
      const family = await linked(c, h, d.duplicateId);
      if (family.includes(d.canonicalId))
        throw conflict('These identities are already linked. Self-links and cycles are forbidden.');
      if (
        (
          await c.query(
            'SELECT 1 FROM care_identity_links WHERE hospital_id=$1 AND duplicate_id=ANY($2::uuid[])',
            [h, [d.duplicateId, d.canonicalId]],
          )
        ).rowCount
      )
        throw conflict('Select an unresolved canonical identity.');
      const combined = [...family, ...(await linked(c, h, d.canonicalId))];
      const {
        rows: [active],
      } = await c.query(
        "SELECT count(*)::integer n FROM care_records WHERE hospital_id=$1 AND kind='admission' AND patient_id=ANY($2::uuid[]) AND data->>'status'='active'",
        [h, combined],
      );
      if (active.n > 1) throw conflict('Resolve conflicting active admissions first.');
      await c.query(
        'INSERT INTO care_identity_links(hospital_id,duplicate_id,canonical_id,actor_id,actor_name,reason) VALUES($1,$2,$3,$4,$5,$6)',
        [h, d.duplicateId, d.canonicalId, s.user.id, s.user.displayName, d.reason],
      );
      const result = { duplicateId: d.duplicateId, canonicalId: d.canonicalId };
      await c.query('INSERT INTO care_requests VALUES($1,$2,$3,$4,$5)', [
        h,
        k.data,
        s.user.id,
        hash,
        result,
      ]);
      return result;
    });
  });
  app.post('/api/care/records', { bodyLimit: 32768 }, async (request, reply) => {
    const p = careWriteSchema.safeParse(request.body),
      k = z.uuid().safeParse(request.headers['idempotency-key']);
    if (!p.success || !k.success || !empty.safeParse(request.query).success) throw invalid();
    const body = p.data,
      validation = careSchemas[body.kind].safeParse(body.data);
    if (!validation.success) throw invalid();
    const data = validation.data as Record<string, any>;
    return transaction(request, reply, true, async (c, s) => {
      const h = s.user.hospital.id;
      authorize(s, body.kind, true, data);
      const hash = digest(JSON.stringify({ actor: s.user.id, ...body, data }));
      const {
        rows: [prior],
      } = await c.query('SELECT * FROM care_requests WHERE hospital_id=$1 AND idempotency_key=$2', [
        h,
        k.data,
      ]);
      if (prior) {
        if (prior.payload_hash !== hash)
          throw conflict('This retry key was used for different details.');
        return prior.result;
      }
      const old = body.id ? await load(c, h, body.id, body.kind) : null;
      if ((old?.revision ?? 0) !== body.expectedRevision)
        throw new ApiError(
          409,
          'STALE_REVISION',
          'This record changed. Reload before saving your draft again.',
        );
      const patientId = body.patientId ?? old?.patient_id ?? null;
      if (old && body.patientId && body.patientId !== old.patient_id) throw invalid();
      if (!['ward', 'bed'].includes(body.kind)) {
        if (!patientId) throw invalid();
        await patient(c, h, patientId);
      } else if (patientId) throw invalid();
      let parent: string | null = null,
        owner: string | null = null,
        encounter: string | null = null;
      const checkParent = async (id: string, kind: CareKind, active = false) => {
        const r = await load(c, h, id, kind);
        if (r.patient_id && r.patient_id !== patientId) throw invalid();
        if (active && r.data.status !== 'active') throw conflict('The admission is closed.');
        return r;
      };
      if (body.kind === 'profile') {
        if (
          s.user.role === 'receptionist' &&
          (data.allergiesStatus !== (old?.data.allergiesStatus ?? 'not-entered') ||
            data.allergies !== (old?.data.allergies ?? ''))
        )
          throw new ApiError(
            403,
            'FORBIDDEN',
            'Only clinical staff may enter or amend allergy information.',
          );
        if (
          !old &&
          (
            await c.query(
              "SELECT 1 FROM care_records WHERE hospital_id=$1 AND patient_id=$2 AND kind='profile'",
              [h, patientId],
            )
          ).rowCount
        )
          throw conflict('Reload the current patient profile before correcting it.');
      }
      if (body.kind === 'bed') {
        parent = data.wardId;
        const w = await checkParent(parent!, 'ward');
        if (data.active && !w.data.active) throw conflict('Activate the ward first.');
      }
      if (
        body.kind === 'ward' &&
        old &&
        data.facility !== old.data.facility &&
        (
          await c.query(
            "SELECT 1 FROM care_records a JOIN care_records b ON b.hospital_id=a.hospital_id AND b.id=a.parent_id WHERE a.hospital_id=$1 AND b.parent_id=$2 AND a.kind='admission' AND a.data->>'status'='active'",
            [h, old.id],
          )
        ).rowCount
      )
        throw conflict('An occupied ward cannot change facility.');
      if (
        body.kind === 'ward' &&
        old &&
        !data.active &&
        (
          await c.query(
            "SELECT 1 FROM care_records WHERE hospital_id=$1 AND parent_id=$2 AND kind='bed' AND (data->>'active')::boolean",
            [h, old.id],
          )
        ).rowCount
      )
        throw conflict('Deactivate the ward beds first.');
      if (
        body.kind === 'bed' &&
        old &&
        (old.data.wardId !== data.wardId || !data.active) &&
        (
          await c.query(
            "SELECT 1 FROM care_records WHERE hospital_id=$1 AND parent_id=$2 AND kind='admission' AND data->>'status'='active'",
            [h, old.id],
          )
        ).rowCount
      )
        throw conflict('An occupied bed cannot be moved or deactivated.');
      if (body.kind === 'appointment') {
        owner = data.clinicianId;
        await responsible(c, h, owner!, true);
        if (
          old &&
          ['arrived', 'cancelled', 'no-show'].includes(old.data.status) &&
          JSON.stringify(old.data) !== JSON.stringify(data)
        )
          throw conflict('This appointment has finished. Book a new appointment.');
        if (!old && data.status !== 'booked') throw invalid();
        if (data.visitId && data.visitId !== old?.data.visitId) throw invalid();
        if (
          ['booked', 'arrived'].includes(data.status) &&
          (
            await c.query(
              "SELECT 1 FROM care_records WHERE hospital_id=$1 AND kind='appointment' AND responsible_id=$2 AND id<>$3 AND data->>'status' IN ('booked','arrived') AND (data->>'start')::timestamptz < $4::timestamptz AND (data->>'end')::timestamptz > $5::timestamptz",
              [h, owner, old?.id ?? randomUUID(), data.end, data.start],
            )
          ).rowCount
        )
          throw conflict('The clinician already has an overlapping appointment.');
        if (data.status === 'arrived') {
          if (
            (
              await c.query(
                'SELECT 1 FROM care_identity_links WHERE hospital_id=$1 AND duplicate_id=$2',
                [h, patientId],
              )
            ).rowCount
          )
            throw new ApiError(
              409,
              'IDENTITY_LINKED',
              'Open and verify the linked primary patient record before arrival.',
            );
          const {
            rows: [existing],
          } = await c.query(
            "SELECT id FROM outpatient_visits WHERE hospital_id=$1 AND patient_id=$2 AND status='active'",
            [h, patientId],
          );
          if (existing) data.visitId = existing.id;
          else {
            const p = await patient(c, h, patientId!);
            const state = execute(
              {
                version: 1,
                revision: 0,
                patients: [
                  {
                    id: p.id,
                    name: p.name,
                    contact: p.contact,
                    createdAt: p.created_at.toISOString(),
                    ...(p.age === null ? {} : { age: p.age }),
                  },
                ],
                visits: [],
                events: [],
              },
              { type: 'checkIn', patientId: p.id, financialMode: 'catalog' },
            );
            const v = state.visits[0];
            await c.query(
              'INSERT INTO outpatient_visits(id,hospital_id,patient_id,revision,status,opened_at,data) VALUES($1,$2,$3,$4,$5,$6,$7)',
              [v.id, h, p.id, state.revision, v.status, v.openedAt, v],
            );
            await c.query(
              "INSERT INTO audit_events(id,hospital_id,actor_id,patient_id,action,visit_id,visit_revision,detail,subject_type,subject_id,transition_to) VALUES($1,$2,$3,$4,'visit.checkIn',$5,$6,$7,'visit',$5,'active')",
              [
                randomUUID(),
                h,
                s.user.id,
                p.id,
                v.id,
                state.revision,
                'Appointment arrival check-in',
              ],
            );
            data.visitId = v.id;
          }
          encounter = data.visitId;
        }
      }
      if (body.kind === 'triage' && data.encounterId) {
        encounter = data.encounterId;
        const {
          rows: [v],
        } = await c.query(
          'SELECT patient_id FROM outpatient_visits WHERE hospital_id=$1 AND id=$2',
          [h, encounter],
        );
        if (!v || v.patient_id !== patientId) throw invalid();
      }
      if (body.kind === 'admission') {
        parent = data.bedId;
        owner = data.clinicianId;
        await responsible(c, h, owner!, true);
        const b = await checkParent(parent!, 'bed'),
          w = await checkParent(b.data.wardId, 'ward');
        if (!b.data.active || !w.data.active) throw conflict('Select an active bed and ward.');
        if (old?.data.status === 'discharged') throw conflict('The signed discharge is final.');
        if (!old && data.status !== 'active') throw invalid();
        if (old && data.bedId !== old.data.bedId) {
          const previous = await checkParent(old.data.bedId, 'bed'),
            previousWard = await checkParent(previous.data.wardId, 'ward');
          if (previousWard.data.facility !== w.data.facility)
            throw conflict('Transfers must stay within the admission facility.');
        }
        if (data.status === 'active') {
          const family = await linked(c, h, patientId!);
          if (
            (
              await c.query(
                "SELECT 1 FROM care_records WHERE hospital_id=$1 AND kind='admission' AND id<>$2 AND data->>'status'='active' AND (parent_id=$3 OR patient_id=ANY($4::uuid[]))",
                [h, old?.id ?? randomUUID(), parent, family],
              )
            ).rowCount
          )
            throw conflict('The bed or patient already has an active admission.');
        } else {
          if (
            !['clinician', 'admin'].includes(s.user.role) ||
            !data.summary ||
            !data.disposition ||
            !data.followUp
          )
            throw invalid();
          if (
            (
              await c.query(
                "SELECT 1 FROM care_records m WHERE m.hospital_id=$1 AND m.parent_id=$2 AND m.kind='medication' AND m.data->>'status'='ordered' AND NOT EXISTS(SELECT 1 FROM care_records a WHERE a.hospital_id=m.hospital_id AND a.parent_id=m.id AND a.kind='administration')",
                [h, old!.id],
              )
            ).rowCount
          )
            throw conflict(
              'Finish or cancel pending medication administration tasks before discharge.',
            );
        }
      }
      if (body.kind === 'nursing' || body.kind === 'medication') {
        parent = data.admissionId;
        await checkParent(parent!, 'admission', true);
        if (old && data.admissionId !== old.data.admissionId) throw invalid();
        if (body.kind === 'medication' && old && old.data.status !== 'ordered')
          throw conflict('This medication order is already stopped or cancelled.');
        if (body.kind === 'medication' && !old && data.status !== 'ordered') throw invalid();
        if (
          body.kind === 'medication' &&
          old &&
          (
            await c.query(
              "SELECT 1 FROM care_records WHERE hospital_id=$1 AND parent_id=$2 AND kind='administration'",
              [h, old.id],
            )
          ).rowCount
        )
          throw conflict('This medication task already has an accountable outcome.');
      }
      if (body.kind === 'administration') {
        parent = data.medicationId;
        const m = await checkParent(parent!, 'medication');
        await checkParent(m.data.admissionId, 'admission', !old);
        if (m.data.status !== 'ordered')
          throw conflict('This medication task is stopped or cancelled.');
        if (old && old.data.medicationId !== data.medicationId) throw invalid();
      }
      if (body.kind === 'referral') {
        owner = data.ownerId;
        await responsible(c, h, owner!);
        if (!old && data.status !== 'pending') throw invalid();
        if (old && old.data.status !== 'pending')
          throw conflict('This referral is complete or cancelled.');
      }
      const id = old?.id ?? randomUUID(),
        revision = (old?.revision ?? 0) + 1;
      if (old)
        await c.query(
          'UPDATE care_records SET revision=$3,data=$4,parent_id=$5,responsible_id=$6,encounter_id=$7,actor_id=$8,actor_name=$9,updated_at=clock_timestamp() WHERE hospital_id=$1 AND id=$2',
          [h, id, revision, data, parent, owner, encounter, s.user.id, s.user.displayName],
        );
      else
        await c.query(
          'INSERT INTO care_records(id,hospital_id,kind,patient_id,parent_id,responsible_id,encounter_id,revision,data,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [
            id,
            h,
            body.kind,
            patientId,
            parent,
            owner,
            encounter,
            revision,
            data,
            s.user.id,
            s.user.displayName,
          ],
        );
      await c.query(
        'INSERT INTO care_events(id,hospital_id,record_id,revision,actor_id,actor_name,reason,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [randomUUID(), h, id, revision, s.user.id, s.user.displayName, body.reason, data],
      );
      const result = { record: view(await load(c, h, id)) };
      await c.query('INSERT INTO care_requests VALUES($1,$2,$3,$4,$5)', [
        h,
        k.data,
        s.user.id,
        hash,
        result,
      ]);
      return result;
    });
  });
}
