import { dist, polygonArea, polygonCentroid } from '../model/geometry.ts';
import type { Point } from '../model/types.ts';

// Measurements on a room's real outline (any simple polygon, not its bounding box):
// the narrowest place across it, a slope frame for sloped ceilings, half-plane
// clipping for "floor area under at least so much headroom", and triangulation
// for drawing a non-convex ceiling in 3D. Inches throughout.

const dot = (p: Point, n: Point) => p.x * n.x + p.y * n.y;

function signedArea(pts: Point[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** Inward unit normal of edge i (a → b). */
function inwardNormal(pts: Point[], i: number): Point {
  const a = pts[i];
  const b = pts[(i + 1) % pts.length];
  const len = dist(a, b) || 1;
  const s = signedArea(pts) > 0 ? 1 : -1;
  return { x: (-(b.y - a.y) / len) * s, y: ((b.x - a.x) / len) * s };
}

/** Distance along a ray to segment q0–q1, or Infinity. */
function rayHit(p: Point, d: Point, q0: Point, q1: Point): number {
  const ex = q1.x - q0.x;
  const ey = q1.y - q0.y;
  const den = d.x * ey - d.y * ex;
  if (Math.abs(den) < 1e-9) return Infinity;
  const wx = q0.x - p.x;
  const wy = q0.y - p.y;
  const s = (wx * ey - wy * ex) / den;
  const u = (wx * d.y - wy * d.x) / den;
  return s > 0.01 && u >= -1e-9 && u <= 1 + 1e-9 ? s : Infinity;
}

export interface Narrowest {
  width: number;
  /** The measured line: from a point on one edge straight across to the far side. */
  from: Point;
  to: Point;
}

/** An edge counts as "across" if it faces back within 30° of square. */
const FACING = Math.cos(Math.PI / 6);

/**
 * The narrowest place across the room: from points along every edge, straight in
 * (square to that edge) to the first edge on the far side, when that edge faces
 * back (within 30°). A rectangle gives its short side; an L the narrower leg; a
 * chamfered or acute corner isn't a "width". A shape with no facing sides at all
 * (a triangle) falls back to the plain distance across.
 */
export function narrowest(pts: Point[]): Narrowest | null {
  const n = pts.length;
  if (n < 3) return null;
  const normals = pts.map((_, i) => inwardNormal(pts, i));
  let best: Narrowest | null = null;
  let loose: Narrowest | null = null;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = dist(a, b);
    if (len < 1) continue;
    const nrm = normals[i];
    const steps = Math.max(2, Math.ceil(len / 6));
    for (let k = 0; k < steps; k++) {
      const t = (k + 0.5) / steps;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      let w = Infinity;
      let hit = -1;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const s = rayHit(p, nrm, pts[j], pts[(j + 1) % n]);
        if (s < w) [w, hit] = [s, j];
      }
      if (hit < 0) continue;
      const m: Narrowest = { width: w, from: p, to: { x: p.x + nrm.x * w, y: p.y + nrm.y * w } };
      if (!loose || w < loose.width) loose = m;
      if (dot(nrm, normals[hit]) <= -FACING + 1e-9 && (!best || w < best.width)) best = m;
    }
  }
  return best ?? loose;
}

export interface SlopeFrame {
  /** Unit direction the ceiling rises in (square to the room's longest edge, into the room). */
  dir: Point;
  /** dot(p, dir) at the low side. */
  d0: number;
  /** How far the room runs in that direction. */
  span: number;
}

/** Sloped ceilings rise square to the room's longest edge: a rectangle's short way across. */
export function slopeFrame(pts: Point[]): SlopeFrame | null {
  if (pts.length < 3) return null;
  let best = -1;
  let len = 0;
  for (let i = 0; i < pts.length; i++) {
    const l = dist(pts[i], pts[(i + 1) % pts.length]);
    if (l > len + 0.5) [best, len] = [i, l];
  }
  if (best < 0) return null;
  let dir = inwardNormal(pts, best);
  // Tidy -0 and float noise on square plans.
  dir = { x: Math.round(dir.x * 1e9) / 1e9 || 0, y: Math.round(dir.y * 1e9) / 1e9 || 0 };
  // Into the room as a whole (an odd outline can have its longest edge facing out of a notch).
  const c = polygonCentroid(pts);
  if (dot(c, dir) < dot(pts[best], dir)) dir = { x: -dir.x || 0, y: -dir.y || 0 };
  const ds = pts.map((p) => dot(p, dir));
  const d0 = Math.min(...ds);
  return { dir, d0, span: Math.max(...ds) - d0 };
}

/** The part of a polygon where dot(p, n) ≥ c (Sutherland–Hodgman against one half-plane). */
export function clipHalfPlane(pts: Point[], n: Point, c: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const dp = dot(p, n) - c;
    const dq = dot(q, n) - c;
    if (dp >= 0) out.push(p);
    if ((dp >= 0) !== (dq >= 0)) {
      const t = dp / (dp - dq);
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    }
  }
  return out.length >= 3 ? out : [];
}

/** Area of a polygon between two lines square to n: c0 ≤ dot(p, n) ≤ c1. */
export function areaBetween(pts: Point[], n: Point, c0: number, c1: number): number {
  const lo = clipHalfPlane(pts, n, c0);
  const band = lo.length ? clipHalfPlane(lo, { x: -n.x, y: -n.y }, -c1) : [];
  return band.length ? polygonArea(band) : 0;
}

/** Ear-clipping triangulation of a simple polygon (either winding). */
export function triangulate(pts: Point[]): [Point, Point, Point][] {
  const s = signedArea(pts) > 0 ? 1 : -1;
  const idx = pts.map((_, i) => i);
  const out: [Point, Point, Point][] = [];
  const cross = (a: Point, b: Point, c: Point) => ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) * s;
  const inside = (p: Point, a: Point, b: Point, c: Point) => cross(a, b, p) > 1e-9 && cross(b, c, p) > 1e-9 && cross(c, a, p) > 1e-9;
  let guard = idx.length * idx.length;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const [ia, ib, ic] = [idx[(k - 1 + idx.length) % idx.length], idx[k], idx[(k + 1) % idx.length]];
      const [a, b, c] = [pts[ia], pts[ib], pts[ic]];
      if (cross(a, b, c) <= 1e-9) continue;
      if (idx.some((j) => j !== ia && j !== ib && j !== ic && inside(pts[j], a, b, c))) continue;
      out.push([a, b, c]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) idx.splice(0, 1); // degenerate (collinear) leftovers
  }
  if (idx.length === 3 && cross(pts[idx[0]], pts[idx[1]], pts[idx[2]]) > 1e-9) out.push([pts[idx[0]], pts[idx[1]], pts[idx[2]]]);
  return out;
}
