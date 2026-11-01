import { PLANT_BY_ID } from '../data/plants.ts';
import { dist, pointInPolygon, polygonArea } from '../model/geometry.ts';
import { EMPTY_SITE, type Point, type Project, type SurfaceMaterial } from '../model/types.ts';
import { formatFtIn } from '../model/units.ts';
import type { CodeCheck } from './irc.ts';
import type { MaterialLine } from './materials.ts';
import { childRooms } from './regions.ts';

// Site plan: lot, setbacks, coverage, hardscape / planting takeoffs and plant checks.
// Site shares the floor plan's coordinate space, so the house sits where it was drawn.

export const SQFT = 144;
const CUYD = 46656; // cubic inches per cubic yard
/** Round up, forgiving float noise (100 × 1.1 = 110.00000000000001). */
const ceil = (n: number) => Math.ceil(n - 1e-9);

/** Typical installed depth per material, inches (concrete slab, gravel, mulch). */
export const DEFAULT_DEPTH: Record<SurfaceMaterial, number> = { pavers: 0, concrete: 4, gravel: 3, mulch: 3, sod: 0, decking: 0 };

export const MATERIAL_LABEL: Record<SurfaceMaterial, string> = {
  pavers: 'Pavers',
  concrete: 'Concrete',
  gravel: 'Gravel',
  mulch: 'Mulch bed',
  sod: 'Sod',
  decking: 'Deck',
};

/** Surfaces water can't soak through — they count toward impervious cover. */
export const IMPERVIOUS: ReadonlySet<SurfaceMaterial> = new Set(['pavers', 'concrete']);

function signedArea(pts: Point[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) s += pts[i].x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * pts[i].y;
  return s / 2;
}

/**
 * Shrink a polygon by a per-edge distance (edge i = pts[i] → pts[i+1]). Exact for
 * convex lots; a reasonable approximation for gently concave ones.
 */
export function insetPolygon(pts: Point[], d: number[]): Point[] {
  const n = pts.length;
  if (n < 3) return [];
  const cw = signedArea(pts) > 0; // y-down: positive = clockwise on screen
  const lines = pts.map((a, i) => {
    const b = pts[(i + 1) % n];
    const len = dist(a, b) || 1;
    const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    // Left-hand normal points outward for clockwise polygons.
    const out = cw ? { x: dir.y, y: -dir.x } : { x: -dir.y, y: dir.x };
    const off = d[i] ?? 0;
    return { p: { x: a.x - out.x * off, y: a.y - out.y * off }, dir };
  });
  const result: Point[] = [];
  for (let i = 0; i < n; i++) {
    const L1 = lines[(i - 1 + n) % n];
    const L2 = lines[i];
    const den = L1.dir.x * L2.dir.y - L1.dir.y * L2.dir.x;
    if (Math.abs(den) < 1e-9) {
      result.push(L2.p);
      continue;
    }
    const t = ((L2.p.x - L1.p.x) * L2.dir.y - (L2.p.y - L1.p.y) * L2.dir.x) / den;
    result.push({ x: L1.p.x + L1.dir.x * t, y: L1.p.y + L1.dir.y * t });
  }
  // A setback larger than the lot flips edges around (an inside-out envelope).
  const flipped = result.some((a, i) => {
    const b = result[(i + 1) % n];
    return (b.x - a.x) * lines[i].dir.x + (b.y - a.y) * lines[i].dir.y <= 0;
  });
  return flipped ? [] : result;
}

/** The house footprint: outermost rooms, else the exterior walls' outer bounding box. */
export function footprint(project: Project): Point[][] {
  const outer = project.rooms.filter((r) => !project.rooms.some((o) => o !== r && childRooms(project, o).includes(r)));
  if (outer.length) return outer.map((r) => r.points);
  const ext = project.walls.filter((w) => w.kind === 'exterior');
  if (!ext.length) return [];
  const t = Math.max(...ext.map((w) => w.thickness)) / 2;
  const xs = ext.flatMap((w) => [w.a.x, w.b.x]);
  const ys = ext.flatMap((w) => [w.a.y, w.b.y]);
  const [x0, x1, y0, y1] = [Math.min(...xs) - t, Math.max(...xs) + t, Math.min(...ys) - t, Math.max(...ys) + t];
  return [[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]];
}

