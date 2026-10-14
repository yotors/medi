import { z } from 'zod';
import type { BillingSummary } from './billing.ts';
import type { Visit } from '../src/domain.ts';
import type { RegisteredPatient, StaffRole } from './registration.ts';
const text = z.string().trim().min(1).max(4000).refine(value => !value.includes('\u0000'));
const uuid = z.uuid();
export const visitCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('note'), body: text }),
  z.strictObject({ type: z.literal('order'), test: z.enum(['Blood count', 'Urinalysis', 'Blood glucose']) }),
  z.strictObject({ type: z.literal('advanceOrder'), orderId: uuid, next: z.enum(['collected', 'released', 'reviewed', 'cancelled']), result: text.optional() }),
  z.strictObject({ type: z.literal('prescribe'), instruction: text }),
  z.strictObject({ type: z.literal('fulfill'), prescriptionId: uuid, next: z.enum(['fulfilled', 'cancelled']) }),
  z.strictObject({ type: z.literal('settle') }),
  z.strictObject({ type: z.literal('close') }),
]);
export const commandRequestSchema = z.strictObject({ expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), command: visitCommandSchema });
export type VisitCommand = z.infer<typeof visitCommandSchema>;
export type VisitSection = 'Consultation' | 'Diagnostics' | 'Pharmacy' | 'Billing' | 'History';
export type VisitAction = 'checkIn' | 'note' | 'order' | 'prescribe' | 'collect' | 'release' | 'review' | 'cancelOrder' | 'fulfill' | 'settle' | 'close';
export const roleActions: Record<StaffRole, readonly VisitAction[]> = {
  admin: ['checkIn','note','order','prescribe','collect','release','review','cancelOrder','fulfill','settle','close'],
  receptionist: ['checkIn'], clinician: ['note','order','prescribe','review','cancelOrder','close'],
  lab: ['collect','release'], pharmacist: ['fulfill'], cashier: ['settle'], auditor: [],
};
export const roleSections: Record<StaffRole, readonly VisitSection[]> = {
  admin: ['Consultation','Diagnostics','Pharmacy','Billing','History'],
  receptionist: [], clinician: ['Consultation','Diagnostics','Pharmacy'], lab: ['Diagnostics'],
  pharmacist: ['Pharmacy'], cashier: ['Billing'], auditor: ['Billing','History'],
};
export function commandAction(command: VisitCommand): VisitAction {
  if (command.type === 'advanceOrder') return ({ collected:'collect', released:'release', reviewed:'review', cancelled:'cancelOrder' } as const)[command.next];
  return command.type;
}
export type VisitSummary = {
  id: string; patient: RegisteredPatient; status: 'active' | 'closed'; stage: string;
  financialMode: 'catalog' | 'legacy_demo'; billing?: BillingSummary;
  revision: number; openedAt: string; closedAt?: string; balance: number;
  blockers: string[]; pendingInvestigations: number; pendingPrescriptions: number;
};
export type VisitView = VisitSummary & {
  sections: readonly VisitSection[]; allowedActions: readonly VisitAction[];
  notes?: Visit['notes']; orders?: Visit['orders']; prescriptions?: Visit['prescriptions'];
  charges?: Visit['charges']; payments?: Visit['payments'];
  history?: { id: string; at: string; actor: string; detail: string }[];
};
export type VisitPage = { visits: VisitSummary[]; total: number; page: number; pageSize: number };
