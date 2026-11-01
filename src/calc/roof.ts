import { DEFAULT_ROOF, type Project, type RafterSize, type Roof } from '../model/types.ts';
import type { MaterialLine } from './materials.ts';

// Roof over the house: geometry, framing members and roofing materials.
// v1 roofs the bounding rectangle of the exterior walls' outer faces, so an
// L-shaped plan gets one roof over its whole box. Inches throughout.

export type V3 = [number, number, number];
export interface RoofFace {
  kind: 'roof' | 'gable';
  pts: V3[];
}

export interface RoofCalc {
  roof: Roof;
  /** Outer face of the walls. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Ridge runs along plan x. */
  alongX: boolean;
  /** Wall-line length along the ridge, and span across it. */
  L: number;
  W: number;
  /** Top of the wall plates. */
  plate: number;
  /** Slope factor: sloped length per horizontal length. */
  k: number;
  /** Rise from plate to ridge (shed: to the high wall), at the wall line. */
  rise: number;
  /** Roof surface, sq in (overhangs included). */
  area: number;
  squares: number;
  ridgeLength: number;
  /** All four hips together. */
  hipLength: number;
  eaveLength: number;
  rakeLength: number;
  /** Wall area above the plate at gable ends (and a shed's high wall), sq in. */
  gableArea: number;
  /** Common rafter, eave to ridge, sloped length. */
  rafterLength: number;
}

export function roofOf(project: Project): Roof {
  return { ...DEFAULT_ROOF, ...project.roof };
}

/** Roof geometry, or null with no exterior walls or roof type "none". */
export function roofCalc(project: Project): RoofCalc | null {
  const roof = roofOf(project);
  const ext = project.walls.filter((w) => w.kind === 'exterior');
  if (roof.type === 'none' || !ext.length) return null;
  const t = Math.max(...ext.map((w) => w.thickness)) / 2;
  const xs = ext.flatMap((w) => [w.a.x, w.b.x]);
  const ys = ext.flatMap((w) => [w.a.y, w.b.y]);
  const [x0, x1, y0, y1] = [Math.min(...xs) - t, Math.max(...xs) + t, Math.min(...ys) - t, Math.max(...ys) + t];
  const alongX = roof.ridge === 'x' || (roof.ridge === 'auto' && x1 - x0 >= y1 - y0);
  const L = alongX ? x1 - x0 : y1 - y0;
  const W = alongX ? y1 - y0 : x1 - x0;
  const plate = Math.max(...ext.map((w) => w.height));
  const p = roof.pitch / 12;
  const k = Math.sqrt(1 + p * p);
  const o = roof.overhang;
  const shed = roof.type === 'shed';
  const rise = (shed ? W : W / 2) * p;

  let area: number;
  let ridgeLength = 0;
  let hipLength = 0;
  let eaveLength: number;
  let rakeLength = 0;
  let gableArea = 0;
  let runE: number;
  if (roof.type === 'gable') {
    const Le = L + 2 * roof.rake;
    runE = W / 2 + o;
    area = Le * (W + 2 * o) * k;
    ridgeLength = Le;
    eaveLength = 2 * Le;
    rakeLength = 4 * runE * k;
    gableArea = W * rise; // two triangles of W × rise / 2
  } else if (roof.type === 'hip') {
    runE = W / 2 + o;
    area = (L + 2 * o) * (W + 2 * o) * k;
    ridgeLength = L - W;
    const riseE = runE * p;
    hipLength = 4 * Math.sqrt(2 * runE * runE + riseE * riseE);
    eaveLength = 2 * (L + 2 * o) + 2 * (W + 2 * o);
  } else {
    runE = W + 2 * o;
    const Le = L + 2 * roof.rake;
    area = Le * runE * k;
    eaveLength = Le; // low edge; the high edge gets drip edge too
    rakeLength = 2 * runE * k;
    ridgeLength = 0;
    gableArea = W * rise + L * rise; // two side triangles + the high wall
  }
  return {
    roof,
    x0,
    x1,
    y0,
    y1,
    alongX,
    L,
    W,
    plate,
    k,
    rise,
    area,
    squares: area / 144 / 100,
    ridgeLength,
    hipLength,
    eaveLength,
    rakeLength,
    gableArea,
    rafterLength: runE * k,
  };
}

const NEXT_SIZE: Record<RafterSize, string> = { '2x6': '2x8', '2x8': '2x10', '2x10': '2x12', '2x12': 'LVL' };

/** Lumber stock length for a piece: even feet, 8'–20'. */
export function stockFeet(inches: number): number {
  return Math.min(20, Math.max(8, 2 * Math.ceil(inches / 24 - 1e-9)));
}

