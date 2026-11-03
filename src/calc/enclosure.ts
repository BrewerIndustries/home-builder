import { dist, pointInPolygon, polygonArea } from '../model/geometry.ts';
import type { Point, Wall } from '../model/types.ts';

// "Click inside to make a room": treat the wall centrelines as a planar graph,
// split at every crossing and T, prune dead-end stubs, trace its faces, and
// return the smallest face around the click. Any shape the walls close works —
// L-shapes, angled walls — and doors don't break the enclosure (walls run
// through openings). Inches throughout.

const TOL = 0.5;
const MIN_AREA = 144; // 1 sq ft: ignore slivers between doubled walls

/** Where the wall meets segment pq, as distances along pq (none if they don't touch). */
function hits(p: Point, q: Point, w: Wall): number[] {
  const len = dist(p, q);
  if (len < TOL) return [];
  const d = { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
  const out: number[] = [];
  // The other wall's ends lying on pq (T-junctions and collinear overlaps).
  for (const e of [w.a, w.b]) {
    const t = (e.x - p.x) * d.x + (e.y - p.y) * d.y;
    const off = Math.abs((e.x - p.x) * d.y - (e.y - p.y) * d.x);
    if (off <= TOL && t > -TOL && t < len + TOL) out.push(Math.max(0, Math.min(len, t)));
  }
  // A proper crossing.
  const r = { x: w.b.x - w.a.x, y: w.b.y - w.a.y };
  const den = d.x * r.y - d.y * r.x;
  if (Math.abs(den) > 1e-9) {
    const ax = w.a.x - p.x;
    const ay = w.a.y - p.y;
    const t = (ax * r.y - ay * r.x) / den;
    const u = (ax * d.y - ay * d.x) / den;
    if (t > TOL && t < len - TOL && u > 0 && u < 1) out.push(t);
  }
  return out;
}

/** Faces of the wall graph, each a closed loop of points (either winding). */
export function wallFaces(walls: Wall[]): Point[][] {
  const verts: Point[] = [];
  const vid = (p: Point) => {
    const i = verts.findIndex((v) => dist(v, p) <= TOL);
    if (i >= 0) return i;
    verts.push({ x: p.x, y: p.y });
    return verts.length - 1;
  };

  const adj = new Map<number, Set<number>>();
  const link = (u: number, v: number) => {
    if (u === v) return;
    if (!adj.has(u)) adj.set(u, new Set());
    if (!adj.has(v)) adj.set(v, new Set());
    adj.get(u)!.add(v);
    adj.get(v)!.add(u);
  };

  for (const w of walls) {
    const len = dist(w.a, w.b);
    if (len < TOL) continue;
    const ts = [0, len, ...walls.filter((o) => o !== w).flatMap((o) => hits(w.a, w.b, o))].sort((x, y) => x - y);
    const at = (t: number) => ({ x: w.a.x + ((w.b.x - w.a.x) * t) / len, y: w.a.y + ((w.b.y - w.a.y) * t) / len });
    let prev = vid(at(ts[0]));
    for (let i = 1; i < ts.length; i++) {
      if (ts[i] - ts[i - 1] <= TOL) continue;
      const next = vid(at(ts[i]));
      link(prev, next);
      prev = next;
    }
  }

  // Dead ends (a stub wall, a wall drawn short of the corner) can't bound a room.
  let pruned = true;
  while (pruned) {
    pruned = false;
    for (const [u, ns] of adj) {
      if (ns.size > 1) continue;
      for (const v of ns) adj.get(v)!.delete(u);
      adj.delete(u);
      pruned = true;
    }
  }

  // Neighbours in angle order; walking "turn to the previous one" traces each face once.
  const order = new Map<number, number[]>();
  for (const [u, ns] of adj) {
    const angle = (v: number) => Math.atan2(verts[v].y - verts[u].y, verts[v].x - verts[u].x);
    order.set(u, [...ns].sort((a, b) => angle(a) - angle(b)));
  }
  const seen = new Set<string>();
  const faces: Point[][] = [];
  for (const [u0, ns] of order) {
    for (const v0 of ns) {
      if (seen.has(`${u0}>${v0}`)) continue;
      const loop: number[] = [];
      let [u, v] = [u0, v0];
      for (let guard = 0; guard < 4 * verts.length + 8 && !seen.has(`${u}>${v}`); guard++) {
        seen.add(`${u}>${v}`);
        loop.push(u);
        const around = order.get(v)!;
        const w = around[(around.indexOf(u) - 1 + around.length) % around.length];
        [u, v] = [v, w];
      }
      faces.push(simplify(loop.map((i) => verts[i])));
    }
  }
  return faces.filter((f) => f.length >= 3);
}

/** Drop points that sit on a straight run (T-junctions from walls outside the face). */
function simplify(pts: Point[]): Point[] {
  let out = pts;
  for (let changed = true; changed && out.length > 3; ) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length];
      const b = out[i];
      const c = out[(i + 1) % out.length];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cross) / Math.max(dist(a, c), 1) <= TOL) {
        out = out.filter((_, j) => j !== i);
        changed = true;
        break;
      }
    }
  }
  return out;
}

/**
 * The smallest area the walls close around `p`, as a clockwise-on-screen
 * polygon, or null when the walls leave a gap.
 */
export function enclosedArea(walls: Wall[], p: Point): Point[] | null {
  let best: Point[] | null = null;
  let bestArea = Infinity;
  for (const f of wallFaces(walls)) {
    const area = polygonArea(f);
    if (area < MIN_AREA || area >= bestArea || !pointInPolygon(p, f)) continue;
    best = f;
    bestArea = area;
  }
  if (!best) return null;
  // Start at the top-left corner and wind one way, so rooms read the same however the walls were drawn.
  let s = 0;
  for (let i = 0; i < best.length; i++) if (best[i].y < best[s].y - TOL || (Math.abs(best[i].y - best[s].y) <= TOL && best[i].x < best[s].x)) s = i;
  const pts = [...best.slice(s), ...best.slice(0, s)];
  let signed = 0;
  for (let i = 0; i < pts.length; i++) signed += pts[i].x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * pts[i].y;
  return signed >= 0 ? pts : [pts[0], ...pts.slice(1).reverse()];
}

/** Same outline, ignoring start point and winding? */
export function samePolygon(a: Point[], b: Point[]): boolean {
  if (a.length !== b.length || Math.abs(polygonArea(a) - polygonArea(b)) > 1) return false;
  return a.every((p) => b.some((q) => dist(p, q) <= TOL));
}
