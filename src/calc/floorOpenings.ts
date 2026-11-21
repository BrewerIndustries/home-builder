import { activeStoreyId, storeyList, storeyView } from '../model/storeys.ts';
import type { Furniture, Point, Project } from '../model/types.ts';
import { floorOpeningPolygons, isStairs } from './stairs.ts';

// Openings in a storey's floor over stairs (Storeys v1); kept apart from
// calc/house.ts so the floor framing (calc/floor.ts) can cut round them.

export interface FloorOpening {
  /** The stair it's over, and the storey that stair is drawn on. */
  stair: Furniture;
  from: string;
  /** One polygon per flight or landing it spans. */
  polys: Point[][];
}

/** Openings in a storey's floor: under stairs coming up from the storey below, and over its own stairs going down. */
export function floorOpenings(p: Project, id: string = activeStoreyId(p)): FloorOpening[] {
  const out: FloorOpening[] = [];
  const list = storeyList(p);
  const i = list.findIndex((s) => s.id === id);
  if (i < 0) return out;
  const own = storeyView(p, id);
  for (const f of own.furniture.filter((x) => isStairs(x) && x.down)) out.push({ stair: f, from: id, polys: floorOpeningPolygons(f) });
  const below = list[i - 1];
  if (below) {
    const v = storeyView(p, below.id);
    for (const f of v.furniture.filter((x) => isStairs(x) && !x.down)) out.push({ stair: f, from: below.id, polys: floorOpeningPolygons(f) });
  }
  return out;
}

/** Rooms on this storey (a storey view) marked open to below: holes in its floor, and in the ceiling of the storey under it. */
export const openVoids = (view: Pick<Project, 'rooms'>): Point[][] => view.rooms.filter((r) => r.openToBelow).map((r) => r.points);
