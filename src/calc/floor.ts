import { pointInPolygon, polygonArea } from '../model/geometry.ts';
import { activeStoreyId, adjacentStorey, isLowestStorey, isMultiStorey, storeyView } from '../model/storeys.ts';
import type { FloorEdge, FloorInsulation, Foundation, JoistSize, Point, Project, Wall } from '../model/types.ts';
import { foundationOf } from './foundation.ts';
import { floorOpenings, openVoids } from './floorOpenings.ts';
import type { MaterialLine } from './materials.ts';
import { childRooms } from './regions.ts';
import { pierPadLines } from './foundationV2.ts';
import { stockFeet } from './roof.ts';

// Framed floors. v1: the floor over a crawlspace / basement — joist layout
// broken over girder lines, piers under the girders, rim board, and a
// staggered 4×8 subfloor layout. v2: joist hangers (flush girders, floor
// openings), cantilevers past the support, stair openings framed with doubled
// headers and trimmers, I-joists, floor insulation, and the framed floor under
// each storey above the lowest, joists bearing on the walls below.
// Members are laid out and counted, not sized — joist and girder spans need
// IRC R502.3 / R602.7 tables (or the I-joist maker's). Inches throughout.

const AUTO_MAX_SPAN = 144; // layout default only, not a span check
const SHEET_LONG = 96;
const SHEET_SHORT = 48;
/** A joist this close to an opening side is replaced by the trimmer. */
const TRIM = 1.5;
/** A wall below within this of a joist end carries it. */
const BEAR = 6;

export interface Seg {
  a: Point;
  b: Point;
}

export interface FloorLayout {
  /** Joists run along plan x? */
  alongX: boolean;
  /** The floor's edge (out to the cantilevers, if any). */
  outline: Point[][];
  /** Joists, including tail joists cut short at a floor opening. */
  joists: Seg[];
  girders: Seg[];
  piers: Point[];
  /** Subfloor sheets (whole or cut), plan rectangles. */
  sheets: { x: number; y: number; w: number; h: number; cut: boolean }[];
  rimLength: number;
  /** Longest joist span between supports (a cantilever's back-span, not its overhang). */
  maxSpan: number;
  // Floor v2 — empty when unused.
  /** The outline at the supports (= outline unless cantilevered). */
  supported: Point[][];
  /** Doubled trimmer joists and headers round floor openings (each Seg is two plies). */
  trimmers: Seg[];
  headers: Seg[];
  /** Rough openings framed in the floor, plan rectangles. */
  openings: Point[][];
  /** Joist hangers; `double` = a doubled member (header into trimmer). */
  hangers: { at: Point; double: boolean }[];
  /** Walls on the storey below that carry the joists between their ends. */
  bearing: Seg[];
  cantilevers: { edge: FloorEdge; depth: number; backSpan: number }[];
  /** Joist ends with no wall below them (storeys above the lowest). */
  unsupportedEnds: number;
  /** Floor area less openings, sq in. */
  area: number;
  notes: string[];
}

/** Everything the layout and takeoff need, resolved from the foundation and the storey. */
export interface FloorSpec {
  joistSize: JoistSize;
  joistSpacing: number;
  joistDir: 'auto' | 'x' | 'y';
  girders: 'auto' | number;
  pierSpacing: number;
  subfloor: Foundation['subfloor'];
  /** I-joists instead of sawn lumber: series and depth as the maker lists them. */
  ijoist: { series: string; depth: number } | null;
  flushGirders: boolean;
  cantilever: Partial<Record<FloorEdge, number>>;
  insulation: FloorInsulation;
  /** A floor under a storey above the lowest (bears on the walls below). */
  upper: boolean;
  /** The foundation it came from (pier pads). */
  foundation: Foundation;
}

export const DEFAULT_IJOIST_DEPTH = 11.875;
export const EDGE_NAME: Record<FloorEdge, string> = { n: 'top', e: 'right', s: 'bottom', w: 'left' };

