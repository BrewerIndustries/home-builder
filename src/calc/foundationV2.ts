import { wallLength } from '../model/geometry.ts';
import type { Foundation, FoundationV2, Project, Wall } from '../model/types.ts';
import type { CodeCheck } from './irc.ts';
import type { MaterialLine } from './materials.ts';

// Foundation v2: interior bearing footings, pier pads with a rebar allowance,
// basement walls (drainage, coating, foam, window wells, slab floor) and the
// inputs for the Table R403.1 footing look-up. Every v2 field is optional and
// adds nothing when unset, so plans saved before v2 give the same takeoff and
// checks. Sizes are the user's; the soil/storey table is NOT built in — the
// check only reminds the user to look the width up. Inches throughout.

const CUYD = 46656;
const SQFT = 144;
const ceil = (n: number) => Math.ceil(n - 1e-9);
const quarterYards = (cuin: number) => ceil((cuin / CUYD) * 4) / 4;

export const DEFAULT_BASEMENT_HEIGHT = 96;
export const DEFAULT_PIER_PAD = 24;
export const DEFAULT_PIER_PAD_THICKNESS = 10;
/** Concrete cover each side of a pad's bars (allowance). */
const PAD_COVER = 3;

export const v2Of = (f: Foundation): FoundationV2 => f.v2 ?? {};

/** Height of the perimeter wall on the footing: the crawlspace stem or the basement wall. */
export function foundationWallHeight(f: Foundation): number {
  return f.type === 'basement' ? (v2Of(f).basementHeight ?? DEFAULT_BASEMENT_HEIGHT) : f.stemHeight;
}

export function pierPadSize(f: Foundation): { side: number; thickness: number } {
  const v = v2Of(f);
  return { side: v.pierPad ?? DEFAULT_PIER_PAD, thickness: v.pierPadThickness ?? DEFAULT_PIER_PAD_THICKNESS };
}

/** Interior walls marked as bearing on their own footing (exterior walls are already on the perimeter footing). */
export function bearingWalls(project: Project, f: Foundation): Wall[] {
  const ids = new Set(v2Of(f).bearingWalls ?? []);
  if (!ids.size || f.type === 'none') return [];
  return project.walls.filter((w) => ids.has(w.id) && w.kind === 'interior' && wallLength(w) > 0.5);
}

export function interiorFootingSize(f: Foundation): { width: number; thickness: number } {
  const v = v2Of(f);
  return { width: v.interiorFootingWidth ?? f.footingWidth, thickness: v.interiorFootingThickness ?? f.footingThickness };
}

/** Interior bearing footings: total run and concrete volume (for a slab, the thickening below the slab). */
export function interiorFootings(project: Project, f: Foundation): { run: number; volume: number; count: number } {
  const ws = bearingWalls(project, f);
  const run = ws.reduce((s, w) => s + wallLength(w), 0);
  const { width, thickness } = interiorFootingSize(f);
  return { run, volume: run * width * thickness, count: ws.length };
}

/** #4 bars in one square pad, each way, as a length. */
export function padRebarLength(f: Foundation): number {
  const bars = v2Of(f).pierBars ?? 0;
  return bars * 2 * Math.max(0, pierPadSize(f).side - 2 * PAD_COVER);
}

/**
 * Basement geometry from the foundation outline (outside face) and its run on the wall line.
 * `belowGrade` is the wall height below finished grade (grade to top of footing).
 */
export function basementGeometry(f: Foundation, perimeter: number, area: number) {
  const t = f.stemThickness;
  const H = foundationWallHeight(f);
  const run = perimeter - 4 * t;
  // Inside the wall ring (rectilinear outline): A − P·t + 4t².
  const slabArea = Math.max(0, area - perimeter * t + 4 * t * t);
  const belowGrade = Math.min(H, Math.max(0, f.footingDepth - f.footingThickness));
  return { H, run, slabArea, belowGrade };
}

