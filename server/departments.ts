import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import {
  departmentCommandSchema,
  departmentSourceSchema,
  financialProjection,
} from '../shared/departments.ts';
import type { Session, StaffRole } from '../shared/registration.ts';
import { ApiError } from './app.ts';
import { currentActor, digest } from './auth.ts';
import { departmentSourceRoles, readDepartmentSources } from './department-sources.ts';
const uuid = z.uuid(),
  page = z.coerce.number().int().min(1).max(10000).default(1);
const fail = (message: string, status = 409) =>
  new ApiError(status, 'DEPARTMENT_CONFLICT', message);
const specKind = (type: string) =>
  type.startsWith('lab.')
    ? 'specimen'
    : type.startsWith('purchase.')
      ? 'purchase'
      : type.startsWith('return.')
        ? 'return'
        : 'shift';
const roles = (kind: string): StaffRole[] =>
  kind === 'catalog' || kind === 'specimen'
    ? ['admin', 'lab', 'clinician', 'auditor']
    : kind === 'shift' || kind === 'finance'
      ? ['admin', 'cashier', 'auditor']
      : ['admin', 'pharmacist', 'auditor'];
export function registerDepartmentRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  sessions: WeakMap<FastifyRequest, Session>,
) {
  async function tx<T>(
    session: Session,
    write: boolean,
    allowed: StaffRole[],
    work: (c: pg.PoolClient, a: any) => Promise<T>,
  ) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SET LOCAL lock_timeout='5s'");
      await c.query("SET LOCAL statement_timeout='10s'");
      await c.query(`SELECT id FROM hospitals WHERE id=$1 FOR ${write ? 'UPDATE' : 'SHARE'}`, [
        session.user.hospital.id,
      ]);
      const a = await currentActor(c, session);
      if (!a || a.password_change_required) throw fail('Sign in again.', 401);
      if (!allowed.includes(a.role)) throw fail('This role cannot perform this action.', 403);
      const result = await work(c, a);
      await c.query('COMMIT');
      return result;
    } catch (e) {
      await c.query('ROLLBACK');
      if (['55P03', '57014', '40001', '40P01'].includes((e as any).code))
        throw new ApiError(503, 'DEPARTMENTS_BUSY', 'Temporarily busy. Retry the same request.');
      throw e;
    } finally {
      c.release();
    }
  }
  async function record(c: pg.PoolClient, h: string, id: string, kind?: string) {
    const r = (
      await c.query('SELECT * FROM department_records WHERE hospital_id=$1 AND id=$2', [h, id])
    ).rows[0];
    if (!r || (kind && r.kind !== kind)) throw fail('Record not found.', 404);
    return r;
  }
  app.post('/api/departments/sources', { bodyLimit: 8192 }, async (req) => {
    const parsed = departmentSourceSchema.safeParse(req.body);
    if (!parsed.success || !z.strictObject({}).safeParse(req.query).success)
      throw fail('Check search fields.', 400);
    const session = sessions.get(req)!;
    return tx(session, false, departmentSourceRoles(parsed.data.kind), async (c, a) =>
      readDepartmentSources(c, session.user.hospital.id, a, parsed.data),
    );
  });
  app.get('/api/departments', async (req) => {
    const q = z
      .strictObject({
        kind: z.enum(['catalog', 'specimen', 'supplier', 'purchase', 'return', 'shift', 'finance']),
        page,
      })
      .safeParse(req.query);
    if (!q.success) throw fail('Invalid query.', 400);
    const query = q.data;
    const s = sessions.get(req)!;
    return tx(s, false, roles(query.kind), async (c) => {
      const h = s.user.hospital.id;
      const table = query.kind === 'finance' ? 'department_finance' : 'department_records';
      const where = query.kind === 'finance' ? 'hospital_id=$1' : 'hospital_id=$1 AND kind=$2';
      const args = query.kind === 'finance' ? [h] : [h, query.kind];
      const total = (
        await c.query(`SELECT count(*)::integer total FROM ${table} WHERE ${where}`, args)
      ).rows[0].total;
      const rows = (
        await c.query(
          `SELECT * FROM ${table} WHERE ${where} ORDER BY id LIMIT 25 OFFSET $${args.length + 1}`,
          [...args, (query.page - 1) * 25],
        )
      ).rows;
      return {
        entries: rows.map((r) =>
          query.kind === 'finance' ? { id: r.id, kind: 'finance', revision: 1, data: r } : r,
        ),
        page: query.page,
        pageSize: 25,
        total,
      };
    });
  });
  app.get<{ Params: { id: string } }>('/api/departments/:id/history', async (req) => {
    const ident = uuid.safeParse(req.params.id),
      query = z.strictObject({ page }).safeParse(req.query);
    if (!ident.success) throw fail('Record not found.', 404);
    if (!query.success) throw fail('Invalid query.', 400);
    const id = ident.data,
      q = query.data,
      s = sessions.get(req)!;
    return tx(
      s,
      false,
      ['admin', 'lab', 'clinician', 'pharmacist', 'cashier', 'auditor'],
      async (c, a) => {
        const h = s.user.hospital.id,
          r = await record(c, h, id);
        if (!roles(r.kind).includes(a.role)) throw fail('This role cannot read this history.', 403);
        const rows = (
          await c.query(
            'SELECT * FROM department_events WHERE hospital_id=$1 AND entity_id=$2 ORDER BY created_at DESC,id LIMIT 25 OFFSET $3',
            [h, id, (q.page - 1) * 25],
          )
        ).rows;
        return {
          entries: rows.map((e) => ({
            id: e.id,
            entityId: e.entity_id,
            action: e.action,
            actorId: e.actor_id,
            actorName: e.actor_name,
            at: e.created_at.toISOString(),
            snapshot: e.snapshot,
          })),
          page: q.page,
        };
      },
    );
  });
  app.post('/api/departments/commands', { bodyLimit: 32768 }, async (req) => {
    const parsed = departmentCommandSchema.safeParse(req.body),
      key = uuid.safeParse(req.headers['idempotency-key']);
    if (!parsed.success || !key.success || !z.strictObject({}).safeParse(req.query).success)
      throw fail('Check command fields.', 400);
    const cmd = parsed.data,
      s = sessions.get(req)!,
      h = s.user.hospital.id,
      hash = digest(JSON.stringify(cmd));
    const kind = cmd.type.startsWith('lab.')
      ? 'specimen'
      : cmd.type.startsWith('shift.')
        ? 'shift'
        : cmd.type.startsWith('invoice.') || cmd.type.startsWith('payment.')
          ? 'finance'
          : 'purchase';
    const admin = [
      'lab.catalog',
      'purchase.approve',
      'return.quality',
      'invoice.credit',
      'payment.refund',
      'shift.review',
    ].includes(cmd.type);
    const allowed: StaffRole[] = admin
      ? ['admin']
      : cmd.type === 'lab.acknowledge'
        ? ['admin', 'clinician']
        : roles(kind).filter((r) => r !== 'auditor' && !(kind === 'specimen' && r === 'clinician'));
    return tx(s, true, allowed, async (c, a) => {
      const prior = (
        await c.query(
          'SELECT * FROM department_requests WHERE hospital_id=$1 AND idempotency_key=$2',
          [h, key.data],
        )
      ).rows[0];
      if (prior) {
        if (prior.actor_id !== a.id || prior.payload_hash !== hash)
          throw fail('Retry key belongs to different details or actor.');
        return { ...prior.result, replayed: true };
      }
      let r: any,
        entity = randomUUID(),
        data: any = {},
        recordKind: string = kind;
      const eventId = randomUUID();
      if ('id' in cmd) {
        r = await record(c, h, cmd.id);
        if (!roles(r.kind).includes(a.role))
          throw fail('This role cannot change this record.', 403);
        if (r.kind !== specKind(cmd.type)) throw fail('Record kind does not match the command.');
        if (r.revision !== cmd.expectedRevision)
          throw fail('Record changed. Refresh and review the retained draft.');
        entity = r.id;
        recordKind = r.kind;
        data = { ...r.data };
      }
      const link = async (fields: Record<string, string>) => {
        const names = Object.keys(fields);
        await c.query(
          `INSERT INTO department_links(hospital_id,record_id,${names.join(',')}) VALUES($1,$2,${names.map((_, i) => '$' + (i + 3)).join(',')})`,
          [h, entity, ...Object.values(fields)],
        );
      };
      const movement = async (
        batchId: string,
        expected: number,
        quantity: number,
        reference: string,
      ) => {
        const b = (
          await c.query(
            `SELECT b.*,to_char(b.expiry,'YYYY-MM-DD') expiry_text,p.active,p.code,p.name,p.unit,coalesce((SELECT sum(quantity) FROM inventory_movements m WHERE m.hospital_id=b.hospital_id AND m.batch_id=b.id),0)::integer balance FROM inventory_batches b JOIN inventory_products p ON (p.hospital_id,p.id)=(b.hospital_id,b.product_id) WHERE b.hospital_id=$1 AND b.id=$2`,
            [h, batchId],
          )
        ).rows[0];
        if (!b) throw fail('Batch not found.', 404);
        if (b.revision !== expected) throw fail('Batch changed.');
        if (b.balance + quantity > 1000000000) throw fail('Stock limit exceeded.');
        const id = randomUUID();
        await c.query(
          "INSERT INTO inventory_events(id,hospital_id,action,product_id,batch_id,actor_id,actor_name,snapshot) VALUES($1,$2,'stock.receive',$3,$4,$5,$6,$7)",
          [
            id,
            h,
            b.product_id,
            b.id,
            a.id,
            a.display_name,
            {
              quantity,
              reference,
              departmentRecordId: entity,
              code: b.code,
              name: b.name,
              unit: b.unit,
              lot: b.lot,
              expiry: b.expiry_text,
              balance: b.balance + quantity,
            },
          ],
        );
        await c.query(
          "INSERT INTO inventory_movements(id,hospital_id,batch_id,kind,quantity) VALUES($1,$2,$3,'stock.receive',$4)",
          [id, h, b.id, quantity],
        );
        await c.query(
          'UPDATE inventory_batches SET revision=revision+1 WHERE hospital_id=$1 AND id=$2',
          [h, b.id],
        );
        return b;
      };
      switch (cmd.type) {
        case 'lab.catalog':
          if (
            cmd.criticalLow !== undefined &&
            cmd.criticalHigh !== undefined &&
            cmd.criticalLow >= cmd.criticalHigh
          )
            throw fail('Critical lower limit must be below upper limit.');
          if (
            (
              await c.query(
                "SELECT 1 FROM department_records WHERE hospital_id=$1 AND kind='catalog' AND lower(data->>'code')=lower($2)",
                [h, cmd.code],
              )
            ).rowCount
          )
            throw fail('Test code already exists.');
          recordKind = 'catalog';
          data = { ...cmd };
          break;
        case 'supplier.create':
          recordKind = 'supplier';
          data = { name: cmd.name, contact: cmd.contact };
          break;
        case 'lab.register': {
          const catalog = await record(c, h, cmd.catalogId, 'catalog');
          const visit = (
            await c.query('SELECT data FROM outpatient_visits WHERE hospital_id=$1 AND id=$2', [
              h,
              cmd.visitId,
            ])
          ).rows[0];
          const order = visit?.data.orders.find((o: any) => o.id === cmd.orderId);
          if (
            !visit ||
            visit.data.status !== 'active' ||
            !order ||
            !['requested', 'collected'].includes(order.status)
          )
            throw fail(
              'Register specimens only for active encounters and orders awaiting release.',
            );
          if (order.catalogId ? order.catalogId !== catalog.id : order.test !== catalog.data.name)
            throw fail('The configured test must match the ordered test.');
          const clinician = (
            await c.query(
              "SELECT id FROM staff_users WHERE hospital_id=$1 AND id=$2 AND role='clinician' AND active AND NOT password_change_required",
              [h, cmd.clinicianId],
            )
          ).rows[0];
          if (!clinician) throw fail('Active clinician not found.', 404);
          if (
            (
              await c.query(
                "SELECT 1 FROM department_records WHERE hospital_id=$1 AND kind='specimen' AND (data->>'accession'=$2 OR (data->>'visitId'=$3 AND data->>'orderId'=$4)) UNION ALL SELECT 1 FROM department_events WHERE hospital_id=$1 AND action IN ('lab.register','lab.recollect') AND snapshot->'command'->>'accession'=$2",
                [h, cmd.accession, cmd.visitId, cmd.orderId],
              )
            ).rowCount
          )
            throw fail('Accession or order already registered.');
          data = {
            catalog: catalog.data,
            catalogId: catalog.id,
            visitId: cmd.visitId,
            orderId: cmd.orderId,
            accession: cmd.accession,
            clinicianId: cmd.clinicianId,
            status: 'registered',
            versions: [],
            critical: false,
            review: 'none',
          };
          break;
        }
        case 'lab.collect':
          if (recordKind !== 'specimen' || data.status !== 'registered')
            throw fail('Only registered specimens can be collected.');
          data.status = 'collected';
          break;
        case 'lab.receive':
          if (recordKind !== 'specimen' || data.status !== 'collected')
            throw fail('Collect the specimen before receipt.');
          data.status = 'received';
          break;
        case 'lab.reject':
          if (
            recordKind !== 'specimen' ||
            !['registered', 'collected', 'received'].includes(data.status)
          )
            throw fail('This specimen cannot be rejected.');
          data.status = 'rejected';
          data.rejection = cmd.reason;
          break;
        case 'lab.recollect':
          if (recordKind !== 'specimen' || data.status !== 'rejected')
            throw fail('Only rejected specimens can be recollected.');
          if (
            (
              await c.query(
                "SELECT 1 FROM department_events WHERE hospital_id=$1 AND action IN ('lab.register','lab.recollect') AND snapshot->'command'->>'accession'=$2",
                [h, cmd.accession],
              )
            ).rowCount
          )
            throw fail('Accession already exists.');
          data.accession = cmd.accession;
          data.status = 'registered';
          break;
        case 'lab.result':
          if (
            recordKind !== 'specimen' ||
            !['received', 'result', 'released'].includes(data.status)
          )
            throw fail('A received specimen is required.');
          if ((data.versionCount ?? data.versions.length) && !cmd.reason)
            throw fail('A correction reason is required.');
          data.versionCount = (data.versionCount ?? data.versions.length) + 1;
          data.versions = [
            ...data.versions.slice(-24),
            {
              value: cmd.value,
              numericValue: cmd.numericValue,
              reason: cmd.reason,
              actorId: a.id,
              actorName: a.display_name,
              at: new Date().toISOString(),
            },
          ];
          data.status = 'result';
          data.critical =
            cmd.critical ||
            (cmd.numericValue !== undefined &&
              ((data.catalog.criticalLow !== undefined &&
                cmd.numericValue < data.catalog.criticalLow) ||
                (data.catalog.criticalHigh !== undefined &&
                  cmd.numericValue > data.catalog.criticalHigh)));
          data.review = data.critical || data.versionCount > 1 ? 'pending' : 'none';
          delete data.acknowledgement;
          break;
        case 'lab.release':
          if (recordKind !== 'specimen' || data.status !== 'result')
            throw fail('Enter a result on a received specimen before release.');
          data.status = 'released';
          break;
        case 'lab.acknowledge':
          if (
            recordKind !== 'specimen' ||
            data.status !== 'released' ||
            data.review !== 'pending' ||
            (a.role !== 'admin' && data.clinicianId !== a.id)
          )
            throw fail('Only the assigned clinician can acknowledge a pending released result.');
          data.review = 'closed';
          data.acknowledgement = {
            delivery: cmd.delivery,
            text: cmd.acknowledgement,
            actorId: a.id,
            at: new Date().toISOString(),
          };
          break;
        case 'purchase.create': {
          await record(c, h, cmd.supplierId, 'supplier');
          for (const line of cmd.lines) {
            const p = (
              await c.query(
                'SELECT unit,active FROM inventory_products WHERE hospital_id=$1 AND id=$2',
                [h, line.productId],
              )
            ).rows[0];
            if (!p || !p.active || p.unit !== line.unit)
              throw fail('Choose an active product and its configured unit.');
            if (
              line.quantity * line.packSize > 1000000 ||
              line.costMinor * line.quantity > 999999999
            )
              throw fail('Quantity or cost limit exceeded.');
          }
          data = {
            supplierId: cmd.supplierId,
            lines: cmd.lines.map((l) => ({ ...l, received: 0 })),
            status: 'requested',
          };
          break;
        }
        case 'purchase.approve':
          if (recordKind !== 'purchase' || data.status !== 'requested')
            throw fail('Only requested purchases can be approved.');
          data.status = 'approved';
          data.approval = { actorId: a.id, reason: cmd.reason };
          break;
        case 'purchase.cancel':
          if (recordKind !== 'purchase' || !['requested', 'approved'].includes(data.status))
            throw fail('This purchase cannot be cancelled.');
          data.status = 'cancelled';
          data.reason = cmd.reason;
          break;
        case 'purchase.receive': {
          if (recordKind !== 'purchase' || data.status !== 'approved')
            throw fail('Approved purchase required.');
          const line = data.lines[cmd.line];
          if (!line || line.received + cmd.quantity > line.quantity)
            throw fail('Receipt exceeds the ordered remainder.');
          if (line.controlled && !cmd.authorization)
            throw fail('Controlled item requires responsible authorization.');
          const b = (
            await c.query(
              'SELECT product_id FROM inventory_batches WHERE hospital_id=$1 AND id=$2',
              [h, cmd.batchId],
            )
          ).rows[0];
          if (!b || b.product_id !== line.productId)
            throw fail('Batch must match the ordered product.');
          await movement(
            cmd.batchId,
            cmd.expectedBatchRevision,
            cmd.quantity * line.packSize,
            `PO ${entity}; supplier ${data.supplierId}; ${cmd.authorization ?? 'receipt'}`,
          );
          data.lines = data.lines.map((l: any, i: number) =>
            i === cmd.line ? { ...l, received: l.received + cmd.quantity } : l,
          );
          if (data.lines.every((l: any) => l.received === l.quantity)) data.status = 'received';
          break;
        }
        case 'return.record': {
          recordKind = 'return';
          const d = (
            await c.query(
              "SELECT d.quantity,m.batch_id,b.product_id FROM inventory_dispenses d JOIN inventory_movements m ON (m.hospital_id,m.id)=(d.hospital_id,d.movement_id) JOIN inventory_batches b ON (b.hospital_id,b.id)=(m.hospital_id,m.batch_id) WHERE d.hospital_id=$1 AND d.id=$2 AND d.kind='dispense'",
              [h, cmd.dispenseId],
            )
          ).rows[0];
          if (!d) throw fail('Dispense not found.', 404);
          const returned = (
            await c.query(
              "SELECT coalesce(sum((data->>'quantity')::integer),0)::integer total FROM department_records WHERE hospital_id=$1 AND kind='return' AND data->>'dispenseId'=$2",
              [h, cmd.dispenseId],
            )
          ).rows[0].total;
          if (returned + cmd.quantity > d.quantity)
            throw fail('Cumulative returns exceed supplied quantity.');
          data = {
            dispenseId: cmd.dispenseId,
            batchId: d.batch_id,
            productId: d.product_id,
            quantity: cmd.quantity,
            reason: cmd.reason,
            status: 'quarantined',
          };
          break;
        }
        case 'return.quality':
          if (recordKind !== 'return' || data.status !== 'quarantined')
            throw fail('Only quarantined returns can receive a quality decision.');
          if (cmd.decision === 'restock') {
            const b = (
              await c.query(
                "SELECT b.*,p.active,b.expiry > (clock_timestamp() AT TIME ZONE 'Africa/Addis_Ababa')::date eligible FROM inventory_batches b JOIN inventory_products p ON (p.hospital_id,p.id)=(b.hospital_id,b.product_id) WHERE b.hospital_id=$1 AND b.id=$2",
                [h, data.batchId],
              )
            ).rows[0];
            if (!b || b.quarantined || !b.active || !b.eligible)
              throw fail('Batch must be active, unexpired and outside quarantine for restock.');
            await movement(
              data.batchId,
              cmd.expectedBatchRevision,
              data.quantity,
              `Patient return ${entity}; quality ${cmd.reason}`,
            );
          }
          data.status = cmd.decision;
          data.quality = { actorId: a.id, reason: cmd.reason };
          break;
        case 'invoice.credit':
        case 'payment.refund': {
          const invoice = (
            await c.query(
              "SELECT i.*,coalesce((SELECT sum(amount_minor) FROM billing_payments p WHERE (p.hospital_id,p.invoice_id)=(i.hospital_id,i.id)),0)::integer collected,coalesce((SELECT sum(amount_minor) FROM department_finance f WHERE (f.hospital_id,f.invoice_id)=(i.hospital_id,i.id) AND kind IN ('credit','discount')),0)::integer credited,coalesce((SELECT sum(amount_minor) FROM department_finance f WHERE (f.hospital_id,f.invoice_id)=(i.hospital_id,i.id) AND kind IN ('refund','reversal')),0)::integer refunded,(SELECT count(*) FROM billing_events e WHERE (e.hospital_id,e.invoice_id)=(i.hospital_id,i.id))+(SELECT count(*) FROM department_finance f WHERE (f.hospital_id,f.invoice_id)=(i.hospital_id,i.id)) revision,EXISTS(SELECT 1 FROM billing_events e WHERE (e.hospital_id,e.invoice_id)=(i.hospital_id,i.id) AND action='invoice.void') voided FROM billing_invoices i WHERE hospital_id=$1 AND id=$2",
              [h, cmd.invoiceId],
            )
          ).rows[0];
          if (!invoice) throw fail('Invoice not found.', 404);
          if (Number(invoice.revision) !== cmd.expectedRevision || invoice.voided)
            throw fail('Invoice changed or voided.');
          if (cmd.type === 'invoice.credit') {
            if (invoice.credited + cmd.amountMinor > invoice.total_minor)
              throw fail('Credit exceeds charge.');
          } else {
            const p = (
              await c.query(
                'SELECT * FROM billing_payments WHERE hospital_id=$1 AND id=$2 AND invoice_id=$3',
                [h, cmd.paymentId, cmd.invoiceId],
              )
            ).rows[0];
            if (!p) throw fail('Payment not found.', 404);
            const used = (
              await c.query(
                'SELECT coalesce(sum(amount_minor),0)::integer total FROM department_finance WHERE hospital_id=$1 AND payment_id=$2',
                [h, cmd.paymentId],
              )
            ).rows[0].total;
            const projection = financialProjection(
              invoice.total_minor,
              invoice.collected,
              invoice.credited,
              invoice.refunded,
            );
            if (
              cmd.amountMinor > p.amount_minor - used ||
              (cmd.kind === 'refund' && cmd.amountMinor > projection.refundableMinor)
            )
              throw fail('Amount exceeds the refundable collected balance.');
          }
          await c.query(
            'INSERT INTO department_finance(id,hospital_id,invoice_id,payment_id,kind,amount_minor,reason,actor_id,actor_name,authority_id,method,reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$8,$10,$11)',
            [
              entity,
              h,
              cmd.invoiceId,
              cmd.type === 'payment.refund' ? cmd.paymentId : null,
              cmd.kind,
              cmd.amountMinor,
              cmd.reason,
              a.id,
              a.display_name,
              cmd.type === 'payment.refund' ? cmd.method : null,
              cmd.type === 'payment.refund' ? (cmd.reference ?? '') : null,
            ],
          );
          recordKind = 'finance';
          data = {
            financialEntry: true,
            invoiceId: cmd.invoiceId,
            amountMinor: cmd.amountMinor,
            kind: cmd.kind,
          };
          break;
        }
        case 'shift.open':
          if (
            (
              await c.query(
                "SELECT 1 FROM department_records WHERE hospital_id=$1 AND kind='shift' AND data->>'ownerId'=$2 AND data->>'status'='open'",
                [h, a.id],
              )
            ).rowCount
          )
            throw fail('Close the current shift first.');
          data = { ownerId: a.id, openingMinor: cmd.openingMinor, status: 'open' };
          break;
        case 'shift.allocate': {
          if (
            recordKind !== 'shift' ||
            data.status !== 'open' ||
            (a.role !== 'admin' && data.ownerId !== a.id)
          )
            throw fail('Open owned shift required.');
          const table = cmd.paymentId ? 'billing_payments' : 'department_finance',
            id = cmd.paymentId ?? cmd.refundId;
          const entry = (
            await c.query(`SELECT * FROM ${table} WHERE hospital_id=$1 AND id=$2`, [h, id])
          ).rows[0];
          if (
            !entry ||
            entry.method !== 'cash' ||
            (!cmd.paymentId && !['refund', 'reversal'].includes(entry.kind))
          )
            throw fail('Only recorded cash payments/refunds can be allocated.');
          if (
            (
              await c.query(
                'SELECT 1 FROM department_allocations WHERE hospital_id=$1 AND (payment_id=$2 OR refund_id=$2)',
                [h, id],
              )
            ).rowCount
          )
            throw fail('This entry is already allocated.');
          await c.query(
            'INSERT INTO department_allocations(hospital_id,shift_id,payment_id,refund_id,amount_minor) VALUES($1,$2,$3,$4,$5)',
            [
              h,
              entity,
              cmd.paymentId ?? null,
              cmd.refundId ?? null,
              entry.amount_minor * (cmd.paymentId ? 1 : -1),
            ],
          );
          break;
        }
        case 'shift.close': {
          if (
            recordKind !== 'shift' ||
            data.status !== 'open' ||
            (a.role !== 'admin' && data.ownerId !== a.id)
          )
            throw fail('Open owned shift required.');
          const net = (
            await c.query(
              'SELECT coalesce(sum(amount_minor),0)::text net FROM department_allocations WHERE hospital_id=$1 AND shift_id=$2',
              [h, entity],
            )
          ).rows[0].net;
          const expected = data.openingMinor + Number(net);
          if (!Number.isSafeInteger(expected) || expected < 0 || expected > 999999999)
            throw fail('Shift total limit exceeded.');
          data = {
            ...data,
            status: 'closed',
            countedMinor: cmd.countedMinor,
            expectedMinor: expected,
            differenceMinor: cmd.countedMinor - expected,
            signature: cmd.signature,
            closedBy: a.id,
          };
          break;
        }
        case 'shift.review':
          if (recordKind !== 'shift' || data.status !== 'closed')
            throw fail('Closed shift required.');
          data.status = 'reviewed';
          data.review = { actorId: a.id, reason: cmd.reason };
          break;
      }
      if (
        recordKind === 'specimen' &&
        ['lab.collect', 'lab.release', 'lab.acknowledge'].includes(cmd.type)
      ) {
        const v = (
          await c.query('SELECT * FROM outpatient_visits WHERE hospital_id=$1 AND id=$2', [
            h,
            data.visitId,
          ])
        ).rows[0];
        const order = v?.data.orders.find((o: any) => o.id === data.orderId);
        if (!order || order.status === 'cancelled')
          throw fail('The linked encounter order is unavailable.');
        if (
          cmd.type === 'lab.collect' &&
          (v.data.status !== 'active' || !['requested', 'collected'].includes(order.status))
        )
          throw fail('Collection requires an active encounter and an order awaiting release.');
        if (
          cmd.type === 'lab.release' &&
          (!['collected', 'released', 'reviewed'].includes(order.status) ||
            ((data.versionCount ?? data.versions.length) === 1 &&
              (['released', 'reviewed'].includes(order.status) || v.data.status !== 'active')))
        )
          throw fail(
            'Initial result release requires an active encounter and collected order. Use a retained correction for released results.',
          );
        if (
          (cmd.type === 'lab.collect' && order.status === 'requested') ||
          (cmd.type === 'lab.release' && order.status === 'collected')
        ) {
          if (v.data.status !== 'active') throw fail('The encounter is closed.');
          const next = cmd.type === 'lab.collect' ? 'collected' : 'released',
            from = order.status;
          order.status = next;
          if (next === 'released') order.result = data.versions.at(-1).value;
          await c.query(
            'UPDATE outpatient_visits SET revision=revision+1,data=$3 WHERE hospital_id=$1 AND id=$2',
            [h, v.id, v.data],
          );
          await c.query(
            "INSERT INTO audit_events(id,hospital_id,actor_id,patient_id,action,visit_id,visit_revision,detail,subject_type,subject_id,transition_from,transition_to) VALUES($1,$2,$3,$4,'visit.advanceOrder',$5,$6,$7,'investigation',$8,$9,$10)",
            [
              randomUUID(),
              h,
              a.id,
              v.patient_id,
              v.id,
              v.revision + 1,
              'Recorded laboratory handoff.',
              data.orderId,
              from,
              next,
            ],
          );
        }
        if (cmd.type === 'lab.release' && data.review === 'pending') {
          const owner = (
            await c.query(
              "SELECT * FROM staff_users WHERE hospital_id=$1 AND id=$2 AND active AND NOT password_change_required AND role='clinician'",
              [h, data.clinicianId],
            )
          ).rows[0];
          if (!owner)
            throw fail(
              'Assign an active responsible clinician before releasing accountable results.',
            );
          const version = Number(
              (
                await c.query(
                  "SELECT coalesce(max(version),0)+1 version FROM clinical_events WHERE hospital_id=$1 AND visit_id=$2 AND kind='result' AND subject_id=$3",
                  [h, v.id, data.orderId],
                )
              ).rows[0].version,
            ),
            amendment = randomUUID();
          await c.query(
            "INSERT INTO clinical_amendments(id,hospital_id,visit_id,kind,subject_id,body,reason) VALUES($1,$2,$3,'result',$4,$5,$6)",
            [
              amendment,
              h,
              v.id,
              data.orderId,
              data.versions.at(-1).value,
              data.versions.at(-1).reason ??
                'Critical laboratory result requires accountable acknowledgement.',
            ],
          );
          await c.query(
            "INSERT INTO clinical_events(id,hospital_id,visit_id,kind,subject_id,amendment_id,version,action,actor_id,actor_name,owner_id,owner_name) VALUES($1,$2,$3,'result',$4,$1,$5,'result.correct',$6,$7,$8,$9)",
            [
              amendment,
              h,
              v.id,
              data.orderId,
              version,
              a.id,
              a.display_name,
              owner.id,
              owner.display_name,
            ],
          );
          data.amendmentId = amendment;
        }
        if (cmd.type === 'lab.acknowledge' && data.amendmentId) {
          const latest = (
            await c.query(
              "SELECT * FROM clinical_events WHERE hospital_id=$1 AND visit_id=$2 AND kind='result' AND subject_id=$3 ORDER BY version DESC LIMIT 1",
              [h, v.id, data.orderId],
            )
          ).rows[0];
          if (latest.amendment_id !== data.amendmentId)
            throw fail('A later clinical correction requires review in the encounter.');
          if (latest.action !== 'result.review')
            await c.query(
              "INSERT INTO clinical_events(id,hospital_id,visit_id,kind,subject_id,amendment_id,version,action,actor_id,actor_name) VALUES($1,$2,$3,'result',$4,$5,$6,'result.review',$7,$8)",
              [
                randomUUID(),
                h,
                v.id,
                data.orderId,
                data.amendmentId,
                latest.version + 1,
                a.id,
                a.display_name,
              ],
            );
        }
      }
      const revision = r ? r.revision + 1 : 1;
      if (r)
        await c.query(
          'UPDATE department_records SET revision=$3,data=$4 WHERE hospital_id=$1 AND id=$2',
          [h, entity, revision, data],
        );
      else
        await c.query(
          'INSERT INTO department_records(id,hospital_id,kind,data) VALUES($1,$2,$3,$4)',
          [entity, h, recordKind, data],
        );
      if (cmd.type === 'lab.register')
        await link({ visit_id: cmd.visitId, clinician_id: cmd.clinicianId });
      if (cmd.type === 'purchase.create') {
        await link({ supplier_id: cmd.supplierId });
        for (const l of cmd.lines) await link({ product_id: l.productId });
      }
      if (cmd.type === 'purchase.receive') await link({ batch_id: cmd.batchId });
      if (cmd.type === 'return.record')
        await link({
          dispense_id: cmd.dispenseId,
          batch_id: data.batchId,
          product_id: data.productId,
        });
      await c.query(
        'INSERT INTO department_events(id,hospital_id,entity_id,action,actor_id,actor_name,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [eventId, h, entity, cmd.type, a.id, a.display_name, { revision, command: cmd, data }],
      );
      const result = { id: entity, eventId, revision, replayed: false };
      await c.query(
        'INSERT INTO department_requests(hospital_id,idempotency_key,actor_id,payload_hash,result) VALUES($1,$2,$3,$4,$5)',
        [h, key.data, a.id, hash, result],
      );
      return result;
    });
  });
}
