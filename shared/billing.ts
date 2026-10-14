import { z } from 'zod';
import { MAX_PRICE_MINOR } from './configuration.ts';
export const billingUuidSchema = z.uuid().transform(value => value.toLowerCase());
const revision = z.number().int().min(1).max(2147483646);
const text = z.string().trim().max(200).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
export const billingCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('invoice.issue'), lines: z.array(z.strictObject({ serviceId: billingUuidSchema, serviceRevision: revision, quantity: z.number().int().min(1).max(100) })).min(1).max(20).refine(lines => new Set(lines.map(line => line.serviceId)).size === lines.length) }),
  z.strictObject({ type: z.literal('payment.record'), invoiceId: billingUuidSchema, expectedRevision: revision, amountMinor: z.number().int().min(1).max(MAX_PRICE_MINOR), method: z.enum(['cash', 'manual_transfer']), reference: text.optional() }).refine(command => command.method !== 'manual_transfer' || Boolean(command.reference)),
  z.strictObject({ type: z.literal('invoice.void'), invoiceId: billingUuidSchema, expectedRevision: revision, reason: text.refine(value => value.length > 0) }),
]);
export const billingQuerySchema = z.strictObject({ page: z.coerce.number().int().min(1).max(10000).default(1) });
export type BillingCommand = z.infer<typeof billingCommandSchema>;
export type BillingSummary = { state: 'unbilled' | 'outstanding' | 'settled'; currency: 'ETB'; totalMinor: number; paidMinor: number; balanceMinor: number };
export type BillingInvoice = { id: string; visitId: string; number: string; revision: number; status: 'issued' | 'void'; currency: 'ETB'; totalMinor: number; paidMinor: number; balanceMinor: number; issuedAt: string; actorId: string; actorName: string };
export type BillingLine = { id: string; position: number; serviceId: string; serviceRevision: number; code: string; name: string; quantity: number; unitPriceMinor: number; totalMinor: number };
export type BillingPayment = { id: string; receiptId: string; receiptNumber: string; amountMinor: number; method: 'cash' | 'manual_transfer'; reference: string; actorId: string; actorName: string; createdAt: string };
export type BillingEvent = { id: string; action: BillingCommand['type']; revision: number; actorId: string; actorName: string; createdAt: string; reason?: string; payment?: BillingPayment };
export type BillingPermissions = { issue: boolean; pay: boolean; void: boolean };
export type BillingPage = { summary: BillingSummary; invoices: BillingInvoice[]; total: number; page: number; pageSize: number; permissions: BillingPermissions };
export type BillingDetail = { invoice: BillingInvoice; lines: BillingLine[]; events: BillingEvent[]; total: number; page: number; pageSize: number };
/** Replays preserve the original operation identity; fetch current projections separately. */
export type BillingResult = { invoiceId: string; receiptId?: string; receiptNumber?: string; replayed: boolean };
