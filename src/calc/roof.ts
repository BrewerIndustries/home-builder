import { DEFAULT_ROOF, type Dormer, type Point, type Project, type RafterSize, type Roof, standardsOf } from '../model/types.ts';
import type { MaterialLine } from './materials.ts';

// Roof over the house: geometry, framing members and roofing materials. Inches.
//
// v2: a square-cornered (L / T / U…) outline is split into rectangles — the
// largest is the main roof, the rest are wings, each roofed on its own with its
// ridge running out from the roof it hangs off. Where a wing meets a sloped face
// there are two valleys and its ridge runs in until it meets that face; a wing
// off a gable end just butts the gable wall. All faces share one pitch, so the
// roof surface is the plan area of the overhung outline × the slope factor.
// Angled walls, a shed roof, or "one roof over the box" fall back to v1: one roof
// over the bounding rectangle of the exterior walls' outer faces.
//
// Dormers sit on the main roof's long faces (gable or shed), each with its own
// takeoff; the main roof surface under a dormer is taken off. Attic ventilation
// (R806.2): net free vent area of 1/150 of the attic floor area, or 1/300 when
// the user says the code's exception conditions are met; split half high (ridge
// vent / roof louvers) and half low (soffit / edge intake).

export type V3 = [number, number, number];
export interface RoofFace {
  kind: 'roof' | 'gable';
  pts: V3[];
}

export interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
/** Sides of a plan rectangle: n = low y (plan y runs down), s = high y, w = low x, e = high x. */
export type Side = 'n' | 's' | 'e' | 'w';
type EndKind = 'gable' | 'hip' | 'open' | 'butt';

export interface RoofWing {
  /** Outer wall faces (a wing's attached side sits on its parent's face). */
  rect: Rect;
  alongX: boolean;
  /** Wall length along the ridge, and span across it. */
  L: number;
  W: number;
  rise: number;
  /** Index of the wing it hangs off; -1 for the main roof. */
  parent: number;
  /** Side of the parent it hangs off. */
  side?: Side;
  /** Meets a sloped face of the parent (two valleys) rather than a gable wall. */
  valleys: boolean;
  /** End kinds at the low-u and high-u walls (u along the ridge). */
  ends: [EndKind, EndKind];
  ridgeLength: number;
  hips: number;
  hipLength: number;
  valleyLength: number;
  /** Eave length by side (after valleyed wings cut into it), and rake lengths. */
  eaves: Partial<Record<Side, number>>;
  rakes: number[];
  gableArea: number;
  /** Common rafter, eave to ridge, sloped. */
  rafterLength: number;
  /** Common rafters (hip: commons + jacks estimate), valley jacks (≈ half a common each), trusses, gable-end trusses. */
  commons: number;
  valleyJacks: number;
  trusses: number;
  gableEnds: number;
  ceilingJoists: number;
  bearings: number;
}

export interface DormerCalc {
  dormer: Dormer;
  /** Horizontal depth of the cheek walls (front wall to where the dormer plate meets the main roof). */
  depth: number;
  /** Plan rectangle-ish outline on the main roof, and its ridge (gable). */
  outline: Point[];
  ridge: [Point, Point] | null;
  valleyLines: [Point, Point][];
  /** Dormer roof surface, and the main roof surface it covers, sq in (sloped). */
  roofArea: number;
  hiddenArea: number;
  frontArea: number;
  cheekArea: number;
  ridgeLength: number;
  valleyLength: number;
  valleys: number;
  rafters: number;
  rafterLength: number;
  /** Fascia edges. */
  edges: { name: string; length: number }[];
  /** Where the cheeks meet the main roof (step flashing), sloped. */
  stepFlashing: number;
  faces: RoofFace[];
}

export interface Ventilation {
  /** Attic floor area (the roofed footprint), sq in. */
  atticArea: number;
  ratio: 150 | 300;
  /** Net free vent area needed, sq in, and its high / low halves. */
  required: number;
  exhaust: number;
  intake: number;
}

export interface RoofCalc {
  roof: Roof;
  /** Main roof: outer face of its walls. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Main ridge runs along plan x. */
  alongX: boolean;
  /** Main roof: wall-line length along the ridge, and span across it. */
  L: number;
  W: number;
  /** Top of the wall plates. */
  plate: number;
  /** Slope factor: sloped length per horizontal length. */
  k: number;
  /** Main roof: rise from plate to ridge (shed: to the high wall), at the wall line. */
  rise: number;
  /** Roof surface, sq in (overhangs and dormers included). */
  area: number;
  squares: number;
  /** Totals over the wings and dormers. */
  ridgeLength: number;
  hipLength: number;
  hips: number;
  valleyLength: number;
  valleys: number;
  eaveLength: number;
  rakeLength: number;
  /** Wall area above the plate at gable ends (and a shed's high wall), sq in. */
  gableArea: number;
  /** Main roof common rafter, eave to ridge, sloped length. */
  rafterLength: number;
  wings: RoofWing[];
  dormers: DormerCalc[];
  /** Fascia edges: eaves and rakes (dormers included). */
  edges: { name: string; length: number }[];
  /** Footprint at the walls' outer faces, sq in. */
  footprint: number;
  /** Overhung roof outline in plan, as boundary segments. */
  outline: [Point, Point][];
  vent: Ventilation;
  notes: string[];
}

export function roofOf(project: Project): Roof {
  return { ...DEFAULT_ROOF, ...project.roof };
}

const EPS = 0.5;

/** Sorted distinct values (within 1/2"). */
function distinct(vals: number[]): number[] {
  const out: number[] = [];
  for (const v of [...vals].sort((a, b) => a - b)) if (!out.length || v - out[out.length - 1] > EPS) out.push(v);
  return out;
}

