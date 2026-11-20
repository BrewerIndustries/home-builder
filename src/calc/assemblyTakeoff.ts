import { wallLength } from '../model/geometry.ts';
import { assemblyFor, inchText } from '../model/assembly.ts';
import { framedWalls, type Project, type Wall, type WallLayer, type WallLayerKind } from '../model/types.ts';
import { tiledFaceByWall } from './wetRoom.ts';
import type { MaterialLine } from './materials.ts';

// Sheet goods and cladding from the wall assemblies: every drywall, sheathing,
// foam and siding layer covers its wall's face, net of the openings in it. A
// partition with drywall both sides counts two drywall faces; an exterior wall
// counts its one inside face. Ceilings add to the 1/2" drywall. Sq ft.

const SHEET_SQFT = 32; // 4×8
const SQUARE = 100; // siding is sold by the square

export interface LayerTakeoff {
  kind: WallLayerKind;
  thickness: number;
  name?: string;
  /** Net face area covered, sq ft. */
  sqft: number;
  /** Of which on exterior walls. */
  exteriorSqft: number;
}

/** Net area of one face of the wall (openings removed), sq ft. */
export function netFace(project: Project, w: Wall): number {
  const holes = project.openings.filter((o) => o.wallId === w.id).reduce((s, o) => s + o.width * o.height, 0);
  return Math.max(0, wallLength(w) * w.height - holes) / 144;
}

const key = (l: WallLayer) => `${l.kind}|${l.thickness}|${l.name ?? ''}`;

/** Area per distinct layer product across all walls (studs and "other" layers aren't bought by area). */
export function layerTakeoff(project: Project): LayerTakeoff[] {
  const out = new Map<string, LayerTakeoff>();
  // Wet-room walls are tiled over cement board: that face's drywall comes off (wetRoom.ts).
  const tiled = tiledFaceByWall(project);
  for (const w of framedWalls(project)) {
    const net = netFace(project, w);
    if (!net) continue;
    let wet = tiled.get(w.id) ?? 0;
    for (const l of assemblyFor(project, w)) {
      if (l.kind === 'stud' || l.kind === 'other' || !(l.thickness > 0)) continue;
      const k = key(l);
      const cur = out.get(k) ?? { kind: l.kind, thickness: l.thickness, name: l.name, sqft: 0, exteriorSqft: 0 };
      // The first drywall layer stands for the wet-room face (one face per drywall layer).
      const less = l.kind === 'drywall' ? Math.min(wet, net) : 0;
      if (less) wet = 0;
      cur.sqft += net - less;
      if (w.kind === 'exterior') cur.exteriorSqft += net - less;
      out.set(k, cur);
    }
  }
  return [...out.values()];
}

/** Wall drywall faces, sq ft (all thicknesses). */
export function drywallWallArea(project: Project): number {
  return layerTakeoff(project)
    .filter((l) => l.kind === 'drywall')
    .reduce((s, l) => s + l.sqft, 0);
}

const where = (l: LayerTakeoff) => (l.exteriorSqft >= l.sqft - 0.01 ? 'exterior wall' : l.exteriorSqft > 0.01 ? 'wall (exterior + interior)' : 'interior wall');

/** Materials lines for the layers; `ceilings` (sq ft) is hung in 1/2" drywall. */
export function assemblyLines(project: Project, ceilings: number): MaterialLine[] {
  const waste = 1 + project.framing.waste;
  const wastePct = `+${Math.round(project.framing.waste * 100)}% waste`;
  const layers = layerTakeoff(project);
  const lines: MaterialLine[] = [];
  const byThickness = (a: LayerTakeoff, b: LayerTakeoff) => a.thickness - b.thickness || (a.name ?? '').localeCompare(b.name ?? '');

  for (const l of layers.filter((x) => x.kind === 'sheathing').sort(byThickness)) {
    lines.push({
      category: 'Sheathing',
      item: `${inchText(l.thickness)} ${l.name ? `${l.name} ` : ''}wall sheathing, 4×8`,
      qty: Math.ceil((l.sqft * waste) / SHEET_SQFT),
      unit: 'sheets',
      basis: `${Math.round(l.sqft)} sq ft ${where(l)}, net of openings ${wastePct}`,
    });
  }
  for (const l of layers.filter((x) => x.kind === 'foam').sort(byThickness)) {
    lines.push({
      category: 'Insulation & wrap',
      item: `${inchText(l.thickness)} ${l.name ?? 'rigid foam'} board, 4×8`,
      qty: Math.ceil((l.sqft * waste) / SHEET_SQFT),
      unit: 'sheets',
      basis: `${Math.round(l.sqft)} sq ft ${where(l)}, net of openings ${wastePct}`,
    });
  }
  for (const l of layers.filter((x) => x.kind === 'siding').sort(byThickness)) {
    lines.push({
      category: 'Siding',
      item: `${inchText(l.thickness)} ${l.name ?? ''} siding`.replace(/\s+/g, ' '),
      qty: Math.ceil((l.sqft * waste) / SQUARE),
      unit: 'squares',
      basis: `${Math.round(l.sqft)} sq ft ${where(l)}, net of openings (wall faces only — gables and trim not included) ${wastePct}`,
    });
  }

  const drywall = layers.filter((x) => x.kind === 'drywall').sort(byThickness);
  if (ceilings > 0 && !drywall.some((l) => l.thickness === 0.5)) drywall.push({ kind: 'drywall', thickness: 0.5, sqft: 0, exteriorSqft: 0 });
  for (const l of drywall.sort(byThickness)) {
    const ceil = l.thickness === 0.5 ? ceilings : 0;
    const total = l.sqft + ceil;
    if (total <= 0) continue;
    lines.push({
      category: 'Drywall',
      item: `${inchText(l.thickness)} ${l.name ? `${l.name} ` : ''}drywall, 4×8`,
      qty: Math.ceil((total * waste) / SHEET_SQFT),
      unit: 'sheets',
      basis: `${Math.round(l.sqft)} sq ft walls${ceil ? ` + ${Math.round(ceil)} sq ft ceilings (incl. vaults, trays, coffers)` : ''} ${wastePct}`,
    });
  }
  return lines;
}
