import { describe, expect, it } from 'vitest';
import { balance, blockers, execute, stateSchema, type State } from './visit-domain.ts';
const empty = (): State => ({ version: 1, revision: 0, patients: [], visits: [], events: [] });
function checkedIn() {
  let s = execute(empty(), { type: 'register', name: 'Fictional Person', contact: '' });
  return execute(s, { type: 'checkIn', patientId: s.patients[0].id });
}
describe('outpatient domain', () => {
  it('requires only a name, bounds age, and warns intentionally about duplicate names', () => {
    const s = execute(empty(), { type: 'register', name: '  Sample Name  ', contact: '' });
    expect(s.patients[0].name).toBe('Sample Name');
    expect(() => execute(s, { type: 'register', name: 'sample name', contact: '' })).toThrow(
      'Confirm',
    );
    expect(
      execute(s, { type: 'register', name: 'sample name', contact: '', confirmDuplicate: true })
        .patients,
    ).toHaveLength(2);
    expect(() => execute(s, { type: 'register', name: '', contact: '' })).toThrow();
    for (const age of [-1, 121, 2.5, NaN])
      expect(() => execute(s, { type: 'register', name: 'Other', contact: '', age })).toThrow();
  });
  it('rejects a second active encounter without changing the original', () => {
    const s = checkedIn();
    expect(() => execute(s, { type: 'checkIn', patientId: s.patients[0].id })).toThrow('already');
    expect(s.visits).toHaveLength(1);
  });
  it('enforces test order, preserves results, and prevents cancelled-order retries', () => {
    let s = checkedIn();
    const visitId = s.visits[0].id;
    s = execute(s, { type: 'order', visitId, test: 'Blood count' });
    const orderId = s.visits[0].orders[0].id;
    for (const next of ['released', 'reviewed'] as const)
      expect(() =>
        execute(s, { type: 'advanceOrder', visitId, orderId, next, result: 'fictional' }),
      ).toThrow('must be');
    s = execute(s, { type: 'advanceOrder', visitId, orderId, next: 'collected' });
    expect(() =>
      execute(s, { type: 'advanceOrder', visitId, orderId, next: 'released', result: ' ' }),
    ).toThrow();
    s = execute(s, { type: 'advanceOrder', visitId, orderId, next: 'cancelled' });
    expect(balance(s.visits[0])).toBe(25000);
    expect(() => execute(s, { type: 'order', visitId, test: 'Blood count' })).toThrow('already');
    expect(() =>
      execute(s, { type: 'advanceOrder', visitId, orderId, next: 'collected' }),
    ).toThrow();
  });
  it('completes a visit, records ordered revisions, and locks every closed mutation', () => {
    let s = checkedIn();
    const visitId = s.visits[0].id;
    expect(blockers(s.visits[0])).toHaveLength(2);
    expect(() => execute(s, { type: 'close', visitId })).toThrow('note');
    s = execute(s, { type: 'note', visitId, body: 'First fictional draft' });
    s = execute(s, { type: 'note', visitId, body: 'Second fictional draft' });
    s = execute(s, { type: 'order', visitId, test: 'Blood glucose' });
    const orderId = s.visits[0].orders[0].id;
    for (const next of ['collected', 'released', 'reviewed'] as const)
      s = execute(s, {
        type: 'advanceOrder',
        visitId,
        orderId,
        next,
        result: 'Fictional result — demo',
      });
    expect(() => execute(s, { type: 'advanceOrder', visitId, orderId, next: 'cancelled' })).toThrow(
      'awaiting release',
    );
    s = execute(s, { type: 'prescribe', visitId, instruction: 'Demo instruction' });
    s = execute(s, {
      type: 'fulfill',
      visitId,
      prescriptionId: s.visits[0].prescriptions[0].id,
      next: 'fulfilled',
    });
    s = execute(s, { type: 'settle', visitId });
    expect(s.visits[0].payments[0].amount).toBe(33000);
    expect(() => execute(s, { type: 'settle', visitId })).toThrow('already paid');
    s = execute(s, { type: 'close', visitId });
    expect(s.visits[0].notes).toHaveLength(2);
    expect(s.events.at(-1)?.detail).toBe('Closed visit.');
    for (const command of [
      { type: 'note', visitId, body: 'Edit' },
      { type: 'order', visitId, test: 'Urinalysis' },
      { type: 'settle', visitId },
      { type: 'close', visitId },
    ] as const)
      expect(() => execute(s, command)).toThrow('Closed visits');
  });
  it('rejects persisted broken references, money allocations, and duplicate visits', () => {
    const s = checkedIn();
    const broken = structuredClone(s);
    broken.visits[0].patientId = 'missing';
    expect(stateSchema.safeParse(broken).success).toBe(false);
    const overpaid = structuredClone(s);
    overpaid.visits[0].payments.push({
      id: 'payment',
      amount: 26000,
      at: new Date().toISOString(),
    });
    expect(stateSchema.safeParse(overpaid).success).toBe(false);
    const duplicate = structuredClone(s);
    duplicate.visits.push({ ...structuredClone(s.visits[0]), id: 'another' });
    expect(stateSchema.safeParse(duplicate).success).toBe(false);
  });
  it('catalog encounters add no invented charges and close after clinical work alone', () => {
    let s = execute(empty(), { type: 'register', name: 'Catalog fictional patient', contact: '' });
    s = execute(s, { type: 'checkIn', patientId: s.patients[0].id, financialMode: 'catalog' });
    const visitId = s.visits[0].id;
    expect(s.visits[0].charges).toEqual([]);
    expect(blockers(s.visits[0])).toEqual(['Save a consultation note.']);
    s = execute(s, { type: 'note', visitId, body: 'Synthetic note' });
    s = execute(s, { type: 'order', visitId, test: 'Blood count' });
    expect(s.visits[0].charges).toEqual([]);
    expect(() => execute(s, { type: 'close', visitId })).toThrow('investigations');
    s = execute(s, {
      type: 'advanceOrder',
      visitId,
      orderId: s.visits[0].orders[0].id,
      next: 'cancelled',
    });
    expect(() => execute(s, { type: 'settle', visitId })).toThrow('catalog invoice');
    s = execute(s, { type: 'close', visitId });
    expect(s.visits[0].status).toBe('closed');
    expect(s.visits[0].payments).toEqual([]);
  });
  it('catalog JSON rejects even balanced fabricated financial entries', () => {
    let s = execute(empty(), { type: 'register', name: 'Catalog fictional patient', contact: '' });
    s = execute(s, { type: 'checkIn', patientId: s.patients[0].id, financialMode: 'catalog' });
    s.visits[0].charges.push({
      id: 'charge',
      label: 'Invented',
      amount: 100,
      reversed: false,
      paid: true,
    });
    s.visits[0].payments.push({ id: 'payment', amount: 100, at: new Date().toISOString() });
    expect(stateSchema.safeParse(s).success).toBe(false);
  });
});