/** Outside corners of the house, wall thickness included — what setbacks measure to. */
export function houseCorners(project: Project): Point[] {
  const ext = project.walls.filter((w) => w.kind === 'exterior');
  const out: Point[] = [];
  for (const w of ext) {
    const t = w.thickness / 2;
    for (const p of [w.a, w.b]) for (const [dx, dy] of [[-t, -t], [t, -t], [t, t], [-t, t]]) out.push({ x: p.x + dx, y: p.y + dy });
  }
  return out;
}

export interface SiteSummary {
  lotArea: number;
  buildable: Point[];
  footprintArea: number;
  hardscape: Record<SurfaceMaterial, number>;
  coverage: number;
  impervious: number;
}

export function siteSummary(project: Project): SiteSummary {
  const site = project.site ?? EMPTY_SITE;
  const lotArea = site.lot ? polygonArea(site.lot) : 0;
  const fp = footprint(project).reduce((s, pts) => s + polygonArea(pts), 0);
  const hardscape = { pavers: 0, concrete: 0, gravel: 0, mulch: 0, sod: 0, decking: 0 };
  for (const a of site.areas) hardscape[a.material] += polygonArea(a.points);
  const imperv = fp + hardscape.pavers + hardscape.concrete + hardscape.decking;
  return {
    lotArea,
    buildable: site.lot ? insetPolygon(site.lot, site.setbacks) : [],
    footprintArea: fp,
    hardscape,
    coverage: lotArea ? fp / lotArea : 0,
    impervious: lotArea ? imperv / lotArea : 0,
  };
}

/** Landscape lines for the materials list / estimate. */
export function siteLines(project: Project, waste: number): MaterialLine[] {
  const site = project.site ?? EMPTY_SITE;
  const lines: MaterialLine[] = [];
  const w = 1 + waste;
  const add = (item: string, qty: number, unit: string, basis: string) =>
    qty > 0 && lines.push({ category: 'Landscape', item, qty, unit, basis });
  const sum = (m: SurfaceMaterial, f: (a: (typeof site.areas)[number]) => number) => site.areas.filter((a) => a.material === m).reduce((s, a) => s + f(a), 0);
  const area = (m: SurfaceMaterial) => sum(m, (a) => polygonArea(a.points));
  const perimeter = (m: SurfaceMaterial) => sum(m, (a) => a.points.reduce((s, p, i) => s + dist(p, a.points[(i + 1) % a.points.length]), 0));
  const volume = (m: SurfaceMaterial) => sum(m, (a) => polygonArea(a.points) * a.depth);

  const pav = area('pavers');
  if (pav) {
    const sf = pav / SQFT;
    add('Pavers', ceil(sf * w), 'sq ft', `${Math.round(sf)} sq ft +${Math.round(waste * 100)}% cuts`);
    // 6" compacted base + 1" bedding sand under pavers.
    add('Paver base gravel', ceil(((pav * 6) / CUYD) * 1.4 * 1.15 * 10) / 10, 'tons', `6" base, 1.4 t/yd³, +15% compaction`);
    add('Bedding sand', ceil(((pav * 1) / CUYD) * 1.35 * 10) / 10, 'tons', '1" screed, 1.35 t/yd³');
    add('Polymeric joint sand', ceil(sf / 60), 'bags', '~60 sq ft per bag');
    add('Paver edge restraint', ceil(perimeter('pavers') / 12), 'LF', 'area perimeter');
  }
  const conc = volume('concrete');
  if (conc) add('Concrete', ceil((conc / CUYD) * 1.1 * 4) / 4, 'yd³', 'slab depth × area +10%, ordered in ¼ yd');
  const grav = volume('gravel');
  if (grav) {
    add('Decorative gravel', ceil((grav / CUYD) * 1.4 * 10) / 10, 'tons', 'depth × area, 1.4 t/yd³');
    add('Landscape fabric', ceil((area('gravel') / SQFT) * 1.1), 'sq ft', 'under gravel +10% overlap');
  }
  const mulch = volume('mulch');
  if (mulch) add('Hardwood mulch', ceil((mulch / CUYD) * 1.05 * 2) / 2, 'yd³', 'depth × bed area +5%');
  const sod = area('sod');
  if (sod) add('Sod', ceil((sod / SQFT) * 1.05 / 450), 'pallets', `${Math.round(sod / SQFT)} sq ft, 450 sq ft per pallet +5%`);
  const deck = area('decking');
  if (deck) add('Decking (area)', ceil((deck / SQFT) * w), 'sq ft', 'framing not yet taken off');

  const counts = new Map<string, number>();
  for (const p of site.plants) counts.set(p.species, (counts.get(p.species) ?? 0) + 1);
  for (const [id, n] of [...counts].sort()) {
    const sp = PLANT_BY_ID.get(id);
    if (sp) add(`${sp.name} (${sp.form})`, n, 'ea', sp.botanical);
  }
  return lines;
}

