import { z } from 'zod';

const id = z.string().min(1).max(100);
const text = z.string().trim().min(1).max(4000);
const time = z.iso.datetime();
const money = z.number().int().nonnegative().max(100000000);
const patientSchema = z.object({ id, name: z.string().trim().min(1).max(100), age: z.number().int().min(0).max(120).optional(), contact: z.string().max(100), createdAt: time });
const orderSchema = z.object({ id, test: z.enum(['Blood count', 'Urinalysis', 'Blood glucose']), status: z.enum(['requested', 'collected', 'released', 'reviewed', 'cancelled']), result: z.string().max(4000) });
const prescriptionSchema = z.object({ id, instruction: text, status: z.enum(['pending', 'fulfilled', 'cancelled']) });
const chargeSchema = z.object({ id, label: text, amount: money, orderId: id.optional(), reversed: z.boolean(), paid: z.boolean() });
const paymentSchema = z.object({ id, amount: money.positive(), at: time });
const noteSchema = z.object({ id, body: text, at: time });
const visitSchema = z.object({ id, patientId: id, financialMode: z.enum(['catalog', 'legacy_demo']).optional(), openedAt: time, closedAt: time.optional(), status: z.enum(['active', 'closed']), notes: z.array(noteSchema), orders: z.array(orderSchema), prescriptions: z.array(prescriptionSchema), charges: z.array(chargeSchema), payments: z.array(paymentSchema) });
const eventSchema = z.object({ id, at: time, visitId: id.optional(), patientId: id.optional(), actor: text, detail: text });
const baseSchema = z.object({ version: z.literal(1), revision: z.number().int().nonnegative(), patients: z.array(patientSchema), visits: z.array(visitSchema), events: z.array(eventSchema) });
export type State = z.infer<typeof baseSchema>;
export type Patient = State['patients'][number];
export type Visit = State['visits'][number];
export type Test = Visit['orders'][number]['test'];
export const TEST_PRICES: Record<Test, number> = { 'Blood count': 18000, Urinalysis: 10000, 'Blood glucose': 8000 };
export const CONSULTATION = 25000;
export const balance = (v: Visit) => v.charges.filter(c => !c.reversed).reduce((n, c) => n + c.amount, 0) - v.payments.reduce((n, p) => n + p.amount, 0);
export const blockers = (v: Visit) => [!v.notes.length && 'Save a consultation note.', v.orders.some(o => !['reviewed', 'cancelled'].includes(o.status)) && 'Review or cancel all investigations.', v.prescriptions.some(p => p.status === 'pending') && 'Fulfill or cancel all prescriptions.', v.financialMode !== 'catalog' && balance(v) !== 0 && 'Settle the outstanding balance.'].filter(Boolean) as string[];
export const stateSchema = baseSchema.superRefine((s, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  const ids = [...s.patients, ...s.visits, ...s.events, ...s.visits.flatMap(v => [...v.orders, ...v.prescriptions, ...v.charges, ...v.payments, ...v.notes])].map(x => x.id);
  if (new Set(ids).size !== ids.length) fail('Duplicate record identifiers');
  const active = s.visits.filter(v => v.status === 'active').map(v => v.patientId);
  if (new Set(active).size !== active.length) fail('Duplicate active visits');
  for (const v of s.visits) {
    if (!s.patients.some(p => p.id === v.patientId)) fail('Unknown patient');
    if (balance(v) < 0) fail('Overpaid visit');
    if (v.charges.filter(c => c.paid).reduce((n, c) => n + c.amount, 0) !== v.payments.reduce((n, p) => n + p.amount, 0) || v.charges.some(c => c.paid && c.reversed)) fail('Invalid payment allocation');
    if ((v.status === 'closed') !== Boolean(v.closedAt) || (v.status === 'closed' && blockers(v).length)) fail('Invalid closure');
    if (v.orders.some(o => ['released', 'reviewed'].includes(o.status) && !o.result.trim())) fail('Missing released result');
    if (v.financialMode !== 'catalog' && v.orders.some(o => v.charges.filter(c => c.orderId === o.id).length !== 1)) fail('Missing or duplicate order charge');
    if (v.charges.some(c => c.orderId && !v.orders.some(o => o.id === c.orderId))) fail('Unknown charge order');
    if (v.charges.some(c => c.reversed && (!c.orderId || v.orders.find(o => o.id === c.orderId)?.status !== 'cancelled'))) fail('Invalid charge reversal');
    if (v.charges.some(c => c.orderId && !c.paid && !c.reversed && v.orders.find(o => o.id === c.orderId)?.status === 'cancelled')) fail('Cancelled unpaid charge must be reversed');
    if (v.financialMode === 'catalog' && (v.charges.length || v.payments.length)) fail('Catalog money belongs in the ledger');
    if (v.financialMode !== 'catalog' && v.charges.filter(c => !c.orderId).length !== 1) fail('Invalid consultation charge');
  }
  for (const e of s.events) if ((e.visitId && !s.visits.some(v => v.id === e.visitId)) || (e.patientId && !s.patients.some(p => p.id === e.patientId))) fail('Unknown activity record');
});
export type Command =
  | { type: 'register'; name: string; age?: number; contact: string; confirmDuplicate?: boolean }
  | { type: 'checkIn'; patientId: string; financialMode?: 'catalog' }
  | { type: 'note'; visitId: string; body: string }
  | { type: 'order'; visitId: string; test: Test }
  | { type: 'advanceOrder'; visitId: string; orderId: string; next: 'collected' | 'released' | 'reviewed' | 'cancelled'; result?: string }
  | { type: 'prescribe'; visitId: string; instruction: string }
  | { type: 'fulfill'; visitId: string; prescriptionId: string; next: 'fulfilled' | 'cancelled' }
  | { type: 'settle'; visitId: string }
  | { type: 'close'; visitId: string };
