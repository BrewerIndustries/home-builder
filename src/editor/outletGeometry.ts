import { pointAlong, wallNormal } from '../model/geometry.ts';
import type { Outlet, Point, Wall } from '../model/types.ts';

/** Where an outlet's (or switch's) symbol sits: on the wall face it serves, just proud of the finish. */
export function outletPosition(w: Wall, o: Pick<Outlet, 'offset' | 'side'>): Point {
  const n = wallNormal(w);
  const c = pointAlong(w, o.offset);
  const off = (w.thickness / 2 + 4) * o.side;
  return { x: c.x + n.x * off, y: c.y + n.y * off };
}
