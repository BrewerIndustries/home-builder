import { adjacentStorey, storeyElevation, storeyList, storeyView } from '../model/storeys.ts';
import { DEFAULT_LOWER_ROOF, type LowerRoof, type Point, type Project, standardsOf, type Wall } from '../model/types.ts';
import type { CodeCheck } from './irc.ts';
import type { MaterialLine } from './materials.ts';
import { distinct, footprintRects, greedyRects, NEXT_SIZE, roofCalc, roofFaces, roofLines, roofOf, stockFeet, type Rect, type RoofCalc, type RoofFace, type Side, type V3 } from './roof.ts';

// Lower roofs: where the storey above is pulled back (or smaller), the part of
// a storey it doesn't cover needs its own roof. Each uncovered stretch is roofed
// as a lean-to (a shed roof against the wall above): a ledger on that wall, the
// rafters running down to the outside wall, an eave there, rakes at free ends,
// and flashing where the roof meets the wall above. Inches; elevations are from
// the storey's own floor.

export function lowerRoofOf(p: Project, storeyId: string): LowerRoof {
  const s = storeyList(p).find((x) => x.id === storeyId);
  return { ...DEFAULT_LOWER_ROOF, ...s?.lowerRoof };
}

/** What lies past each side of an uncovered rectangle: the storey above's wall, more uncovered roof, or open air. */
type SideKind = 'wall' | 'roof' | 'free';
const SIDES: Side[] = ['n', 's', 'e', 'w'];

export interface LeanTo {
  /** The uncovered area, at the walls' centrelines. */
  rect: Rect;
  sides: Record<Side, SideKind>;
  /** The side the roof rises to (against the wall above). */
  high: Side;
  /** Wall-line length along the high side, and horizontal run from the low wall's face to the high edge. */
  L: number;
  run: number;
  rise: number;
  /** Top of the lower storey's walls, and of the roof where it meets the wall above (from this storey's floor). */
  plate: number;
  top: number;
  /** Sloped roof surface (overhangs included), sq in. */
  area: number;
  /** Eave (low side), rakes (free ends, sloped), headwall (against the wall above), and sidewall (ends against a wall, sloped). */
  eave: number;
  rakes: number[];
  headwall: number;
  sidewall: number;
  rafters: number;
  rafterLength: number;
  /** Infill wall above the plate at free ends (and a free high side), sq in. */
  gableArea: number;
  faces: RoofFace[];
}

const inside = (rects: Rect[], q: Point) => rects.some((r) => q.x > r.x0 && q.x < r.x1 && q.y > r.y0 && q.y < r.y1);

/** Outward unit normal of a side. */
const OUT: Record<Side, Point> = { n: { x: 0, y: -1 }, s: { x: 0, y: 1 }, w: { x: -1, y: 0 }, e: { x: 1, y: 0 } };

/** The parts of a storey the storey above doesn't cover, as rectangles (centrelines), largest first. */
export function uncoveredRects(p: Project, storeyId: string): { rects: Rect[]; lower: Rect[]; upper: Rect[] } | null {
  const up = adjacentStorey(p, 1, storeyId);
  if (!up) return null;
  const lower = footprintRects(storeyView(p, storeyId));
  const upper = footprintRects(storeyView(p, up.id));
  if (!lower || !upper) return null;
  const xs = distinct([...lower, ...upper].flatMap((r) => [r.x0, r.x1]));
  const ys = distinct([...lower, ...upper].flatMap((r) => [r.y0, r.y1]));
  const free = xs.slice(0, -1).map((x0, i) =>
    ys.slice(0, -1).map((y0, j) => {
      const c = { x: (x0 + xs[i + 1]) / 2, y: (y0 + ys[j + 1]) / 2 };
      return inside(lower, c) && !inside(upper, c);
    }),
  );
  // A sliver (two walls a few inches apart) is not a roof.
  const rects = greedyRects(xs, ys, free).filter((r) => Math.min(r.x1 - r.x0, r.y1 - r.y0) >= 24);
  return { rects, lower, upper };
}

/** One uncovered rectangle with what lies past each side, the side facing the storey above, and the wall sizes it sits on. */
export interface UncoveredPart {
  rect: Rect;
  sides: Record<Side, SideKind>;
  /** The side against the wall above (or, touching none, facing the middle of the storey above). */
  high: Side;
  /** Half thickness of this storey's and the upper storey's exterior walls; top of this storey's walls. */
  tLow: number;
  tUp: number;
  plate: number;
}

