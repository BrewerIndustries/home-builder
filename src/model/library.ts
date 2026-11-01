import { migrate } from './store.ts';
import { uid, type Project } from './types.ts';

// Projects saved on this device, in IndexedDB (localStorage's ~5 MB would fill
// with a couple of floorplan images). The project being edited is also mirrored
// to localStorage by persist.ts so a reload opens instantly.

export interface LocalEntry {
  id: string;
  name: string;
  updatedAt: number;
  data: Project;
}

/** Which project the editor is showing, and where it lives. `base` = server updated_at last seen. */
export interface Current {
  source: 'local' | 'cloud';
  id: string;
  base?: number;
}

const CURRENT_KEY = 'home-builder:current';
const DB = 'home-builder';
const STORE = 'projects';

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

export async function listLocal(): Promise<Omit<LocalEntry, 'data'>[]> {
  const all = await tx<LocalEntry[]>('readonly', (s) => s.getAll());
  return all.map(({ id, name, updatedAt }) => ({ id, name, updatedAt })).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getLocal(id: string): Promise<Project | null> {
  const e = await tx<LocalEntry | undefined>('readonly', (s) => s.get(id));
  return e ? migrate(e.data) : null;
}

export async function putLocal(id: string, data: Project): Promise<void> {
  await tx('readwrite', (s) => s.put({ id, name: data.name, updatedAt: Date.now(), data } satisfies LocalEntry));
}

export async function deleteLocal(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

export function newProjectId(): string {
  return uid('prj').replace(/[^A-Za-z0-9_-]/g, '');
}

export function loadCurrent(): Current {
  try {
    const c = JSON.parse(localStorage.getItem(CURRENT_KEY) ?? 'null') as Current | null;
    if (c?.id && (c.source === 'local' || c.source === 'cloud')) return c;
  } catch {
    // fall through
  }
  const c: Current = { source: 'local', id: newProjectId() };
  saveCurrent(c);
  return c;
}

export function saveCurrent(c: Current) {
  try {
    localStorage.setItem(CURRENT_KEY, JSON.stringify(c));
  } catch {
    // storage blocked — the pointer just won't survive a reload
  }
}