/** v2 takeoff lines. `perimeter` / `area` are the foundation outline's (FoundationCalc). */
export function foundationV2Lines(project: Project, f: Foundation, perimeter: number, area: number, waste: number): MaterialLine[] {
  const lines: MaterialLine[] = [];
  const add = (item: string, qty: number, unit: string, basis: string) => qty > 0 && lines.push({ category: 'Foundation', item, qty, unit, basis });
  const v = v2Of(f);

  const inner = interiorFootings(project, f);
  if (inner.count) {
    const { width, thickness } = interiorFootingSize(f);
    const lf = inner.run / 12;
    add(
      'Concrete, interior bearing footings',
      quarterYards(inner.volume * 1.05),
      'yd³',
      f.type === 'slab'
        ? `${width}" wide, ${thickness}" below the slab under ${inner.count} bearing wall${inner.count > 1 ? 's' : ''}, ${Math.round(lf)} LF, +5%`
        : `${width}" × ${thickness}" under ${inner.count} bearing wall${inner.count > 1 ? 's' : ''}, ${Math.round(lf)} LF, +5% — the post / pier line above it is not counted`,
    );
    add('#4 rebar, 20\' (interior footings)', ceil((lf * 2 * 1.1) / 20), 'ea', '2 continuous bars per bearing footing, +10% laps (allowance)');
  }

  if (f.type === 'basement') {
    const g = basementGeometry(f, perimeter, area);
    const sf = g.slabArea / SQFT;
    add('Concrete, basement slab', quarterYards(g.slabArea * f.slabThickness * 1.05), 'yd³', `${f.slabThickness}" slab over ${Math.round(sf)} sq ft inside the walls, +5%`);
    add('Base gravel, 4" (basement)', ceil(((g.slabArea * 4) / CUYD) * 1.4 * 1.1 * 10) / 10, 'tons', '4" base course under the slab (R506.2.2), 1.4 t/yd³, +10% compaction');
    add('6-mil poly vapor retarder, 10×100 (basement)', ceil((sf * 1.1) / 1000), 'rolls', `${Math.round(sf)} sq ft +10% laps (R506.2.3)`);
    const outLf = perimeter / 12;
    const belowSf = (perimeter * g.belowGrade) / SQFT;
    if (v.footingDrain) {
      // Pipe runs round the outside of the footing.
      const drainLf = (perimeter + 4 * Math.max(0, f.footingWidth - f.stemThickness)) / 12;
      add('4" perforated drain pipe, 10\'', ceil((drainLf * 1.05) / 10), 'ea', `${Math.round(drainLf)} LF round the footing (R405.1), +5% — plus a run to daylight or a sump`);
      add('Drain gravel', ceil(((drainLf * SQFT) / CUYD) * 1.4 * 10) / 10, 'tons', 'allowance: a 12" × 12" bed round the pipe, 1.4 t/yd³ — size it to your drainage detail');
      add('Filter fabric, 3\' × 100\' roll', ceil(drainLf / 100), 'rolls', `${Math.round(drainLf)} LF of drain wrapped`);
    }
    if (v.wallCoating && v.wallCoating !== 'none' && belowSf > 0) {
      add(
        v.wallCoating === 'waterproof' ? 'Foundation waterproofing membrane' : 'Foundation dampproofing',
        Math.ceil(belowSf * 1.1),
        'sq ft',
        `${Math.round(outLf)} LF × ${Math.round(g.belowGrade)}" below grade, outside face +10% (R406) — check the product's coverage`,
      );
    }
    if (v.wallFoam && v.wallFoam > 0) {
      const sq = ((v.foamSide === 'exterior' ? perimeter : g.run) * g.H) / SQFT;
      add(`${v.wallFoam}" rigid foam board, 4×8`, ceil((sq * (1 + waste)) / 32), 'sheets', `${Math.round(sq)} sq ft of basement wall, ${v.foamSide === 'exterior' ? 'outside' : 'inside'} face +${Math.round(waste * 100)}%`);
    }
    const w = v.wells;
    if (w && w.count > 0) {
      add(`Window well, ${w.width}" × ${w.projection}" × ${w.depth}" deep`, w.count, 'ea', 'basement window wells, with cover and a drain to the footing drain');
      add('Window well gravel', ceil(((w.count * w.width * w.projection * 6) / CUYD) * 1.4 * 10) / 10, 'tons', 'allowance: 6" of gravel in the bottom of each well');
    }
  }
  return lines;
}