/** The framed-floor settings for the plan's active storey. */
export function floorSpec(p: Project): FloorSpec {
  const f = foundationOf(p);
  const fl = f.floor ?? {};
  const upper = !isLowestStorey(p);
  const own = upper ? (p.storeys?.find((s) => s.id === activeStoreyId(p))?.floor ?? {}) : fl;
  return {
    joistSize: f.joistSize,
    joistSpacing: f.joistSpacing,
    joistDir: upper ? (own.joistDir ?? 'auto') : f.joistDir,
    girders: upper ? 0 : f.girders,
    pierSpacing: f.pierSpacing,
    subfloor: f.subfloor,
    ijoist: fl.joistType === 'ijoist' ? { series: fl.iJoistSeries?.trim() || 'I-joist', depth: fl.iJoistDepth || DEFAULT_IJOIST_DEPTH } : null,
    flushGirders: !upper && !!fl.flushGirders,
    cantilever: own.cantilever ?? {},
    insulation: own.insulation ?? 'none',
    upper,
    foundation: f,
  };
}

/** Footprint polygons at the wall centrelines: outermost rooms, else the exterior walls' box. */
export function floorOutline(project: Project): Point[][] {
  const outer = project.rooms.filter((r) => !project.rooms.some((o) => o !== r && childRooms(project, o).includes(r)));
  if (outer.length) return outer.map((r) => r.points);
  const ext = project.walls.filter((w) => w.kind === 'exterior');
  if (!ext.length) return [];
  const xs = ext.flatMap((w) => [w.a.x, w.b.x]);
  const ys = ext.flatMap((w) => [w.a.y, w.b.y]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return [[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]];
}

/**
 * Intervals of the line {u = c} inside the polygons, as [vStart, vEnd] pairs.
 * Coordinates are (u, v): u across the joists, v along them.
 */
export function scan(polys: { u: number; v: number }[][], c: number): [number, number][] {
  const out: [number, number][] = [];
  for (const pts of polys) {
    const hits: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      if ((p.u <= c && q.u > c) || (q.u <= c && p.u > c)) hits.push(p.v + ((c - p.u) / (q.u - p.u)) * (q.v - p.v));
    }
    hits.sort((a, b) => a - b);
    for (let i = 0; i + 1 < hits.length; i += 2) if (hits[i + 1] - hits[i] > 0.5) out.push([hits[i], hits[i + 1]]);
  }
  return out;
}

/**
 * The outline with its square edges facing a cantilevered side pushed out by
 * that side's distance. Edges shared with another polygon (inside the house)
 * stay put; sloped edges stay put.
 */
export function cantileverOutline(polys: Point[][], cant: Partial<Record<FloorEdge, number>>): Point[][] {
  const inside = (p: Point) => polys.some((pts) => pointInPolygon(p, pts));
  return polys.map((pts) => {
    const shift = pts.map(() => ({ x: 0, y: 0 }));
    pts.forEach((p, i) => {
      const j = (i + 1) % pts.length;
      const q = pts[j];
      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      const horiz = Math.abs(q.y - p.y) < 0.01 && Math.abs(q.x - p.x) > 0.01;
      const vert = Math.abs(q.x - p.x) < 0.01 && Math.abs(q.y - p.y) > 0.01;
      if (!horiz && !vert) return;
      const sides: [FloorEdge, Point][] = horiz ? [['n', { x: 0, y: -1 }], ['s', { x: 0, y: 1 }]] : [['w', { x: -1, y: 0 }], ['e', { x: 1, y: 0 }]];
      for (const [edge, d] of sides) {
        const amt = cant[edge] ?? 0;
        if (amt <= 0 || inside({ x: mid.x + d.x, y: mid.y + d.y })) continue;
        for (const k of [i, j]) {
          if (horiz) shift[k].y = d.y * amt;
          else shift[k].x = d.x * amt;
        }
      }
    });
    return pts.map((p, i) => ({ x: p.x + shift[i].x, y: p.y + shift[i].y }));
  });
}

