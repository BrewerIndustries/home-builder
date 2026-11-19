import { dist, nearestWall, pointAlong, pointInPolygon, polygonArea, projectOnWall, samePoint, wallDir, wallLength, wallNormal } from '../model/geometry.ts';
import type { CornerCabinet, Counter, Cutout, Point, Project, Room, Wall } from '../model/types.ts';
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
export const CUTOUT_WIDTH = { sink: 33, range: 30, dishwasher: 24, fridge: 36, pantry: 24, oven: 30 } as const;
export const CUTOUT_LABEL = { sink: 'Sink', range: 'Range', dishwasher: 'Dishwasher', fridge: 'Fridge', pantry: 'Tall pantry', oven: 'Wall oven' } as const;
export const FRIDGE_HEIGHT = 70;
/** Tall pantry and oven cabinets: full height, to the top of the wall cabinets. */
export const TALL_HEIGHT = 84;
/** Full-height units in a run: no countertop or base cabinet there. */
export const isTall = (k: Cutout) => k.kind === 'fridge' || k.kind === 'pantry' || k.kind === 'oven';
/** Seating at an island: one stool per 24" of overhang edge; 15" of knee space at counter height, 12" at bar height (NKBA guideline). */
export const SEAT_WIDTH = 24;
export const KNEE_SPACE = 15;
export const BAR_HEIGHT = 42;
export const BAR_KNEE_SPACE = 12;
/** A counter's top: 36", or 42" for a bar-height island. */
export const counterHeight = (c: Counter) => (c.island && c.bar ? BAR_HEIGHT : COUNTER_HEIGHT);
export const kneeSpaceFor = (c: Counter) => (c.island && c.bar ? BAR_KNEE_SPACE : KNEE_SPACE);

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