/** Zoning-ish and horticultural checks. Setbacks are local zoning, not IRC. */
export function siteChecks(project: Project): CodeCheck[] {
  const site = project.site ?? EMPTY_SITE;
  const checks: CodeCheck[] = [];
  const s = siteSummary(project);
  if (site.lot) {
    const corners = houseCorners(project);
    if (corners.length) {
      const env = s.buildable;
      const outside = env.length ? corners.filter((p) => !pointInPolygon(p, env)) : corners;
      checks.push({
        rule: 'House within setbacks',
        section: 'Local zoning',
        status: outside.length ? 'fail' : 'pass',
        message: outside.length ? `${env.length ? 'part of the house is outside' : 'setbacks leave no'} buildable area — check the dashed envelope on the Site tab` : 'every exterior corner is inside the buildable envelope',
        targetId: 'lot',
      });
    }
    checks.push({
      rule: 'Lot coverage / impervious cover',
      section: 'Local zoning',
      status: 'info',
      message: `building ${(s.coverage * 100).toFixed(1)}% · impervious ${(s.impervious * 100).toFixed(1)}% of ${Math.round(s.lotArea / SQFT).toLocaleString()} sq ft lot — compare with your zoning limits`,
    });
  }
  const fps = footprint(project);
  for (const p of site.plants) {
    const sp = PLANT_BY_ID.get(p.species);
    if (!sp) continue;
    const r = (sp.spread * 12) / 2;
    if (site.zone && (site.zone < sp.zones[0] || site.zone > sp.zones[1])) {
      checks.push({ rule: 'Hardiness zone', section: 'Planting', status: 'warn', message: `${sp.name} is rated for zones ${sp.zones[0]}–${sp.zones[1]}; the site is zone ${site.zone}`, targetId: p.id });
    }
    const toHouse = Math.min(...fps.map((pts) => distToPolygon(p.at, pts)));
    // Trees: keep the trunk at least half the mature spread (min 10 ft) from the house.
    const need = sp.form === 'tree' ? Math.max(120, r) : r * 0.75;
    if (fps.length && toHouse < need) {
      checks.push({
        rule: sp.form === 'tree' ? 'Tree too close to the foundation' : 'Planting crowds the house',
        section: 'Planting',
        status: 'warn',
        message: `${sp.name} is ${formatFtIn(toHouse)} from the house; at maturity it wants ${formatFtIn(need)}`,
        targetId: p.id,
      });
    }
  }
  // Crowding between plants at maturity.
  for (let i = 0; i < site.plants.length; i++) {
    for (let j = i + 1; j < site.plants.length; j++) {
      const a = site.plants[i];
      const b = site.plants[j];
      const sa = PLANT_BY_ID.get(a.species);
      const sb = PLANT_BY_ID.get(b.species);
      if (!sa || !sb) continue;
      const need = ((sa.spread + sb.spread) * 12) / 2;
      // Massed shrubs/perennials touching is fine; flag real overlap.
      if (dist(a.at, b.at) < need * 0.6) {
        checks.push({ rule: 'Plants overlap at maturity', section: 'Planting', status: 'info', message: `${sa.name} and ${sb.name} are ${formatFtIn(dist(a.at, b.at))} apart; mature spreads need ~${formatFtIn(need)}`, targetId: b.id });
      }
    }
  }
  return checks;
}

/** Distance from p to a polygon (0 if inside). */
export function distToPolygon(p: Point, pts: Point[]): number {
  if (pointInPolygon(p, pts)) return 0;
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
