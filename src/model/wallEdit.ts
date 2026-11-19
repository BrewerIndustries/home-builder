import { dist, openingSpan, pointAlong, pointInPolygon, projectOnWall, samePoint, wallDir, wallLength } from './geometry.ts';
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

/** A wall's plan angle, a → b: degrees anticlockwise from pointing right (plan y runs down), 0 ≤ angle < 360. */
export function wallAngle(w: Wall): number {
  const deg = (Math.atan2(-(w.b.y - w.a.y), w.b.x - w.a.x) * 180) / Math.PI;
  const a = Math.round(((deg % 360) + 360) % 360 * 1000) / 1000;
  return a === 360 ? 0 : a;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** The end that moves (and where to) to turn `wall` to `angle` about its start (`a`) or its end (`b`), keeping its length. */
export function rotateWall(wall: Wall, angle: number, pivot: 'a' | 'b'): { from: Point; to: Point } {
  const len = wallLength(wall);
  const r = (angle * Math.PI) / 180;
  const v = { x: Math.cos(r) * len, y: -Math.sin(r) * len };
  return pivot === 'a'
    ? { from: wall.b, to: { x: round3(wall.a.x + v.x), y: round3(wall.a.y + v.y) } }
    : { from: wall.a, to: { x: round3(wall.b.x - v.x), y: round3(wall.b.y - v.y) } };
}

/**
 * Swing a dragged end round `anchor`, keeping the wall's length: the end goes on
 * the circle at the pointer's bearing, in `step`-degree steps (0 = any angle).
 */
export function swingEnd(anchor: Point, radius: number, p: Point, step: number): { p: Point; angle: number } {
  let deg = (Math.atan2(-(p.y - anchor.y), p.x - anchor.x) * 180) / Math.PI;
  if (step) deg = Math.round(deg / step) * step;
  deg = ((deg % 360) + 360) % 360;
  const r = (deg * Math.PI) / 180;
  return { p: { x: round3(anchor.x + Math.cos(r) * radius), y: round3(anchor.y - Math.sin(r) * radius) }, angle: Math.round(deg * 10) / 10 % 360 };
}

/**
 * Snap a dragged wall end onto another wall: inside its thickness → onto its
 * centreline (a T); just outside a face (within `tol`) → onto that face line.
 * Walls already meeting at the dragged end are skipped. With an `anchor` (the
 * dragged wall's fixed end) the end keeps the wall square to the plan when it
 * nearly was; otherwise it drops straight onto the line.
 */
export function snapEndToWalls(
  project: Project,
  raw: Point,
  opts: { exclude: Point; anchor?: Point; tol: number },
): { p: Point; label: string } | null {
  let best: { p: Point; label: string; d: number } | null = null;
  for (const [i, w] of project.walls.entries()) {
    if (samePoint(w.a, opts.exclude) || samePoint(w.b, opts.exclude)) continue;
    const len = wallLength(w);
    const dir = wallDir(w);
    const n = { x: dir.y, y: -dir.x };
    const along = (raw.x - w.a.x) * dir.x + (raw.y - w.a.y) * dir.y;
    if (along < -opts.tol || along > len + opts.tol) continue;
    const perp = (raw.x - w.a.x) * n.x + (raw.y - w.a.y) * n.y;
    const half = w.thickness / 2;
    let offset: number;
    let label: string;
    if (Math.abs(perp) <= half) [offset, label] = [0, `onto W${i + 1}`];
    else if (Math.abs(perp) <= half + opts.tol) [offset, label] = [Math.sign(perp) * half, `to W${i + 1}'s face`];
    else continue;
    // The line to land on: w's centreline shifted by `offset`.
    const o = { x: w.a.x + n.x * offset, y: w.a.y + n.y * offset };
    let p = { x: o.x + dir.x * along, y: o.y + dir.y * along };
    if (opts.anchor) {
      // Keep it square: meet the line on the horizontal or vertical through the anchor, if that's near.
      for (const axis of [{ x: 1, y: 0 }, { x: 0, y: 1 }]) {
        const den = axis.x * dir.y - axis.y * dir.x;
        if (Math.abs(den) < 1e-6) continue;
        // anchor + s·axis on the line o + t·dir.
        const t = ((opts.anchor.x - o.x) * axis.y - (opts.anchor.y - o.y) * axis.x) / -den;
        const q = { x: o.x + dir.x * t, y: o.y + dir.y * t };
        if (dist(q, raw) <= Math.max(opts.tol, half + opts.tol) && t >= -1e-6 && t <= len + 1e-6) p = q;
      }
    }
    p = { x: round3(p.x), y: round3(p.y) };
    const d = Math.abs(Math.abs(perp) - Math.abs(offset));
    if (!best || d < best.d) best = { p, label, d };
  }
  return best && { p: best.p, label: best.label };
}

// ── v4: typed values for item drags, turning a room, angle snap ───────────

/**
 * Where a dragged item lands when a distance is typed after the drag: the same
 * direction it was dragged in, `len` from where it started (negative = back the
 * other way). Null if it didn't move.
 */
export function retarget(from: Point, to: Point, len: number): Point | null {
  const d = dist(from, to);
  if (d < 1e-6) return null;
  return { x: round3(from.x + ((to.x - from.x) / d) * len), y: round3(from.y + ((to.y - from.y) / d) * len) };
}

/** Turn a point anticlockwise (plan y runs down) by `deg` about `pivot`. */
export function turnPoint(p: Point, pivot: Point, deg: number): Point {
  const r = (deg * Math.PI) / 180;
  const [c, s] = [Math.cos(r), Math.sin(r)];
  const [x, y] = [p.x - pivot.x, p.y - pivot.y];
  return { x: round3(pivot.x + x * c + y * s), y: round3(pivot.y - x * s + y * c) };
}

/** Is q inside the outline or on its edge? */
function inOrOn(q: Point, pts: Point[]): boolean {
  if (pointInPolygon(q, pts)) return true;
  return pts.some((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const w = { id: '', a, b, kind: 'interior', thickness: 0, height: 0 } as Wall;
    return onSegment(w, q);
  });
}

/** A room's outline centre (the mean of its corners): the default pivot and mirror line. */
export function roomCentre(points: Point[]): Point {
  return { x: points.reduce((s, q) => s + q.x, 0) / points.length, y: points.reduce((s, q) => s + q.y, 0) / points.length };
}

/** How a room (or group) transform moves a point, turns a symbol (clockwise degrees), and whether it mirrors (flips sides). */
export interface RoomMap {
  point: (q: Point) => Point;
  rot: (deg: number) => number;
  flip: boolean;
}

const norm360 = (d: number) => Math.round(((((d % 360) + 360) % 360) % 360) * 1000) / 1000;

/** What moves together in a rigid edit: walls, rooms, counters, ceiling devices and furniture / fixtures (by id). */
export interface Group {
  walls: ReadonlySet<string>;
  rooms: ReadonlySet<string>;
  counters: ReadonlySet<string>;
  fixtures: ReadonlySet<string>;
  furniture: ReadonlySet<string>;
}

/** A room and everything in it: walls with both ends on or inside its outline, rooms inside it, counters, devices and furniture. */
export function roomGroup(p: Project, roomId: string): Group {
  const room = p.rooms.find((r) => r.id === roomId);
  if (!room) return { walls: new Set(), rooms: new Set(), counters: new Set(), fixtures: new Set(), furniture: new Set() };
  const inside = (q: Point) => inOrOn(q, room.points);
  return {
    walls: new Set(p.walls.filter((w) => inside(w.a) && inside(w.b)).map((w) => w.id)),
    rooms: new Set(p.rooms.filter((r) => r.id === room.id || r.points.every(inside)).map((r) => r.id)),
    counters: new Set(p.counters.filter((k) => inside(k.a) && inside(k.b)).map((k) => k.id)),
    fixtures: new Set(p.fixtures.filter((f) => inside(f.at)).map((f) => f.id)),
    furniture: new Set(p.furniture.filter((f) => inside(f.at)).map((f) => f.id)),
  };
}

/** Symbols with a handed layout (a corner shower's door corner): a mirror swaps the hand. */
const HANDED: ReadonlySet<string> = new Set(['corner-shower', 'neo-shower']);
const SWAP_RAILS = { left: 'right', right: 'left' } as const;

/**
 * Apply a rigid move to a group: its walls, rooms, counters, ceiling devices
 * and furniture. Openings, outlets and switches ride on their walls (a mirror
 * flips which face they're on and which way doors swing; handed symbols and
 * stair rails swap hands). A wall outside the group that meets a moved corner
 * stretches to follow, as when an end is dragged.
 */
export function transformGroup(p: Project, g: Group, m: RoomMap): Project {
  const moved = p.walls.filter((w) => g.walls.has(w.id));
  // Every corner that moves: the group's wall ends and its rooms' corners.
  const moving: Point[] = p.rooms.filter((r) => g.rooms.has(r.id)).flatMap((r) => r.points);
  for (const w of moved) moving.push(w.a, w.b);
  // Ts: other walls' ends and other rooms' corners sitting on a moved wall go with it, unless the
  // moved wall still runs through them (a mirror, or a slide along the wall): then they stay joined where they are.
  const after = moved.map((w) => ({ ...w, a: m.point(w.a), b: m.point(w.b) }));
  const tees: Point[] = [];
  for (const q of [...p.walls.flatMap((w) => [w.a, w.b]), ...p.rooms.flatMap((r) => r.points)]) {
    if (moved.some((w) => onSegment(w, q)) && !moving.some((mv) => samePoint(mv, q)) && !tees.some((t) => samePoint(t, q))) tees.push(q);
  }
  const moveIf = (q: Point) => {
    if (moving.some((mv) => samePoint(mv, q))) return m.point(q);
    if (tees.some((t) => samePoint(t, q))) return after.some((w) => onSegment(w, q)) ? q : m.point(q);
    return q;
  };
  const moveOutline = (r: Project['rooms'][number]) => {
    // Rooms in the group move with it (a mirror reverses their winding: put it back); a neighbour just stretches.
    if (g.rooms.has(r.id)) {
      const pts = r.points.map(m.point);
      // Reversing the points renumbers the edges: a picked slope edge i becomes n - 2 - i.
      const n = pts.length;
      const edge = r.ceiling?.slopeEdge;
      const ceiling = m.flip && r.ceiling && edge !== undefined ? { ...r.ceiling, slopeEdge: (((n - 2 - edge) % n) + n) % n } : r.ceiling;
      return { ...r, points: m.flip ? [...pts].reverse() : pts, ...(ceiling ? { ceiling } : {}), ...(r.pivot ? { pivot: m.point(r.pivot) } : {}) };
    }
    return { ...r, points: r.points.map(moveIf) };
  };
  const flipSide = <T extends { side: 1 | -1 }>(x: T): T => ({ ...x, side: x.side === 1 ? -1 : 1 });
  const handed = (f: Project['furniture'][number]) => {
    if (!m.flip) return f;
    let out = f;
    if (HANDED.has(f.kind)) out = { ...out, mirror: !f.mirror };
    if (f.kind === 'stairs' && f.handrails !== 'both' && f.handrails !== 'none') out = { ...out, handrails: SWAP_RAILS[f.handrails ?? 'right'] };
    // An L or U stair turns the other way in the mirror.
    if (f.kind === 'stairs' && (f.shape === 'L' || f.shape === 'U')) out = { ...out, turn: f.turn === 'left' ? undefined : 'left' };
    return out;
  };
  return {
    ...p,
    walls: p.walls.map((w) => ({ ...w, a: moveIf(w.a), b: moveIf(w.b) })),
    rooms: p.rooms.map(moveOutline),
    openings: m.flip ? p.openings.map((o) => (g.walls.has(o.wallId) && o.swing ? { ...o, swing: { ...o.swing, side: o.swing.side === 1 ? -1 : 1 } } : o)) : p.openings,
    outlets: m.flip ? p.outlets.map((o) => (g.walls.has(o.wallId) ? flipSide(o) : o)) : p.outlets,
    switches: m.flip ? p.switches.map((o) => (g.walls.has(o.wallId) ? flipSide(o) : o)) : p.switches,
    counters: p.counters.map((k) => (g.counters.has(k.id) ? { ...k, a: m.point(k.a), b: m.point(k.b), side: m.flip ? (k.side === 1 ? -1 : 1) : k.side } : k)),
    fixtures: p.fixtures.map((f) => (g.fixtures.has(f.id) ? { ...f, at: m.point(f.at) } : f)),
    furniture: p.furniture.map((f) => (g.furniture.has(f.id) ? handed({ ...f, at: m.point(f.at), rot: norm360(m.rot(f.rot)) }) : f)),
  };
}

/** A room and everything in it, moved rigidly (see roomGroup and transformGroup). */
function transformRoom(p: Project, roomId: string, m: RoomMap): Project {
  if (!p.rooms.some((r) => r.id === roomId)) return p;
  return transformGroup(p, roomGroup(p, roomId), m);
}

/**
 * Turn a room and everything in it about `pivot` (default: the room's own
 * pivot, else its outline's centre); anticlockwise is positive. See transformRoom.
 */
export function rotateRoom(p: Project, roomId: string, deg: number, pivot?: Point): Project {
  const room = p.rooms.find((r) => r.id === roomId);
  if (!room || !deg) return p;
  const c = pivot ?? room.pivot ?? roomCentre(room.points);
  // Furniture turns clockwise-positive, the plan anticlockwise: subtract.
  return transformRoom(p, roomId, { point: (q) => turnPoint(q, c, deg), rot: (r) => r - deg, flip: false });
}

/** Slide a room and everything in it by `delta`; walls attached outside stretch to follow. */
export function moveRoom(p: Project, roomId: string, delta: Point): Project {
  if (!delta.x && !delta.y) return p;
  return transformRoom(p, roomId, { point: (q) => ({ x: round3(q.x + delta.x), y: round3(q.y + delta.y) }), rot: (r) => r, flip: false });
}

/**
 * Mirror a room and everything in it across a line through its centre:
 * 'x' flips left ↔ right (about a vertical line), 'y' flips top ↔ bottom.
 */
export function mirrorRoom(p: Project, roomId: string, axis: 'x' | 'y'): Project {
  const room = p.rooms.find((r) => r.id === roomId);
  if (!room) return p;
  const c = roomCentre(room.points);
  return transformRoom(p, roomId, {
    point: (q) => (axis === 'x' ? { x: round3(2 * c.x - q.x), y: q.y } : { x: q.x, y: round3(2 * c.y - q.y) }),
    // A symbol's front (0, 1) turned clockwise by r is (−sin r, cos r): mirrored left-right that's −r, top-bottom 180 − r.
    rot: (r) => (axis === 'x' ? -r : 180 - r),
    flip: true,
  });
}

/** Angles (anticlockwise from +x, plan y down) of the plan's walls, for snapping a new or swung wall parallel or square to one. */
export function snapAngle(
  walls: Wall[],
  from: Point,
  p: Point,
  opts: { exclude?: Point; tol?: number } = {},
): { p: Point; angle: number; label: string } | null {
  const tol = opts.tol ?? 3;
  const len = dist(from, p);
  if (len < 6) return null;
  const at = (Math.atan2(-(p.y - from.y), p.x - from.x) * 180) / Math.PI;
  let best: { angle: number; off: number; label: string } | null = null;
  for (const w of walls) {
    if (wallLength(w) < 1) continue;
    if (opts.exclude && (samePoint(w.a, opts.exclude) || samePoint(w.b, opts.exclude))) continue;
    const base = (Math.atan2(-(w.b.y - w.a.y), w.b.x - w.a.x) * 180) / Math.PI;
    for (const [extra, how] of [[0, 'parallel to'], [90, 'square to']] as const) {
      // The candidate direction nearest the drag, either way along the line.
      const cand = base + extra;
      const diff = ((((at - cand) % 180) + 270) % 180) - 90;
      if (Math.abs(diff) > tol || (best && Math.abs(diff) >= best.off)) continue;
      best = { angle: at - diff, off: Math.abs(diff), label: `${how} ${w.id}` };
    }
  }
  if (!best) return null;
  const r = (best.angle * Math.PI) / 180;
  const angle = Math.round((((best.angle % 360) + 360) % 360) * 10) / 10;
  return { p: { x: round3(from.x + Math.cos(r) * len), y: round3(from.y - Math.sin(r) * len) }, angle, label: best.label };
}

/** The angle (degrees anticlockwise from +x, plan y down) of `p` seen from `c`. */
export function bearing(c: Point, p: Point): number {
  return (Math.atan2(-(p.y - c.y), p.x - c.x) * 180) / Math.PI;
}

/** A turn from one bearing to another, folded into −180…180 and snapped to `step` degrees. */
export function turnBetween(from: number, to: number, step: number): number {
  const d = ((((to - from) % 360) + 540) % 360) - 180;
  return step > 0 ? Math.round(d / step) * step : d;
}

/** Where a room's pivot lands: on a corner of the room, a wall end, or the centre when within `tol`, else to the inch. */
export function snapPivot(p: Project, roomId: string, q: Point, tol: number): Point {
  const room = p.rooms.find((r) => r.id === roomId);
  if (!room) return q;
  const cands = [roomCentre(room.points), ...room.points, ...p.walls.flatMap((w) => [w.a, w.b])];
  let best: Point | null = null;
  for (const c of cands) if (dist(c, q) <= tol && (!best || dist(c, q) < dist(best, q))) best = c;
  return best ? { x: round3(best.x), y: round3(best.y) } : { x: Math.round(q.x), y: Math.round(q.y) };
}

/** The turn handle of a selected room: above the middle of its top edge, `gap` clear of it. */
export function turnHandle(points: Point[], gap: number): Point {
  const xs = points.map((q) => q.x);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.min(...points.map((q) => q.y)) - gap };
}
