import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react';
import { ApiError, cloud, type CloudProject, type User } from '../model/cloud.ts';
import { allCached, clearCached, deleteCached, getCached, loadLastUser, putCached, saveLastUser } from '../model/cloudCache.ts';
import { deleteLocal, getLocal, loadCurrent, newProjectId, putLocal, saveCurrent, type Current } from '../model/library.ts';
import { decideSync } from '../model/offlineSync.ts';
import type { Action } from '../model/store.ts';
import { planThumbnail } from '../model/thumbnail.ts';
import { type Project } from '../model/types.ts';
import { newProject } from '../model/assembly.ts';

// Which project is open, where it is saved (this device or the signed-in
// account), and the autosave loop that keeps it there. Account projects are
// also cached on the device (cloudCache.ts) so they open offline; edits made
// offline are kept there and saved to the account when the connection is back.

export type SyncStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'conflict' | 'offline';

export interface Workspace {
  current: Current;
  /** undefined while the first /auth/me is in flight. */
  user: User | null | undefined;
  setUser(u: User | null): void;
  /** The server can't be reached; `user` is the last one signed in on this device. */
  offline: boolean;
  status: SyncStatus;
  syncError: string | null;
  open(source: Current['source'], id: string): Promise<void>;
  create(source: Current['source']): Promise<void>;
  remove(source: Current['source'], id: string): Promise<void>;
  moveToAccount(localId: string): Promise<void>;
  resolveConflict(keep: 'mine' | 'theirs'): Promise<void>;
  signOut(): Promise<void>;
}

const CLOUD_DEBOUNCE = 1500;
const LOCAL_DEBOUNCE = 400;

const unreachable = (e: unknown) => e instanceof ApiError && e.status === 0;

