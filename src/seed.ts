import { execute, type State } from './domain';
export function createSeed(): State {
  let s: State = { version: 1, revision: 0, patients: [], visits: [], events: [] };
  const time = new Date().toISOString();
  for (const [name, age] of [['Liya Demo', 32], ['Dawit Sample', 47], ['Hana Fiction', 26], ['Yonas Example', 61]] as const) s = execute(s, { type: 'register', name, age, contact: '' }, time);
  for (const p of s.patients.slice(0, 3)) s = execute(s, { type: 'checkIn', patientId: p.id }, time);
  const first = s.visits[0]!;
  s = execute(s, { type: 'note', visitId: first.id, body: 'Fictional consultation draft. Follow-up investigation requested for demonstration.' }, time);
  s = execute(s, { type: 'order', visitId: first.id, test: 'Blood count' }, time);
  s = execute(s, { type: 'order', visitId: s.visits[1]!.id, test: 'Urinalysis' }, time);
  s = execute(s, { type: 'advanceOrder', visitId: s.visits[1]!.id, orderId: s.visits[1]!.orders[0]!.id, next: 'collected' }, time);
  s = execute(s, { type: 'prescribe', visitId: s.visits[2]!.id, instruction: 'Fictional medicine A — demonstration only; confirm handoff with clinician.' }, time);
  return s;
}
