import { pocketSpan } from './framing.ts';
import { dist, pointAlong, projectOnWall, samePoint, wallDir, wallLength, wallNormal } from '../model/geometry.ts';
import type { CutoutKind, Furniture, FurnitureKind, Opening, Outlet, Point, Project, Room, Wall } from '../model/types.ts';
import { formatFtIn } from '../model/units.ts';
import { convexOverlap, counterCorners, counterPoint, CUTOUT_LABEL } from './counters.ts';
import type { CodeCheck } from './irc.ts';
import type { MaterialLine } from './materials.ts';
import { roomAt, VEHICLE_DOOR } from './lighting.ts';
import { floorToFloor, MAX_RISER, stairRailing } from './stairs.ts';

// Plan symbols: plumbing fixtures and appliances (priced, code-checked, drawn in
// 3D) and furniture (drawn, so a plan reads as rooms people use). Each is a
// w × d rectangle; placed near a wall, its back goes flat against the wall face.
//
// Checks (fixtures only, never furniture, which moves):
//   R306.1  a dwelling has a water closet, a lavatory and a tub or shower;
//   R307.1  water closet (and bidet) 15" from its centre to a wall or fixture
//           each side, 21" clear in front, and 30" centre to centre from the
//           next one; lavatory and bathtub (a tub / shower combo too) 21" in front; shower 24" in front of
//           its opening (taken as its front);
//   P2708.1 shower 900 sq in or more, 30" or more each way;
//   E3901.6 a receptacle within 36" of each lavatory basin (measured to the vanity).
// Clear zones are rectangles in the fixture's own frame; anything solid (a wall,
// counter or another fixture) overlapping one fails it.

export interface FurnitureSpec {
  label: string;
  w: number;
  d: number;
  /** Height in 3D. */
  h: number;
  /** A fixture or appliance: fixed in place, priced and checked (else furniture: drawn only). */
  fixture: boolean;
}

export const FURNITURE: Record<FurnitureKind, FurnitureSpec> = {
  toilet: { label: 'Toilet', w: 20, d: 28, h: 30, fixture: true },
  bidet: { label: 'Bidet', w: 15, d: 24, h: 15, fixture: true },
  lavatory: { label: 'Vanity + basin', w: 30, d: 21, h: 34, fixture: true },
  tub: { label: 'Bathtub', w: 60, d: 30, h: 20, fixture: true },
  'tub-shower': { label: 'Tub / shower combo', w: 60, d: 32, h: 20, fixture: true },
  shower: { label: 'Shower', w: 36, d: 36, h: 4, fixture: true },
  'corner-shower': { label: 'Corner shower (corner entry)', w: 36, d: 36, h: 4, fixture: true },
  'neo-shower': { label: 'Neo-angle shower', w: 38, d: 38, h: 4, fixture: true },
  'kitchen-sink': { label: 'Kitchen sink (sink base)', w: 33, d: 24, h: 36, fixture: true },
  'laundry-sink': { label: 'Laundry sink', w: 24, d: 22, h: 34, fixture: true },
  washer: { label: 'Washer', w: 27, d: 30, h: 38, fixture: true },
  dryer: { label: 'Dryer', w: 27, d: 30, h: 38, fixture: true },
  'water-heater': { label: 'Water heater', w: 24, d: 24, h: 60, fixture: true },
  furnace: { label: 'Furnace', w: 22, d: 30, h: 50, fixture: true },
  'air-handler': { label: 'Air handler', w: 24, d: 24, h: 54, fixture: true },
  range: { label: 'Range (freestanding)', w: 30, d: 26, h: 36, fixture: true },
  fridge: { label: 'Refrigerator (freestanding)', w: 36, d: 30, h: 70, fixture: true },
  bed: { label: 'Bed', w: 60, d: 80, h: 24, fixture: false },
  sofa: { label: 'Sofa', w: 84, d: 36, h: 32, fixture: false },
  chair: { label: 'Armchair', w: 34, d: 34, h: 32, fixture: false },
  table: { label: 'Dining table', w: 60, d: 36, h: 30, fixture: false },
  desk: { label: 'Desk', w: 48, d: 24, h: 30, fixture: false },
  dresser: { label: 'Dresser', w: 60, d: 20, h: 36, fixture: false },
  stairs: { label: 'Stairs', w: 36, d: 120, h: 0, fixture: false },
  'closet-rod': { label: 'Closet rod + shelf', w: 48, d: 12, h: 1, fixture: false },
  linen: { label: 'Linen cabinet / shelving unit', w: 24, d: 18, h: 84, fixture: false },
  'attic-access': { label: 'Attic access (ceiling hatch)', w: 22.5, d: 30, h: 0, fixture: false },
};

export const FURNITURE_KINDS = Object.keys(FURNITURE) as FurnitureKind[];

/** Mattress sizes for the bed's size picker (width × length). */
export const BED_SIZES: [string, number, number][] = [
  ['Twin', 38, 75],
  ['Full', 54, 75],
  ['Queen', 60, 80],
  ['King', 76, 80],
];

