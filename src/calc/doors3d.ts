import { pointAlong, wallNormal } from '../model/geometry.ts';
import type { Opening, Point, Project } from '../model/types.ts';
import { bifoldDepth, doorFrame, pocketSpan } from './furniture.ts';
import { VEHICLE_DOOR } from './lighting.ts';
import type { Box } from './model3d.ts';

// Door leaves in 3D, posed as the plan draws them: a hinged leaf (or a pair)
// standing open square to the wall on its swing side, bifold panels part
// folded, bypass panels closed in the opening, a pocket door slid into its
// pocket with its edge showing, and a barn door slid open on its face, under
// its track. Vehicle doors stay an opening.

/** Leaf thickness (a 1-3/8" interior slab). */
export const LEAF = 1.375;

/** A slab from plan point a to b, standing from the floor to `h`. */
function slab(a: Point, b: Point, h: number, thick = LEAF, y0 = 0): Box {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  return { kind: 'door', c: [(a.x + b.x) / 2, y0 + h / 2, (a.y + b.y) / 2], size: [Math.hypot(dx, dy), h, thick], rotY: -Math.atan2(dy, dx) };
}

const plus = (p: Point, v: Point, k: number): Point => ({ x: p.x + v.x * k, y: p.y + v.y * k });

/** The boxes for one door's leaf or leaves (none for a window or a vehicle door). */
export function doorLeaves(project: Project, o: Opening): Box[] {
  if (o.kind !== 'door' || o.width > VEHICLE_DOOR) return [];
  const f = doorFrame(project, o);
  if (!f) return [];
  const { wall, hinge, free, out, along } = f;
  const h = o.height;
  const t = wall.thickness / 2;
  const n = wallNormal(wall);
  const side = o.swing?.side ?? 1;
  // A point on the wall `at` inches from wall.a, `perp` off its centreline.
  const onWall = (at: number, perp: number): Point => plus(pointAlong(wall, at), n, perp);
  const back = { x: -along.x, y: -along.y };
  switch (o.operation ?? 'swing') {
    case 'swing': {
      // Open square to the wall, its back edge at the hinge jamb.
      const a = plus(hinge, along, LEAF / 2);
      return [slab(a, plus(a, out, o.width), h)];
    }
    case 'double': {
      const a = plus(hinge, along, LEAF / 2);
      const b = plus(free, back, LEAF / 2);
      return [slab(a, plus(a, out, o.width / 2), h), slab(b, plus(b, out, o.width / 2), h)];
    }
    case 'pocket': {
      // In the pocket, its edge 3" out into the opening for the pull.
      const [s, e] = pocketSpan(o);
      const lip = s < o.offset - o.width / 2 ? 3 : -3;
      return [slab(onWall(s + lip, 0), onWall(e + lip, 0), h)];
    }
    case 'bypass': {
      // Two panels closed in the opening, one each side of the centreline, overlapping in the middle.
      const s = o.offset - o.width / 2;
      const off = Math.max(LEAF / 2, Math.min(t * 0.35, t - LEAF / 2));
      return [slab(onWall(s, off), onWall(s + o.width * 0.56, off), h), slab(onWall(s + o.width * 0.44, -off), onWall(s + o.width, -off), h)];
    }
    case 'bifold': {
      // Each stack folded part way: a V standing out from its jamb, as on the plan.
      const c = plus(hinge, along, o.width / 2);
      const pairs: [Point, Point][] = o.width > 36 ? [[hinge, c], [free, c]] : [[hinge, free]];
      const e = bifoldDepth(o.width);
      return pairs.flatMap(([from, to]) => {
        const b = plus(from, { x: to.x - from.x, y: to.y - from.y }, 0.7);
        const tip = plus({ x: (from.x + b.x) / 2, y: (from.y + b.y) / 2 }, out, e * 0.7);
        return [slab(from, tip, h), slab(tip, b, h)];
      });
    }
    case 'barn': {
      // Slid open past the hinge-end jamb, on the swing-side face, under a track twice the door wide.
      const [s, e] = pocketSpan(o);
      const face = side * (t + 1.5 + LEAF / 2);
      const [lo, hi] = [Math.min(s, o.offset - o.width / 2), Math.max(e, o.offset + o.width / 2)];
      // The slab a little taller than the opening, lapping the head; the track just over it.
      return [slab(onWall(s, face), onWall(e, face), h + 1), slab(onWall(lo, face), onWall(hi, face), 1.5, 0.5, h + 1)];
    }
  }
  return [];
}

/** Every door leaf in the plan. */
export const doorLeafBoxes = (project: Project): Box[] => project.openings.flatMap((o) => doorLeaves(project, o));
