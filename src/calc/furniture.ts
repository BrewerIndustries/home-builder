import { dist, pointAlong, projectOnWall, samePoint, wallDir, wallLength, wallNormal } from '../model/geometry.ts';
import type { Furniture, FurnitureKind, Opening, Outlet, Point, Project, Room, Wall } from '../model/types.ts';
import { formatFtIn } from '../model/units.ts';
import { convexOverlap, counterCorners, counterPoint, CUTOUT_LABEL } from './counters.ts';
import type { CodeCheck } from './irc.ts';
import type { MaterialLine } from './materials.ts';
import { roomAt, VEHICLE_DOOR } from './lighting.ts';

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
  bidet: { label: 'Bidet', w: 15, d: 24, h: 15, fixture: true },
  lavatory: { label: 'Vanity + basin', w: 30, d: 21, h: 34, fixture: true },
  tub: { label: 'Bathtub', w: 60, d: 30, h: 20, fixture: true },
  shower: { label: 'Shower', w: 36, d: 36, h: 4, fixture: true },
  'kitchen-sink': { label: 'Kitchen sink (sink base)', w: 33, d: 24, h: 36, fixture: true },
  'laundry-sink': { label: 'Laundry sink', w: 24, d: 22, h: 34, fixture: true },
  washer: { label: 'Washer', w: 27, d: 30, h: 38, fixture: true },
  dryer: { label: 'Dryer', w: 27, d: 30, h: 38, fixture: true },
  'water-heater': { label: 'Water heater', w: 24, d: 24, h: 60, fixture: true },
  range: { label: 'Range (freestanding)', w: 30, d: 26, h: 36, fixture: true },
  fridge: { label: 'Refrigerator (freestanding)', w: 36, d: 30, h: 70, fixture: true },
  bed: { label: 'Bed', w: 60, d: 80, h: 24, fixture: false },
  sofa: { label: 'Sofa', w: 84, d: 36, h: 32, fixture: false },
  chair: { label: 'Armchair', w: 34, d: 34, h: 32, fixture: false },
  table: { label: 'Dining table', w: 60, d: 36, h: 30, fixture: false },
  desk: { label: 'Desk', w: 48, d: 24, h: 30, fixture: false },
  dresser: { label: 'Dresser', w: 60, d: 20, h: 36, fixture: false },
  stairs: { label: 'Stairs', w: 36, d: 120, h: 0, fixture: false },
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
  const extra = kind === 'stairs' ? { risers: 13 } : {};
  return placeFurniture(project, { id, kind, at: p, rot: 0, w: s.w, d: s.d, ...extra }, p);
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
    case 'bidet':
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
  out.push(...doorSwingChecks(project));
  return out;
}

/** Fixtures that need a supply, drain and vent. */
const WET: ReadonlySet<FurnitureKind> = new Set(['toilet', 'bidet', 'lavatory', 'tub', 'shower', 'kitchen-sink', 'laundry-sink', 'washer']);

