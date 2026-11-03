import { dist, openingSpan, pointAlong, projectOnWall, samePoint, wallDir, wallLength } from './geometry.ts';
import type { Point, Project, Wall } from './types.ts';

// Whole-wall edits: slide a wall sideways with whatever is attached to it, split
// one into two, and join two collinear walls back into one. Openings, outlets
// and switches keep their place in the plan through all of them. Inches.

const TOL = 0.5;

function onSegment(w: Wall, q: Point): boolean {
  const { along, perp } = projectOnWall(w, q);
  return perp <= TOL && along >= -TOL && along <= wallLength(w) + TOL;
}

/**
 * Points that travel with a dragged wall: its ends, plus other walls' ends and
 * room corners that sit on it (Ts), so attached walls stretch instead of tearing off.
 */
export function wallDragPoints(project: Project, wall: Wall): Point[] {
  const out: Point[] = [{ ...wall.a }, { ...wall.b }];
  const add = (q: Point) => {
    if (onSegment(wall, q) && !out.some((o) => samePoint(o, q))) out.push({ ...q });
  };
  for (const w of project.walls) if (w.id !== wall.id) [w.a, w.b].forEach(add);
  for (const r of project.rooms) r.points.forEach(add);
  return out;
}

/** Move every wall end and room corner at one of `from` by `delta`. */
export function translatePoints(p: Project, from: Point[], delta: Point): Project {
  if (!delta.x && !delta.y) return p;
  const move = (q: Point) => (from.some((f) => samePoint(f, q)) ? { x: q.x + delta.x, y: q.y + delta.y } : q);
  return {
    ...p,
    walls: p.walls.map((w) => ({ ...w, a: move(w.a), b: move(w.b) })),
    rooms: p.rooms.map((r) => ({ ...r, points: r.points.map(move) })),
  };
}

/** Where to split a wall: its middle, or the nearest spot that doesn't cut through an opening. */
export function splitPoint(project: Project, wall: Wall): number | null {
  const len = wallLength(wall);
  const spans = project.openings.filter((o) => o.wallId === wall.id).map(openingSpan);
  const ok = (t: number) => t > 6 && t < len - 6 && spans.every((s) => t <= s.start || t >= s.end);
  const candidates = [len / 2, ...spans.flatMap((s) => [s.start, s.end])].filter(ok);
  if (!candidates.length) return null;
  candidates.sort((x, y) => Math.abs(x - len / 2) - Math.abs(y - len / 2));
  return Math.round(candidates[0] * 8) / 8;
}

/** Re-home whatever hangs on `from` (optionally only some of it) onto `to`, keeping plan positions. */
function rehome(p: Project, from: Wall, to: Wall, keep: (offset: number) => boolean = () => true): Project {
  const reversed = wallDir(from).x * wallDir(to).x + wallDir(from).y * wallDir(to).y < 0;
  const flip = <T extends 1 | -1>(s: T) => (reversed ? (-s as T) : s);
  const at = (offset: number) => projectOnWall(to, pointAlong(from, offset)).along;
  const mine = (x: { wallId: string; offset: number }) => x.wallId === from.id && keep(x.offset);
  return {
    ...p,
    openings: p.openings.map((o) =>
      mine(o)
        ? {
            ...o,
            wallId: to.id,
            offset: at(o.offset),
            swing: o.swing && { side: flip(o.swing.side), hinge: reversed ? (o.swing.hinge === 'a' ? 'b' : 'a') : o.swing.hinge },
          }
        : o,
    ),
    outlets: p.outlets.map((o) => (mine(o) ? { ...o, wallId: to.id, offset: at(o.offset), side: flip(o.side) } : o)),
    switches: p.switches.map((s) => (mine(s) ? { ...s, wallId: to.id, offset: at(s.offset), side: flip(s.side) } : s)),
  };
}

export function splitWall(p: Project, id: string, at: number, newId: string): Project {
  const w = p.walls.find((x) => x.id === id);
  if (!w || at <= TOL || at >= wallLength(w) - TOL) return p;
  const mid = pointAlong(w, at);
  const first: Wall = { ...w, b: mid };
  const second: Wall = { ...w, id: newId, a: mid };
  const i = p.walls.indexOf(w);
  const next = { ...p, walls: [...p.walls.slice(0, i), first, second, ...p.walls.slice(i + 1)] };
  // Items past the split move to the second piece; offsets from wall.a are unchanged on the first.
  return rehome(next, w, second, (offset) => offset > at);
}

