import { pointAlong, pointInPolygon, polygonArea, projectOnWall, wallDir, wallLength, wallNormal } from '../model/geometry.ts';
import type { DimMode, Point, Project, Room, Wall } from '../model/types.ts';
import { wallFaces } from './enclosure.ts';
import { projectReducer } from '../model/store.ts';
import { clipHalfPlane } from './outline.ts';

// Wall faces for inside / outside dimensions. Each side of a wall is a strip
// `thickness / 2` off the centreline; it ends where it meets the next wall's
// face (mitred at corners, pulled back at Ts) and is cut into pieces wherever
// another wall tees in on that side. A free end runs to the drawn (square) end.
// Faces are the finished surfaces (drywall, sheathing) unless the project asks
// for framing faces, which sit 1/2" inside them (see finishedThickness).
// Inches throughout; `side` is relative to wallNormal.

const TOL = 0.5;

export interface FaceSpan {
  wall: Wall;
  side: 1 | -1;
  /** Along the centreline from wall.a, after the end adjustments (start may be < 0, end > length). */
  start: number;
  end: number;
  a: Point;
  b: Point;
  length: number;
}

const cross = (p: Point, q: Point) => p.x * q.y - p.y * q.x;
const dot = (p: Point, q: Point) => p.x * q.x + p.y * q.y;
const near = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y) <= TOL;

interface Ray {
  dir: Point;
  half: number;
}

/** Walls leaving `p` (other than `self`), as rays: ends at p give one, walls running through p give two. */
/** Half the wall's thickness to the faces being measured: finished, or the framing 1/2" in. */
export function faceHalf(project: Project, w: Wall): number {
  return (project.dimFaces === 'framing' ? Math.max(1, w.thickness - 1) : w.thickness) / 2;
}

function raysAt(project: Project, self: Wall, p: Point): Ray[] {
  const walls = project.walls;
  const out: Ray[] = [];
  for (const o of walls) {
    if (o.id === self.id) continue;
    const d = wallDir(o);
    const half = faceHalf(project, o);
    if (near(o.a, p)) out.push({ dir: d, half });
    else if (near(o.b, p)) out.push({ dir: { x: -d.x, y: -d.y }, half });
    else {
      const { along, perp } = projectOnWall(o, p);
      if (perp <= TOL && along > TOL && along < wallLength(o) - TOL) out.push({ dir: d, half }, { dir: { x: -d.x, y: -d.y }, half });
    }
  }
  return out;
}

/**
 * How far into the piece (from `p`, along `v`) its face on normal `n` stops:
 * meet the face of the first wall swept across going from `v` toward `n`.
 */
function faceCut(v: Point, n: Point, half: number, rays: Ray[]): number {
  const sigma = Math.sign(cross(v, n)) || 1;
  let best: Ray | null = null;
  let bestAngle = Infinity;
  for (const r of rays) {
    let a = Math.atan2(sigma * cross(v, r.dir), dot(v, r.dir));
    if (a < 0) a += 2 * Math.PI;
    if (a < 1e-3 || a >= bestAngle) continue;
    best = r;
    bestAngle = a;
  }
  if (!best) return -half; // free end: the drawn wall runs half a thickness past it
  if (Math.abs(bestAngle - Math.PI) < 1e-3) return 0; // straight on: the face just continues
  const u = best.dir;
  const m = { x: sigma * u.y, y: -sigma * u.x }; // that wall's face toward this one
  const r = { x: m.x * best.half - n.x * half, y: m.y * best.half - n.y * half };
  return cross(r, u) / cross(v, u);
}

