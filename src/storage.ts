import { stateSchema, type State } from './domain';
import { createSeed } from './seed';
export const STORAGE_KEY = 'hospital-workspace-demo-v1';
export class StorageError extends Error {}
export type Store = Pick<Storage, 'getItem' | 'setItem'>;
export function readState(storage: Store): State | null {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    return stateSchema.parse(JSON.parse(raw));
  } catch { throw new StorageError('Saved demo data is unavailable or invalid. Nothing has been replaced. Retry access or explicitly reset the demo.'); }
}
export function writeState(storage: Store, next: State, expected: number | null): void {
  const current = readState(storage);
  if ((current?.revision ?? null) !== expected) throw new StorageError('Another tab changed the demo. Reload latest records before continuing.');
  try { storage.setItem(STORAGE_KEY, JSON.stringify(stateSchema.parse(next))); }
  catch { throw new StorageError('The browser could not save this change. Check available storage and retry. Your displayed records have not changed.'); }
}
export async function withStorageLock<T>(action: () => T): Promise<T> {
  if (!navigator.locks) throw new StorageError('This browser cannot safely coordinate demo tabs. Open the demo in a browser with Web Locks support.');
  return navigator.locks.request(STORAGE_KEY, action);
}
export async function initialize(): Promise<State> {
  return withStorageLock(() => {
    const current = readState(localStorage);
    if (current) return current;
    const seed = createSeed(); writeState(localStorage, seed, null); return seed;
  });
}
export async function saveState(next: State, revision: number): Promise<void> {
  return withStorageLock(() => writeState(localStorage, next, revision));
}
export async function resetState(): Promise<State> {
  return withStorageLock(() => {
    const seed = createSeed();
    // A fresh revision prevents a still-open tab from replacing a reset dataset.
    seed.revision = Date.now();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(seed)); }
    catch { throw new StorageError('The browser could not reset demo storage. No reset was completed.'); }
    return seed;
  });
}