/** Plan area of a union of rectangles, and its boundary. */
export function rectUnion(rects: Rect[]): { area: number; outline: [Point, Point][] } {
  const xs = distinct(rects.flatMap((r) => [r.x0, r.x1]));
  const ys = distinct(rects.flatMap((r) => [r.y0, r.y1]));
  const inside = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= xs.length - 1 || j >= ys.length - 1) return false;
    const cx = (xs[i] + xs[i + 1]) / 2;
    const cy = (ys[j] + ys[j + 1]) / 2;
    return rects.some((r) => cx > r.x0 && cx < r.x1 && cy > r.y0 && cy < r.y1);
  };
  let area = 0;
  const outline: [Point, Point][] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      if (!inside(i, j)) continue;
      area += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
      if (!inside(i, j - 1)) outline.push([{ x: xs[i], y: ys[j] }, { x: xs[i + 1], y: ys[j] }]);
      if (!inside(i, j + 1)) outline.push([{ x: xs[i], y: ys[j + 1] }, { x: xs[i + 1], y: ys[j + 1] }]);
      if (!inside(i - 1, j)) outline.push([{ x: xs[i], y: ys[j] }, { x: xs[i], y: ys[j + 1] }]);
      if (!inside(i + 1, j)) outline.push([{ x: xs[i + 1], y: ys[j] }, { x: xs[i + 1], y: ys[j + 1] }]);
    }
  }
  return { area, outline };
}

/**
 * The exterior walls' centreline outline split into rectangles, largest first
 * (greedy: biggest rectangle of free cells, then the next). Null when a wall is
 * angled or the walls don't close.
 */
export function footprintRects(project: Project): Rect[] | null {
  const ext = project.walls.filter((w) => w.kind === 'exterior');
  if (!ext.length || ext.some((w) => Math.abs(w.a.x - w.b.x) > EPS && Math.abs(w.a.y - w.b.y) > EPS)) return null;
  const xs = distinct(ext.flatMap((w) => [w.a.x, w.b.x]));
  const ys = distinct(ext.flatMap((w) => [w.a.y, w.b.y]));
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  if (nx < 1 || ny < 1) return null;
  const vertical = ext.filter((w) => Math.abs(w.a.x - w.b.x) <= EPS);
  const free: boolean[][] = [];
  for (let i = 0; i < nx; i++) {
    free.push([]);
    for (let j = 0; j < ny; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cy = (ys[j] + ys[j + 1]) / 2;
      const crossings = vertical.filter((w) => w.a.x > cx && Math.min(w.a.y, w.b.y) < cy && Math.max(w.a.y, w.b.y) > cy).length;
      free[i].push(crossings % 2 === 1);
    }
  }
  if (!free.some((c) => c.some(Boolean))) return null;
  const rects: Rect[] = [];
  for (;;) {
    let best: { i0: number; i1: number; j0: number; j1: number; area: number } | null = null;
    for (let i0 = 0; i0 < nx; i0++)
      for (let j0 = 0; j0 < ny; j0++) {
        if (!free[i0][j0]) continue;
        // Grow right column by column, keeping the tallest all-free run down from j0.
        let maxJ = ny - 1;
        for (let i1 = i0; i1 < nx && free[i1][j0]; i1++) {
          let j = j0;
          while (j + 1 <= maxJ && free[i1][j + 1]) j++;
          maxJ = Math.min(maxJ, j);
          for (let j1 = j0; j1 <= maxJ; j1++) {
            const area = (xs[i1 + 1] - xs[i0]) * (ys[j1 + 1] - ys[j0]);
            if (!best || area > best.area + 1e-6) best = { i0, i1, j0, j1, area };
          }
        }
      }
    if (!best) break;
    for (let i = best.i0; i <= best.i1; i++) for (let j = best.j0; j <= best.j1; j++) free[i][j] = false;
    rects.push({ x0: xs[best.i0], x1: xs[best.i1 + 1], y0: ys[best.j0], y1: ys[best.j1 + 1] });
  }
  return rects;
}

/** The side of p that r sits against, if they share a stretch of edge. */
function sharedSide(r: Rect, p: Rect): Side | null {
  const overlapX = Math.min(r.x1, p.x1) - Math.max(r.x0, p.x0);
  const overlapY = Math.min(r.y1, p.y1) - Math.max(r.y0, p.y0);
  if (overlapX > 1 && Math.abs(r.y1 - p.y0) <= EPS) return 'n';
  if (overlapX > 1 && Math.abs(r.y0 - p.y1) <= EPS) return 's';
  if (overlapY > 1 && Math.abs(r.x1 - p.x0) <= EPS) return 'w';
  if (overlapY > 1 && Math.abs(r.x0 - p.x1) <= EPS) return 'e';
  return null;
}

const longSides = (alongX: boolean): [Side, Side] => (alongX ? ['n', 's'] : ['w', 'e']);
const endSides = (alongX: boolean): [Side, Side] => (alongX ? ['w', 'e'] : ['n', 's']);

function expand(r: Rect, by: Partial<Record<Side, number>>): Rect {
  return { x0: r.x0 - (by.w ?? 0), x1: r.x1 + (by.e ?? 0), y0: r.y0 - (by.n ?? 0), y1: r.y1 + (by.s ?? 0) };
}

/** Wing frame: u along the ridge, v across; plan point from (u, v). */
function frame(w: { rect: Rect; alongX: boolean }) {
  const r = w.rect;
  const [u0, u1] = w.alongX ? [r.x0, r.x1] : [r.y0, r.y1];
  const [v0, v1] = w.alongX ? [r.y0, r.y1] : [r.x0, r.x1];
  const P2 = (u: number, v: number): Point => (w.alongX ? { x: u, y: v } : { x: v, y: u });
  return { u0, u1, v0, v1, mid: (v0 + v1) / 2, P2 };
}