/** Countertop spaces along the back edge, [start, end], with sinks, ranges and fridges cut out. */
export function counterSpaces(c: Counter): [number, number][] {
  const len = counterLength(c);
  const cuts = c.cutouts.filter((k) => k.kind !== 'dishwasher').map((k) => [k.offset - k.width / 2, k.offset + k.width / 2] as [number, number]).sort((p, q) => p[0] - q[0]);
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
    for (const [s, e] of freeSpaces(project, c)) {
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
  const width = (c: Counter, kinds: string[]) => c.cutouts.filter((k) => kinds.includes(k.kind)).reduce((s, k) => s + k.width, 0);
  const overlaps = counterOverlaps(project);
  // An L's corner square (or a peninsula's end over a wall counter) is one cabinet and one piece of top, not two.
  const shared = overlaps.reduce((s, o) => s + Math.min(o.onA[1] - o.onA[0], o.onB[1] - o.onB[0]), 0);
  const corners = cornerCabinets(project);
  // Corner units are priced on their own: take their corner square out of the run.
  const cornerLf = corners.reduce((s, k) => s + k.size, 0);
  const lf = (project.counters.reduce((s, c) => s + counterLength(c) - width(c, ['dishwasher', 'fridge', 'pantry', 'oven']), 0) - shared - cornerLf) / 12;
  const islands = project.counters.filter((c) => c.island).length;
  add('Base cabinets (allowance)', Math.ceil(lf * 2) / 2, 'LF', `${project.counters.length} run${project.counters.length > 1 ? 's' : ''}${islands ? `, ${islands} island${islands > 1 ? 's' : ''} / peninsula${islands > 1 ? 's' : ''}` : ''}, less dishwasher, fridge, tall-cabinet and corner spaces`);
  add('Corner base cabinet, lazy susan (allowance)', corners.filter((k) => k.kind === 'lazy-susan').length, 'ea', 'one per L corner set to lazy susan');
  add('Corner base cabinet, blind corner (allowance)', corners.filter((k) => k.kind === 'blind').length, 'ea', 'one per corner set to blind (default where a peninsula meets a run)');
  const sqft = (project.counters.reduce((s, c) => s + (counterLength(c) - width(c, ['fridge', 'pantry', 'oven'])) * c.depth, 0) - overlaps.reduce((s, o) => s + o.area, 0)) / 144;
  const seats = project.counters.filter((c) => (c.seating ?? 0) > 0);
  add('Countertop (allowance)', Math.ceil(sqft), 'sq ft', `counter outlines less fridge and tall-cabinet spaces${seats.length ? ', seating overhangs included' : ''}; sink and range openings not deducted`);
  const count = (k: string) => project.counters.reduce((s, c) => s + c.cutouts.filter((x) => x.kind === k).length, 0);
  add('Kitchen sink + faucet (allowance)', count('sink'), 'ea', 'from the counters');
  add('Range (allowance)', count('range'), 'ea', 'from the counters');
  add('Dishwasher (allowance)', count('dishwasher'), 'ea', 'from the counters');
  add('Refrigerator (allowance)', count('fridge'), 'ea', 'from the counters');
  add('Tall pantry cabinet (allowance)', count('pantry'), 'ea', 'full-height, from the counters');
  add('Wall oven cabinet (allowance)', count('oven'), 'ea', 'full-height, from the counters');
  add('Wall oven (allowance)', count('oven'), 'ea', 'one per oven cabinet');
  add('Countertop support brackets (allowance)', seats.reduce((s, c) => s + Math.max(2, Math.ceil(counterLength(c) / 36) + 1), 0), 'ea', 'under seating overhangs, about every 3 ft');
  const upper = project.counters.reduce((s, c) => s + upperSpans(project, c).reduce((t, [a, b]) => t + b - a, 0), 0) / 12;
  add('Wall cabinets (allowance)', Math.ceil(upper * 2) / 2, 'LF', 'over wall counters, less windows, range hoods and corner wall cabinets');
  add('Corner wall cabinet (allowance)', cornerUppers(project).length, 'ea', 'one diagonal unit per L corner with wall cabinets on both runs');
  const fillers = project.counters.reduce((s, c) => s + cabinetLayout(project, c).filter((x) => x.kind === 'filler').length, 0);
  add('Cabinet filler strips (allowance)', fillers, 'ea', 'from the cabinet-by-cabinet layout');
  add('Range hood (allowance)', count('range'), 'ea', 'one over each range');
  return lines;
}

/**
 * A counter from a Counter-tool drag. Starting within 36" of a wall makes a wall
 * counter on that face, running along the drag (72" for a plain click); anywhere
 * else makes an island from the dragged rectangle (72" × 36" for a click). A drag
 * that starts on a wall counter makes an island running into it: a peninsula.
 */
export function newCounter(project: Project, start: Point, end: Point, id: string): Counter {
  // Starting on a wall counter draws a peninsula off it, not another wall counter.
  const onCounter = project.counters.some((c) => !c.island && pointInPolygon(start, counterCorners(c)));
  const near = onCounter ? null : nearestWall(project.walls, start, 36);
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

/** The wall a counter's back edge sits on: within a slack of its face, parallel, facing away. */
export function counterHost(project: Project, c: Counter): { wall: Wall; side: 1 | -1; ta: number; tb: number } | null {
  if (c.island) return null;
  const d = counterDir(c);
  const f = counterFront(c);
  for (const w of project.walls) {
    const wd = wallDir(w);
    if (Math.abs(d.x * wd.y - d.y * wd.x) > 0.01) continue;
    const pa = projectOnWall(w, c.a);
    const pb = projectOnWall(w, c.b);
    if (Math.abs(pa.perp - w.thickness / 2) > 1 || Math.abs(pb.perp - w.thickness / 2) > 1) continue;
    const n = wallNormal(w);
    const side: 1 | -1 = (c.a.x - pointAlong(w, pa.along).x) * n.x + (c.a.y - pointAlong(w, pa.along).y) * n.y >= 0 ? 1 : -1;
    if (f.x * n.x * side + f.y * n.y * side < 0.9) continue;
    const len = wallLength(w);
    if (Math.max(pa.along, pb.along) < -1 || Math.min(pa.along, pb.along) > len + 1) continue;
    return { wall: w, side, ta: pa.along, tb: pb.along };
  }
  return null;
}

/**
 * After walls move (drag, end drag, length, thickness), carry the wall counters
 * along: same distances along the wall, on its new face, cut short if the wall
 * got shorter. Islands stay put.
 */
export function followWalls(prev: Project, next: Project): Project {
  if (prev.walls === next.walls || !next.counters.length) return next;
  const after = new Map(next.walls.map((w) => [w.id, w]));
  let changed = false;
  const counters = next.counters.map((c) => {
    const host = counterHost(prev, c);
    const w = host && after.get(host.wall.id);
    if (!host || !w) return c;
    const old = host.wall;
    if (samePoint(old.a, w.a) && samePoint(old.b, w.b) && old.thickness === w.thickness) return c;
    const len = wallLength(w);
    const n = wallNormal(w);
    const face = (t: number) => {
      const p = pointAlong(w, Math.max(0, Math.min(len, t)));
      return { x: p.x + n.x * host.side * (w.thickness / 2), y: p.y + n.y * host.side * (w.thickness / 2) };
    };
    const a = face(host.ta);
    const b = face(host.tb);
    if (dist(a, b) < MIN_COUNTER_SPACE) return c;
    changed = true;
    const shrunk = dist(a, b);
    return { ...c, a, b, cutouts: c.cutouts.map((k) => ({ ...k, width: Math.min(k.width, shrunk), offset: Math.max(Math.min(k.width, shrunk) / 2, Math.min(shrunk - Math.min(k.width, shrunk) / 2, k.offset)) })) };
  });
  return changed ? { ...next, counters } : next;
}

// ── v3: peninsulas, corners, wall cabinets ─────────────────────────────────

export const UPPER_DEPTH = 12;
export const UPPER_BOTTOM = 54;
export const UPPER_TOP = 84;

/** Wall cabinets hang over wall counters unless turned off. */
export const hasUppers = (c: Counter) => !c.island && c.uppers !== false;

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
const signedArea = (pts: Point[]) => pts.reduce((s, p, i) => s + p.x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * p.y, 0) / 2;

/** Intersection of two convex outlines (Sutherland–Hodgman). */
export function convexOverlap(subject: Point[], clipper: Point[]): Point[] {
  const sign = Math.sign(signedArea(clipper)) || 1;
  let out = subject;
  for (let i = 0; i < clipper.length && out.length; i++) {
    const a = clipper[i];
    const b = clipper[(i + 1) % clipper.length];
    const inside = (p: Point) => cross(a, b, p) * sign >= -1e-9;
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j];
      const q = input[(j + 1) % input.length];
      const meet = () => {
        const d1 = cross(a, b, p);
        const d2 = cross(a, b, q);
        const t = d1 / (d1 - d2);
        return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
      };
      if (inside(q)) {
        if (!inside(p)) out.push(meet());
        out.push(q);
      } else if (inside(p)) out.push(meet());
    }
  }
  return out;
}

