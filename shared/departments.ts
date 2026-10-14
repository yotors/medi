import { z } from 'zod';
const id = z.uuid().transform((v) => v.toLowerCase());
const text = (n: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(n)
    .refine((v) => !/[\u0000-\u001f\u007f]/.test(v));
const rev = z.number().int().min(1).max(2147483646),
  qty = z.number().int().min(1).max(1000000),
  money = z.number().int().min(1).max(999999999);
const target = { id, expectedRevision: rev };
export const departmentCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('lab.catalog'),
    code: text(40),
    name: text(200),
    specimen: text(80),
    unit: text(40),
    criticalLow: z.number().finite().optional(),
    criticalHigh: z.number().finite().optional(),
  }),
  z.strictObject({
    type: z.literal('lab.register'),
    catalogId: id,
    visitId: id,
    orderId: id,
    accession: text(100),
    clinicianId: id,
  }),
  z.strictObject({ type: z.literal('lab.collect'), ...target }),
  z.strictObject({ type: z.literal('lab.receive'), ...target }),
  z.strictObject({ type: z.literal('lab.reject'), ...target, reason: text(500) }),
  z.strictObject({
    type: z.literal('lab.recollect'),
    ...target,
    accession: text(100),
    reason: text(500),
  }),
  z.strictObject({
    type: z.literal('lab.result'),
    ...target,
    value: text(1000),
    numericValue: z.number().finite().optional(),
    critical: z.boolean(),
    reason: text(500).optional(),
  }),
  z.strictObject({ type: z.literal('lab.release'), ...target }),
  z.strictObject({
    type: z.literal('lab.acknowledge'),
    ...target,
    delivery: text(500),
    acknowledgement: text(500),
  }),
  z.strictObject({ type: z.literal('supplier.create'), name: text(200), contact: text(200) }),
  z.strictObject({
    type: z.literal('purchase.create'),
    supplierId: id,
    lines: z
      .array(
        z.strictObject({
          productId: id,
          unit: text(40),
          quantity: qty,
          costMinor: money,
          packSize: qty,
          controlled: z.boolean(),
        }),
      )
      .min(1)
      .max(20),
  }),
  z.strictObject({ type: z.literal('purchase.approve'), ...target, reason: text(500) }),
  z.strictObject({
    type: z.literal('purchase.receive'),
    ...target,
    line: z.number().int().min(0).max(19),
    batchId: id,
    expectedBatchRevision: rev,
    quantity: qty,
    authorization: text(500).optional(),
  }),
  z.strictObject({ type: z.literal('purchase.cancel'), ...target, reason: text(500) }),
  z.strictObject({
    type: z.literal('return.record'),
    dispenseId: id,
    quantity: qty,
    reason: text(500),
  }),
  z.strictObject({
    type: z.literal('return.quality'),
    ...target,
    decision: z.enum(['restock', 'destroy']),
    reason: text(500),
    expectedBatchRevision: rev,
  }),
  z.strictObject({
    type: z.literal('invoice.credit'),
    invoiceId: id,
    expectedRevision: rev,
    amountMinor: money,
    kind: z.enum(['credit', 'discount']),
    reason: text(500),
  }),
  z
    .strictObject({
      type: z.literal('payment.refund'),
      invoiceId: id,
      paymentId: id,
      expectedRevision: rev,
      amountMinor: money,
      kind: z.enum(['refund', 'reversal']),
      reason: text(500),
      method: z.enum(['cash', 'manual_transfer']),
      reference: text(200).optional(),
    })
    .refine((v) => v.method !== 'manual_transfer' || !!v.reference),
  z.strictObject({
    type: z.literal('shift.open'),
    openingMinor: z.number().int().min(0).max(999999999),
  }),
  z
    .strictObject({
      type: z.literal('shift.allocate'),
      ...target,
      paymentId: id.optional(),
      refundId: id.optional(),
    })
    .refine((v) => !!v.paymentId !== !!v.refundId),
  z.strictObject({
    type: z.literal('shift.close'),
    ...target,
    countedMinor: z.number().int().min(0).max(999999999),
    signature: text(200),
  }),
  z.strictObject({ type: z.literal('shift.review'), ...target, reason: text(500) }),
]);
export type DepartmentCommand = z.infer<typeof departmentCommandSchema>;
export type DepartmentKind =
  'catalog' | 'specimen' | 'supplier' | 'purchase' | 'return' | 'shift' | 'finance';
export type DepartmentRecord = {
  id: string;
  kind: DepartmentKind;
  revision: number;
  data: Record<string, any>;
};
export type DepartmentEvent = {
  id: string;
  entityId: string;
  action: string;
  actorId: string;
  actorName: string;
  at: string;
  snapshot: Record<string, any>;
};
export type DepartmentPage = {
  entries: DepartmentRecord[];
  page: number;
  pageSize: number;
  total: number;
};
export function financialProjection(
  charge: number,
  collected: number,
  credited: number,
  refunded: number,
) {
  for (const amount of [charge, collected, credited, refunded])
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 999999999)
      throw new Error('Invalid minor-unit total');
  if (credited > charge || refunded > collected) throw new Error('Invalid financial adjustment');
  const totalMinor = charge - credited,
    paidMinor = collected - refunded;
  return {
    totalMinor,
    paidMinor,
    creditedMinor: credited,
    refundedMinor: refunded,
    balanceMinor: Math.max(0, totalMinor - paidMinor),
    refundableMinor: Math.max(0, paidMinor - totalMinor),
  };
}
export const departmentSourceSchema = z.strictObject({
  kind: z.enum([
    'catalog',
    'specimen',
    'supplier',
    'purchase',
    'return',
    'shift',
    'orders',
    'clinicians',
    'products',
    'batches',
    'dispenses',
    'invoices',
    'payments',
    'cashEntries',
  ]),
  q: z
    .string()
    .trim()
    .max(100)
    .refine((v) => !/[\u0000-\u001f\u007f]/.test(v))
    .default(''),
  page: z.number().int().min(1).max(10000).default(1),
  invoiceId: id.optional(),
  productId: id.optional(),
  recordId: id.optional(),
  action: z
    .enum([
      'lab.collect',
      'lab.receive',
      'lab.reject',
      'lab.recollect',
      'lab.result',
      'lab.release',
      'lab.acknowledge',
      'purchase.approve',
      'purchase.receive',
      'purchase.cancel',
      'return.quality',
      'shift.allocate',
      'shift.close',
      'shift.review',
    ])
    .optional(),
});
export type DepartmentSourceQuery = z.infer<typeof departmentSourceSchema>;
export type DepartmentChoice = {
  id: string;
  label: string;
  values: Record<string, string>;
  data?: Record<string, any>;
};
export type DepartmentSources = {
  entries: DepartmentChoice[];
  total: number;
  page: number;
  pageSize: number;
};
