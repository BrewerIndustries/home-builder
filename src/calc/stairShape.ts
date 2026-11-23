import { dist, projectOnWall, wallDir, wallLength } from '../model/geometry.ts';
import type { Furniture, Point, Wall } from '../model/types.ts';

// Lighting v6: a stair as a walk line through segments — flights and landings —
// in the stair's own frame (the foot is the front, +y; walking up the first
// flight is −y, and its left side is −x). A straight stair is one flight (or two
// with a landing between, in line); an L turns 90° on a square landing the
// flight's width each way; a U turns back on a landing across the whole width,
// the second flight beside the first. Turning right (default) the second flight
// is on the walker's right; a left turn is the mirror image.

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface StairSeg {
  kind: 'flight' | 'landing';
  rect: Rect;
  /** Walk line in and out of the segment, and its length along the walk line. */
  from: Point;
  to: Point;
  len: number;
  /** Flights: direction of travel walking up (unit, local), and risers in it. */
  dir: Point;
  risers: number;
}

/** Default riser count and flight width. */
const RISERS = 13;
export const FLIGHT_WIDTH = 36;

export const isTurning = (f: Furniture) => f.shape === 'L' || f.shape === 'U';
const risers = (f: Furniture) => f.risers ?? RISERS;

/** Width of each flight: the stair's width when straight, else as set (36"), never more than fits. */
export function flightWidth(f: Furniture): number {
  if (!isTurning(f)) return f.w;
  const b = f.flight ?? FLIGHT_WIDTH;
  return Math.max(6, Math.min(b, f.shape === 'U' ? f.w / 2 : f.w - 6, f.d - 6));
}

/** A straight stair's landings, as riser counts from the foot (sorted, each between the first and last riser). */
export function straightLandings(f: Furniture): number[] {
  const R = risers(f);
  const raw = f.landings ?? (f.landing ? [f.landing] : []);
  return [...new Set(raw.map((n) => Math.round(n)).filter((n) => n > 0 && n < R))].sort((a, b) => a - b);
}

/** Depth of a straight stair's landings: as wide as the stair, 36" at least. */
export const straightLandingDepth = (f: Furniture) => Math.max(36, f.w);

/** A straight stair's steps along the run, foot first: treads, and each landing as one deep step. */
export function straightSteps(f: Furniture): { depths: number[]; landings: number[]; ld: number; tread: number } {
  const R = risers(f);
  const landings = straightLandings(f);
  const ld = landings.length ? straightLandingDepth(f) : 0;
  const treads = Math.max(1, R - 1 - landings.length);
  const tread = Math.max(0, f.d - ld * landings.length) / treads;
  const depths = Array.from({ length: Math.max(0, R - 1) }, (_, i) => (landings.includes(i + 1) ? ld : tread));
  return { depths, landings, ld, tread };
}

/** Risers in the first flight of a turning stair: the landing's riser count, else half. */
export function turnLanding(f: Furniture): number {
  const R = risers(f);
  return Math.max(1, Math.min(R - 1, Math.round(f.landing ?? R / 2)));
}

/** A U stair's landing depth in the direction of travel (the flight width when unset); an L's landing is square. */
export function turnLandingDepth(f: Furniture): number {
  const b = flightWidth(f);
  if (f.shape !== 'U') return b;
  return Math.max(6, Math.min(f.landingDepth ?? b, f.d - 6));
}

const flight = (rect: Rect, from: Point, dir: Point, len: number, n: number): StairSeg => ({ kind: 'flight', rect, from, to: { x: from.x + dir.x * len, y: from.y + dir.y * len }, len, dir, risers: n });

