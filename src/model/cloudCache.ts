import type { User } from './cloud.ts';
import type { CacheEntry } from './offlineSync.ts';
import { migrate } from './store.ts';

// Device copies of account projects (see offlineSync.ts), in their own
// IndexedDB database so the device library's schema stays as it is.

const DB = 'home-builder-cloud-cache';
const STORE = 'projects';
const USER_KEY = 'home-builder:last-user';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getCached(id: string): Promise<CacheEntry | null> {
  const e = await tx<CacheEntry | undefined>('readonly', (s) => s.get(id)).catch(() => undefined);
  return e ? { ...e, data: migrate(e.data) } : null;
}

export async function allCached(userId?: string): Promise<CacheEntry[]> {
  const all = await tx<CacheEntry[]>('readonly', (s) => s.getAll()).catch(() => [] as CacheEntry[]);
  return userId ? all.filter((e) => e.userId === userId) : all;
}

export async function putCached(e: CacheEntry): Promise<void> {
  await tx('readwrite', (s) => s.put(e)).catch(() => {});
}

export async function deleteCached(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id)).catch(() => {});
}

export async function clearCached(): Promise<void> {
  await tx('readwrite', (s) => s.clear()).catch(() => {});
}

/** The last signed-in user, so the account list still shows while offline. */
export function loadLastUser(): User | null {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) ?? 'null') as User | null;
  } catch {
    return null;
  }
}

export function saveLastUser(u: User | null) {
  try {
    if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
    else localStorage.removeItem(USER_KEY);
  } catch {
    // storage blocked
  }
}
