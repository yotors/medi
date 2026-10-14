import type pg from 'pg';
import type { StaffRole } from '../shared/registration.ts';
import type {
  DepartmentChoice,
  DepartmentSourceQuery,
  DepartmentSources,
} from '../shared/departments.ts';
import { financialProjection } from '../shared/departments.ts';
import { selectInvoice } from './billing.ts';
import { ApiError } from './app.ts';
const money = (n: number) => `${(n / 100).toFixed(2)} ETB`;
export function departmentSourceRoles(kind: DepartmentSourceQuery['kind']): StaffRole[] {
  if (['catalog', 'specimen', 'orders', 'clinicians'].includes(kind))
    return ['admin', 'lab', 'clinician'];
  if (['invoices', 'payments', 'cashEntries', 'shift'].includes(kind)) return ['admin', 'cashier'];
  return ['admin', 'pharmacist'];
}
export async function readDepartmentSources(
  c: pg.PoolClient,
  hospital: string,
  actor: { id: string; role: StaffRole },
  q: DepartmentSourceQuery,
): Promise<DepartmentSources> {
  const search = `%${q.q.replace(/[\\%_]/g, '\\$&')}%`;
  let sql: string,
    args: unknown[] = [hospital, search],
    map: (r: any) => DepartmentChoice;
  const person = (r: any) =>
    `${r.patient_name} · MRN ${r.record_number}${r.canonical_record_number ? ` · Linked to MRN ${r.canonical_record_number}` : ''}`;
  if (['catalog', 'specimen', 'supplier', 'purchase', 'return', 'shift'].includes(q.kind)) {
    args.push(q.kind);
    const status: Record<string, string[]> = {
      'lab.collect': ['registered'],
      'lab.receive': ['collected'],
      'lab.reject': ['registered', 'collected', 'received'],
      'lab.recollect': ['rejected'],
      'lab.result': ['received', 'result', 'released'],
      'lab.release': ['result'],
      'lab.acknowledge': ['released'],
      'purchase.approve': ['requested'],
      'purchase.receive': ['approved'],
      'purchase.cancel': ['requested', 'approved'],
      'return.quality': ['quarantined'],
      'shift.allocate': ['open'],
      'shift.close': ['open'],
      'shift.review': ['closed'],
    };
    args.push(q.action ? (status[q.action] ?? []) : []);
    args.push(q.action === 'lab.acknowledge' ? actor.id : null);
    args.push(q.kind === 'shift' && actor.role !== 'admin' ? actor.id : null);
    sql = `SELECT d.*,p.name patient_name,p.record_number,p.canonical_record_number,pr.name product_name,pr.unit product_unit,owner.display_name owner_name,s.data->>'name' supplier_name,(SELECT min(created_at) FROM department_events e WHERE (e.hospital_id,e.entity_id)=(d.hospital_id,d.id)) created_at,ARRAY(SELECT ip.name FROM jsonb_array_elements(coalesce(d.data->'lines','[]'::jsonb)) WITH ORDINALITY line(value,index) JOIN inventory_products ip ON ip.hospital_id=d.hospital_id AND ip.id::text=line.value->>'productId' ORDER BY line.index) product_names FROM department_records d
 LEFT JOIN outpatient_visits v ON v.hospital_id=d.hospital_id AND v.id::text=d.data->>'visitId'
 LEFT JOIN inventory_authorizations a ON a.hospital_id=d.hospital_id AND EXISTS(SELECT 1 FROM inventory_dispenses i WHERE (i.hospital_id,i.authorization_id)=(a.hospital_id,a.id) AND i.id::text=d.data->>'dispenseId')
 LEFT JOIN outpatient_visits rv ON (rv.hospital_id,rv.id)=(a.hospital_id,a.visit_id)
 LEFT JOIN patient_directory p ON p.hospital_id=d.hospital_id AND p.id=coalesce(v.patient_id,rv.patient_id)
 LEFT JOIN staff_users owner ON owner.hospital_id=d.hospital_id AND owner.id::text=d.data->>'ownerId'
 LEFT JOIN inventory_products pr ON pr.hospital_id=d.hospital_id AND pr.id::text=d.data->>'productId'
 LEFT JOIN department_records s ON s.hospital_id=d.hospital_id AND s.id::text=d.data->>'supplierId'
 WHERE d.hospital_id=$1 AND d.kind=$3 AND (cardinality($4::text[])=0 OR d.data->>'status'=ANY($4))
 AND ($5::uuid IS NULL OR (d.data->>'clinicianId'=$5::text AND d.data->>'review'='pending'))
 AND ($6::uuid IS NULL OR d.data->>'ownerId'=$6::text)
 AND (concat_ws(' ',d.data->>'name',d.data->>'code',d.data->>'accession',s.data->>'name',p.name,p.record_number) ILIKE $2)`;
    map = (r) => {
      const label =
        q.kind === 'catalog'
          ? `${r.data.code} · ${r.data.name} · ${r.data.specimen} · ${r.data.unit}`
          : q.kind === 'specimen'
            ? `${person(r)} · ${r.data.catalog.name} · Accession ${r.data.accession} · ${r.data.status}`
            : q.kind === 'return'
              ? `${person(r)} · ${r.product_name} · Return ${r.data.quantity} ${r.product_unit} · ${r.data.status}`
              : q.kind === 'purchase'
                ? `${r.supplier_name} · ${r.product_names.join(', ')} · ${r.data.status} · ${r.created_at?.toISOString().slice(0, 16) ?? ''}`
                : q.kind === 'shift'
                  ? `Cashier ${r.owner_name} · Opening ${money(r.data.openingMinor)} · ${r.data.status} · ${r.created_at?.toISOString().slice(0, 16) ?? ''}`
                  : r.data.name;
      return {
        id: r.id,
        label,
        values: {
          id: r.id,
          expectedRevision: String(r.revision),
          ...(q.kind === 'catalog' ? { catalogId: r.id } : {}),
          ...(q.kind === 'supplier' ? { supplierId: r.id } : {}),
        },
        data: { ...r.data, productNames: r.product_names },
      };
    };
  } else if (q.kind === 'orders') {
    sql = `SELECT o->>'id' id,o->>'test' test,o->>'catalogId' catalog_id,v.id visit_id,v.revision,v.data->>'financialMode' financial_mode,p.name patient_name,p.record_number,p.canonical_record_number FROM outpatient_visits v JOIN patient_directory p ON (p.hospital_id,p.id)=(v.hospital_id,v.patient_id) CROSS JOIN LATERAL jsonb_array_elements(v.data->'orders') o
 WHERE v.hospital_id=$1 AND v.status='active' AND o->>'status' IN ('requested','collected') AND NOT EXISTS(SELECT 1 FROM department_records d WHERE d.hospital_id=v.hospital_id AND d.kind='specimen' AND d.data->>'visitId'=v.id::text AND d.data->>'orderId'=o->>'id') AND concat_ws(' ',p.name,p.record_number,p.canonical_record_number,o->>'test') ILIKE $2`;
    map = (r) => ({
      id: r.id,
      label: `${person(r)} · ${r.test}${r.catalog_id ? '' : ' · Historical order (confirm matching configured test)'}`,
      values: {
        orderId: r.id,
        visitId: r.visit_id,
        ...(r.catalog_id ? { catalogId: r.catalog_id } : {}),
      },
      data: { test: r.test, catalogId: r.catalog_id, financialMode: r.financial_mode },
    });
  } else if (q.kind === 'clinicians') {
    sql =
      "SELECT id,display_name,username FROM staff_users WHERE hospital_id=$1 AND active AND NOT password_change_required AND role='clinician' AND concat_ws(' ',display_name,username) ILIKE $2";
    map = (r) => ({
      id: r.id,
      label: `${r.display_name} · ${r.username}`,
      values: { clinicianId: r.id },
    });
  } else if (q.kind === 'products') {
    sql =
      "SELECT id,code,name,unit FROM inventory_products WHERE hospital_id=$1 AND active AND concat_ws(' ',code,name,unit) ILIKE $2";
    map = (r) => ({
      id: r.id,
      label: `${r.code} · ${r.name} · ${r.unit}`,
      values: { productId: r.id, unit: r.unit },
      data: { name: r.name, unit: r.unit },
    });
  } else if (q.kind === 'batches') {
    let productId = q.productId;
    if (q.recordId) {
      const record = (
        await c.query(
          "SELECT data FROM department_records WHERE hospital_id=$1 AND id=$2 AND kind='return'",
          [hospital, q.recordId],
        )
      ).rows[0];
      if (!record) throw new ApiError(404, 'NOT_FOUND', 'Return not found.');
      productId = record.data.productId;
    }
    if (!productId) return { entries: [], total: 0, page: q.page, pageSize: 25 };
    args.push(productId);
    args.push(q.recordId ?? null);
    sql = `SELECT b.id,b.revision,b.lot,to_char(b.expiry,'YYYY-MM-DD') expiry,b.quarantined,p.name,p.unit,coalesce((SELECT sum(m.quantity) FROM inventory_movements m WHERE (m.hospital_id,m.batch_id)=(b.hospital_id,b.id)),0)::text balance FROM inventory_batches b JOIN inventory_products p ON (p.hospital_id,p.id)=(b.hospital_id,b.product_id) WHERE b.hospital_id=$1 AND b.product_id=$3 AND ($4::uuid IS NULL OR b.id::text=(SELECT data->>'batchId' FROM department_records WHERE hospital_id=$1 AND id=$4)) AND concat_ws(' ',b.lot,p.name) ILIKE $2`;
    map = (r) => ({
      id: r.id,
      label: `${r.name} · Lot ${r.lot} · Expires ${r.expiry} · ${r.balance} ${r.unit}${r.quarantined ? ' · Quarantined' : ''}`,
      values: { batchId: r.id, expectedBatchRevision: String(r.revision) },
      data: { unit: r.unit, lot: r.lot, expiry: r.expiry },
    });
  } else if (q.kind === 'dispenses') {
    sql = `SELECT d.id,p.name patient_name,p.record_number,p.canonical_record_number,pr.name product_name,pr.unit,b.lot,d.quantity,b.revision batch_revision,coalesce((SELECT sum((r.data->>'quantity')::integer) FROM department_records r WHERE r.hospital_id=d.hospital_id AND r.kind='return' AND r.data->>'dispenseId'=d.id::text),0)::integer returned FROM inventory_dispenses d JOIN inventory_authorizations a ON (a.hospital_id,a.id)=(d.hospital_id,d.authorization_id) JOIN outpatient_visits v ON (v.hospital_id,v.id)=(a.hospital_id,a.visit_id) JOIN patient_directory p ON (p.hospital_id,p.id)=(v.hospital_id,v.patient_id) JOIN inventory_products pr ON (pr.hospital_id,pr.id)=(a.hospital_id,a.product_id) JOIN inventory_movements m ON (m.hospital_id,m.id)=(d.hospital_id,d.movement_id) JOIN inventory_batches b ON (b.hospital_id,b.id)=(m.hospital_id,m.batch_id) WHERE d.hospital_id=$1 AND d.kind='dispense' AND concat_ws(' ',p.name,p.record_number,p.canonical_record_number,pr.name,b.lot) ILIKE $2 AND d.quantity>coalesce((SELECT sum((r.data->>'quantity')::integer) FROM department_records r WHERE r.hospital_id=d.hospital_id AND r.kind='return' AND r.data->>'dispenseId'=d.id::text),0)`;
    map = (r) => ({
      id: r.id,
      label: `${person(r)} · ${r.product_name} · Lot ${r.lot} · ${r.quantity - r.returned} ${r.unit} returnable`,
      values: { dispenseId: r.id },
      data: { returnable: r.quantity - r.returned, unit: r.unit },
    });
  } else if (q.kind === 'invoices') {
    sql = `SELECT inv.*,p.name patient_name,p.record_number,p.canonical_record_number FROM (${selectInvoice} WHERE i.hospital_id=$1) inv JOIN outpatient_visits v ON (v.hospital_id,v.id)=(inv.hospital_id,inv.visit_id) JOIN patient_directory p ON (p.hospital_id,p.id)=(v.hospital_id,v.patient_id) WHERE NOT inv.voided AND concat_ws(' ',p.name,p.record_number,p.canonical_record_number,inv.number) ILIKE $2`;
    map = (r) => {
      const n = financialProjection(
        r.total_minor,
        r.collected_minor,
        r.credited_minor,
        r.refunded_minor,
      );
      return {
        id: r.id,
        label: `${r.number} · ${person(r)} · Net ${money(n.totalMinor)} · Paid ${money(n.paidMinor)}`,
        values: { invoiceId: r.id, expectedRevision: String(r.revision) },
        data: { number: r.number, ...n },
      };
    };
  } else if (q.kind === 'payments') {
    if (!q.invoiceId) return { entries: [], total: 0, page: q.page, pageSize: 25 };
    args.push(q.invoiceId);
    sql = `SELECT p.id,p.amount_minor,p.method,r.number receipt_number,coalesce((SELECT sum(f.amount_minor) FROM department_finance f WHERE f.hospital_id=p.hospital_id AND f.payment_id=p.id),0)::integer refunded FROM billing_payments p JOIN billing_receipts r ON (r.hospital_id,r.payment_id)=(p.hospital_id,p.id) WHERE p.hospital_id=$1 AND p.invoice_id=$3 AND r.number ILIKE $2`;
    map = (r) => ({
      id: r.id,
      label: `${r.receipt_number} · ${money(r.amount_minor)} · ${r.method === 'cash' ? 'Cash' : 'Manual transfer'} · ${money(r.amount_minor - r.refunded)} unreversed`,
      values: { paymentId: r.id, method: r.method },
      data: { amountMinor: r.amount_minor, remainingMinor: r.amount_minor - r.refunded },
    });
  } else {
    sql = `SELECT entry.*,p.name patient_name,p.record_number,p.canonical_record_number FROM (SELECT pay.id,pay.invoice_id,pay.hospital_id,pay.amount_minor,'payment' kind,'payment' finance_kind,r.number label FROM billing_payments pay JOIN billing_receipts r ON (r.hospital_id,r.payment_id)=(pay.hospital_id,pay.id) WHERE pay.hospital_id=$1 AND pay.method='cash' AND NOT EXISTS(SELECT 1 FROM department_allocations a WHERE (a.hospital_id,a.payment_id)=(pay.hospital_id,pay.id)) UNION ALL SELECT f.id,f.invoice_id,f.hospital_id,f.amount_minor,'refund' kind,f.kind finance_kind,concat('Recorded ',f.kind) label FROM department_finance f WHERE f.hospital_id=$1 AND f.method='cash' AND f.kind IN ('refund','reversal') AND NOT EXISTS(SELECT 1 FROM department_allocations a WHERE (a.hospital_id,a.refund_id)=(f.hospital_id,f.id))) entry JOIN billing_invoices i ON (i.hospital_id,i.id)=(entry.hospital_id,entry.invoice_id) JOIN outpatient_visits v ON (v.hospital_id,v.id)=(i.hospital_id,i.visit_id) JOIN patient_directory p ON (p.hospital_id,p.id)=(v.hospital_id,v.patient_id) WHERE concat_ws(' ',entry.label,p.name,p.record_number) ILIKE $2`;
    map = (r) => ({
      id: r.id,
      label: `${r.label} · ${person(r)} · ${money(r.amount_minor)} cash ${r.kind === 'payment' ? 'received' : 'paid out'}`,
      values: { [r.kind === 'payment' ? 'paymentId' : 'refundId']: r.id },
      data: { kind: r.kind, amountMinor: r.amount_minor },
    });
  }
  const total = Number(
    (await c.query(`SELECT count(*)::text total FROM (${sql}) source`, args)).rows[0].total,
  );
  const rows = (
    await c.query(
      `SELECT * FROM (${sql}) choices ORDER BY id LIMIT 25 OFFSET $${args.length + 1}`,
      [...args, (q.page - 1) * 25],
    )
  ).rows;
  return {
    entries: rows.map((row) => ({
      ...map(row),
      presentation: {
        kind: q.kind,
        values: {
          patientName: row.patient_name ?? '',
          recordNumber: row.record_number ?? '',
          canonicalRecordNumber: row.canonical_record_number ?? '',
          productName: row.product_name ?? row.name ?? '',
          unit: row.product_unit ?? row.unit ?? '',
          lot: row.lot ?? '',
          expiry: row.expiry ?? '',
          balance: row.balance ?? '',
          quarantined: row.quarantined ?? false,
          test: row.test ?? row.data?.catalog?.name ?? '',
          catalogId: row.catalog_id ?? '',
          accession: row.data?.accession ?? '',
          status: row.data?.status ?? '',
          quantity: row.data?.quantity ?? (row.quantity ?? 0) - (row.returned ?? 0),
          supplierName: row.supplier_name ?? '',
          products: (row.product_names ?? []).join(', '),
          ownerName: row.owner_name ?? '',
          openingMinor: String(row.data?.openingMinor ?? 0),
          createdAt: row.created_at?.toISOString() ?? '',
          number: row.number ?? row.receipt_number ?? '',
          netMinor: String(map(row).data?.totalMinor ?? 0),
          paidMinor: String(map(row).data?.paidMinor ?? 0),
          amountMinor: String(row.amount_minor ?? 0),
          remainingMinor: String(BigInt(row.amount_minor ?? 0) - BigInt(row.refunded ?? 0)),
          method: row.method ?? '',
          kind: row.kind ?? '',
          financeKind: row.finance_kind ?? '',
          entryLabel: row.kind === 'payment' ? (row.label ?? '') : '',
          direction: row.kind === 'payment' ? 'received' : 'paid_out',
        },
      },
    })),
    total,
    page: q.page,
    pageSize: 25,
  };
}
