import { z } from 'zod';
export const registrationSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine((value) => !value.includes('\u0000')),
  age: z.number().int().min(0).max(120).optional(),
  contact: z
    .string()
    .trim()
    .max(100)
    .refine((value) => !value.includes('\u0000'))
    .default(''),
  confirmDuplicate: z.boolean().optional(),
});
// Validate raw controls before trimming, then bound the normalized identity.
export const staffUsernameSchema = z
  .string()
  .refine((value) => !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(value))
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.string().min(1).max(100));
export const loginSchema = z.strictObject({
  hospitalCode: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/),
  username: staffUsernameSchema,
  password: z.string().min(1).max(256),
});
export type Registration = z.infer<typeof registrationSchema>;
export type StaffRole =
  'admin' | 'receptionist' | 'auditor' | 'clinician' | 'lab' | 'pharmacist' | 'cashier' | 'nurse';
export type StaffUser = {
  id: string;
  displayName: string;
  role: StaffRole;
  hospital: { id: string; name: string; code: string };
};
export type AuthState = 'enrollment' | 'challenge' | 'recovery_enrollment' | 'complete';
export type Session = {
  sessionFamily: string;
  authState: AuthState;
  factorGeneration: number;
  user: StaffUser;
  csrfToken: string;
  expiresAt: string;
  passwordChangeRequired: boolean;
};
export type RegisteredPatient = {
  id: string;
  recordNumber: string;
  name: string;
  age?: number;
  contact: string;
  createdAt: string;
  canonicalId?: string;
  canonicalRecordNumber?: string;
};
export type PatientPage = {
  patients: RegisteredPatient[];
  total: number;
  page: number;
  pageSize: number;
};