/** Distance along a counter's back edge of a plan point. */
const along = (c: Counter, p: Point) => {
  const d = counterDir(c);
  return (p.x - c.a.x) * d.x + (p.y - c.a.y) * d.y;
};

export interface CounterOverlap {
  a: Counter;
  b: Counter;
  area: number;
  /** The overlap's extent along each counter's length. */
  onA: [number, number];
  onB: [number, number];
}

/** Where two counters share floor: the corner square of an L, or a peninsula running into a wall counter. */
export function counterOverlaps(project: Project): CounterOverlap[] {
  const out: CounterOverlap[] = [];
  const cs = project.counters;
  for (let i = 0; i < cs.length; i++)
    for (let j = i + 1; j < cs.length; j++) {
      const poly = convexOverlap(counterCorners(cs[i]), counterCorners(cs[j]));
      const area = poly.length >= 3 ? Math.abs(signedArea(poly)) : 0;
      if (area < 1) continue;
      const span = (c: Counter): [number, number] => {
        const ts = poly.map((p) => along(c, p));
        return [Math.min(...ts), Math.max(...ts)];
      };
      out.push({ a: cs[i], b: cs[j], area, onA: span(cs[i]), onB: span(cs[j]) });
    }
  return out;
}

/**
 * An island counter that runs into a wall or a wall counter at one end is a
 * peninsula. Returns how much of its length that connection takes up (measured
 * from the connected end), or null for a free-standing island.
 */
