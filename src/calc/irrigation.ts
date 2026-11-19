import { dist, pointInPolygon, polygonArea } from '../model/geometry.ts';
import { EMPTY_IRRIGATION, HEAD_LABEL, TYPICAL_NOZZLES, type HeadKind, type Irrigation, type IrrigationHead, type IrrigationZone, type LayoutPattern, type Nozzle } from '../model/irrigation.ts';
import { EMPTY_SITE, uid, type Point, type Project } from '../model/types.ts';
import { formatFtIn } from '../model/units.ts';
import type { CodeCheck } from './irc.ts';
import type { MaterialLine } from './materials.ts';

// Irrigation: head flows, coverage sampling, head-to-head spacing, auto-layout,
// routed pipe runs and the parts list. Product figures (throw, GPM) are typical
// catalogue defaults the user edits — nothing here is a code requirement.

const ceil = (n: number) => Math.ceil(n - 1e-9);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function irrigationOf(project: Project): Irrigation {
  return (project.site ?? EMPTY_SITE).irrigation ?? EMPTY_IRRIGATION;
}

export function nozzleFor(irr: Irrigation, kind: HeadKind): Nozzle {
  return { ...TYPICAL_NOZZLES[kind], ...irr.nozzles?.[kind] };
}

/** A head's flow: its override, else the nozzle's full-circle GPM scaled by arc (matched precipitation). */
export function headGpm(h: IrrigationHead, irr: Irrigation): number {
  if (h.gpm != null) return h.gpm;
  const n = nozzleFor(irr, h.kind);
  return h.kind === 'drip' ? n.gpm : (n.gpm * Math.min(360, Math.max(0, h.arc))) / 360;
}

export function zoneHeads(irr: Irrigation, zoneId: string): IrrigationHead[] {
  return irr.heads.filter((h) => h.zoneId === zoneId);
}

/** Zone flow: sum of its heads' GPM. */
export function zoneGpm(irr: Irrigation, zoneId: string): number {
  return round2(zoneHeads(irr, zoneId).reduce((s, h) => s + headGpm(h, irr), 0));
}

/** The lawn / bed polygons a zone waters (stale area ids are skipped). */
export function zonePolygons(project: Project, zone: IrrigationZone): Point[][] {
  const areas = (project.site ?? EMPTY_SITE).areas;
  return zone.areaIds.map((id) => areas.find((a) => a.id === id)?.points).filter((p): p is Point[] => !!p && p.length >= 3);
}

const norm = (deg: number) => ((deg % 360) + 360) % 360;
const angleTo = (from: Point, to: Point) => norm((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI);

/** Does p sit inside the head's arc (direction only)? */
export function inArc(h: IrrigationHead, p: Point, tolDeg = 0.5): boolean {
  if (h.arc >= 360 || dist(h.at, p) < 1e-6) return true;
  return norm(angleTo(h.at, p) - h.rotation) <= h.arc + tolDeg || norm(angleTo(h.at, p) - h.rotation) >= 360 - tolDeg;
}

/** Is p wetted by the head (within throw and arc)? */
export function covers(h: IrrigationHead, p: Point): boolean {
  return dist(h.at, p) <= h.radius + 1e-6 && inArc(h, p);
}

export interface CoverageCell {
  at: Point;
  /** How many heads reach this sample point. */
  n: number;
}

export interface Coverage {
  step: number;
  cells: CoverageCell[];
  /** Fraction of sample points no head reaches. */
  gap: number;
  /** Fraction reached by exactly one head (no head-to-head overlap). */
  single: number;
}

/**
 * Sample the zone's area on a grid and count the spray / rotor heads reaching each
 * point. Heads from every zone count, so a lawn split across zones isn't flagged.
 */
export function zoneCoverage(project: Project, zone: IrrigationZone, maxSamples = 3000): Coverage {
  const polys = zonePolygons(project, zone);
  const heads = irrigationOf(project).heads.filter((h) => h.kind !== 'drip');
  const area = polys.reduce((s, p) => s + polygonArea(p), 0);
  if (!polys.length || area <= 0) return { step: 0, cells: [], gap: 0, single: 0 };
  const step = Math.max(6, Math.sqrt(area / maxSamples));
  const xs = polys.flat().map((p) => p.x);
  const ys = polys.flat().map((p) => p.y);
  const cells: CoverageCell[] = [];
  for (let y = Math.min(...ys) + step / 2; y < Math.max(...ys); y += step) {
    for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) {
      const at = { x, y };
      if (!polys.some((p) => pointInPolygon(at, p))) continue;
      cells.push({ at, n: heads.reduce((s, h) => s + (covers(h, at) ? 1 : 0), 0) });
    }
  }
  const total = cells.length || 1;
  return { step, cells, gap: cells.filter((c) => c.n === 0).length / total, single: cells.filter((c) => c.n === 1).length / total };
}

