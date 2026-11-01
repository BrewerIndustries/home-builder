import { dist, pointAlong, projectOnWall, wallNormal } from '../model/geometry.ts';
import { regionEdges } from './regions.ts';
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
//
// Layout runs along the room's REGION edges (see regions.ts), one wall line at a
// time with doorways cut out. Treating each wall line separately is slightly
// stricter than the code (which lets wall space continue round a corner), so it
// never under-places.

export const GENERAL_MAX_GAP = 144;
export const COUNTER_MAX_GAP = 48;
const MIN_WALL_SPACE = 24;
const END_CLEAR = 6;

/** A straight stretch of wall space: from `a` along `dir` for `length`, facing `inward`. */
export interface Run {
  a: Point;
  dir: Point;
  length: number;
  inward: Point;
}

/** Wall-space runs around a room's region, with doorways cut out. */
export function roomRuns(project: Project, room: Room): Run[] {
  const walls = new Map(project.walls.map((w) => [w.id, w]));
  const runs: Run[] = [];
  for (const e of regionEdges(project, room)) {
    const length = dist(e.a, e.b);
    const dir = { x: (e.b.x - e.a.x) / length, y: (e.b.y - e.a.y) / length };
    const cuts: [number, number][] = [];
    for (const o of project.openings) {
      if (o.kind !== 'door') continue;
      const w = walls.get(o.wallId);
      if (!w) continue;
      const c = pointAlong(w, o.offset);
      const t = (c.x - e.a.x) * dir.x + (c.y - e.a.y) * dir.y;
      const perp = Math.abs((c.x - e.a.x) * dir.y - (c.y - e.a.y) * dir.x);
      if (perp <= w.thickness / 2 + 1 && t > -o.width / 2 && t < length + o.width / 2) cuts.push([t - o.width / 2, t + o.width / 2]);
    }
    cuts.sort((p, q) => p[0] - q[0]);
    let cursor = 0;
    for (const [lo, hi] of [...cuts, [length, length] as [number, number]]) {
      if (lo > cursor) runs.push({ a: { x: e.a.x + dir.x * cursor, y: e.a.y + dir.y * cursor }, dir, length: lo - cursor, inward: e.inward });
      cursor = Math.max(cursor, hi);
    }
  }
  return runs;
}

function rule(type: RoomType): { gap: number; kind: OutletKind; height: number } {
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

/** Distances along a run for receptacles, evenly spaced so both rules hold. */
export function layoutRun(length: number, gap: number): number[] {
  if (length < MIN_WALL_SPACE) return [];
  const n = Number.isFinite(gap) ? Math.max(1, Math.ceil(length / gap)) : 1;
  return Array.from({ length: n }, (_, i) => Math.max(END_CLEAR, Math.min(length - END_CLEAR, (length * (i + 0.5)) / n)));
}

const longest = (runs: Run[]) => [...runs].sort((p, q) => q.length - p.length)[0];

/** Auto-layout for every room. Returns new auto outlets (caller replaces the old auto ones). */
export function autoOutlets(project: Project): Outlet[] {
  const out: Outlet[] = [];
  for (const room of project.rooms) {
    const r = rule(room.type);
    const runs = roomRuns(project, room);
    let targets: { run: Run; t: number }[];
    if (room.type === 'bath' || room.type === 'hall') {
      const run = longest(runs);
      const wanted = run && (room.type === 'bath' || runs.some((x) => x.length >= 120));
      targets = wanted ? layoutRun(run.length, Infinity).map((t) => ({ run, t })) : [];
    } else {
      targets = runs.flatMap((run) => layoutRun(run.length, r.gap).map((t) => ({ run, t })));
    }
    for (const { run, t } of targets) {
      const p = { x: run.a.x + run.dir.x * t, y: run.a.y + run.dir.y * t };
      const placed = attach(project, p, { x: p.x + run.inward.x * 12, y: p.y + run.inward.y * 12 });
      if (placed) out.push({ id: uid('e'), ...placed, kind: r.kind, height: r.height, auto: true });
    }
  }
  return out;
}

/** Put a point onto the wall under it, on the face toward `inside`. */
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

/** Receptacles on the plan that serve a run: on its wall line and facing into the room. */
function outletsOnRun(project: Project, run: Run): number[] {
  const walls = new Map(project.walls.map((w) => [w.id, w]));
  const ts: number[] = [];
  for (const o of project.outlets) {
    const w = walls.get(o.wallId);
    if (!w) continue;
    const c = pointAlong(w, o.offset);
    const t = (c.x - run.a.x) * run.dir.x + (c.y - run.a.y) * run.dir.y;
    const perp = Math.abs((c.x - run.a.x) * run.dir.y - (c.y - run.a.y) * run.dir.x);
    const n = wallNormal(w);
    const faces = (n.x * o.side) * run.inward.x + (n.y * o.side) * run.inward.y > 0;
    if (faces && perp <= w.thickness / 2 + 1 && t >= -0.5 && t <= run.length + 0.5) ts.push(t);
  }
  return ts.sort((p, q) => p - q);
}

/** Receptacles serving a room (any run of its region). */
export function roomOutletCount(project: Project, room: Room, kind?: OutletKind): number {
  const runs = roomRuns(project, room);
  const walls = new Map(project.walls.map((w) => [w.id, w]));
  return project.outlets.filter((o) => {
    if (kind && o.kind !== kind) return false;
    const w = walls.get(o.wallId);
    return !!w && runs.some((run) => outletsOnRun({ ...project, outlets: [o] }, run).length > 0);
  }).length;
}

/** E3901.2 / E3901.4 check against whatever outlets are on the plan now (auto or hand-placed). */
export function spacingGaps(project: Project, room: Room): { worst: number; limit: number; uncovered: boolean } {
  const limit = room.type === 'kitchen' ? COUNTER_MAX_GAP : GENERAL_MAX_GAP;
  let worst = 0;
  let uncovered = false;
  for (const run of roomRuns(project, room)) {
    if (run.length < MIN_WALL_SPACE) continue;
    const ts = outletsOnRun(project, run);
    if (!ts.length) {
      uncovered = true;
      worst = Math.max(worst, run.length);
      continue;
    }
    // A point at the end of a run may be up to half the gap from a receptacle.
    worst = Math.max(worst, ts[0] * 2, (run.length - ts[ts.length - 1]) * 2);
    for (let i = 1; i < ts.length; i++) worst = Math.max(worst, ts[i] - ts[i - 1]);
  }
  return { worst, limit, uncovered };
}