export function peninsulaJoin(project: Project, c: Counter): { end: 'a' | 'b'; cut: number } | null {
  if (!c.island) return null;
  const len = counterLength(c);
  for (const o of counterOverlaps(project)) {
    if (o.a.id !== c.id && o.b.id !== c.id) continue;
    const other = o.a.id === c.id ? o.b : o.a;
    if (other.island) continue;
    const [lo, hi] = o.a.id === c.id ? o.onA : o.onB;
    if (lo <= 1) return { end: 'a', cut: hi };
    if (hi >= len - 1) return { end: 'b', cut: len - lo };
  }
  // Butting up to a wall face (or a wall counter's front) with no overlap.
  const touches = (t: number) => {
    const ends = [counterPoint(c, t, 0), counterPoint(c, t, c.depth)];
    const onWall = project.walls.some((w) => ends.every((p) => projectOnWall(w, p).perp <= w.thickness / 2 + 1.5 && projectOnWall(w, p).along >= -1 && projectOnWall(w, p).along <= wallLength(w) + 1));
    const onCounter = project.counters.some((o) => !o.island && o.id !== c.id && ends.every((p) => {
      const t2 = along(o, p);
      const front = counterFront(o);
      const inset = (p.x - o.a.x) * front.x + (p.y - o.a.y) * front.y;
      return t2 >= -1 && t2 <= counterLength(o) + 1 && Math.abs(inset - o.depth) <= 1.5;
    }));
    return onWall || onCounter;
  };
  if (touches(0)) return { end: 'a', cut: 0 };
  if (touches(len)) return { end: 'b', cut: 0 };
  return null;
}

/** An island's or peninsula's countertop spaces; a peninsula's are measured from its connecting edge. */
export function freeSpaces(project: Project, c: Counter): [number, number][] {
  const join = peninsulaJoin(project, c);
  const len = counterLength(c);
  const [lo, hi] = !join ? [0, len] : join.end === 'a' ? [join.cut, len] : [0, len - join.cut];
  return counterSpaces(c)
    .map(([s, e]) => [Math.max(s, lo), Math.min(e, hi)] as [number, number])
    .filter(([s, e]) => e - s > TOL);
}

/** Wall-cabinet runs over a wall counter: its length less any window over it and the range (hood there instead). */
export function upperSpans(project: Project, c: Counter): [number, number][] {
  if (!hasUppers(c)) return [];
  const len = counterLength(c);
  const gaps: [number, number][] = c.cutouts.filter((k) => k.kind === 'range' || k.kind === 'pantry' || k.kind === 'oven').map((k) => [k.offset - k.width / 2, k.offset + k.width / 2]);
  // The corner wall cabinet takes the first 24" of each leg at an L (counted once, on its own).
  for (const u of cornerUppers(project)) {
    if (u.a.id === c.id) gaps.push(u.ta < len / 2 ? [0, CORNER_UPPER] : [len - CORNER_UPPER, len]);
    if (u.b.id === c.id) gaps.push(u.tb < len / 2 ? [0, CORNER_UPPER] : [len - CORNER_UPPER, len]);
  }
  const host = counterHost(project, c);
  if (host) {
    const sign = host.tb >= host.ta ? 1 : -1;
    for (const o of project.openings) {
      if (o.kind !== 'window' || o.wallId !== host.wall.id) continue;
      const [p, q] = [(o.offset - o.width / 2 - host.ta) * sign, (o.offset + o.width / 2 - host.ta) * sign];
      gaps.push([Math.min(p, q), Math.max(p, q)]);
    }
  }
  gaps.sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  let cursor = 0;
  for (const [s, e] of [...gaps, [len, len] as [number, number]]) {
    if (Math.min(s, len) - cursor >= MIN_COUNTER_SPACE) out.push([cursor, Math.min(s, len)]);
    cursor = Math.max(cursor, e);
  }
  return out;
}

