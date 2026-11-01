import { polygonArea, wallLength } from '../model/geometry.ts';
import { DEFAULT_FOUNDATION, type Foundation, type Project } from '../model/types.ts';
import type { CodeCheck } from './irc.ts';
import type { MaterialLine } from './materials.ts';
import { childRooms } from './regions.ts';

// Foundation under the exterior walls: monolithic slab with a thickened edge, or
// spread footing + stem wall around a crawlspace. Sizes are the user's inputs;
// the IRC checks below test only the code minimums, not soil bearing (Table R403.1).

const CUYD = 46656;
const SQFT = 144;
/** Round up, forgiving float noise. */
const ceil = (n: number) => Math.ceil(n - 1e-9);
const quarterYards = (cuin: number) => ceil((cuin / CUYD) * 4) / 4;

export function foundationOf(project: Project): Foundation {
  return { ...DEFAULT_FOUNDATION, ...project.foundation };
}

export interface FoundationCalc {
  f: Foundation;
  /** Outside face of the exterior walls. */
  perimeter: number;
  /** Area inside that outline. */
  area: number;
  /** Anchor bolts, laid out per exterior wall (R403.1.6). */
  anchorBolts: number;
}

/**
 * Footprint from the wall centrelines grown by half a wall thickness. For a
 * rectilinear outline that's area + perimeter·t/2 + t² and perimeter + 4t.
 */
export function foundationCalc(project: Project): FoundationCalc | null {
  const f = foundationOf(project);
  const ext = project.walls.filter((w) => w.kind === 'exterior');
  if (f.type === 'none' || !ext.length) return null;
  const t = Math.max(...ext.map((w) => w.thickness));
  const P = ext.reduce((s, w) => s + wallLength(w), 0);
  const outer = project.rooms.filter((r) => !project.rooms.some((o) => o !== r && childRooms(project, o).includes(r)));
  let A: number;
  if (outer.length) A = outer.reduce((s, r) => s + polygonArea(r.points), 0);
  else {
    const xs = ext.flatMap((w) => [w.a.x, w.b.x]);
    const ys = ext.flatMap((w) => [w.a.y, w.b.y]);
    A = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  }
  // 1/2" bolts at most 6 ft apart, one within 12" of each end, at least two per plate.
  const anchorBolts = ext.reduce((s, w) => s + Math.max(2, ceil((wallLength(w) - 24) / 72) + 1), 0);
  return { f, perimeter: P + 4 * t, area: A + (P * t) / 2 + t * t, anchorBolts };
}

export interface FoundationVolumes {
  slab: number;
  edge: number;
  footing: number;
  stem: number;
}

export function foundationVolumes(c: FoundationCalc): FoundationVolumes {
  const { f } = c;
  if (f.type === 'slab') {
    return { slab: c.area * f.slabThickness, edge: c.perimeter * f.edgeWidth * Math.max(0, f.edgeDepth - f.slabThickness), footing: 0, stem: 0 };
  }
  // Footing and stem run on the wall line: outer perimeter less the stem's own corners.
  const run = c.perimeter - 4 * f.stemThickness;
  return { slab: 0, edge: 0, footing: run * f.footingWidth * f.footingThickness, stem: run * f.stemThickness * f.stemHeight };
}

