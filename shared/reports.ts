import { z } from 'zod';
import type { StaffRole } from './registration.ts';
const date = z.iso.date().refine(value => value >= '0001-01-01');
export const reportQuerySchema = z.strictObject({ from: date, to: date, inventoryPage: z.coerce.number().int().min(1).max(10000).default(1) }).refine(value => {
  const days = (Date.parse(`${value.to}T00:00:00Z`) - Date.parse(`${value.from}T00:00:00Z`)) / 86400000;
  return days >= 0 && days < 366;
}, { message: 'Choose an inclusive range of up to 366 days.' });
export type ReportSection = 'operations' | 'finance' | 'inventory';
export const reportSections: Record<StaffRole, readonly ReportSection[]> = {
  admin: ['operations','finance','inventory'], auditor: ['operations','finance','inventory'],
  clinician: ['operations'], cashier: ['finance'], pharmacist: ['inventory'], receptionist: [], lab: [],
};
export type ReportRange = { from:string; to:string; timezone:'Africa/Addis_Ababa'; start:string; endExclusive:string };
export type ReportOperations = {
  period: { visitsOpened:number; visitsClosed:number; noteAmendments:number; resultCorrections:number };
  current: { activeVisits:number; pendingInvestigations:number; pendingPrescriptions:number; pendingCorrectedResultReviews:number };
};
type Receipts = { receiptCount:number; collectedMinor:string };
export type ReportFinance = { currency:'ETB'; legacyExcluded:true; period:Receipts & { byMethod:{ cash:Receipts; manual_transfer:Receipts } }; current:{ outstandingInvoiceCount:number; outstandingMinor:string } };
export type ReportProduct = { productId:string; code:string; name:string; unit:string; active:boolean;
  current:{ total:string; available:string; inactive:string; quarantined:string; expired:string; expiryToday:string };
  period:{ received:string; supplied:string; adjustmentNet:string; movementNet:string } };
export type OperationalReport = { auditId:string; generatedAt:string; range:ReportRange; authorizedSections:ReportSection[];
  operations?:ReportOperations; finance?:ReportFinance; inventory?:{ today:string; page:number; pageSize:25; total:number; entries:ReportProduct[] } };
