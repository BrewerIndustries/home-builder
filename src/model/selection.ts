import { counterCorners } from '../calc/counters.ts';
import { furnitureCorners } from '../calc/furniture.ts';
import { samePoint, wallLength } from './geometry.ts';
import type { Counter, Fixture, Furniture, Opening, Outlet, Point, Project, Room, Wall, WallSwitch } from './types.ts';
import { roomGroup, transformGroup, type Group } from './wallEdit.ts';

// Wall edits v6: several items picked at once (box-drag / Shift-click), moved,
// turned or mirrored together; aligned and distributed; copied and pasted with
// their contents. A selected room brings its contents (as a room move does);
// doors, windows, receptacles and switches ride on their walls. Inches; plan y runs down.

export type SelKind = 'wall' | 'room' | 'opening' | 'outlet' | 'switch' | 'fixture' | 'counter' | 'furniture';

/** One picked item (the same shape as the canvas's hit, minus dimension strings). */
export interface SelItem {
  kind: SelKind;
  id: string;
}

/** A group edit: slide by `delta`, turn about `pivot` (anticlockwise positive), mirror across the line a → b, or line up / space out. */
export type GroupOp =
  | { kind: 'move'; delta: Point }
  | { kind: 'turn'; deg: number; pivot?: Point }
  | { kind: 'mirror'; a: Point; b: Point }
  | { kind: 'align'; how: AlignHow }
  | { kind: 'distribute'; axis: 'x' | 'y' };

export type AlignHow = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom';

