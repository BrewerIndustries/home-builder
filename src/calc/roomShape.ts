import { dist, projectOnWall, wallLength } from '../model/geometry.ts';
import type { Point, Project, Room, Wall } from '../model/types.ts';
import { narrowest, slopeFrame, type Narrowest } from './outline.ts';

// A room's outline pulled in: to the finished wall faces (its clear outline, for
// R304.2), or by a fixed inset (a tray ceiling's raised centre). Plus the beam
// lines of a coffered ceiling clipped to the real outline. Room points sit on
// wall centrelines; inches throughout.

const TOL = 0.5;

function signedArea(pts: Point[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function perimeter(pts: Point[]): number {
  return pts.reduce((s, p, i) => s + dist(p, pts[(i + 1) % pts.length]), 0);
}

/**
 * The polygon with edge i moved in by d[i] (d may be one number for all).
 * Consecutive edges meet where their moved lines cross; a straight run whose
 * two pieces move by different amounts gets a square step. Null when the
 * insets are too big for the shape (an edge flips or the outline turns over).
 */
export function insetPolygon(pts: Point[], d: number | number[]): Point[] | null {
  const n = pts.length;
  if (n < 3) return null;
  const s = signedArea(pts) > 0 ? 1 : -1;
  const off = (i: number) => (typeof d === 'number' ? d : d[i] ?? 0);
  const edges = pts.map((a, i) => {
    const b = pts[(i + 1) % n];
    const len = dist(a, b) || 1;
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const nrm = { x: -u.y * s, y: u.x * s };
    const k = off(i);
    return { p: { x: a.x + nrm.x * k, y: a.y + nrm.y * k }, u, nrm, k };
  });
  const out: Point[] = [];
  for (let j = 0; j < n; j++) {
    const e0 = edges[(j - 1 + n) % n];
    const e1 = edges[j];
    const den = e0.u.x * e1.u.y - e0.u.y * e1.u.x;
    if (Math.abs(den) < 1e-9) {
      // Straight on: step from one offset to the other at the shared corner.
      const c = pts[j];
      out.push({ x: c.x + e0.nrm.x * e0.k, y: c.y + e0.nrm.y * e0.k });
      if (Math.abs(e0.k - e1.k) > 1e-9) out.push({ x: c.x + e1.nrm.x * e1.k, y: c.y + e1.nrm.y * e1.k });
      continue;
    }
    const w = { x: e1.p.x - e0.p.x, y: e1.p.y - e0.p.y };
    const t = (w.x * e1.u.y - w.y * e1.u.x) / den;
    out.push({ x: e0.p.x + e0.u.x * t, y: e0.p.y + e0.u.y * t });
  }
  // Every original edge must survive pointing the same way, and the whole must keep its winding.
  if (Math.sign(signedArea(out)) !== s || Math.abs(signedArea(out)) < 1) return null;
  const m = out.length;
  for (let i = 0; i < m; i++) {
    const a = out[i];
    const b = out[(i + 1) % m];
    const len = dist(a, b);
    if (len < 1e-6) continue;
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    // Step pieces run along a normal; others must run along some original edge, forwards.
    const along = edges.some((e) => Math.abs(e.u.x * u.y - e.u.y * u.x) < 1e-6 && e.u.x * u.x + e.u.y * u.y > 0);
    const step = edges.some((e) => Math.abs(e.nrm.x * u.y - e.nrm.y * u.x) < 1e-6);
    if (!along && !step) return null;
  }
  return out;
}

/** The wall a room edge runs along (any wall under a quarter, middle or three-quarter point of it). */
function wallAlong(project: Project, a: Point, b: Point): Wall | undefined {
  const on = (p: Point) =>
    project.walls.find((o) => {
      const { along, perp } = projectOnWall(o, p);
      return perp <= TOL && along >= -TOL && along <= wallLength(o) + TOL;
    });
  return [0.25, 0.5, 0.75].map((t) => on({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })).find(Boolean);
}

/**
 * The room's clear outline: each edge moved in to the finished face of the
 * wall along it (half its assembly thickness); edges with no wall (an opening
 * to the next space) stay put. Falls back to the drawn outline if the walls
 * are too thick for the shape.
 */
export function clearOutline(project: Project, room: Room): Point[] {
  const pts = room.points;
  const d = pts.map((a, i) => {
    const w = wallAlong(project, a, pts[(i + 1) % pts.length]);
    return w ? w.thickness / 2 : 0;
  });
  return (d.some((x) => x > 0) && insetPolygon(pts, d)) || pts;
}

/** Narrowest place across the room between finished faces (R304.2), with the line that measures it. */
export function clearNarrowest(project: Project, room: Room): Narrowest | null {
  return narrowest(clearOutline(project, room));
}

/** A tray's raised centre: the outline inset all round, kept at least 6" across each way. Null if it won't fit. */
export function trayOutline(pts: Point[], inset: number): Point[] | null {
  const across = narrowest(pts)?.width ?? 0;
  const k = Math.max(0, Math.min(inset, across / 2 - 6));
  return k > 0 ? insetPolygon(pts, k) : null;
}

export interface Beam {
  a: Point;
  b: Point;
}

/** Pieces of the line dot(p, n) = c inside the polygon. */
function chords(pts: Point[], n: Point, c: number): Beam[] {
  const u = { x: -n.y, y: n.x };
  const hits: Point[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const dp = p.x * n.x + p.y * n.y - c;
    const dq = q.x * n.x + q.y * n.y - c;
    if (dp < 0 === dq < 0) continue;
    const t = dp / (dp - dq);
    hits.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
  }
  hits.sort((p, q) => p.x * u.x + p.y * u.y - (q.x * u.x + q.y * u.y));
  const out: Beam[] = [];
  for (let i = 0; i + 1 < hits.length; i += 2) if (dist(hits[i], hits[i + 1]) > TOL) out.push({ a: hits[i], b: hits[i + 1] });
  return out;
}

/**
 * Interior beams of a coffered ceiling on the real outline: a grid square to
 * the room's longest edge (plan x / y for a square-on room), lines evenly
 * spaced no more than `spacing` apart each way, each clipped to the outline.
 */
export function cofferBeams(pts: Point[], spacing: number): Beam[] {
  const frame = slopeFrame(pts);
  if (!frame) return [];
  const dirs = [frame.dir, { x: -frame.dir.y || 0, y: frame.dir.x || 0 }];
  const out: Beam[] = [];
  for (const n of dirs) {
    const ds = pts.map((p) => p.x * n.x + p.y * n.y);
    const lo = Math.min(...ds);
    const span = Math.max(...ds) - lo;
    const count = Math.ceil(span / spacing);
    for (let i = 1; i < count; i++) out.push(...chords(pts, n, lo + (span * i) / count));
  }
  return out;
}
