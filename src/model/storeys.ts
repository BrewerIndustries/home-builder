import { HEADER_DEPTH } from '../calc/framing.ts';
import { assemblyThickness } from './assembly.ts';
import { DEFAULT_FOUNDATION, uid, type FloorFrame, type Project, type Storey, type StoreyData, type Wall } from './types.ts';

// Storeys v1. A project is one storey until a second is added. The ACTIVE
// storey's plan data lives in the project's top-level arrays (walls, rooms …),
// so the editor and every per-plan calc work on it unchanged; the other storeys
// keep their own data in `project.storeys`. Switching floors swaps the data in
// and out. A "storey view" is the project as if that storey were active — run
// any calc that takes a Project on it, once per storey, to cover the house.

/** The keys a storey has of its own. */
export const STOREY_KEYS = ['walls', 'openings', 'rooms', 'outlets', 'fixtures', 'switches', 'counters', 'furniture', 'dims', 'ordDims', 'angleDims'] as const;
const ARRAY_KEYS = new Set(['walls', 'openings', 'rooms', 'outlets', 'fixtures', 'switches', 'counters', 'furniture']);

/** Subfloor on the floor framing, inches. */
export const SUBFLOOR = 0.75;
/** The id of the one storey of a project that has never had a second. */
export const GROUND_ID = 'ground';

export const isMultiStorey = (p: Project) => (p.storeys?.length ?? 0) > 1;

/** Every storey, lowest first. A project without storeys is one ground floor. */
export function storeyList(p: Project): Storey[] {
  const list = p.storeys?.length ? p.storeys : [{ id: GROUND_ID, name: 'Ground floor', level: 0 }];
  return [...list].sort((a, b) => a.level - b.level);
}

export function activeStoreyId(p: Project): string {
  const list = storeyList(p);
  return list.find((s) => s.id === p.activeStorey)?.id ?? list.find((s) => s.level === 0)?.id ?? list[0].id;
}

export const activeStorey = (p: Project): Storey => storeyList(p).find((s) => s.id === activeStoreyId(p))!;

/** Depth of a framed floor: the foundation's joist size (or I-joist depth) plus the subfloor. */
export function floorDepth(p: Project): number {
  const fl = p.foundation?.floor;
  if (fl?.joistType === 'ijoist' && fl.iJoistDepth) return fl.iJoistDepth + SUBFLOOR;
  return HEADER_DEPTH[p.foundation?.joistSize ?? DEFAULT_FOUNDATION.joistSize] + SUBFLOOR;
}

/** Floor to floor: as set, else the wall height plus a floor. */
export function storeyHeight(p: Project, s: Storey = activeStorey(p)): number {
  return s.height ?? p.framing.wallHeight + floorDepth(p);
}

/** Height of a storey's floor above the ground floor's (negative for a basement). */
export function storeyElevation(p: Project, id: string = activeStoreyId(p)): number {
  const list = storeyList(p);
  const s = list.find((x) => x.id === id);
  if (!s) return 0;
  let e = 0;
  if (s.level >= 0) for (const x of list) if (x.level >= 0 && x.level < s.level) e += storeyHeight(p, x);
  if (s.level < 0) for (const x of list) if (x.level < 0 && x.level >= s.level) e -= storeyHeight(p, x);
  return e;
}

/** The current storey's own data, from the top-level arrays. */
function pickData(p: Project): StoreyData {
  return Object.fromEntries(STOREY_KEYS.map((k) => [k, p[k]])) as unknown as StoreyData;
}

/** A stored storey's data as top-level fields (missing arrays empty, missing extras cleared). */
function dataOf(s: Storey): StoreyData {
  return Object.fromEntries(STOREY_KEYS.map((k) => [k, s[k] ?? (ARRAY_KEYS.has(k) ? [] : undefined)])) as unknown as StoreyData;
}

/** Just the storey's own settings, no plan data. */
function meta(s: Storey): Storey {
  return { id: s.id, name: s.name, level: s.level, ...(s.height !== undefined && { height: s.height }), ...(s.floor && { floor: s.floor }) };
}

/** Make `id` the active storey: the current one's data goes into `storeys`, the target's comes out. */
export function switchStorey(p: Project, id: string): Project {
  const cur = activeStoreyId(p);
  if (id === cur || !p.storeys?.some((s) => s.id === id)) return p;
  const target = p.storeys.find((s) => s.id === id)!;
  const storeys = p.storeys.map((s) => (s.id === cur ? { ...meta(s), ...pickData(p) } : s.id === id ? meta(s) : s));
  const data = dataOf(target);
  // Wall thickness follows the current assemblies (they may have changed while this floor was put away).
  const walls = data.walls.map((w) => syncWall(p, w));
  return { ...p, ...data, walls, storeys, activeStorey: id };
}

function syncWall(p: Project, w: Wall): Wall {
  const t = assemblyThickness(p, w);
  return t === w.thickness ? w : { ...w, thickness: t };
}

/** The project as if storey `id` were active (the project itself for the active one). */
export const storeyView = (p: Project, id: string): Project => switchStorey(p, id);

/** One view per storey, lowest first. */
export function storeyViews(p: Project): { storey: Storey; view: Project }[] {
  return storeyList(p).map((storey) => ({ storey, view: storeyView(p, storey.id) }));
}