/** Every face piece of every wall, both sides. */
export function faceSpans(project: Project): FaceSpan[] {
  const out: FaceSpan[] = [];
  for (const w of project.walls) {
    const len = wallLength(w);
    if (len < TOL) continue;
    const d = wallDir(w);
    const half = faceHalf(project, w);
    for (const side of [1, -1] as const) {
      const wn = wallNormal(w);
      const n = { x: wn.x * side, y: wn.y * side };
      // Ts on this side cut the face.
      const cuts = [0, len];
      for (const o of project.walls) {
        if (o.id === w.id) continue;
        for (const [e, f] of [[o.a, o.b], [o.b, o.a]]) {
          const { along, perp } = projectOnWall(w, e);
          if (perp > TOL || along <= TOL || along >= len - TOL) continue;
          if (dot({ x: f.x - e.x, y: f.y - e.y }, n) > TOL) cuts.push(along);
        }
      }
      const ts = [...new Set(cuts.map((t) => Math.round(t * 64) / 64))].sort((x, y) => x - y);
      for (let i = 1; i < ts.length; i++) {
        const [t0, t1] = [ts[i - 1], ts[i]];
        if (t1 - t0 <= TOL) continue;
        const p0 = pointAlong(w, t0);
        const p1 = pointAlong(w, t1);
        // At an interior cut the wall itself carries on past the point.
        const r0 = raysAt(project, w, p0);
        if (t0 > TOL) r0.push({ dir: { x: -d.x, y: -d.y }, half });
        const r1 = raysAt(project, w, p1);
        if (t1 < len - TOL) r1.push({ dir: d, half });
        const clamp = (x: number) => Math.max(-len, Math.min(len, x));
        const start = t0 + clamp(faceCut(d, n, half, r0));
        const end = t1 - clamp(faceCut({ x: -d.x, y: -d.y }, n, half, r1));
        if (end - start <= TOL) continue;
        const at = (t: number) => ({ x: w.a.x + d.x * t + n.x * half, y: w.a.y + d.y * t + n.y * half });
        out.push({ wall: w, side, start, end, a: at(start), b: at(end), length: end - start });
      }
    }
  }
  return out;
}

/**
 * The outside face of an exterior wall: the side away from the house. "Inside"
 * is whatever the exterior walls close; failing that, the rooms; failing that,
 * the side toward the middle of the plan.
 */
export function outerSides(project: Project): Map<string, 1 | -1> {
  const ext = project.walls.filter((w) => w.kind === 'exterior');
  const closed = wallFaces(ext).filter((f) => polygonArea(f) >= 144);
  const pts = project.walls.flatMap((w) => [w.a, w.b]);
  const mid = { x: pts.reduce((s, p) => s + p.x, 0) / (pts.length || 1), y: pts.reduce((s, p) => s + p.y, 0) / (pts.length || 1) };
  const out = new Map<string, 1 | -1>();
  for (const w of ext) {
    const n = wallNormal(w);
    const c = pointAlong(w, wallLength(w) / 2);
    const probe = { x: c.x + n.x * (w.thickness / 2 + 2), y: c.y + n.y * (w.thickness / 2 + 2) };
    const inside = closed.length
      ? closed.some((f) => pointInPolygon(probe, f))
      : project.rooms.length
        ? project.rooms.some((r) => pointInPolygon(probe, r.points))
        : dot({ x: mid.x - c.x, y: mid.y - c.y }, n) > 0;
    out.set(w.id, inside ? -1 : 1);
  }
  return out;
}

export interface DimLabel {
  wall: Wall;
  /** Side of the wall the label sits on (relative to wallNormal). */
  side: 1 | -1;
  /** Centreline distance from wall.a to the label. */
  at: number;
  length: number;
}

/**
 * What each wall's dimension reads in a mode. Centre: the centreline. Inside:
 * the room-side faces, piece by piece (both sides of an interior wall unless
 * they match). Outside: exterior walls to their outside face, interior walls
 * on the centreline.
 */
export function wallDimLabels(project: Project, mode: DimMode): DimLabel[] {
  const centre = (w: Wall): DimLabel => ({ wall: w, side: 1, at: wallLength(w) / 2, length: wallLength(w) });
  if (mode === 'centre') return project.walls.map(centre);
  const spans = faceSpans(project);
  const outer = outerSides(project);
  const label = (f: FaceSpan): DimLabel => ({ wall: f.wall, side: f.side, at: (f.start + f.end) / 2, length: f.length });
  const out: DimLabel[] = [];
  for (const w of project.walls) {
    const mine = spans.filter((f) => f.wall.id === w.id);
    const o = outer.get(w.id);
    if (mode === 'outside') {
      if (o === undefined) out.push(centre(w));
      else out.push(...mine.filter((f) => f.side === o).map(label));
      continue;
    }
    if (o !== undefined) {
      out.push(...mine.filter((f) => f.side !== o).map(label));
      continue;
    }
    const left = mine.filter((f) => f.side === 1);
    const right = mine.filter((f) => f.side === -1);
    const same = left.length === right.length && left.every((f, i) => Math.abs(f.start - right[i].start) <= TOL && Math.abs(f.end - right[i].end) <= TOL);
    out.push(...(same ? left : mine).map(label));
  }
  return out;
}