/** The uncovered rectangles of a storey, each classified side by side. */
export function uncoveredParts(p: Project, storeyId: string): UncoveredPart[] {
  const u = uncoveredRects(p, storeyId);
  if (!u?.rects.length) return [];
  const view = storeyView(p, storeyId);
  const upView = storeyView(p, adjacentStorey(p, 1, storeyId)!.id);
  const ext = view.walls.filter((w) => w.kind === 'exterior');
  const upExt = upView.walls.filter((w) => w.kind === 'exterior');
  const tLow = Math.max(...ext.map((w) => w.thickness)) / 2;
  const tUp = upExt.length ? Math.max(...upExt.map((w) => w.thickness)) / 2 : tLow;
  const plate = Math.max(...ext.map((w) => w.height));
  const centre = (() => {
    const a = u.upper.reduce((t, r) => t + (r.x1 - r.x0) * (r.y1 - r.y0), 0);
    return {
      x: u.upper.reduce((t, r) => t + ((r.x0 + r.x1) / 2) * (r.x1 - r.x0) * (r.y1 - r.y0), 0) / a,
      y: u.upper.reduce((t, r) => t + ((r.y0 + r.y1) / 2) * (r.x1 - r.x0) * (r.y1 - r.y0), 0) / a,
    };
  })();
  return u.rects.map((rect) => {
    // What's past each side, by majority of samples 6" out.
    const count: Record<Side, Record<SideKind, number>> = { n: { wall: 0, roof: 0, free: 0 }, s: { wall: 0, roof: 0, free: 0 }, e: { wall: 0, roof: 0, free: 0 }, w: { wall: 0, roof: 0, free: 0 } };
    for (const s of SIDES) {
      const n = OUT[s];
      for (let i = 0; i < 9; i++) {
        const t = (i + 0.5) / 9;
        const base = s === 'n' || s === 's' ? { x: rect.x0 + (rect.x1 - rect.x0) * t, y: s === 'n' ? rect.y0 : rect.y1 } : { x: s === 'w' ? rect.x0 : rect.x1, y: rect.y0 + (rect.y1 - rect.y0) * t };
        const q = { x: base.x + n.x * 6, y: base.y + n.y * 6 };
        count[s][inside(u.upper, q) ? 'wall' : inside(u.lower, q) ? 'roof' : 'free']++;
      }
    }
    const sides = Object.fromEntries(SIDES.map((s) => [s, (['wall', 'roof', 'free'] as SideKind[]).sort((a, b) => count[s][b] - count[s][a])[0]])) as Record<Side, SideKind>;
    const mid = { x: (rect.x0 + rect.x1) / 2, y: (rect.y0 + rect.y1) / 2 };
    const toward = (s: Side) => OUT[s].x * (centre.x - mid.x) + OUT[s].y * (centre.y - mid.y);
    const high = [...SIDES].sort((a, b) => count[b].wall - count[a].wall || toward(b) - toward(a))[0];
    return { rect, sides, high, tLow, tUp, plate };
  });
}