/** Roof geometry, or null with no exterior walls or roof type "none". */
export function roofCalc(project: Project): RoofCalc | null {
  const roof = roofOf(project);
  const ext = project.walls.filter((w) => w.kind === 'exterior');
  if (roof.type === 'none' || !ext.length) return null;
  const t = Math.max(...ext.map((w) => w.thickness)) / 2;
  const plate = Math.max(...ext.map((w) => w.height));
  const p = roof.pitch / 12;
  const k = Math.sqrt(1 + p * p);
  const o = roof.overhang;
  const notes: string[] = [];

  // Rectangles at the walls' outer faces; the first is the main roof.
  const parts = roof.type !== 'shed' && roof.perWing !== false ? footprintRects(project) : null;
  const xs = ext.flatMap((w) => [w.a.x, w.b.x]);
  const ys = ext.flatMap((w) => [w.a.y, w.b.y]);
  const box: Rect = { x0: Math.min(...xs) - t, x1: Math.max(...xs) + t, y0: Math.min(...ys) - t, y1: Math.max(...ys) + t };
  const placed: { rect: Rect; parent: number; side?: Side }[] = [];
  if (!parts || parts.length === 1) placed.push({ rect: box, parent: -1 });
  else {
    parts.forEach((r, i) => {
      if (i === 0) return placed.push({ rect: expand(r, { n: t, s: t, e: t, w: t }), parent: -1 });
      const parent = parts.slice(0, i).findIndex((q) => sharedSide(r, q));
      if (parent < 0) return placed.push({ rect: expand(r, { n: t, s: t, e: t, w: t }), parent: -1 });
      const side = sharedSide(r, parts[parent])!;
      const rect = expand(r, { n: t, s: t, e: t, w: t });
      const pr = placed[parent].rect;
      if (side === 'n') rect.y1 = pr.y0;
      if (side === 's') rect.y0 = pr.y1;
      if (side === 'w') rect.x1 = pr.x0;
      if (side === 'e') rect.x0 = pr.x1;
      placed.push({ rect, parent, side });
    });
  }

  const perWall = (len: number) => Math.ceil(len / roof.spacing - 1e-9) + 1;
  const shed = roof.type === 'shed';
  const type = roof.type as 'gable' | 'hip' | 'shed';
  const wings: RoofWing[] = [];
  placed.forEach((pl, i) => {
    const r = pl.rect;
    const dx = r.x1 - r.x0;
    const dy = r.y1 - r.y0;
    const parent = pl.parent >= 0 ? wings[pl.parent] : null;
    const alongX = parent ? pl.side === 'e' || pl.side === 'w' : roof.ridge === 'x' || (roof.ridge === 'auto' && dx >= dy);
    const L = alongX ? dx : dy;
    const W = alongX ? dy : dx;
    const rise = (shed ? W : W / 2) * p;
    const runE = shed ? W + 2 * o : W / 2 + o;
    const valleys = !!parent && (type === 'hip' || longSides(parent.alongX).includes(pl.side!));
    const attachedLow = pl.side === 'e' || pl.side === 's';
    const freeEnd: EndKind = type === 'hip' ? 'hip' : 'gable';
    const attEnd: EndKind = valleys ? 'open' : 'butt';
    const ends: [EndKind, EndKind] = !parent ? [freeEnd, freeEnd] : attachedLow ? [attEnd, freeEnd] : [freeEnd, attEnd];
    const nFree = ends.filter((e) => e === 'gable' || e === 'hip').length;
    const hipRun = Math.sqrt(2 + p * p) * runE; // a hip or valley, eave to ridge, at equal pitch
    const w: RoofWing = {
      rect: r,
      alongX,
      L,
      W,
      rise,
      parent: pl.parent,
      side: pl.side,
      valleys,
      ends,
      ridgeLength: 0,
      hips: 0,
      hipLength: 0,
      valleyLength: 0,
      eaves: {},
      rakes: [],
      gableArea: 0,
      rafterLength: runE * k,
      commons: 0,
      valleyJacks: 0,
      trusses: perWall(L),
      gableEnds: 0,
      ceilingJoists: shed ? 0 : perWall(L) * (W > 240 ? 2 : 1),
      bearings: 2 * perWall(L),
    };
    const [sa, sb] = longSides(alongX);
    const [ea, eb] = endSides(alongX);
    if (shed) {
      const Le = L + 2 * roof.rake;
      w.eaves = { [sa]: Le, [sb]: Le };
      w.rakes = [runE * k, runE * k];
      w.gableArea = W * rise + L * rise;
      w.commons = perWall(L);
    } else {
      // Ends that stick out past a wall: gable (rake) or hip (eave overhang).
      const out = (e: EndKind) => (e === 'gable' ? roof.rake : e === 'hip' ? o : e === 'open' ? -o : 0);
      const side = L + out(ends[0]) + out(ends[1]);
      w.eaves = { [sa]: side, [sb]: side };
      if (type === 'gable') {
        w.rakes = Array.from({ length: 2 * nFree }, () => runE * k);
        w.gableEnds = nFree;
        w.gableArea = nFree * (W * rise) / 2;
        w.ridgeLength = L + nFree * roof.rake + (valleys ? W / 2 : 0);
        w.commons = 2 * perWall(L);
      } else {
        ends.forEach((e, j) => e === 'hip' && (w.eaves[j ? eb : ea] = W + 2 * o));
        w.hips = 2 * nFree;
        w.hipLength = w.hips * hipRun;
        w.ridgeLength = Math.max(0, L - nFree * (W / 2)) + (valleys ? W / 2 : 0);
        // Commons + jacks ≈ plan area / spacing, in pieces of a common rafter.
        const plan = (L + out(ends[0]) + out(ends[1])) * (W + 2 * o);
        w.commons = Math.ceil(plan / roof.spacing / runE);
        w.bearings += nFree * perWall(W);
      }
      if (valleys) {
        w.valleyLength = 2 * hipRun;
        w.valleyJacks = 2 * 2 * Math.ceil(runE / roof.spacing);
        // The parent's eave on that side is cut by the wing's width plus its overhangs.
        const ps = pl.side!;
        if (parent!.eaves[ps] != null) parent!.eaves[ps] = Math.max(0, parent!.eaves[ps]! - (W + 2 * o));
      } else if (parent && type === 'gable') {
        // Butts a gable wall: that much of the parent's gable is inside the wing's roof.
        parent.gableArea = Math.max(0, parent.gableArea - (Math.min(W, parent.W) * Math.min(rise, parent.rise)) / 2);
      }
    }
    if (parent && W > parent.W + EPS) notes.push(`wing ${i} is wider than the roof it joins — its ridge sits above that roof's; check the framing`);
    wings.push(w);
  });

  // Overhung plan outline: main roof all round, wings on their free sides.
  const overhung = wings.map((w) => {
    if (shed) return expand(w.rect, { [longSides(w.alongX)[0]]: o, [longSides(w.alongX)[1]]: o, [endSides(w.alongX)[0]]: roof.rake, [endSides(w.alongX)[1]]: roof.rake });
    const [sa, sb] = longSides(w.alongX);
    const [ea, eb] = endSides(w.alongX);
    const by = (e: EndKind) => (e === 'gable' ? roof.rake : e === 'hip' ? o : 0);
    return expand(w.rect, { [sa]: o, [sb]: o, [ea]: by(w.ends[0]), [eb]: by(w.ends[1]) });
  });
  const union = rectUnion(overhung);
  const footprint = rectUnion(wings.map((w) => w.rect)).area;

  const main = wings[0];
  const dormers = shed ? [] : (roof.dormers ?? []).map((d) => dormerCalc(d, main, plate, roof, notes)).filter((d): d is DormerCalc => !!d);

  const sum = (f: (w: RoofWing) => number) => wings.reduce((s, w) => s + f(w), 0);
  const dsum = (f: (d: DormerCalc) => number) => dormers.reduce((s, d) => s + f(d), 0);
  const area = union.area * k + dsum((d) => d.roofArea - d.hiddenArea);
  const edges: { name: string; length: number }[] = [];
  for (const w of wings) {
    for (const [s, len] of Object.entries(w.eaves)) if (len! > 0.01) edges.push({ name: shed ? (s === longSides(w.alongX)[0] ? 'low eave' : 'high eave') : 'eave', length: len! });
    for (const len of w.rakes) edges.push({ name: 'rake', length: len });
  }
  for (const d of dormers) edges.push(...d.edges);
  const eaveLength = shed ? main.eaves[longSides(main.alongX)[0]]! : edges.filter((e) => e.name === 'eave').reduce((s, e) => s + e.length, 0);
  const rakeLength = edges.filter((e) => e.name === 'rake').reduce((s, e) => s + e.length, 0);
  const ratio = roof.vent300 ? 300 : 150;
  const required = footprint / ratio;

  return {
    roof,
    ...main.rect,
    alongX: main.alongX,
    L: main.L,
    W: main.W,
    plate,
    k,
    rise: main.rise,
    area,
    squares: area / 144 / 100,
    ridgeLength: sum((w) => w.ridgeLength) + dsum((d) => d.ridgeLength),
    hipLength: sum((w) => w.hipLength),
    hips: sum((w) => w.hips),
    valleyLength: sum((w) => w.valleyLength) + dsum((d) => d.valleyLength),
    valleys: sum((w) => (w.valleys ? 2 : 0)) + dsum((d) => d.valleys),
    eaveLength,
    rakeLength,
    gableArea: sum((w) => w.gableArea),
    rafterLength: main.rafterLength,
    wings,
    dormers,
    edges,
    footprint,
    outline: union.outline,
    vent: { atticArea: footprint, ratio, required, exhaust: required / 2, intake: required / 2 },
    notes,
  };
}