export interface RoofFraming {
  kind: 'trusses' | 'rafters';
  /** Trusses, or common rafters (hip: estimated pieces). */
  count: number;
  /** Members bearing on the walls (hurricane ties). */
  bearings: number;
}

export function roofFraming(c: RoofCalc): RoofFraming {
  const { roof } = c;
  const perWall = (len: number) => Math.ceil(len / roof.spacing - 1e-9) + 1;
  let count: number;
  if (roof.framing === 'trusses') count = perWall(c.L);
  else if (roof.type === 'gable') count = 2 * perWall(c.L);
  else if (roof.type === 'shed') count = perWall(c.L);
  // Hip: commons + jacks ≈ roof plan area / spacing, in pieces of a common rafter.
  else count = Math.ceil(c.area / c.k / roof.spacing / (c.rafterLength / c.k));
  const bearings = roof.type === 'hip' ? 2 * perWall(c.L) + 2 * perWall(c.W) : 2 * perWall(c.L);
  return { kind: roof.framing, count, bearings };
}

/** Roof lines for the materials list. */
export function roofLines(project: Project, waste: number): MaterialLine[] {
  const c = roofCalc(project);
  if (!c) return [];
  const { roof } = c;
  const w = 1 + waste;
  const pct = `+${Math.round(waste * 100)}% waste`;
  const lines: MaterialLine[] = [];
  const add = (category: MaterialLine['category'], item: string, qty: number, unit: string, basis: string) =>
    qty > 0 && lines.push({ category, item, qty, unit, basis });
  const ft = (n: number) => `${Math.round(n / 12)} LF`;
  const span = `${Math.round(c.W / 12)}' span ${roof.pitch}/12`;
  const fr = roofFraming(c);

  if (fr.kind === 'trusses') {
    if (roof.type === 'gable') {
      add('Roof', `Roof truss, ${span}`, fr.count - 2, 'ea', `${Math.round(c.L / 12)}' of wall at ${roof.spacing}" o.c.; size by the truss supplier`);
      add('Roof', `Gable-end truss, ${span}`, 2, 'ea', 'one per gable end');
    } else if (roof.type === 'hip') {
      add('Roof', `Hip truss package, ${span}`, fr.count, 'ea', 'girder, step-down and jack trusses — count is the common-truss equivalent; quote from the supplier');
    } else {
      add('Roof', `Mono (shed) truss, ${span}`, fr.count, 'ea', `${roof.spacing}" o.c.; size by the truss supplier`);
    }
  } else {
    const stock = stockFeet(c.rafterLength);
    const splice = c.rafterLength > 240 ? ' (longer than 20\' — splice or engineered)' : '';
    add('Roof', `${roof.rafterSize} rafter, ${stock}'`, Math.ceil(fr.count * w), 'ea', `${fr.count} rafters ${roof.type === 'hip' ? '(commons + jacks, approx.) ' : ''}at ${roof.spacing}" o.c., ${Math.round(c.rafterLength)}" long${splice} ${pct}`);
    if (c.ridgeLength > 0) add('Roof', `${NEXT_SIZE[roof.rafterSize]} ridge board, 16'`, Math.ceil(c.ridgeLength / 192), 'ea', `${ft(c.ridgeLength)} ridge, one size deeper than the rafters`);
    if (c.hipLength > 0) add('Roof', `${NEXT_SIZE[roof.rafterSize]} hip rafter, ${stockFeet(c.hipLength / 4)}'`, 4, 'ea', `${ft(c.hipLength)} of hips`);
    if (roof.type !== 'shed') {
      const n = Math.ceil(c.L / roof.spacing) + 1;
      const pieces = c.W > 240 ? 2 : 1;
      add('Roof', `${roof.rafterSize} ceiling joist, ${stockFeet(c.W / pieces)}'`, n * pieces, 'ea', `one per rafter pair, lapped over a bearing wall when the span exceeds 20'; size per R802 tables`);
    }
  }
  add('Roof', 'Hurricane tie', fr.bearings, 'ea', 'one per rafter / truss bearing on a wall');

  const sq = c.area / 144;
  add('Roof', '7/16" OSB roof sheathing, 4×8', Math.ceil((sq * w) / 32), 'sheets', `${Math.round(sq)} sq ft roof ${pct}`);
  add('Roof', 'Synthetic underlayment, 10 sq roll', Math.ceil((sq * w) / 1000), 'rolls', `${c.squares.toFixed(1)} squares ${pct}`);
  add('Roof', 'Architectural shingles, bundle', Math.ceil(c.squares * w * 3), 'bundles', `3 bundles per square ${pct}`);
  add('Roof', 'Starter strip shingles, bundle', Math.ceil((c.eaveLength + c.rakeLength) / 12 / 100), 'bundles', `${ft(c.eaveLength + c.rakeLength)} of eaves + rakes, ~100 LF per bundle (check product)`);
  if (c.ridgeLength + c.hipLength > 0) add('Roof', 'Hip & ridge cap shingles, bundle', Math.ceil((c.ridgeLength + c.hipLength) / 12 / 25), 'bundles', `${ft(c.ridgeLength + c.hipLength)}, ~25 LF per bundle (check product)`);
  const edge = c.eaveLength + c.rakeLength + (roof.type === 'shed' ? c.eaveLength : 0);
  add('Roof', "Drip edge, 10'", Math.ceil((edge * 1.05) / 120), 'pieces', `${ft(edge)} of roof edge +5% laps`);
  add('Roof', "2x6 fascia, 16'", Math.ceil((edge * w) / 192), 'ea', `${ft(edge)} ${pct}`);
  if (roof.overhang > 0) {
    const soffit = (c.eaveLength * roof.overhang) / 144;
    add('Roof', 'Vented soffit', Math.ceil(soffit * w), 'sq ft', `${ft(c.eaveLength)} of eave × ${roof.overhang}" overhang ${pct}`);
  }
  if (c.gableArea > 0) add('Sheathing', '7/16" OSB gable-end sheathing, 4×8', Math.ceil(((c.gableArea / 144) * w) / 32), 'sheets', `${Math.round(c.gableArea / 144)} sq ft of wall above the plate ${pct}`);
  return lines;
}

