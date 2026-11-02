import { polygonArea, wallLength } from '../model/geometry.ts';
import { studFor, type LumberSize, type Point, type Project } from '../model/types.ts';
import { ceilingInfo } from './ceilings.ts';
import { exclusiveArea, totalFloorArea } from './regions.ts';
import { roomCeiling } from './model3d.ts';
import { roofCalc, roofLines, stockFeet } from './roof.ts';
import { siteLines } from './site.ts';
import { foundationLines } from './foundation.ts';
import { floorLines } from './floor.ts';
import { framingTakeoff, type FramingTakeoff, type HeaderSize } from './framing.ts';

// Materials list: the framing takeoff turned into things you buy, plus the
// area-driven sheet goods. Waste is applied here, once, to purchase quantities.

export interface MaterialLine {
  category: 'Lumber' | 'Sheathing' | 'Drywall' | 'Insulation & wrap' | 'Electrical' | 'Openings' | 'Foundation' | 'Floor' | 'Roof' | 'Landscape';
  item: string;
  qty: number;
  unit: string;
  /** How the number was reached, shown in the UI. */
  basis: string;
}

const SHEET_SQFT = 32; // 4×8
const PLATE_STOCK = 16 * 12; // plates bought as 16' boards
const HEADER_STOCK = 12 * 12; // header stock as 12' boards
const WRAP_ROLL_SQFT = 9 * 100;
/** Common fiberglass batt for each cavity depth. */
const BATT_R: Record<LumberSize, string> = { '2x4': 'R-13', '2x6': 'R-21', '2x8': 'R-30' };

/** Studs are bought as precuts when the wall height matches one, otherwise the next stock length up. */
export function studStock(studLength: number): string {
  const precuts: [number, string][] = [
    [92.625, '92-5/8" precut'],
    [104.625, '104-5/8" precut'],
    [116.625, '116-5/8" precut'],
  ];
  for (const [len, label] of precuts) if (studLength <= len && studLength > len - 1.5) return label;
  for (const ft of [8, 10, 12, 14, 16, 18, 20]) if (studLength <= ft * 12) return `${ft}'`;
  return `${Math.ceil(studLength / 12)}' (special order)`;
}

export interface WallAreas {
  /** Exterior walls, one face, openings removed (sq ft). */
  exteriorNet: number;
  /** Exterior net area split by stud size, for insulation (sq ft). */
  exteriorByStud: Partial<Record<LumberSize, number>>;
  /** Extra framing for tray steps and coffer beams (LF). */
  ceilingBeams: number;
  /** All wall faces that get drywall, openings removed (sq ft). */
  drywallWalls: number;
  /** Ceiling area from rooms (sq ft). */
  ceilings: number;
  /** Floor area from rooms (sq ft). */
  floor: number;
}

export function wallAreas(project: Project): WallAreas {
  const openingArea = new Map<string, number>();
  for (const o of project.openings) openingArea.set(o.wallId, (openingArea.get(o.wallId) ?? 0) + o.width * o.height);
  let exteriorNet = 0;
  let drywallWalls = 0;
  const exteriorByStud: WallAreas['exteriorByStud'] = {};
  for (const w of project.walls) {
    const net = Math.max(0, wallLength(w) * w.height - (openingArea.get(w.id) ?? 0)) / 144;
    if (w.kind === 'exterior') {
      exteriorNet += net;
      const size = studFor(w, project.framing);
      exteriorByStud[size] = (exteriorByStud[size] ?? 0) + net;
      drywallWalls += net;
    } else {
      drywallWalls += net * 2;
    }
  }
  const floor = totalFloorArea(project) / 144;
  // A nested room's ceiling replaces that part of its parent's.
  let ceilings = 0;
  let ceilingBeams = 0;
  for (const r of project.rooms) {
    const c = ceilingInfo(project, r);
    const own = polygonArea(r.points) ? exclusiveArea(project, r) / polygonArea(r.points) : 0;
    ceilings += (c.surface * own) / 144;
    ceilingBeams += (c.beamLength * own) / 12;
  }
  return { exteriorNet, exteriorByStud, ceilingBeams, drywallWalls, ceilings, floor };
}