export class DomainError extends Error {}
function requireThat(condition: unknown, message: string): asserts condition { if (!condition) throw new DomainError(message); }
export function execute(state: State, command: Command, now = new Date().toISOString()): State {
  const s = structuredClone(state);
  const uid = () => crypto.randomUUID();
  let visitId: string | undefined;
  let patientId: string | undefined;
  let detail = '';
  let actor = 'Reception';
  if (command.type === 'register') {
    const p = patientSchema.parse({ id: uid(), name: command.name.trim(), age: command.age, contact: command.contact.trim(), createdAt: now });
    requireThat(command.confirmDuplicate || !s.patients.some(x => x.name.toLocaleLowerCase() === p.name.toLocaleLowerCase()), 'A patient with this name exists. Confirm this is a different fictional person.');
    s.patients.push(p); patientId = p.id; detail = `Registered ${p.name}.`;
  } else if (command.type === 'checkIn') {
    requireThat(s.patients.some(p => p.id === command.patientId), 'Patient not found.');
    requireThat(!s.visits.some(v => v.patientId === command.patientId && v.status === 'active'), 'This patient already has an active visit. Open the existing visit.');
    patientId = command.patientId; visitId = uid();
    s.visits.push({ id: visitId, patientId, ...(command.financialMode ? { financialMode: command.financialMode } : {}), status: 'active', openedAt: now, notes: [], orders: [], prescriptions: [], payments: [], charges: command.financialMode === 'catalog' ? [] : [{ id: uid(), label: 'Consultation', amount: CONSULTATION, reversed: false, paid: false }] });
    detail = command.financialMode === 'catalog' ? 'Checked in; catalog bill not yet prepared.' : 'Checked in; consultation charge added.';
  } else {
    const v = s.visits.find(x => x.id === command.visitId);
    requireThat(v, 'Visit not found.'); requireThat(v.status === 'active', 'Closed visits cannot be edited.');
    visitId = v.id; patientId = v.patientId;
    if (command.type === 'note') {
      const body = text.parse(command.body); v.notes.push({ id: uid(), body, at: now }); actor = 'Consultation'; detail = 'Saved consultation note revision.';
    } else if (command.type === 'order') {
      requireThat(command.test in TEST_PRICES, 'Choose an available investigation.');
      requireThat(!v.orders.some(o => o.test === command.test), 'This investigation already exists for this visit, including cancelled requests.');
      const orderId = uid(); v.orders.push({ id: orderId, test: command.test, status: 'requested', result: '' });
      if (v.financialMode !== 'catalog') v.charges.push({ id: uid(), label: command.test, amount: TEST_PRICES[command.test], orderId, reversed: false, paid: false }); actor = 'Consultation'; detail = `Requested ${command.test}${v.financialMode === 'catalog' ? '' : '; charge added'}.`;
    } else if (command.type === 'advanceOrder') {
      const o = v.orders.find(x => x.id === command.orderId); requireThat(o, 'Investigation not found.');
      if (command.next === 'cancelled') {
        requireThat(['requested', 'collected'].includes(o.status), 'Only investigations awaiting release can be cancelled.');
        if (v.financialMode === 'catalog') detail = `Cancelled ${o.test}.`;
        else {
          const charge = v.charges.find(c => c.orderId === o.id)!;
          if (!charge.paid) charge.reversed = true;
          detail = `Cancelled ${o.test}${charge.reversed ? '; unpaid charge reversed' : '; previously paid charge retained (no demo refunds)'}.`;
        }
      } else {
        const previous = { collected: 'requested', released: 'collected', reviewed: 'released' };
        requireThat(o.status === previous[command.next], `Investigation must be ${previous[command.next]} before it can be ${command.next}.`);
        if (command.next === 'released') o.result = text.parse(command.result);
        detail = `${o.test}: ${command.next}.`;
      }
      o.status = command.next; actor = command.next === 'reviewed' ? 'Consultation' : 'Diagnostics';
    } else if (command.type === 'prescribe') {
      v.prescriptions.push({ id: uid(), instruction: text.parse(command.instruction), status: 'pending' }); actor = 'Consultation'; detail = 'Added fictional prescription for pharmacy fulfillment.';
    } else if (command.type === 'fulfill') {
      const p = v.prescriptions.find(x => x.id === command.prescriptionId); requireThat(p?.status === 'pending', 'Only pending prescriptions can change.');
      p.status = command.next; actor = 'Pharmacy'; detail = `Prescription ${command.next}.`;
    } else if (command.type === 'settle') {
      requireThat(v.financialMode !== 'catalog', 'Use an issued catalog invoice to record payment.');
      const amount = balance(v); requireThat(amount > 0, 'This balance is already paid.');
      v.payments.push({ id: uid(), amount, at: now }); v.charges.filter(c => !c.reversed).forEach(c => { c.paid = true; }); actor = 'Billing'; detail = `Recorded demo payment of ${(amount / 100).toFixed(2)} ETB.`;
    } else if (command.type === 'close') {
      requireThat(!blockers(v).length, blockers(v).join(' ')); v.status = 'closed'; v.closedAt = now; actor = 'Consultation'; detail = 'Closed visit.';
    }
  }
  s.events.push({ id: uid(), at: now, visitId, patientId, actor, detail }); s.revision++;
  return stateSchema.parse(s);
}