/** The floor over the foundation (the lowest storey's, or a one-storey plan's): crawlspace or basement only. */
export function floorLayout(project: Project): FloorLayout | null {
  const f = foundationOf(project);
  if ((f.type !== 'crawl' && f.type !== 'basement') || !isLowestStorey(project)) return null;
  const polys = floorOutline(project);
  if (!polys.length) return null;
  // Stair openings only once there are real storeys (a one-storey plan is laid out as in v1).
  const holes = isMultiStorey(project) ? floorOpenings(project).map((o) => o.polys) : [];
  return frameFloor(polys, floorSpec(project), holes, null);
}

/** The framed floor under a storey above the lowest, joists bearing on the walls of the storey below. */
export function upperFloorLayout(view: Project): FloorLayout | null {
  if (isLowestStorey(view)) return null;
  const polys = floorOutline(view);
  if (!polys.length) return null;
  const below = adjacentStorey(view, -1)!;
  const walls = storeyView(view, below.id).walls;
  return frameFloor(polys, floorSpec(view), [...floorOpenings(view).map((o) => o.polys), ...openVoids(view).map((v) => [v])], walls);
}

/** The framed floor of the plan's active storey, whichever kind it is. */
export function storeyFloorLayout(view: Project): FloorLayout | null {
  return isLowestStorey(view) ? floorLayout(view) : upperFloorLayout(view);
}

interface Hole {
  ua: number;
  ub: number;
  va: number;
  vb: number;
  /** Header at the low / high v side (false where the opening edge sits on a support). */
  headLo: boolean;
  headHi: boolean;
}

/**
 * Lay out a framed floor on `polys` (the outline at its supports). `holes` are
 * stair openings (each framed as one rectangle round its polygons);
 * `wallsBelow` (storeys above the lowest) are the walls the joists can bear on.
 */
