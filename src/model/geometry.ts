import type { Opening, Point, Wall } from './types.ts';

export const EPS = 0.01;

export function dist(p: Point, q: Point): number {
  return Math.hypot(p.x - q.x, p.y - q.y);
}

export function samePoint(p: Point, q: Point, tol = EPS): boolean {
  return dist(p, q) <= tol;
}

export function wallLength(w: Wall): number {
  return dist(w.a, w.b);
}

/** Unit direction a → b. */
export function wallDir(w: Wall): Point {
  const len = wallLength(w) || 1;
  return { x: (w.b.x - w.a.x) / len, y: (w.b.y - w.a.y) / len };
}

/** Left-hand normal of a → b (in y-down screen space this points "up-left"). */
export function wallNormal(w: Wall): Point {
  const d = wallDir(w);
  return { x: d.y, y: -d.x };
}

export function pointAlong(w: Wall, t: number): Point {
  const d = wallDir(w);
  return { x: w.a.x + d.x * t, y: w.a.y + d.y * t };
}

/** Project p onto the wall's segment. Returns distance along (clamped) and perpendicular distance. */
export function projectOnWall(w: Wall, p: Point): { along: number; perp: number } {
  const len = wallLength(w);
  const d = wallDir(w);
  const raw = (p.x - w.a.x) * d.x + (p.y - w.a.y) * d.y;
  const along = Math.max(0, Math.min(len, raw));
  const foot = pointAlong(w, along);
  return { along, perp: dist(p, foot) };
}

/** Wall nearest p within maxPerp, or null. */
export function nearestWall(walls: Wall[], p: Point, maxPerp: number): { wall: Wall; along: number } | null {
  let best: { wall: Wall; along: number; perp: number } | null = null;
  for (const w of walls) {
    const r = projectOnWall(w, p);
    if (r.perp <= maxPerp && (!best || r.perp < best.perp)) best = { wall: w, ...r };
  }
  return best && { wall: best.wall, along: best.along };
}

/** Polygon area via the shoelace formula (absolute, square inches). */
export function polygonArea(pts: Point[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
}

export function polygonCentroid(pts: Point[]): Point {
  const n = pts.length || 1;
  return { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n };
}

export function snapToGrid(p: Point, grid: number): Point {
  return { x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid };
}

/** Constrain `p` so the segment from `origin` is horizontal or vertical (whichever is closer). */
export function orthoFrom(origin: Point, p: Point): Point {
  return Math.abs(p.x - origin.x) >= Math.abs(p.y - origin.y) ? { x: p.x, y: origin.y } : { x: origin.x, y: p.y };
}

/** Every distinct wall endpoint, for snapping. */
export function wallEndpoints(walls: Wall[]): Point[] {
  const out: Point[] = [];
  for (const w of walls) {
    for (const p of [w.a, w.b]) if (!out.some((q) => samePoint(p, q))) out.push(p);
  }
  return out;
}

/** Keep an opening inside its wall: centre clamped so the unit never overhangs either end. */
export function clampOpeningOffset(wall: Wall, width: number, offset: number): number {
  const len = wallLength(wall);
  const half = width / 2;
  if (len <= width) return len / 2;
  return Math.max(half, Math.min(len - half, offset));
}

export function openingSpan(o: Opening): { start: number; end: number } {
  return { start: o.offset - o.width / 2, end: o.offset + o.width / 2 };
}

/**
 * The parts of `w` not already covered by a collinear wall in `existing`.
 * Returns `w` itself (same id) when nothing overlaps; split pieces get fresh ids.
 */
export function uncoveredPieces(w: Wall, existing: Wall[], tol = 0.5): Wall[] {
  const len = wallLength(w);
  const d = wallDir(w);
  const covered: [number, number][] = [];
  for (const e of existing) {
    // Collinear: both of e's endpoints sit on w's infinite line.
    const off = (q: Point) => Math.abs((q.x - w.a.x) * d.y - (q.y - w.a.y) * d.x);
    if (off(e.a) > tol || off(e.b) > tol) continue;
    const t1 = (e.a.x - w.a.x) * d.x + (e.a.y - w.a.y) * d.y;
    const t2 = (e.b.x - w.a.x) * d.x + (e.b.y - w.a.y) * d.y;
    const lo = Math.max(0, Math.min(t1, t2));
    const hi = Math.min(len, Math.max(t1, t2));
    if (hi - lo > tol) covered.push([lo, hi]);
  }
  if (!covered.length) return [w];
  covered.sort((x, y) => x[0] - y[0]);
  const pieces: [number, number][] = [];
  let cursor = 0;
  for (const [lo, hi] of covered) {
    if (lo - cursor > tol) pieces.push([cursor, lo]);
    cursor = Math.max(cursor, hi);
  }
  if (len - cursor > tol) pieces.push([cursor, len]);
  return pieces.map(([s, e], i) => ({
    ...w,
    id: `${w.id}_${i}`,
    a: pointAlong(w, s),
    b: pointAlong(w, e),
  }));
}