/** The lean-to roofs over the parts of this storey the storey above doesn't cover. Empty unless the lower roof is a lean-to. */
export function leanTos(p: Project, storeyId: string): LeanTo[] {
  const lr = lowerRoofOf(p, storeyId);
  if (lr.type !== 'lean-to') return [];
  const main = roofOf(p);
  const pitch = lr.pitch / 12;
  const k = Math.sqrt(1 + pitch * pitch);
  const { overhang: o, rake } = lr;
  return uncoveredParts(p, storeyId).map(({ rect, sides, high, tLow, tUp, plate }) => {
    const low: Side = ({ n: 's', s: 'n', e: 'w', w: 'e' } as const)[high];
    const alongX = high === 'n' || high === 's';
    // Local frame: u along the high wall, v rising from the low side to the high side.
    const sign = high === 's' || high === 'e' ? 1 : -1;
    const toV = (c: number) => sign * c;
    const P = (uu: number, v: number, h: number): V3 => {
      const c = sign * v;
      return alongX ? [uu, h, c] : [c, h, uu];
    };
    const [c0, c1] = alongX ? [rect.y0, rect.y1] : [rect.x0, rect.x1];
    const vLow = Math.min(toV(c0), toV(c1));
    const vHigh = Math.max(toV(c0), toV(c1));
    const [u0, u1] = alongX ? [rect.x0, rect.x1] : [rect.y0, rect.y1];
    const [endA, endB]: [Side, Side] = alongX ? ['w', 'e'] : ['n', 's'];
    // Faces of the walls (wall above: its outer face sits inside this rectangle).
    const face = (kind: SideKind) => (kind === 'free' ? tLow : kind === 'wall' ? -tUp : 0);
    const lowFace = vLow - face(sides[low]);
    const eaveV = lowFace - (sides[low] === 'free' ? o : 0);
    const highFace = vHigh + face(sides[high]);
    const highEdge = highFace + (sides[high] === 'free' ? o : 0);
    const uA = u0 - face(sides[endA]) - (sides[endA] === 'free' ? rake : 0);
    const uB = u1 + face(sides[endB]) + (sides[endB] === 'free' ? rake : 0);
    const h = (v: number) => plate + (v - lowFace) * pitch;
    const run = highFace - lowFace;
    const rise = run * pitch;
    const L = uB - uA;
    const slope = (highEdge - eaveV) * k;
    const faces: RoofFace[] = [{ kind: 'roof', pts: [P(uA, eaveV, h(eaveV)), P(uB, eaveV, h(eaveV)), P(uB, highEdge, h(highEdge)), P(uA, highEdge, h(highEdge))] }];
    let gableArea = 0;
    const rakes: number[] = [];
    let sidewall = 0;
    for (const [end, wallU] of [
      [endA, u0 - tLow],
      [endB, u1 + tLow],
    ] as const) {
      if (sides[end] === 'free') {
        faces.push({ kind: 'gable', pts: [P(wallU, lowFace, plate), P(wallU, highFace, plate), P(wallU, highFace, h(highFace))] });
        gableArea += (run * rise) / 2;
        rakes.push(slope);
      } else if (sides[end] === 'wall') sidewall += (highFace - lowFace) * k;
    }
    if (sides[high] === 'free') {
      faces.push({ kind: 'gable', pts: [P(u0 - tLow, highFace, plate), P(u1 + tLow, highFace, plate), P(u1 + tLow, highFace, h(highFace)), P(u0 - tLow, highFace, h(highFace))] });
      gableArea += (u1 - u0 + 2 * tLow) * rise;
    }
    return {
      rect,
      sides,
      high,
      L,
      run,
      rise,
      plate,
      top: h(highFace),
      area: L * (highEdge - eaveV) * k,
      eave: sides[low] === 'free' ? L : 0,
      rakes,
      headwall: sides[high] === 'wall' ? L : 0,
      sidewall,
      rafters: Math.ceil(L / main.spacing - 1e-9) + 1,
      rafterLength: slope,
      gableArea,
      faces,
    };
  });
}

/**
 * A gable or hip lower roof: the main roof's engine run on the uncovered rectangle alone, its sides against the
 * wall above (or more uncovered roof) butting with no overhang. The ridge runs along the wall above (the slope
 * behind drains toward that wall) or out from it (a gable end, or the hip's ridge, dies into the wall).
 */
export interface PitchedLowerRoof {
  part: UncoveredPart;
  /** The rectangle as a one-storey project with its own roof, for the roof engine. */
  project: Project;
  calc: RoofCalc;
  faces: RoofFace[];
  /** The ridge runs along the wall above. */
  parallel: boolean;
}

export function pitchedLowerRoofs(p: Project, storeyId: string): PitchedLowerRoof[] {
  const lr = lowerRoofOf(p, storeyId);
  if (lr.type !== 'gable' && lr.type !== 'hip') return [];
  const view = storeyView(p, storeyId);
  const tpl = view.walls.find((w) => w.kind === 'exterior')!;
  const out: PitchedLowerRoof[] = [];
  for (const part of uncoveredParts(p, storeyId)) {
    const { rect, sides, high, tLow, tUp, plate } = part;
    // Against the wall above, the roof's wall line steps in so its outer face is the upper wall's outer face.
    const inset = (s: Side) => (sides[s] === 'wall' ? tUp + tLow : 0);
    const r = { x0: rect.x0 + inset('w'), x1: rect.x1 - inset('e'), y0: rect.y0 + inset('n'), y1: rect.y1 - inset('s') };
    const corners: Point[] = [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }];
    const walls: Wall[] = corners.map((a, i) => ({ ...tpl, id: `lr_${i}`, a, b: corners[(i + 1) % 4], kind: 'exterior', height: plate, thickness: 2 * tLow }));
    const parallel = (lr.ridge ?? 'parallel') === 'parallel';
    const highAlongX = high === 'n' || high === 's';
    const roof = {
      ...roofOf(p),
      type: lr.type,
      pitch: lr.pitch,
      overhang: lr.overhang,
      rake: lr.rake,
      ridge: (highAlongX === parallel ? 'x' : 'y') as 'x' | 'y',
      perWing: false,
      dormers: [],
      butt: SIDES.filter((s) => sides[s] !== 'free'),
    };
    const project: Project = { ...view, walls, openings: [], roof };
    const calc = roofCalc(project);
    if (!calc) continue;
    out.push({ part, project, calc, faces: roofFaces(project), parallel });
  }
  return out;
}

