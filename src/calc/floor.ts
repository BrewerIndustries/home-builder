import { polygonArea } from '../model/geometry.ts';
import type { Point, Project } from '../model/types.ts';
import { foundationOf } from './foundation.ts';
import type { MaterialLine } from './materials.ts';
import { childRooms } from './regions.ts';
import { stockFeet } from './roof.ts';

// Framed floor over a crawlspace: joist layout broken over girder lines, piers
// under the girders, rim board, and a staggered 4×8 subfloor layout. Members are
// laid out and counted, not sized — joist and girder spans need IRC R502.3 /
// R602.7 tables. Inches throughout.

const AUTO_MAX_SPAN = 144; // layout default only, not a span check
const SHEET_LONG = 96;
const SHEET_SHORT = 48;

export interface Seg {
  a: Point;
  b: Point;
}

export interface FloorLayout {
  /** Joists run along plan x? */
  alongX: boolean;
  outline: Point[][];
  joists: Seg[];
  girders: Seg[];
  piers: Point[];
  /** Subfloor sheets (whole or cut), plan rectangles. */
  sheets: { x: number; y: number; w: number; h: number; cut: boolean }[];
  rimLength: number;
  /** Longest joist span between supports. */
  maxSpan: number;
}

/** Footprint polygons at the wall centrelines: outermost rooms, else the exterior walls' box. */
function outline(project: Project): Point[][] {
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

export function floorLayout(project: Project): FloorLayout | null {
  const f = foundationOf(project);
  if (f.type !== 'crawl') return null;
  const polys = outline(project);
  if (!polys.length) return null;
  const all = polys.flat();
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // Joists span the short way unless told otherwise.
  const alongX = f.joistDir === 'x' || (f.joistDir === 'auto' && x1 - x0 < y1 - y0);
  const toUV = (p: Point) => (alongX ? { u: p.y, v: p.x } : { u: p.x, v: p.y });
  const toXY = (u: number, v: number): Point => (alongX ? { x: v, y: u } : { x: u, y: v });
  const uv = polys.map((pts) => pts.map(toUV));
  const [u0, u1] = alongX ? [y0, y1] : [x0, x1];
  const [v0, v1] = alongX ? [x0, x1] : [y0, y1];
  const eps = 1e-6;

  const n = f.girders === 'auto' ? Math.max(0, Math.ceil((v1 - v0) / AUTO_MAX_SPAN) - 1) : Math.max(0, Math.round(f.girders));
  const girderV = Array.from({ length: n }, (_, i) => v0 + ((v1 - v0) * (i + 1)) / (n + 1));

  // Girders: lines across the joists, clipped to the footprint; piers along them.
  const girders: Seg[] = [];
  const piers: Point[] = [];
  const vu = polys.map((pts) => pts.map((p) => { const q = toUV(p); return { u: q.v, v: q.u }; }));
  for (const g of girderV) {
    for (const [a, b] of scan(vu, g + eps)) {
      girders.push({ a: toXY(a, g), b: toXY(b, g) });
      const k = Math.max(1, Math.ceil((b - a) / f.pierSpacing));
      for (let i = 1; i < k; i++) piers.push(toXY(a + ((b - a) * i) / k, g));
    }
  }

  // Joists at spacing across u, broken over each girder.
  const joists: Seg[] = [];
  let maxSpan = 0;
  for (let u = u0 + f.joistSpacing; u < u1 - 1; u += f.joistSpacing) {
    for (const [a, b] of scan(uv, u + eps)) {
      const stops = [a, ...girderV.filter((g) => g > a + 1 && g < b - 1), b];
      for (let i = 0; i + 1 < stops.length; i++) {
        joists.push({ a: toXY(u, stops[i]), b: toXY(u, stops[i + 1]) });
        maxSpan = Math.max(maxSpan, stops[i + 1] - stops[i]);
      }
    }
  }

  // Subfloor: 8 ft side across the joists, rows staggered half a sheet.
  const sheets: FloorLayout['sheets'] = [];
  let row = 0;
  for (let v = v0; v < v1 - 0.5; v += SHEET_SHORT, row++) {
    const h = Math.min(SHEET_SHORT, v1 - v);
    for (const [a, b] of scan(vu, v + h / 2)) {
      let u = a - (row % 2 ? SHEET_LONG / 2 : 0);
      for (; u < b - 0.5; u += SHEET_LONG) {
        const s = Math.max(u, a);
        const e = Math.min(u + SHEET_LONG, b);
        const cut = e - s < SHEET_LONG - 0.5 || h < SHEET_SHORT - 0.5;
        const p = toXY(s, v);
        sheets.push(alongX ? { x: p.x, y: p.y, w: h, h: e - s, cut } : { x: p.x, y: p.y, w: e - s, h, cut });
      }
    }
  }

  const rimLength = polys.reduce((s, pts) => s + pts.reduce((t, p, i) => t + Math.hypot(pts[(i + 1) % pts.length].x - p.x, pts[(i + 1) % pts.length].y - p.y), 0), 0);
  return { alongX, outline: polys, joists, girders, piers, sheets, rimLength, maxSpan };
}

const segLen = (s: Seg) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);

