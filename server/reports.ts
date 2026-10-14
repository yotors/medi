import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import {
  reportQuerySchema,
  reportSections,
  type OperationalReport,
  type ReportProduct,
} from '../shared/reports.ts';
import type { Session, StaffRole } from '../shared/registration.ts';
import { ApiError } from './app.ts';
import { currentActor } from './auth.ts';
import { withReportBudget } from './report-budget.ts';
function count(value: string | number): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0)
    throw new ApiError(503, 'REPORT_LIMIT', 'The report exceeds the supported count limit.');
  return result;
}
export function registerReportRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  sessions: WeakMap<FastifyRequest, Session>,
) {
  app.get('/api/reports/operational', async (request, reply) => {
    const parsed = reportQuerySchema.safeParse(request.query);
    if (!parsed.success)
      throw new ApiError(
        400,
        'INVALID_REPORT_RANGE',
        'Choose valid Gregorian dates in order, covering no more than 366 days.',
      );
    const session = sessions.get(request)!;
    const hospital = session.user.hospital.id;
    return withReportBudget(pool, request, reply, async (client) => {
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout='5s'");
        await client.query('SELECT id FROM hospitals WHERE id=$1 FOR SHARE', [hospital]);
        const actor = await currentActor(client, session);
        if (!actor || actor.password_change_required)
          throw new ApiError(401, 'UNAUTHENTICATED', 'Your session ended. Sign in again.');
        const authorizedSections = [...reportSections[actor.role as StaffRole]];
        if (!authorizedSections.length)
          throw new ApiError(403, 'FORBIDDEN', 'This account cannot read operational reports.');
        const {
          rows: [clock],
        } = await client.query(
          "SELECT instant,to_char(instant AT TIME ZONE 'Africa/Addis_Ababa','YYYY-MM-DD') AS today FROM (SELECT clock_timestamp() AS instant) captured",
        );
        const {
          rows: [bounds],
        } = await client.query(
          "SELECT $1::date::timestamp AT TIME ZONE 'Africa/Addis_Ababa' AS start,($2::date+1)::timestamp AT TIME ZONE 'Africa/Addis_Ababa' AS end",
          [parsed.data.from, parsed.data.to],
        );
        const range = {
          from: parsed.data.from,
          to: parsed.data.to,
          timezone: 'Africa/Addis_Ababa' as const,
          start: bounds.start.toISOString(),
          endExclusive: bounds.end.toISOString(),
        };
        const args = [hospital, parsed.data.from, parsed.data.to];
        const result: OperationalReport = {
          auditId: randomUUID(),
          generatedAt: clock.instant.toISOString(),
          range,
          authorizedSections,
        };
        if (authorizedSections.includes('operations')) {
          const {
            rows: [visits],
          } = await client.query(
            `SELECT count(*) FILTER(WHERE opened_at >= ($2::date::timestamp AT TIME ZONE 'Africa/Addis_Ababa') AND opened_at < (($3::date+1)::timestamp AT TIME ZONE 'Africa/Addis_Ababa')) AS opened,
          count(*) FILTER(WHERE (data->>'closedAt')::timestamptz >= ($2::date::timestamp AT TIME ZONE 'Africa/Addis_Ababa') AND (data->>'closedAt')::timestamptz < (($3::date+1)::timestamp AT TIME ZONE 'Africa/Addis_Ababa')) AS closed,
          count(*) FILTER(WHERE data->>'status'='active') AS active,
          coalesce(sum((SELECT count(*) FROM jsonb_array_elements(data->'orders') item WHERE item->>'status' NOT IN ('reviewed','cancelled'))),0) AS investigations,
          coalesce(sum((SELECT count(*) FROM jsonb_array_elements(data->'prescriptions') item WHERE item->>'status'='pending')),0) AS prescriptions
          FROM outpatient_visits WHERE hospital_id=$1`,
            args,
          );
          const {
            rows: [corrections],
          } = await client.query(
            `SELECT count(*) FILTER(WHERE action='note.amend' AND created_at >= ($2::date::timestamp AT TIME ZONE 'Africa/Addis_Ababa') AND created_at < (($3::date+1)::timestamp AT TIME ZONE 'Africa/Addis_Ababa')) AS notes,
          count(*) FILTER(WHERE action='result.correct' AND created_at >= ($2::date::timestamp AT TIME ZONE 'Africa/Addis_Ababa') AND created_at < (($3::date+1)::timestamp AT TIME ZONE 'Africa/Addis_Ababa')) AS results,
          count(*) FILTER(WHERE c.action='result.correct'
            AND NOT EXISTS(SELECT 1 FROM clinical_events n WHERE n.hospital_id=c.hospital_id AND n.visit_id=c.visit_id AND n.kind=c.kind AND n.subject_id=c.subject_id AND n.action='result.correct' AND n.version>c.version)
            AND NOT EXISTS(SELECT 1 FROM clinical_events r WHERE r.hospital_id=c.hospital_id AND r.amendment_id=c.amendment_id AND r.action='result.review')) AS pending
          FROM clinical_events c WHERE hospital_id=$1`,
            args,
          );
          result.operations = {
            period: {
              visitsOpened: count(visits.opened),
              visitsClosed: count(visits.closed),
              noteAmendments: count(corrections.notes),
              resultCorrections: count(corrections.results),
            },
            current: {
              activeVisits: count(visits.active),
              pendingInvestigations: count(visits.investigations),
              pendingPrescriptions: count(visits.prescriptions),
              pendingCorrectedResultReviews: count(corrections.pending),
            },
          };
        }
        if (authorizedSections.includes('finance')) {
          const { rows } = await client.query(
            `SELECT p.method,count(*) AS receipts,coalesce(sum(p.amount_minor),0)::text AS amount FROM billing_payments p
          JOIN billing_receipts r ON r.hospital_id=p.hospital_id AND r.payment_id=p.id WHERE p.hospital_id=$1 AND p.created_at >= ($2::date::timestamp AT TIME ZONE 'Africa/Addis_Ababa') AND p.created_at < (($3::date+1)::timestamp AT TIME ZONE 'Africa/Addis_Ababa') GROUP BY p.method`,
            args,
          );
          const cash = rows.find((r) => r.method === 'cash'),
            transfer = rows.find((r) => r.method === 'manual_transfer');
          const byMethod = {
            cash: { receiptCount: count(cash?.receipts ?? 0), collectedMinor: cash?.amount ?? '0' },
            manual_transfer: {
              receiptCount: count(transfer?.receipts ?? 0),
              collectedMinor: transfer?.amount ?? '0',
            },
          };
          const {
            rows: [outstanding],
          } = await client.query(
            `WITH balances AS (SELECT i.total_minor::bigint-coalesce((SELECT sum(f.amount_minor) FROM department_finance f WHERE f.hospital_id=i.hospital_id AND f.invoice_id=i.id AND kind IN ('credit','discount')),0)+coalesce((SELECT sum(f.amount_minor) FROM department_finance f WHERE f.hospital_id=i.hospital_id AND f.invoice_id=i.id AND kind IN ('refund','reversal')),0)-coalesce((SELECT sum(p.amount_minor) FROM billing_payments p WHERE p.hospital_id=i.hospital_id AND p.invoice_id=i.id),0) AS balance
          FROM billing_invoices i WHERE i.hospital_id=$1 AND NOT EXISTS(SELECT 1 FROM billing_events e WHERE e.hospital_id=i.hospital_id AND e.invoice_id=i.id AND e.action='invoice.void'))
          SELECT count(*) FILTER(WHERE balance>0) AS invoices,coalesce(sum(balance) FILTER(WHERE balance>0),0)::text AS amount FROM balances`,
            [hospital],
          );
          const adjustmentTotals = (
            await client.query(
              `SELECT coalesce(sum(amount_minor) FILTER(WHERE kind IN ('refund','reversal')),0)::text refunded,coalesce(sum(amount_minor) FILTER(WHERE kind IN ('credit','discount')),0)::text credited FROM department_finance WHERE hospital_id=$1 AND created_at >= ($2::date::timestamp AT TIME ZONE 'Africa/Addis_Ababa') AND created_at < (($3::date+1)::timestamp AT TIME ZONE 'Africa/Addis_Ababa')`,
              args,
            )
          ).rows[0];
          result.finance = {
            currency: 'ETB',
            legacyExcluded: true,
            period: {
              refundedMinor: adjustmentTotals.refunded,
              creditedMinor: adjustmentTotals.credited,
              netCollectedMinor: (
                BigInt(byMethod.cash.collectedMinor) +
                BigInt(byMethod.manual_transfer.collectedMinor) -
                BigInt(adjustmentTotals.refunded)
              ).toString(),
              receiptCount: count(
                byMethod.cash.receiptCount + byMethod.manual_transfer.receiptCount,
              ),
              collectedMinor: (
                BigInt(byMethod.cash.collectedMinor) +
                BigInt(byMethod.manual_transfer.collectedMinor)
              ).toString(),
              byMethod,
            },
            current: {
              outstandingInvoiceCount: count(outstanding.invoices),
              outstandingMinor: outstanding.amount,
            },
          };
        }
        if (authorizedSections.includes('inventory')) {
          const {
            rows: [total],
          } = await client.query(
            'SELECT count(*) AS total FROM inventory_products WHERE hospital_id=$1',
            [hospital],
          );
          const { rows } = await client.query(
            `WITH products AS (SELECT * FROM inventory_products WHERE hospital_id=$1 ORDER BY code,id LIMIT 25 OFFSET $4),
          batch_balances AS (SELECT b.product_id,coalesce((SELECT sum(m.quantity) FROM inventory_movements m WHERE m.hospital_id=b.hospital_id AND m.batch_id=b.id),0) AS balance,
            CASE WHEN NOT p.active THEN 'inactive' WHEN b.quarantined THEN 'quarantined' WHEN b.expiry<$5::date THEN 'expired' WHEN b.expiry=$5::date THEN 'expiryToday' ELSE 'available' END AS category
            FROM inventory_batches b JOIN products p ON p.hospital_id=b.hospital_id AND p.id=b.product_id),
          stocks AS (SELECT product_id,sum(balance)::text AS total,
            coalesce(sum(balance) FILTER(WHERE category='available'),0)::text AS available,coalesce(sum(balance) FILTER(WHERE category='inactive'),0)::text AS inactive,
            coalesce(sum(balance) FILTER(WHERE category='quarantined'),0)::text AS quarantined,coalesce(sum(balance) FILTER(WHERE category='expired'),0)::text AS expired,
            coalesce(sum(balance) FILTER(WHERE category='expiryToday'),0)::text AS expiry_today FROM batch_balances GROUP BY product_id),
          movements AS (SELECT b.product_id,coalesce(sum(m.quantity) FILTER(WHERE m.kind='stock.receive'),0)::text AS received,
            coalesce(-sum(m.quantity) FILTER(WHERE m.kind='dispense'),0)::text AS supplied,coalesce(sum(m.quantity) FILTER(WHERE m.kind='stock.adjust'),0)::text AS adjustment_net,sum(m.quantity)::text AS movement_net
            FROM inventory_movements m JOIN inventory_batches b ON b.hospital_id=m.hospital_id AND b.id=m.batch_id JOIN products p ON p.hospital_id=b.hospital_id AND p.id=b.product_id
            JOIN inventory_events e ON e.hospital_id=m.hospital_id AND e.id=m.id WHERE e.created_at >= ($2::date::timestamp AT TIME ZONE 'Africa/Addis_Ababa') AND e.created_at < (($3::date+1)::timestamp AT TIME ZONE 'Africa/Addis_Ababa') GROUP BY b.product_id)
          SELECT p.*,returns.total AS returns_total,returns.quarantined AS returns_quarantined,returns.restocked AS returns_restocked,returns.destroyed AS returns_destroyed,s.total,s.available,s.inactive,s.quarantined,s.expired,s.expiry_today,m.received,m.supplied,m.adjustment_net,m.movement_net FROM products p LEFT JOIN LATERAL (SELECT coalesce(sum((data->>'quantity')::bigint),0)::text total,coalesce(sum((data->>'quantity')::bigint) FILTER(WHERE data->>'status'='quarantined'),0)::text quarantined,coalesce(sum((data->>'quantity')::bigint) FILTER(WHERE data->>'status'='restock'),0)::text restocked,coalesce(sum((data->>'quantity')::bigint) FILTER(WHERE data->>'status'='destroy'),0)::text destroyed FROM department_records WHERE hospital_id=p.hospital_id AND kind='return' AND data->>'productId'=p.id::text) returns ON true LEFT JOIN stocks s ON s.product_id=p.id LEFT JOIN movements m ON m.product_id=p.id ORDER BY p.code,p.id`,
            [...args, (parsed.data.inventoryPage - 1) * 25, clock.today],
          );
          const entries: ReportProduct[] = rows.map((r) => ({
            ...((r.returns_total ?? '0') !== '0'
              ? {
                  returns: {
                    total: r.returns_total,
                    quarantined: r.returns_quarantined,
                    restocked: r.returns_restocked,
                    destroyed: r.returns_destroyed,
                  },
                }
              : {}),
            productId: r.id,
            code: r.code,
            name: r.name,
            unit: r.unit,
            active: r.active,
            current: {
              total: r.total ?? '0',
              available: r.available ?? '0',
              inactive: r.inactive ?? '0',
              quarantined: r.quarantined ?? '0',
              expired: r.expired ?? '0',
              expiryToday: r.expiry_today ?? '0',
            },
            period: {
              received: r.received ?? '0',
              supplied: r.supplied ?? '0',
              adjustmentNet: r.adjustment_net ?? '0',
              movementNet: r.movement_net ?? '0',
            },
          }));
          result.inventory = {
            today: clock.today,
            page: parsed.data.inventoryPage,
            pageSize: 25,
            total: count(total.total),
            entries,
          };
        }
        await client.query(
          `INSERT INTO report_access_events(id,hospital_id,actor_id,actor_name,actor_role,report_kind,date_from,date_to,generated_at,authorized_sections,inventory_page,page_size,product_row_count)
        VALUES($1,$2,$3,$4,$5,'operational',$6,$7,$8,$9,$10,25,$11)`,
          [
            result.auditId,
            hospital,
            actor.id,
            actor.display_name,
            actor.role,
            range.from,
            range.to,
            result.generatedAt,
            authorizedSections,
            parsed.data.inventoryPage,
            result.inventory?.entries.length ?? 0,
          ],
        );
        await client.query('COMMIT');
        return result;
      } catch (error) {
        if (['55P03', '57014', '40001', '40P01'].includes((error as { code?: string }).code ?? ''))
          throw new ApiError(
            503,
            'REPORT_BUSY',
            'Reports are temporarily busy. Retry when the hospital workspace is available.',
          );
        throw error;
      }
    });
  });
}