// ── v4: L in one drag, corner cabinets, seating ───────────────────────────

/** Inside-face line of a wall on the side toward p: a point on it and the wall's direction. */
function faceToward(w: Wall, p: Point): { side: 1 | -1; at: (t: number) => Point } {
  const n = wallNormal(w);
  const side: 1 | -1 = (p.x - w.a.x) * n.x + (p.y - w.a.y) * n.y >= 0 ? 1 : -1;
  return {
    side,
    at: (t: number) => {
      const q = pointAlong(w, t);
      return { x: q.x + n.x * side * (w.thickness / 2), y: q.y + n.y * side * (w.thickness / 2) };
    },
  };
}

/** A wall counter on one face of w between distances t0 and t1 along it. */
function wallCounter(w: Wall, side: 1 | -1, t0: number, t1: number, id: string): Counter {
  const [lo, hi] = [Math.min(t0, t1), Math.max(t0, t1)];
  const n = wallNormal(w);
  const face = (t: number) => {
    const p = pointAlong(w, t);
    return { x: p.x + n.x * side * (w.thickness / 2), y: p.y + n.y * side * (w.thickness / 2) };
  };
  return { id, a: face(lo), b: face(hi), depth: COUNTER_DEPTH, side, island: false, cutouts: [] };
}

/** Where the inside faces of two crossing walls meet, and how far along each wall that is. */
function faceCorner(A: Wall, fa: ReturnType<typeof faceToward>, B: Wall, fb: ReturnType<typeof faceToward>): { at: Point; tA: number; tB: number } | null {
  const [dA, dB] = [wallDir(A), wallDir(B)];
  const den = dA.x * dB.y - dA.y * dB.x;
  if (Math.abs(den) < 0.98) return null;
  const [p0, q0] = [fa.at(0), fb.at(0)];
  const s = ((q0.x - p0.x) * dB.y - (q0.y - p0.y) * dB.x) / den;
  const at = { x: p0.x + dA.x * s, y: p0.y + dA.y * s };
  const [tA, tB] = [projectOnWall(A, at).along, projectOnWall(B, at).along];
  if (tA < -A.thickness || tA > wallLength(A) + A.thickness || tB < -B.thickness || tB > wallLength(B) + B.thickness) return null;
  return { at, tA, tB };
}

/** Walls whose line `p` is within reach of (36" past the face), turned square to / parallel with `dir`. */
function wallsBy(project: Project, p: Point, dir: Point, square: boolean, skip: string[]): Wall[] {
  return project.walls
    .filter((w) => {
      if (skip.includes(w.id)) return false;
      const d = wallDir(w);
      const dot = Math.abs(dir.x * d.x + dir.y * d.y);
      if (square ? dot > 0.02 : dot < 0.98) return false;
      const { along, perp } = projectOnWall(w, p);
      return perp <= w.thickness / 2 + 36 && along >= 0 && along <= wallLength(w);
    })
    .sort((a, b) => projectOnWall(a, p).perp - projectOnWall(b, p).perp);
}

/**
 * Counters from one Counter-tool drag. Starting by one wall and ending by a
 * wall square to it, past the corner where their inside faces meet, makes an
 * L: a run on each face, sharing the corner square. Ending by the wall facing
 * the first one makes a U: a run on each of the two and one along the wall
 * that joins them (the one nearest the drag). Anything else is one counter,
 * as newCounter.
 */
