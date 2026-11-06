import { pointAlong, pointInPolygon, polygonArea, projectOnWall, wallDir, wallLength, wallNormal } from '../model/geometry.ts';
import type { DimAnchor, DimMode, Point, Project, Room, Wall } from '../model/types.ts';
import { wallFaces } from './enclosure.ts';
import { projectReducer } from '../model/store.ts';

// Wall faces for inside / outside dimensions. Each side of a wall is a strip
// `thickness / 2` off the centreline; it ends where it meets the next wall's
// face (mitred at corners, pulled back at Ts) and is cut into pieces wherever
// another wall tees in on that side. A free end runs to the drawn (square) end.
// Faces are the finished surfaces (drywall, sheathing) unless the project asks
// for framing faces, which sit 1/2" inside them (see finishedThickness).
// Inches throughout; `side` is relative to wallNormal.

const TOL = 0.5;

export interface FaceSpan {
  wall: Wall;
  side: 1 | -1;
  /** Along the centreline from wall.a, after the end adjustments (start may be < 0, end > length). */
  start: number;
  end: number;
  a: Point;
  b: Point;
  length: number;
}

const cross = (p: Point, q: Point) => p.x * q.y - p.y * q.x;
const dot = (p: Point, q: Point) => p.x * q.x + p.y * q.y;
const near = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y) <= TOL;

interface Ray {
  dir: Point;
  half: number;
}

/** Walls leaving `p` (other than `self`), as rays: ends at p give one, walls running through p give two. */
/** Half the wall's thickness to the faces being measured: finished, or the framing 1/2" in. */
export function faceHalf(project: Project, w: Wall): number {
  return (project.dimFaces === 'framing' ? Math.max(1, w.thickness - 1) : w.thickness) / 2;
}

function raysAt(project: Project, self: Wall, p: Point): Ray[] {
  const walls = project.walls;
  const out: Ray[] = [];
  for (const o of walls) {
    if (o.id === self.id) continue;
    const d = wallDir(o);
    const half = faceHalf(project, o);
    if (near(o.a, p)) out.push({ dir: d, half });
    else if (near(o.b, p)) out.push({ dir: { x: -d.x, y: -d.y }, half });
    else {
      const { along, perp } = projectOnWall(o, p);
      if (perp <= TOL && along > TOL && along < wallLength(o) - TOL) out.push({ dir: d, half }, { dir: { x: -d.x, y: -d.y }, half });
    }
  }
  return out;
}

/**
 * How far into the piece (from `p`, along `v`) its face on normal `n` stops:
 * meet the face of the first wall swept across going from `v` toward `n`.
 */
function faceCut(v: Point, n: Point, half: number, rays: Ray[]): number {
  const sigma = Math.sign(cross(v, n)) || 1;
  let best: Ray | null = null;
  let bestAngle = Infinity;
  for (const r of rays) {
    let a = Math.atan2(sigma * cross(v, r.dir), dot(v, r.dir));
    if (a < 0) a += 2 * Math.PI;
    if (a < 1e-3 || a >= bestAngle) continue;
    best = r;
    bestAngle = a;
  }
  if (!best) return -half; // free end: the drawn wall runs half a thickness past it
  if (Math.abs(bestAngle - Math.PI) < 1e-3) return 0; // straight on: the face just continues
  const u = best.dir;
  const m = { x: sigma * u.y, y: -sigma * u.x }; // that wall's face toward this one
  const r = { x: m.x * best.half - n.x * half, y: m.y * best.half - n.y * half };
  return cross(r, u) / cross(v, u);
}