/** A storey's lower-roof faces, from its own floor. */
export function lowerRoofFacesOf(p: Project, storeyId: string): RoofFace[] {
  return [...leanTos(p, storeyId).flatMap((l) => l.faces), ...pitchedLowerRoofs(p, storeyId).flatMap((r) => r.faces)];
}

/** Every lower roof's 3D faces, lifted to its storey's floor. */
export function lowerRoofFaces(p: Project): RoofFace[] {
  return storeyList(p).flatMap((s) => {
    const e = storeyElevation(p, s.id);
    return lowerRoofFacesOf(p, s.id).map((f) => ({ ...f, pts: f.pts.map(([x, y, z]): V3 => [x, y + e, z]) }));
  });
}

/** Where each lower roof meets the wall above: its line, the stretch along it, and the roof's height there (from this storey's floor) at a point along it. */
export interface WallMeet {
  side: Side;
  line: number;
  u0: number;
  u1: number;
  topAt(u: number): number;
}

export function wallMeets(p: Project, storeyId: string): WallMeet[] {
  const along = (side: Side, r: Rect) => (side === 'n' || side === 's' ? [r.x0, r.x1] : [r.y0, r.y1]);
  const lineOf = (side: Side, r: Rect) => (side === 'n' ? r.y0 : side === 's' ? r.y1 : side === 'w' ? r.x0 : r.x1);
  const out: WallMeet[] = [];
  for (const l of leanTos(p, storeyId)) {
    if (l.sides[l.high] !== 'wall') continue;
    const [u0, u1] = along(l.high, l.rect);
    out.push({ side: l.high, line: lineOf(l.high, l.rect), u0, u1, topAt: () => l.top });
  }
  for (const r of pitchedLowerRoofs(p, storeyId)) {
    const { part, calc, parallel } = r;
    if (part.sides[part.high] !== 'wall') continue;
    const [u0, u1] = along(part.high, part.rect);
    const pitch = calc.roof.pitch / 12;
    const w = calc.wings[0];
    const [a, b] = along(part.high, w.rect);
    const mid = (a + b) / 2;
    // Ridge along the wall: the slope behind comes down to the wall at the plate. Out from it: the roof's cross-section.
    const topAt = parallel ? () => calc.plate : (u: number) => calc.plate + Math.max(0, (b - a) / 2 - Math.abs(u - mid)) * pitch;
    out.push({ side: part.high, line: lineOf(part.high, part.rect), u0, u1, topAt });
  }
  return out;
}

/** The lower roofs' lines for the estimate, for one storey. */
export function lowerRoofLines(p: Project, storeyId: string): MaterialLine[] {
  const lr = lowerRoofOf(p, storeyId);
  if (lr.type === 'gable' || lr.type === 'hip') return pitchedLines(p, storeyId);
  return leanToLines(p, storeyId);
}

function pitchedLines(p: Project, storeyId: string): MaterialLine[] {
  const rs = pitchedLowerRoofs(p, storeyId);
  const lines: MaterialLine[] = [];
  for (const r of rs) {
    const what = `lower ${r.calc.roof.type} roof`;
    for (const l of roofLines(r.project, p.framing.waste)) lines.push({ ...l, basis: `${what}: ${l.basis}` });
    const { part, calc } = r;
    const w = calc.wings[0];
    const k = calc.k;
    const ft = (n: number) => `${Math.round(n / 12)} LF`;
    const wallSides = SIDES.filter((s) => part.sides[s] === 'wall');
    for (const s of wallSides) {
      const longSide = (s === 'n' || s === 's') === w.alongX;
      const len = s === 'n' || s === 's' ? w.rect.x1 - w.rect.x0 : w.rect.y1 - w.rect.y0;
      if (longSide) {
        // The slope runs down into the wall: a cricket / gutter along it, flashed up the wall.
        lines.push({ category: 'Roof', item: "Apron (headwall) flashing, 10'", qty: Math.ceil((len * 1.05) / 120), unit: 'pieces', basis: `${what}: ${ft(len)} where its back slope meets the wall above` });
        lines.push({ category: 'Roof', item: 'Ice & water shield, valley roll', qty: Math.ceil(len / 12 / 65), unit: 'rolls', basis: `${what}: a 36" strip along the wall above, where water runs to it` });
      } else {
        const slope = w.W * k;
        lines.push({ category: 'Roof', item: 'Step flashing, 100 pc', qty: Math.ceil(slope / 5 / 100), unit: 'boxes', basis: `${what}: ${ft(slope)} up both slopes where its end meets the wall above` });
      }
    }
  }
  return lines;
}