/** The walk line's segments, foot first, in the stair's frame. */
export function stairSegments(f: Furniture): StairSeg[] {
  const R = risers(f);
  const [l, t, r, b] = [-f.w / 2, -f.d / 2, f.w / 2, f.d / 2];
  if (!isTurning(f)) {
    const { depths, landings } = straightSteps(f);
    if (!landings.length) return [flight({ x0: l, y0: t, x1: r, y1: b }, { x: 0, y: b }, { x: 0, y: -1 }, f.d, R)];
    // Flights and landings in turn, up from the foot (+y) towards the top (-y).
    const segs: StairSeg[] = [];
    let y = b;
    let from = 0;
    for (const L of [...landings, R]) {
      const run = depths.slice(from, L - 1).reduce((s, d) => s + d, 0);
      const y1 = L === R ? t : y - run;
      segs.push(flight({ x0: l, y0: y1, x1: r, y1: y }, { x: 0, y }, { x: 0, y: -1 }, y - y1, L - from));
      y = y1;
      if (L === R) break;
      const ld = depths[L - 1];
      segs.push({ kind: 'landing', rect: { x0: l, y0: y - ld, x1: r, y1: y }, from: { x: 0, y }, to: { x: 0, y: y - ld }, len: ld, dir: { x: 0, y: -1 }, risers: 0 });
      y -= ld;
      from = L;
    }
    return segs;
  }
  const w = flightWidth(f);
  const n1 = turnLanding(f);
  const n2 = R - n1;
  const segs: StairSeg[] =
    f.shape === 'L'
      ? [
          flight({ x0: l, y0: t + w, x1: l + w, y1: b }, { x: l + w / 2, y: b }, { x: 0, y: -1 }, f.d - w, n1),
          { kind: 'landing', rect: { x0: l, y0: t, x1: l + w, y1: t + w }, from: { x: l + w / 2, y: t + w }, to: { x: l + w, y: t + w / 2 }, len: w, dir: { x: 1, y: 0 }, risers: 0 },
          flight({ x0: l + w, y0: t, x1: r, y1: t + w }, { x: l + w, y: t + w / 2 }, { x: 1, y: 0 }, f.w - w, n2),
        ]
      : (() => {
          const ld = turnLandingDepth(f);
          return [
            flight({ x0: l, y0: t + ld, x1: l + w, y1: b }, { x: l + w / 2, y: b }, { x: 0, y: -1 }, f.d - ld, n1),
            { kind: 'landing', rect: { x0: l, y0: t, x1: r, y1: t + ld }, from: { x: l + w / 2, y: t + ld }, to: { x: r - w / 2, y: t + ld }, len: ld + f.w - w, dir: { x: 0, y: 1 }, risers: 0 },
            flight({ x0: r - w, y0: t + ld, x1: r, y1: b }, { x: r - w / 2, y: t + ld }, { x: 0, y: 1 }, f.d - ld, n2),
          ] as StairSeg[];
        })();
  if (f.turn !== 'left') return segs;
  // Turning left: the mirror image across the stair's centre line.
  const m = (p: Point): Point => ({ x: -p.x, y: p.y });
  return segs.map((s) => ({ ...s, rect: { x0: -s.rect.x1, y0: s.rect.y0, x1: -s.rect.x0, y1: s.rect.y1 }, from: m(s.from), to: m(s.to), dir: m(s.dir) }));
}

export const flightsOf = (f: Furniture) => stairSegments(f).filter((s) => s.kind === 'flight');
export const landingOf = (f: Furniture) => stairSegments(f).find((s) => s.kind === 'landing');

/** Walk-line length from the foot to the top. */
export const pathLength = (f: Furniture) => stairSegments(f).reduce((t, s) => t + s.len, 0);

/** The part of a segment between walk-line distances a and b from its start: flights cut across, landings whole. */
function cut(s: StairSeg, a: number, b: number): Rect {
  if (s.kind === 'landing') return s.rect;
  const p = { x: s.from.x + s.dir.x * a, y: s.from.y + s.dir.y * a };
  const q = { x: s.from.x + s.dir.x * b, y: s.from.y + s.dir.y * b };
  return s.dir.x === 0 ? { ...s.rect, y0: Math.min(p.y, q.y), y1: Math.max(p.y, q.y) } : { ...s.rect, x0: Math.min(p.x, q.x), x1: Math.max(p.x, q.x) };
}

/** Rectangles (stair frame) covering the walk line from distance a to b. */
export function pathRects(f: Furniture, a: number, b: number): Rect[] {
  const out: Rect[] = [];
  let at = 0;
  for (const s of stairSegments(f)) {
    const [lo, hi] = [Math.max(a, at), Math.min(b, at + s.len)];
    if (hi - lo > 0.01) out.push(cut(s, lo - at, hi - at));
    at += s.len;
  }
  return out;
}

/** Plan point of a stair-frame point. */
export function toPlan(f: Furniture, p: Point): Point {
  const r = (f.rot * Math.PI) / 180;
  return { x: f.at.x + p.x * Math.cos(r) - p.y * Math.sin(r), y: f.at.y + p.x * Math.sin(r) + p.y * Math.cos(r) };
}

