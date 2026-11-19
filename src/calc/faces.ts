import { nearestWall, pointAlong, pointInPolygon, polygonArea, polygonCentroid, projectOnWall, wallDir, wallLength, wallNormal } from '../model/geometry.ts';
import type { Counter, DimAnchor, DimMode, OrdPoint, Point, Project, Room, Wall } from '../model/types.ts';
import { wallFaces } from './enclosure.ts';
import { projectReducer } from '../model/store.ts';
import { framingThickness } from '../model/assembly.ts';

// Wall faces for inside / outside dimensions. Each side of a wall is a strip
// `thickness / 2` off the centreline; it ends where it meets the next wall's
// face (mitred at corners, pulled back at Ts) and is cut into pieces wherever
// another wall tees in on that side. A free end runs to the drawn (square) end.
// Faces are the finished surfaces (the outermost layers of the wall's assembly)
// unless the project asks for framing faces: the stud depth alone (see assembly.ts).
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
/** Half the wall's thickness to the faces being measured: finished (all its layers), or the studs alone. */
export function faceHalf(project: Project, w: Wall): number {
  return (project.dimFaces === 'framing' ? Math.min(w.thickness, framingThickness(project, w)) : w.thickness) / 2;
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

/** How a dimension string reads: its own style if set, else the plan's. */
export function stringStyle(project: Project, id: string): 'chain' | 'running' {
  return project.dimStyles?.[id] ?? project.dimStyle ?? 'chain';
}

/** A fixture's or piece of furniture's point from its own frame (as furniturePoint; kept here to stay free of the fixture code). */
function itemPoint(f: Project['furniture'][number], x: number, y: number): Point {
  const r = (f.rot * Math.PI) / 180;
  const [c, s] = [Math.cos(r), Math.sin(r)];
  return { x: f.at.x + x * c - y * s, y: f.at.y + x * s + y * c };
}

/** A counter's point: `along` its back edge from a, `inset` toward the front (as counterPoint; kept here to stay free of the counter code). */
function counterAt(c: Counter, along: number, inset: number): Point {
  const len = Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y) || 1;
  const d = { x: (c.b.x - c.a.x) / len, y: (c.b.y - c.a.y) / len };
  const n = { x: d.y * c.side, y: -d.x * c.side };
  return { x: c.a.x + d.x * along + n.x * inset, y: c.a.y + d.y * along + n.y * inset };
}

/** Where a counter anchor's `along` is measured from: its a end, b end or middle. */
function counterBase(c: Counter, from: 'b' | 'mid' | undefined): number {
  const len = Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y);
  return from === 'b' ? len : from === 'mid' ? len / 2 : 0;
}

/** A room's centre: the middle of its outline's area. */
function roomMiddle(r: Room): Point {
  return polygonCentroid(r.points);
}

/** Points a dimension can pick on rooms: each outline corner and the centre. Pinned after wall ends, so a corner on a wall end follows the wall. */
export function roomSnapPoints(project: Project): { p: Point; at: DimAnchor }[] {
  const out: { p: Point; at: DimAnchor }[] = [];
  for (const r of project.rooms) {
    if (r.points.length < 3) continue;
    r.points.forEach((q, corner) => out.push({ p: { ...q }, at: { roomId: r.id, corner } }));
    out.push({ p: roomMiddle(r), at: { roomId: r.id } });
  }
  return out;
}

/** Points a dimension can pick on doors, windows, fixtures, counters and rooms: jambs (centreline and both faces), centres, corners, counter ends. */
export function dimSnapPoints(project: Project): { p: Point; at: DimAnchor }[] {
  const out: { p: Point; at: DimAnchor }[] = [];
  for (const o of project.openings) {
    const w = project.walls.find((x) => x.id === o.wallId);
    if (!w) continue;
    const [d, n] = [wallDir(w), wallNormal(w)];
    const c = pointAlong(w, o.offset);
    for (const along of [-o.width / 2, 0, o.width / 2])
      for (const perp of along ? [0, w.thickness / 2, -w.thickness / 2] : [0])
        out.push({ p: { x: c.x + d.x * along + n.x * perp, y: c.y + d.y * along + n.y * perp }, at: { openingId: o.id, along, perp } });
  }
  for (const f of project.furniture) {
    const [hw, hd] = [f.w / 2, f.d / 2];
    for (const [x, y] of [[0, 0], [-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd], [0, hd], [0, -hd], [-hw, 0], [hw, 0]] as const) out.push({ p: itemPoint(f, x, y), at: { furnitureId: f.id, x, y } });
  }
  // Counters: back and front corners, the middle of each end and of the front, and the centre.
  for (const c of project.counters) {
    const len = Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y);
    if (len < 1) continue;
    // Pinned from the end (or middle) they're at, so they stay at that end when the counter is lengthened.
    for (const [from, inset] of [[undefined, 0], ['b', 0], ['b', c.depth], [undefined, c.depth], [undefined, c.depth / 2], ['b', c.depth / 2], ['mid', c.depth], ['mid', c.depth / 2]] as const) {
      const at: DimAnchor = { counterId: c.id, ...(from && { from }), along: 0, inset };
      out.push({ p: counterAt(c, counterBase(c, from), inset), at });
    }
  }
  return [...out, ...roomSnapPoints(project)];
}

