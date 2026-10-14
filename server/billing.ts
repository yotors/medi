import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { billingCommandSchema, billingQuerySchema, billingUuidSchema, type BillingDetail, type BillingEvent, type BillingInvoice, type BillingPage, type BillingResult, type BillingSummary } from '../shared/billing.ts';
import { MAX_PRICE_MINOR } from '../shared/configuration.ts';
import type { Session } from '../shared/registration.ts';
import { ApiError } from './app.ts';
import { currentActor, digest } from './auth.ts';
const invalid = () => new ApiError(400, 'INVALID_REQUEST', 'Check the billing fields and try again.');
const missing = () => new ApiError(404, 'NOT_FOUND', 'The billing record was not found.');
const forbidden = () => new ApiError(403, 'FORBIDDEN', 'This account cannot perform this billing action.');
const selectInvoice = `SELECT i.*,coalesce((SELECT sum(p.amount_minor) FROM billing_payments p WHERE p.hospital_id=i.hospital_id AND p.invoice_id=i.id),0)::integer AS paid_minor,
  (SELECT max(e.revision) FROM billing_events e WHERE e.hospital_id=i.hospital_id AND e.invoice_id=i.id) AS revision,
  EXISTS(SELECT 1 FROM billing_events e WHERE e.hospital_id=i.hospital_id AND e.invoice_id=i.id AND e.action='invoice.void') AS voided FROM billing_invoices i`;