/** Every face piece of every wall, both sides. */
export function faceSpans(project: Project): FaceSpan[] {
  const out: FaceSpan[] = [];
  for (const w of project.walls) {
    const len = wallLength(w);
    if (len < TOL) continue;
    const d = wallDir(w);
    const half = faceHalf(project, w);
    for (const side of [1, -1] as const) {
      const wn = wallNormal(w);
      const n = { x: wn.x * side, y: wn.y * side };
      // Ts on this side cut the face.
      const cuts = [0, len];
      for (const o of project.walls) {
        if (o.id === w.id) continue;
        for (const [e, f] of [[o.a, o.b], [o.b, o.a]]) {
          const { along, perp } = projectOnWall(w, e);
          if (perp > TOL || along <= TOL || along >= len - TOL) continue;
          if (dot({ x: f.x - e.x, y: f.y - e.y }, n) > TOL) cuts.push(along);
        }
      }
      const ts = [...new Set(cuts.map((t) => Math.round(t * 64) / 64))].sort((x, y) => x - y);
      for (let i = 1; i < ts.length; i++) {
        const [t0, t1] = [ts[i - 1], ts[i]];
        if (t1 - t0 <= TOL) continue;
        const p0 = pointAlong(w, t0);
        const p1 = pointAlong(w, t1);
        // At an interior cut the wall itself carries on past the point.
        const r0 = raysAt(project, w, p0);
        if (t0 > TOL) r0.push({ dir: { x: -d.x, y: -d.y }, half });
        const r1 = raysAt(project, w, p1);
        if (t1 < len - TOL) r1.push({ dir: d, half });
        const clamp = (x: number) => Math.max(-len, Math.min(len, x));
        const start = t0 + clamp(faceCut(d, n, half, r0));
        const end = t1 - clamp(faceCut({ x: -d.x, y: -d.y }, n, half, r1));
        if (end - start <= TOL) continue;
        const at = (t: number) => ({ x: w.a.x + d.x * t + n.x * half, y: w.a.y + d.y * t + n.y * half });
        out.push({ wall: w, side, start, end, a: at(start), b: at(end), length: end - start });
      }
    }
  }
  return out;
}

/**
 * The outside face of an exterior wall: the side away from the house. "Inside"
 * is whatever the exterior walls close; failing that, the rooms; failing that,
 * the side toward the middle of the plan.
 */
export function outerSides(project: Project): Map<string, 1 | -1> {
  const ext = project.walls.filter((w) => w.kind === 'exterior');
  const closed = wallFaces(ext).filter((f) => polygonArea(f) >= 144);
  const pts = project.walls.flatMap((w) => [w.a, w.b]);
  const mid = { x: pts.reduce((s, p) => s + p.x, 0) / (pts.length || 1), y: pts.reduce((s, p) => s + p.y, 0) / (pts.length || 1) };
  const out = new Map<string, 1 | -1>();
  for (const w of ext) {
    const n = wallNormal(w);
    const c = pointAlong(w, wallLength(w) / 2);
    const probe = { x: c.x + n.x * (w.thickness / 2 + 2), y: c.y + n.y * (w.thickness / 2 + 2) };
    const inside = closed.length
      ? closed.some((f) => pointInPolygon(probe, f))
      : project.rooms.length
        ? project.rooms.some((r) => pointInPolygon(probe, r.points))
        : dot({ x: mid.x - c.x, y: mid.y - c.y }, n) > 0;
    out.set(w.id, inside ? -1 : 1);
  }
  return out;
}

export interface DimLabel {
  wall: Wall;
  /** Side of the wall the label sits on (relative to wallNormal). */
  side: 1 | -1;
  /** Centreline distance from wall.a to the label. */
  at: number;
  length: number;
}

/**
 * What each wall's dimension reads in a mode. Centre: the centreline. Inside:
 * the room-side faces, piece by piece (both sides of an interior wall unless
 * they match). Outside: exterior walls to their outside face, interior walls
 * on the centreline.
 */
export function wallDimLabels(project: Project, mode: DimMode): DimLabel[] {
  const centre = (w: Wall): DimLabel => ({ wall: w, side: 1, at: wallLength(w) / 2, length: wallLength(w) });
  if (mode === 'centre') return project.walls.map(centre);
  const spans = faceSpans(project);
  const outer = outerSides(project);
  const label = (f: FaceSpan): DimLabel => ({ wall: f.wall, side: f.side, at: (f.start + f.end) / 2, length: f.length });
  const out: DimLabel[] = [];
  for (const w of project.walls) {
    const mine = spans.filter((f) => f.wall.id === w.id);
    const o = outer.get(w.id);
    if (mode === 'outside') {
      if (o === undefined) out.push(centre(w));
      else out.push(...mine.filter((f) => f.side === o).map(label));
      continue;
    }
    if (o !== undefined) {
      out.push(...mine.filter((f) => f.side !== o).map(label));
      continue;
    }
    const left = mine.filter((f) => f.side === 1);
    const right = mine.filter((f) => f.side === -1);
    const same = left.length === right.length && left.every((f, i) => Math.abs(f.start - right[i].start) <= TOL && Math.abs(f.end - right[i].end) <= TOL);
    out.push(...(same ? left : mine).map(label));
  }
  return out;
}