/** Showers of every shape (a stall, corner entry or neo-angle): P2708.1 size, 24" in front, R306.1's tub or shower. */
export const SHOWERS: ReadonlySet<FurnitureKind> = new Set(['shower', 'corner-shower', 'neo-shower']);
/** A neo-angle shower's front corner is cut on the diagonal, this far back along each side (the angled door panel). */
export const NEO_CUT = 14;
/** Floor area inside a shower (square inches): the stall, less a neo-angle's cut corner. */
/** Fixtures whose layout has a handed side (the door corner), so they can be mirrored. */
export const MIRRORABLE: ReadonlySet<FurnitureKind> = new Set(['corner-shower', 'neo-shower']);
/** Lavatory basins: one, or two on a double vanity. */
export const basinCount = (f: Furniture) => (f.kind === 'lavatory' ? (f.basins ?? 1) : 0);
/** Half a double vanity's basin bowl across (as drawn): 9" or less, so two fit side by side. */
export const basinHalfWidth = (f: Furniture) => Math.min(f.w * 0.16, 9);
/**
 * A double vanity's basin centres, local x (left, right): where the user put
 * them (`basinAt`), kept on the top and a bowl apart, else a quarter of the width
 * either side of centre.
 */
export function basinCentres(f: Furniture): [number, number] {
  if (!f.basinAt) return [-f.w / 4, f.w / 4];
  const r = basinHalfWidth(f);
  const lim = Math.max(0, f.w / 2 - r);
  const clamp = (x: number) => Math.max(-lim, Math.min(lim, x));
  let [a, b] = [clamp(Math.min(...f.basinAt)), clamp(Math.max(...f.basinAt))];
  if (b - a < 2 * r) {
    const mid = Math.max(-lim + r, Math.min(lim - r, (a + b) / 2));
    [a, b] = [mid - r, mid + r];
  }
  return [a, b];
}
/**
 * What E3901.6's reach is measured to, local x from–to: a single vanity's whole
 * top; a double vanity's halves (split at the middle) as drawn by default, or, once
 * the basins have been placed, each basin's own bowl.
 */
export function basinSpans(f: Furniture): [number, number][] {
  if (basinCount(f) !== 2) return [[-f.w / 2, f.w / 2]];
  if (!f.basinAt) return [[-f.w / 2, 0], [0, f.w / 2]];
  const r = basinHalfWidth(f);
  return basinCentres(f).map((c): [number, number] => [c - r, c + r]);
}
export const showerArea = (f: Furniture) => f.w * f.d - (f.kind === 'neo-shower' ? (Math.min(NEO_CUT, f.w, f.d) ** 2) / 2 : 0);

/** A curbless walk-in shower, by name in checks. */
export const WALK_IN_LABEL = 'curbless walk-in shower';

/** Fixed fixtures and appliances (not furniture, which moves): checked, and solid to clearances. */
export const isFixture = (f: Furniture) => FURNITURE[f.kind].fixture;

/** Plan point of a spot in the item's own frame (x across, y toward its front). */
export function furniturePoint(f: Furniture, x: number, y: number): Point {
  const r = (f.rot * Math.PI) / 180;
  const [c, s] = [Math.cos(r), Math.sin(r)];
  return { x: f.at.x + x * c - y * s, y: f.at.y + x * s + y * c };
}

/** Outline of a rectangle in the item's frame. */
export function localRect(f: Furniture, x0: number, y0: number, x1: number, y1: number): Point[] {
  return [furniturePoint(f, x0, y0), furniturePoint(f, x1, y0), furniturePoint(f, x1, y1), furniturePoint(f, x0, y1)];
}

export const furnitureCorners = (f: Furniture) => localRect(f, -f.w / 2, -f.d / 2, f.w / 2, f.d / 2);

/** Is a plan point on the item? */
export function onFurniture(f: Furniture, p: Point, slop = 0): boolean {
  const r = (-f.rot * Math.PI) / 180;
  const [dx, dy] = [p.x - f.at.x, p.y - f.at.y];
  const x = dx * Math.cos(r) - dy * Math.sin(r);
  const y = dx * Math.sin(r) + dy * Math.cos(r);
  return Math.abs(x) <= f.w / 2 + slop && Math.abs(y) <= f.d / 2 + slop;
}

const tidy = (n: number) => Math.round(n * 1000) / 1000;
const norm = (deg: number) => ((Math.round(deg) % 360) + 360) % 360;

/**
 * Put an item with its centre near `p`: back flat against the wall face it's
 * within reach of (rotated to face into the room), else free-standing at p with
 * its current rotation. A bed's headboard goes to the wall the same way.
 */
export function placeFurniture(project: Project, f: Furniture, p: Point): Furniture {
  let best: { wall: Wall; along: number; side: 1 | -1; gap: number } | null = null;
  for (const w of project.walls) {
    const { along, perp } = projectOnWall(w, p);
    if (along < 0 || along > wallLength(w)) continue;
    const n = wallNormal(w);
    const side = (p.x - w.a.x) * n.x + (p.y - w.a.y) * n.y >= 0 ? 1 : -1;
    // How far the item's back would be from the face if it stayed centred on p.
    const gap = Math.abs(perp) - w.thickness / 2 - f.d / 2;
    if (gap > 12 || gap < -f.d / 2 - 1) continue;
    if (!best || Math.abs(gap) < Math.abs(best.gap)) best = { wall: w, along, side, gap };
  }
  if (!best) return { ...f, at: { x: tidy(p.x), y: tidy(p.y) } };
  const { wall, along, side } = best;
  const n = wallNormal(wall);
  const front = { x: n.x * side, y: n.y * side };
  const foot = pointAlong(wall, along);
  const off = wall.thickness / 2 + f.d / 2;
  const at = { x: tidy(foot.x + front.x * off), y: tidy(foot.y + front.y * off) };
  // Unrotated the front is +y: turn (0, 1) onto `front`.
  const rot = norm((Math.atan2(front.y, front.x) * 180) / Math.PI - 90);
  return { ...f, at, rot };
}

