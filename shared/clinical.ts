import { z } from 'zod';
export const clinicalUuid = z.uuid().transform(value => value.toLowerCase());
const text = z.string().trim().min(1).max(4000).refine(value => !value.includes('\0'));
const reason = z.string().trim().min(1).max(500).refine(value => !value.includes('\0'));
const version = z.number().int().nonnegative().max(2147483646);
export const clinicalCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('note.amend'), subjectId: clinicalUuid, expectedVersion: version, body: text, reason }),
  z.strictObject({ type: z.literal('result.correct'), subjectId: clinicalUuid, expectedVersion: version, body: text, reason, ownerId: clinicalUuid }),
  z.strictObject({ type: z.literal('result.review'), subjectId: clinicalUuid, expectedVersion: version, amendmentId: clinicalUuid }),
  z.strictObject({ type: z.literal('result.takeover'), subjectId: clinicalUuid, expectedVersion: version, amendmentId: clinicalUuid, reason }),
]);
export type ClinicalCommand = z.infer<typeof clinicalCommandSchema>;
export type ClinicalEvent = {
  id: string; amendmentId: string; version: number; action: ClinicalCommand['type'];
  actorId: string; actorName: string; at: string; reason?: string;
  ownerId?: string; ownerName?: string;
};
export type ClinicalAmendment = { id: string; body: string; reason: string; version: number; actorId: string; actorName: string; at: string };
export type ClinicalRecord = {
  kind: 'note' | 'result'; subjectId: string; version: number;
  originalActor?: { id: string; username: string; currentName: string }; originalAt?: string;
  latest: ClinicalAmendment;
  review?: { amendmentId: string; ownerId: string; ownerName: string; ownerActive: boolean; reviewed: boolean; reviewerName?: string; reviewedAt?: string };
};
export type ClinicalDetail = { records: ClinicalRecord[]; pendingReviews: number };
export type ClinicalReviewer = { id: string; name: string; username: string; role: 'admin' | 'clinician' };
export type ClinicalHistoryEntry = ClinicalEvent & { kind: 'note' | 'result'; subjectId: string; amendment?: { body: string; reason: string } };
export type ClinicalHistoryPage = { events: ClinicalHistoryEntry[]; total: number; page: number; pageSize: number };
export type ClinicalAssignment = { subjectId: string; correctedAt: string; ownerId: string; ownerName: string; ownerUsername: string; ownerRole: string };
export type ClinicalResult = { eventId: string; subjectId: string; version: number };