/** The storey just above / below the active one, if any. */
export function adjacentStorey(p: Project, dir: 1 | -1, id: string = activeStoreyId(p)): Storey | null {
  const list = storeyList(p);
  const i = list.findIndex((s) => s.id === id);
  return list[i + dir] ?? null;
}

export const isTopStorey = (p: Project, id: string = activeStoreyId(p)) => !adjacentStorey(p, 1, id);
export const isLowestStorey = (p: Project, id: string = activeStoreyId(p)) => !adjacentStorey(p, -1, id);

const LEVEL_NAMES = ['Ground floor', 'Second floor', 'Third floor', 'Fourth floor', 'Fifth floor'];
export const levelName = (level: number) => (level < 0 ? (level === -1 ? 'Basement' : `Basement ${-level}`) : (LEVEL_NAMES[level] ?? `Floor ${level + 1}`));

/** The project with a stored storeys list (the one implicit ground floor made explicit). */
function withStoreys(p: Project): Project {
  if (p.storeys?.length) return p;
  return { ...p, storeys: [{ id: GROUND_ID, name: 'Ground floor', level: 0 }], activeStorey: GROUND_ID };
}

/**
 * A new storey above the top one (dir 1) or below the lowest (dir −1), made
 * the active one. A storey above starts with the exterior walls of the one
 * under it, so its outline lines up; a basement starts empty.
 */
export function addStorey(p: Project, dir: 1 | -1, id = uid('st')): Project {
  const q = withStoreys(p);
  const list = storeyList(q);
  const edge = dir === 1 ? list[list.length - 1] : list[0];
  const level = edge.level + dir;
  const from = edge.id === activeStoreyId(q) ? q : storeyView(q, edge.id);
  const walls = dir === 1 ? from.walls.filter((w) => w.kind === 'exterior').map((w) => ({ ...w, id: uid('w') })) : [];
  const storey: Storey = { id, name: levelName(level), level, walls, openings: [], rooms: [], outlets: [], fixtures: [], switches: [], counters: [], furniture: [] };
  return switchStorey({ ...q, storeys: [...q.storeys!, storey] }, id);
}

/** Remove a storey (never the last one); the active one moves to a neighbour first. */
export function removeStorey(p: Project, id: string): Project {
  if (!p.storeys || p.storeys.length < 2 || !p.storeys.some((s) => s.id === id)) return p;
  let q = p;
  if (activeStoreyId(q) === id) q = switchStorey(q, (adjacentStorey(q, -1, id) ?? adjacentStorey(q, 1, id))!.id);
  const storeys = q.storeys!.filter((s) => s.id !== id);
  // Levels close up so the ground floor stays 0.
  const removed = p.storeys.find((s) => s.id === id)!;
  const shifted = storeys.map((s) => (removed.level > 0 && s.level > removed.level ? { ...s, level: s.level - 1 } : removed.level < 0 && s.level < removed.level ? { ...s, level: s.level + 1 } : s));
  if (shifted.length === 1) {
    // Back to a plain one-storey project.
    const { storeys: _s, activeStorey: _a, ...rest } = q;
    return rest as Project;
  }
  return { ...q, storeys: shifted };
}

export type StoreyPatch = { name?: string; height?: number | undefined; floor?: FloorFrame };

/** Rename a storey, set its floor-to-floor height (undefined = estimated) or its framed floor. */
export function updateStorey(p: Project, id: string, patch: StoreyPatch): Project {
  const q = withStoreys(p);
  return { ...q, storeys: q.storeys!.map((s) => (s.id === id ? { ...s, ...patch, ...('height' in patch && patch.height === undefined && { height: undefined }) } : s)) };
}

export type StoreyOp =
  | { op: 'switch'; id: string }
  | { op: 'add'; dir: 1 | -1; id?: string }
  | { op: 'remove'; id: string }
  | { op: 'update'; id: string; patch: StoreyPatch };

export function storeyReducer(p: Project, a: StoreyOp): Project {
  switch (a.op) {
    case 'switch':
      return switchStorey(p, a.id);
    case 'add':
      return addStorey(p, a.dir, a.id);
    case 'remove':
      return removeStorey(p, a.id);
    case 'update':
      return updateStorey(p, a.id, a.patch);
  }
}

/** A storey's plan data, wherever it lives (top-level for the active one). */
export function storeyData(p: Project, id: string): StoreyData {
  if (id === activeStoreyId(p)) return pickData(p);
  const s = p.storeys?.find((x) => x.id === id);
  return s ? dataOf(s) : dataOf({ id, name: '', level: 0 });
}

/** Replace some of a storey's plan data, wherever it lives. */
export function setStoreyData(p: Project, id: string, patch: Partial<StoreyData>): Project {
  if (id === activeStoreyId(p)) return { ...p, ...patch };
  return { ...p, storeys: p.storeys?.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}

/** Find which storey an item id belongs to. */
export function storeyOf(p: Project, itemId: string): string | null {
  for (const s of storeyList(p)) {
    const d = storeyData(p, s.id);
    for (const k of STOREY_KEYS) if ((d[k] as { id: string }[] | undefined)?.some((x) => x.id === itemId)) return s.id;
  }
  return null;
}