export function newFurniture(project: Project, kind: FurnitureKind, p: Point, id: string): Furniture {
  const s = FURNITURE[kind];
  // A new stair gets enough risers for the floor-to-floor height (7-3/4" max) and 11" treads.
  if (kind === 'stairs') {
    const risers = Math.ceil(floorToFloor(project, { id, kind, at: p, rot: 0, w: s.w, d: s.d }) / MAX_RISER);
    return placeFurniture(project, { id, kind, at: p, rot: 0, w: s.w, d: (risers - 1) * 11, risers }, p);
  }
  return placeFurniture(project, { id, kind, at: p, rot: 0, w: s.w, d: s.d }, p);
}

export const furnitureRoom = (project: Project, f: Furniture): Room | undefined => roomAt(project, f.at);

/** Solid things a clear zone can't overlap: walls, counters and other fixtures. */
function obstacles(project: Project, self: Furniture): Point[][] {
  // Each wall as solid pieces, open where a door is (a window's sill is still wall at floor level).
  const walls = project.walls.flatMap((w) => {
    const n = wallNormal(w);
    const h = w.thickness / 2;
    const len = wallLength(w);
    const gaps = project.openings
      .filter((o) => o.wallId === w.id && o.kind === 'door')
      .map((o) => [o.offset - o.width / 2, o.offset + o.width / 2] as const)
      .sort((a, b) => a[0] - b[0]);
    const pieces: [number, number][] = [];
    let at = 0;
    for (const [s0, e0] of gaps) {
      if (s0 > at + 0.5) pieces.push([at, Math.min(s0, len)]);
      at = Math.max(at, e0);
    }
    if (len > at + 0.5) pieces.push([at, len]);
    return pieces.map(([s0, e0]) => {
      const [a, b] = [pointAlong(w, s0), pointAlong(w, e0)];
      return [
        { x: a.x + n.x * h, y: a.y + n.y * h },
        { x: b.x + n.x * h, y: b.y + n.y * h },
        { x: b.x - n.x * h, y: b.y - n.y * h },
        { x: a.x - n.x * h, y: a.y - n.y * h },
      ];
    });
  });
  const fixtures = project.furniture.filter((f) => f.id !== self.id && isFixture(f)).map(furnitureCorners);
  return [...walls, ...project.counters.map(counterCorners), ...fixtures];
}

const blocked = (zone: Point[], solids: Point[][]) =>
  solids.some((s) => {
    const o = convexOverlap(zone, s);
    if (o.length < 3) return false;
    let a = 0;
    for (let i = 0; i < o.length; i++) a += o[i].x * o[(i + 1) % o.length].y - o[(i + 1) % o.length].x * o[i].y;
    return Math.abs(a) / 2 > 1;
  });

/** Appliances that need a working space in front of their controls (M1305.1). */
const APPLIANCE: ReadonlySet<FurnitureKind> = new Set(['water-heater', 'furnace', 'air-handler']);
/** The section a fixture's clear zones come from. */
export const zoneSection = (f: Furniture) => (APPLIANCE.has(f.kind) ? 'M1305.1' : 'R307.1');
/** M1305.1: a level working space 30" deep and 30" wide in front of an appliance's control side (taken as its front). */
const WORK_SPACE = 30;

/** Clear zones (R307.1 fixture clearances, M1305.1 appliance working space): [what it is, outline]. */
export function clearZones(f: Furniture): [string, Point[]][] {
  const [hw, hd] = [f.w / 2, f.d / 2];
  if (APPLIANCE.has(f.kind)) {
    const half = Math.max(hw, WORK_SPACE / 2);
    return [['30" × 30" working space in front', localRect(f, -half, hd, half, hd + WORK_SPACE)]];
  }
  switch (f.kind) {
    case 'toilet':
    case 'bidet':
      return [
        ['15" from its centre to the side', localRect(f, -15, -hd + 1, 15, hd)],
        ['21" clear in front', localRect(f, -hw, hd, hw, hd + 21)],
      ];
    case 'lavatory':
    case 'tub':
    case 'tub-shower':
      return [['21" clear in front', localRect(f, -hw, hd, hw, hd + 21)]];
    case 'shower':
      // A walk-in's opening is its open side: the front, or the left or right side.
      if (f.walkIn && f.entry === 'left') return [['24" clear in front of the open side', localRect(f, -hw - 24, -hd, -hw, hd)]];
      if (f.walkIn && f.entry === 'right') return [['24" clear in front of the open side', localRect(f, hw, -hd, hw + 24, hd)]];
      return [[f.walkIn ? '24" clear in front of the open side' : '24" clear in front of the opening', localRect(f, -hw, hd, hw, hd + 24)]];
    case 'corner-shower':
      return [['24" clear in front of the opening', localRect(f, -hw, hd, hw, hd + 24)]];
    case 'neo-shower': {
      // The door is the diagonal across the front-left corner (front-right when mirrored); 24" out square to it.
      const c = Math.min(NEO_CUT, f.w, f.d);
      const s = f.mirror ? -1 : 1;
      const [a, b] = [furniturePoint(f, s * -hw, hd - c), furniturePoint(f, s * (-hw + c), hd)];
      const mid = furniturePoint(f, s * (-hw + c / 2), hd - c / 2);
      const o = furniturePoint(f, s * (-hw + c / 2 - 1), hd - c / 2 + 1);
      const len = Math.hypot(o.x - mid.x, o.y - mid.y) || 1;
      const u = { x: ((o.x - mid.x) / len) * 24, y: ((o.y - mid.y) / len) * 24 };
      return [['24" clear in front of the opening', [a, b, { x: b.x + u.x, y: b.y + u.y }, { x: a.x + u.x, y: a.y + u.y }]]];
    }
    default:
      return [];
  }
}