/** A dormer on the main roof: geometry, 3D faces and takeoff; null if it can't be built. */
function dormerCalc(d: Dormer, main: RoofWing, plate: number, roof: Roof, notes: string[]): DormerCalc | null {
  const pm = roof.pitch / 12;
  const pd = d.pitch / 12;
  const km = Math.sqrt(1 + pm * pm);
  const kd = Math.sqrt(1 + pd * pd);
  const name = `${d.type} dormer at ${Math.round(d.at)}"`;
  if (d.width <= 0 || d.height <= 0 || pm <= 0) return null;
  if (d.type === 'shed' && pd >= pm) {
    notes.push(`${name}: a shed dormer's roof must be flatter than the main roof (${d.pitch}/12 vs ${roof.pitch}/12) — left out`);
    return null;
  }
  const { u0, u1, v0, v1, P2 } = frame(main);
  const dir = d.side === 'a' ? 1 : -1;
  const vF = (d.side === 'a' ? v0 : v1) + dir * d.setback;
  const hF = plate + d.setback * pm;
  const hD = hF + d.height;
  const uc = u0 + d.at;
  const half = d.width / 2;
  const depth = d.type === 'gable' ? d.height / pm : d.height / (pm - pd);
  const vB = vF + dir * depth;
  const ridgeRise = d.type === 'gable' ? half * pd : 0;
  const back = d.type === 'gable' ? depth + ridgeRise / pm : depth; // plan depth of the whole dormer
  const vR = vF + dir * back;
  if (d.setback + back > main.W / 2 + EPS) notes.push(`${name} runs past the main ridge — lower it or move it down the roof`);
  if (uc - half < u0 - EPS || uc + half > u1 + EPS) notes.push(`${name} hangs past the end of the main roof`);
  const P = (u: number, v: number, h: number): V3 => {
    const q = P2(u, v);
    return [q.x, h, q.y];
  };
  const faces: RoofFace[] = [];
  const front: RoofFace = { kind: 'gable', pts: [P(uc - half, vF, hF), P(uc + half, vF, hF), P(uc + half, vF, hD), P(uc - half, vF, hD)] };
  faces.push(front);
  const hTop = hD + depth * pd; // shed: roof height where it meets the main roof
  for (const s of [-1, 1]) faces.push({ kind: 'gable', pts: [P(uc + s * half, vF, hF), P(uc + s * half, vF, hD), P(uc + s * half, vB, d.type === 'gable' ? hD : hTop)] });
  let roofPlan: number;
  let ridgeLength = 0;
  let valleyLength = 0;
  let valleys = 0;
  let rafters: number;
  let rafterLength: number;
  let edges: DormerCalc['edges'];
  let ridge: DormerCalc['ridge'] = null;
  const valleyLines: [Point, Point][] = [];
  const perWall = (len: number) => Math.ceil(len / roof.spacing - 1e-9) + 1;
  if (d.type === 'gable') {
    const hR = hD + ridgeRise;
    faces.push({ kind: 'gable', pts: [P(uc - half, vF, hD), P(uc + half, vF, hD), P(uc, vF, hR)] });
    for (const s of [-1, 1]) faces.push({ kind: 'roof', pts: [P(uc + s * half, vF, hD), P(uc + s * half, vR, hD), P(uc, vR, hR), P(uc, vF, hR)] });
    roofPlan = d.width * depth + (d.width * (back - depth)) / 2;
    ridgeLength = back;
    const v = Math.sqrt(half * half + (back - depth) ** 2 + ridgeRise ** 2);
    valleyLength = 2 * v;
    valleys = 2;
    rafterLength = half * kd;
    rafters = 2 * perWall(depth);
    edges = [
      { name: 'rake', length: half * kd },
      { name: 'rake', length: half * kd },
      { name: 'eave', length: depth },
      { name: 'eave', length: depth },
    ];
    ridge = [P2(uc, vF), P2(uc, vR)];
    for (const s of [-1, 1]) valleyLines.push([P2(uc + s * half, vB), P2(uc, vR)]);
  } else {
    faces.push({ kind: 'roof', pts: [P(uc - half, vF, hD), P(uc + half, vF, hD), P(uc + half, vB, hTop), P(uc - half, vB, hTop)] });
    roofPlan = d.width * depth;
    rafterLength = depth * kd;
    rafters = perWall(d.width);
    edges = [
      { name: 'eave', length: d.width },
      { name: 'rake', length: depth * kd },
      { name: 'rake', length: depth * kd },
    ];
  }
  const outline = [P2(uc - half, vF), P2(uc + half, vF), P2(uc + half, vB), ...(d.type === 'gable' ? [P2(uc, vR)] : []), P2(uc - half, vB)];
  return {
    dormer: d,
    depth,
    outline,
    ridge,
    valleyLines,
    roofArea: roofPlan * kd,
    hiddenArea: roofPlan * km,
    frontArea: d.width * d.height + (d.width * ridgeRise) / 2,
    cheekArea: d.height * depth,
    ridgeLength,
    valleyLength,
    valleys,
    rafters,
    rafterLength,
    edges,
    stepFlashing: 2 * depth * km,
    faces,
  };
}