/** Outside-face corners of the exterior walls, for the overall dimension strings. */
export function outerCorners(project: Project): Point[] {
  const outer = outerSides(project);
  return faceSpans(project)
    .filter((f) => outer.get(f.wall.id) === f.side)
    .flatMap((f) => [f.a, f.b]);
}

/**
 * Clear size of a rectangular room (four corners, square to the plan): its
 * centreline box less half of each bounding wall, to the faces being measured.
 * Null for other shapes.
 */
export function roomClearSize(project: Project, room: Room): { width: number; depth: number } | null {
  const sizes = room.points.length === 4 ? roomClearSizes(project, room) : [];
  return sizes.length === 1 ? { width: sizes[0].width, depth: sizes[0].depth } : null;
}

const squarePlan = (pts: Point[]) =>
  pts.every((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return Math.abs(p.x - q.x) < TOL || Math.abs(p.y - q.y) < TOL;
  });

/**
 * Clear sizes of a room square to the plan: one for a rectangle, more for an
 * L, T or U. The outline is cut into rectangles through its inside corners,
 * all across x or all across y, whichever leaves the bigger main piece (ties:
 * fewer pieces); biggest first. Each is the piece's centreline box less half of
 * each wall along it (any wall along part of an edge counts); a cut line itself
 * has no wall. Empty for other shapes.
 */
export function roomClearSizes(project: Project, room: Room): { width: number; depth: number; at: Point }[] {
  const pts = room.points;
  if (pts.length < 4 || !squarePlan(pts)) return [];
  // Half the wall along an edge, if a wall runs along any of it (an L's body edge is walled only part way).
  const wallOn = (p: Point) =>
    project.walls.find((o) => {
      const { along, perp } = projectOnWall(o, p);
      return perp <= TOL && along >= -TOL && along <= wallLength(o) + TOL;
    });
  const under = (a: Point, b: Point) => {
    const w = [0.25, 0.5, 0.75].map((t) => wallOn({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })).find(Boolean);
    return w ? faceHalf(project, w) : 0;
  };
  const clear = ([x0, x1, y0, y1]: Box) => ({
    width: x1 - x0 - under({ x: x0, y: y0 }, { x: x0, y: y1 }) - under({ x: x1, y: y0 }, { x: x1, y: y1 }),
    depth: y1 - y0 - under({ x: x0, y: y0 }, { x: x1, y: y0 }) - under({ x: x0, y: y1 }, { x: x1, y: y1 }),
    at: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 },
  });
  const area = ([x0, x1, y0, y1]: Box) => (x1 - x0) * (y1 - y0);
  const options = [slabs(pts, 'x'), slabs(pts, 'y')].filter((o) => o.length);
  if (!options.length) return [];
  options.sort((p, q) => Math.max(...q.map(area)) - Math.max(...p.map(area)) || p.length - q.length);
  return options[0].sort((p, q) => area(q) - area(p)).map(clear);
}

type Box = [number, number, number, number];

/**
 * A square-to-the-plan outline cut into rectangles [x0, x1, y0, y1] by lines
 * across `axis` through its corners; neighbouring strips that span the same
 * band are joined back up, so only the inside corners really cut.
 */