const invoiceDto = (row: Record<string, any>): BillingInvoice => ({ id: row.id, visitId: row.visit_id, number: row.number, revision: row.revision, status: row.voided ? 'void' : 'issued', currency: 'ETB', totalMinor: row.total_minor, paidMinor: row.paid_minor, balanceMinor: row.voided ? 0 : row.total_minor - row.paid_minor, issuedAt: row.issued_at.toISOString(), actorId: row.actor_id, actorName: row.actor_name });
export async function readBillingSummaries(client: pg.PoolClient, hospital: string, visits: string[]): Promise<Map<string, BillingSummary>> {
  const summaries = new Map<string, BillingSummary>(visits.map(id => [id, { state: 'unbilled', currency: 'ETB', totalMinor: 0, paidMinor: 0, balanceMinor: 0 }]));
  if (!visits.length) return summaries;
  const { rows } = await client.query(`SELECT visit_id,count(*)::integer AS count,coalesce(sum(total_minor),0)::integer AS total,coalesce(sum(paid_minor),0)::integer AS paid FROM (${selectInvoice} WHERE i.hospital_id=$1 AND i.visit_id=ANY($2::uuid[])) invoices WHERE NOT voided GROUP BY visit_id`, [hospital, visits]);
  for (const row of rows) summaries.set(row.visit_id, { state: row.total === row.paid ? 'settled' : 'outstanding', currency: 'ETB', totalMinor: row.total, paidMinor: row.paid, balanceMinor: row.total - row.paid });
  return summaries;
}
export async function readBillingSummary(client: pg.PoolClient, hospital: string, visit: string): Promise<BillingSummary> {
  return (await readBillingSummaries(client, hospital, [visit])).get(visit)!;
}
async function catalogVisit(client: pg.PoolClient, hospital: string, id: string) {
  const { rows: [row] } = await client.query('SELECT data FROM outpatient_visits WHERE hospital_id=$1 AND id=$2', [hospital, id]);
  if (!row) throw missing();
  if (row.data.financialMode !== 'catalog') throw new ApiError(409, 'LEGACY_DEMO', 'Historical demonstration finances cannot receive catalog invoices or receipts.');
}
async function readInvoice(client: pg.PoolClient, hospital: string, id: string): Promise<BillingInvoice> {
  const { rows: [row] } = await client.query(`${selectInvoice} WHERE i.hospital_id=$1 AND i.id=$2`, [hospital, id]);
  if (!row) throw missing(); return invoiceDto(row);
}
export function registerBillingRoutes(app: FastifyInstance, pool: pg.Pool, sessions: WeakMap<FastifyRequest, Session>) {
  async function transaction<T>(session: Session, write: boolean, adminOnly: boolean, work: (client: pg.PoolClient, actor: Record<string, any>) => Promise<T>) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SET LOCAL statement_timeout='10s'");
      await client.query(`SELECT id FROM hospitals WHERE id=$1 FOR ${write ? 'UPDATE' : 'SHARE'}`, [session.user.hospital.id]);
      const actor = await currentActor(client, session);
      if (!actor || actor.password_change_required) throw new ApiError(401, 'UNAUTHENTICATED', 'Your session ended. Sign in again.');
      if (!(adminOnly ? ['admin'] : write ? ['admin', 'cashier'] : ['admin', 'cashier', 'auditor']).includes(actor.role)) throw forbidden();
      const result = await work(client, actor); await client.query('COMMIT'); return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (['55P03', '57014', '40001', '40P01'].includes((error as { code?: string }).code ?? '')) throw new ApiError(503, 'BILLING_BUSY', 'Billing is temporarily busy. Retry the exact same request.');
      throw error;
    } finally { client.release(); }
  }
  app.get<{ Params: { id: string } }>('/api/visits/:id/billing', async request => {
    const query = billingQuerySchema.safeParse(request.query); if (!query.success) throw invalid();
    const id = billingUuidSchema.safeParse(request.params.id); if (!id.success) throw missing();
    const session = sessions.get(request)!; const hospital = session.user.hospital.id;
    return transaction(session, false, false, async (client, actor): Promise<BillingPage> => {
      await catalogVisit(client, hospital, id.data);
      const summary = await readBillingSummary(client, hospital, id.data);
      const { rows: [count] } = await client.query('SELECT count(*)::integer AS total FROM billing_invoices WHERE hospital_id=$1 AND visit_id=$2', [hospital, id.data]);
      const { rows } = await client.query(`${selectInvoice} WHERE i.hospital_id=$1 AND i.visit_id=$2 ORDER BY i.issued_at DESC,i.id DESC LIMIT 25 OFFSET $3`, [hospital, id.data, (query.data.page - 1) * 25]);
      return { summary, invoices: rows.map(invoiceDto), total: count.total, page: query.data.page, pageSize: 25, permissions: { issue: actor.role !== 'auditor', pay: actor.role !== 'auditor', void: actor.role === 'admin' } };
    });
  });
  app.get<{ Params: { id: string } }>('/api/billing/invoices/:id', async request => {
    const query = billingQuerySchema.safeParse(request.query); if (!query.success) throw invalid();
    const id = billingUuidSchema.safeParse(request.params.id); if (!id.success) throw missing();
    const session = sessions.get(request)!; const hospital = session.user.hospital.id;
    return transaction(session, false, false, async (client): Promise<BillingDetail> => {
      const invoice = await readInvoice(client, hospital, id.data);
      const { rows: lines } = await client.query('SELECT * FROM billing_lines WHERE hospital_id=$1 AND invoice_id=$2 ORDER BY position', [hospital, invoice.id]);
      const { rows: [count] } = await client.query('SELECT count(*)::integer AS total FROM billing_events WHERE hospital_id=$1 AND invoice_id=$2', [hospital, invoice.id]);
      const { rows } = await client.query(`SELECT e.*,p.amount_minor,p.method,p.reference,r.id AS receipt_id,r.number AS receipt_number FROM billing_events e
        LEFT JOIN billing_payments p ON (p.hospital_id,p.id)=(e.hospital_id,e.payment_id)
        LEFT JOIN billing_receipts r ON (r.hospital_id,r.payment_id)=(p.hospital_id,p.id)
        WHERE e.hospital_id=$1 AND e.invoice_id=$2 ORDER BY e.revision DESC LIMIT 25 OFFSET $3`, [hospital, invoice.id, (query.data.page - 1) * 25]);
      const events: BillingEvent[] = rows.map(e => ({ id: e.id, action: e.action, revision: e.revision, actorId: e.actor_id, actorName: e.actor_name, createdAt: e.created_at.toISOString(), ...(e.reason ? { reason: e.reason } : {}), ...(e.payment_id ? { payment: { id: e.payment_id, receiptId: e.receipt_id, receiptNumber: e.receipt_number, amountMinor: e.amount_minor, method: e.method, reference: e.reference, actorId: e.actor_id, actorName: e.actor_name, createdAt: e.created_at.toISOString() } } : {}) }));
      return { invoice, lines: lines.map(line => ({ id: line.id, position: line.position, serviceId: line.service_id, serviceRevision: line.service_revision, code: line.code, name: line.name, quantity: line.quantity, unitPriceMinor: line.unit_price_minor, totalMinor: line.total_minor })), events, total: count.total, page: query.data.page, pageSize: 25 };
    });
  });
  app.post<{ Params: { id: string } }>('/api/visits/:id/billing/commands', { bodyLimit: 16384 }, async request => {
    const parsed = billingCommandSchema.safeParse(request.body); const key = billingUuidSchema.safeParse(request.headers['idempotency-key']);
    if (!parsed.success || !key.success || !z.strictObject({}).safeParse(request.query).success) throw invalid();
    const id = billingUuidSchema.safeParse(request.params.id); if (!id.success) throw missing();
    const command = parsed.data; const session = sessions.get(request)!; const hospital = session.user.hospital.id; const visit = id.data;
    const hash = digest(JSON.stringify({ visitId: visit, command }));
    return transaction(session, true, command.type === 'invoice.void', async (client, actor): Promise<BillingResult> => {
      await catalogVisit(client, hospital, visit);
      const { rows: [prior] } = await client.query('SELECT * FROM billing_requests WHERE hospital_id=$1 AND idempotency_key=$2', [hospital, key.data]);
      if (prior) {
        if (prior.actor_id !== actor.id || prior.payload_hash !== hash || prior.visit_id !== visit) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This retry key belongs to different billing details or another operator.');
        return { ...prior.result, replayed: true };
      }
      let invoiceId: string; let revision = 1; let paymentId: string | null = null; let result: BillingResult;
      if (command.type === 'invoice.issue') {
        const lines = [];
        let total = 0;
        for (const selected of command.lines) {
          const { rows: [service] } = await client.query(`SELECT s.code,s.revision,v.name,v.price_minor,v.active,d.active AS department_active FROM hospital_services s
            JOIN hospital_service_versions v ON (v.hospital_id,v.service_id,v.revision)=(s.hospital_id,s.id,s.revision)
            JOIN hospital_departments d ON (d.hospital_id,d.id)=(v.hospital_id,v.department_id)
            WHERE s.hospital_id=$1 AND s.id=$2`, [hospital, selected.serviceId]);
          if (!service || service.revision !== selected.serviceRevision || !service.active || !service.department_active) throw new ApiError(409, 'STALE_SERVICE', 'A selected service changed or is unavailable. Reload the catalog and review your retained draft.');
          const lineTotal = service.price_minor * selected.quantity; total += lineTotal;
          lines.push({ ...selected, ...service, total: lineTotal });
        }
        const summary = await readBillingSummary(client, hospital, visit);
        if (total > MAX_PRICE_MINOR || total + summary.totalMinor > MAX_PRICE_MINOR) throw new ApiError(400, 'AMOUNT_LIMIT', 'The invoice or visit total exceeds the supported ETB limit.');
        await client.query('INSERT INTO billing_counters(hospital_id) VALUES($1) ON CONFLICT DO NOTHING', [hospital]);
        const { rows: [counter] } = await client.query('UPDATE billing_counters SET next_invoice=next_invoice+1 WHERE hospital_id=$1 RETURNING next_invoice-1 AS number', [hospital]);
        invoiceId = randomUUID();
        await client.query('INSERT INTO billing_invoices(id,hospital_id,visit_id,number,total_minor,line_count,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [invoiceId, hospital, visit, `INV-${String(counter.number).padStart(6, '0')}`, total, lines.length, actor.id, actor.display_name]);
        for (const [index, line] of lines.entries()) await client.query('INSERT INTO billing_lines(id,hospital_id,invoice_id,position,service_id,service_revision,code,name,quantity,unit_price_minor,total_minor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [randomUUID(), hospital, invoiceId, index + 1, line.serviceId, line.serviceRevision, line.code, line.name, line.quantity, line.price_minor, line.total]);
        result = { invoiceId, replayed: false };
      } else {
        const invoice = await readInvoice(client, hospital, command.invoiceId);
        if (invoice.visitId !== visit) throw missing();
        if (invoice.revision !== command.expectedRevision) throw new ApiError(409, 'REVISION_CONFLICT', 'This invoice changed. Reload its current revision and review your retained draft.');
        if (invoice.status === 'void') throw new ApiError(409, 'INVOICE_VOID', 'A void invoice cannot receive another action.');
        invoiceId = invoice.id; revision = invoice.revision + 1;
        result = { invoiceId, replayed: false };
        if (command.type === 'invoice.void') {
          if (invoice.paidMinor > 0) throw new ApiError(409, 'INVOICE_PAID', 'An invoice with recorded payments cannot be voided.');
        } else {
          if (command.amountMinor > invoice.balanceMinor) throw new ApiError(409, 'OVERPAYMENT', 'The amount exceeds the invoice balance. Review the current invoice.');
          paymentId = randomUUID(); const receiptId = randomUUID();
          await client.query('INSERT INTO billing_payments(id,hospital_id,invoice_id,amount_minor,method,reference,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [paymentId, hospital, invoiceId, command.amountMinor, command.method, command.reference ?? '', actor.id, actor.display_name]);
          const { rows: [counter] } = await client.query('UPDATE billing_counters SET next_receipt=next_receipt+1 WHERE hospital_id=$1 RETURNING next_receipt-1 AS number', [hospital]);
          const receiptNumber = `RCT-${String(counter.number).padStart(6, '0')}`;
          await client.query('INSERT INTO billing_receipts(id,hospital_id,payment_id,number) VALUES($1,$2,$3,$4)', [receiptId, hospital, paymentId, receiptNumber]);
          result = { ...result, receiptId, receiptNumber };
        }
      }
      // This immutable event is the attributable billing audit. It commits with the ledger and retry receipt.
      await client.query('INSERT INTO billing_events(id,hospital_id,invoice_id,revision,action,actor_id,actor_name,payment_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [randomUUID(), hospital, invoiceId, revision, command.type, actor.id, actor.display_name, paymentId, command.type === 'invoice.void' ? command.reason : null]);
      await client.query('INSERT INTO billing_requests(hospital_id,idempotency_key,actor_id,visit_id,payload_hash,result) VALUES($1,$2,$3,$4,$5,$6)', [hospital, key.data, actor.id, visit, hash, JSON.stringify(result)]);
      return result;
    });
  });
}