export const NEXT_SIZE: Record<RafterSize, string> = { '2x6': '2x8', '2x8': '2x10', '2x10': '2x12', '2x12': 'LVL' };

/** Lumber stock length for a piece: even feet, 8'–20'. */
export function stockFeet(inches: number): number {
  return Math.min(20, Math.max(8, 2 * Math.ceil(inches / 24 - 1e-9)));
}

export interface RoofFraming {
  kind: 'trusses' | 'rafters';
  /** Trusses, or common rafters (hip: estimated pieces), over every wing. */
  count: number;
  /** Members bearing on the walls (hurricane ties). */
  bearings: number;
  /** Short jack rafters into the valleys (rafter roofs), and valley truss sets (one per valleyed wing). */
  valleyJacks: number;
  valleySets: number;
  gableEnds: number;
}

export function roofFraming(c: RoofCalc): RoofFraming {
  const sum = (f: (w: RoofWing) => number) => c.wings.reduce((s, w) => s + f(w), 0);
  const trusses = c.roof.framing === 'trusses';
  return {
    kind: c.roof.framing,
    count: sum((w) => (trusses ? w.trusses : w.commons)),
    bearings: sum((w) => w.bearings),
    valleyJacks: trusses ? 0 : sum((w) => w.valleyJacks),
    valleySets: trusses ? c.wings.filter((w) => w.valleys).length : 0,
    gableEnds: sum((w) => w.gableEnds),
  };
}

/** Assumed vent product ratings (net free area) — typical figures, check the product. */
export const VENT_NFA = { ridgePerFoot: 18, louver: 50, edgeIntakePerFoot: 9 };