function leanToLines(p: Project, storeyId: string): MaterialLine[] {
  const ls = leanTos(p, storeyId);
  if (!ls.length) return [];
  const lr = lowerRoofOf(p, storeyId);
  const main = roofOf(p);
  const waste = p.framing.waste;
  const w = 1 + waste;
  const pct = `+${Math.round(waste * 100)}% waste`;
  const lines: MaterialLine[] = [];
  const add = (category: MaterialLine['category'], item: string, qty: number, unit: string, basis: string) => qty > 0 && lines.push({ category, item, qty, unit, basis });
  const ft = (n: number) => `${Math.round(n / 12)} LF`;
  const sum = (f: (l: LeanTo) => number) => ls.reduce((t, l) => t + f(l), 0);
  const n = ls.length;
  const what = `${n} lean-to roof${n > 1 ? 's' : ''} at ${lr.pitch}/12`;

  const rafters = sum((l) => l.rafters);
  const len = Math.max(...ls.map((l) => l.rafterLength));
  add('Roof', `${main.rafterSize} rafter, ${stockFeet(len)}'`, Math.ceil(rafters * w), 'ea', `${rafters} lean-to rafters at ${main.spacing}" o.c., ${Math.round(len)}" long (${what}); size per R802 tables ${pct}`);
  const head = sum((l) => l.headwall);
  if (head > 0) {
    add('Roof', `${NEXT_SIZE[main.rafterSize]} ledger, 16'`, Math.ceil(head / 192), 'ea', `${ft(head)} along the wall above, bolted through to its rim / framing; rafters hang on it`);
    add('Roof', 'Joist hanger (rafter to ledger)', rafters, 'ea', 'one per lean-to rafter at the ledger');
    add('Roof', "Apron (headwall) flashing, 10'", Math.ceil((head * 1.05) / 120), 'pieces', `${ft(head)} where the lean-to meets the wall above, under the siding / housewrap`);
  }
  const side = sum((l) => l.sidewall);
  if (side > 0) add('Roof', 'Step flashing, 100 pc', Math.ceil(side / 5 / 100), 'boxes', `${ft(side)} where a lean-to's end runs up a wall, one per ~5" shingle course`);
  add('Roof', 'Hurricane tie', rafters, 'ea', 'one per lean-to rafter on the outside wall');
  const joists = new Map<number, number>();
  for (const l of ls) joists.set(stockFeet(l.run), (joists.get(stockFeet(l.run)) ?? 0) + l.rafters);
  for (const [len, n] of joists) add('Roof', `${main.rafterSize} ceiling joist, ${len}'`, n, 'ea', `under the lean-to, one per rafter, outside wall to the wall above; size per R802 tables`);

  const sq = sum((l) => l.area) / 144;
  const squares = sq / 100;
  const lowSlope = lr.pitch < 4;
  add('Roof', '7/16" OSB roof sheathing, 4×8', Math.ceil((sq * w) / 32), 'sheets', `${Math.round(sq)} sq ft of lean-to roof ${pct}`);
  add('Roof', 'Synthetic underlayment, 10 sq roll', Math.ceil((sq * w * (lowSlope ? 2 : 1)) / 1000), 'rolls', `${squares.toFixed(1)} squares of lean-to ${lowSlope ? '× 2 layers (under 4/12, R905.2.2) ' : ''}${pct}`);
  add('Roof', 'Architectural shingles, bundle', Math.ceil(squares * w * 3), 'bundles', `lean-to: 3 bundles per square ${pct}`);
  const eave = sum((l) => l.eave);
  const rakeLen = sum((l) => l.rakes.reduce((t, r) => t + r, 0));
  add('Roof', 'Starter strip shingles, bundle', Math.ceil((eave + rakeLen) / 12 / 100), 'bundles', `lean-to: ${ft(eave + rakeLen)} of eaves + rakes`);
  const edge = eave + rakeLen;
  add('Roof', "Drip edge, 10'", Math.ceil((edge * 1.05) / 120), 'pieces', `lean-to: ${ft(edge)} of roof edge +5% laps`);
  add('Roof', "2x6 fascia, 16'", Math.ceil((edge * w) / 192), 'ea', `lean-to: ${ft(edge)} ${pct}`);
  const soffit = lr.overhang > 0 ? (eave * lr.overhang) / 144 : 0;
  if (soffit) add('Roof', standardsOf(p).roofVent === 'sealed' ? 'Solid soffit' : 'Vented soffit', Math.ceil(soffit * w), 'sq ft', `lean-to: ${ft(eave)} of eave × ${lr.overhang}" overhang ${pct}`);
  const gable = sum((l) => l.gableArea);
  if (gable > 0) add('Sheathing', '7/16" OSB gable-end sheathing, 4×8', Math.ceil(((gable / 144) * w) / 32), 'sheets', `lean-to ends: ${Math.round(gable / 144)} sq ft of wall above the plate ${pct}`);
  return lines;
}