export function foundationLines(project: Project, waste: number): MaterialLine[] {
  const c = foundationCalc(project);
  if (!c) return [];
  const { f } = c;
  const v = foundationVolumes(c);
  const lines: MaterialLine[] = [];
  const add = (item: string, qty: number, unit: string, basis: string) => qty > 0 && lines.push({ category: 'Foundation', item, qty, unit, basis });
  const sf = c.area / SQFT;
  const lf = c.perimeter / 12;

  if (f.type === 'slab') {
    add('Concrete, slab + thickened edge', quarterYards((v.slab + v.edge) * 1.05), 'yd³', `${f.slabThickness}" slab over ${Math.round(sf)} sq ft + ${f.edgeWidth}" × ${f.edgeDepth}" edge, +5%`);
    add('Base gravel, 4"', ceil(((c.area * 4) / CUYD) * 1.4 * 1.1 * 10) / 10, 'tons', '4" base course (R506.2.2), 1.4 t/yd³, +10% compaction');
    add('6-mil poly vapor retarder, 10×100', ceil((sf * 1.1) / 1000), 'rolls', `${Math.round(sf)} sq ft +10% laps (R506.2.3)`);
    add('Welded wire mesh, 8×20 sheet', ceil((sf * 1.1) / 160), 'sheets', `${Math.round(sf)} sq ft +10% laps`);
    add('#4 rebar, 20\'', ceil((lf * 2 * 1.1) / 20), 'ea', '2 continuous bars in the thickened edge, +10% laps');
    add("2x12 edge form, 16'", ceil(lf / 16), 'ea', `${Math.round(lf)} LF of slab edge (reusable)`);
  } else {
    const run = (c.perimeter - 4 * f.stemThickness) / 12;
    add('Concrete, footings', quarterYards(v.footing * 1.05), 'yd³', `${f.footingWidth}" × ${f.footingThickness}" × ${Math.round(run)} LF, +5%`);
    if (f.stemMaterial === 'poured') {
      add('Concrete, stem wall', quarterYards(v.stem * 1.05), 'yd³', `${f.stemThickness}" × ${f.stemHeight}" × ${Math.round(run)} LF, +5%`);
    } else {
      // 8×8×16 block: 1.125 per sq ft of wall face.
      const blocks = ceil(((run * f.stemHeight) / 12) * 1.125 * (1 + waste));
      add('8×8×16 concrete block', blocks, 'ea', `${Math.round((run * f.stemHeight) / 12)} sq ft of stem wall, 1.125 per sq ft ${`+${Math.round(waste * 100)}%`}`);
      add('Type S mortar, 80 lb', ceil(blocks / 30), 'bags', '~30 blocks per bag');
    }
    add('#4 rebar, 20\'', ceil((run * 2 * 1.1) / 20), 'ea', '2 continuous bars in the footing, +10% laps');
    add('6-mil poly ground cover, 10×100', ceil((sf * 1.15) / 1000), 'rolls', `${Math.round(sf)} sq ft crawlspace floor +15% up the walls`);
    // R408.1: 1 sq ft of net vent area per 150 sq ft of crawlspace.
    add('Foundation vent, 8×16 (~50 sq in net)', ceil(((sf / 150) * SQFT) / 50), 'ea', `${(sf / 150).toFixed(1)} sq ft net free area (R408.1) — check the vent's rating`);
  }
  add('1/2" × 10" anchor bolt, nut + washer', c.anchorBolts, 'ea', 'per wall: ≤ 6 ft o.c., one within 12" of each end (R403.1.6)');
  const sill = project.framing.exteriorStud;
  add(`${sill} pressure-treated sill plate, 16'`, ceil((lf * (1 + waste)) / 16), 'ea', `${Math.round(lf)} LF of foundation`);
  add('Sill seal gasket, 50\' roll', ceil(lf / 50), 'rolls', `${Math.round(lf)} LF`);
  return lines;
}

/** Numeric minimums from IRC Chapters 4–5. Footing size for soil and storeys (Table R403.1) is not checked. */
export function foundationChecks(project: Project): CodeCheck[] {
  const c = foundationCalc(project);
  if (!c) return [];
  const { f } = c;
  const out: CodeCheck[] = [];
  if (f.type === 'slab') {
    out.push({
      rule: 'Slab thickness',
      section: 'R506.1',
      status: f.slabThickness < 3.5 ? 'fail' : 'pass',
      message: f.slabThickness < 3.5 ? `${f.slabThickness}" is under the 3-1/2" minimum for a floor slab` : `${f.slabThickness}" slab`,
    });
  }
  const w = f.type === 'slab' ? f.edgeWidth : f.footingWidth;
  const th = f.type === 'slab' ? f.edgeDepth - f.slabThickness : f.footingThickness;
  out.push({
    rule: 'Footing size',
    section: 'R403.1.1',
    status: w < 12 || th < 6 ? 'fail' : 'info',
    message:
      w < 12 || th < 6
        ? `footings must be at least 12" wide and 6" thick (this is ${w}" × ${th}")`
        : `${w}" × ${th}" meets the 12" × 6" floor — size it for your soil and storeys with Table R403.1`,
  });
  out.push(
    f.frostDepth === undefined
      ? { rule: 'Frost depth', section: 'R403.1.4.1', status: 'info', message: 'enter your local frost depth (Foundation, Plan tab) to check footing depth' }
      : {
          rule: 'Frost depth',
          section: 'R403.1.4.1',
          status: f.footingDepth < f.frostDepth ? 'fail' : 'pass',
          message:
            f.footingDepth < f.frostDepth
              ? `footing bottom ${f.footingDepth}" below grade is above the ${f.frostDepth}" frost depth`
              : `footing bottom ${f.footingDepth}" below grade clears the ${f.frostDepth}" frost depth`,
        },
  );
  if (f.footingDepth < 12) {
    out.push({ rule: 'Footing below grade', section: 'R403.1.4', status: 'fail', message: `exterior footings go at least 12" below undisturbed ground (this is ${f.footingDepth}")` });
  }
  return out;
}
