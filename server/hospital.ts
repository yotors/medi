import { exportColumns, exportOrder } from './hospital-export.ts';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import {
  hospitalCommandSchema,
  exportRequestSchema,
  patientExportSchema,
  type HospitalOverview,
} from '../shared/hospital.ts';
import type { Session } from '../shared/registration.ts';
import { currentActor, digest } from './auth.ts';
import { ApiError } from './app.ts';
import { withReportBudget } from './report-budget.ts';
const invalid = () => new ApiError(400, 'INVALID_REQUEST', 'Check the fields and retry.');
const missing = () => new ApiError(404, 'NOT_FOUND', 'The record was not found.');
const stale = () =>
  new ApiError(
    409,
    'STALE_REVISION',
    'The record changed. Refresh it before applying this change.',
  );
export function registerHospitalRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  sessions: WeakMap<FastifyRequest, Session>,
) {
  async function tx<T>(
    request: FastifyRequest,
    reply: FastifyReply,
    write: boolean,
    work: (c: pg.PoolClient, s: Session) => Promise<T>,
  ) {
    const s = sessions.get(request)!;
    return withReportBudget(pool, request, reply, async (c) => {
      await c.query('BEGIN');
      try {
        await c.query(`SELECT id FROM hospitals WHERE id=$1 FOR ${write ? 'UPDATE' : 'SHARE'}`, [
          s.user.hospital.id,
        ]);
        const actor = await currentActor(c, s);
        if (!actor || actor.password_change_required)
          throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in again.');
        if (!['admin', 'auditor'].includes(actor.role) || (write && actor.role !== 'admin'))
          throw new ApiError(
            403,
            'FORBIDDEN',
            'This action requires hospital administration permission.',
          );
        s.user.role = actor.role;
        const result = await work(c, s);
        await c.query('COMMIT');
        return result;
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    });
  }
  async function event(
    c: pg.PoolClient,
    s: Session,
    action: string,
    id: string | null,
    reason: string,
    snapshot: unknown,
  ) {
    await c.query(
      'INSERT INTO hospital_governance_events(id,hospital_id,actor_id,action,entity_id,reason,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [randomUUID(), s.user.hospital.id, s.user.id, action, id, reason, JSON.stringify(snapshot)],
    );
  }
  app.get('/api/hospital/appearance', async (request, reply) => {
    if (!z.strictObject({}).safeParse(request.query).success) throw invalid();
    const s = sessions.get(request)!;
    return withReportBudget(pool, request, reply, async (c) => {
      await c.query('BEGIN');
      try {
        await c.query('SELECT id FROM hospitals WHERE id=$1 FOR SHARE', [s.user.hospital.id]);
        const actor = await currentActor(c, s);
        if (!actor || actor.password_change_required)
          throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in again.');
        const settings =
          (
            await c.query('SELECT settings FROM hospital_profiles WHERE hospital_id=$1', [
              s.user.hospital.id,
            ])
          ).rows[0]?.settings ?? {};
        await c.query('COMMIT');
        return {
          locale: settings.locale === 'am-ET' ? 'am-ET' : 'en-ET',
          calendar: settings.calendar === 'ethiopic' ? 'ethiopic' : 'gregory',
          timezone: 'Africa/Addis_Ababa',
        };
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    });
  });
  app.get('/api/hospital', async (request, reply) => {
    if (!z.strictObject({}).safeParse(request.query).success) throw invalid();
    return tx(request, reply, false, async (c, s): Promise<HospitalOverview> => {
      const h = s.user.hospital.id;
      const profile = (
        await c.query(
          "SELECT h.name,COALESCE(p.revision,1) revision,COALESCE(p.settings,'{}'::jsonb) settings FROM hospitals h LEFT JOIN hospital_profiles p ON p.hospital_id=h.id WHERE h.id=$1",
          [h],
        )
      ).rows[0];
      const facilities = (
        await c.query(
          'SELECT * FROM hospital_facilities WHERE hospital_id=$1 ORDER BY code LIMIT 250',
          [h],
        )
      ).rows;
      const requests = (
        await c.query(
          'SELECT id,patient_id,requester,purpose,identity_verification,created_at,status,revision FROM hospital_record_requests WHERE hospital_id=$1 ORDER BY created_at DESC,id LIMIT 100',
          [h],
        )
      ).rows;
      const holds = (
        await c.query(
          'SELECT * FROM hospital_record_holds WHERE hospital_id=$1 ORDER BY active DESC,id LIMIT 100',
          [h],
        )
      ).rows;
      const support = (
        await c.query(
          'SELECT g.user_id,u.username,g.purpose,g.expires_at,g.revoked FROM hospital_support_grants g JOIN staff_users u ON u.id=g.user_id AND u.hospital_id=g.hospital_id WHERE g.hospital_id=$1 ORDER BY g.expires_at DESC LIMIT 100',
          [h],
        )
      ).rows;
      const staff = (
        await c.query(
          'SELECT id,display_name AS "displayName",username FROM staff_users WHERE hospital_id=$1 AND role=\'auditor\' AND active ORDER BY display_name,id LIMIT 250',
          [h],
        )
      ).rows;
      await event(c, s, 'governance.read', null, 'Hospital governance workspace accessed', {
        facilities: facilities.length,
      });
      return { profile, facilities, requests, holds, support, staff };
    });
  });
  app.post('/api/hospital/commands', { bodyLimit: 16384 }, async (request, reply) => {
    const parsed = hospitalCommandSchema.safeParse(request.body),
      key = z.uuid().safeParse(request.headers['idempotency-key']);
    if (!parsed.success || !key.success || !z.strictObject({}).safeParse(request.query).success)
      throw invalid();
    const cmd = parsed.data,
      hash = digest(JSON.stringify(cmd));
    return tx(request, reply, true, async (c, s) => {
      const h = s.user.hospital.id,
        u = s.user.id;
      const prior = (
        await c.query(
          'SELECT * FROM hospital_governance_requests WHERE hospital_id=$1 AND idempotency_key=$2',
          [h, key.data],
        )
      ).rows[0];
      if (prior) {
        if (prior.actor_id !== u || prior.request_hash !== hash)
          throw new ApiError(409, 'KEY_REUSE', 'Retry the unchanged original request.');
        return prior.response;
      }
      let result: Record<string, unknown> = {};
      let entity: string | null = null;
      if (cmd.type === 'profile.update') {
        const current = (
          await c.query('SELECT revision FROM hospital_profiles WHERE hospital_id=$1', [h])
        ).rows[0];
        if ((current?.revision ?? 1) !== cmd.expectedRevision) throw stale();
        const settings = {
          phone: cmd.phone,
          address: cmd.address,
          timezone: cmd.timezone,
          locale: cmd.locale,
          calendar: cmd.calendar,
        };
        await c.query('UPDATE hospitals SET name=$2 WHERE id=$1', [h, cmd.name]);
        result = (
          await c.query(
            'INSERT INTO hospital_profiles(hospital_id,revision,settings) VALUES($1,$2,$3) ON CONFLICT(hospital_id) DO UPDATE SET revision=EXCLUDED.revision,settings=EXCLUDED.settings RETURNING *',
            [h, cmd.expectedRevision + 1, settings],
          )
        ).rows[0];
        entity = h;
      } else if (cmd.type === 'facility.create') {
        entity = randomUUID();
        if (
          (
            await c.query('SELECT 1 FROM hospital_facilities WHERE hospital_id=$1 AND code=$2', [
              h,
              cmd.code,
            ])
          ).rowCount
        )
          throw new ApiError(409, 'DUPLICATE_CODE', 'This facility code is already used.');
        result = (
          await c.query(
            'INSERT INTO hospital_facilities(id,hospital_id,code,name,address) VALUES($1,$2,$3,$4,$5) RETURNING *',
            [entity, h, cmd.code, cmd.name, cmd.address],
          )
        ).rows[0];
      } else if (cmd.type === 'facility.update') {
        entity = cmd.id;
        const row = (
          await c.query('SELECT * FROM hospital_facilities WHERE hospital_id=$1 AND id=$2', [
            h,
            entity,
          ])
        ).rows[0];
        if (!row) throw missing();
        if (row.revision !== cmd.expectedRevision) throw stale();
        result = (
          await c.query(
            'UPDATE hospital_facilities SET name=$3,address=$4,active=$5,revision=revision+1 WHERE hospital_id=$1 AND id=$2 RETURNING *',
            [h, entity, cmd.name, cmd.address, cmd.active],
          )
        ).rows[0];
      } else if (cmd.type === 'record.request' || cmd.type === 'hold.place') {
        if (
          !(
            await c.query('SELECT 1 FROM patients WHERE hospital_id=$1 AND id=$2', [
              h,
              cmd.patientId,
            ])
          ).rowCount
        )
          throw missing();
        entity = randomUUID();
        if (cmd.type === 'record.request')
          result = (
            await c.query(
              "INSERT INTO hospital_record_requests(id,hospital_id,patient_id,requester,purpose,identity_verification,status) VALUES($1,$2,$3,$4,$5,$6,'pending') RETURNING id,status,revision",
              [entity, h, cmd.patientId, cmd.requester, cmd.purpose, cmd.identityVerification],
            )
          ).rows[0];
        else
          result = (
            await c.query(
              'INSERT INTO hospital_record_holds(id,hospital_id,patient_id,reason) VALUES($1,$2,$3,$4) RETURNING *',
              [entity, h, cmd.patientId, cmd.reason],
            )
          ).rows[0];
      } else if (cmd.type === 'record.decide' || cmd.type === 'hold.release') {
        entity = cmd.id;
        const table =
          cmd.type === 'record.decide' ? 'hospital_record_requests' : 'hospital_record_holds';
        const row = (
          await c.query(`SELECT * FROM ${table} WHERE hospital_id=$1 AND id=$2`, [h, entity])
        ).rows[0];
        if (!row) throw missing();
        if (row.revision !== cmd.expectedRevision) throw stale();
        if (cmd.type === 'record.decide') {
          if (row.status !== 'pending') throw stale();
          result = (
            await c.query(
              'UPDATE hospital_record_requests SET status=$3,revision=revision+1 WHERE hospital_id=$1 AND id=$2 RETURNING id,status,revision',
              [h, entity, cmd.status],
            )
          ).rows[0];
        } else {
          if (!row.active) throw stale();
          result = (
            await c.query(
              'UPDATE hospital_record_holds SET active=false,revision=revision+1 WHERE hospital_id=$1 AND id=$2 RETURNING *',
              [h, entity],
            )
          ).rows[0];
        }
      } else {
        entity = cmd.accountId;
        const account = (
          await c.query('SELECT * FROM staff_users WHERE hospital_id=$1 AND id=$2', [h, entity])
        ).rows[0];
        if (!account) throw missing();
        if (account.role !== 'auditor' || !account.active || entity === u)
          throw new ApiError(
            409,
            'INVALID_SUPPORT_ACCOUNT',
            'Use a separate active named auditor account.',
          );
        if (cmd.type === 'support.grant') {
          await c.query(
            'UPDATE staff_users SET support_account=true WHERE hospital_id=$1 AND id=$2',
            [h, entity],
          );
          result = (
            await c.query(
              "INSERT INTO hospital_support_grants(hospital_id,user_id,approved_by,purpose,expires_at) VALUES($1,$2,$3,$4,clock_timestamp()+$5*interval '1 minute') ON CONFLICT(user_id) DO UPDATE SET approved_by=EXCLUDED.approved_by,purpose=EXCLUDED.purpose,expires_at=EXCLUDED.expires_at,revoked=false RETURNING user_id,expires_at,revoked",
              [h, entity, u, cmd.reason, cmd.durationMinutes],
            )
          ).rows[0];
        } else {
          await c.query(
            'UPDATE hospital_support_grants SET revoked=true WHERE hospital_id=$1 AND user_id=$2',
            [h, entity],
          );
          result = { revoked: true };
        }
        await c.query('DELETE FROM staff_sessions WHERE user_id=$1', [entity]);
      }
      await event(c, s, cmd.type, entity, cmd.reason, result);
      await c.query('INSERT INTO hospital_governance_requests VALUES($1,$2,$3,$4,$5)', [
        h,
        key.data,
        u,
        hash,
        result,
      ]);
      return result;
    });
  });
  app.post('/api/hospital/export', async (request, reply) => {
    const parsed = exportRequestSchema.safeParse(request.body);
    if (!parsed.success || !z.strictObject({}).safeParse(request.query).success) throw invalid();
    return tx(request, reply, false, async (c, s) => {
      if (s.user.role !== 'admin')
        throw new ApiError(403, 'FORBIDDEN', 'Only a hospital administrator may export records.');
      const { table, page, purpose } = parsed.data;
      const rows = (
        await c.query(
          `SELECT ${exportColumns[table]} FROM ${table} r WHERE hospital_id=$1 ORDER BY ${exportOrder(table)} LIMIT 251 OFFSET $2`,
          [s.user.hospital.id, (page - 1) * 250],
        )
      ).rows;
      if (Buffer.byteLength(JSON.stringify(rows)) > 2_000_000)
        throw new ApiError(413, 'EXPORT_TOO_LARGE', 'Use a smaller governed patient export.');
      await event(c, s, 'organization.export', null, purpose, {
        table,
        page,
        count: Math.min(250, rows.length),
      });
      return {
        format: 'medi-json-v1',
        hospital: s.user.hospital.code,
        table,
        page,
        pageSize: 250,
        hasMore: rows.length > 250,
        records: rows.slice(0, 250),
        exportedAt: new Date().toISOString(),
      };
    });
  });
  app.post('/api/hospital/record-export', async (request, reply) => {
    const parsed = patientExportSchema.safeParse(request.body);
    if (!parsed.success || !z.strictObject({}).safeParse(request.query).success) throw invalid();
    return tx(request, reply, true, async (c, s) => {
      const h = s.user.hospital.id;
      const record = (
        await c.query(
          "SELECT * FROM hospital_record_requests WHERE hospital_id=$1 AND id=$2 AND status IN('approved','fulfilled')",
          [h, parsed.data.requestId],
        )
      ).rows[0];
      if (!record) throw missing();
      const { page } = parsed.data;
      const aliases = (
        await c.query(
          'WITH RECURSIVE identities(id) AS (SELECT $2::uuid UNION SELECT CASE WHEN l.duplicate_id=i.id THEN l.canonical_id ELSE l.duplicate_id END FROM care_identity_links l JOIN identities i ON l.duplicate_id=i.id OR l.canonical_id=i.id WHERE l.hospital_id=$1) SELECT id FROM identities',
          [h, record.patient_id],
        )
      ).rows.map((r) => r.id);
      const visitScope =
        'SELECT id FROM outpatient_visits WHERE hospital_id=$1 AND patient_id=ANY($2::uuid[])';
      const invoiceScope = `SELECT id FROM billing_invoices WHERE hospital_id=$1 AND visit_id IN (${visitScope})`;
      const paymentScope = `SELECT id FROM billing_payments WHERE hospital_id=$1 AND invoice_id IN (${invoiceScope})`;
      const careScope =
        'SELECT id FROM care_records WHERE hospital_id=$1 AND patient_id=ANY($2::uuid[])';
      const dispenseScope = `SELECT id FROM inventory_dispenses WHERE hospital_id=$1 AND authorization_id IN (SELECT id FROM inventory_authorizations WHERE hospital_id=$1 AND visit_id IN (${visitScope}))`;
      const departmentScope = `SELECT record_id FROM department_links WHERE hospital_id=$1 AND (visit_id IN (${visitScope}) OR dispense_id IN (${dispenseScope}))`;
      const inventoryScope = `SELECT id FROM inventory_events WHERE hospital_id=$1 AND (visit_id IN (${visitScope}) OR snapshot->>'departmentRecordId' IN (SELECT id::text FROM department_records WHERE hospital_id=$1 AND kind='return' AND id IN (${departmentScope})))`;
      const scopes: Partial<Record<keyof typeof exportColumns, string>> = {
        patients: 'r.id=ANY($2::uuid[])',
        outpatient_visits: 'r.patient_id=ANY($2::uuid[])',
        audit_events: 'r.patient_id=ANY($2::uuid[])',
        care_records: 'r.patient_id=ANY($2::uuid[])',
        care_events: `r.record_id IN (${careScope})`,
        care_identity_links: 'r.duplicate_id=ANY($2::uuid[]) AND r.canonical_id=ANY($2::uuid[])',
        clinical_amendments: `r.visit_id IN (${visitScope})`,
        clinical_events: `r.visit_id IN (${visitScope})`,
        billing_invoices: `r.visit_id IN (${visitScope})`,
        billing_lines: `r.invoice_id IN (${invoiceScope})`,
        billing_payments: `r.invoice_id IN (${invoiceScope})`,
        billing_events: `r.invoice_id IN (${invoiceScope})`,
        billing_receipts: `r.payment_id IN (${paymentScope})`,
        inventory_authorizations: `r.visit_id IN (${visitScope})`,
        inventory_events: `r.id IN (${inventoryScope})`,
        inventory_dispenses: `r.authorization_id IN (SELECT id FROM inventory_authorizations WHERE hospital_id=$1 AND visit_id IN (${visitScope}))`,
        inventory_movements: `r.id IN (${inventoryScope})`,
        department_records: `r.id IN (${departmentScope})`,
        department_links: `r.record_id IN (${departmentScope})`,
        department_events: `r.entity_id IN (${departmentScope})`,
        department_finance: `r.invoice_id IN (${invoiceScope})`,
        department_allocations: `r.payment_id IN (${paymentScope}) OR r.refund_id IN (SELECT id FROM department_finance WHERE hospital_id=$1 AND invoice_id IN (${invoiceScope}))`,
      };
      const collections: Record<string, unknown[]> = {},
        hasMore: Record<string, boolean> = {};
      for (const [name, scope] of Object.entries(scopes)) {
        const table = name as keyof typeof exportColumns;
        const rows = (
          await c.query(
            `SELECT ${exportColumns[table]
              .split(',')
              .map((col) => 'r.' + col)
              .join(
                ',',
              )} FROM ${table} r WHERE r.hospital_id=$1 AND (${scope}) ORDER BY ${exportOrder(table)} LIMIT 251 OFFSET $3`,
            [h, aliases, (page - 1) * 250],
          )
        ).rows;
        collections[table] = rows.slice(0, 250);
        hasMore[table] = rows.length > 250;
      }
      if (Buffer.byteLength(JSON.stringify(collections)) > 2_000_000)
        throw new ApiError(
          413,
          'EXPORT_TOO_LARGE',
          'This chunk exceeds the export limit. Contact hospital administration to arrange a governed database extraction.',
        );
      await c.query(
        "UPDATE hospital_record_requests SET status='fulfilled',revision=revision+1 WHERE hospital_id=$1 AND id=$2 AND status='approved'",
        [h, record.id],
      );
      await event(c, s, 'record.export', record.id, parsed.data.reason, {
        patientId: record.patient_id,
        page,
        hasMore,
      });
      return {
        format: 'medi-patient-v2',
        originalPatientId: record.patient_id,
        collections,
        page,
        pageSize: 250,
        hasMore,
        exportedAt: new Date().toISOString(),
        consistency: 'Live governed chunks; not a point-in-time recovery snapshot',
      };
    });
  });
  app.get('/api/hospital/history', async (request, reply) => {
    const query = z
      .strictObject({ page: z.coerce.number().int().min(1).max(10000).default(1) })
      .safeParse(request.query);
    if (!query.success) throw invalid();
    return tx(request, reply, false, async (c, s) => ({
      events: (
        await c.query(
          'SELECT id,actor_id,action,entity_id,reason,created_at FROM hospital_governance_events WHERE hospital_id=$1 ORDER BY created_at DESC,id LIMIT 50 OFFSET $2',
          [s.user.hospital.id, (query.data.page - 1) * 50],
        )
      ).rows,
      page: query.data.page,
    }));
  });
}