export function furnitureLines(project: Project): MaterialLine[] {
  const count = (k: FurnitureKind) => project.furniture.filter((f) => f.kind === k).length;
  const lines: MaterialLine[] = [];
  const add = (item: string, qty: number, basis: string) => qty && lines.push({ category: 'Plumbing', item, qty, unit: 'ea', basis });
  add('Toilet (allowance)', count('toilet'), 'toilets on the plan, incl. wax ring and supply');
  add('Vanity + lavatory faucet (allowance)', count('lavatory'), 'lavatories on the plan');
  add('Bathtub + valve (allowance)', count('tub'), 'tubs on the plan');
  add('Shower pan + valve + door (allowance)', count('shower'), 'showers on the plan');
  add('Bidet (allowance)', count('bidet'), 'bidets on the plan');
  add('Kitchen sink + faucet (allowance)', count('kitchen-sink'), 'free-standing sink bases on the plan');
  add('Laundry sink + faucet (allowance)', count('laundry-sink'), 'laundry sinks on the plan');
  add('Range (allowance)', count('range'), 'free-standing ranges on the plan');
  add('Refrigerator (allowance)', count('fridge'), 'free-standing refrigerators on the plan');
  add('Washer outlet box', count('washer'), 'one per washer');
  add('Dryer vent kit', count('dryer'), 'one per dryer');
  add('Water heater (allowance)', count('water-heater'), 'water heaters on the plan');
  const rough = project.furniture.filter((f) => WET.has(f.kind)).length;
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
  let changed = false;
  const furniture = next.furniture.map((f) => {
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

/** The floor a hinged door sweeps: a quarter circle from the hinge, the leaf's width in radius. Null for windows and vehicle doors. */
export function doorSwing(project: Project, o: Opening): Point[] | null {
  if (o.kind !== 'door' || o.width > VEHICLE_DOOR) return null;
  const wall = project.walls.find((w) => w.id === o.wallId);
  if (!wall) return null;
  const d = wallDir(wall);
  const n = wallNormal(wall);
  const side = o.swing?.side ?? 1;
  const hingeAtA = (o.swing?.hinge ?? 'a') === 'a';
  const c = pointAlong(wall, o.offset);
  const k = hingeAtA ? -1 : 1;
  const t = wall.thickness / 2;
  // Same geometry as the plan symbol: hinge on the face, leaf square to the wall when open.
  const h = { x: c.x + d.x * k * (o.width / 2) + n.x * t * side, y: c.y + d.y * k * (o.width / 2) + n.y * t * side };
  const u = { x: n.x * side, y: n.y * side };
  const v = { x: -d.x * k, y: -d.y * k };
  const pts = [h];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    pts.push({ x: h.x + o.width * (u.x * Math.cos(a) + v.x * Math.sin(a)), y: h.y + o.width * (u.y * Math.cos(a) + v.y * Math.sin(a)) });
  }
  return pts;
}

/** Doors whose swing runs into a fixture, piece of furniture or counter. */
export function doorSwingChecks(project: Project): CodeCheck[] {
  const doors = project.openings.filter((o) => doorSwing(project, o));
  if (!doors.length || (!project.furniture.length && !project.counters.length)) return [];
  const out: CodeCheck[] = [];
  const things: [string, Point[]][] = [
    ...project.furniture.map((f): [string, Point[]] => [`the ${FURNITURE[f.kind].label.toLowerCase()}`, furnitureCorners(f)]),
    ...project.counters.map((c): [string, Point[]] => [c.island ? 'an island' : 'a counter', counterCorners(c)]),
  ];
  for (const o of doors) {
    const swing = doorSwing(project, o)!;
    const hits = [...new Set(things.filter(([, outline]) => blocked(swing, [outline])).map(([what]) => what))];
    if (!hits.length) continue;
    const wall = project.walls.find((w) => w.id === o.wallId)!;
    const where = roomAt(project, swing[Math.floor(swing.length / 2)])?.name;
    out.push({
      rule: 'Door swing clear',
      section: 'Layout',
      status: 'warn',
      message: `${formatFtIn(o.width)} door on ${wall.id}${where ? ` into ${where}` : ''} swings into ${hits.join(' and ')} — move it or flip the swing`,
      targetId: o.id,
    });
  }
  if (!out.length) out.push({ rule: 'Door swing clear', section: 'Layout', status: 'pass', message: `${doors.length} door swing${doors.length === 1 ? '' : 's'} clear of fixtures, furniture and counters` });
  return out;
}

/** Plan-schedule tag prefixes. Counter appliances share the free-standing ones. */
const MARK: Partial<Record<FurnitureKind, string>> = {
  toilet: 'WC', bidet: 'BD', lavatory: 'LAV', tub: 'T', shower: 'SH', 'kitchen-sink': 'S', 'laundry-sink': 'LS',
  washer: 'W', dryer: 'D', 'water-heater': 'WH', range: 'R', fridge: 'REF',
};
const CUTOUT_KIND = { sink: 'kitchen-sink', range: 'range', fridge: 'fridge', dishwasher: null } as const;

export interface ScheduleRow {
  mark: string;
  item: string;
  size: string;
  qty: number;
  rooms: string;
  /** Where each one is, for its tag on the printed plan. */
  at: Point[];
}

/**
 * The fixture schedule: one row per kind and size, tagged WC-1, LAV-1 … in
 * plan order. Sinks, ranges and fridges set in counters count too; a dishwasher
 * gets DW.
 */
export function fixtureSchedule(project: Project): ScheduleRow[] {
  type Entry = { prefix: string; item: string; size: string; room?: string; at: Point; order: number };
  const entries: Entry[] = [];
  const kinds = Object.keys(MARK) as FurnitureKind[];
  for (const f of project.furniture.filter(isFixture)) {
    entries.push({
      prefix: MARK[f.kind]!,
      item: FURNITURE[f.kind].label,
      size: `${formatFtIn(f.w)} × ${formatFtIn(f.d)}`,
      room: furnitureRoom(project, f)?.name,
      at: furniturePoint(f, 0, f.d / 2 + 6),
      order: kinds.indexOf(f.kind),
    });
  }
  for (const c of project.counters) {
    for (const k of c.cutouts) {
      const kind = CUTOUT_KIND[k.kind];
      const p = counterPoint(c, k.offset, c.depth / 2);
      entries.push({
        prefix: kind ? MARK[kind]! : 'DW',
        item: `${CUTOUT_LABEL[k.kind]} (in counter)`,
        size: `${formatFtIn(k.width)} wide`,
        room: roomAt(project, p)?.name,
        at: counterPoint(c, k.offset, c.depth + 6),
        order: kind ? kinds.indexOf(kind) + 0.5 : kinds.length,
      });
    }
  }
  entries.sort((a, b) => a.order - b.order);
  const rows: ScheduleRow[] = [];
  const counts = new Map<string, number>();
  for (const e of entries) {
    let row = rows.find((r) => r.mark.startsWith(`${e.prefix}-`) && r.item === e.item && r.size === e.size);
    if (!row) {
      const n = (counts.get(e.prefix) ?? 0) + 1;
      counts.set(e.prefix, n);
      row = { mark: `${e.prefix}-${n}`, item: e.item, size: e.size, qty: 0, rooms: '', at: [] };
      rows.push(row);
    }
    row.qty++;
    row.at.push(e.at);
    if (e.room && !row.rooms.split(', ').includes(e.room)) row.rooms = row.rooms ? `${row.rooms}, ${e.room}` : e.room;
  }
  return rows;
}