export interface ShortHead {
  head: IrrigationHead;
  neighbour: IrrigationHead;
  distance: number;
}

/**
 * Head-to-head check: every spray / rotor head's throw should reach its nearest
 * neighbouring head in the same zone (and that neighbour should be within its arc).
 */
export function headToHead(irr: Irrigation, zoneId: string): ShortHead[] {
  const heads = zoneHeads(irr, zoneId).filter((h) => h.kind !== 'drip');
  const out: ShortHead[] = [];
  for (const h of heads) {
    let best: IrrigationHead | null = null;
    let bd = Infinity;
    for (const o of heads) {
      if (o === h) continue;
      const d = dist(h.at, o.at);
      if (d < bd) [best, bd] = [o, d];
    }
    if (best && (bd > h.radius * 1.02 || !inArc(h, best.at, 5))) out.push({ head: h, neighbour: best, distance: bd });
  }
  return out;
}

/** Interior side of edge a→b of the polygon: unit normal pointing inward. */
function inwardNormal(a: Point, b: Point, poly: Point[]): Point {
  const len = dist(a, b) || 1;
  const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  const mid = { x: (a.x + b.x) / 2 + n.x, y: (a.y + b.y) / 2 + n.y };
  return pointInPolygon(mid, poly) ? n : { x: -n.x, y: -n.y };
}

/** Distance from p to the polygon's outline. */
function distToEdges(p: Point, pts: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2));
    best = Math.min(best, dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }));
  }
  return best;
}

/**
 * Lay heads out over one polygon at head-to-head spacing (spacing = throw):
 * a part-circle head on every corner (arc = the corner's inside angle), half
 * circles along each edge, full circles on a square or triangular grid inside.
 * Drip zones get emitters on a square grid at the emitter spacing.
 */
export function layoutPolygon(poly: Point[], kind: HeadKind, nozzle: Nozzle, pattern: LayoutPattern, zoneId: string, makeId: () => string = () => uid('h')): IrrigationHead[] {
  const heads: IrrigationHead[] = [];
  const head = (at: Point, arc: number, rotation: number): IrrigationHead => ({ id: makeId(), zoneId, kind, at: { x: round2(at.x), y: round2(at.y) }, radius: nozzle.radius, arc: Math.round(arc), rotation: Math.round(norm(rotation)) });
  const n = poly.length;
  if (n < 3) return heads;
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];

  if (kind === 'drip') {
    const s = nozzle.spacing ?? 18;
    const cols = Math.max(1, Math.round((x1 - x0) / s));
    const rows = Math.max(1, Math.round((y1 - y0) / s));
    const sx = (x1 - x0) / cols;
    const sy = (y1 - y0) / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const at = { x: x0 + sx * (c + 0.5), y: y0 + sy * (r + 0.5) };
      if (pointInPolygon(at, poly)) heads.push(head(at, 360, 0));
    }
    return heads;
  }

  const S = nozzle.radius;
  // Corners: arc spans the inside angle.
  for (let i = 0; i < n; i++) {
    const v = poly[i];
    const a1 = angleTo(v, poly[(i - 1 + n) % n]);
    const a2 = angleTo(v, poly[(i + 1) % n]);
    const span = norm(a2 - a1);
    const midDir = ((a1 + span / 2) * Math.PI) / 180;
    const probe = { x: v.x + Math.cos(midDir) * 2, y: v.y + Math.sin(midDir) * 2 };
    if (pointInPolygon(probe, poly)) heads.push(head(v, span, a1));
    else heads.push(head(v, 360 - span, a2));
  }
  // Edges: half circles at ≤ S spacing.
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const len = dist(a, b);
    const segs = Math.ceil(len / S - 1e-6);
    const nrm = inwardNormal(a, b, poly);
    const rot = (Math.atan2(nrm.y, nrm.x) * 180) / Math.PI - 90;
    for (let k = 1; k < segs; k++) heads.push(head({ x: a.x + ((b.x - a.x) * k) / segs, y: a.y + ((b.y - a.y) * k) / segs }, 180, rot));
  }
  // Interior: full circles on the lattice, kept clear of the edge rows.
  const rowGap = pattern === 'triangular' ? (S * Math.sqrt(3)) / 2 : S;
  const rows = Math.max(0, Math.round((y1 - y0) / rowGap));
  const ry = rows ? (y1 - y0) / rows : 0;
  for (let r = 1; r < rows; r++) {
    const y = y0 + ry * r;
    const cols = Math.max(1, Math.round((x1 - x0) / S));
    const cx = (x1 - x0) / cols;
    const shift = pattern === 'triangular' && r % 2 === 1 ? cx / 2 : 0;
    for (let c = 0; c <= cols; c++) {
      const at = { x: x0 + cx * c + shift, y };
      if (at.x > x1 + 1e-6 || !pointInPolygon(at, poly)) continue;
      if (distToEdges(at, poly) < S * 0.5) continue;
      heads.push(head(at, 360, 0));
    }
  }
  return heads;
}

