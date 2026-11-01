import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react';
import { ApiError, cloud, type User } from '../model/cloud.ts';
import { deleteLocal, getLocal, loadCurrent, newProjectId, putLocal, saveCurrent, type Current } from '../model/library.ts';
import type { Action } from '../model/store.ts';
import { emptyProject, type Project } from '../model/types.ts';

// Which project is open, where it is saved (this device or the signed-in
// account), and the autosave loop that keeps it there.

export type SyncStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'conflict';

export interface Workspace {
  current: Current;
  /** undefined while the first /auth/me is in flight. */
  user: User | null | undefined;
  setUser(u: User | null): void;
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

export function useWorkspace(project: Project, dispatch: Dispatch<Action>, notify: (msg: string) => void): Workspace {
  const [current, setCurrentState] = useState<Current>(loadCurrent);
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;
  const currentRef = useRef(current);
  const projectRef = useRef(project);
  projectRef.current = project;
  // Set before dispatching a load so the freshly loaded project isn't saved straight back.
  const skipSave = useRef(true);
  const dirty = useRef(false);

  const setCurrent = useCallback((c: Current) => {
    currentRef.current = c;
    saveCurrent(c);
    setCurrentState(c);
  }, []);

  const saveCloud = useCallback(
    async (force = false) => {
      const c = currentRef.current;
      if (c.source !== 'cloud') return;
      setStatus('saving');
      try {
        const saved = await cloud.put(c.id, projectRef.current, c.base, force);
        dirty.current = false;
        if (currentRef.current.id === c.id) setCurrent({ ...currentRef.current, base: saved.updated_at });
        setStatus('saved');
        setSyncError(null);
      } catch (e) {
        const err = e as ApiError;
        if (err.status === 409) setStatus('conflict');
        else {
          setStatus('error');
          setSyncError(err.status === 401 ? 'Signed out — sign in again to keep saving to your account.' : err.message);
        }
      }
    },
    [setCurrent],
  );

  // Who's signed in; also catch up a cloud project edited on another device.
  useEffect(() => {
    cloud
      .me()
      .then(async (u) => {
        setUser(u);
        const c = currentRef.current;
        if (c.source !== 'cloud') return;
        if (!u) {
          // Session gone: keep the working copy on this device rather than lose it.
          const id = newProjectId();
          await putLocal(id, projectRef.current);
          setCurrent({ source: 'local', id });
          notify('Signed out — your open project was kept on this device.');
          return;
        }
        const remote = await cloud.get(c.id).catch(() => null);
        if (remote && remote.project.updated_at > (c.base ?? 0)) {
          skipSave.current = true;
          dispatch({ type: 'load', project: remote.data });
          setCurrent({ ...c, base: remote.project.updated_at });
          notify('Loaded the newer copy saved from another device.');
        }
      })
      .catch(() => setUser(null));
    // An upgrade from the single-project version: file the open project in the library.
    const c = currentRef.current;
    if (c.source === 'local') getLocal(c.id).then((p) => (p ? undefined : putLocal(c.id, projectRef.current))).catch(() => {});
  }, [dispatch, notify, setCurrent]);

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
    dirty.current = false;
  }, [saveCloud]);

  const show = useCallback(
    (c: Current, data: Project) => {
      skipSave.current = true;
      dirty.current = false;
      dispatch({ type: 'load', project: data });
      setCurrent(c);
      setStatus(c.source === 'cloud' ? 'saved' : 'idle');
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
      } else {
        const r = await cloud.get(id);
        show({ source, id, base: r.project.updated_at }, r.data);
      }
    },
    [flush, show],
  );

  const create = useCallback(
    async (source: Current['source']) => {
      await flush();
      const id = newProjectId();
      const data = emptyProject();
      if (source === 'cloud') {
        const saved = await cloud.put(id, data, undefined);
        show({ source, id, base: saved.updated_at }, data);
      } else {
        await putLocal(id, data);
        show({ source, id }, data);
      }
    },
    [flush, show],
  );

  const remove = useCallback(
    async (source: Current['source'], id: string) => {
      if (source === 'cloud') await cloud.remove(id);
      else await deleteLocal(id);
      const c = currentRef.current;
      if (c.source === source && c.id === id) {
        dirty.current = false;
        const nid = newProjectId();
        const data = emptyProject();
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
      await deleteLocal(localId);
      if (isOpen) {
        dirty.current = false;
        setCurrent({ source: 'cloud', id: localId, base: saved.updated_at });
        setStatus('saved');
      }
    },
    [setCurrent],
  );

  const resolveConflict = useCallback(
    async (keep: 'mine' | 'theirs') => {
      const c = currentRef.current;
      if (keep === 'mine') await saveCloud(true);
      else {
        const r = await cloud.get(c.id);
        show({ ...c, base: r.project.updated_at }, r.data);
      }
    },
    [saveCloud, show],
  );

  const signOut = useCallback(async () => {
    await flush();
    await cloud.logout().catch(() => {});
    setUser(null);
    if (currentRef.current.source === 'cloud') {
      // Don't leave account projects on a shared screen.
      const nid = newProjectId();
      const data = emptyProject();
      await putLocal(nid, data);
      show({ source: 'local', id: nid }, data);
    }
  }, [flush, show]);

  return { current, user, setUser, status, syncError, open, create, remove, moveToAccount, resolveConflict, signOut };
}
