import { z } from 'zod';
export const registrationSchema = z.strictObject({
  name: z.string().trim().min(1).max(100).refine(value => !value.includes('\u0000')),
  age: z.number().int().min(0).max(120).optional(),
  contact: z.string().trim().max(100).refine(value => !value.includes('\u0000')).default(''),
  confirmDuplicate: z.boolean().optional(),
});
export const loginSchema = z.strictObject({
  hospitalCode: z.string().trim().toLowerCase().min(1).max(60).regex(/^[a-z0-9-]+$/),
  username: z.string().trim().toLowerCase().min(1).max(100).refine(value => !value.includes('\u0000')),
  password: z.string().min(1).max(256),
});
export type Registration = z.infer<typeof registrationSchema>;
export type StaffRole = 'admin' | 'receptionist' | 'auditor' | 'clinician' | 'lab' | 'pharmacist' | 'cashier';
export type StaffUser = { id: string; displayName: string; role: StaffRole; hospital: { id: string; name: string; code: string } };
export type Session = { user: StaffUser; csrfToken: string; expiresAt: string };
export type RegisteredPatient = { id: string; recordNumber: string; name: string; age?: number; contact: string; createdAt: string };
export type PatientPage = { patients: RegisteredPatient[]; total: number; page: number; pageSize: number };