function slabs(pts: Point[], axis: 'x' | 'y'): Box[] {
  const q = axis === 'x' ? pts : pts.map((p) => ({ x: p.y, y: p.x }));
  const xs = [...q.map((p) => p.x)].sort((a, b) => a - b).filter((v, i, all) => i === 0 || v - all[i - 1] > TOL);
  const edges = q.map((p, i) => [p, q[(i + 1) % q.length]] as const).filter(([a, b]) => Math.abs(a.y - b.y) < TOL && Math.abs(a.x - b.x) >= TOL);
  const out: Box[] = [];
  let open: Box[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const [x0, x1] = [xs[i], xs[i + 1]];
    const xm = (x0 + x1) / 2;
    const ys = edges.filter(([a, b]) => Math.min(a.x, b.x) < xm && xm < Math.max(a.x, b.x)).map(([a]) => a.y).sort((a, b) => a - b);
    const next: Box[] = [];
    for (let k = 0; k + 1 < ys.length; k += 2) {
      const [y0, y1] = [ys[k], ys[k + 1]];
      const prev = open.find((b) => Math.abs(b[2] - y0) < TOL && Math.abs(b[3] - y1) < TOL);
      if (prev) {
        prev[1] = x1;
        next.push(prev);
      } else {
        const b: Box = [x0, x1, y0, y1];
        out.push(b);
        next.push(b);
      }
    }
    open = next;
  }
  return axis === 'x' ? out : out.map(([y0, y1, x0, x1]) => [x0, x1, y0, y1]);
}

/**
 * Dimension chains to the doors and windows of each exterior wall, on its
 * outside: wall end (or outside face) → each opening's centre → the other end.
 * Distances are along the centreline from wall.a.
 */
export function openingChains(project: Project, mode: DimMode): { wall: Wall; side: 1 | -1; stops: number[] }[] {
  const outer = outerSides(project);
  const spans = mode === 'centre' ? [] : faceSpans(project);
  const out: { wall: Wall; side: 1 | -1; stops: number[] }[] = [];
  for (const wall of project.walls) {
    const centres = project.openings.filter((o) => o.wallId === wall.id).map((o) => o.offset);
    if (!centres.length) continue;
    const side = outer.get(wall.id) ?? roomierSide(project, wall);
    const mine = spans.filter((f) => f.wall.id === wall.id && f.side === side);
    const [start, end] = mine.length ? [Math.min(...mine.map((f) => f.start)), Math.max(...mine.map((f) => f.end))] : [0, wallLength(wall)];
    out.push({ wall, side, stops: [start, ...centres.sort((a, b) => a - b), end] });
  }
  return out;
}

/** An interior wall's chain goes on the side of the bigger room (the +normal side if neither has one). */
function roomierSide(project: Project, wall: Wall): 1 | -1 {
  const mid = pointAlong(wall, wallLength(wall) / 2);
  const n = wallNormal(wall);
  const off = wall.thickness / 2 + 12;
  const area = (side: 1 | -1) => {
    const p = { x: mid.x + n.x * off * side, y: mid.y + n.y * off * side };
    const rooms = project.rooms.filter((r) => pointInPolygon(p, r.points)).map((r) => polygonArea(r.points));
    return rooms.length ? Math.min(...rooms) : 0;
  };
  return area(-1) > area(1) ? -1 : 1;
}

export interface PartitionString {
  /** 'x': runs across the plan left to right through walls standing along y; 'y' the other way. */
  axis: 'x' | 'y';
  /** Where it runs: y for an 'x' string, x for a 'y' string. */
  at: number;
  /** Exterior wall (outer face, unless measuring centrelines) → each partition → exterior wall. */
  stops: number[];
}

