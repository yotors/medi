import { describe, expect, it } from 'vitest';
import { execute } from './domain';
import { createSeed } from './seed';
import { readState, STORAGE_KEY, writeState, type Store } from './storage';
function memory(initial: string | null = null): Store { let value = initial; return { getItem: () => value, setItem: (_key, next) => { value = next; } }; }
describe('versioned browser storage', () => {
  it('round trips seed, notes and payments', () => {
    const storage = memory(); const seed = createSeed(); writeState(storage, seed, null);
    const paid = execute(seed, { type: 'settle', visitId: seed.visits[0].id }); writeState(storage, paid, seed.revision); expect(readState(storage)).toEqual(paid);
  });
  it('rejects stale writes, including a stale initial seed', () => {
    const storage = memory(); const s = createSeed(); writeState(storage, s, null);
    const next = execute(s, { type: 'note', visitId: s.visits[0].id, body: 'Other tab' }); writeState(storage, next, s.revision);
    expect(() => writeState(storage, s, s.revision)).toThrow('Another tab'); expect(() => writeState(storage, s, null)).toThrow('Another tab'); expect(readState(storage)).toEqual(next);
  });
  it('never silently replaces malformed, wrong-version or invalid saved data', () => {
    for (const raw of ['{broken', JSON.stringify({ ...createSeed(), version: 2 }), JSON.stringify({ ...createSeed(), patients: [] })]) {
      const storage = memory(raw); expect(() => readState(storage)).toThrow('Nothing has been replaced'); expect(() => writeState(storage, createSeed(), null)).toThrow(); expect(storage.getItem(STORAGE_KEY)).toBe(raw);
    }
  });
  it('surfaces access and quota failures without accepting the mutation', () => {
    expect(() => readState({ getItem: () => { throw new Error('blocked'); }, setItem: () => {} })).toThrow('unavailable');
    const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); } }; expect(() => writeState(storage, createSeed(), null)).toThrow('could not save');
  });
});

it('rejects a cancelled unpaid investigation whose charge was not reversed', () => {
  let s = createSeed(); const v = s.visits[0];
  s = execute(s, { type: 'advanceOrder', visitId: v.id, orderId: v.orders[0].id, next: 'cancelled' });
  const broken = structuredClone(s);
  broken.visits[0].charges.find(c => c.orderId === v.orders[0].id)!.reversed = false;
  expect(() => readState(memory(JSON.stringify(broken)))).toThrow('invalid');
});
