import { z } from 'zod';
const text = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(v.replaceAll('\n', '')));
const required = (max = 2000) => text(max).pipe(z.string().min(1));
const id = z.uuid();
const time = z.iso
  .datetime({ offset: true })
  .refine(
    (v) =>
      Date.parse(v) >= Date.parse('1900-01-01T00:00:00Z') &&
      Date.parse(v) < Date.parse('2101-01-01T00:00:00Z'),
    'Enter a date between 1900 and 2100.',
  );
const reason = required(1000);
export const careKinds = [
  'profile',
  'appointment',
  'triage',
  'ward',
  'bed',
  'admission',
  'nursing',
  'medication',
  'administration',
  'referral',
] as const;
export const careKindSchema = z.enum(careKinds);
export type CareKind = z.infer<typeof careKindSchema>;
const profile = z
  .strictObject({
    name: required(100),
    contact: text(100),
    dateOfBirth: z.iso.date().nullable(),
    sex: z.enum(['female', 'male', 'other', 'unknown']),
    address: text(500),
    emergencyContact: text(300),
    identity: z.enum(['provisional', 'verified']),
    allergiesStatus: z.enum(['not-entered', 'none-known', 'entered']),
    allergies: text(2000),
  })
  .refine((v) => v.allergiesStatus !== 'entered' || !!v.allergies, 'Enter the allergies.')
  .refine(
    (v) => !v.dateOfBirth || v.dateOfBirth <= new Date().toISOString().slice(0, 10),
    'Date of birth cannot be in the future.',
  );
const appointment = z
  .strictObject({
    clinicianId: id,
    service: required(120),
    facility: required(120),
    start: time,
    end: time,
    status: z.enum(['booked', 'arrived', 'cancelled', 'no-show']),
    visitId: id.optional(),
  })
  .refine(
    (v) =>
      Date.parse(v.start) < Date.parse(v.end) &&
      Date.parse(v.end) - Date.parse(v.start) <= 86400000,
    'End must follow start within 24 hours.',
  );
// Bounds prevent numeric overflow; they are not clinical plausibility thresholds.
const observationNumber = z.number().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const observationCount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const triage = z.strictObject({
  encounterId: id.optional(),
  urgency: z.enum(['routine', 'urgent', 'emergency']),
  symptoms: required(),
  eventAt: time,
  temperatureC: observationNumber.optional(),
  pulsePerMinute: observationCount.optional(),
  systolicMmHg: observationNumber.optional(),
  diastolicMmHg: observationNumber.optional(),
  respiratoryPerMinute: observationCount.optional(),
  oxygenPercent: z.number().min(0).max(100).optional(),
  weightKg: z.number().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
});
const ward = z.strictObject({ name: required(100), facility: required(120), active: z.boolean() });
const bed = z.strictObject({ wardId: id, name: required(100), active: z.boolean() });
const admission = z.strictObject({
  bedId: id,
  clinicianId: id,
  reason,
  eventAt: time,
  status: z.enum(['active', 'discharged']),
  summary: text(6000).default(''),
  disposition: text(300).default(''),
  followUp: text(2000).default(''),
});
const nursing = z.strictObject({
  admissionId: id,
  eventAt: time,
  shift: required(100),
  observation: required(4000),
});
const medication = z.strictObject({
  admissionId: id,
  drug: required(300),
  dose: z.number().gt(0).max(1000000),
  unit: required(80),
  route: required(100),
  scheduledAt: time,
  instructions: required(2000),
  status: z.enum(['ordered', 'stopped', 'cancelled']),
});
const administration = z
  .strictObject({
    medicationId: id,
    eventAt: time,
    outcome: z.enum(['given', 'withheld', 'refused']),
    reason: text(1000),
  })
  .refine((v) => v.outcome === 'given' || !!v.reason, 'Enter the reason.');
const referral = z.strictObject({
  type: z.enum(['referral', 'follow-up']),
  destination: required(300),
  reason,
  dueAt: time,
  ownerId: id,
  status: z.enum(['pending', 'completed', 'cancelled']),
});
export const careSchemas = {
  profile,
  appointment,
  triage,
  ward,
  bed,
  admission,
  nursing,
  medication,
  administration,
  referral,
};
export type CareData = { [K in CareKind]: z.infer<(typeof careSchemas)[K]> };
export const careWriteSchema = z.strictObject({
  kind: careKindSchema,
  id: id.optional(),
  patientId: id.optional(),
  expectedRevision: z.number().int().min(0),
  reason,
  data: z.unknown(),
});
export const careSearchSchema = z.strictObject({
  kind: careKindSchema,
  patientId: id.optional(),
  parentId: id.optional(),
  page: z.number().int().min(1).max(10000).default(1),
  today: z.boolean().default(false),
});
export type CareRecord<K extends CareKind = CareKind> = {
  id: string;
  kind: K;
  patientId: string | null;
  parentId: string | null;
  revision: number;
  data: CareData[K];
  actorName: string;
  createdAt: string;
  updatedAt: string;
  patient?: { id: string; name: string; recordNumber: string };
};
export type CareEvent = {
  id: string;
  recordId: string;
  revision: number;
  actorName: string;
  createdAt: string;
  reason: string;
  data: unknown;
};
export type CarePage = { records: CareRecord[]; total: number; page: number; pageSize: number };
export const careReadRoles = [
  'admin',
  'receptionist',
  'clinician',
  'nurse',
  'auditor',
  'pharmacist',
];
export function canReadCare(role: string, kind: CareKind) {
  return role === 'pharmacist'
    ? ['profile', 'medication'].includes(kind)
    : careReadRoles.includes(role) &&
        (role !== 'receptionist' ||
          ['profile', 'appointment', 'ward', 'bed', 'admission', 'referral'].includes(kind));
}
export function canWriteCare(role: string, kind: CareKind, data?: Record<string, unknown>) {
  if (role === 'admin')
    return (
      !['medication', 'administration'].includes(kind) &&
      !(kind === 'admission' && data?.status === 'discharged')
    );
  if (role === 'receptionist')
    return (
      ['profile', 'appointment'].includes(kind) ||
      (kind === 'admission' && data?.status === 'active')
    );
  if (role === 'clinician')
    return (
      ['profile', 'appointment', 'triage', 'nursing', 'medication', 'referral'].includes(kind) ||
      kind === 'admission'
    );
  return role === 'nurse' && ['triage', 'nursing', 'administration'].includes(kind);
}