/** Auto-layout a whole zone: replaces its heads, keeps every other zone's. */
export function autoLayoutZone(project: Project, zoneId: string, makeId?: () => string): Irrigation {
  const irr = irrigationOf(project);
  const zone = irr.zones.find((z) => z.id === zoneId);
  if (!zone) return irr;
  const nozzle = nozzleFor(irr, zone.kind);
  const fresh = zonePolygons(project, zone).flatMap((poly) => layoutPolygon(poly, zone.kind, nozzle, zone.pattern, zone.id, makeId));
  // Shared corners between adjacent areas would stack two heads; keep one.
  const kept: IrrigationHead[] = [];
  for (const h of fresh) if (!kept.some((k) => dist(k.at, h.at) < 1)) kept.push(h);
  return { ...irr, heads: [...irr.heads.filter((h) => h.zoneId !== zoneId), ...kept] };
}

// ---------- pipe runs ----------

/** Nominal Sch 40 PVC sizes with inside diameters, inches. */
const PVC: { size: string; id: number }[] = [
  { size: '3/4"', id: 0.824 },
  { size: '1"', id: 1.049 },
  { size: '1-1/4"', id: 1.38 },
  { size: '1-1/2"', id: 1.61 },
  { size: '2"', id: 2.067 },
];
/** Common design rule of thumb: keep water velocity in PVC at or under 5 ft/s. */
export const MAX_VELOCITY_FPS = 5;

/** GPM a pipe of the given inside diameter carries at the velocity limit. */
export function pipeCapacity(insideDia: number, fps = MAX_VELOCITY_FPS): number {
  const areaSqFt = (Math.PI * (insideDia / 2) ** 2) / 144;
  return areaSqFt * fps * 60 * 7.48052;
}

/** Smallest PVC size that keeps flow under the velocity limit. */
export function pvcSize(gpm: number): string {
  return (PVC.find((p) => pipeCapacity(p.id) >= gpm) ?? PVC[PVC.length - 1]).size;
}

export interface PipeRun {
  /** 'main' for backflow → manifold, else the zone id. */
  id: string;
  label: string;
  kind: 'pvc' | 'drip';
  size: string;
  /** Polylines making up the run. */
  paths: Point[][];
  /** Total length, inches. */
  length: number;
}

const polyLen = (pts: Point[]) => pts.reduce((s, p, i) => (i ? s + dist(pts[i - 1], p) : s), 0);
/** Orthogonal L route (x first, then y), the way trenches usually run. */
const lRoute = (a: Point, b: Point): Point[] => (Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6 ? [a, b] : [a, { x: b.x, y: a.y }, b]);

/**
 * Routed pipe runs: mainline from the backflow device to the manifold, then per
 * zone a supply leg from the manifold to the nearest head and a branch network
 * joining the rest (minimum spanning tree, straight runs). Laterals are sized for
 * the whole zone's flow — conservative.
 */