/** Where a receptacle sits on its wall face. */
function outletPoint(project: Project, o: Outlet): Point | null {
  const w = project.walls.find((x) => x.id === o.wallId);
  if (!w) return null;
  const n = wallNormal(w);
  const c = pointAlong(w, o.offset);
  const off = (w.thickness / 2) * o.side;
  return { x: c.x + n.x * off, y: c.y + n.y * off };
}

function segDist(p: Point, a: Point, b: Point): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return dist(p, { x: a.x + dx * t, y: a.y + dy * t });
}

/** How far the closest receptacle is from the vanity's outline (Infinity if none); `span` limits it to one basin's half. */
export function basinReach(project: Project, lav: Furniture, span: [number, number] = [-lav.w / 2, lav.w / 2]): number {
  const outline = localRect(lav, span[0], -lav.d / 2, span[1], lav.d / 2);
  const part = { ...lav, at: furniturePoint(lav, (span[0] + span[1]) / 2, 0), w: span[1] - span[0] };
  let best = Infinity;
  for (const o of project.outlets) {
    const p = outletPoint(project, o);
    if (!p) continue;
    const d = onFurniture(part, p) ? 0 : Math.min(...outline.map((a, i) => segDist(p, a, outline[(i + 1) % 4])));
    best = Math.min(best, d);
  }
  return best;
}

/** Lavatories in a room. */
export const roomLavatories = (project: Project, room: Room) => project.furniture.filter((f) => f.kind === 'lavatory' && furnitureRoom(project, f)?.id === room.id);

/** A GFCI over each lavatory that backs onto a wall (unless one already serves it), for auto layout. */
export function lavatoryOutlets(project: Project, room: Room): Omit<Outlet, 'id' | 'auto'>[] {
  const out: Omit<Outlet, 'id' | 'auto'>[] = [];
  const placed: Point[] = [];
  for (const lav of roomLavatories(project, room)) {
    const back = furniturePoint(lav, 0, -lav.d / 2 - 1);
    const corners = furnitureCorners(lav);
    if (placed.some((p) => Math.min(...corners.map((a, i) => segDist(p, a, corners[(i + 1) % 4]))) <= 36)) continue;
    let best: { wall: Wall; along: number; perp: number } | null = null;
    for (const w of project.walls) {
      const { along, perp } = projectOnWall(w, back);
      if (Math.abs(perp) > w.thickness / 2 + 2 || along < 0 || along > wallLength(w)) continue;
      if (!best || Math.abs(perp) < Math.abs(best.perp)) best = { wall: w, along, perp };
    }
    if (!best) continue;
    const n = wallNormal(best.wall);
    const side: 1 | -1 = (lav.at.x - back.x) * n.x + (lav.at.y - back.y) * n.y >= 0 ? 1 : -1;
    const o = { wallId: best.wall.id, offset: Math.round(best.along), side, kind: 'gfci' as const, height: 44 };
    out.push(o);
    placed.push(outletPoint(project, { ...o, id: '', auto: true })!);
  }
  return out;
}

export function furnitureChecks(project: Project): CodeCheck[] {
  const out: CodeCheck[] = [];
  const fixtures = project.furniture.filter(isFixture);
  const has = (k: FurnitureKind) => fixtures.some((f) => f.kind === k);
  if (!fixtures.length && project.rooms.some((r) => r.type === 'bath')) {
    out.push({ rule: 'Required sanitary fixtures', section: 'R306.1', status: 'info', message: 'draw the toilet, vanity and tub or shower with the Fixture tool to check them' });
  } else if (fixtures.some((f) => ['toilet', 'lavatory', 'tub', 'tub-shower'].includes(f.kind) || SHOWERS.has(f.kind))) {
    const missing = [!has('toilet') && 'a toilet', !has('lavatory') && 'a lavatory', !has('tub') && !has('tub-shower') && ![...SHOWERS].some(has) && 'a tub or shower'].filter(Boolean);
    out.push({
      rule: 'Required sanitary fixtures',
      section: 'R306.1',
      status: missing.length ? 'fail' : 'pass',
      message: missing.length ? `the plan has no ${missing.join(', ')}` : 'toilet, lavatory and tub / shower on the plan',
    });
  }
  for (const f of fixtures) {
    const label = f.walkIn && f.kind === 'shower' ? WALK_IN_LABEL : FURNITURE[f.kind].label.toLowerCase();
    const where = furnitureRoom(project, f)?.name;
    const name = where ? `${where}: ${label}` : label;
    const zones = clearZones(f);
    if (zones.length) {
      const solids = obstacles(project, f);
      const bad = zones.filter(([, z]) => blocked(z, solids)).map(([what]) => what);
      const appliance = APPLIANCE.has(f.kind);
      out.push({ rule: appliance ? `Appliance working space (${label})` : `Fixture clearances (${label})`, section: zoneSection(f), status: bad.length ? 'fail' : 'pass', message: bad.length ? `${name} needs ${bad.join(' and ')}` : `${name}: clear`, targetId: f.id });
    }
    if (SHOWERS.has(f.kind)) {
      const area = showerArea(f);
      const ok = area >= 900 - 0.5 && Math.min(f.w, f.d) >= 30 - 0.5;
      const cut = f.kind === 'neo-shower' ? ` less the ${formatFtIn(Math.min(NEO_CUT, f.w, f.d))} angled corner` : '';
      out.push({ rule: 'Shower size (900 sq in, 30" each way)', section: 'P2708.1', status: ok ? 'pass' : 'fail', message: `${name}: ${formatFtIn(f.w)} × ${formatFtIn(f.d)}${cut} = ${Math.round(area)} sq in`, targetId: f.id });
    }
  }
  out.push(...spacingChecks(project));
  out.push(...doorSwingChecks(project));
  out.push(...pocketChecks(project));
  return out;
}