export function newCounters(project: Project, start: Point, end: Point, ids: string[]): Counter[] {
  const one = newCounter(project, start, end, ids[0]);
  if (one.island) return [one];
  const host = nearestWall(project.walls, start, 36)!.wall;
  // Still within reach of the first wall: a straight run.
  const own = projectOnWall(host, end);
  if (own.perp <= host.thickness / 2 + 36 && own.along >= 0 && own.along <= wallLength(host)) return [one];
  const dA = wallDir(host);
  const fa = faceToward(host, start);
  const sA = Math.round(projectOnWall(host, start).along);
  // Each leg must reach past the corner square to be worth a counter.
  const long = (c: Counter) => counterLength(c) >= COUNTER_DEPTH + MIN_COUNTER_SPACE;
  const B = wallsBy(project, end, dA, true, [host.id])[0];
  if (B) {
    const fb = faceToward(B, end);
    const k = faceCorner(host, fa, B, fb);
    if (!k) return [one];
    const first = wallCounter(host, fa.side, sA, k.tA, ids[0]);
    const second = wallCounter(B, fb.side, k.tB, Math.round(projectOnWall(B, end).along), ids[1]);
    return long(first) && long(second) ? [first, second] : [one];
  }
  // A U: the facing wall by the end, and a wall square to both that meets each one's face.
  const C = wallsBy(project, end, dA, false, [host.id])[0];
  if (!C || ids.length < 3) return [one];
  const fc = faceToward(C, end);
  if (fa.side * fc.side * (wallNormal(host).x * wallNormal(C).x + wallNormal(host).y * wallNormal(C).y) > 0) return [one];
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  let best: { B: Wall; ab: NonNullable<ReturnType<typeof faceCorner>>; cb: NonNullable<ReturnType<typeof faceCorner>>; gap: number } | null = null;
  for (const w of project.walls) {
    if (w.id === host.id || w.id === C.id) continue;
    const d = wallDir(w);
    if (Math.abs(dA.x * d.x + dA.y * d.y) > 0.02) continue;
    const fb = faceToward(w, mid);
    const ab = faceCorner(host, fa, w, fb);
    const cb = faceCorner(C, fc, w, fb);
    if (!ab || !cb) continue;
    const gap = projectOnWall(w, mid).perp;
    if (!best || gap < best.gap) best = { B: w, ab, cb, gap };
  }
  if (!best) return [one];
  const fb = faceToward(best.B, mid);
  const legs = [
    wallCounter(host, fa.side, sA, best.ab.tA, ids[0]),
    wallCounter(best.B, fb.side, best.ab.tB, best.cb.tB, ids[1]),
    wallCounter(C, fc.side, best.cb.tA, Math.round(projectOnWall(C, end).along), ids[2]),
  ];
  return legs.every(long) ? legs : [one];
}

export interface CornerUnit {
  a: Counter;
  b: Counter;
  kind: CornerCabinet;
  /** Length of the corner square along a run (taken out of the base-cabinet run). */
  size: number;
}

/** Corner base cabinets: where two wall counters meet (an L), or a peninsula runs into one. */
export function cornerCabinets(project: Project): CornerUnit[] {
  return counterOverlaps(project)
    .filter((o) => !o.a.island || !o.b.island)
    .map((o) => ({
      a: o.a,
      b: o.b,
      kind: o.a.corner ?? o.b.corner ?? (o.a.island || o.b.island ? 'blind' : 'lazy-susan'),
      size: Math.min(o.onA[1] - o.onA[0], o.onB[1] - o.onB[0]),
    }));
}

/** Overhang at an island's front, capped to its depth. */
export const seatingDepth = (c: Counter) => (c.island ? Math.max(0, Math.min(c.depth - MIN_COUNTER_SPACE, c.seating ?? 0)) : 0);

