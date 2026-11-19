import type { Project } from './types.ts';

// Account projects cached on this device so they open offline. Edits made
// while offline stay `dirty` until they reach the server. Pure decisions live
// here (tested); the IndexedDB side is cloudCache.ts.

export interface CacheEntry {
  id: string;
  /** Account the copy belongs to — the cache is cleared on sign-out. */
  userId: string;
  name: string;
  /** Server updated_at this copy was loaded from / last saved as. */
  base: number;
  /** When this device last changed the copy. */
  editedAt: number;
  /** Changed here and not yet saved to the account. */
  dirty: boolean;
  thumb?: string | null;
  data: Project;
}

export type SyncDecision =
  /** Server hasn't moved since our base (or doesn't have it): a normal save. */
  | 'push'
  /** Both changed; ours is the later edit — last write wins, overwrite the server. */
  | 'force'
  /** Both changed; the server's is later — keep ours as a separate copy on the device. */
  | 'keep-copy';

export function decideSync(entry: Pick<CacheEntry, 'base' | 'editedAt'>, server: { updated_at: number } | null | undefined): SyncDecision {
  if (!server || server.updated_at <= entry.base) return 'push';
  return entry.editedAt > server.updated_at ? 'force' : 'keep-copy';
}

export interface ListingRow {
  id: string;
  name: string;
  updated_at: number;
  bytes?: number;
  thumb?: string | null;
  /** Only on this device so far (edited offline). */
  unsynced: boolean;
  /** Listing came from the cache because the server couldn't be reached. */
  offline: boolean;
}

/**
 * Rows for the "Your account" list. With the server's list, mark the ones with
 * offline edits waiting; without it (offline), list what's cached for this user.
 */
export function accountListing(
  remote: { id: string; name: string; updated_at: number; bytes?: number; thumb?: string | null }[] | null,
  cached: Omit<CacheEntry, 'data'>[],
  userId: string,
): ListingRow[] {
  const mine = cached.filter((c) => c.userId === userId);
  const dirty = new Map(mine.filter((c) => c.dirty).map((c) => [c.id, c]));
  if (remote) {
    const rows: ListingRow[] = remote.map((p) => {
      const d = dirty.get(p.id);
      return { ...p, ...(d ? { name: d.name, thumb: d.thumb ?? p.thumb } : {}), unsynced: !!d, offline: false };
    });
    // Made or kept offline and not on the server yet.
    for (const d of dirty.values()) if (!remote.some((p) => p.id === d.id)) rows.push({ id: d.id, name: d.name, updated_at: d.editedAt, thumb: d.thumb, unsynced: true, offline: false });
    return rows.sort((a, b) => b.updated_at - a.updated_at);
  }
  return mine
    .map((c) => ({ id: c.id, name: c.name, updated_at: c.dirty ? c.editedAt : c.base, thumb: c.thumb, unsynced: c.dirty, offline: true }))
    .sort((a, b) => b.updated_at - a.updated_at);
}