/** R307.1: water closets and bidets 30" or more centre to centre from each other. */
export const WC_SPACING = 30;

export function spacingChecks(project: Project): CodeCheck[] {
  const wcs = project.furniture.filter((f) => f.kind === 'toilet' || f.kind === 'bidet');
  if (wcs.length < 2) return [];
  const out: CodeCheck[] = [];
  let pairs = 0;
  for (let i = 0; i < wcs.length; i++) {
    for (let j = i + 1; j < wcs.length; j++) {
      const [a, b] = [wcs[i], wcs[j]];
      const room = furnitureRoom(project, a);
      if (room?.id !== furnitureRoom(project, b)?.id) continue;
      pairs++;
      const gap = dist(a.at, b.at);
      if (gap >= WC_SPACING - 0.5) continue;
      const what = (f: Furniture) => FURNITURE[f.kind].label.toLowerCase();
      out.push({
        rule: 'Fixture spacing (30" centre to centre)',
        section: 'R307.1',
        status: 'fail',
        message: `${room ? `${room.name}: ` : ''}${what(a)} and ${what(b)} centres ${formatFtIn(gap)} apart — wants 2' 6"`,
        targetId: b.id,
      });
    }
  }
  if (pairs && !out.length) out.push({ rule: 'Fixture spacing (30" centre to centre)', section: 'R307.1', status: 'pass', message: `${pairs} water closet / bidet pair${pairs === 1 ? '' : 's'} 2' 6" or more apart` });
  return out;
}

/** Fixtures that need a supply, drain and vent. */
const WET: ReadonlySet<FurnitureKind> = new Set(['toilet', 'bidet', 'lavatory', 'tub', 'tub-shower', 'shower', 'corner-shower', 'neo-shower', 'kitchen-sink', 'laundry-sink', 'washer']);

export function furnitureLines(project: Project): MaterialLine[] {
  const count = (k: FurnitureKind) => project.furniture.filter((f) => f.kind === k).length;
  const lines: MaterialLine[] = [];
  const add = (item: string, qty: number, basis: string) => qty && lines.push({ category: 'Plumbing', item, qty, unit: 'ea', basis });
  add('Toilet (allowance)', count('toilet'), 'toilets on the plan, incl. wax ring and supply');
  const lavs = project.furniture.filter((f) => f.kind === 'lavatory');
  const doubles = lavs.filter((f) => basinCount(f) === 2).length;
  add('Vanity + lavatory faucet (allowance)', lavs.length - doubles, 'single vanities on the plan');
  add('Double vanity + 2 faucets (allowance)', doubles, 'double vanities on the plan (two basins each)');
  add('Bathtub + valve (allowance)', count('tub'), 'tubs on the plan');
  add('Tub / shower combo + valve + surround (allowance)', count('tub-shower'), 'tub / shower combos on the plan');
  const walkIns = project.furniture.filter((f) => f.kind === 'shower' && f.walkIn).length;
  add('Shower pan + valve + door (allowance)', count('shower') - walkIns + count('corner-shower'), 'showers on the plan (stall and corner entry)');
  add('Curbless walk-in shower + linear drain + glass panel (allowance)', walkIns, 'curbless walk-in showers on the plan: recessed / sloped floor, waterproofing, valve, fixed glass, no curb or door');
  add('Neo-angle shower base + valve + glass (allowance)', count('neo-shower'), 'neo-angle showers on the plan');
  add('Bidet (allowance)', count('bidet'), 'bidets on the plan');
  add('Kitchen sink + faucet (allowance)', count('kitchen-sink'), 'free-standing sink bases on the plan');
  add('Laundry sink + faucet (allowance)', count('laundry-sink'), 'laundry sinks on the plan');
  add('Range (allowance)', count('range'), 'free-standing ranges on the plan');
  add('Refrigerator (allowance)', count('fridge'), 'free-standing refrigerators on the plan');
  add('Washer outlet box', count('washer'), 'one per washer');
  add('Dryer vent kit', count('dryer'), 'one per dryer');
  add('Water heater (allowance)', count('water-heater'), 'water heaters on the plan');
  add('Furnace (allowance)', count('furnace'), 'furnaces on the plan; size it with a Manual J load calculation (M1401.3)');
  add('Air handler (allowance)', count('air-handler'), 'air handlers on the plan; size with the heat pump / condenser');
  // Closets by the foot of run: a double hang is two rods and two shelves; a shelf alone is just the shelf.
  const closets = project.furniture.filter((f) => f.kind === 'closet-rod');
  const feet = (pick: (f: Furniture) => boolean, per = 1) => Math.ceil((closets.filter(pick).reduce((t, f) => t + f.w, 0) * per) / 12);
  const rodFt = feet((f) => f.closet !== 'shelf' && f.closet !== 'double') + feet((f) => f.closet === 'double', 2);
  const shelfFt = feet((f) => f.closet === 'shelf');
  if (rodFt) lines.push({ category: 'Lumber', item: 'Closet rod + shelf (allowance)', qty: rodFt, unit: 'lf', basis: 'rod-and-shelf run (double hang counts twice), rounded up to whole feet' });
  if (shelfFt) lines.push({ category: 'Lumber', item: 'Closet shelf (allowance)', qty: shelfFt, unit: 'lf', basis: 'shelf-only run, rounded up to whole feet' });
  add('Linen cabinet / shelving unit (allowance)', count('linen'), 'from the plan');
  if (count('attic-access')) lines.push({ category: 'Lumber', item: 'Attic access hatch (allowance)', qty: count('attic-access'), unit: 'ea', basis: 'framed ceiling opening, trim and insulated hatch cover, one per attic access on the plan (M1305.1.3)' });
  // Stair handrails and guards, by the sloped foot of run.
  const rails = project.furniture.filter((f) => f.kind === 'stairs').map((f) => stairRailing(project, f));
  const railFt = Math.ceil(rails.reduce((t, r) => t + r.handrail, 0) / 12);
  const guardFt = Math.ceil(rails.reduce((t, r) => t + r.guard, 0) / 12);
  if (railFt) lines.push({ category: 'Lumber', item: 'Stair handrail + brackets (allowance)', qty: railFt, unit: 'lf', basis: 'sloped length of each handrail side, rounded up to whole feet (R311.7.8)' });
  if (guardFt) lines.push({ category: 'Lumber', item: 'Stair guard / balustrade (allowance)', qty: guardFt, unit: 'lf', basis: 'open sides more than 30" up — sloped along a stair going up, the run round the opening going down (R312.1)' });
  // A double vanity is two lavatories to rough in.
  const rough = project.furniture.filter((f) => WET.has(f.kind)).reduce((t, f) => t + Math.max(1, basinCount(f)), 0);
  add('Plumbing rough-in per fixture (allowance)', rough, 'supply, drain and vent per fixture; size runs with a plumber (IRC Chapters 29–31)');
  return lines;
}

