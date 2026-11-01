import { dist, pointInPolygon, projectOnWall, wallLength } from '../model/geometry.ts';
import { outletPosition } from './outletGeometry.ts';
import type { Point, Project } from '../model/types.ts';

export type Hit =
  | { kind: 'outlet'; id: string }
  | { kind: 'opening'; id: string }
  | { kind: 'wall'; id: string }
  | { kind: 'room'; id: string };

/** What's under `p` (world inches). `slop` is the pointer tolerance in inches. Outlets beat openings beat walls beat rooms. */
export function hitTest(project: Project, p: Point, slop: number): Hit | null {
  const walls = new Map(project.walls.map((w) => [w.id, w]));
  for (const o of project.outlets) {
    const w = walls.get(o.wallId);
    if (w && dist(outletPosition(w, o), p) <= 5 + slop) return { kind: 'outlet', id: o.id };
  }
  for (const o of project.openings) {
    const w = walls.get(o.wallId);
    if (!w) continue;
    const { along, perp } = projectOnWall(w, p);
    if (perp <= w.thickness / 2 + slop && Math.abs(along - o.offset) <= o.width / 2) return { kind: 'opening', id: o.id };
  }
  let best: { id: string; perp: number } | null = null;
  for (const w of project.walls) {
    const { along, perp } = projectOnWall(w, p);
    if (along < 0 || along > wallLength(w)) continue;
    if (perp <= w.thickness / 2 + slop && (!best || perp < best.perp)) best = { id: w.id, perp };
  }
  if (best) return { kind: 'wall', id: best.id };
  // Smallest containing room wins, so a room drawn inside another stays clickable.
  const rooms = project.rooms.filter((r) => pointInPolygon(p, r.points));
  if (rooms.length) {
    rooms.sort((a, b) => bboxArea(a.points) - bboxArea(b.points));
    return { kind: 'room', id: rooms[0].id };
  }
  return null;
}

function bboxArea(pts: Point[]): number {
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
}