/**
 * Pin a placed dimension's point to what it was snapped to: a door / window /
 * fixture point within 1-1/2", else the wall end it sits on (or just off, at a
 * face corner) within a wall's thickness. None if nothing is that close.
 */
export function anchorFor(project: Project, p: Point): DimAnchor | undefined {
  const nearest = (pts: { p: Point; at: DimAnchor }[]) => {
    let item: { at: DimAnchor; d: number } | null = null;
    for (const s of pts) {
      const d = Math.hypot(s.p.x - p.x, s.p.y - p.y);
      if (d <= 1.5 && (!item || d < item.d - 1e-9)) item = { at: s.at, d };
    }
    return item?.at;
  };
  const item = nearest(dimSnapPoints(project).filter((s) => !('roomId' in s.at)));
  if (item) return item;
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
  return best?.at ?? nearest(roomSnapPoints(project));
}

/** What a dimension end follows, in words; null if that's gone. */
export function anchorTarget(project: Project, at: DimAnchor | undefined): string | null {
  if (!at) return null;
  if ('openingId' in at) {
    const o = project.openings.find((x) => x.id === at.openingId);
    return o ? `the ${o.kind}${at.along ? ` ${at.along < 0 ? 'start' : 'end'} jamb` : ' centre'}` : null;
  }
  if ('furnitureId' in at) {
    const f = project.furniture.find((x) => x.id === at.furnitureId);
    return f ? `the ${f.kind.replace('-', ' ')}` : null;
  }
  if ('counterId' in at) {
    const c = project.counters.find((x) => x.id === at.counterId);
    return c ? `the ${c.island ? 'island' : 'counter'}` : null;
  }
  if ('roomId' in at) {
    const r = project.rooms.find((x) => x.id === at.roomId);
    if (!r || (at.corner !== undefined && at.corner >= r.points.length)) return null;
    return `the ${r.name || 'room'} ${at.corner === undefined ? 'centre' : 'corner'}`;
  }
  const i = project.walls.findIndex((w) => w.id === at.wallId);
  return i >= 0 ? `W${i + 1}` : null;
}

/** Where an anchored point is now; null if what it's pinned to is gone. */
export function anchorPoint(project: Project, at: DimAnchor): Point | null {
  if ('openingId' in at) {
    const o = project.openings.find((x) => x.id === at.openingId);
    const w = o && project.walls.find((x) => x.id === o.wallId);
    if (!o || !w) return null;
    const [d, n] = [wallDir(w), wallNormal(w)];
    const c = pointAlong(w, o.offset);
    return { x: c.x + d.x * at.along + n.x * at.perp, y: c.y + d.y * at.along + n.y * at.perp };
  }
  if ('furnitureId' in at) {
    const f = project.furniture.find((x) => x.id === at.furnitureId);
    return f ? itemPoint(f, at.x, at.y) : null;
  }
  if ('counterId' in at) {
    const c = project.counters.find((x) => x.id === at.counterId);
    return c ? counterAt(c, counterBase(c, at.from) + at.along, at.inset) : null;
  }
  if ('roomId' in at) {
    const r = project.rooms.find((x) => x.id === at.roomId);
    if (!r || r.points.length < 3) return null;
    if (at.corner === undefined) return roomMiddle(r);
    const q = r.points[at.corner];
    return q ? { ...q } : null;
  }
  const w = project.walls.find((x) => x.id === at.wallId);
  if (!w) return null;
  const len = wallLength(w);
  if (len < 1e-9) return null;
  const [e, o] = at.end === 'a' ? [w.a, w.b] : [w.b, w.a];
  const n = wallNormal(w);
  return { x: e.x + ((o.x - e.x) / len) * at.along + n.x * at.perp, y: e.y + ((o.y - e.y) / len) * at.along + n.y * at.perp };
}

