import { z } from 'zod';
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !/[\u0000-\u001f\u007f]/.test(s));
const id = z.uuid(),
  revision = z.number().int().positive().max(2147483646),
  reason = text(500);
export const exportTables = [
  'staff_users',
  'patients',
  'outpatient_visits',
  'audit_events',
  'clinical_amendments',
  'clinical_events',
  'billing_invoices',
  'billing_lines',
  'billing_payments',
  'billing_receipts',
  'billing_events',
  'inventory_products',
  'inventory_batches',
  'inventory_authorizations',
  'inventory_events',
  'inventory_movements',
  'inventory_dispenses',
  'care_records',
  'care_events',
  'care_identity_links',
  'department_records',
  'department_events',
  'department_finance',
  'department_allocations',
  'department_links',
  'hospital_profiles',
  'hospital_facilities',
  'hospital_record_requests',
  'hospital_record_holds',
  'hospital_governance_events',
  'hospital_departments',
  'hospital_services',
  'hospital_service_versions',
  'hospital_configuration_events',
  'staff_administration_events',
] as const;
export const hospitalCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('profile.update'),
    expectedRevision: revision,
    reason,
    name: text(100),
    phone: z.string().max(100),
    address: z.string().max(500),
    timezone: z.literal('Africa/Addis_Ababa'),
    locale: z.enum(['en-ET', 'am-ET']),
    calendar: z.enum(['gregory', 'ethiopic']),
  }),
  z.strictObject({
    type: z.literal('facility.create'),
    reason,
    code: text(32).regex(/^[A-Z0-9_-]+$/),
    name: text(120),
    address: z.string().max(500),
  }),
  z.strictObject({
    type: z.literal('facility.update'),
    id,
    expectedRevision: revision,
    reason,
    name: text(120),
    address: z.string().max(500),
    active: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('record.request'),
    patientId: id,
    reason,
    requester: text(150),
    purpose: text(500),
    identityVerification: text(500),
  }),
  z.strictObject({
    type: z.literal('record.decide'),
    id,
    expectedRevision: revision,
    reason,
    status: z.enum(['approved', 'denied']),
  }),
  z.strictObject({ type: z.literal('hold.place'), patientId: id, reason }),
  z.strictObject({ type: z.literal('hold.release'), id, expectedRevision: revision, reason }),
  z.strictObject({
    type: z.literal('support.grant'),
    accountId: id,
    reason,
    durationMinutes: z.number().int().min(5).max(240),
  }),
  z.strictObject({ type: z.literal('support.revoke'), accountId: id, reason }),
]);
export type HospitalCommand = z.infer<typeof hospitalCommandSchema>;
export const exportRequestSchema = z.strictObject({
  table: z.enum(exportTables),
  page: z.number().int().min(1).max(100000).default(1),
  purpose: text(500),
});
export const patientExportSchema = z.strictObject({
  requestId: id,
  reason,
  page: z.number().int().min(1).max(100000).default(1),
});
export type HospitalOverview = {
  profile: { name: string; revision: number; settings: Record<string, string> };
  facilities: {
    id: string;
    code: string;
    name: string;
    address: string;
    active: boolean;
    revision: number;
  }[];
  requests: {
    id: string;
    patient_id: string;
    requester: string;
    purpose: string;
    identity_verification: string;
    created_at: string;
    status: string;
    revision: number;
  }[];
  holds: { id: string; patient_id: string; reason: string; active: boolean; revision: number }[];
  support: {
    user_id: string;
    username: string;
    purpose: string;
    expires_at: string;
    revoked: boolean;
  }[];
  staff: { id: string; displayName: string; username: string }[];
};