// ── v2: follow dragged walls, door swings, fixture schedule ────────────────

/** The wall an item's back sits flat on (as placeFurniture leaves it), with where along it and which side. */
export function furnitureHost(project: Project, f: Furniture): { wall: Wall; along: number; side: 1 | -1 } | null {
  const back = furniturePoint(f, 0, -f.d / 2);
  const front = { x: furniturePoint(f, 0, 1).x - f.at.x, y: furniturePoint(f, 0, 1).y - f.at.y };
  for (const w of project.walls) {
    const { along, perp } = projectOnWall(w, back);
    if (Math.abs(Math.abs(perp) - w.thickness / 2) > 1 || along < -1 || along > wallLength(w) + 1) continue;
    const n = wallNormal(w);
    const dot = front.x * n.x + front.y * n.y;
    if (Math.abs(dot) < 0.99) continue;
    const side: 1 | -1 = dot > 0 ? 1 : -1;
    // The back must be on the face the item looks out from, not the far one.
    const foot = pointAlong(w, along);
    if ((back.x - foot.x) * n.x * side + (back.y - foot.y) * n.y * side < 0) continue;
    return { wall: w, along, side };
  }
  return null;
}

/**
 * After walls move, carry the items backed onto them along: same distance along
 * the wall, back on its new face, turned with it (kept on the wall if it got
 * shorter). Free-standing items stay put.
 */
export function followFurniture(prev: Project, next: Project): Project {
  if (prev.walls === next.walls || !next.furniture.length) return next;
  const after = new Map(next.walls.map((w) => [w.id, w]));
  const before = new Map(prev.furniture.map((f) => [f.id, f]));
  let changed = false;
  const furniture = next.furniture.map((f) => {
    // Already placed by the same edit (a room turned, moved or mirrored with its contents): leave it.
    if (before.has(f.id) && before.get(f.id) !== f) return f;
    const host = furnitureHost(prev, f);
    const w = host && after.get(host.wall.id);
    if (!host || !w) return f;
    const old = host.wall;
    if (samePoint(old.a, w.a) && samePoint(old.b, w.b) && old.thickness === w.thickness) return f;
    const len = wallLength(w);
    const along = len >= f.w ? Math.max(f.w / 2, Math.min(len - f.w / 2, host.along)) : len / 2;
    const n = wallNormal(w);
    const front = { x: n.x * host.side, y: n.y * host.side };
    const foot = pointAlong(w, along);
    const off = w.thickness / 2 + f.d / 2;
    const at = { x: tidy(foot.x + front.x * off), y: tidy(foot.y + front.y * off) };
    const rot = norm((Math.atan2(front.y, front.x) * 180) / Math.PI - 90);
    changed = true;
    return { ...f, at, rot };
  });
  return changed ? { ...next, furniture } : next;
}

/** A door's frame on the plan: hinge-end jamb, free-end jamb (both on the face it opens toward), the way it opens, and along the wall from hinge to free end. */
export function doorFrame(project: Project, o: Opening) {
  const wall = project.walls.find((w) => w.id === o.wallId);
  if (!wall) return null;
  const d = wallDir(wall);
  const n = wallNormal(wall);
  const side = o.swing?.side ?? 1;
  const k = (o.swing?.hinge ?? 'a') === 'a' ? -1 : 1;
  const c = pointAlong(wall, o.offset);
  const t = wall.thickness / 2;
  const jamb = (e: number) => ({ x: c.x + d.x * e * (o.width / 2) + n.x * t * side, y: c.y + d.y * e * (o.width / 2) + n.y * t * side });
  return { wall, hinge: jamb(k), free: jamb(-k), out: { x: n.x * side, y: n.y * side }, along: { x: -d.x * k, y: -d.y * k } };
}

/** A quarter circle from a hinge: the leaf starts open square to the wall (`out`) and closes toward `along`. */
function quarter(h: Point, out: Point, along: Point, r: number): Point[] {
  const pts = [h];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    pts.push({ x: h.x + r * (out.x * Math.cos(a) + along.x * Math.sin(a)), y: h.y + r * (out.y * Math.cos(a) + along.y * Math.sin(a)) });
  }
  return pts;
}