/** 3D surfaces of the roof (plan x → X, plan y → Z, up = Y). */
export function roofFaces(project: Project): RoofFace[] {
  const c = roofCalc(project);
  if (!c) return [];
  const { roof } = c;
  const p = roof.pitch / 12;
  const o = roof.overhang;
  const eave = c.plate - o * p;
  // u along the ridge (0..1 over the rake-to-rake length), v across from the eave line (inches from wall line).
  const r = roof.type === 'hip' ? o : roof.rake;
  const [u0, u1] = c.alongX ? [c.x0 - r, c.x1 + r] : [c.y0 - r, c.y1 + r];
  const [v0, v1] = c.alongX ? [c.y0, c.y1] : [c.x0, c.x1];
  const P = (u: number, v: number, h: number): V3 => (c.alongX ? [u, h, v] : [v, h, u]);
  const top = c.plate + c.rise;
  const faces: RoofFace[] = [];
  if (roof.type === 'gable') {
    const mid = (v0 + v1) / 2;
    faces.push({ kind: 'roof', pts: [P(u0, v0 - o, eave), P(u1, v0 - o, eave), P(u1, mid, top), P(u0, mid, top)] });
    faces.push({ kind: 'roof', pts: [P(u0, v1 + o, eave), P(u1, v1 + o, eave), P(u1, mid, top), P(u0, mid, top)] });
    const [g0, g1] = c.alongX ? [c.x0, c.x1] : [c.y0, c.y1];
    for (const g of [g0, g1]) faces.push({ kind: 'gable', pts: [P(g, v0, c.plate), P(g, v1, c.plate), P(g, mid, top)] });
  } else if (roof.type === 'hip') {
    const mid = (v0 + v1) / 2;
    const half = (v1 - v0) / 2 + o;
    // Ridge ends sit in from the eave corners by the eave run (equal pitch all round).
    const ra = Math.min(u0 + half, (u0 + u1) / 2);
    const rb = Math.max(u1 - half, (u0 + u1) / 2);
    const a = P(u0, v0 - o, eave);
    const b = P(u1, v0 - o, eave);
    const cc = P(u1, v1 + o, eave);
    const d = P(u0, v1 + o, eave);
    const ra3 = P(ra, mid, top);
    const rb3 = P(rb, mid, top);
    faces.push({ kind: 'roof', pts: [a, b, rb3, ra3] }, { kind: 'roof', pts: [d, cc, rb3, ra3] });
    faces.push({ kind: 'roof', pts: [a, d, ra3] }, { kind: 'roof', pts: [b, cc, rb3] });
  } else {
    // Shed: low along v0, high along v1.
    const lo = eave;
    const hi = c.plate + c.rise + o * p;
    faces.push({ kind: 'roof', pts: [P(u0, v0 - o, lo), P(u1, v0 - o, lo), P(u1, v1 + o, hi), P(u0, v1 + o, hi)] });
    const [g0, g1] = c.alongX ? [c.x0, c.x1] : [c.y0, c.y1];
    for (const g of [g0, g1]) faces.push({ kind: 'gable', pts: [P(g, v0, c.plate), P(g, v1, c.plate), P(g, v1, c.plate + c.rise)] });
    faces.push({ kind: 'gable', pts: [P(g0, v1, c.plate), P(g1, v1, c.plate), P(g1, v1, c.plate + c.rise), P(g0, v1, c.plate + c.rise)] });
  }
  return faces;
}
