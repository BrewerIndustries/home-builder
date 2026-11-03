import { dist, nearestWall, pointAlong, pointInPolygon, polygonArea, projectOnWall, wallLength, wallNormal } from '../model/geometry.ts';
import type { Counter, Point, Project, Room } from '../model/types.ts';
import type { Run } from './electrical.ts';
import type { MaterialLine } from './materials.ts';

// Kitchen counters and islands. A counter is a rectangle off its back edge;
// sinks and ranges split it into separate countertop spaces, which is what the
// receptacle rules count (IRC E3901.4, mirroring NEC 210.52(C)):
//   - every wall countertop space 12" or wider gets a receptacle, and no point
//     along its wall line is more than 24" from one (so ≤ 48" apart);
//   - every island space at least 24" long and 12" deep gets one.
// Peninsulas are treated as islands. Inches throughout.

export const COUNTER_DEPTH = 25;
export const COUNTER_HEIGHT = 36;
export const MIN_COUNTER_SPACE = 12;
export const ISLAND_MIN_LONG = 24;
export const ISLAND_MIN_SHORT = 12;
export const CUTOUT_WIDTH = { sink: 33, range: 30 } as const;

const TOL = 0.5;

export const counterLength = (c: Counter) => dist(c.a, c.b);

export function counterDir(c: Counter): Point {
  const len = counterLength(c) || 1;
  return { x: (c.b.x - c.a.x) / len, y: (c.b.y - c.a.y) / len };
}

/** Unit vector from the back edge toward the front. */
export function counterFront(c: Counter): Point {
  const d = counterDir(c);
  return { x: d.y * c.side, y: -d.x * c.side };
}

export function counterCorners(c: Counter): Point[] {
  const n = counterFront(c);
  return [c.a, c.b, { x: c.b.x + n.x * c.depth, y: c.b.y + n.y * c.depth }, { x: c.a.x + n.x * c.depth, y: c.a.y + n.y * c.depth }];
}

/** Point `t` along the back edge, `inset` toward the front. */
export function counterPoint(c: Counter, t: number, inset = 0): Point {
  const d = counterDir(c);
  const n = counterFront(c);
  return { x: c.a.x + d.x * t + n.x * inset, y: c.a.y + d.y * t + n.y * inset };
}

/** Countertop spaces along the back edge, [start, end], with sinks and ranges cut out. */
export function counterSpaces(c: Counter): [number, number][] {
  const len = counterLength(c);
  const cuts = c.cutouts.map((k) => [k.offset - k.width / 2, k.offset + k.width / 2] as [number, number]).sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  let cursor = 0;
  for (const [lo, hi] of [...cuts, [len, len] as [number, number]]) {
    if (lo - cursor > TOL) out.push([cursor, Math.min(lo, len)]);
    cursor = Math.max(cursor, hi);
  }
  return out;
}

/** The room a counter stands in (smallest room around its middle). */
export function counterRoom(project: Project, c: Counter): Room | undefined {
  const mid = counterPoint(c, counterLength(c) / 2, c.depth / 2);
  return project.rooms.filter((r) => pointInPolygon(mid, r.points)).sort((a, b) => polygonArea(a.points) - polygonArea(b.points))[0];
}

export function roomCounters(project: Project, room: Room): Counter[] {
  return project.counters.filter((c) => counterRoom(project, c)?.id === room.id);
}

export interface CounterSpan {
  counter: Counter;
  /** The counter's extent along the run. */
  lo: number;
  hi: number;
  /** Its countertop spaces along the run. */
  spaces: [number, number][];
}

/** Wall counters backed onto a wall-space run, in the run's own distances. */
export function counterSpans(project: Project, run: Run): CounterSpan[] {
  const out: CounterSpan[] = [];
  for (const c of project.counters) {
    if (c.island) continue;
    const d = counterDir(c);
    const n = counterFront(c);
    if (Math.abs(d.x * run.dir.y - d.y * run.dir.x) > 0.01 || n.x * run.inward.x + n.y * run.inward.y < 0.9) continue;
    // Back edge on the wall face: within a wall's half-thickness (plus slack) of the centreline.
    const off = Math.abs((c.a.x - run.a.x) * run.dir.y - (c.a.y - run.a.y) * run.dir.x);
    if (off > 12) continue;
    const ta = (c.a.x - run.a.x) * run.dir.x + (c.a.y - run.a.y) * run.dir.y;
    const sign = d.x * run.dir.x + d.y * run.dir.y > 0 ? 1 : -1;
    const clip = (s: number, e: number): [number, number] | null => {
      const [p, q] = [ta + s * sign, ta + e * sign];
      const lo = Math.max(0, Math.min(p, q));
      const hi = Math.min(run.length, Math.max(p, q));
      return hi - lo > TOL ? [lo, hi] : null;
    };
    const whole = clip(0, counterLength(c));
    if (!whole) continue;
    const spaces = counterSpaces(c).map(([s, e]) => clip(s, e)).filter((x): x is [number, number] => !!x).sort((p, q) => p[0] - q[0]);
    out.push({ counter: c, lo: whole[0], hi: whole[1], spaces });
  }
  return out.sort((p, q) => p.lo - q.lo);
}