/** Concrete and rebar for the pier pads under the girder posts (floor over a crawlspace or basement). */
export function pierPadLines(f: Foundation, piers: number): MaterialLine[] {
  const lines: MaterialLine[] = [];
  if (!piers) return lines;
  const { side, thickness } = pierPadSize(f);
  lines.push({ category: 'Floor', item: `Concrete, pier footings ${side}×${side}×${thickness}`, qty: Math.ceil(((piers * side * side * thickness) / CUYD) * 1.1 * 4) / 4, unit: 'yd³', basis: `${piers} pads +10%` });
  const bars = v2Of(f).pierBars ?? 0;
  const len = padRebarLength(f);
  if (bars && len) {
    lines.push({ category: 'Floor', item: '#4 rebar, 20\' (pier pads)', qty: ceil((piers * len * 1.1) / 240), unit: 'ea', basis: `allowance: ${bars} bar${bars > 1 ? 's' : ''} each way per pad, ${PAD_COVER}" cover, +10%` });
  }
  return lines;
}

/** v2 checks: only when the user has filled in the matching v2 inputs. */
export function foundationV2Checks(project: Project, f: Foundation): CodeCheck[] {
  const v = v2Of(f);
  const out: CodeCheck[] = [];
  if (f.type === 'none') return out;
  if (v.soilBearing !== undefined || v.storeys !== undefined) {
    const width = f.type === 'slab' ? f.edgeWidth : f.footingWidth;
    const soil = v.soilBearing !== undefined ? `${v.soilBearing.toLocaleString()} psf soil` : 'soil bearing not entered';
    const storeys = v.storeys !== undefined ? `${v.storeys} storey${v.storeys > 1 ? 's' : ''}` : 'storeys not entered';
    out.push({
      rule: 'Footing width for soil and storeys',
      section: 'R403.1',
      status: 'info',
      message: `${width}" footing, ${storeys}, ${soil} — look the minimum width up in Table R403.1 (by construction type) and confirm with your building department; the table is not built in`,
    });
  }
  const inner = interiorFootings(project, f);
  if (inner.count) {
    const { width, thickness } = interiorFootingSize(f);
    const small = width < 12 || thickness < 6;
    out.push({
      rule: 'Interior bearing footing',
      section: 'R403.1.1',
      status: small ? 'fail' : 'info',
      message: small
        ? `interior bearing footings must be at least 12" wide and 6" thick (this is ${width}" × ${thickness}")`
        : `${width}" × ${thickness}" under ${inner.count} bearing wall${inner.count > 1 ? 's' : ''} — size it for the load it carries with Table R403.1`,
    });
  }
  if (f.type === 'crawl' || f.type === 'basement') {
    const { side, thickness } = pierPadSize(f);
    if (v.pierPad !== undefined || v.pierPadThickness !== undefined) {
      const small = side < 12 || thickness < 6;
      out.push({
        rule: 'Pier pad size',
        section: 'R403.1.1',
        status: small ? 'fail' : 'info',
        message: small ? `pier pads must be at least 12" wide and 6" thick (this is ${side}" × ${thickness}")` : `${side}" × ${side}" × ${thickness}" pads — size them for the girder load and your soil`,
      });
    }
  }
  if (f.type === 'basement') {
    const w = v.wells;
    if (w && w.count > 0) {
      const short = w.width * w.projection < 9 * SQFT || w.width < 36 || w.projection < 36;
      out.push({
        rule: 'Window well size',
        section: 'R310',
        status: short ? 'warn' : 'pass',
        message: short
          ? `a well at an emergency escape opening needs 9 sq ft of floor area and at least 36" each way (this is ${w.width}" × ${w.projection}")`
          : `${w.width}" × ${w.projection}" well meets the 9 sq ft / 36" minimum for an escape opening`,
      });
      if (w.depth > 44) out.push({ rule: 'Window well ladder', section: 'R310', status: 'info', message: `a well deeper than 44" (this is ${w.depth}") needs a permanently fixed ladder or steps` });
    }
  }
  return out;
}