/** Placed and ordinate dimensions follow what they were snapped to; a point whose target is gone stays put and lets go. */
export function followDims(_prev: Project, next: Project): Project {
  const anyDims = next.dims?.some((d) => d.aAt || d.bAt);
  const anyOrd = next.ordDims?.some((o) => o.origin.at || o.pts.some((q) => q.at));
  if (!anyDims && !anyOrd) return next;
  const move = (p: Point, at: DimAnchor | undefined): [Point, DimAnchor | undefined] => {
    if (!at) return [p, at];
    const q = anchorPoint(next, at);
    return q ? [q, at] : [p, undefined];
  };
  let out = next;
  if (anyDims) {
    let changed = false;
    const dims = next.dims!.map((d) => {
      if (!d.aAt && !d.bAt) return d;
      const [a, aAt] = move(d.a, d.aAt);
      const [b, bAt] = move(d.b, d.bAt);
      if (a.x === d.a.x && a.y === d.a.y && b.x === d.b.x && b.y === d.b.y && aAt === d.aAt && bAt === d.bAt) return d;
      changed = true;
      return { ...d, a, b, aAt, bAt };
    });
    if (changed) out = { ...out, dims };
  }
  if (anyOrd) {
    let changed = false;
    const one = (o: OrdPoint): OrdPoint => {
      if (!o.at) return o;
      const [p, at] = move(o.p, o.at);
      if (p.x === o.p.x && p.y === o.p.y && at === o.at) return o;
      changed = true;
      return at ? { p, at } : { p };
    };
    const ordDims = next.ordDims!.map((d) => {
      const origin = one(d.origin);
      const pts = d.pts.map(one);
      return origin === d.origin && pts.every((q, i) => q === d.pts[i]) ? d : { ...d, origin, pts };
    });
    if (changed) out = { ...out, ordDims };
  }
  return out;
}

/**
 * Where an angle dimension sits: the point where the two walls' lines cross, the
 * direction of each wall away from it (toward its far end), and the angle
 * between them (0–180°). Null if the walls are gone or parallel.
 */
export function angleBetween(project: Project, aId: string, bId: string): { at: Point; u: Point; v: Point; deg: number } | null {
  const A = project.walls.find((w) => w.id === aId);
  const B = project.walls.find((w) => w.id === bId);
  if (!A || !B) return null;
  const [dA, dB] = [wallDir(A), wallDir(B)];
  const den = dA.x * dB.y - dA.y * dB.x;
  if (Math.abs(den) < 1e-6) return null;
  const t = ((B.a.x - A.a.x) * dB.y - (B.a.y - A.a.y) * dB.x) / den;
  const at = { x: A.a.x + dA.x * t, y: A.a.y + dA.y * t };
  const away = (w: Wall) => {
    const far = Math.hypot(w.a.x - at.x, w.a.y - at.y) > Math.hypot(w.b.x - at.x, w.b.y - at.y) ? w.a : w.b;
    const l = Math.hypot(far.x - at.x, far.y - at.y) || 1;
    return { x: (far.x - at.x) / l, y: (far.y - at.y) / l };
  };
  const [u, v] = [away(A), away(B)];
  const deg = (Math.acos(Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y))) * 180) / Math.PI;
  return { at, u, v, deg };
}

/** Walls that meet a wall at one of its ends (sharing the point, or a T onto it) and aren't parallel to it: candidates for an angle dimension. */
export function angleNeighbours(project: Project, wallId: string): Wall[] {
  const w = project.walls.find((x) => x.id === wallId);
  if (!w) return [];
  const d = wallDir(w);
  const touches = (p: Point, q: Wall) => {
    const { along, perp } = projectOnWall(q, p);
    return perp <= q.thickness / 2 + 0.5 && along >= -0.5 && along <= wallLength(q) + 0.5;
  };
  return project.walls.filter((q) => {
    if (q.id === w.id) return false;
    const e = wallDir(q);
    if (Math.abs(d.x * e.y - d.y * e.x) < 0.02) return false;
    return touches(w.a, q) || touches(w.b, q) || touches(q.a, w) || touches(q.b, w);
  });
}

/** The wall a click picks for an angle dimension: the nearest whose body (its thickness plus `slop`) the click is on. */
export function pickWall(project: Project, p: Point, slop: number): string | null {
  const walls = project.walls.filter((w) => nearestWall([w], p, w.thickness / 2 + slop));
  return nearestWall(walls, p, Infinity)?.wall.id ?? null;
}