export function frameFloor(polys: Point[][], s: FloorSpec, holePolys: Point[][][], wallsBelow: Wall[] | null): FloorLayout {
  const all = polys.flat();
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // Joists span the short way unless told otherwise.
  const alongX = s.joistDir === 'x' || (s.joistDir === 'auto' && x1 - x0 < y1 - y0);
  const toUV = (p: Point) => (alongX ? { u: p.y, v: p.x } : { u: p.x, v: p.y });
  const toXY = (u: number, v: number): Point => (alongX ? { x: v, y: u } : { x: u, y: v });
  const [u0, u1] = alongX ? [y0, y1] : [x0, x1];
  const [v0, v1] = alongX ? [x0, x1] : [y0, y1];
  const eps = 1e-6;
  const notes: string[] = [];

  // Cantilevers: only where the joists run out through the edge.
  const lo: FloorEdge = alongX ? 'w' : 'n';
  const hi: FloorEdge = alongX ? 'e' : 's';
  const cant: Partial<Record<FloorEdge, number>> = {};
  for (const [e, d] of Object.entries(s.cantilever) as [FloorEdge, number][]) {
    if (!(d > 0)) continue;
    if (e === lo || e === hi) cant[e] = d;
    else notes.push(`No cantilever on the ${EDGE_NAME[e]} edge: the joists run along it (that takes outriggers off a doubled joist — not laid out here).`);
  }
  const outline = Object.keys(cant).length ? cantileverOutline(polys, cant) : polys;
  const uv = outline.map((pts) => pts.map(toUV));
  const uvSup = outline === polys ? uv : polys.map((pts) => pts.map(toUV));
  const supported = (u: number, a: number, b: number): [number, number] => {
    if (outline === polys) return [a, b];
    let best: [number, number] = [a, b];
    let over = 0;
    for (const [p, q] of scan(uvSup, u + eps)) {
      const o = Math.min(q, b) - Math.max(p, a);
      if (o > over) [over, best] = [o, [p, q]];
    }
    return best;
  };

  const n = s.girders === 'auto' ? Math.max(0, Math.ceil((v1 - v0) / AUTO_MAX_SPAN) - 1) : Math.max(0, Math.round(s.girders));
  const girderV = Array.from({ length: n }, (_, i) => v0 + ((v1 - v0) * (i + 1)) / (n + 1));

  // Girders: lines across the joists, clipped to the footprint; piers along them.
  const girders: Seg[] = [];
  const piers: Point[] = [];
  const vu = polys.map((pts) => pts.map((p) => { const q = toUV(p); return { u: q.v, v: q.u }; }));
  for (const g of girderV) {
    for (const [a, b] of scan(vu, g + eps)) {
      girders.push({ a: toXY(a, g), b: toXY(b, g) });
      const k = Math.max(1, Math.ceil((b - a) / s.pierSpacing));
      for (let i = 1; i < k; i++) piers.push(toXY(a + ((b - a) * i) / k, g));
    }
  }

  // Walls below that run across the joists can carry them.
  const supports = (wallsBelow ?? []).flatMap((w) => {
    const [a, b] = [toUV(w.a), toUV(w.b)];
    if (Math.abs(a.v - b.v) > 2 || Math.abs(a.u - b.u) < 24) return [];
    return [{ v: (a.v + b.v) / 2, a: Math.min(a.u, b.u), b: Math.max(a.u, b.u), w }];
  });
  const carried = (u: number, v: number, tol: number) => supports.filter((x) => u >= x.a - 0.5 && u <= x.b + 0.5 && Math.abs(x.v - v) <= tol);
  const usedWalls = new Set<Wall>();

  /** Where a joist line at u breaks between its supported ends: girders, or walls below keeping spans to the layout default. */
  const breaks = (u: number, a: number, b: number, a0: number, b0: number): number[] => {
    const out = girderV.filter((g) => g > a + 1 && g < b - 1);
    if (!supports.length) return out;
    const cands = supports.filter((x) => u >= x.a - 0.5 && u <= x.b + 0.5 && x.v > a0 + 1 && x.v < b0 - 1).sort((p, q) => p.v - q.v);
    let cur = a0;
    while (b0 - cur > AUTO_MAX_SPAN) {
      const ahead = cands.filter((x) => x.v > cur + 1);
      if (!ahead.length) break;
      const inReach = ahead.filter((x) => x.v <= cur + AUTO_MAX_SPAN);
      const pick = inReach.length ? inReach[inReach.length - 1] : ahead[0];
      out.push(pick.v);
      usedWalls.add(pick.w);
      cur = pick.v;
    }
    return out.sort((p, q) => p - q);
  };
  /** The support an opening edge at v sits on (within a few inches), if any: the edge snaps to it and needs no header. */
  const supportAt = (v: number, a0: number, b0: number, brk: number[]): number | null => (v <= a0 + BEAR ? a0 : v >= b0 - BEAR ? b0 : (brk.find((g) => Math.abs(g - v) <= BEAR) ?? null));

  // Openings: one rough-opening rectangle round each stair's polygons; headers where the edge isn't on a support.
  const holes: Hole[] = [];
  const openings: Point[][] = [];
  const headers: Seg[] = [];
  const hangers: FloorLayout['hangers'] = [];
  for (const ps of holePolys) {
    const q = ps.flat().map(toUV);
    if (!q.length) continue;
    const h: Hole = { ua: Math.min(...q.map((p) => p.u)), ub: Math.max(...q.map((p) => p.u)), va: Math.min(...q.map((p) => p.v)), vb: Math.max(...q.map((p) => p.v)), headLo: false, headHi: false };
    if (h.ub - h.ua < 1 || h.vb - h.va < 1) continue;
    const mid = (h.ua + h.ub) / 2;
    const span = scan(uv, mid + eps).find(([a, b]) => h.va < b && h.vb > a);
    if (!span) continue;
    const [a, b] = span;
    const [a0, b0] = supported(mid, a, b);
    const brk = breaks(mid, a, b, a0, b0);
    // An edge sits on a support only if it does all the way across: a wall below that stops short needs a header.
    const across = (v: number) => {
      const at = supportAt(v, a0, b0, brk);
      if (at === null) return null;
      for (const u of [h.ua + 1, h.ub - 1]) {
        const sp = scan(uv, u).find(([x, y]) => v >= x - BEAR && v <= y + BEAR);
        if (!sp) return null;
        const [c0, c1] = supported(u, sp[0], sp[1]);
        if (supportAt(at, c0, c1, breaks(u, sp[0], sp[1], c0, c1)) === null) return null;
      }
      return at;
    };
    const sLo = across(h.va);
    const sHi = across(h.vb);
    h.va = Math.max(sLo ?? h.va, a);
    h.vb = Math.min(sHi ?? h.vb, b);
    h.headLo = sLo === null;
    h.headHi = sHi === null;
    for (const [on, v] of [[h.headLo, h.va], [h.headHi, h.vb]] as [boolean, number][]) {
      if (!on) continue;
      headers.push({ a: toXY(h.ua, v), b: toXY(h.ub, v) });
      hangers.push({ at: toXY(h.ua, v), double: true }, { at: toXY(h.ub, v), double: true });
    }
    holes.push(h);
    openings.push([toXY(h.ua, h.va), toXY(h.ub, h.va), toXY(h.ub, h.vb), toXY(h.ua, h.vb)]);
  }

  const joists: Seg[] = [];
  const trimmers: Seg[] = [];
  const cantilevers = new Map<FloorEdge, { depth: number; backSpan: number }>();
  let maxSpan = 0;
  let unsupportedEnds = 0;
  /** Lay pieces along one member line from a to b, broken over the supports. */
  const run = (u: number, p: number, q: number, brk: number[], a0: number, b0: number, out: Seg[]) => {
    const stops = [p, ...brk.filter((g) => g > p + 1 && g < q - 1), q];
    for (let i = 0; i + 1 < stops.length; i++) {
      const [s0, e0] = [stops[i], stops[i + 1]];
      out.push({ a: toXY(u, s0), b: toXY(u, e0) });
      let [from, to] = [s0, e0];
      if (s0 < a0 - 0.5) {
        from = a0;
        const c = cantilevers.get(lo);
        cantilevers.set(lo, { depth: Math.max(c?.depth ?? 0, a0 - s0), backSpan: Math.min(c?.backSpan ?? Infinity, Math.min(e0, b0) - a0) });
      }
      if (e0 > b0 + 0.5) {
        to = b0;
        const c = cantilevers.get(hi);
        cantilevers.set(hi, { depth: Math.max(c?.depth ?? 0, e0 - b0), backSpan: Math.min(c?.backSpan ?? Infinity, b0 - Math.max(s0, a0)) });
      }
      if (out === joists) maxSpan = Math.max(maxSpan, to - from);
    }
    if (s.flushGirders) for (const g of girderV) if (g > p + 1 && g < q - 1) hangers.push({ at: toXY(u, g), double: out === trimmers }, { at: toXY(u, g), double: out === trimmers });
  };

  // Joists at spacing across u, broken over each support.
  for (let u = u0 + s.joistSpacing; u < u1 - 1; u += s.joistSpacing) {
    for (const [a, b] of scan(uv, u + eps)) {
      const here = holes.filter((h) => h.va < b && h.vb > a);
      // A joist right at an opening's side is the trimmer.
      if (here.some((h) => Math.abs(u - h.ua) < TRIM || Math.abs(u - h.ub) < TRIM)) continue;
      const [a0, b0] = supported(u, a, b);
      const brk = breaks(u, a, b, a0, b0);
      let pieces: [number, number][] = [[a, b]];
      for (const h of here) {
        if (u <= h.ua || u >= h.ub) continue;
        pieces = pieces.flatMap(([p, q]): [number, number][] => [[p, Math.min(q, h.va)], [Math.max(p, h.vb), q]].filter(([x, y]) => y - x > 1) as [number, number][]);
        // Tail joists hang off the headers.
        if (h.headLo) hangers.push({ at: toXY(u, h.va), double: false });
        if (h.headHi) hangers.push({ at: toXY(u, h.vb), double: false });
      }
      for (const [p, q] of pieces) run(u, p, q, brk, a0, b0, joists);
      if (wallsBelow) {
        // Ends the walls below don't carry (a cantilever's end is carried at its support).
        for (const end of [a0, b0]) if (!here.some((h) => u > h.ua && u < h.ub && end >= h.va - 0.5 && end <= h.vb + 0.5) && !carried(u, end, BEAR).length) unsupportedEnds++;
      }
    }
  }

  // Doubled trimmers along the opening sides, full length between supports.
  for (const h of holes) {
    for (const tu of [h.ua, h.ub]) {
      for (const [a, b] of scan(uv, tu + eps)) {
        if (!(h.va < b && h.vb > a)) continue;
        const [a0, b0] = supported(tu, a, b);
        run(tu, a, b, breaks(tu, a, b, a0, b0), a0, b0, trimmers);
      }
    }
  }

  // Subfloor: 8 ft side across the joists, rows staggered half a sheet.
  const ox = outline.flat();
  const [vo0, vo1] = alongX ? [Math.min(...ox.map((p) => p.x)), Math.max(...ox.map((p) => p.x))] : [Math.min(...ox.map((p) => p.y)), Math.max(...ox.map((p) => p.y))];
  const vuOut = outline === polys ? vu : outline.map((pts) => pts.map((p) => { const q = toUV(p); return { u: q.v, v: q.u }; }));
  const sheets: FloorLayout['sheets'] = [];
  let row = 0;
  for (let v = vo0; v < vo1 - 0.5; v += SHEET_SHORT, row++) {
    const h = Math.min(SHEET_SHORT, vo1 - v);
    for (const [a, b] of scan(vuOut, v + h / 2)) {
      let u = a - (row % 2 ? SHEET_LONG / 2 : 0);
      for (; u < b - 0.5; u += SHEET_LONG) {
        const st = Math.max(u, a);
        const e = Math.min(u + SHEET_LONG, b);
        let cut = e - st < SHEET_LONG - 0.5 || h < SHEET_SHORT - 0.5;
        if (holes.length) {
          // In (u, v) a sheet spans u ∈ [st, e], v ∈ [v, v + h].
          const over = holes.filter((x) => x.ua < e - 0.5 && x.ub > st + 0.5 && x.va < v + h - 0.5 && x.vb > v + 0.5);
          if (over.some((x) => x.ua <= st && x.ub >= e && x.va <= v && x.vb >= v + h)) continue;
          if (over.length) cut = true;
        }
        const p = toXY(st, v);
        sheets.push(alongX ? { x: p.x, y: p.y, w: h, h: e - st, cut } : { x: p.x, y: p.y, w: e - st, h, cut });
      }
    }
  }

  const rimLength = outline.reduce((t, pts) => t + pts.reduce((r, p, i) => r + Math.hypot(pts[(i + 1) % pts.length].x - p.x, pts[(i + 1) % pts.length].y - p.y), 0), 0);
  const area = outline.reduce((t, p) => t + polygonArea(p), 0) - holes.reduce((t, h) => t + (h.ub - h.ua) * (h.vb - h.va), 0);
  const bearing = [...usedWalls].map((w) => ({ a: w.a, b: w.b }));
  const cants = [...cantilevers].map(([edge, c]) => ({ edge, ...c }));
  for (const c of cants) {
    // Rule of thumb only (not a code figure): keep the back-span at least about twice the overhang.
    if (c.backSpan < 2 * c.depth) notes.push(`${EDGE_NAME[c.edge]} cantilever ${Math.round(c.depth)}" has a back-span of only ${Math.round(c.backSpan)}" — a common rule of thumb (not a code figure) is a back-span of at least twice the overhang; check IRC R502.3.3 / the maker's tables.`);
  }
  if (unsupportedEnds) notes.push(`${unsupportedEnds} joist end${unsupportedEnds > 1 ? 's' : ''} land${unsupportedEnds > 1 ? '' : 's'} where no wall below carries ${unsupportedEnds > 1 ? 'them' : 'it'} — add a beam or a bearing wall, or set a cantilever.`);
  return { alongX, outline, joists, girders, piers, sheets, rimLength, maxSpan, supported: polys, trimmers, headers, openings, hangers, bearing, cantilevers: cants, unsupportedEnds, area, notes };
}