export function useWorkspace(project: Project, dispatch: Dispatch<Action>, notify: (msg: string) => void): Workspace {
  const [current, setCurrentState] = useState<Current>(loadCurrent);
  const [user, setUserState] = useState<User | null | undefined>(undefined);
  const [offline, setOffline] = useState(false);
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;
  const currentRef = useRef(current);
  const projectRef = useRef(project);
  projectRef.current = project;
  const userRef = useRef(user);
  userRef.current = user;
  // Set before dispatching a load so the freshly loaded project isn't saved straight back.
  const skipSave = useRef(true);
  const dirty = useRef(false);
  const syncing = useRef(false);

  const setCurrent = useCallback((c: Current) => {
    currentRef.current = c;
    saveCurrent(c);
    setCurrentState(c);
  }, []);

  const setUser = useCallback((u: User | null) => {
    userRef.current = u;
    saveLastUser(u);
    setOffline(false);
    setUserState(u);
  }, []);

  /** Keep the device copy of an account project in step. */
  const cache = useCallback(async (id: string, data: Project, base: number, isDirty: boolean) => {
    const u = userRef.current;
    if (!u) return;
    await putCached({ id, userId: u.id, name: data.name, base, editedAt: Date.now(), dirty: isDirty, thumb: planThumbnail(data), data });
  }, []);

  const saveCloud = useCallback(
    async (force = false) => {
      const c = currentRef.current;
      if (c.source !== 'cloud') return;
      const data = projectRef.current;
      setStatus('saving');
      // On the device first, so an edit survives a dropped connection or a closed tab.
      await cache(c.id, data, c.base ?? 0, true);
      try {
        const saved = await cloud.put(c.id, data, c.base, force);
        dirty.current = false;
        await cache(c.id, data, saved.updated_at, false);
        if (currentRef.current.id === c.id) setCurrent({ ...currentRef.current, base: saved.updated_at });
        setStatus('saved');
        setOffline(false);
        setSyncError(null);
      } catch (e) {
        const err = e as ApiError;
        dirty.current = false; // it's in the device cache; syncDirty() takes it from here
        if (err.status === 409) setStatus('conflict');
        else if (unreachable(err)) {
          setStatus('offline');
          setOffline(true);
        } else {
          setStatus('error');
          setSyncError(err.status === 401 ? 'Signed out — sign in again to keep saving to your account.' : err.message);
        }
      }
    },
    [cache, setCurrent],
  );

  /** Send edits made offline. The open project goes through saveCloud (a clash shows the conflict banner); others are last-write-wins. */
  const syncDirty = useCallback(async () => {
    const u = userRef.current;
    if (!u || syncing.current) return;
    const pending = (await allCached(u.id)).filter((e) => e.dirty);
    if (!pending.length) return;
    syncing.current = true;
    try {
      let remote: CloudProject[];
      try {
        remote = await cloud.list();
      } catch {
        return;
      }
      for (const e of pending) {
        const c = currentRef.current;
        if (c.source === 'cloud' && c.id === e.id) {
          if (statusRef.current !== 'conflict') await saveCloud();
          continue;
        }
        const decision = decideSync(e, remote.find((p) => p.id === e.id));
        try {
          if (decision === 'keep-copy') {
            const id = newProjectId();
            await putLocal(id, { ...e.data, name: `${e.data.name} (offline copy)` });
            await deleteCached(e.id);
            notify(`“${e.name}” was changed elsewhere too — your offline edits were kept on this device as a copy.`);
          } else {
            const saved = await cloud.put(e.id, e.data, e.base, decision === 'force');
            await putCached({ ...e, base: saved.updated_at, dirty: false });
            if (decision === 'force') notify(`“${e.name}” was changed elsewhere too — your later offline edits replaced that version.`);
          }
        } catch (err) {
          if (unreachable(err)) return;
        }
      }
    } finally {
      syncing.current = false;
    }
  }, [notify, saveCloud]);

  /** Signed out (or the session lapsed): unsynced account edits become device projects, then the cache is emptied. */
  const dropCache = useCallback(async (skipId?: string) => {
    for (const e of await allCached()) {
      if (e.dirty && e.id !== skipId) await putLocal(newProjectId(), { ...e.data, name: `${e.data.name} (not synced)` }).catch(() => {});
    }
    await clearCached();
  }, []);

  // Who's signed in; also catch up a cloud project edited on another device.
  useEffect(() => {
    cloud
      .me()
      .then(async (u) => {
        setUser(u);
        const c = currentRef.current;
        if (!u) {
          await dropCache(c.source === 'cloud' ? c.id : undefined);
          if (c.source !== 'cloud') return;
          // Session gone: keep the working copy on this device rather than lose it.
          const id = newProjectId();
          await putLocal(id, projectRef.current);
          setCurrent({ source: 'local', id });
          notify('Signed out — your open project was kept on this device.');
          return;
        }
        if (c.source === 'cloud') {
          const mine = await getCached(c.id);
          if (!mine?.dirty) {
            const remote = await cloud.get(c.id).catch(() => null);
            if (remote && remote.project.updated_at > (c.base ?? 0)) {
              skipSave.current = true;
              dispatch({ type: 'load', project: remote.data });
              setCurrent({ ...c, base: remote.project.updated_at });
              await cache(c.id, remote.data, remote.project.updated_at, false);
              notify('Loaded the newer copy saved from another device.');
            } else if (remote) await cache(c.id, projectRef.current, c.base ?? remote.project.updated_at, false);
          }
        }
        await syncDirty();
      })
      .catch((e) => {
        // Offline: carry on as the last user on this device, from the cache.
        const last = unreachable(e) ? loadLastUser() : null;
        userRef.current = last;
        setUserState(last);
        setOffline(!!last);
        if (last && currentRef.current.source === 'cloud') setStatus('offline');
      });
    // An upgrade from the single-project version: file the open project in the library.
    const c = currentRef.current;
    if (c.source === 'local') getLocal(c.id).then((p) => (p ? undefined : putLocal(c.id, projectRef.current))).catch(() => {});
  }, [dispatch, notify, setCurrent, setUser, cache, dropCache, syncDirty]);

  // Back online: check the session, then send what was edited offline.
  useEffect(() => {
    const onOnline = () => {
      cloud
        .me()
        .then((u) => {
          if (!u) return;
          setUser(u);
          if (statusRef.current === 'offline') setStatus('pending');
          return syncDirty();
        })
        .catch(() => {});
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [setUser, syncDirty]);

  // Autosave to wherever the project lives.
  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    dirty.current = true;
    const c = currentRef.current;
    if (c.source === 'local') {
      const t = setTimeout(() => {
        putLocal(c.id, project).then(() => (dirty.current = false)).catch(() => {});
      }, LOCAL_DEBOUNCE);
      return () => clearTimeout(t);
    }
    setStatus((s) => (s === 'conflict' ? s : 'pending'));
    const t = setTimeout(() => statusRef.current !== 'conflict' && saveCloud(), CLOUD_DEBOUNCE);
    return () => clearTimeout(t);
  }, [project]);

  // Don't drop a pending save when switching projects.
  const flush = useCallback(async () => {
    if (!dirty.current) return;
    const c = currentRef.current;
    if (c.source === 'local') await putLocal(c.id, projectRef.current).catch(() => {});
    else if (statusRef.current !== 'conflict') await saveCloud();
    else await cache(c.id, projectRef.current, c.base ?? 0, true);
    dirty.current = false;
  }, [saveCloud, cache]);

  const show = useCallback(
    (c: Current, data: Project, st?: SyncStatus) => {
      skipSave.current = true;
      dirty.current = false;
      dispatch({ type: 'load', project: data });
      setCurrent(c);
      setStatus(st ?? (c.source === 'cloud' ? 'saved' : 'idle'));
      setSyncError(null);
    },
    [dispatch, setCurrent],
  );

  const open = useCallback(
    async (source: Current['source'], id: string) => {
      await flush();
      if (source === 'local') {
        const data = await getLocal(id);
        if (!data) throw new Error('That project is no longer on this device.');
        show({ source, id }, data);
        return;
      }
      const cached = await getCached(id);
      if (cached?.dirty) {
        // Edited offline and not sent yet: open those edits, then try to send them.
        show({ source, id, base: cached.base }, cached.data, 'pending');
        await saveCloud();
        return;
      }
      try {
        const r = await cloud.get(id);
        show({ source, id, base: r.project.updated_at }, r.data);
        await cache(id, r.data, r.project.updated_at, false);
      } catch (e) {
        if (!unreachable(e) || !cached) throw e;
        show({ source, id, base: cached.base }, cached.data, 'offline');
        setOffline(true);
        notify('Offline — opened the copy saved on this device. Changes sync when you’re back online.');
      }
    },
    [flush, show, saveCloud, cache, notify],
  );

  const create = useCallback(
    async (source: Current['source']) => {
      await flush();
      const id = newProjectId();
      const data = newProject();
      if (source === 'cloud') {
        const saved = await cloud.put(id, data, undefined);
        show({ source, id, base: saved.updated_at }, data);
        await cache(id, data, saved.updated_at, false);
      } else {
        await putLocal(id, data);
        show({ source, id }, data);
      }
    },
    [flush, show, cache],
  );

  const remove = useCallback(
    async (source: Current['source'], id: string) => {
      if (source === 'cloud') {
        await cloud.remove(id);
        await deleteCached(id);
      } else await deleteLocal(id);
      const c = currentRef.current;
      if (c.source === source && c.id === id) {
        dirty.current = false;
        const nid = newProjectId();
        const data = newProject();
        await putLocal(nid, data);
        show({ source: 'local', id: nid }, data);
      }
    },
    [show],
  );

  const moveToAccount = useCallback(
    async (localId: string) => {
      const c = currentRef.current;
      const isOpen = c.source === 'local' && c.id === localId;
      const data = isOpen ? projectRef.current : await getLocal(localId);
      if (!data) throw new Error('That project is no longer on this device.');
      const saved = await cloud.put(localId, data, undefined);
      await cache(localId, data, saved.updated_at, false);
      await deleteLocal(localId);
      if (isOpen) {
        dirty.current = false;
        setCurrent({ source: 'cloud', id: localId, base: saved.updated_at });
        setStatus('saved');
      }
    },
    [setCurrent, cache],
  );

  const resolveConflict = useCallback(
    async (keep: 'mine' | 'theirs') => {
      const c = currentRef.current;
      if (keep === 'mine') await saveCloud(true);
      else {
        const r = await cloud.get(c.id);
        show({ ...c, base: r.project.updated_at }, r.data);
        await cache(c.id, r.data, r.project.updated_at, false);
      }
    },
    [saveCloud, show, cache],
  );

  const signOut = useCallback(async () => {
    await flush();
    await syncDirty();
    await cloud.logout().catch(() => {});
    const wasCloud = currentRef.current.source === 'cloud';
    // Don't leave account projects on a shared screen — or in this browser's storage.
    await dropCache();
    setUser(null);
    if (wasCloud) {
      const nid = newProjectId();
      const data = newProject();
      await putLocal(nid, data);
      show({ source: 'local', id: nid }, data);
    }
  }, [flush, syncDirty, dropCache, setUser, show]);

  return { current, user, setUser, offline, status, syncError, open, create, remove, moveToAccount, resolveConflict, signOut };
}