export function materialsList(project: Project, takeoff: FramingTakeoff = framingTakeoff(project)): MaterialLine[] {
  const waste = 1 + project.framing.waste;
  const wastePct = `+${Math.round(project.framing.waste * 100)}% waste`;
  const lines: MaterialLine[] = [];

  // Studs, grouped by size and stock length.
  const studs = new Map<string, { size: LumberSize; stock: string; n: number }>();
  for (const f of takeoff.walls) {
    const stock = studStock(f.studLength);
    const key = `${f.studSize}|${stock}`;
    const n = f.common + f.corner + f.king + f.jack + f.cripple;
    const cur = studs.get(key) ?? { size: f.studSize, stock, n: 0 };
    cur.n += n;
    studs.set(key, cur);
  }
  for (const s of studs.values()) {
    lines.push({
      category: 'Lumber',
      item: `${s.size} stud, ${s.stock}`,
      qty: Math.ceil(s.n * waste),
      unit: 'ea',
      basis: `${s.n} studs (commons, corners, kings, jacks, cripples) ${wastePct}`,
    });
  }

  for (const [size, t] of Object.entries(takeoff.totals.byStudSize)) {
    if (!t) continue;
    lines.push({
      category: 'Lumber',
      item: `${size} plate, 16'`,
      qty: Math.ceil((t.plateLength * waste) / PLATE_STOCK),
      unit: 'ea',
      basis: `${Math.round(t.plateLength / 12)} LF (1 bottom + 2 top + window sills) ${wastePct}`,
    });
  }

  for (const [size, len] of Object.entries(takeoff.totals.headerLength) as [HeaderSize, number][]) {
    if (size === 'LVL') {
      lines.push({ category: 'Lumber', item: 'LVL header (engineered)', qty: Math.ceil(len / 12), unit: 'LF', basis: 'needs a span check before ordering' });
      continue;
    }
    lines.push({
      category: 'Lumber',
      item: `${size} header stock, 12'`,
      qty: Math.ceil((len * waste) / HEADER_STOCK),
      unit: 'ea',
      basis: `${Math.round(len / 12)} LF of doubled headers ${wastePct}`,
    });
  }

  const areas = wallAreas(project);
  if (areas.exteriorNet > 0) {
    lines.push({
      category: 'Sheathing',
      item: '7/16" OSB wall sheathing, 4×8',
      qty: Math.ceil((areas.exteriorNet * waste) / SHEET_SQFT),
      unit: 'sheets',
      basis: `${Math.round(areas.exteriorNet)} sq ft exterior wall, net of openings ${wastePct}`,
    });
    lines.push({
      category: 'Insulation & wrap',
      item: '9×100 house wrap',
      qty: Math.ceil((areas.exteriorNet * waste) / WRAP_ROLL_SQFT),
      unit: 'rolls',
      basis: `${Math.round(areas.exteriorNet)} sq ft ${wastePct}`,
    });
    for (const [size, area] of Object.entries(areas.exteriorByStud) as [LumberSize, number][]) {
      lines.push({
        category: 'Insulation & wrap',
        item: `${BATT_R[size]} batts for ${size} exterior walls`,
        qty: Math.ceil(area * waste),
        unit: 'sq ft',
        basis: `${Math.round(area)} sq ft cavity ${wastePct}`,
      });
    }
  }

  const drywall = areas.drywallWalls + areas.ceilings;
  if (drywall > 0) {
    lines.push({
      category: 'Drywall',
      item: '1/2" drywall, 4×8',
      qty: Math.ceil((drywall * waste) / SHEET_SQFT),
      unit: 'sheets',
      basis: `${Math.round(areas.drywallWalls)} sq ft walls + ${Math.round(areas.ceilings)} sq ft ceilings (incl. vaults, trays, coffers) ${wastePct}`,
    });
  }

  if (areas.ceilingBeams > 0) {
    lines.push({
      category: 'Lumber',
      item: '2x lumber for tray steps / coffer beams',
      qty: Math.ceil((areas.ceilingBeams * 3 * waste) / 12),
      unit: "12' boards",
      basis: `${Math.round(areas.ceilingBeams)} LF of beam, ~3 pieces per LF of box ${wastePct}`,
    });
  }

  // Electrical rough-in: devices and boxes from the plan.
  const DEVICE: Record<string, string> = { duplex: '15A duplex receptacle (TR)', gfci: '20A GFCI receptacle (TR)', dedicated: '20A dedicated receptacle', '240v': '240V receptacle' };
  const devices = new Map<string, number>();
  for (const o of project.outlets) devices.set(o.kind, (devices.get(o.kind) ?? 0) + 1);
  for (const [kind, qty] of devices) lines.push({ category: 'Electrical', item: DEVICE[kind], qty, unit: 'ea', basis: 'from the plan' });
  if (project.outlets.length) {
    lines.push({ category: 'Electrical', item: 'Single-gang new-work box', qty: project.outlets.length, unit: 'ea', basis: 'one per receptacle' });
  }

  // Door and window schedule, by kind and nominal size (e.g. 3068 = 3'0" × 6'8").
  const units = new Map<string, number>();
  for (const o of project.openings) {
    const key = `${o.kind === 'door' ? 'Door' : 'Window'} ${sizeCode(o.width)}${sizeCode(o.height)}`;
    units.set(key, (units.get(key) ?? 0) + 1);
  }
  for (const [item, qty] of [...units].sort()) {
    lines.push({ category: 'Openings', item, qty, unit: 'ea', basis: 'from the plan' });
  }

  // Gable-end framing above the plate: vaulted / cathedral room ends, and a
  // rafter-framed roof's gable ends (trusses bring their own gable-end truss).
  for (const [size, g] of gableInfill(project)) {
    const stock = stockFeet(g.height);
    lines.push({
      category: 'Lumber',
      item: `${size} stud, ${stock}'`,
      qty: Math.ceil((g.lf * waste) / (stock * 12)),
      unit: 'ea',
      basis: `gable-end infill above the plate: ${Math.round(g.lf / 12)} LF of studs (${g.sources.join(', ')}) ${wastePct}`,
    });
  }

  lines.unshift(...foundationLines(project, project.framing.waste), ...floorLines(project, project.framing.waste));
  lines.push(...roofLines(project, project.framing.waste));
  lines.push(...siteLines(project, project.framing.waste));

  return lines;
}

