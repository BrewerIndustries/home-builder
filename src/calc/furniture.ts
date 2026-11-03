import { dist, pointAlong, projectOnWall, wallLength, wallNormal } from '../model/geometry.ts';
import type { Furniture, FurnitureKind, Outlet, Point, Project, Room, Wall } from '../model/types.ts';
import { formatFtIn } from '../model/units.ts';
import { convexOverlap, counterCorners } from './counters.ts';
import type { CodeCheck } from './irc.ts';
import type { MaterialLine } from './materials.ts';
import { roomAt } from './lighting.ts';

// Plan symbols: plumbing fixtures and appliances (priced, code-checked, drawn in
// 3D) and furniture (drawn, so a plan reads as rooms people use). Each is a
// w × d rectangle; placed near a wall, its back goes flat against the wall face.
//
// Checks (fixtures only, never furniture, which moves):
//   R306.1  a dwelling has a water closet, a lavatory and a tub or shower;
//   R307.1  water closet 15" from its centre to a wall or fixture each side and
//           21" clear in front; lavatory 21" in front; shower 24" in front of its
//           opening (taken as its front);
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
  lavatory: { label: 'Vanity + basin', w: 30, d: 21, h: 34, fixture: true },
  tub: { label: 'Bathtub', w: 60, d: 30, h: 20, fixture: true },
  shower: { label: 'Shower', w: 36, d: 36, h: 4, fixture: true },
  washer: { label: 'Washer', w: 27, d: 30, h: 38, fixture: true },
  dryer: { label: 'Dryer', w: 27, d: 30, h: 38, fixture: true },
  'water-heater': { label: 'Water heater', w: 24, d: 24, h: 60, fixture: true },
  bed: { label: 'Bed', w: 60, d: 80, h: 24, fixture: false },
  sofa: { label: 'Sofa', w: 84, d: 36, h: 32, fixture: false },
  chair: { label: 'Armchair', w: 34, d: 34, h: 32, fixture: false },
  table: { label: 'Dining table', w: 60, d: 36, h: 30, fixture: false },
  desk: { label: 'Desk', w: 48, d: 24, h: 30, fixture: false },
  dresser: { label: 'Dresser', w: 60, d: 20, h: 36, fixture: false },
};

export const FURNITURE_KINDS = Object.keys(FURNITURE) as FurnitureKind[];

/** Mattress sizes for the bed's size picker (width × length). */
export const BED_SIZES: [string, number, number][] = [
  ['Twin', 38, 75],
  ['Full', 54, 75],
  ['Queen', 60, 80],
  ['King', 76, 80],
];

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
  return placeFurniture(project, { id, kind, at: p, rot: 0, w: s.w, d: s.d }, p);
}

export const furnitureRoom = (project: Project, f: Furniture): Room | undefined => roomAt(project, f.at);

/** Solid things a clear zone can't overlap: walls, counters and other fixtures. */
function obstacles(project: Project, self: Furniture): Point[][] {
  const walls = project.walls.map((w) => {
    const n = wallNormal(w);
    const h = w.thickness / 2;
    return [
      { x: w.a.x + n.x * h, y: w.a.y + n.y * h },
      { x: w.b.x + n.x * h, y: w.b.y + n.y * h },
      { x: w.b.x - n.x * h, y: w.b.y - n.y * h },
      { x: w.a.x - n.x * h, y: w.a.y - n.y * h },
    ];
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

/** R307.1 clear zones: [what it is, outline]. */
export function clearZones(f: Furniture): [string, Point[]][] {
  const [hw, hd] = [f.w / 2, f.d / 2];
  switch (f.kind) {
    case 'toilet':
      return [
        ['15" from its centre to the side', localRect(f, -15, -hd + 1, 15, hd)],
        ['21" clear in front', localRect(f, -hw, hd, hw, hd + 21)],
      ];
    case 'lavatory':
      return [['21" clear in front', localRect(f, -hw, hd, hw, hd + 21)]];
    case 'shower':
      return [['24" clear in front of the opening', localRect(f, -hw, hd, hw, hd + 24)]];
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

/** How far the closest receptacle is from the vanity's outline (Infinity if none). */
export function basinReach(project: Project, lav: Furniture): number {
  const outline = furnitureCorners(lav);
  let best = Infinity;
  for (const o of project.outlets) {
    const p = outletPoint(project, o);
    if (!p) continue;
    const d = onFurniture(lav, p) ? 0 : Math.min(...outline.map((a, i) => segDist(p, a, outline[(i + 1) % 4])));
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
  } else if (fixtures.some((f) => ['toilet', 'lavatory', 'tub', 'shower'].includes(f.kind))) {
    const missing = [!has('toilet') && 'a toilet', !has('lavatory') && 'a lavatory', !has('tub') && !has('shower') && 'a tub or shower'].filter(Boolean);
    out.push({
      rule: 'Required sanitary fixtures',
      section: 'R306.1',
      status: missing.length ? 'fail' : 'pass',
      message: missing.length ? `the plan has no ${missing.join(', ')}` : 'toilet, lavatory and tub / shower on the plan',
    });
  }
  for (const f of fixtures) {
    const label = FURNITURE[f.kind].label.toLowerCase();
    const where = furnitureRoom(project, f)?.name;
    const name = where ? `${where}: ${label}` : label;
    const zones = clearZones(f);
    if (zones.length) {
      const solids = obstacles(project, f);
      const bad = zones.filter(([, z]) => blocked(z, solids)).map(([what]) => what);
      out.push({ rule: `Fixture clearances (${label})`, section: 'R307.1', status: bad.length ? 'fail' : 'pass', message: bad.length ? `${name} needs ${bad.join(' and ')}` : `${name}: clear`, targetId: f.id });
    }
    if (f.kind === 'shower') {
      const ok = f.w * f.d >= 900 - 0.5 && Math.min(f.w, f.d) >= 30 - 0.5;
      out.push({ rule: 'Shower size (900 sq in, 30" each way)', section: 'P2708.1', status: ok ? 'pass' : 'fail', message: `${name}: ${formatFtIn(f.w)} × ${formatFtIn(f.d)} = ${Math.round(f.w * f.d)} sq in`, targetId: f.id });
    }
  }
  return out;
}

export function furnitureLines(project: Project): MaterialLine[] {
  const count = (k: FurnitureKind) => project.furniture.filter((f) => f.kind === k).length;
  const lines: MaterialLine[] = [];
  const add = (item: string, qty: number, basis: string) => qty && lines.push({ category: 'Plumbing', item, qty, unit: 'ea', basis });
  add('Toilet (allowance)', count('toilet'), 'toilets on the plan, incl. wax ring and supply');
  add('Vanity + lavatory faucet (allowance)', count('lavatory'), 'lavatories on the plan');
  add('Bathtub + valve (allowance)', count('tub'), 'tubs on the plan');
  add('Shower pan + valve + door (allowance)', count('shower'), 'showers on the plan');
  add('Washer outlet box', count('washer'), 'one per washer');
  add('Dryer vent kit', count('dryer'), 'one per dryer');
  add('Water heater (allowance)', count('water-heater'), 'water heaters on the plan');
  const rough = project.furniture.filter((f) => ['toilet', 'lavatory', 'tub', 'shower', 'washer'].includes(f.kind)).length;
  add('Plumbing rough-in per fixture (allowance)', rough, 'supply, drain and vent per fixture; size runs with a plumber (IRC Chapters 29–31)');
  return lines;
}