export function pipeRuns(project: Project): PipeRun[] {
  const irr = irrigationOf(project);
  const runs: PipeRun[] = [];
  const flows = irr.zones.map((z) => zoneGpm(irr, z.id));
  if (irr.backflow && irr.manifold) {
    const path = lRoute(irr.backflow, irr.manifold);
    runs.push({ id: 'main', label: 'Mainline', kind: 'pvc', size: pvcSize(Math.max(0, ...flows)), paths: [path], length: polyLen(path) });
  }
  if (!irr.manifold) return runs;
  for (const z of irr.zones) {
    const heads = zoneHeads(irr, z.id);
    if (!heads.length) continue;
    const gpm = zoneGpm(irr, z.id);
    const m = irr.manifold;
    const first = heads.reduce((b, h) => (dist(h.at, m) < dist(b.at, m) ? h : b));
    const supply = lRoute(m, first.at);
    // Prim's MST from the first head.
    const inTree = new Set([first.id]);
    const branches: Point[][] = [];
    while (inTree.size < heads.length) {
      let best: [IrrigationHead, IrrigationHead, number] | null = null;
      for (const a of heads) if (inTree.has(a.id)) for (const b of heads) if (!inTree.has(b.id)) {
        const d = dist(a.at, b.at);
        if (!best || d < best[2]) best = [a, b, d];
      }
      if (!best) break;
      inTree.add(best[1].id);
      branches.push([best[0].at, best[1].at]);
    }
    if (z.kind === 'drip') {
      runs.push({ id: z.id, label: `${z.name} supply`, kind: 'pvc', size: pvcSize(gpm), paths: [supply], length: polyLen(supply) });
      runs.push({ id: z.id, label: `${z.name} drip line`, kind: 'drip', size: '1/2"', paths: branches, length: branches.reduce((s, b) => s + polyLen(b), 0) });
    } else {
      const paths = [supply, ...branches];
      runs.push({ id: z.id, label: `${z.name} lateral`, kind: 'pvc', size: pvcSize(gpm), paths, length: paths.reduce((s, b) => s + polyLen(b), 0) });
    }
  }
  return runs;
}

// ---------- parts list ----------

const CONTROLLER_STATIONS = [4, 6, 8, 12, 16, 24, 32];

/** Irrigation parts for the materials list / estimate. */
export function irrigationLines(project: Project): MaterialLine[] {
  const irr = irrigationOf(project);
  const lines: MaterialLine[] = [];
  const add = (item: string, qty: number, unit: string, basis: string) => qty > 0 && lines.push({ category: 'Landscape', item, qty, unit, basis });
  const count = (k: HeadKind) => irr.heads.filter((h) => h.kind === k && irr.zones.some((z) => z.id === h.zoneId)).length;
  const sprays = count('spray');
  const rotors = count('rotor');
  const drips = count('drip');
  const zones = irr.zones.filter((z) => zoneHeads(irr, z.id).length > 0);
  if (!zones.length) return lines;
  const nz = (k: HeadKind) => nozzleFor(irr, k);
  add('Pop-up spray head + nozzle', sprays, 'ea', `${formatFtIn(nz('spray').radius, { compact: true })} throw, typical catalogue nozzle`);
  add('Rotor head + nozzle', rotors, 'ea', `${formatFtIn(nz('rotor').radius, { compact: true })} throw, typical catalogue nozzle`);
  add('Drip emitter', drips, 'ea', `${round2(nz('drip').gpm * 60)} GPH each`);
  add('Funny pipe (swing joints)', ceil((sprays + rotors) * 1.5), 'LF', '~18" per spray / rotor head');
  add('Irrigation zone valve', zones.length, 'ea', '1 per zone, at the manifold');
  add('Valve box', ceil(zones.length / 3), 'ea', 'up to 3 valves per box');
  add('Drip zone kit (filter + pressure regulator)', zones.filter((z) => z.kind === 'drip').length, 'ea', '1 per drip zone');
  const stations = CONTROLLER_STATIONS.find((s) => s >= zones.length) ?? zones.length;
  add(`Irrigation controller, ${stations}-station`, 1, 'ea', `${zones.length} zone${zones.length === 1 ? '' : 's'}`);
  add('Backflow preventer', 1, 'ea', 'type and testing per your local water authority');
  const pipe = new Map<string, number>();
  for (const r of pipeRuns(project)) {
    const key = r.kind === 'drip' ? `Drip tubing ${r.size}` : `PVC pipe ${r.size}`;
    pipe.set(key, (pipe.get(key) ?? 0) + r.length);
  }
  for (const [item, len] of [...pipe].sort()) add(item, ceil((len / 12) * 1.1), 'LF', `${Math.round(len / 12)}' routed +10%`);
  const fittings = sprays + rotors + drips + zones.length * 4 + (irr.backflow && irr.manifold ? 4 : 0);
  add('Irrigation fittings allowance', fittings, 'ea', '≈1 per head / emitter + 4 per valve + mainline');
  return lines;
}

