import { PLANT_BY_ID } from '../data/plants.ts';
import { dist, pointInPolygon, polygonArea } from '../model/geometry.ts';
import { EMPTY_SITE, type Easement, type Plant, type Point, type Project, type RetainingWall, type SiteArea, type SpotGrade } from '../model/types.ts';
import { formatFtIn } from '../model/units.ts';
import type { CodeCheck } from './irc.ts';
import type { MaterialLine } from './materials.ts';
import { footprint } from './site.ts';

// Landscape v2: easements, retaining walls, topsoil / edging takeoffs, planting-bed
// fill and the foundation-drainage grade check. Everything here reads optional
// Site fields, so projects saved before v2 produce nothing new.

const CUYD = 46656;
const ceil = (n: number) => Math.ceil(n - 1e-9);

// ---------- easements ----------

/** The easement as a polygon: a strip along its lot edge, or its drawn outline. */
export function easementPolygon(e: Easement, lot?: Point[]): Point[] {
  if (e.points && e.points.length >= 3) return e.points;
  if (!lot || lot.length < 3 || e.edge === undefined || !e.width) return [];
  const a = lot[e.edge % lot.length];
  const b = lot[(e.edge + 1) % lot.length];
  const len = dist(a, b);
  if (!len) return [];
  // Inward normal: towards the lot's interior (tested on the edge midpoint).
  let n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if (!pointInPolygon({ x: mid.x + n.x, y: mid.y + n.y }, lot)) n = { x: -n.x, y: -n.y };
  const w = e.width;
  return [a, b, { x: b.x + n.x * w, y: b.y + n.y * w }, { x: a.x + n.x * w, y: a.y + n.y * w }];
}