/** How the vents in the estimate meet the R806.2 vent area. */
export function ventPlan(c: RoofCalc): { ridgeVentFeet: number; louvers: number; edgeIntakeFeet: number; provided: number } {
  const ridgeFeet = Math.floor(c.wings.reduce((s, w) => s + w.ridgeLength, 0) / 12);
  const fromRidge = Math.min(c.vent.exhaust, ridgeFeet * VENT_NFA.ridgePerFoot);
  const ridgeVentFeet = fromRidge > 0 ? Math.min(ridgeFeet, Math.ceil(c.vent.exhaust / VENT_NFA.ridgePerFoot)) : 0;
  const louvers = Math.ceil(Math.max(0, c.vent.exhaust - ridgeVentFeet * VENT_NFA.ridgePerFoot) / VENT_NFA.louver - 1e-9);
  const edgeIntakeFeet = c.roof.overhang > 0 ? 0 : Math.ceil(c.vent.intake / VENT_NFA.edgeIntakePerFoot);
  const provided = ridgeVentFeet * VENT_NFA.ridgePerFoot + louvers * VENT_NFA.louver + (c.roof.overhang > 0 ? c.vent.intake : edgeIntakeFeet * VENT_NFA.edgeIntakePerFoot);
  return { ridgeVentFeet, louvers, edgeIntakeFeet, provided };
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
  const fr = roofFraming(c);
  const spanOf = (x: RoofWing) => `${Math.round(x.W / 12)}' span ${roof.pitch}/12`;
  const bySpan = (f: (x: RoofWing) => number) => {
    const m = new Map<string, number>();
    for (const x of c.wings) m.set(spanOf(x), (m.get(spanOf(x)) ?? 0) + f(x));
    return [...m];
  };
  const wingNote = c.wings.length > 1 ? ` (${c.wings.length} roof wings)` : '';

  if (fr.kind === 'trusses') {
    if (roof.type === 'gable') {
      for (const [span, n] of bySpan((x) => x.trusses - x.gableEnds)) add('Roof', `Roof truss, ${span}`, n, 'ea', `${roof.spacing}" o.c. along the walls${wingNote}; size by the truss supplier`);
      for (const [span, n] of bySpan((x) => x.gableEnds)) add('Roof', `Gable-end truss, ${span}`, n, 'ea', 'one per gable end');
    } else if (roof.type === 'hip') {
      for (const [span, n] of bySpan((x) => x.trusses)) add('Roof', `Hip truss package, ${span}`, n, 'ea', 'girder, step-down and jack trusses — count is the common-truss equivalent; quote from the supplier');
    } else {
      add('Roof', `Mono (shed) truss, ${spanOf(c.wings[0])}`, fr.count, 'ea', `${roof.spacing}" o.c.; size by the truss supplier`);
    }
    add('Roof', 'Valley truss set', fr.valleySets, 'sets', 'one set over the main roof where each wing joins it; quote from the supplier');
  } else {
    const rafters = new Map<number, { n: number; len: number }>();
    for (const x of c.wings) {
      const s = stockFeet(x.rafterLength);
      const cur = rafters.get(s) ?? { n: 0, len: x.rafterLength };
      cur.n += x.commons;
      cur.len = Math.max(cur.len, x.rafterLength);
      rafters.set(s, cur);
    }
    for (const [stock, r] of rafters) {
      const splice = r.len > 240 ? ' (longer than 20\' — splice or engineered)' : '';
      add('Roof', `${roof.rafterSize} rafter, ${stock}'`, Math.ceil(r.n * w), 'ea', `${r.n} rafters ${roof.type === 'hip' ? '(commons + jacks, approx.) ' : ''}at ${roof.spacing}" o.c., ${Math.round(r.len)}" long${splice}${wingNote} ${pct}`);
    }
    if (fr.valleyJacks) add('Roof', `${roof.rafterSize} rafter, ${stockFeet(c.rafterLength / 2)}'`, Math.ceil(fr.valleyJacks * w), 'ea', `${fr.valleyJacks} valley jacks (≈ half a common each) ${pct}`);
    const wingRidge = c.wings.reduce((s, x) => s + x.ridgeLength, 0);
    if (wingRidge > 0) add('Roof', `${NEXT_SIZE[roof.rafterSize]} ridge board, 16'`, Math.ceil(wingRidge / 192), 'ea', `${ft(wingRidge)} ridge, one size deeper than the rafters`);
    if (c.hips > 0) add('Roof', `${NEXT_SIZE[roof.rafterSize]} hip rafter, ${stockFeet(c.hipLength / c.hips)}'`, c.hips, 'ea', `${ft(c.hipLength)} of hips`);
    const wingValleys = c.wings.filter((x) => x.valleys);
    if (wingValleys.length) {
      const v = Math.max(...wingValleys.map((x) => x.valleyLength / 2));
      add('Roof', `${NEXT_SIZE[roof.rafterSize]} valley rafter, ${stockFeet(v)}'`, 2 * wingValleys.length, 'ea', 'two per wing, one size deeper than the rafters');
    }
    if (roof.type !== 'shed') {
      const joists = new Map<number, number>();
      for (const x of c.wings) {
        const s = stockFeet(x.W / (x.W > 240 ? 2 : 1));
        joists.set(s, (joists.get(s) ?? 0) + x.ceilingJoists);
      }
      for (const [s, n] of joists) add('Roof', `${roof.rafterSize} ceiling joist, ${s}'`, n, 'ea', `one per rafter pair, lapped over a bearing wall when the span exceeds 20'; size per R802 tables`);
    }
  }
  add('Roof', 'Hurricane tie', fr.bearings, 'ea', 'one per rafter / truss bearing on a wall');

  // Dormers: their own framing, walls and flashing; their roof is in the totals below.
  if (c.dormers.length) {
    const n = c.dormers.length;
    const dr = c.dormers.reduce((s, d) => s + d.rafters, 0);
    const dLen = Math.max(...c.dormers.map((d) => d.rafterLength));
    const trussNote = roof.framing === 'trusses' ? '; the trusses under a dormer need the supplier to rework them' : '';
    add('Roof', `${roof.rafterSize} dormer rafter, ${stockFeet(dLen)}'`, Math.ceil(dr * w), 'ea', `${dr} rafters over ${n} dormer${n > 1 ? 's' : ''} ${pct}${trussNote}`);
    if (roof.framing === 'rafters') add('Roof', `${roof.rafterSize} rafter, ${stockFeet(c.rafterLength)}'`, 2 * n, 'ea', 'doubled main-roof rafters (trimmers) beside each dormer opening');
    const dv = c.dormers.filter((d) => d.valleys).length;
    if (dv) add('Roof', `${NEXT_SIZE[roof.rafterSize]} valley rafter, ${stockFeet(Math.max(...c.dormers.map((d) => d.valleyLength / 2)))}'`, 2 * dv, 'ea', 'two per gable dormer');
    const wallArea = c.dormers.reduce((s, d) => s + d.frontArea + d.cheekArea, 0);
    const studs = c.dormers.reduce((s, d) => s + Math.ceil(d.dormer.width / 16) + 1 + 2 * Math.ceil(d.depth / 16), 0);
    add('Lumber', "2x4 dormer wall stud, 8'", Math.ceil(studs * w), 'ea', `front and cheek walls at 16" o.c., cut to the roof slope ${pct}`);
    const plate = c.dormers.reduce((s, d) => s + 2 * (d.dormer.width + 2 * d.depth), 0);
    add('Lumber', "2x4 dormer plate, 16'", Math.ceil((plate * w) / 192), 'ea', `${ft(plate)} of plates ${pct}`);
    add('Sheathing', '7/16" OSB dormer wall sheathing, 4×8', Math.ceil(((wallArea / 144) * w) / 32), 'sheets', `${Math.round(wallArea / 144)} sq ft of dormer front and cheek walls ${pct} (window not included)`);
    const step = c.dormers.reduce((s, d) => s + d.stepFlashing, 0);
    add('Roof', 'Step flashing, 100 pc', Math.ceil(step / 5 / 100), 'boxes', `${ft(step)} where the cheek walls meet the roof, one per ~5" shingle course`);
  }

  const sq = c.area / 144;
  add('Roof', '7/16" OSB roof sheathing, 4×8', Math.ceil((sq * w) / 32), 'sheets', `${Math.round(sq)} sq ft roof ${pct}`);
  add('Roof', 'Synthetic underlayment, 10 sq roll', Math.ceil((sq * w) / 1000), 'rolls', `${c.squares.toFixed(1)} squares ${pct}`);
  add('Roof', 'Architectural shingles, bundle', Math.ceil(c.squares * w * 3), 'bundles', `3 bundles per square ${pct}`);
  add('Roof', 'Starter strip shingles, bundle', Math.ceil((c.eaveLength + c.rakeLength) / 12 / 100), 'bundles', `${ft(c.eaveLength + c.rakeLength)} of eaves + rakes, ~100 LF per bundle (check product)`);
  if (c.ridgeLength + c.hipLength > 0) add('Roof', 'Hip & ridge cap shingles, bundle', Math.ceil((c.ridgeLength + c.hipLength) / 12 / 25), 'bundles', `${ft(c.ridgeLength + c.hipLength)}, ~25 LF per bundle (check product)`);
  if (c.valleyLength > 0) add('Roof', 'Ice & water shield, valley roll', Math.ceil((c.valleyLength * 1.1) / 12 / 65), 'rolls', `${ft(c.valleyLength)} of valleys (${c.valleys}), a 36" strip down each, ~65 LF per roll (check product)`);
  const edge = c.edges.reduce((s, e) => s + e.length, 0);
  add('Roof', "Drip edge, 10'", Math.ceil((edge * 1.05) / 120), 'pieces', `${ft(edge)} of roof edge +5% laps`);
  add('Roof', "2x6 fascia, 16'", Math.ceil((edge * w) / 192), 'ea', `${ft(edge)} ${pct}`);
  const v = c.vent;
  const vp = ventPlan(c);
  const std = standardsOf(project);
  const ventBasis = `R806.2: ${Math.round(v.atticArea / 144)} sq ft attic ÷ ${v.ratio} = ${Math.round(v.required)} sq in net free area, half high / half low`;
  const soffit = roof.overhang > 0 ? (c.eaveLength * roof.overhang) / 144 : 0;
  if (std.roofVent === 'sealed') {
    // Sealed roof-to-wall junction and ridge: no vents, a solid soffit.
    if (soffit) add('Roof', 'Solid soffit', Math.ceil(soffit * w), 'sq ft', `${ft(c.eaveLength)} of eave × ${roof.overhang}" overhang ${pct}; sealed eaves (Project setup), no intake`);
  } else {
    if (soffit) add('Roof', 'Vented soffit', Math.ceil(soffit * w), 'sq ft', `${ft(c.eaveLength)} of eave × ${roof.overhang}" overhang ${pct}; intake needs ${Math.round(v.intake)} sq in net free area — check the panel's rating`);
    add('Roof', "Ridge vent, 4'", Math.ceil(vp.ridgeVentFeet / 4), 'pieces', `${vp.ridgeVentFeet} LF of ridge at ~${VENT_NFA.ridgePerFoot} sq in/LF (check product). ${ventBasis}`);
    add('Roof', 'Roof louver vent', vp.louvers, 'ea', `exhaust the ridge vent can't supply, ~${VENT_NFA.louver} sq in each (check product). ${ventBasis}`);
    add('Roof', "Edge intake vent, 4'", Math.ceil(vp.edgeIntakeFeet / 4), 'pieces', `no soffit to vent through: ${Math.round(v.intake)} sq in intake at ~${VENT_NFA.edgeIntakePerFoot} sq in/LF (check product)`);
    if (std.attic === 'cold') add('Roof', 'Rafter vent baffle', Math.ceil(c.eaveLength / 24), 'ea', `one per rafter bay at the eaves (24" o.c.), so the ceiling insulation doesn't block the soffit intake`);
  }
  // Where the insulation goes: on the ceiling (cold roof) or at the roof deck (warm roof).
  if (std.attic === 'warm')
    add('Insulation & wrap', 'Closed-cell spray foam at the roof deck (allowance)', Math.ceil(c.area / 144), 'sq ft', `warm roof (Project setup): ${Math.round(c.area / 144)} sq ft of roof deck, to your climate zone's R-value (N1102.1.2)${std.roofVent === 'sealed' ? '; air-impermeable at the deck for an unvented attic (R806.5)' : ''}`);
  else add('Insulation & wrap', 'Blown-in attic insulation at the ceiling (allowance)', Math.ceil(v.atticArea / 144), 'sq ft', `cold roof (Project setup): ${Math.round(v.atticArea / 144)} sq ft of attic floor, to your climate zone's ceiling R-value (N1102.1.2)`);
  if (c.gableArea > 0) add('Sheathing', '7/16" OSB gable-end sheathing, 4×8', Math.ceil(((c.gableArea / 144) * w) / 32), 'sheets', `${Math.round(c.gableArea / 144)} sq ft of wall above the plate ${pct}`);
  return lines;
}

