import { z } from 'zod';
import { staffUsernameSchema, type StaffRole } from './registration.ts';
export const staffRoles = ['admin', 'receptionist', 'auditor', 'clinician', 'lab', 'pharmacist', 'cashier'] as const;
const accountText = z.string().trim().min(1).max(100).refine(value => !value.includes('\u0000'));
export const passwordSchema = z.string().min(12).max(256).refine(value => !value.includes('\u0000'));
const temporaryPasswordSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const revisionSchema = z.number().int().positive();
const currentPasswordSchema = z.string().min(1).max(256);
export const administrationCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('create'), username: staffUsernameSchema, displayName: accountText, role: z.enum(staffRoles), temporaryPassword: temporaryPasswordSchema }),
  z.strictObject({ type: z.literal('update'), accountId: z.uuid(), expectedRevision: revisionSchema, role: z.enum(staffRoles), active: z.boolean() }),
  z.strictObject({ type: z.literal('reset'), accountId: z.uuid(), expectedRevision: revisionSchema, temporaryPassword: temporaryPasswordSchema }),
]);
export const administrationRequestSchema = z.strictObject({ currentPassword: currentPasswordSchema, command: administrationCommandSchema });
export const passwordChangeSchema = z.strictObject({ currentPassword: currentPasswordSchema, newPassword: passwordSchema });
const pageSchema = z.coerce.number().int().min(1).max(10000).default(1);
export const staffQuerySchema = z.strictObject({ q: z.string().trim().max(100).refine(value => !value.includes('\u0000')).default(''), page: pageSchema });
export const staffHistoryQuerySchema = z.strictObject({ page: pageSchema });
export const staffAccountQuerySchema = z.strictObject({});
export const staffAccountParamsSchema = z.strictObject({ id: z.uuid() });
export type AdministrationCommand = z.infer<typeof administrationCommandSchema>;
export type StaffAccount = { id: string; username: string; displayName: string; role: StaffRole; active: boolean; revision: number; passwordChangeRequired: boolean; firstEnrollmentEligible: boolean };
export type StaffAccountResponse = { account: StaffAccount };
export type StaffDirectory = { accounts: StaffAccount[]; total: number; page: number; pageSize: number };
export type StaffHistoryEvent = { id: string; actorId: string; actorUsername: string; actorName: string; action: string; createdAt: string; revision: number; role: StaffRole; active: boolean };
export type StaffHistory = { events: StaffHistoryEvent[]; total: number; page: number; pageSize: number };