const segLen = (s: Seg) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);

/** 11.875 → 11-7/8" */
export function depthLabel(d: number): string {
  const whole = Math.floor(d + 1e-9);
  let num = Math.round((d - whole) * 16);
  if (!num) return `${whole}"`;
  let den = 16;
  while (num % 2 === 0) [num, den] = [num / 2, den / 2];
  return `${whole}-${num}/${den}"`;
}

/** Material lines for the floor over the foundation (one-storey plans and the lowest storey). */
export function floorLines(project: Project, waste: number): MaterialLine[] {
  const L = floorLayout(project);
  return L ? layoutLines(L, floorSpec(project), waste) : [];
}

/** Material lines for the framed floor under a storey above the lowest. */
export function upperFloorLines(view: Project, waste: number): MaterialLine[] {
  const L = upperFloorLayout(view);
  return L ? layoutLines(L, floorSpec(view), waste) : [];
}

export function layoutLines(L: FloorLayout, s: FloorSpec, waste: number): MaterialLine[] {
  const lines: MaterialLine[] = [];
  const add = (item: string, qty: number, unit: string, basis: string, category: MaterialLine['category'] = 'Floor') => qty > 0 && lines.push({ category, item, qty, unit, basis });
  const size = s.joistSize;
  const lap = s.upper ? 'lapped over the walls below' : s.flushGirders && L.girders.length ? 'hung between the girders' : 'lapped over girders';
  const plies = L.trimmers.length * 2 + L.headers.length * 2;
  const extra = plies ? ` + ${plies} trimmer / header plies round floor openings` : '';

  if (!s.ijoist) {
    const byStock = new Map<number, [number, number]>();
    const put = (ft: number, k: 0 | 1) => {
      const c = byStock.get(ft) ?? [0, 0];
      c[k] += 1;
      byStock.set(ft, c);
    };
    for (const j of L.joists) put(stockFeet(segLen(j) + 3), 0); // a little past the support for bearing / lap
    for (const t of L.trimmers) for (let k = 0; k < 2; k++) put(stockFeet(segLen(t) + 3), 1);
    for (const h of L.headers) for (let k = 0; k < 2; k++) put(stockFeet(segLen(h)), 1);
    for (const [ft, [count, x]] of [...byStock].sort((a, b) => a[0] - b[0])) {
      const plyNote = `${x} trimmer / header plies round floor openings`;
      add(`${size} floor joist, ${ft}'`, Math.ceil((count + x) * (1 + waste / 2)), 'ea', count ? `${count} joists @ ${s.joistSpacing}" o.c., ${lap}${x ? ` + ${plyNote}` : ''}` : plyNote);
    }
    add(`${size} rim joist, 16'`, Math.ceil((L.rimLength * (1 + waste)) / 192), 'ea', `${Math.round(L.rimLength / 12)} LF around the floor`);
  } else {
    const d = depthLabel(s.ijoist.depth);
    const lf = L.joists.reduce((t, j) => t + segLen(j) + 3, 0) + L.trimmers.reduce((t, j) => t + 2 * (segLen(j) + 3), 0) + L.headers.reduce((t, j) => t + 2 * segLen(j), 0);
    add(`I-joist, ${s.ijoist.series} ${d}`, Math.ceil((lf * (1 + waste / 2)) / 12), 'lf', `${L.joists.length} joists @ ${s.joistSpacing}" o.c., ${lap}${extra}, ${Math.round(lf / 12)} LF — span and series from the maker's tables`);
    add(`Rim board, ${d}`, Math.ceil((L.rimLength * (1 + waste)) / 12), 'lf', `${Math.round(L.rimLength / 12)} LF around the floor`);
  }
  const gLen = L.girders.reduce((t, g) => t + segLen(g), 0);
  if (gLen) {
    const gl = `${L.girders.length} girder line${L.girders.length > 1 ? 's' : ''}, ${Math.round(gLen / 12)} LF — size it with a span table`;
    if (s.ijoist) add(`LVL girder, ${depthLabel(s.ijoist.depth)} deep (allowance)`, Math.ceil((gLen * (1 + waste)) / 12), 'lf', gl);
    else add(`${size} girder ply (3-ply built-up), 16'`, Math.ceil((gLen * 3 * (1 + waste)) / 192), 'ea', gl);
    // A row of solid blocks between the joists along each girder: about the girder's own length (none when the joists hang flush).
    if (!s.flushGirders) {
      if (s.ijoist) add(`Rim board blocking over girders, ${depthLabel(s.ijoist.depth)}`, Math.ceil((gLen * (1 + waste)) / 12), 'lf', 'one row of blocking panels over each girder');
      else add(`${size} blocking over girders, 16'`, Math.ceil((gLen * (1 + waste)) / 192), 'ea', 'one row of blocks over each girder');
    }
  }
  if (L.piers.length) {
    add('Pier / post with footing', L.piers.length, 'ea', `under the girders at ${Math.round(s.pierSpacing / 12)}' o.c.`);
    lines.push(...pierPadLines(s.foundation, L.piers.length));
  }
  const member = s.ijoist ? `I-joist hanger, ${s.ijoist.series} ${depthLabel(s.ijoist.depth)}` : `joist hanger, ${size}`;
  const single = L.hangers.filter((h) => !h.double).length;
  const dbl = L.hangers.length - single;
  const why = [L.openings.length && 'tail joists into headers at floor openings', s.flushGirders && L.girders.length && 'joists hung flush off the girders'].filter(Boolean).join('; ');
  add(s.ijoist ? member : `Joist hanger, ${size}`, single, 'ea', why);
  add(`Double ${member}`, dbl, 'ea', 'doubled headers into the trimmers at floor openings');
  const full = L.sheets.length;
  const area = L.outline.reduce((t, p) => t + polygonArea(p), 0) / 144;
  add(s.subfloor === 'osb' ? '23/32" T&G OSB subfloor, 4×8' : '23/32" T&G plywood subfloor, 4×8', full, 'sheets', `${Math.round(area)} sq ft, staggered layout (${L.sheets.filter((x) => x.cut).length} cut)`);
  add('Subfloor adhesive, 28 oz', Math.ceil(full / 3), 'tubes', '~3 sheets per tube');
  if (s.insulation !== 'none') {
    const sq = L.area / 144;
    add(`${s.insulation} floor insulation batts`, Math.ceil(sq * (1 + waste)), 'sq ft', `between the joists, ${Math.round(sq)} sq ft less openings`, 'Insulation & wrap');
    add('Insulation supports (wire)', Math.ceil(L.area / s.joistSpacing / 24), 'ea', `one every 2' along each ${s.joistSpacing}" joist bay`, 'Insulation & wrap');
  }
  return lines;
}
