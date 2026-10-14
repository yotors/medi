import { z } from 'zod';
export const MAX_PRICE_MINOR = 999999999;
/** Parse decimal ETB without floating-point multiplication or rounding. */
export function parseETB(value: string): number | null {
  if (!/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return minor <= MAX_PRICE_MINOR ? minor : null;
}
export function formatETB(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0 || minor > MAX_PRICE_MINOR)
    throw new RangeError('Invalid ETB amount.');
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
}
const name = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value));
const code = z.string().regex(/^[A-Z][A-Z0-9_-]{1,31}$/);
const revision = z.number().int().min(1).max(2147483646);
const priceMinor = z.number().int().min(0).max(MAX_PRICE_MINOR);
export const configurationCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('department.create'), code, name }),
  z.strictObject({
    type: z.literal('department.update'),
    id: z.uuid(),
    expectedRevision: revision,
    name,
    active: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('service.create'),
    code,
    name,
    departmentId: z.uuid(),
    priceMinor,
  }),
  z.strictObject({
    type: z.literal('service.update'),
    id: z.uuid(),
    expectedRevision: revision,
    name,
    departmentId: z.uuid(),
    priceMinor,
    active: z.boolean(),
  }),
]);
export const configurationQuerySchema = z.strictObject({
  q: z
    .string()
    .trim()
    .max(120)
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value))
    .default(''),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  active: z.literal('true').optional(),
});
export type ConfigurationCommand = z.infer<typeof configurationCommandSchema>;
export type Department = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  revision: number;
};
export type Service = Department & {
  departmentId: string;
  departmentCode: string;
  departmentName: string;
  departmentActive: boolean;
  priceMinor: number;
  currency: 'ETB';
  effectiveAt: string;
};
export type ConfigurationItem = Department | Service;
export type ConfigurationList = {
  entries: ConfigurationItem[];
  total: number;
  page: number;
  pageSize: number;
};
export type ConfigurationResult = { entry: ConfigurationItem };
export type ConfigurationHistory = {
  events: {
    id: string;
    action: string;
    actorId: string;
    actorName: string;
    revision: number;
    createdAt: string;
    snapshot: ConfigurationItem;
  }[];
  total: number;
  page: number;
  pageSize: number;
};