/** Collinear walls sharing an end with this one — candidates for a join. */
export function joinCandidates(project: Project, wall: Wall): Wall[] {
  const d = wallDir(wall);
  return project.walls.filter((o) => {
    if (o.id === wall.id) return false;
    const shared = [wall.a, wall.b].some((e) => samePoint(e, o.a) || samePoint(e, o.b));
    const od = wallDir(o);
    return shared && Math.abs(d.x * od.y - d.y * od.x) < 1e-3;
  });
}

export function joinWalls(p: Project, id: string, otherId: string): Project {
  const w = p.walls.find((x) => x.id === id);
  const o = p.walls.find((x) => x.id === otherId);
  if (!w || !o || !joinCandidates(p, w).includes(o)) return p;
  const far = (e: Point) => (samePoint(e, o.a) ? o.b : o.a);
  // Keep this wall's direction (and so its own items' sides); extend it over the other.
  const merged: Wall =
    samePoint(w.b, o.a) || samePoint(w.b, o.b) ? { ...w, b: { ...far(w.b) } } : { ...w, a: { ...far(w.a) } };
  if (dist(merged.a, merged.b) <= wallLength(w) + TOL) return p; // overlapping, not end to end
  let next: Project = { ...p, walls: p.walls.filter((x) => x.id !== o.id).map((x) => (x.id === w.id ? merged : x)) };
  next = rehome(next, w, merged);
  return rehome(next, o, merged);
}

/** Snap targets for sliding `wall` sideways: lines (as distances along its normal) it can land on. */
export interface WallSnapTarget {
  level: number;
  label: string;
}

/**
 * Where a sideways-dragged wall can snap: the centreline of each parallel wall,
 * or flush with either of its faces. Levels are measured along `wall`'s normal
 * from the origin, as is the wall's own starting level.
 */
export function wallSnapTargets(project: Project, wall: Wall): { start: number; targets: WallSnapTarget[] } {
  const n = { x: wallDir(wall).y, y: -wallDir(wall).x };
  const level = (p: Point) => p.x * n.x + p.y * n.y;
  const targets: WallSnapTarget[] = [];
  project.walls.forEach((o, i) => {
    if (o.id === wall.id) return;
    const od = wallDir(o);
    if (Math.abs(od.x * n.x + od.y * n.y) > 1e-3) return; // not parallel
    const c = level(o.a);
    const name = `W${i + 1}`;
    targets.push({ level: c, label: `in line with ${name}` });
    const df = (o.thickness - wall.thickness) / 2;
    if (Math.abs(df) > 1e-6) {
      targets.push({ level: c + df, label: `flush with ${name}'s face` }, { level: c - df, label: `flush with ${name}'s face` });
    }
  });
  return { start: level(wall.a), targets };
}

/**
 * The sideways move to use for a raw drag of `perp` inches: a parallel wall's
 * line or face within `tol`, else the grid (for walls square to the plan), else
 * whole inches. `free` (Shift) skips the snapping.
 */
export function snapWallMove(
  snap: { start: number; targets: WallSnapTarget[] },
  perp: number,
  opts: { tol: number; grid: number; square: boolean; free?: boolean },
): { perp: number; label: string | null } {
  if (!opts.free) {
    const want = snap.start + perp;
    let best: WallSnapTarget | null = null;
    for (const t of snap.targets) if (Math.abs(t.level - want) <= opts.tol && (!best || Math.abs(t.level - want) < Math.abs(best.level - want))) best = t;
    if (best) return { perp: best.level - snap.start, label: best.label };
    if (opts.square) return { perp: Math.round(want / opts.grid) * opts.grid - snap.start, label: null };
  }
  return { perp: Math.round(perp), label: null };
}

/** Where to split a wall at a clicked distance along it: whole inches, clear of openings and the ends. */
export function splitAt(project: Project, wall: Wall, along: number): number | null {
  const t = Math.round(along);
  const len = wallLength(wall);
  if (t <= 6 || t >= len - 6) return null;
  const inOpening = project.openings.some((o) => {
    if (o.wallId !== wall.id) return false;
    const s = openingSpan(o);
    return t > s.start && t < s.end;
  });
  return inOpening ? null : t;
}
