import { dist, pointAlong, polygonCentroid, projectOnWall, wallNormal } from '../model/geometry.ts';
import { uid, type Outlet, type OutletKind, type Point, type Project, type Room, type RoomType } from '../model/types.ts';

// Receptacle layout per IRC Chapter 39 (which mirrors NEC 210.52):
//   E3901.2  general rooms — no point along the floor line of any wall space more
//            than 6 ft from a receptacle, so ≤ 12 ft apart; wall spaces ≥ 2 ft count;
//            doorways break wall space, windows don't.
//   E3901.4  kitchen countertops — no point more than 24" from one (≤ 48" apart).
//   E3901.6  bathrooms — at least one within 36" of each basin.
//   E3901.9  garages — at least one per car space.
//   E3901.10 hallways 10 ft or longer — at least one.
//   E3902    GFCI in bathrooms, kitchens (counter), garages, laundry, outdoors.
//
// We don't model counters or fixtures yet, so kitchens get countertop spacing on
// every wall and bathrooms get one GFCI on the longest run. Treat the result as a
// starting layout to adjust.

export const GENERAL_MAX_GAP = 144;
export const COUNTER_MAX_GAP = 48;
const MIN_WALL_SPACE = 24;
const CORNER_CLEAR = 6;

/** A stretch of a room's perimeter between doorways, in loop distance s ∈ [0, perimeter). */
export interface Run {
  start: number;
  length: number;
}

interface Loop {
  pts: Point[];
  cum: number[];
  perimeter: number;
}

function makeLoop(pts: Point[]): Loop {
  const cum = [0];
  for (let i = 0; i < pts.length; i++) cum.push(cum[i] + dist(pts[i], pts[(i + 1) % pts.length]));
  return { pts, cum, perimeter: cum[pts.length] };
}

function pointAt(loop: Loop, s: number): Point {
  const t = ((s % loop.perimeter) + loop.perimeter) % loop.perimeter;
  for (let i = 0; i < loop.pts.length; i++) {
    if (t <= loop.cum[i + 1] || i === loop.pts.length - 1) {
      const a = loop.pts[i];
      const b = loop.pts[(i + 1) % loop.pts.length];
      const len = loop.cum[i + 1] - loop.cum[i] || 1;
      const k = (t - loop.cum[i]) / len;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
  }
  return loop.pts[0];
}

/** Loop distance of the closest perimeter point to p, and how far p is from it. */
function locate(loop: Loop, p: Point): { s: number; off: number } {
  let best = { s: 0, off: Infinity };
  for (let i = 0; i < loop.pts.length; i++) {
    const a = loop.pts[i];
    const b = loop.pts[(i + 1) % loop.pts.length];
    const len = loop.cum[i + 1] - loop.cum[i];
    if (!len) continue;
    const k = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len)));
    const q = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    const off = dist(p, q);
    if (off < best.off) best = { s: loop.cum[i] + k * len, off };
  }
  return best;
}

/** Wall-space runs around a room: the perimeter with doorways cut out. */
export function roomRuns(project: Project, room: Room): { loop: Loop; runs: Run[] } {
  const loop = makeLoop(room.points);
  const walls = new Map(project.walls.map((w) => [w.id, w]));
  const doors: [number, number][] = [];
  for (const o of project.openings) {
    if (o.kind !== 'door') continue;
    const w = walls.get(o.wallId);
    if (!w) continue;
    const { s, off } = locate(loop, pointAlong(w, o.offset));
    if (off > w.thickness / 2 + 1) continue;
    doors.push([s - o.width / 2, s + o.width / 2]);
  }
  if (!doors.length) return { loop, runs: [{ start: 0, length: loop.perimeter }] };
  doors.sort((a, b) => a[0] - b[0]);
  const runs: Run[] = [];
  for (let i = 0; i < doors.length; i++) {
    const end = doors[i][1];
    const nextStart = i + 1 < doors.length ? doors[i + 1][0] : doors[0][0] + loop.perimeter;
    if (nextStart - end > 0) runs.push({ start: end, length: nextStart - end });
  }
  return { loop, runs };
}

function rule(type: RoomType): { gap: number; kind: OutletKind; height: number } | null {
  switch (type) {
    case 'kitchen':
      return { gap: COUNTER_MAX_GAP, kind: 'gfci', height: 44 };
    case 'bath':
      return { gap: Infinity, kind: 'gfci', height: 40 };
    case 'garage':
    case 'utility':
      return { gap: GENERAL_MAX_GAP, kind: 'gfci', height: 16 };
    default:
      return { gap: GENERAL_MAX_GAP, kind: 'duplex', height: 16 };
  }
}