/** Sample prices for the parts above, merged into pricing.ts's sample table. */
export const IRRIGATION_SAMPLE: [RegExp, number][] = [
  [/^Pop-up spray head \+ nozzle/, 6],
  [/^Rotor head \+ nozzle/, 18],
  [/^Drip emitter/, 0.35],
  [/^Funny pipe/, 0.45],
  [/^Irrigation zone valve/, 28],
  [/^Valve box/, 22],
  [/^Drip zone kit/, 35],
  [/^Irrigation controller/, 130],
  [/^Backflow preventer/, 200],
  [/^PVC pipe 3\/4"/, 0.6],
  [/^PVC pipe 1"/, 0.85],
  [/^PVC pipe 1-1\/4"/, 1.2],
  [/^PVC pipe 1-1\/2"/, 1.5],
  [/^PVC pipe 2"/, 2.1],
  [/^Drip tubing/, 0.25],
  [/^Irrigation fittings allowance/, 1.5],
];

// ---------- checks ----------

export function irrigationChecks(project: Project): CodeCheck[] {
  const irr = irrigationOf(project);
  const checks: CodeCheck[] = [];
  const section = 'Irrigation';
  for (const z of irr.zones) {
    const heads = zoneHeads(irr, z.id);
    if (!heads.length) continue;
    const gpm = zoneGpm(irr, z.id);
    if (irr.supplyGpm) {
      checks.push({
        rule: 'Zone flow vs water supply',
        section,
        status: gpm > irr.supplyGpm ? 'warn' : 'pass',
        message: `${z.name}: ${gpm} GPM from ${heads.length} head${heads.length === 1 ? '' : 's'} ${gpm > irr.supplyGpm ? 'exceeds' : 'is within'} the ${irr.supplyGpm} GPM supply${gpm > irr.supplyGpm ? ' — split the zone' : ''}`,
        targetId: z.id,
      });
    } else {
      checks.push({ rule: 'Zone flow vs water supply', section, status: 'info', message: `${z.name}: ${gpm} GPM — enter the water supply capacity on the Site tab's Irrigation panel to check it`, targetId: z.id });
    }
    const kinds = new Set(heads.map((h) => h.kind));
    if (kinds.size > 1) {
      checks.push({ rule: 'Mixed head types in a zone', section, status: 'warn', message: `${z.name} mixes ${[...kinds].map((k) => HEAD_LABEL[k].toLowerCase()).join(' and ')} heads; they apply water at different rates — keep them on separate zones`, targetId: z.id });
    }
    if (z.kind === 'drip') continue;
    const short = headToHead(irr, z.id);
    if (heads.length > 1) {
      checks.push({
        rule: 'Head-to-head coverage',
        section,
        status: short.length ? 'warn' : 'pass',
        message: short.length
          ? `${z.name}: ${short.length} head${short.length === 1 ? '' : 's'} don't reach the nearest head (worst ${formatFtIn(Math.max(...short.map((s) => s.distance)), { compact: true })} apart vs ${formatFtIn(short[0].head.radius, { compact: true })} throw)`
          : `${z.name}: every head's throw reaches its nearest neighbour`,
        targetId: short[0]?.head.id ?? z.id,
      });
    }
    const cov = zoneCoverage(project, z);
    if (cov.cells.length) {
      const gapPct = Math.round(cov.gap * 1000) / 10;
      checks.push({
        rule: 'Coverage gaps',
        section,
        status: cov.gap > 0.01 ? 'warn' : 'pass',
        message: `${z.name}: ${gapPct}% of the area is dry, ${Math.round(cov.single * 1000) / 10}% reached by only one head`,
        targetId: z.id,
      });
    }
  }
  if (irr.heads.length && !irr.manifold) checks.push({ rule: 'Valve manifold', section, status: 'info', message: 'place the valve manifold to route laterals and take off pipe' });
  return checks;
}