/** Outside-face corners of the exterior walls, for the overall dimension strings. */
export function outerCorners(project: Project): Point[] {
  const outer = outerSides(project);
  return faceSpans(project)
    .filter((f) => outer.get(f.wall.id) === f.side)
    .flatMap((f) => [f.a, f.b]);
}

/**
 * Clear size of a rectangular room (four corners, square to the plan): its
 * centreline box less half of each bounding wall, to the faces being measured.
 * Null for other shapes.
 */
export function roomClearSize(project: Project, room: Room): { width: number; depth: number } | null {
  const sizes = room.points.length === 4 ? roomClearSizes(project, room) : [];
  return sizes.length === 1 ? { width: sizes[0].width, depth: sizes[0].depth } : null;
}

const squarePlan = (pts: Point[]) =>
  pts.every((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return Math.abs(p.x - q.x) < TOL || Math.abs(p.y - q.y) < TOL;
  });

/**
 * Clear sizes of a room square to the plan: one for a rectangle, two for an L
 * (its body and its leg, split at the inside corner the way that gives the
 * bigger body). Each is the piece's centreline box less half of each wall along
 * it (any wall along part of an edge counts); the split line itself has no wall.
 * Empty for other shapes.
 */
export function roomClearSizes(project: Project, room: Room): { width: number; depth: number; at: Point }[] {
  const pts = room.points;
  if (!squarePlan(pts) || (pts.length !== 4 && pts.length !== 6)) return [];
  // Half the wall along an edge, if a wall runs along any of it (an L's body edge is walled only part way).
  const wallOn = (p: Point) =>
    project.walls.find((o) => {
      const { along, perp } = projectOnWall(o, p);
      return perp <= TOL && along >= -TOL && along <= wallLength(o) + TOL;
    });
  const under = (a: Point, b: Point) => {
    const w = [0.25, 0.5, 0.75].map((t) => wallOn({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })).find(Boolean);
    return w ? faceHalf(project, w) : 0;
  };
  const clear = (x0: number, x1: number, y0: number, y1: number) => ({
    width: x1 - x0 - under({ x: x0, y: y0 }, { x: x0, y: y1 }) - under({ x: x1, y: y0 }, { x: x1, y: y1 }),
    depth: y1 - y0 - under({ x: x0, y: y0 }, { x: x1, y: y0 }) - under({ x: x0, y: y1 }, { x: x1, y: y1 }),
    at: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 },
  });
  const box = (q: Point[]) => {
    const xs = q.map((p) => p.x);
    const ys = q.map((p) => p.y);
    return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)] as const;
  };
  if (pts.length === 4) return [clear(...box(pts))];
  // The L's one inside (reflex) corner: cut through it across x or across y.
  const sign = Math.sign(pts.reduce((s, p, i) => s + p.x * pts[(i + 1) % 6].y - pts[(i + 1) % 6].x * p.y, 0));
  const reflex = pts.find((p, i) => {
    const [a, c] = [pts[(i + 5) % 6], pts[(i + 1) % 6]];
    return ((p.x - a.x) * (c.y - p.y) - (p.y - a.y) * (c.x - p.x)) * sign < 0;
  });
  if (!reflex) return [];
  // Clip a hair past the cut (a clipped L keeps a zero-width sliver along the cut line otherwise), then square the cut edge back up.
  type Box = readonly [number, number, number, number];
  const half = (n: Point, c: number): Box | null => {
    const q = clipHalfPlane(pts, n, c + 1e-3);
    if (!q.length) return null;
    const [x0, x1, y0, y1] = box(q);
    // n is ±x or ±y, c = dot(cut point, n): the cut line is x (or y) = ±c.
    if (n.x > 0) return [c, x1, y0, y1];
    if (n.x < 0) return [x0, -c, y0, y1];
    if (n.y > 0) return [x0, x1, c, y1];
    return [x0, x1, y0, -c];
  };
  const pieces = (n: Point, c: number) => [half(n, c), half({ x: -n.x, y: -n.y }, -c)].filter((b): b is Box => !!b);
  const options = [pieces({ x: 1, y: 0 }, reflex.x), pieces({ x: 0, y: 1 }, reflex.y)].filter((o) => o.length === 2);
  if (!options.length) return [];
  const area = ([x0, x1, y0, y1]: readonly number[]) => (x1 - x0) * (y1 - y0);
  options.sort((p, q) => Math.max(...q.map(area)) - Math.max(...p.map(area)));
  return options[0].sort((p, q) => area(q) - area(p)).map((b) => clear(...b));
}