export interface Bounds {
  min: Point;
  max: Point;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const SEL_KINDS: ReadonlySet<string> = new Set(['wall', 'room', 'opening', 'outlet', 'switch', 'fixture', 'counter', 'furniture']);

export const sameItem = (a: SelItem, b: SelItem) => a.kind === b.kind && a.id === b.id;

/** Just the plan items (drops dimension strings and anything else not selectable as a group). */
export function selItems(items: readonly { kind: string; id: string }[]): SelItem[] {
  return items.filter((x) => SEL_KINDS.has(x.kind)).map((x) => ({ kind: x.kind as SelKind, id: x.id }));
}

/** Shift-click: add the item, or take it out if it's already picked. */
export function toggleItem(sel: readonly SelItem[], item: SelItem): SelItem[] {
  return sel.some((x) => sameItem(x, item)) ? sel.filter((x) => !sameItem(x, item)) : [...sel, item];
}

/** Picked items that still exist (after an undo or delete). */
export function liveItems(p: Project, sel: readonly SelItem[]): SelItem[] {
  const out = sel.filter((x) => listOf(p, x.kind).some((y) => y.id === x.id));
  return out.length === sel.length ? (sel as SelItem[]) : out;
}

function listOf(p: Project, kind: SelKind): { id: string }[] {
  return { wall: p.walls, room: p.rooms, opening: p.openings, outlet: p.outlets, switch: p.switches, fixture: p.fixtures, counter: p.counters, furniture: p.furniture }[kind];
}

/** What moves rigidly: the picked walls, rooms, counters, devices and furniture, plus everything inside a picked room. */
export function groupOf(p: Project, sel: readonly SelItem[]): Group {
  const g = { walls: new Set<string>(), rooms: new Set<string>(), counters: new Set<string>(), fixtures: new Set<string>(), furniture: new Set<string>() };
  for (const x of sel) {
    if (x.kind === 'room') {
      const r = roomGroup(p, x.id);
      for (const k of ['walls', 'rooms', 'counters', 'fixtures', 'furniture'] as const) r[k].forEach((id) => g[k].add(id));
    } else if (x.kind === 'wall') g.walls.add(x.id);
    else if (x.kind === 'counter') g.counters.add(x.id);
    else if (x.kind === 'fixture') g.fixtures.add(x.id);
    else if (x.kind === 'furniture') g.furniture.add(x.id);
  }
  return g;
}

/** Every item the group carries, as picks: for highlighting it, and grabbing it anywhere to drag. Doors, windows and wall devices on its walls included. */
export function groupMembers(p: Project, sel: readonly SelItem[]): SelItem[] {
  const g = groupOf(p, sel);
  const out: SelItem[] = [
    ...[...g.rooms].map((id) => ({ kind: 'room' as const, id })),
    ...[...g.walls].map((id) => ({ kind: 'wall' as const, id })),
    ...p.openings.filter((o) => g.walls.has(o.wallId)).map((o) => ({ kind: 'opening' as const, id: o.id })),
    ...p.outlets.filter((o) => g.walls.has(o.wallId)).map((o) => ({ kind: 'outlet' as const, id: o.id })),
    ...p.switches.filter((o) => g.walls.has(o.wallId)).map((o) => ({ kind: 'switch' as const, id: o.id })),
    ...[...g.counters].map((id) => ({ kind: 'counter' as const, id })),
    ...[...g.fixtures].map((id) => ({ kind: 'fixture' as const, id })),
    ...[...g.furniture].map((id) => ({ kind: 'furniture' as const, id })),
  ];
  for (const x of sel) if (!out.some((y) => sameItem(x, y))) out.push(x);
  return out;
}

function bounds(pts: Point[]): Bounds | null {
  if (!pts.length) return null;
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  return { min: { x: Math.min(...xs), y: Math.min(...ys) }, max: { x: Math.max(...xs), y: Math.max(...ys) } };
}

/** The plan points that outline one item (a wall's centreline ends, a room's corners, a symbol's or counter's corners, a device's spot). */
function itemPoints(p: Project, x: SelItem): Point[] {
  switch (x.kind) {
    case 'wall': {
      const w = p.walls.find((y) => y.id === x.id);
      return w ? [w.a, w.b] : [];
    }
    case 'room':
      return p.rooms.find((y) => y.id === x.id)?.points ?? [];
    case 'counter': {
      const c = p.counters.find((y) => y.id === x.id);
      return c ? counterCorners(c) : [];
    }
    case 'furniture': {
      const f = p.furniture.find((y) => y.id === x.id);
      return f ? furnitureCorners(f) : [];
    }
    case 'fixture': {
      const f = p.fixtures.find((y) => y.id === x.id);
      return f ? [f.at] : [];
    }
    default:
      return [];
  }
}

/** The box round everything a selection moves. */
export function groupBounds(p: Project, sel: readonly SelItem[]): Bounds | null {
  const g = groupOf(p, sel);
  const items: SelItem[] = [
    ...[...g.rooms].map((id) => ({ kind: 'room' as const, id })),
    ...[...g.walls].map((id) => ({ kind: 'wall' as const, id })),
    ...[...g.counters].map((id) => ({ kind: 'counter' as const, id })),
    ...[...g.fixtures].map((id) => ({ kind: 'fixture' as const, id })),
    ...[...g.furniture].map((id) => ({ kind: 'furniture' as const, id })),
  ];
  return bounds(items.flatMap((x) => itemPoints(p, x)));
}

export const boundsCentre = (b: Bounds): Point => ({ x: round3((b.min.x + b.max.x) / 2), y: round3((b.min.y + b.max.y) / 2) });

/** Reflect `q` across the line through a and b. */
export function reflect(q: Point, a: Point, b: Point): Point {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const v = { x: q.x - a.x, y: q.y - a.y };
  const t = v.x * d.x + v.y * d.y;
  return { x: round3(a.x + 2 * t * d.x - v.x), y: round3(a.y + 2 * t * d.y - v.y) };
}

/** Move, turn or mirror a group rigidly; see transformGroup. */
function rigid(p: Project, g: Group, op: Extract<GroupOp, { kind: 'move' | 'turn' | 'mirror' }>, centre: () => Point | null): Project {
  if (op.kind === 'move') {
    if (!op.delta.x && !op.delta.y) return p;
    return transformGroup(p, g, { point: (q) => ({ x: round3(q.x + op.delta.x), y: round3(q.y + op.delta.y) }), rot: (r) => r, flip: false });
  }
  if (op.kind === 'turn') {
    const c = op.pivot ?? centre();
    if (!op.deg || !c) return p;
    const r = (op.deg * Math.PI) / 180;
    const [cs, sn] = [Math.cos(r), Math.sin(r)];
    const turn = (q: Point) => ({ x: round3(c.x + (q.x - c.x) * cs + (q.y - c.y) * sn), y: round3(c.y - (q.x - c.x) * sn + (q.y - c.y) * cs) });
    // Symbols turn clockwise-positive, the plan anticlockwise: subtract.
    return transformGroup(p, g, { point: turn, rot: (x) => x - op.deg, flip: false });
  }
  const { a, b } = op;
  if (samePoint(a, b)) return p;
  // A symbol's front (0, 1) turned clockwise by r, reflected across a line at φ (screen angle), is turned 2φ − r + 180.
  const phi = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  return transformGroup(p, g, { point: (q) => reflect(q, a, b), rot: (r) => 2 * phi - r + 180, flip: true });
}

/** Is room `id` inside room `outer` (and not the same outline)? */
const nestedIn = (p: Project, id: string, outer: string) => id !== outer && roomGroup(p, outer).rooms.has(id) && !roomGroup(p, id).rooms.has(outer);

/** Separately movable units for align / distribute: each picked room (with its contents) and each picked item not inside one. Doors, windows and wall devices are skipped (they ride their walls). */
export function alignUnits(p: Project, sel: readonly SelItem[]): { items: SelItem[]; box: Bounds }[] {
  const inRooms = groupOf(p, sel.filter((x) => x.kind === 'room'));
  const covered = (x: SelItem) =>
    (x.kind === 'wall' && inRooms.walls.has(x.id)) ||
    (x.kind === 'room' && sel.some((y) => y.kind === 'room' && nestedIn(p, x.id, y.id))) ||
    (x.kind === 'counter' && inRooms.counters.has(x.id)) ||
    (x.kind === 'fixture' && inRooms.fixtures.has(x.id)) ||
    (x.kind === 'furniture' && inRooms.furniture.has(x.id));
  const out: { items: SelItem[]; box: Bounds }[] = [];
  for (const x of sel) {
    if (x.kind === 'opening' || x.kind === 'outlet' || x.kind === 'switch' || covered(x)) continue;
    const box = bounds(itemPoints(p, x));
    if (box) out.push({ items: [x], box });
  }
  return out;
}

/** Line the units up on one edge or centre line of the selection's box. */
function align(p: Project, sel: readonly SelItem[], how: AlignHow): Project {
  const units = alignUnits(p, sel);
  if (units.length < 2) return p;
  const all = bounds(units.flatMap((u) => [u.box.min, u.box.max]))!;
  const mid = boundsCentre(all);
  let next = p;
  for (const u of units) {
    const c = boundsCentre(u.box);
    const dx = how === 'left' ? all.min.x - u.box.min.x : how === 'right' ? all.max.x - u.box.max.x : how === 'centre' ? mid.x - c.x : 0;
    const dy = how === 'top' ? all.min.y - u.box.min.y : how === 'bottom' ? all.max.y - u.box.max.y : how === 'middle' ? mid.y - c.y : 0;
    next = rigid(next, groupOf(next, u.items), { kind: 'move', delta: { x: round3(dx), y: round3(dy) } }, () => null);
  }
  return next;
}

/** Space the units out evenly along x or y: the outer two stay put, the gaps between neighbours come out equal. */
function distribute(p: Project, sel: readonly SelItem[], axis: 'x' | 'y'): Project {
  const units = alignUnits(p, sel);
  if (units.length < 3) return p;
  const lo = (b: Bounds) => b.min[axis];
  const size = (b: Bounds) => b.max[axis] - b.min[axis];
  const sorted = [...units].sort((u, v) => lo(u.box) + size(u.box) / 2 - (lo(v.box) + size(v.box) / 2));
  const first = sorted[0].box;
  const last = sorted.at(-1)!.box;
  const gap = (last.max[axis] - first.min[axis] - sorted.reduce((s, u) => s + size(u.box), 0)) / (sorted.length - 1);
  let at = first.max[axis] + gap;
  let next = p;
  for (const u of sorted.slice(1, -1)) {
    const d = round3(at - lo(u.box));
    next = rigid(next, groupOf(next, u.items), { kind: 'move', delta: axis === 'x' ? { x: d, y: 0 } : { x: 0, y: d } }, () => null);
    at += size(u.box) + gap;
  }
  return next;
}

/** Apply one group edit (one undo step in the store). */
export function applyGroupOp(p: Project, sel: readonly SelItem[], op: GroupOp): Project {
  const items = liveItems(p, sel);
  if (!items.length) return p;
  if (op.kind === 'align') return align(p, items, op.how);
  if (op.kind === 'distribute') return distribute(p, items, op.axis);
  return rigid(p, groupOf(p, items), op, () => {
    const b = groupBounds(p, items);
    return b && boundsCentre(b);
  });
}

/** Mirror lines through the selection's centre: 'x' flips left ↔ right (a vertical line), 'y' top ↔ bottom. */
export function centreLine(c: Point, axis: 'x' | 'y'): { a: Point; b: Point } {
  return axis === 'x' ? { a: c, b: { x: c.x, y: c.y + 1 } } : { a: c, b: { x: c.x + 1, y: c.y } };
}

/** Which plan items a dragged box takes in: whole rooms (with their contents), then walls, counters, devices and symbols wholly inside it that aren't already in a picked room. */
export function boxSelect(p: Project, c1: Point, c2: Point): SelItem[] {
  const b = { min: { x: Math.min(c1.x, c2.x), y: Math.min(c1.y, c2.y) }, max: { x: Math.max(c1.x, c2.x), y: Math.max(c1.y, c2.y) } };
  const inBox = (q: Point) => q.x >= b.min.x - 1e-6 && q.x <= b.max.x + 1e-6 && q.y >= b.min.y - 1e-6 && q.y <= b.max.y + 1e-6;
  const rooms = p.rooms.filter((r) => r.points.length && r.points.every(inBox));
  // A room inside another picked room comes with it.
  const top = rooms.filter((r) => !rooms.some((o) => nestedIn(p, r.id, o.id)));
  const out: SelItem[] = top.map((r) => ({ kind: 'room', id: r.id }));
  const g = groupOf(p, out);
  for (const w of p.walls) if (!g.walls.has(w.id) && inBox(w.a) && inBox(w.b)) out.push({ kind: 'wall', id: w.id });
  for (const c of p.counters) if (!g.counters.has(c.id) && counterCorners(c).every(inBox)) out.push({ kind: 'counter', id: c.id });
  for (const f of p.fixtures) if (!g.fixtures.has(f.id) && inBox(f.at)) out.push({ kind: 'fixture', id: f.id });
  for (const f of p.furniture) if (!g.furniture.has(f.id) && inBox(f.at)) out.push({ kind: 'furniture', id: f.id });
  return out;
}

// ── copy / paste ─────────────────────────────────────────────────────────

/** A copied piece of plan: a room with its walls and everything on them and in it (or any picked items). */
export interface Clip {
  walls: Wall[];
  rooms: Room[];
  openings: Opening[];
  outlets: Outlet[];
  switches: WallSwitch[];
  counters: Counter[];
  fixtures: Fixture[];
  furniture: Furniture[];
}

/** Copy what a selection moves, with the doors, windows and wall devices on its walls. Switches keep only links to copied lights and receptacles. */
export function copyGroup(p: Project, sel: readonly SelItem[]): Clip | null {
  const items = liveItems(p, sel);
  const g = groupOf(p, items);
  const clip: Clip = {
    walls: p.walls.filter((w) => g.walls.has(w.id)),
    rooms: p.rooms.filter((r) => g.rooms.has(r.id)),
    openings: p.openings.filter((o) => g.walls.has(o.wallId)),
    outlets: p.outlets.filter((o) => g.walls.has(o.wallId)),
    switches: [],
    counters: p.counters.filter((c) => g.counters.has(c.id)),
    fixtures: p.fixtures.filter((f) => g.fixtures.has(f.id)),
    furniture: p.furniture.filter((f) => g.furniture.has(f.id)),
  };
  const linked = new Set([...clip.fixtures.map((f) => f.id), ...clip.outlets.map((o) => o.id)]);
  clip.switches = p.switches.filter((s) => g.walls.has(s.wallId)).map((s) => ({ ...s, controls: s.controls.filter((c) => linked.has(c)) }));
  const empty = !clip.walls.length && !clip.rooms.length && !clip.counters.length && !clip.fixtures.length && !clip.furniture.length;
  return empty ? null : structuredClone(clip);
}

/** The box round a clip's contents. */
export function clipBounds(c: Clip): Bounds | null {
  return bounds([
    ...c.walls.flatMap((w) => [w.a, w.b]),
    ...c.rooms.flatMap((r) => r.points),
    ...c.counters.flatMap(counterCorners),
    ...c.fixtures.map((f) => f.at),
    ...c.furniture.flatMap(furnitureCorners),
  ]);
}

/** A clip ready to paste: every item given a new id (`newId(prefix)`), links remapped, and slid by `delta`. */
export function placeClip(c: Clip, delta: Point, newId: (prefix: string) => string): Clip {
  const ids = new Map<string, string>();
  const re = (id: string, prefix: string) => {
    const n = newId(prefix);
    ids.set(id, n);
    return n;
  };
  const mv = (q: Point) => ({ x: round3(q.x + delta.x), y: round3(q.y + delta.y) });
  const walls = c.walls.map((w) => ({ ...w, id: re(w.id, 'w'), a: mv(w.a), b: mv(w.b) }));
  const fixtures = c.fixtures.map((f) => ({ ...f, id: re(f.id, f.kind === 'light' || f.kind === 'fan' || f.kind === 'outdoor' ? 'lt' : 'sa'), at: mv(f.at) }));
  const outlets = c.outlets.map((o) => ({ ...o, id: re(o.id, 'e'), wallId: ids.get(o.wallId)! }));
  return {
    walls,
    rooms: c.rooms.map((r) => ({ ...r, id: newId('r'), points: r.points.map(mv), ...(r.pivot ? { pivot: mv(r.pivot) } : {}) })),
    openings: c.openings.map((o) => ({ ...o, id: newId(o.kind === 'door' ? 'd' : 'n'), wallId: ids.get(o.wallId)! })),
    outlets,
    switches: c.switches.map((s) => ({ ...s, id: newId('sw'), wallId: ids.get(s.wallId)!, controls: s.controls.map((x) => ids.get(x)!).filter(Boolean) })),
    counters: c.counters.map((k) => ({ ...k, id: newId('ct'), a: mv(k.a), b: mv(k.b), cutouts: k.cutouts.map((x) => ({ ...x, id: newId('co') })) })),
    fixtures,
    furniture: c.furniture.map((f) => ({ ...f, id: newId('fu'), at: mv(f.at) })),
  };
}

/**
 * Add a placed clip to the plan. A pasted wall landing exactly on an existing
 * one (a copy set against the original) merges into it: its doors, windows and
 * devices move onto the existing wall.
 */
export function pasteClip(p: Project, c: Clip): Project {
  const walls: Wall[] = [];
  const onto = new Map<string, { wall: Wall; reversed: boolean }>();
  for (const w of c.walls) {
    const same = p.walls.find((o) => (samePoint(o.a, w.a) && samePoint(o.b, w.b)) || (samePoint(o.a, w.b) && samePoint(o.b, w.a)));
    if (same) onto.set(w.id, { wall: same, reversed: samePoint(same.a, w.b) });
    else walls.push(w);
  }
  const home = <T extends { wallId: string; offset: number }>(x: T, flip: (x: T) => T): T => {
    const m = onto.get(x.wallId);
    if (!m) return x;
    const moved = { ...x, wallId: m.wall.id, offset: m.reversed ? round3(wallLength(m.wall) - x.offset) : x.offset };
    return m.reversed ? flip(moved) : moved;
  };
  const side = <T extends { side: 1 | -1 }>(x: T): T => ({ ...x, side: x.side === 1 ? -1 : 1 });
  return {
    ...p,
    walls: [...p.walls, ...walls],
    rooms: [...p.rooms, ...c.rooms],
    openings: [...p.openings, ...c.openings.map((o) => home(o, (x): Opening => (x.swing ? { ...x, swing: { side: x.swing.side === 1 ? -1 : 1, hinge: x.swing.hinge === 'a' ? 'b' : 'a' } } : x)))],
    outlets: [...p.outlets, ...c.outlets.map((o) => home(o, side))],
    switches: [...p.switches, ...c.switches.map((s) => home(s, side))],
    counters: [...p.counters, ...c.counters],
    fixtures: [...p.fixtures, ...c.fixtures],
    furniture: [...p.furniture, ...c.furniture],
  };
}

/** The top-level picks for a pasted clip: its rooms, plus walls and items not inside one of them. */
export function clipSelection(p: Project, c: Clip): SelItem[] {
  const rooms: SelItem[] = c.rooms.map((r) => ({ kind: 'room', id: r.id }));
  const top = rooms.filter((x) => !rooms.some((o) => nestedIn(p, x.id, o.id)));
  const g = groupOf(p, top);
  return [
    ...top,
    ...c.walls.filter((w) => !g.walls.has(w.id) && p.walls.some((x) => x.id === w.id)).map((w) => ({ kind: 'wall' as const, id: w.id })),
    ...c.counters.filter((k) => !g.counters.has(k.id)).map((k) => ({ kind: 'counter' as const, id: k.id })),
    ...c.fixtures.filter((f) => !g.fixtures.has(f.id)).map((f) => ({ kind: 'fixture' as const, id: f.id })),
    ...c.furniture.filter((f) => !g.furniture.has(f.id)).map((f) => ({ kind: 'furniture' as const, id: f.id })),
  ];
}