/** The floor a single hinged leaf sweeps: a quarter circle from the hinge, the leaf's width in radius. Null for windows, vehicle doors and doors that don't swing as one leaf. */
export function doorSwing(project: Project, o: Opening): Point[] | null {
  if (o.kind !== 'door' || o.width > VEHICLE_DOOR || (o.operation ?? 'swing') !== 'swing') return null;
  const f = doorFrame(project, o);
  return f && quarter(f.hinge, f.out, f.along, o.width);
}

/** How far bifold panels stand out from the wall when folded: one panel's width (two panels a side over 36", else two in all). */
export const bifoldDepth = (width: number) => (width > 36 ? width / 4 : width / 2);

/**
 * Every patch of floor a door sweeps as it opens: one quarter circle for a
 * hinged leaf, two half-width ones for a pair, a strip a panel deep for a
 * bifold, nothing for a pocket door (it slides into the wall) or a window.
 */
export function doorSweeps(project: Project, o: Opening): Point[][] {
  if (o.kind !== 'door' || o.width > VEHICLE_DOOR) return [];
  const f = doorFrame(project, o);
  if (!f) return [];
  switch (o.operation ?? 'swing') {
    case 'swing':
      return [quarter(f.hinge, f.out, f.along, o.width)];
    case 'double':
      return [quarter(f.hinge, f.out, f.along, o.width / 2), quarter(f.free, f.out, { x: -f.along.x, y: -f.along.y }, o.width / 2)];
    case 'bifold': {
      const e = bifoldDepth(o.width);
      const push = (p: Point) => ({ x: p.x + f.out.x * e, y: p.y + f.out.y * e });
      return [[f.hinge, f.free, push(f.free), push(f.hinge)]];
    }
    case 'pocket':
    case 'bypass':
    case 'barn':
    case 'open':
      // Sliding (in the wall, in the opening, or flat against the wall face), or no door at all.
      return [];
  }
}

/** Doors whose swing runs into a fixture, piece of furniture, counter, a fixture's code clearance or another door's swing. */
export function doorSwingChecks(project: Project): CodeCheck[] {
  const doors = project.openings.filter((o) => doorSweeps(project, o).length);
  if (!doors.length || (!project.furniture.length && !project.counters.length && doors.length < 2)) return [];
  const out: CodeCheck[] = [];
  // Closet rods hang above the floor: a door swings under them.
  const things: [string, Point[]][] = [
    ...project.furniture.filter((f) => f.kind !== 'closet-rod' && f.kind !== 'attic-access').map((f): [string, Point[]] => [`the ${FURNITURE[f.kind].label.toLowerCase()}`, furnitureCorners(f)]),
    ...project.counters.map((c): [string, Point[]] => [c.island ? 'an island' : 'a counter', counterCorners(c)]),
  ];
  // A fixture's R307.1 clear space has to stay clear of a door standing open in it too.
  const zones: [string, Point[]][] = project.furniture
    .filter(isFixture)
    .flatMap((f) => clearZones(f).map(([what, z]): [string, Point[]] => [`the ${FURNITURE[f.kind].label.toLowerCase()}'s clear space (${what}, ${zoneSection(f)})`, z]));
  const sweeps = new Map(doors.map((o) => [o.id, doorSweeps(project, o)]));
  const hitsAny = (mine: Point[][], outline: Point[]) => mine.some((s) => blocked(s, [outline]));
  const doorName = (o: Opening) => `the ${formatFtIn(o.width)} door on ${o.wallId}`;
  for (const o of doors) {
    const mine = sweeps.get(o.id)!;
    const others = doors.filter((x) => x.id !== o.id && sweeps.get(x.id)!.some((s) => hitsAny(mine, s))).map(doorName);
    const solid = things.filter(([, outline]) => hitsAny(mine, outline)).map(([what]) => what);
    const clear = zones.filter(([what, z]) => hitsAny(mine, z) && !solid.some((x) => what.startsWith(`${x}'s`))).map(([what]) => what);
    const hits = [...new Set([...solid, ...others.map((x) => `${x}'s swing`), ...clear])];
    if (!hits.length) continue;
    const wall = project.walls.find((w) => w.id === o.wallId)!;
    const where = roomAt(project, mine[0][Math.floor(mine[0].length / 2)])?.name;
    out.push({
      rule: 'Door swing clear',
      section: 'Layout',
      status: 'warn',
      message: `${formatFtIn(o.width)} door on ${wall.id}${where ? ` into ${where}` : ''} swings into ${hits.join(' and ')} — move it, flip the swing or try a pocket door`,
      targetId: o.id,
    });
  }
  if (!out.length) out.push({ rule: 'Door swing clear', section: 'Layout', status: 'pass', message: `${doors.length} door swing${doors.length === 1 ? '' : 's'} clear of fixtures, their clear space, furniture, counters and each other` });
  return out;
}

export { pocketSpan };

/**
 * Pocket doors need their pocket: inside the wall, with no other door, window,
 * receptacle or switch in it. A barn door slides along the swing-side face over
 * the same stretch: no door or window there, nor a receptacle or switch on that face.
 */