/** Room to turn the flashing up the wall above, under a window there. */
export const FLASH_UP = 4;

/** Checks for one storey's lower roofs: slope for shingles, and whether the roof runs into the windows above. */
export function lowerRoofChecks(p: Project, storeyId: string): CodeCheck[] {
  if (!leanTos(p, storeyId).length && !pitchedLowerRoofs(p, storeyId).length) return [];
  const lr = lowerRoofOf(p, storeyId);
  const out: CodeCheck[] = [];
  const rule = 'Lower roof slope for shingles';
  if (lr.pitch < 2) out.push({ rule, section: 'R905.2.2', status: 'fail', message: `the lower roof is ${lr.pitch}/12 — asphalt shingles need 2/12 or steeper; raise the pitch or use a low-slope roofing` });
  else if (lr.pitch < 4) out.push({ rule, section: 'R905.2.2', status: 'warn', message: `the lower roof is ${lr.pitch}/12 — shingles from 2/12 up to 4/12 need two layers of underlayment (counted in the estimate)` });
  else out.push({ rule, section: 'R905.2.2', status: 'pass', message: `the lower roof is ${lr.pitch}/12` });

  const up = adjacentStorey(p, 1, storeyId)!;
  const upView = storeyView(p, up.id);
  const lift = storeyElevation(p, up.id) - storeyElevation(p, storeyId);
  for (const m of wallMeets(p, storeyId)) {
    const alongX = m.side === 'n' || m.side === 's';
    for (const o of upView.openings) {
      const wall = upView.walls.find((x) => x.id === o.wallId);
      if (!wall) continue;
      const [ca, cb] = alongX ? [wall.a.y, wall.b.y] : [wall.a.x, wall.b.x];
      if (Math.abs(ca - m.line) > 6 || Math.abs(cb - m.line) > 6) continue;
      const len = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
      const along = (t: number) => (alongX ? wall.a.x + ((wall.b.x - wall.a.x) * t) / len : wall.a.y + ((wall.b.y - wall.a.y) * t) / len);
      const [oa, ob] = [along(o.offset - o.width / 2), along(o.offset + o.width / 2)].sort((a, b) => a - b);
      if (ob <= m.u0 || oa >= m.u1) continue;
      // Highest the roof gets under the opening, from the upper floor.
      const roofTop = Math.max(m.topAt(Math.max(oa, m.u0)), m.topAt(Math.min(ob, m.u1)), m.topAt(Math.min(Math.max((oa + ob) / 2, m.u0), m.u1))) - lift;
      const room = o.sill - roofTop;
      if (room < FLASH_UP)
        out.push({
          rule: 'Lower roof clears the windows above',
          section: '—',
          status: 'warn',
          targetId: o.id,
          message: `the lower roof meets the wall above ${room < 0 ? `${Math.round(-room)}" above` : `only ${Math.round(room)}" below`} the bottom of a ${o.kind} there — lower the pitch, raise the ${o.kind}, or leave ~${FLASH_UP}" for the flashing`,
        });
    }
  }
  // A slope draining toward the wall above.
  for (const r of pitchedLowerRoofs(p, storeyId)) {
    if (r.parallel && r.part.sides[r.part.high] === 'wall')
      out.push({ rule: 'Lower roof drains toward the wall above', section: 'R903.2', status: 'warn', message: `the back slope of the lower ${r.calc.roof.type} roof runs down into the wall above — it needs a cricket or a gutter along that wall, and flashing up it (counted in the estimate)` });
  }
  return out;
}
