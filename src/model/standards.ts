import { storeyList, storeyData, setStoreyData } from './storeys.ts';
import { isOpenWay, standardsOf, type Opening, type Project, type Wall } from './types.ts';

// Project standards (the setup screen): the sizes new doors and windows get, and
// "apply to what's drawn" — every storey, not just the one on screen.

/** Size of a new door (or doorless opening) in this wall, from the project's standards. */
export function doorSize(p: Pick<Project, 'standards'>, wall: Pick<Wall, 'kind'>): { width: number; height: number } {
  const s = standardsOf(p);
  return wall.kind === 'exterior' ? { width: s.exteriorDoorWidth, height: s.exteriorDoorHeight } : { width: s.interiorDoorWidth, height: s.interiorDoorHeight };
}

/** Size and sill of a new window. */
export function windowSize(p: Pick<Project, 'standards'>): { width: number; height: number; sill: number; style: Opening['style'] } {
  const s = standardsOf(p);
  return { width: s.windowWidth, height: s.windowHeight, sill: Math.max(0, s.windowHead - s.windowHeight), style: s.windowStyle };
}

export interface ApplyStandards {
  /** Interior doors (not in glass walls) to the interior door size. */
  interiorDoors?: boolean;
  /** Exterior doors to the exterior door size. */
  exteriorDoors?: boolean;
  /** Doorless openings (cased / arched) in interior walls to the interior door height. */
  openings?: boolean;
  /** Every window to the window size and head height. */
  windows?: boolean;
  /** Every framed wall to the ceiling (wall) height. */
  walls?: boolean;
  /** Change widths too, not just heights. */
  widths?: boolean;
}

/** Put the standards onto what's already drawn, on every storey. Returns the project and how many items changed. */
export function applyStandards(p: Project, what: ApplyStandards): { project: Project; changed: number } {
  const s = standardsOf(p);
  let changed = 0;
  let out = p;
  for (const storey of storeyList(p)) {
    const d = storeyData(out, storey.id);
    const walls = new Map(d.walls.map((w) => [w.id, w]));
    const openings = d.openings.map((o): Opening => {
      const w = walls.get(o.wallId);
      if (!w || w.glass || w.railing) return o;
      let patch: Partial<Opening> | null = null;
      if (o.kind === 'window') {
        if (what.windows) patch = { height: s.windowHeight, sill: Math.max(0, s.windowHead - s.windowHeight), ...(what.widths && { width: s.windowWidth }) };
      } else if (isOpenWay(o)) {
        if (what.openings && w.kind !== 'exterior') patch = { height: s.interiorDoorHeight };
      } else if (w.kind === 'exterior') {
        if (what.exteriorDoors) patch = { height: s.exteriorDoorHeight, ...(what.widths && { width: s.exteriorDoorWidth }) };
      } else if (what.interiorDoors) {
        patch = { height: s.interiorDoorHeight, ...(what.widths && { width: s.interiorDoorWidth }) };
      }
      if (!patch || Object.entries(patch).every(([k, v]) => o[k as keyof Opening] === v)) return o;
      changed++;
      return { ...o, ...patch };
    });
    const newWalls = what.walls
      ? d.walls.map((w) => {
          if (w.glass || w.railing || w.height === p.framing.wallHeight) return w;
          changed++;
          return { ...w, height: p.framing.wallHeight };
        })
      : d.walls;
    out = setStoreyData(out, storey.id, { openings, walls: newWalls });
  }
  return { project: out, changed };
}