/**
 * Dimension chains to the doors and windows of each exterior wall, on its
 * outside: wall end (or outside face) → each opening's centre → the other end.
 * Distances are along the centreline from wall.a.
 */
export function openingChains(project: Project, mode: DimMode): { wall: Wall; side: 1 | -1; stops: number[] }[] {
  const outer = outerSides(project);
  const spans = mode === 'centre' ? [] : faceSpans(project);
  const out: { wall: Wall; side: 1 | -1; stops: number[] }[] = [];
  for (const wall of project.walls) {
    const centres = project.openings.filter((o) => o.wallId === wall.id).map((o) => o.offset);
    if (!centres.length) continue;
    const side = outer.get(wall.id) ?? roomierSide(project, wall);
    const mine = spans.filter((f) => f.wall.id === wall.id && f.side === side);
    const [start, end] = mine.length ? [Math.min(...mine.map((f) => f.start)), Math.max(...mine.map((f) => f.end))] : [0, wallLength(wall)];
    out.push({ wall, side, stops: [start, ...centres.sort((a, b) => a - b), end] });
  }
  return out;
}

/** An interior wall's chain goes on the side of the bigger room (the +normal side if neither has one). */
function roomierSide(project: Project, wall: Wall): 1 | -1 {
  const mid = pointAlong(wall, wallLength(wall) / 2);
  const n = wallNormal(wall);
  const off = wall.thickness / 2 + 12;
  const area = (side: 1 | -1) => {
    const p = { x: mid.x + n.x * off * side, y: mid.y + n.y * off * side };
    const rooms = project.rooms.filter((r) => pointInPolygon(p, r.points)).map((r) => polygonArea(r.points));
    return rooms.length ? Math.min(...rooms) : 0;
  };
  return area(-1) > area(1) ? -1 : 1;
}

/**
 * Strings across the whole plan through the interior walls: along x, the
 * exterior ends and every interior wall standing square across that axis
 * (centreline, or both faces when measuring to faces); along y the same.
 * `ends` are the exterior extremes the overall dimension uses.
 */
export function interiorStrings(project: Project, mode: DimMode, ends: { x: [number, number]; y: [number, number] }): { x: number[]; y: number[] } {
  const inner = project.walls.filter((w) => w.kind !== 'exterior');
  const along = (axis: 'x' | 'y') => {
    const [lo, hi] = ends[axis];
    const stops: number[] = [];
    for (const w of inner) {
      // A wall square across x runs along y (constant x), and vice versa.
      const c = axis === 'x' ? w.a.x : w.a.y;
      const square = axis === 'x' ? Math.abs(w.a.x - w.b.x) < TOL : Math.abs(w.a.y - w.b.y) < TOL;
      if (!square || wallLength(w) < 1 || c <= lo + TOL || c >= hi - TOL) continue;
      const h = faceHalf(project, w);
      stops.push(...(mode === 'centre' ? [c] : [c - h, c + h]));
    }
    if (!stops.length) return [];
    return [lo, ...stops, hi].sort((p, q) => p - q).filter((v, i, all) => i === 0 || v - all[i - 1] > TOL);
  };
  return { x: along('x'), y: along('y') };
}

/**
 * The centreline length that gives a wall's face (the single piece on `side`)
 * the length typed. Moving the end can tilt the walls tied to it, which shifts
 * the corner a touch, so refine a few times.
 */
export function centrelineForFace(project: Project, wallId: string, side: 1 | -1, target: number): number | null {
  const faceOf = (p: Project) => {
    const mine = faceSpans(p).filter((f) => f.wall.id === wallId && f.side === side);
    return mine.length === 1 ? mine[0].length : null;
  };
  const w = project.walls.find((x) => x.id === wallId);
  let face = faceOf(project);
  if (!w || face === null) return null;
  let len = wallLength(w);
  for (let i = 0; i < 6 && Math.abs(face - target) > 1 / 64; i++) {
    len += target - face;
    if (len <= 0) return null;
    face = faceOf(projectReducer(project, { type: 'setWallLength', id: wallId, length: len }));
    if (face === null) return null;
  }
  return len;
}