/** A roof member for the cut list: `count` pieces of `length` (a `run` is split onto stock lengths). */
export interface RoofMember {
  size: string;
  length: number;
  count: number;
  label: string;
  run?: boolean;
}

/** Roof edges that take fascia, each with its length (eaves and rakes, dormers included). */
export function roofEdges(c: RoofCalc): { name: string; length: number }[] {
  return c.edges;
}

/**
 * Roof members cut from dimensional stock. Rafter roofs: common rafters (hip
 * roofs: commons + jacks at common length — an over-count), valley jacks,
 * ridge boards, hips, valleys and ceiling joists, by wing, and dormer rafters;
 * every roof: 2x6 fascia along its edges. Trusses are ordered made.
 */
export function roofCutMembers(project: Project): RoofMember[] {
  const c = roofCalc(project);
  if (!c) return [];
  const { roof } = c;
  const out: RoofMember[] = [];
  const big = NEXT_SIZE[roof.rafterSize];
  if (roof.framing === 'rafters') {
    c.wings.forEach((w, i) => {
      const tag = c.wings.length > 1 ? (i ? `wing ${i} ` : 'main ') : '';
      out.push({ size: roof.rafterSize, length: w.rafterLength, count: w.commons, label: `${tag}${roof.type === 'hip' ? 'rafter (common / jack)' : 'rafter'}` });
      if (w.valleyJacks) out.push({ size: roof.rafterSize, length: w.rafterLength / 2, count: w.valleyJacks, label: `${tag}valley jack` });
      if (w.ridgeLength > 0) out.push({ size: big, length: w.ridgeLength, count: 1, label: `${tag}ridge`, run: true });
      if (w.hips) out.push({ size: big, length: w.hipLength / w.hips, count: w.hips, label: `${tag}hip rafter` });
      if (w.valleys) out.push({ size: big, length: w.valleyLength / 2, count: 2, label: `${tag}valley rafter` });
      if (roof.type !== 'shed') {
        const pieces = w.W > 240 ? 2 : 1;
        out.push({ size: roof.rafterSize, length: w.W / pieces, count: w.ceilingJoists, label: `${tag}ceiling joist` });
      }
    });
  }
  c.dormers.forEach((d, i) => {
    out.push({ size: roof.rafterSize, length: d.rafterLength, count: d.rafters, label: `dormer ${i + 1} rafter` });
    if (d.ridgeLength > 0) out.push({ size: big, length: d.ridgeLength, count: 1, label: `dormer ${i + 1} ridge`, run: true });
    if (d.valleys) out.push({ size: big, length: d.valleyLength / 2, count: 2, label: `dormer ${i + 1} valley rafter` });
  });
  for (const e of c.edges) out.push({ size: '2x6', length: e.length, count: 1, label: `fascia (${e.name})`, run: true });
  return out;
}