export function floorLines(project: Project, waste: number): MaterialLine[] {
  const L = floorLayout(project);
  if (!L) return [];
  const f = foundationOf(project);
  const lines: MaterialLine[] = [];
  const add = (item: string, qty: number, unit: string, basis: string) => qty > 0 && lines.push({ category: 'Floor', item, qty, unit, basis });

  const byStock = new Map<number, number>();
  for (const j of L.joists) {
    const ft = stockFeet(segLen(j) + 3); // a little past the support for bearing / lap
    byStock.set(ft, (byStock.get(ft) ?? 0) + 1);
  }
  for (const [ft, count] of [...byStock].sort((a, b) => a[0] - b[0])) {
    add(`${f.joistSize} floor joist, ${ft}'`, Math.ceil(count * (1 + waste / 2)), 'ea', `${count} joists @ ${f.joistSpacing}" o.c., lapped over girders`);
  }
  add(`${f.joistSize} rim joist, 16'`, Math.ceil((L.rimLength * (1 + waste)) / 192), 'ea', `${Math.round(L.rimLength / 12)} LF around the floor`);
  const gLen = L.girders.reduce((s, g) => s + segLen(g), 0);
  if (gLen) {
    add(`${f.joistSize} girder ply (3-ply built-up), 16'`, Math.ceil((gLen * 3 * (1 + waste)) / 192), 'ea', `${L.girders.length} girder line${L.girders.length > 1 ? 's' : ''}, ${Math.round(gLen / 12)} LF — size it with a span table`);
    // A row of solid blocks between the joists along each girder: about the girder's own length.
    add(`${f.joistSize} blocking over girders, 16'`, Math.ceil((gLen * (1 + waste)) / 192), 'ea', 'one row of blocks over each girder');
  }
  if (L.piers.length) {
    add('Pier / post with footing', L.piers.length, 'ea', `under the girders at ${Math.round(f.pierSpacing / 12)}' o.c.`);
    add('Concrete, pier footings 24×24×10', Math.ceil(((L.piers.length * 24 * 24 * 10) / 46656) * 1.1 * 4) / 4, 'yd³', `${L.piers.length} pads +10%`);
  }
  const full = L.sheets.length;
  const area = L.outline.reduce((s, p) => s + polygonArea(p), 0) / 144;
  add(f.subfloor === 'osb' ? '23/32" T&G OSB subfloor, 4×8' : '23/32" T&G plywood subfloor, 4×8', full, 'sheets', `${Math.round(area)} sq ft, staggered layout (${L.sheets.filter((s) => s.cut).length} cut)`);
  add('Subfloor adhesive, 28 oz', Math.ceil(full / 3), 'tubes', '~3 sheets per tube');
  return lines;
}
