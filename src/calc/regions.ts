import { dist, pointInPolygon, polygonArea, uncoveredPieces } from '../model/geometry.ts';
import type { Point, Project, Room, Wall } from '../model/types.ts';

// Rooms nest: the usual workflow draws the house outline as one room, then rooms
// inside it. A room's REGION is its polygon minus the rooms directly inside it.
// Floor area, ceilings and outlet layout all work on regions, so nothing is
// counted twice.

const TOL = 0.5;

function onBoundary(p: Point, pts: Point[]): boolean {
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    if (!len2) continue;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2));
    if (dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }) <= TOL) return true;
  }
  return false;
}

/** Is `inner` entirely within `outer` (touching the boundary allowed)? */
export function roomInside(inner: Room, outer: Room): boolean {
  if (inner.id === outer.id || polygonArea(inner.points) >= polygonArea(outer.points)) return false;
  return inner.points.every((p) => pointInPolygon(p, outer.points) || onBoundary(p, outer.points));
}

/** Rooms directly inside `room` (not inside one of its other children). */
export function childRooms(project: Project, room: Room): Room[] {
  const inside = project.rooms.filter((r) => roomInside(r, room));
  return inside.filter((r) => !inside.some((o) => o !== r && roomInside(r, o)));
}

/** Floor area that belongs to this room alone, square inches. */
export function exclusiveArea(project: Project, room: Room): number {
  return Math.max(0, polygonArea(room.points) - childRooms(project, room).reduce((s, c) => s + polygonArea(c.points), 0));
}

/** Total floor area without double counting nested rooms, square inches. */
export function totalFloorArea(project: Project): number {
  return project.rooms.reduce((s, r) => s + exclusiveArea(project, r), 0);
}

export interface RegionEdge {
  a: Point;
  b: Point;
  /** Unit normal pointing into the region. */
  inward: Point;
}

function signedArea(pts: Point[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

function edges(pts: Point[], toward: 'inside' | 'outside'): RegionEdge[] {
  // For y-down coordinates a positive signed area is clockwise on screen; the
  // left-hand normal (d.y, -d.x) then points outward.
  const cw = signedArea(pts) > 0;
  const out: RegionEdge[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = dist(a, b);
    if (len < TOL) continue;
    const left = { x: (b.y - a.y) / len, y: -(b.x - a.x) / len };
    const outward = cw ? left : { x: -left.x, y: -left.y };
    const inward = toward === 'inside' ? { x: -outward.x, y: -outward.y } : outward;
    out.push({ a, b, inward });
  }
  return out;
}

const asWall = (e: { a: Point; b: Point }, i: number): Wall => ({ id: `e${i}`, a: e.a, b: e.b, kind: 'interior', thickness: 0, height: 0 });

/**
 * The wall lines bounding a room's region: its own edges minus stretches that a
 * child room owns, plus the children's edges that face back into this room.
 */
export function regionEdges(project: Project, room: Room): RegionEdge[] {
  const children = childRooms(project, room);
  const own = edges(room.points, 'inside');
  const childEdges = children.map((c) => edges(c.points, 'outside'));
  const out: RegionEdge[] = [];
  const subtract = (e: RegionEdge, others: RegionEdge[]) =>
    uncoveredPieces(asWall(e, 0), others.map(asWall), TOL).map((w) => ({ a: w.a, b: w.b, inward: e.inward }));

  for (const e of own) out.push(...subtract(e, childEdges.flat()));
  childEdges.forEach((ces, i) => {
    const siblings = childEdges.filter((_, j) => j !== i).flat();
    for (const e of ces) out.push(...subtract(e, [...own, ...siblings]));
  });
  return out.filter((e) => dist(e.a, e.b) > TOL);
}
