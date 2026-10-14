import { z } from 'zod';
export const inventoryUuid = z.uuid().transform((value) => value.toLowerCase());
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !value.includes('\0'));
const revision = z.number().int().min(1).max(2147483646);
const quantity = z.number().int().min(1).max(1000000);
export const inventoryCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('product.create'),
    code: text(40)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
      .transform((value) => value.toUpperCase()),
    name: text(200),
    unit: text(40),
  }),
  z.strictObject({
    type: z.literal('product.status'),
    productId: inventoryUuid,
    expectedRevision: revision,
    active: z.boolean(),
    reason: text(500),
  }),
  z.strictObject({
    type: z.literal('batch.create'),
    productId: inventoryUuid,
    lot: text(100),
    expiry: z.iso.date().refine((value) => value >= '2000-01-01' && value <= '2199-12-31'),
  }),
  z.strictObject({
    type: z.literal('batch.status'),
    batchId: inventoryUuid,
    expectedRevision: revision,
    quarantined: z.boolean(),
    reason: text(500),
  }),
  z.strictObject({
    type: z.literal('stock.receive'),
    batchId: inventoryUuid,
    expectedRevision: revision,
    quantity,
    reference: text(200),
  }),
  z.strictObject({
    type: z.literal('stock.adjust'),
    batchId: inventoryUuid,
    expectedRevision: revision,
    quantity: z
      .number()
      .int()
      .min(-1000000)
      .max(1000000)
      .refine((value) => value !== 0),
    reason: text(500),
  }),
]);
export const pharmacyCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('authorize'),
    prescriptionId: inventoryUuid,
    expectedVisitRevision: revision,
    productId: inventoryUuid,
    quantity,
  }),
  z.strictObject({
    type: z.literal('dispense'),
    prescriptionId: inventoryUuid,
    expectedVisitRevision: revision,
    batchId: inventoryUuid,
    expectedBatchRevision: revision,
    quantity,
  }),
  z.strictObject({
    type: z.literal('cancel'),
    prescriptionId: inventoryUuid,
    expectedVisitRevision: revision,
    reason: text(500),
  }),
]);
export type InventoryCommand = z.infer<typeof inventoryCommandSchema>;
export type PharmacyCommand = z.infer<typeof pharmacyCommandSchema>;
export type InventoryProduct = {
  id: string;
  code: string;
  name: string;
  unit: string;
  active: boolean;
  revision: number;
};
export type InventoryBatch = {
  id: string;
  productId: string;
  lot: string;
  expiry: string;
  quarantined: boolean;
  revision: number;
  balance: number;
  eligibility: 'available' | 'expired' | 'expiry_today' | 'quarantined' | 'inactive';
};
export type InventoryPage<T> = { entries: T[]; total: number; page: number; pageSize: number };
export type InventoryBatches = InventoryPage<InventoryBatch> & {
  product: InventoryProduct;
  today: string;
  selectedBatch?: InventoryBatch;
};
export type InventoryEvent = {
  id: string;
  action: string;
  actorId: string;
  actorName: string;
  at: string;
  productId: string;
  batchId?: string;
  visitId?: string;
  prescriptionId?: string;
  snapshot: Record<string, string | number | boolean>;
};
export type PharmacyAuthorization = {
  id: string;
  prescriptionId: string;
  product: InventoryProduct;
  quantity: number;
  supplied: number;
  remaining: number;
  cancelled: boolean;
  actorId: string;
  actorName: string;
  at: string;
};
export type InventoryResult = {
  eventId: string;
  productId: string;
  batchId?: string;
  visitRevision?: number;
};