export function pocketChecks(project: Project): CodeCheck[] {
  const out: CodeCheck[] = [];
  for (const o of project.openings.filter((x) => x.kind === 'door' && (x.operation === 'pocket' || x.operation === 'barn'))) {
    const wall = project.walls.find((w) => w.id === o.wallId);
    if (!wall) continue;
    const barn = o.operation === 'barn';
    const face = o.swing?.side ?? 1;
    const [s, e] = pocketSpan(o);
    const inSpan = (a: number, b = a) => b > s + 0.5 && a < e - 0.5;
    const onFace = (x: { side: 1 | -1 }) => !barn || x.side === face;
    const hits = [
      (s < -0.5 || e > wallLength(wall) + 0.5) && 'the wall’s end',
      ...project.openings.filter((x) => x.id !== o.id && x.wallId === o.wallId && inSpan(x.offset - x.width / 2, x.offset + x.width / 2)).map((x) => `a ${x.kind}`),
      ...project.outlets.filter((x) => x.wallId === o.wallId && inSpan(x.offset) && onFace(x)).map(() => 'a receptacle'),
      ...project.switches.filter((x) => x.wallId === o.wallId && inSpan(x.offset) && onFace(x)).map(() => 'a switch'),
    ].filter((x): x is string => !!x);
    const what = barn ? 'barn door' : 'pocket door';
    const span = barn ? 'its slide' : 'its pocket';
    out.push({
      rule: barn ? 'Barn door slide clear' : 'Pocket door pocket clear',
      section: 'Layout',
      status: hits.length ? 'warn' : 'pass',
      message: hits.length
        ? `${formatFtIn(o.width)} ${what} on ${wall.id}: ${span} runs into ${[...new Set(hits)].join(' and ')} — ${barn ? 'slide it the other way' : 'flip the pocket side'} or move it`
        : `${formatFtIn(o.width)} ${what} on ${wall.id}: ${barn ? 'slide' : 'pocket'} clear`,
      targetId: o.id,
    });
  }
  return out;
}

/** Plan-schedule tag prefixes. Counter appliances share the free-standing ones. */
const MARK: Partial<Record<FurnitureKind, string>> = {
  toilet: 'WC', bidet: 'BD', lavatory: 'LAV', tub: 'T', 'tub-shower': 'TS', shower: 'SH', 'corner-shower': 'SH', 'neo-shower': 'SH', 'kitchen-sink': 'S', 'laundry-sink': 'LS',
  washer: 'W', dryer: 'D', 'water-heater': 'WH', furnace: 'F', 'air-handler': 'AH', range: 'R', fridge: 'REF',
};
/** Counter cutouts: the free-standing kind they share a tag with, or their own tag (a pantry is a cabinet, not scheduled). */
const CUTOUT_KIND: Record<CutoutKind, FurnitureKind | 'DW' | 'OV' | null> = { sink: 'kitchen-sink', range: 'range', fridge: 'fridge', dishwasher: 'DW', oven: 'OV', pantry: null };

export interface ScheduleRow {
  mark: string;
  item: string;
  size: string;
  qty: number;
  rooms: string;
  /** The product picked (rows split by model). */
  model: string;
  /** Rough-in and other notes, each distinct one once. */
  notes: string;
  at: Point[];
}

/**
 * The fixture schedule: one row per kind and size, tagged WC-1, LAV-1 … in
 * plan order. Sinks, ranges and fridges set in counters count too; a dishwasher
 * gets DW.
 */
export function fixtureSchedule(project: Project): ScheduleRow[] {
  type Entry = { prefix: string; item: string; size: string; model?: string; note?: string; room?: string; at: Point; order: number };
  const entries: Entry[] = [];
  const kinds = Object.keys(MARK) as FurnitureKind[];
  for (const f of project.furniture.filter(isFixture)) {
    entries.push({
      prefix: MARK[f.kind]!,
      item: FURNITURE[f.kind].label,
      size: `${formatFtIn(f.w)} × ${formatFtIn(f.d)}`,
      model: f.model?.trim() || undefined,
      note: f.note?.trim() || undefined,
      room: furnitureRoom(project, f)?.name,
      at: furniturePoint(f, 0, f.d / 2 + 6),
      order: kinds.indexOf(f.kind),
    });
  }
  for (const c of project.counters) {
    for (const k of c.cutouts) {
      const tag = CUTOUT_KIND[k.kind];
      if (!tag) continue;
      const kind = tag === 'DW' || tag === 'OV' ? null : tag;
      const p = counterPoint(c, k.offset, c.depth / 2);
      entries.push({
        prefix: kind ? MARK[kind]! : tag,
        item: `${CUTOUT_LABEL[k.kind]} (in counter)`,
        size: `${formatFtIn(k.width)} wide`,
        room: roomAt(project, p)?.name,
        at: counterPoint(c, k.offset, c.depth + 6),
        order: kind ? kinds.indexOf(kind) + 0.5 : kinds.length,
      });
    }
  }
  // By room: a section per room (rooms in name order, unplaced last), kinds in order inside each; a row never spans rooms.
  const byRoom = project.scheduleBy === 'room';
  const roomKey = (e: Entry) => (e.room === undefined ? '\uffff' : e.room.toLowerCase());
  entries.sort((a, b) => (byRoom ? roomKey(a).localeCompare(roomKey(b)) : 0) || a.order - b.order);
  const rows: ScheduleRow[] = [];
  const counts = new Map<string, number>();
  for (const e of entries) {
    const model = e.model ?? '';
    let row = rows.find((r) => r.mark.startsWith(`${e.prefix}-`) && r.item === e.item && r.size === e.size && r.model === model && (!byRoom || r.rooms === (e.room ?? '')));
    if (!row) {
      const n = (counts.get(e.prefix) ?? 0) + 1;
      counts.set(e.prefix, n);
      row = { mark: `${e.prefix}-${n}`, item: e.item, size: e.size, model, notes: '', qty: 0, rooms: '', at: [] };
      rows.push(row);
    }
    row.qty++;
    row.at.push(e.at);
    if (e.room && !row.rooms.split(', ').includes(e.room)) row.rooms = row.rooms ? `${row.rooms}, ${e.room}` : e.room;
    if (e.note && !row.notes.split('; ').includes(e.note)) row.notes = row.notes ? `${row.notes}; ${e.note}` : e.note;
  }
  return rows;
}
