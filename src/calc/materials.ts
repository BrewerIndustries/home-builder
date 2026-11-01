import { polygonArea, wallLength } from '../model/geometry.ts';
import { studFor, type LumberSize, type Project } from '../model/types.ts';
import { ceilingInfo } from './ceilings.ts';
import { framingTakeoff, type FramingTakeoff, type HeaderSize } from './framing.ts';

// Materials list: the framing takeoff turned into things you buy, plus the
// area-driven sheet goods. Waste is applied here, once, to purchase quantities.

export interface MaterialLine {
  category: 'Lumber' | 'Sheathing' | 'Drywall' | 'Insulation & wrap' | 'Electrical' | 'Openings';
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
  const floor = project.rooms.reduce((s, r) => s + polygonArea(r.points), 0) / 144;
  const ceils = project.rooms.map((r) => ceilingInfo(project, r));
  const ceilings = ceils.reduce((s, c) => s + c.surface, 0) / 144;
  const ceilingBeams = ceils.reduce((s, c) => s + c.beamLength, 0) / 12;
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

  return lines;
}

/** 36 → "30", 80 → "68": the trade's feet-inches size code. */
export function sizeCode(inches: number): string {
  const ft = Math.floor(inches / 12);
  const inch = Math.round(inches - ft * 12);
  return `${ft}${inch}`;
}