/** 36 → "30", 80 → "68": the trade's feet-inches size code. */
export function sizeCode(inches: number): string {
  const ft = Math.floor(inches / 12);
  const inch = Math.round(inches - ft * 12);
  return `${ft}${inch}`;
}

/** Area of a planar 3D polygon (Newell's method). */
function faceArea(pts: [number, number, number][]): number {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1, z1] = pts[i];
    const [x2, y2, z2] = pts[(i + 1) % pts.length];
    nx += (y1 - y2) * (z1 + z2);
    ny += (z1 - z2) * (x1 + x2);
    nz += (x1 - x2) * (y1 + y2);
  }
  return Math.hypot(nx, ny, nz) / 2;
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2));
  return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
}

/** Stud linear feet needed to fill wall above the plate, by stud size. */
export function gableInfill(project: Project): Map<LumberSize, { lf: number; height: number; sources: string[] }> {
  const out = new Map<LumberSize, { lf: number; height: number; sources: string[] }>();
  const spacing = project.framing.studSpacing;
  const add = (size: LumberSize, area: number, height: number, source: string) => {
    const g = out.get(size) ?? { lf: 0, height: 0, sources: [] };
    g.lf += area / spacing;
    g.height = Math.max(g.height, height);
    if (!g.sources.includes(source)) g.sources.push(source);
    out.set(size, g);
  };
  const roof = roofCalc(project);
  // A rafter roof's gable ends already fill the exterior end walls up to the roof.
  const roofGables = !!roof && roof.roof.framing === 'rafters' && roof.gableArea > 0;
  for (const room of project.rooms) {
    for (const f of roomCeiling(project, room).faces) {
      if (f.kind !== 'gable') continue;
      const ys = f.pts.map((p) => p[1]);
      const low = Math.min(...ys);
      const base = f.pts.filter((p) => p[1] - low < 0.01).map((p) => ({ x: p[0], y: p[2] }));
      const wall = project.walls.find((w) => base.every((p) => distToSegment(p, w.a, w.b) <= w.thickness));
      if (roofGables && wall?.kind === 'exterior') continue;
      add(wall ? studFor(wall, project.framing) : project.framing.interiorStud, faceArea(f.pts), Math.max(...ys) - low, room.name);
    }
  }
  if (roof && roofGables) add(project.framing.exteriorStud, roof.gableArea, roof.rise, 'roof gable ends');
  return out;
}