/** Stools along an island's seating edge: one per 24" (a peninsula's joined end left out), at their centres. */
export function seats(project: Project, c: Counter): number[] {
  if (!seatingDepth(c)) return [];
  const join = peninsulaJoin(project, c);
  const len = counterLength(c);
  const [lo, hi] = !join ? [0, len] : join.end === 'a' ? [join.cut, len] : [0, len - join.cut];
  const n = Math.floor((hi - lo) / SEAT_WIDTH + 1e-6);
  const pad = (hi - lo - n * SEAT_WIDTH) / 2;
  return Array.from({ length: n }, (_, i) => lo + pad + SEAT_WIDTH * (i + 0.5));
}

/** Turn an island round so its front (and seating) faces the other way; it stays where it is. */
export function flipCounter(c: Counter): Pick<Counter, 'a' | 'b' | 'side'> {
  const n = counterFront(c);
  return { a: { x: c.a.x + n.x * c.depth, y: c.a.y + n.y * c.depth }, b: { x: c.b.x + n.x * c.depth, y: c.b.y + n.y * c.depth }, side: c.side === 1 ? -1 : 1 };
}

// ── v5: corner wall cabinets, cabinet layout ──────────────────────────────

/** A diagonal corner wall cabinet: 24" along each wall from the inside corner. */
export const CORNER_UPPER = 24;

export interface CornerUpper {
  a: Counter;
  b: Counter;
  /** Which end of each run is at the corner (0 or its length). */
  ta: number;
  tb: number;
  /** Plan outline: the inside corner, 24" along each wall, 12" deep, cut on the diagonal. */
  outline: Point[];
}

/** Where two wall counters with wall cabinets meet in an L: one corner wall cabinet instead of two overlapping runs. */
export function cornerUppers(project: Project): CornerUpper[] {
  const out: CornerUpper[] = [];
  for (const o of counterOverlaps(project)) {
    if (!hasUppers(o.a) || !hasUppers(o.b)) continue;
    const [la, lb] = [counterLength(o.a), counterLength(o.b)];
    // An L meets at a run's end; a run crossing another mid-way isn't a corner.
    const end = (span: [number, number], len: number) => (span[0] <= 1 ? 0 : span[1] >= len - 1 ? len : null);
    const [ta, tb] = [end(o.onA, la), end(o.onB, lb)];
    if (ta === null || tb === null || la < CORNER_UPPER || lb < CORNER_UPPER) continue;
    const ia = ta === 0 ? CORNER_UPPER : la - CORNER_UPPER;
    const ib = tb === 0 ? CORNER_UPPER : lb - CORNER_UPPER;
    out.push({
      a: o.a,
      b: o.b,
      ta,
      tb,
      outline: [counterPoint(o.a, ta, 0), counterPoint(o.a, ia, 0), counterPoint(o.a, ia, UPPER_DEPTH), counterPoint(o.b, ib, UPPER_DEPTH), counterPoint(o.b, ib, 0)],
    });
  }
  return out;
}

/** Stock base-cabinet widths run 9" to 36" in 3" steps (wider ones exist; this keeps doors a usual size). */
export const CABINET_MIN = 9;
export const CABINET_MAX = 36;
export const CABINET_STEP = 3;

export type CabinetKind = 'base' | 'sink' | 'appliance' | 'tall' | 'corner' | 'filler' | 'joined';

export interface CabinetSlot {
  s: number;
  e: number;
  kind: CabinetKind;
  label: string;
}

/** Fill a stretch with stock widths: as few as fit under 36", near-equal, the odd inch or two left as a filler. */
export function fillStretch(len: number): number[] {
  if (len < CABINET_MIN - 1e-6) return [];
  const n = Math.ceil(len / CABINET_MAX - 1e-9);
  const base = Math.floor(len / n / CABINET_STEP + 1e-9) * CABINET_STEP;
  const widths = Array<number>(n).fill(base);
  let rem = len - n * base;
  for (let i = 0; i < n && rem >= CABINET_STEP - 1e-6 && widths[i] + CABINET_STEP <= CABINET_MAX; i++) {
    widths[i] += CABINET_STEP;
    rem -= CABINET_STEP;
  }
  return widths;
}