/** Positions (loop distance) for receptacles on a run, evenly spaced so both rules hold. */
export function layoutRun(run: Run, gap: number): number[] {
  if (run.length < MIN_WALL_SPACE) return [];
  const n = Number.isFinite(gap) ? Math.max(1, Math.ceil(run.length / gap)) : 1;
  return Array.from({ length: n }, (_, i) => run.start + (run.length * (i + 0.5)) / n);
}

/** Auto-layout for every room. Returns new auto outlets (caller replaces the old auto ones). */
export function autoOutlets(project: Project): Outlet[] {
  const out: Outlet[] = [];
  for (const room of project.rooms) {
    const r = rule(room.type);
    if (!r) continue;
    const { loop, runs } = roomRuns(project, room);
    let targets: number[];
    if (room.type === 'bath') {
      const longest = [...runs].sort((a, b) => b.length - a.length)[0];
      targets = longest ? layoutRun(longest, Infinity) : [];
    } else if (room.type === 'hall') {
      targets = runs.some((x) => x.length >= 120) ? layoutRun([...runs].sort((a, b) => b.length - a.length)[0], Infinity) : [];
    } else {
      targets = runs.flatMap((run) => layoutRun(run, r.gap));
    }
    const centroid = polygonCentroid(room.points);
    for (let s of targets) {
      s = clearOfCorners(loop, s);
      const placed = attach(project, pointAt(loop, s), centroid);
      if (placed) out.push({ id: uid('e'), ...placed, kind: r.kind, height: r.height, auto: true });
    }
  }
  return out;
}

/** Nudge a position off a corner so the box doesn't land in it. */
function clearOfCorners(loop: Loop, s: number): number {
  for (const c of loop.cum) {
    const d = s - c;
    if (Math.abs(d) < CORNER_CLEAR) return c + (d >= 0 ? CORNER_CLEAR : -CORNER_CLEAR) * 2;
  }
  return s;
}

/** Put a perimeter point onto the wall under it, on the face toward `inside`. */
export function attach(project: Project, p: Point, inside: Point): Pick<Outlet, 'wallId' | 'offset' | 'side'> | null {
  let best: { wallId: string; along: number; perp: number; side: 1 | -1 } | null = null;
  for (const w of project.walls) {
    const { along, perp } = projectOnWall(w, p);
    if (perp > w.thickness / 2 + 1 || (best && perp >= best.perp)) continue;
    const n = wallNormal(w);
    const side = (inside.x - p.x) * n.x + (inside.y - p.y) * n.y >= 0 ? 1 : -1;
    best = { wallId: w.id, along, perp, side };
  }
  return best && { wallId: best.wallId, offset: best.along, side: best.side };
}

/** E3901.2 check against whatever outlets are on the plan now (auto or hand-placed). */
export function spacingGaps(project: Project, room: Room): { worst: number; limit: number; uncovered: boolean } {
  const limit = room.type === 'kitchen' ? COUNTER_MAX_GAP : GENERAL_MAX_GAP;
  const { loop, runs } = roomRuns(project, room);
  const walls = new Map(project.walls.map((w) => [w.id, w]));
  const centroid = polygonCentroid(room.points);
  const positions: number[] = [];
  for (const o of project.outlets) {
    const w = walls.get(o.wallId);
    if (!w) continue;
    const p = pointAlong(w, o.offset);
    const { s, off } = locate(loop, p);
    if (off > w.thickness / 2 + 1) continue;
    // Only receptacles on this room's face count.
    const n = wallNormal(w);
    const faces = (centroid.x - p.x) * n.x * o.side + (centroid.y - p.y) * n.y * o.side >= 0;
    if (faces) positions.push(s);
  }
  let worst = 0;
  let uncovered = false;
  for (const run of runs) {
    if (run.length < MIN_WALL_SPACE) continue;
    const inRun = positions
      .map((s) => (((s - run.start) % loop.perimeter) + loop.perimeter) % loop.perimeter)
      .filter((t) => t <= run.length)
      .sort((a, b) => a - b);
    if (!inRun.length) {
      uncovered = true;
      worst = Math.max(worst, run.length);
      continue;
    }
    // Ends count double: a point at the end of the run may be up to gap/2 away.
    worst = Math.max(worst, inRun[0] * 2, (run.length - inRun[inRun.length - 1]) * 2);
    for (let i = 1; i < inRun.length; i++) worst = Math.max(worst, inRun[i] - inRun[i - 1]);
  }
  return { worst, limit, uncovered };
}