/** Receptacle positions across one countertop space: evenly spaced, none more than 24" from any point. */
export function counterPositions(length: number): number[] {
  if (length < MIN_COUNTER_SPACE) return [];
  const n = Math.max(1, Math.ceil(length / 48));
  return Array.from({ length: n }, (_, i) => (length * (i + 0.5)) / n);
}

/** Island countertop spaces that need a receptacle (E3901.4), and where it's drawn. */
export function islandReceptacles(project: Project): { counterId: string; at: Point }[] {
  const out: { counterId: string; at: Point }[] = [];
  for (const c of project.counters) {
    if (!c.island) continue;
    for (const [s, e] of counterSpaces(c)) {
      const long = Math.max(e - s, c.depth);
      const short = Math.min(e - s, c.depth);
      if (long >= ISLAND_MIN_LONG && short >= ISLAND_MIN_SHORT) out.push({ counterId: c.id, at: counterPoint(c, (s + e) / 2, 4) });
    }
  }
  return out;
}

export function counterLines(project: Project): MaterialLine[] {
  if (!project.counters.length) return [];
  const lines: MaterialLine[] = [];
  const add = (item: string, qty: number, unit: string, basis: string) => qty > 0 && lines.push({ category: 'Kitchen', item, qty, unit, basis });
  const lf = project.counters.reduce((s, c) => s + counterLength(c), 0) / 12;
  const islands = project.counters.filter((c) => c.island).length;
  add('Base cabinets (allowance)', Math.ceil(lf * 2) / 2, 'LF', `${project.counters.length} run${project.counters.length > 1 ? 's' : ''}${islands ? `, ${islands} island${islands > 1 ? 's' : ''}` : ''}`);
  const sqft = project.counters.reduce((s, c) => s + counterLength(c) * c.depth, 0) / 144;
  add('Countertop (allowance)', Math.ceil(sqft), 'sq ft', 'counter outlines, sink and range openings not deducted');
  const count = (k: string) => project.counters.reduce((s, c) => s + c.cutouts.filter((x) => x.kind === k).length, 0);
  add('Kitchen sink + faucet (allowance)', count('sink'), 'ea', 'from the counters');
  add('Range (allowance)', count('range'), 'ea', 'from the counters');
  return lines;
}

/**
 * A counter from a Counter-tool drag. Starting within 36" of a wall makes a wall
 * counter on that face, running along the drag (72" for a plain click); anywhere
 * else makes an island from the dragged rectangle (72" × 36" for a click).
 */
export function newCounter(project: Project, start: Point, end: Point, id: string): Counter {
  const near = nearestWall(project.walls, start, 36);
  if (near) {
    const w = near.wall;
    const len = wallLength(w);
    const n = wallNormal(w);
    const foot = pointAlong(w, near.along);
    const s: 1 | -1 = (start.x - foot.x) * n.x + (start.y - foot.y) * n.y >= 0 ? 1 : -1;
    let t0 = near.along;
    let t1 = projectOnWall(w, end).along;
    if (Math.abs(t1 - t0) < MIN_COUNTER_SPACE) t1 = t0 + 72 <= len ? t0 + 72 : t0 - 72;
    [t0, t1] = [Math.round(Math.max(0, Math.min(t0, t1))), Math.round(Math.min(len, Math.max(t0, t1)))];
    const face = (t: number) => {
      const p = pointAlong(w, t);
      return { x: p.x + n.x * s * (w.thickness / 2), y: p.y + n.y * s * (w.thickness / 2) };
    };
    // a → b runs with the wall, so its left-hand normal is the wall's: the front is side s.
    return { id, a: face(t0), b: face(t1), depth: COUNTER_DEPTH, side: s, island: false, cutouts: [] };
  }
  let [x0, x1, y0, y1] = [Math.min(start.x, end.x), Math.max(start.x, end.x), Math.min(start.y, end.y), Math.max(start.y, end.y)];
  if (x1 - x0 < MIN_COUNTER_SPACE && y1 - y0 < MIN_COUNTER_SPACE) [x0, x1, y0, y1] = [start.x - 36, start.x + 36, start.y - 18, start.y + 18];
  x1 = Math.max(x1, x0 + MIN_COUNTER_SPACE);
  y1 = Math.max(y1, y0 + MIN_COUNTER_SPACE);
  // Back edge along the long side; the left-hand normal of +x is up (side -1 = down), of +y is right (+1).
  return x1 - x0 >= y1 - y0
    ? { id, a: { x: x0, y: y0 }, b: { x: x1, y: y0 }, depth: y1 - y0, side: -1, island: true, cutouts: [] }
    : { id, a: { x: x0, y: y0 }, b: { x: x0, y: y1 }, depth: x1 - x0, side: 1, island: true, cutouts: [] };
}