function segmentsCross(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
  const o = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = o(q1, q2, p1);
  const d2 = o(q1, q2, p2);
  const d3 = o(p1, p2, q1);
  const d4 = o(p1, p2, q2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Do two polygons share any interior area (or does polyline `a` enter polygon `b`)? */
export function overlaps(a: Point[], b: Point[], aClosed = true): boolean {
  if (a.length < 2 || b.length < 3) return false;
  if (a.some((p) => pointInPolygon(p, b))) return true;
  if (aClosed && b.some((p) => pointInPolygon(p, a))) return true;
  const na = aClosed ? a.length : a.length - 1;
  for (let i = 0; i < na; i++) {
    for (let j = 0; j < b.length; j++) {
      if (segmentsCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return false;
}

const HARD: ReadonlySet<SiteArea['material']> = new Set(['pavers', 'concrete', 'gravel', 'decking']);

export function easementChecks(project: Project): CodeCheck[] {
  const site = project.site ?? EMPTY_SITE;
  const out: CodeCheck[] = [];
  const house = footprint(project);
  for (const e of site.easements ?? []) {
    const poly = easementPolygon(e, site.lot);
    if (poly.length < 3) continue;
    const name = e.label?.trim() || 'Easement';
    const hits: string[] = [];
    if (house.some((pts) => overlaps(pts, poly))) hits.push('the house');
    const hard = site.areas.filter((a) => HARD.has(a.material) && overlaps(a.points, poly));
    if (hard.length) hits.push(`${hard.length} hardscape area${hard.length > 1 ? 's' : ''}`);
    const walls = (site.retainingWalls ?? []).filter((w) => overlaps(w.points, poly, false));
    if (walls.length) hits.push(`${walls.length} retaining wall${walls.length > 1 ? 's' : ''}`);
    const trees = site.plants.filter((p) => PLANT_BY_ID.get(p.species)?.form === 'tree' && pointInPolygon(p.at, poly));
    if (trees.length) hits.push(`${trees.length} tree${trees.length > 1 ? 's' : ''}`);
    out.push({
      rule: `${name} kept clear`,
      section: 'Recorded plat',
      status: hits.length ? 'warn' : 'pass',
      message: hits.length ? `inside it: ${hits.join(', ')} — utilities may dig there or require removal; check the plat's terms` : 'nothing built or planted (trees) inside it',
      targetId: e.id,
    });
  }
  return out;
}

// ---------- retaining walls, topsoil, edging ----------

/** Nominal segmental block face: 8" high × 18" long (typical large-format SRW unit). */
export const WALL_BLOCK = { h: 8, l: 18 };

export function polylineLength(pts: Point[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

export interface WallTakeoff {
  length: number;
  courses: number;
  blocks: number;
  caps: number;
}

/** One buried course plus enough courses to reach the exposed height. */
export function wallTakeoff(w: RetainingWall): WallTakeoff {
  const length = polylineLength(w.points);
  const courses = ceil(w.height / WALL_BLOCK.h) + 1;
  const perCourse = ceil(length / WALL_BLOCK.l);
  return { length, courses, blocks: courses * perCourse, caps: perCourse };
}

export function landscapeLines(project: Project): MaterialLine[] {
  const site = project.site ?? EMPTY_SITE;
  const lines: MaterialLine[] = [];
  const add = (item: string, qty: number, unit: string, basis: string) => qty > 0 && lines.push({ category: 'Landscape', item, qty, unit, basis });

  const walls = (site.retainingWalls ?? []).filter((w) => w.points.length >= 2 && w.height > 0);
  if (walls.length) {
    const t = walls.map(wallTakeoff);
    const len = t.reduce((s, x) => s + x.length, 0);
    const blocks = t.reduce((s, x) => s + x.blocks, 0);
    add('Retaining wall block', ceil(blocks * 1.05), 'ea', `${WALL_BLOCK.h}"×${WALL_BLOCK.l}" face, 1 buried course, +5%`);
    add('Retaining wall cap', ceil(t.reduce((s, x) => s + x.caps, 0) * 1.05), 'ea', `${WALL_BLOCK.l}" caps along ${Math.round(len / 12)} LF, +5%`);
    // 24" × 6" compacted leveling pad; 12" of clean stone behind the full wall height.
    add('Retaining wall base gravel', ceil(((len * 24 * 6) / CUYD) * 1.4 * 1.15 * 10) / 10, 'tons', '24"×6" pad, 1.4 t/yd³, +15% compaction');
    const drain = walls.reduce((s, w, i) => s + t[i].length * 12 * (t[i].courses * WALL_BLOCK.h), 0);
    add('Wall drainage stone', ceil((drain / CUYD) * 1.4 * 10) / 10, 'tons', '12" zone behind the wall, 1.4 t/yd³');
    add('Perforated drain pipe, 4"', ceil((len / 12) * 1.05), 'LF', 'at the heel of each wall +5%');
  }

  const soil = site.areas.reduce((s, a) => s + (a.topsoil ? polygonArea(a.points) * a.topsoil : 0), 0);
  if (soil) add('Topsoil', ceil((soil / CUYD) * 1.15 * 2) / 2, 'yd³', 'depth × area +15% settling, ordered in ½ yd');
  const edge = site.areas.reduce((s, a) => s + (a.edging && a.material !== 'pavers' ? polylineLength([...a.points, a.points[0]]) : 0), 0);
  if (edge) add('Landscape edging', ceil((edge / 12) * 1.05), 'LF', 'bed / lawn perimeter +5%');
  return lines;
}

/** Exposed walls over 4 ft are commonly engineered; flag them, citing no code section. */
export function wallChecks(project: Project): CodeCheck[] {
  return (project.site?.retainingWalls ?? [])
    .filter((w) => w.height > 48)
    .map((w) => ({
      rule: 'Tall retaining wall',
      section: 'Local permit',
      status: 'info' as const,
      message: `${formatFtIn(w.height)} exposed — walls this tall usually need an engineered design and a permit; check with your building department and the block maker's charts`,
      targetId: w.id,
    }));
}

// ---------- planting beds ----------

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
 * Triangular-grid planting positions inside a bed at `spacing` on centre, kept
 * half a spacing in from the edge (so mature plants fill the bed, not the lawn).
 * The grid is offset to centre the pattern in the bed's bounding box.
 */
export function bedFillPoints(bed: Point[], spacing: number): Point[] {
  if (bed.length < 3 || !(spacing > 0)) return [];
  const xs = bed.map((p) => p.x);
  const ys = bed.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const row = (spacing * Math.sqrt(3)) / 2;
  const inset = spacing / 2 - 1e-6;
  const rows = Math.floor((y1 - y0 - 2 * inset) / row);
  const cols = Math.floor((x1 - x0 - 2 * inset) / spacing);
  const oy = y0 + (y1 - y0 - Math.max(0, rows) * row) / 2;
  const ox = x0 + (x1 - x0 - Math.max(0, cols) * spacing) / 2;
  const out: Point[] = [];
  for (let r = 0; oy + r * row <= y1; r++) {
    const shift = r % 2 ? spacing / 2 : 0;
    for (let c = -1; ox + c * spacing + shift <= x1; c++) {
      const p = { x: ox + c * spacing + shift, y: oy + r * row };
      if (pointInPolygon(p, bed) && distToEdges(p, bed) >= inset) out.push(p);
    }
  }
  if (!out.length) {
    // Bed narrower than one plant: one in the middle if it fits at all.
    const c = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    if (pointInPolygon(c, bed)) out.push(c);
  }
  return out;
}

/** Plants for a bed fill (`makeId` supplies ids so tests stay deterministic). */
export function fillBed(area: SiteArea, species: string, makeId: () => string): Plant[] {
  const sp = PLANT_BY_ID.get(species);
  if (!sp) return [];
  return bedFillPoints(area.points, sp.spread * 12).map((at) => ({ id: makeId(), species, at: { x: Math.round(at.x), y: Math.round(at.y) }, bed: area.id }));
}

// ---------- grading (IRC R401.3) ----------

/** R401.3: finished grade falls at least 6" within the first 10 ft out from the foundation. */
export const GRADE_FALL = 6;
export const GRADE_RUN = 120;
/** A spot this close to the house reads as "at the foundation". */
const NEAR = 36;

function nearestOnPolygon(p: Point, pts: Point[]): { at: Point; d: number } {
  let best = { at: pts[0], d: Infinity };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2));
    const q = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    const d = dist(p, q);
    if (d < best.d) best = { at: q, d };
  }
  return best;
}

export interface GradeRun {
  near: SpotGrade;
  far: SpotGrade;
  /** Distances out from the foundation, inches. */
  dNear: number;
  dFar: number;
  /** Fall over the first 10 ft, assuming a uniform slope between the two spots. */
  fall: number;
  ok: boolean;
}

/** Spot distance from the house (outside); Infinity if there is no house, 0 if inside it. */
export function distFromHouse(p: Point, project: Project): { d: number; at: Point | null } {
  let best: { d: number; at: Point | null } = { d: Infinity, at: null };
  for (const pts of footprint(project)) {
    if (pointInPolygon(p, pts)) return { d: 0, at: p };
    const n = nearestOnPolygon(p, pts);
    if (n.d < best.d) best = n;
  }
  return best;
}

/**
 * Pair each spot at the foundation (within 3 ft) with the spot 5–15 ft out on
 * the same side (its nearest house point within 6 ft of the first's) whose
 * distance is closest to 10 ft, and read the fall over the first 10 ft.
 */
export function gradeRuns(project: Project): GradeRun[] {
  const spots = (project.site?.grades ?? []).map((g) => ({ g, ...distFromHouse(g.at, project) })).filter((s) => s.at && s.d > 0 && s.d < Infinity);
  const runs: GradeRun[] = [];
  for (const n of spots.filter((s) => s.d <= NEAR)) {
    const far = spots
      .filter((s) => s.d >= 60 && s.d <= 180 && dist(s.at!, n.at!) <= 72)
      .sort((a, b) => Math.abs(a.d - GRADE_RUN) - Math.abs(b.d - GRADE_RUN))[0];
    if (!far) continue;
    const fall = ((n.g.elev - far.g.elev) * GRADE_RUN) / (far.d - n.d);
    runs.push({ near: n.g, far: far.g, dNear: n.d, dFar: far.d, fall, ok: fall >= GRADE_FALL - 1e-6 });
  }
  return runs;
}

export function gradeChecks(project: Project): CodeCheck[] {
  const grades = project.site?.grades ?? [];
  if (!grades.length) return [];
  const runs = gradeRuns(project);
  if (!runs.length) {
    return [
      {
        rule: 'Grade away from foundation',
        section: 'IRC R401.3',
        status: 'info',
        message: 'add a spot grade within 3 ft of the house and another about 10 ft straight out to check drainage',
      },
    ];
  }
  return runs.map((r) => ({
    rule: 'Grade away from foundation',
    section: 'IRC R401.3',
    status: r.ok ? 'pass' : 'fail',
    message: `falls ${r.fall.toFixed(1)}" over the first 10 ft (spots ${formatFtIn(r.dNear)} and ${formatFtIn(r.dFar)} out); needs at least ${GRADE_FALL}"${r.ok ? '' : ' — or use the section\'s alternatives (swales, drains) where lot lines or walls are in the way'}`,
    targetId: r.near.id,
  }));
}

export function landscapeChecks(project: Project): CodeCheck[] {
  return [...easementChecks(project), ...wallChecks(project), ...gradeChecks(project)];
}
