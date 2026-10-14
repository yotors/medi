import { describe, expect, it } from 'vitest';
import { balance, execute, type State } from './visit-domain.ts';

function arrival(): State {
  const empty: State = { version: 1, revision: 0, patients: [], visits: [], events: [] };
  const registered = execute(empty, { type: 'register', name: 'Sequence Example', contact: '' });
  return execute(registered, { type: 'checkIn', patientId: registered.patients[0]!.id });
}

describe('Outpatient sequences across departments', () => {
  it('reverses an unpaid investigation added after a consultation was paid', () => {
    let state = arrival();
    const visitId = state.visits[0]!.id;
    state = execute(state, { type: 'settle', visitId });
    const originallyPaid = state.visits[0]!.payments[0]!.amount;
    state = execute(state, { type: 'order', visitId, test: 'Blood count' });
    expect(balance(state.visits[0]!)).toBeGreaterThan(0);
    state = execute(state, {
      type: 'advanceOrder',
      visitId,
      orderId: state.visits[0]!.orders[0]!.id,
      next: 'cancelled',
    });
    expect(balance(state.visits[0]!)).toBe(0);
    expect(state.visits[0]!.payments).toHaveLength(1);
    expect(state.visits[0]!.payments[0]!.amount).toBe(originallyPaid);
    expect(state.visits[0]!.charges.find((c) => c.orderId)?.reversed).toBe(true);
  });

  it('requires result review and pharmacy fulfillment even when the invoice is paid', () => {
    let state = arrival();
    const visitId = state.visits[0]!.id;
    state = execute(state, { type: 'note', visitId, body: 'Fictional workflow observation.' });
    state = execute(state, { type: 'order', visitId, test: 'Urinalysis' });
    state = execute(state, { type: 'prescribe', visitId, instruction: 'Fictional handoff only.' });
    state = execute(state, { type: 'settle', visitId });
    expect(balance(state.visits[0]!)).toBe(0);
    expect(() => execute(state, { type: 'close', visitId })).toThrow();
    const orderId = state.visits[0]!.orders[0]!.id;
    state = execute(state, { type: 'advanceOrder', visitId, orderId, next: 'collected' });
    state = execute(state, {
      type: 'advanceOrder',
      visitId,
      orderId,
      next: 'released',
      result: 'Fictional result for process testing.',
    });
    expect(() => execute(state, { type: 'close', visitId })).toThrow();
    state = execute(state, { type: 'advanceOrder', visitId, orderId, next: 'reviewed' });
    expect(() => execute(state, { type: 'close', visitId })).toThrow();
    state = execute(state, {
      type: 'fulfill',
      visitId,
      prescriptionId: state.visits[0]!.prescriptions[0]!.id,
      next: 'fulfilled',
    });
    state = execute(state, { type: 'close', visitId });
    expect(state.visits[0]!.status).toBe('closed');
  });

  it('opens a new encounter without modifying the completed encounter or copying its note', () => {
    let state = arrival();
    const patientId = state.patients[0]!.id;
    const visitId = state.visits[0]!.id;
    state = execute(state, { type: 'note', visitId, body: 'Original fictional encounter.' });
    state = execute(state, { type: 'settle', visitId });
    state = execute(state, { type: 'close', visitId });
    const previous = structuredClone(state.visits[0]);
    expect(() =>
      execute(state, { type: 'note', visitId, body: 'Attempted silent edit.' }),
    ).toThrow();
    state = execute(state, { type: 'checkIn', patientId });
    expect(state.patients).toHaveLength(1);
    expect(state.visits).toHaveLength(2);
    expect(state.visits[0]).toEqual(previous);
    expect(state.visits[1]!.notes).toEqual([]);
    expect(state.visits[1]!.status).toBe('active');
  });
});

describe('Cancellation accounting integrity', () => {
  it('preserves the ledger when cancelling an already paid investigation', () => {
    let state = arrival();
    const visitId = state.visits[0]!.id;
    state = execute(state, { type: 'order', visitId, test: 'Blood count' });
    state = execute(state, { type: 'settle', visitId });
    const before = structuredClone(state.visits[0]!);
    state = execute(state, {
      type: 'advanceOrder',
      visitId,
      orderId: before.orders[0]!.id,
      next: 'cancelled',
    });
    expect(state.visits[0]!.orders[0]!.status).toBe('cancelled');
    expect(state.visits[0]!.charges).toEqual(before.charges);
    expect(state.visits[0]!.payments).toEqual(before.payments);
    expect(balance(state.visits[0]!)).toBe(0);
  });
});