export const rectPolygon = (f: Furniture, r: Rect): Point[] => [toPlan(f, { x: r.x0, y: r.y0 }), toPlan(f, { x: r.x1, y: r.y0 }), toPlan(f, { x: r.x1, y: r.y1 }), toPlan(f, { x: r.x0, y: r.y1 })];

/** The two sides of a flight, walking up it (left then right), as stair-frame segments. */
export function flightSides(s: StairSeg): { left: [Point, Point]; right: [Point, Point] } {
  // Left of the direction of travel: (dir.y, −dir.x) — walking −y, that's −x.
  const n = { x: s.dir.y, y: -s.dir.x };
  const half = s.dir.x === 0 ? (s.rect.x1 - s.rect.x0) / 2 : (s.rect.y1 - s.rect.y0) / 2;
  const at = (p: Point, k: number): Point => ({ x: p.x + n.x * half * k, y: p.y + n.y * half * k });
  return { left: [at(s.from, 1), at(s.to, 1)], right: [at(s.from, -1), at(s.to, -1)] };
}

/** Is there a wall along the plan segment p → q (parallel, its face within 2", over most of it)? */
export function walledEdge(walls: Wall[], p: Point, q: Point, share = 0.75): boolean {
  const len = dist(p, q) || 1;
  const u = { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
  return walls.some((w) => {
    const d = wallDir(w);
    if (Math.abs(u.x * d.y - u.y * d.x) > 0.02) return false;
    const [a, b] = [projectOnWall(w, p), projectOnWall(w, q)];
    if (Math.abs(a.perp) - w.thickness / 2 > 2 || Math.abs(b.perp) - w.thickness / 2 > 2) return false;
    const [lo, hi] = [Math.max(0, Math.min(a.along, b.along)), Math.min(wallLength(w), Math.max(a.along, b.along))];
    return hi - lo >= len * share;
  });
}

const inRect = (r: Rect, p: Point, slop = 0) => p.x > r.x0 - slop && p.x < r.x1 + slop && p.y > r.y0 - slop && p.y < r.y1 + slop;

/**
 * Open edge length round a set of stair-frame rectangles: their outline less
 * the stretches shared between them, along a wall, or on the `skip` segments
 * (where the stair runs on or off). Measured in 2" steps.
 */
export function openEdge(f: Furniture, rects: Rect[], walls: Wall[], skip: [Point, Point][] = [], also: Rect[] = []): number {
  const STEP = 2;
  let total = 0;
  const near = (p: Point, [a, b]: [Point, Point]) => {
    const len = dist(a, b) || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len)));
    return dist(p, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }) < 0.75;
  };
  for (const r of rects) {
    const c = [
      { x: r.x0, y: r.y0 },
      { x: r.x1, y: r.y0 },
      { x: r.x1, y: r.y1 },
      { x: r.x0, y: r.y1 },
    ];
    for (let k = 0; k < 4; k++) {
      const [a, b] = [c[k], c[(k + 1) % 4]];
      const len = dist(a, b);
      if (len < 0.01) continue;
      const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      // Outward: the edges run clockwise on screen (y down), so outward is (u.y, −u.x).
      const out = { x: u.y, y: -u.x };
      const n = Math.max(1, Math.round(len / STEP));
      const piece = len / n;
      for (let i = 0; i < n; i++) {
        const m = { x: a.x + u.x * piece * (i + 0.5), y: a.y + u.y * piece * (i + 0.5) };
        const o = { x: m.x + out.x, y: m.y + out.y };
        if ([...rects, ...also].some((q) => q !== r && inRect(q, o))) continue;
        if (skip.some((s) => near(m, s))) continue;
        const [p, q] = [toPlan(f, { x: m.x - u.x * piece / 2, y: m.y - u.y * piece / 2 }), toPlan(f, { x: m.x + u.x * piece / 2, y: m.y + u.y * piece / 2 })];
        if (walledEdge(walls, p, q, 0.5)) continue;
        total += piece;
      }
    }
  }
  return total;
}

/** The edge across the walk line at a segment's end (stair frame), full flight width. */
export function endEdge(s: StairSeg, at: 'from' | 'to'): [Point, Point] {
  const p = s[at];
  const n = { x: s.dir.y, y: -s.dir.x };
  const half = s.dir.x === 0 ? (s.rect.x1 - s.rect.x0) / 2 : (s.rect.y1 - s.rect.y0) / 2;
  return [
    { x: p.x + n.x * half, y: p.y + n.y * half },
    { x: p.x - n.x * half, y: p.y - n.y * half },
  ];
}