/** The roof in plan for the print sheet: overhung outline, ridges, hips, valleys, dormers. */
export interface RoofPlan {
  outline: [Point, Point][];
  ridges: [Point, Point][];
  hips: [Point, Point][];
  valleys: [Point, Point][];
  dormers: { outline: Point[]; ridge: [Point, Point] | null; valleys: [Point, Point][] }[];
  /** Where to write each wing's pitch, and which way it runs. */
  labels: { at: Point; text: string }[];
}

export function roofPlan(project: Project): RoofPlan | null {
  const c = roofCalc(project);
  if (!c) return null;
  const { roof } = c;
  const o = roof.overhang;
  const plan: RoofPlan = { outline: c.outline, ridges: [], hips: [], valleys: [], dormers: [], labels: [] };
  for (const w of c.wings) {
    const { u0, u1, v0, v1, mid, P2 } = frame(w);
    plan.labels.push({ at: P2((u0 + u1) / 2, (v0 + mid) / 2), text: `${roof.pitch}/12` });
    if (roof.type === 'shed') continue;
    const [lo, hi] = wingEnds(w, roof);
    if (hi.ridge - lo.ridge > 0.5) plan.ridges.push([P2(lo.ridge, mid), P2(hi.ridge, mid)]);
    for (const [e, end] of [[lo, w.ends[0]], [hi, w.ends[1]]] as const) {
      const r = Math.min(Math.max(e.ridge, lo.ridge), hi.ridge);
      if (end === 'hip') for (const v of [v0 - o, v1 + o]) plan.hips.push([P2(e.eave, v), P2(r, mid)]);
    }
    if (w.valleys) {
      const low = w.ends[0] === 'open';
      const eaveU = low ? u0 + o : u1 - o;
      const top = low ? lo.ridge : hi.ridge;
      for (const v of [v0 - o, v1 + o]) plan.valleys.push([P2(eaveU, v), P2(top, mid)]);
    }
  }
  for (const d of c.dormers) plan.dormers.push({ outline: d.outline, ridge: d.ridge, valleys: d.valleyLines });
  return plan;
}

/** Where a wing's eave and ridge stop at each end, along u. */
function wingEnds(w: RoofWing, roof: Roof): [{ eave: number; ridge: number }, { eave: number; ridge: number }] {
  const { u0, u1 } = frame(w);
  const o = roof.overhang;
  const at = (e: EndKind, wall: number, out: 1 | -1) => {
    if (e === 'gable') return { eave: wall + out * roof.rake, ridge: wall + out * roof.rake };
    if (e === 'hip') return { eave: wall + out * o, ridge: wall - out * (w.W / 2) };
    if (e === 'open') return { eave: wall + out * (w.W / 2), ridge: wall + out * (w.W / 2) };
    return { eave: wall, ridge: wall };
  };
  const lo = at(w.ends[0], u0, -1);
  const hi = at(w.ends[1], u1, 1);
  if (lo.ridge > hi.ridge) lo.ridge = hi.ridge = (lo.ridge + hi.ridge) / 2;
  return [lo, hi];
}

/** 3D surfaces of the roof (plan x → X, plan y → Z, up = Y), dormers included. */
export function roofFaces(project: Project): RoofFace[] {
  const c = roofCalc(project);
  if (!c) return [];
  const { roof } = c;
  const p = roof.pitch / 12;
  const o = roof.overhang;
  const eave = c.plate - o * p;
  const faces: RoofFace[] = [];
  for (const w of c.wings) {
    const { u0, u1, v0, v1, mid, P2 } = frame(w);
    const P = (u: number, v: number, h: number): V3 => {
      const q = P2(u, v);
      return [q.x, h, q.y];
    };
    const top = c.plate + w.rise;
    if (roof.type === 'shed') {
      // Shed: low along v0, high along v1.
      const hi = c.plate + w.rise + o * p;
      const [a, b] = [u0 - roof.rake, u1 + roof.rake];
      faces.push({ kind: 'roof', pts: [P(a, v0 - o, eave), P(b, v0 - o, eave), P(b, v1 + o, hi), P(a, v1 + o, hi)] });
      for (const g of [u0, u1]) faces.push({ kind: 'gable', pts: [P(g, v0, c.plate), P(g, v1, c.plate), P(g, v1, c.plate + w.rise)] });
      faces.push({ kind: 'gable', pts: [P(u0, v1, c.plate), P(u1, v1, c.plate), P(u1, v1, c.plate + w.rise), P(u0, v1, c.plate + w.rise)] });
      continue;
    }
    const [lo, hi] = wingEnds(w, roof);
    faces.push({ kind: 'roof', pts: [P(lo.eave, v0 - o, eave), P(hi.eave, v0 - o, eave), P(hi.ridge, mid, top), P(lo.ridge, mid, top)] });
    faces.push({ kind: 'roof', pts: [P(lo.eave, v1 + o, eave), P(hi.eave, v1 + o, eave), P(hi.ridge, mid, top), P(lo.ridge, mid, top)] });
    for (const [e, end, wall] of [[lo, w.ends[0], u0], [hi, w.ends[1], u1]] as const) {
      if (end === 'hip') faces.push({ kind: 'roof', pts: [P(e.eave, v0 - o, eave), P(e.eave, v1 + o, eave), P(e.ridge, mid, top)] });
      if (end === 'gable') faces.push({ kind: 'gable', pts: [P(wall, v0, c.plate), P(wall, v1, c.plate), P(wall, mid, top)] });
    }
  }
  for (const d of c.dormers) faces.push(...d.faces);
  return faces;
}