/**
 * The run broken into cabinets along its length: the corner unit, a sink base
 * under the sink (the sink's width rounded up to a stock size), gaps for the
 * dishwasher, range and fridge, tall cabinets, and stock-width base cabinets in
 * between, with fillers making up what's left (against a wall or the corner
 * where there is one).
 */
export function cabinetLayout(project: Project, c: Counter): CabinetSlot[] {
  const len = counterLength(c);
  const taken: CabinetSlot[] = [];
  const clip = (s: number, e: number): [number, number] => [Math.max(0, s), Math.min(len, e)];
  const join = peninsulaJoin(project, c);
  if (join && join.cut > TOL) taken.push({ ...(join.end === 'a' ? { s: 0, e: join.cut } : { s: len - join.cut, e: len }), kind: 'joined', label: 'joins the run' });
  for (const k of cornerCabinets(project)) {
    if (k.a.id !== c.id && k.b.id !== c.id) continue;
    const ov = counterOverlaps(project).find((o) => (o.a.id === k.a.id && o.b.id === k.b.id) || (o.a.id === k.b.id && o.b.id === k.a.id));
    if (!ov) continue;
    const [s, e] = ov.a.id === c.id ? ov.onA : ov.onB;
    if (join && c.island) continue; // a peninsula's joined end is already out
    taken.push({ s, e, kind: 'corner', label: k.kind === 'lazy-susan' ? 'Corner (lazy susan)' : 'Corner (blind)' });
  }
  for (const k of c.cutouts) {
    const stock = Math.ceil(k.width / CABINET_STEP - 1e-9) * CABINET_STEP;
    const [s, e] = clip(k.offset - k.width / 2, k.offset + k.width / 2);
    if (k.kind === 'sink') taken.push({ s, e, kind: 'sink', label: `SB${stock}` });
    else if (k.kind === 'pantry' || k.kind === 'oven') taken.push({ s, e, kind: 'tall', label: `${k.kind === 'pantry' ? 'Pantry' : 'Oven'} ${stock}` });
    else taken.push({ s, e, kind: 'appliance', label: `${CUTOUT_LABEL[k.kind]} ${formatIn(k.width)}` });
  }
  taken.sort((p, q) => p.s - q.s);
  const out: CabinetSlot[] = [];
  let at = 0;
  const host = counterHost(project, c);
  const stretch = (s: number, e: number) => {
    const span = e - s;
    if (span <= TOL) return;
    const widths = fillStretch(span);
    const used = widths.reduce((t, w) => t + w, 0);
    const filler = span - used;
    // The filler goes at a wall or corner end of the stretch (it gets scribed to fit); else at its far end.
    const atStart = (s <= TOL && !!host) || out.at(-1)?.kind === 'corner' || out.at(-1)?.kind === 'joined';
    let t = s;
    if (filler > TOL && atStart) out.push({ s: t, e: (t += filler), kind: 'filler', label: `Filler ${formatIn(filler)}` });
    for (const w of widths) out.push({ s: t, e: (t += w), kind: 'base', label: `B${w}` });
    if (filler > TOL && !atStart) out.push({ s: t, e: (t += filler), kind: 'filler', label: `Filler ${formatIn(filler)}` });
  };
  for (const k of taken) {
    if (k.e <= at + TOL) continue;
    stretch(at, Math.max(at, k.s));
    const s = Math.max(at, k.s);
    out.push({ ...k, s });
    at = k.e;
  }
  stretch(at, len);
  return out;
}

/** 1-1/2" style inches for cabinet labels. */
function formatIn(n: number): string {
  const whole = Math.floor(n + 1e-6);
  const eighths = Math.round((n - whole) * 8);
  if (eighths === 8) return `${whole + 1}"`;
  if (!eighths) return `${whole}"`;
  const [num, den] = eighths % 4 === 0 ? [eighths / 4, 2] : eighths % 2 === 0 ? [eighths / 2, 4] : [eighths, 8];
  return whole ? `${whole}-${num}/${den}"` : `${num}/${den}"`;
}