/** A rectangle on the plan the strings through it should keep clear of (room labels): x0..x1, y0..y1. */
export interface Keepout {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * Strings through the partitions at each height they stand: for every interior
 * wall crossing a line within 60° of square (angled ones too), a line across
 * its run picks up every other partition crossing there. A string that only
 * repeats part of another is dropped. The one through the most walls comes
 * first (drawn outside the plan); the rest, in order, run through it. Each ends
 * at the exterior walls it meets at that height, or at `ends` when it meets
 * fewer than two. Stops are where the walls cross the line: centrelines, or
 * both faces (an angled wall's faces cross wider apart than its thickness).
 *
 * The line goes a third of the way along the stretch its walls share, or the
 * first of a few other places there that keeps `keepout` boxes (room labels)
 * out of the band the string's text needs (`band`: below / above the line).
 */
export function partitionStrings(
  project: Project,
  mode: DimMode,
  ends: { x: [number, number]; y: [number, number] },
  opts: { keepout?: Keepout[]; band?: [number, number] } = {},
): PartitionString[] {
  const out: PartitionString[] = [];
  const keepout = opts.keepout ?? [];
  const [below, above] = opts.band ?? [0, 0];
  for (const axis of ['x', 'y'] as const) {
    const across = axis === 'x' ? 'y' : 'x';
    const [lo, hi] = ends[axis];
    // How square the wall stands to the line: 1 = square, 0 = along it.
    const steep = (w: Wall) => Math.abs(w.b[across] - w.a[across]) / Math.max(1e-9, wallLength(w));
    const usable = (w: Wall) => wallLength(w) >= 1 && steep(w) >= 0.5;
    const span = (w: Wall) => [Math.min(w.a[across], w.b[across]), Math.max(w.a[across], w.b[across])] as const;
    // Where the centreline crosses the line.
    const pos = (w: Wall, at: number) => w.a[axis] + ((at - w.a[across]) * (w.b[axis] - w.a[axis])) / (w.b[across] - w.a[across]);
    // Half the wall, measured along the line.
    const halfAlong = (w: Wall) => faceHalf(project, w) / steep(w);
    // A partition must run past the line (not just end on it); an exterior wall may end on it (an L's corner).
    const crosses = (w: Wall, at: number) => span(w)[0] + TOL < at && at < span(w)[1] - TOL;
    const meets = (w: Wall, at: number) => span(w)[0] - TOL <= at && at <= span(w)[1] + TOL;
    const inner = project.walls.filter((w) => w.kind !== 'exterior' && usable(w));
    const outer = project.walls.filter((w) => w.kind === 'exterior' && usable(w));
    const blocked = (at: number) =>
      keepout.some((k) => k[`${axis}1` as 'x1'] > lo && k[`${axis}0` as 'x0'] < hi && k[`${across}1` as 'y1'] > at - above && k[`${across}0` as 'y0'] < at + below);
    const found: { walls: Wall[]; at: number }[] = [];
    for (const w of inner) {
      let walls = inner.filter((o) => crosses(o, (span(w)[0] + span(w)[1]) / 2));
      const [from, to] = [Math.max(...walls.map((o) => span(o)[0])), Math.min(...walls.map((o) => span(o)[1]))];
      const at = [1 / 3, 2 / 3, 1 / 4, 3 / 4, 1 / 6, 5 / 6, 1 / 2].map((t) => from + (to - from) * t).find((v) => !blocked(v)) ?? from + (to - from) / 3;
      walls = inner.filter((o) => crosses(o, at));
      const key = (ws: Wall[]) => ws.map((o) => o.id).sort().join();
      if (!found.some((f) => key(f.walls) === key(walls))) found.push({ walls, at });
    }
    const kept = found.filter((f) => !found.some((g) => g !== f && g.walls.length > f.walls.length && f.walls.every((w) => g.walls.includes(w))));
    kept.sort((p, q) => q.walls.length - p.walls.length || p.at - q.at);
    for (const { walls, at } of kept) {
      const stops = walls.flatMap((w) => {
        const c = pos(w, at);
        return mode === 'centre' ? [c] : [c - halfAlong(w), c + halfAlong(w)];
      });
      const ext = outer.filter((w) => meets(w, at)).sort((p, q) => pos(p, at) - pos(q, at));
      const [first, last] = [ext[0], ext.at(-1)];
      const local: [number, number] =
        ext.length >= 2 && first && last
          ? mode === 'centre'
            ? [pos(first, at), pos(last, at)]
            : [pos(first, at) - halfAlong(first), pos(last, at) + halfAlong(last)]
          : [lo, hi];
      const inside = stops.filter((v) => v > local[0] + TOL && v < local[1] - TOL);
      if (!inside.length) continue;
      out.push({ axis, at, stops: [local[0], ...inside, local[1]].sort((p, q) => p - q).filter((v, i, all) => i === 0 || v - all[i - 1] > TOL) });
    }
  }
  return out;
}

/**
 * The centreline length that gives a wall's face (the single piece on `side`)
 * the length typed. Moving the end can tilt the walls tied to it, which shifts
 * the corner a touch, so refine a few times.
 */
export function centrelineForFace(project: Project, wallId: string, side: 1 | -1, target: number): number | null {
  const faceOf = (p: Project) => {
    const mine = faceSpans(p).filter((f) => f.wall.id === wallId && f.side === side);
    return mine.length === 1 ? mine[0].length : null;
  };
  const w = project.walls.find((x) => x.id === wallId);
  let face = faceOf(project);
  if (!w || face === null) return null;
  let len = wallLength(w);
  for (let i = 0; i < 6 && Math.abs(face - target) > 1 / 64; i++) {
    len += target - face;
    if (len <= 0) return null;
    face = faceOf(projectReducer(project, { type: 'setWallLength', id: wallId, length: len }));
    if (face === null) return null;
  }
  return len;
}

/** The stops of a running string that get a total: all but the zero, skipping any closer than `gap` to the last one labelled (the end always shows). */
export function runningLabels(stops: number[], gap: number): number[] {
  const out: number[] = [];
  let last = stops[0];
  stops.slice(1).forEach((s, i, rest) => {
    const end = i === rest.length - 1;
    if (end && out.length && s - out.at(-1)! < gap) out.pop();
    if (end || s - last >= gap) {
      out.push(s);
      last = s;
    }
  });
  return out;
}

/**
 * Pin a placed dimension's point to the wall end it sits on (or just off, at a
 * face corner): the nearest end within a wall's thickness. None if no wall end
 * is that close.
 */
export function anchorFor(project: Project, p: Point): DimAnchor | undefined {
  let best: { at: DimAnchor; d: number } | null = null;
  for (const w of project.walls) {
    const len = wallLength(w);
    if (len < 1) continue;
    const n = wallNormal(w);
    for (const end of ['a', 'b'] as const) {
      const [e, o] = end === 'a' ? [w.a, w.b] : [w.b, w.a];
      const u = { x: (o.x - e.x) / len, y: (o.y - e.y) / len };
      const v = { x: p.x - e.x, y: p.y - e.y };
      const along = dot(v, u);
      const perp = dot(v, n);
      const d = Math.hypot(along, perp);
      if (Math.abs(along) <= w.thickness && Math.abs(perp) <= w.thickness && (!best || d < best.d - 1e-9)) best = { at: { wallId: w.id, end, along, perp }, d };
    }
  }
  return best?.at;
}

/** Where an anchored point is now; null if its wall is gone. */
export function anchorPoint(project: Project, at: DimAnchor): Point | null {
  const w = project.walls.find((x) => x.id === at.wallId);
  if (!w) return null;
  const len = wallLength(w);
  if (len < 1e-9) return null;
  const [e, o] = at.end === 'a' ? [w.a, w.b] : [w.b, w.a];
  const n = wallNormal(w);
  return { x: e.x + ((o.x - e.x) / len) * at.along + n.x * at.perp, y: e.y + ((o.y - e.y) / len) * at.along + n.y * at.perp };
}

/** Placed dimensions follow the wall ends they were snapped to; a point whose wall is gone stays put and lets go. */
export function followDims(_prev: Project, next: Project): Project {
  if (!next.dims?.length || !next.dims.some((d) => d.aAt || d.bAt)) return next;
  let changed = false;
  const dims = next.dims.map((d) => {
    if (!d.aAt && !d.bAt) return d;
    const move = (p: Point, at: DimAnchor | undefined): [Point, DimAnchor | undefined] => {
      if (!at) return [p, at];
      const q = anchorPoint(next, at);
      return q ? [q, at] : [p, undefined];
    };
    const [a, aAt] = move(d.a, d.aAt);
    const [b, bAt] = move(d.b, d.bAt);
    if (a.x === d.a.x && a.y === d.a.y && b.x === d.b.x && b.y === d.b.y && aAt === d.aAt && bAt === d.bAt) return d;
    changed = true;
    return { ...d, a, b, aAt, bAt };
  });
  return changed ? { ...next, dims } : next;
}
