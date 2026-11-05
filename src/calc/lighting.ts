import { dist, pointAlong, pointInPolygon, polygonArea, polygonCentroid, wallDir, wallNormal } from '../model/geometry.ts';
import { attach, roomOutletCount, roomRuns } from './electrical.ts';
import { childRooms, exclusiveArea, regionEdges, type RegionEdge } from './regions.ts';
import { HABITABLE, uid, type Fixture, type FixtureKind, type Opening, type Point, type Project, type Room, type SpaceUse, type Wall, type WallSwitch } from '../model/types.ts';
import type { CodeCheck } from './irc.ts';
import type { MaterialLine } from './materials.ts';
import { formatFtIn } from '../model/units.ts';
import { outerSides } from './faces.ts';
import { foundationOf } from './foundation.ts';
import { roofOf } from './roof.ts';
import { isStairs, needsTwoSwitches, risersOf, stairFoot, stairLights, stairSwitchWall, STAIR_SWITCH_REACH } from './stairs.ts';

// Lighting outlets, wall switches and smoke / CO alarms.
//   E3903.2  a wall-switched lighting outlet in every habitable room and bathroom
//            (rooms other than kitchens and baths may use a switched receptacle instead).
//   E3903.3  the same in hallways, stairways and garages; one on the exterior side
//            of each outdoor egress door with grade-level access (vehicle doors
//            excepted); a stairway of six or more risers switched at each floor level.
//   E3903.4  a lighting outlet, switched at the usual point of entry, in attics,
//            under-floor spaces, utility rooms and basements used for storage or
//            holding equipment that needs servicing (here: a room with a water heater,
//            and the attic / crawlspace as answered in the Project panel).
//   R314.3   smoke alarms in each sleeping room, outside each separate sleeping area
//            in the immediate vicinity of the bedrooms, and on each storey; not within
//            3 ft of a bathroom door (where that doesn't block a required one).
//   R315     CO alarms outside each separate sleeping area where the house has a
//            fuel-burning appliance or an attached garage that opens into it.
// "Immediate vicinity" has no number in the code, so the layout puts the hallway
// alarm about 3 ft out from the bedroom door and the check only asks for one in the
// room outside. Inches throughout.

/** Switch centre, measured from the edge of the door opening (inside the casing). */
const SWITCH_FROM_JAMB = 6;
export const SWITCH_HEIGHT = 48;
/** Rooms smaller than this off a bedroom (closets) are part of the sleeping area. */
const CLOSET_SQIN = 40 * 144;
/** One hallway alarm serves bedroom doors within this distance of each other (a layout choice, not code). */
const SHARE_ALARM = 240;
export const BATH_DOOR_CLEAR = 36;

/** Lighting outlets: ceiling lights, ceiling fans (with a light kit) and exterior wall lights. */
export const isLight = (k: FixtureKind) => k === 'light' || k === 'fan' || k === 'outdoor';
/** Lights a room: a ceiling light, or a fan with its light kit (a fan-only doesn't). */
export const lightsRoom = (f: Fixture) => f.kind === 'light' || (f.kind === 'fan' && f.lightKit !== false);
/** Does a room hold equipment that needs servicing (E3903.4)? */
export const hasEquipment = (project: Project, room: Room) => project.furniture.some((f) => f.kind === 'water-heater' && roomAt(project, f.at)?.id === room.id);
/** Doors wider than this are vehicle (garage) doors, which E3903.4 leaves out. */
export const VEHICLE_DOOR = 72;
/** An exterior light this close to an outdoor door lights it. */
const DOOR_LIGHT_REACH = 96;

export const detectsSmoke = (k: FixtureKind) => k === 'smoke' || k === 'smoke-co';
export const detectsCO = (k: FixtureKind) => k === 'co' || k === 'smoke-co';

/** Is `p` in this room's own region (inside it, not inside a room drawn within it)? */
export function inRegion(project: Project, room: Room, p: Point): boolean {
  return pointInPolygon(p, room.points) && !childRooms(project, room).some((c) => pointInPolygon(p, c.points));
}

/** The room whose region holds `p`: the smallest room containing it. */
export function roomAt(project: Project, p: Point): Room | undefined {
  return project.rooms.filter((r) => pointInPolygon(p, r.points)).sort((a, b) => polygonArea(a.points) - polygonArea(b.points))[0];
}

/** Distance from `p` to the nearest edge of the room's region. */
function clearance(project: Project, room: Room, p: Point): number {
  let best = Infinity;
  for (const pts of [room.points, ...childRooms(project, room).map((c) => c.points)]) {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
      const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2)) : 0;
      best = Math.min(best, dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }));
    }
  }
  return best;
}

/** A good spot for a ceiling fixture: the region's centroid, or the point furthest from its edges (L-shapes, rooms around rooms). */
export function roomCenter(project: Project, room: Room): Point {
  const c = polygonCentroid(room.points);
  const xs = room.points.map((p) => p.x);
  const ys = room.points.map((p) => p.y);
  const step = Math.max(6, (Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys)) / 80);
  let best = { p: c, d: inRegion(project, room, c) ? clearance(project, room, c) : -1 };
  const centroidScore = best.d;
  for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) {
    for (let y = Math.min(...ys) + step / 2; y < Math.max(...ys); y += step) {
      const p = { x, y };
      if (!inRegion(project, room, p)) continue;
      const d = clearance(project, room, p);
      if (d > best.d) best = { p, d };
    }
  }
  // A rectangle's centroid is its true centre; keep it unless the grid found somewhere clearly better.
  return centroidScore >= best.d - step ? c : { x: Math.round(best.p.x), y: Math.round(best.p.y) };
}

export interface RoomDoor {
  door: Opening;
  wall: Wall;
  edge: RegionEdge;
  /** Door centre, along the edge from edge.a. */
  t: number;
  /** Edge length. */
  length: number;
  dir: Point;
}

/** Doors on the room's region edges. */
export function roomDoors(project: Project, room: Room): RoomDoor[] {
  const walls = new Map(project.walls.map((w) => [w.id, w]));
  const out: RoomDoor[] = [];
  for (const edge of regionEdges(project, room)) {
    const length = dist(edge.a, edge.b);
    if (!length) continue;
    const dir = { x: (edge.b.x - edge.a.x) / length, y: (edge.b.y - edge.a.y) / length };
    for (const door of project.openings) {
      if (door.kind !== 'door') continue;
      const wall = walls.get(door.wallId);
      if (!wall) continue;
      const c = pointAlong(wall, door.offset);
      const t = (c.x - edge.a.x) * dir.x + (c.y - edge.a.y) * dir.y;
      const perp = Math.abs((c.x - edge.a.x) * dir.y - (c.y - edge.a.y) * dir.x);
      if (perp <= wall.thickness / 2 + 1 && t > 0 && t < length) out.push({ door, wall, edge, t, length, dir });
    }
  }
  return out;
}

const at = (d: RoomDoor, t: number, into: number): Point => ({
  x: d.edge.a.x + d.dir.x * t + d.edge.inward.x * into,
  y: d.edge.a.y + d.dir.y * t + d.edge.inward.y * into,
});

/** The room on the far side of a door (none for an exterior door). */
export function beyond(project: Project, room: Room, d: RoomDoor): Room | undefined {
  const r = roomAt(project, at(d, d.t, -(d.wall.thickness / 2 + 12)));
  return r && r.id !== room.id ? r : undefined;
}

/** How far a ray from the door goes into the room before it meets a wall. */
function depthFrom(project: Project, room: Room, d: RoomDoor): number {
  let s = d.wall.thickness / 2;
  while (s < 480 && inRegion(project, room, at(d, d.t, s + 3))) s += 3;
  return s;
}

/** Where a wall switch for `room` goes at this door: on the latch side, else the hinge side. */
function switchAtDoor(project: Project, room: Room, d: RoomDoor): Pick<WallSwitch, 'wallId' | 'offset' | 'side'> | null {
  const sameWay = wallDir(d.wall).x * d.dir.x + wallDir(d.wall).y * d.dir.y >= 0 ? 1 : -1;
  // swing.hinge 'a' = hinged at the wall.a end of the opening.
  const hingeSign = (d.door.swing?.hinge ?? 'a') === 'a' ? -sameWay : sameWay;
  const runs = roomRuns(project, room);
  for (const sign of [-hingeSign, hingeSign]) {
    const t = d.t + sign * (d.door.width / 2 + SWITCH_FROM_JAMB);
    const p = at(d, t, 0);
    // Must land on wall space (not past a corner or in another doorway) in this room.
    const onRun = runs.some((r) => {
      const u = (p.x - r.a.x) * r.dir.x + (p.y - r.a.y) * r.dir.y;
      const perp = Math.abs((p.x - r.a.x) * r.dir.y - (p.y - r.a.y) * r.dir.x);
      return perp < 1 && u >= 2 && u <= r.length - 2;
    });
    if (!onRun) continue;
    const placed = attach(project, p, at(d, t, 12));
    if (placed) return placed;
  }
  return null;
}

const CIRCULATION = new Set(['hall', 'living', 'kitchen']);

/** Doors ranked for the main switch: into circulation space first, exterior doors last. */
function rankedDoors(project: Project, room: Room): RoomDoor[] {
  const score = (d: RoomDoor) => {
    const b = beyond(project, room, d);
    return !b ? 2 : CIRCULATION.has(b.type) ? 0 : 1;
  };
  return roomDoors(project, room).sort((p, q) => score(p) - score(q));
}

/** The room a wall switch faces. */
export function switchRoom(project: Project, s: WallSwitch): Room | undefined {
  const w = project.walls.find((x) => x.id === s.wallId);
  if (!w) return undefined;
  const c = pointAlong(w, s.offset);
  const n = wallNormal(w);
  const k = (w.thickness / 2 + 12) * s.side;
  return roomAt(project, { x: c.x + n.x * k, y: c.y + n.y * k });
}

export function coRequired(project: Project): boolean {
  return project.electrical?.fuelAppliances === true || attachedGarage(project);
}

/** A garage with a door straight into another room of the house. */
export function attachedGarage(project: Project): boolean {
  return project.rooms.some((g) => g.type === 'garage' && roomDoors(project, g).some((d) => beyond(project, g, d)));
}

/** Bedroom doors that open onto the rest of the house, with the room outside. */
export function sleepingAreaExits(project: Project): { bedroom: Room; d: RoomDoor; outside: Room }[] {
  const out: { bedroom: Room; d: RoomDoor; outside: Room }[] = [];
  for (const bedroom of project.rooms.filter((r) => r.type === 'bedroom')) {
    for (const d of roomDoors(project, bedroom)) {
      const outside = beyond(project, bedroom, d);
      if (!outside || outside.type === 'bedroom' || outside.type === 'bath' || exclusiveArea(project, outside) < CLOSET_SQIN) continue;
      out.push({ bedroom, d, outside });
    }
  }
  return out;
}

const LIGHTED: ReadonlySet<Room['type']> = new Set(['bedroom', 'living', 'kitchen', 'bath', 'hall', 'garage', 'utility', 'other']);

/**
 * Auto-layout: a light in every room's region, a switch at its main door (a 3-way
 * pair in halls and garages with two or more doors), and smoke / CO alarms.
 * Rooms that already hold a hand-placed light or alarm keep it instead.
 */
export function autoLighting(project: Project): { fixtures: Fixture[]; switches: WallSwitch[] } {
  const fixtures: Fixture[] = [];
  const switches: WallSwitch[] = [];
  const manual = project.fixtures.filter((f) => !f.auto);
  const manualIn = (room: Room, test: (k: FixtureKind) => boolean) => manual.filter((f) => test(f.kind) && roomAt(project, f.at)?.id === room.id);
  const manualLightsIn = (room: Room) => manual.filter((f) => lightsRoom(f) && roomAt(project, f.at)?.id === room.id);
  const manualSwitches = project.switches.filter((s) => !s.auto);
  const manualSwitched = new Set(manualSwitches.flatMap((s) => s.controls));
  const manualSwitchRooms = new Set(manualSwitches.map((s) => switchRoom(project, s)?.id));

  for (const room of project.rooms) {
    if (!LIGHTED.has(room.type) || (exclusiveArea(project, room) < CLOSET_SQIN && !hasEquipment(project, room))) continue;
    const center = roomCenter(project, room);
    const lights = manualLightsIn(room).map((f) => f.id);
    if (!lights.length) {
      // Keep clear of a fan-only already hung in the middle.
      const fan = manual.find((f) => f.kind === 'fan' && dist(f.at, center) < 24);
      const beside = fan && { x: center.x + 36, y: center.y };
      const f: Fixture = { id: uid('lt'), kind: 'light', at: beside && inRegion(project, room, beside) ? beside : center, auto: true };
      fixtures.push(f);
      lights.push(f.id);
    }
    // A hand-placed switch for this room stays as the user left it.
    if (lights.some((id) => manualSwitched.has(id)) || manualSwitchRooms.has(room.id)) continue;
    const doors = rankedDoors(project, room);
    const spots: Pick<WallSwitch, 'wallId' | 'offset' | 'side'>[] = [];
    for (const d of doors) {
      const s = switchAtDoor(project, room, d);
      if (s) {
        spots.push(s);
        break;
      }
    }
    // A second switch at the door furthest from the first: a 3-way pair.
    if (spots.length && (room.type === 'hall' || room.type === 'garage') && doors.length > 1) {
      const first = pointAlong(project.walls.find((w) => w.id === spots[0].wallId)!, spots[0].offset);
      const far = [...doors].sort((p, q) => dist(at(q, q.t, 0), first) - dist(at(p, p.t, 0), first));
      for (const d of far) {
        if (dist(at(d, d.t, 0), first) < 72) break;
        const s = switchAtDoor(project, room, d);
        if (s) {
          spots.push(s);
          break;
        }
      }
    }
    if (!spots.length) {
      // No usable door (open plan): start of the longest wall space.
      const run = [...roomRuns(project, room)].sort((p, q) => q.length - p.length)[0];
      if (run && run.length >= 12) {
        const p = { x: run.a.x + run.dir.x * SWITCH_FROM_JAMB, y: run.a.y + run.dir.y * SWITCH_FROM_JAMB };
        const s = attach(project, p, { x: p.x + run.inward.x * 12, y: p.y + run.inward.y * 12 });
        if (s) spots.push(s);
      }
    }
    for (const s of spots) switches.push({ id: uid('sw'), ...s, height: SWITCH_HEIGHT, controls: [...lights], auto: true });
  }

  // E3903.3 — stairways: a light over the flight, switched by the foot on this floor.
  for (const st of project.furniture.filter(isStairs)) {
    const have = stairLights(project, st, lightsRoom).filter((f) => !f.auto);
    const lights = have.map((f) => f.id);
    if (!lights.length) {
      const f: Fixture = { id: uid('lt'), kind: 'light', at: { x: Math.round(st.at.x), y: Math.round(st.at.y) }, auto: true };
      fixtures.push(f);
      lights.push(f.id);
    }
    if (manualSwitches.some((s) => s.controls.some((c) => lights.includes(c)))) continue;
    const spot = stairSwitchWall(project, st);
    const s = spot && attach(project, spot.p, stairFoot(st));
    if (s) switches.push({ id: uid('sw'), ...s, height: SWITCH_HEIGHT, controls: lights, auto: true });
  }

  // E3903.3 — a switched light outside each outdoor door, switched at the door inside.
  for (const x of outdoorDoors(project)) {
    if (manual.some((f) => f.kind === 'outdoor' && dist(f.at, x.outside) <= DOOR_LIGHT_REACH)) continue;
    const spot = doorLightSpot(project, x);
    if (!spot) continue;
    const light: Fixture = { id: uid('lt'), kind: 'outdoor', at: spot, auto: true };
    fixtures.push(light);
    const rd = x.room && roomDoors(project, x.room).find((d) => d.door.id === x.door.id);
    const s = rd && switchAtDoor(project, x.room!, rd);
    if (!s) continue;
    const same = switches.find((o) => o.wallId === s.wallId && Math.abs(o.offset - s.offset) < 1 && o.side === s.side);
    if (same) same.controls.push(light.id);
    else switches.push({ id: uid('sw'), ...s, height: SWITCH_HEIGHT, controls: [light.id], auto: true });
  }

  // Smoke alarms: every bedroom, then outside each sleeping area.
  const co = coRequired(project);
  const alarms: { room: Room; at: Point }[] = manual.filter((f) => !isLight(f.kind)).map((f) => ({ room: roomAt(project, f.at)!, at: f.at })).filter((a) => a.room);
  const place = (room: Room, p: Point, kind: FixtureKind) => {
    fixtures.push({ id: uid('sa'), kind, at: { x: Math.round(p.x), y: Math.round(p.y) }, auto: true });
    alarms.push({ room, at: p });
  };
  for (const bedroom of project.rooms.filter((r) => r.type === 'bedroom')) {
    if (manualIn(bedroom, detectsSmoke).length) continue;
    const c = roomCenter(project, bedroom);
    const d = rankedDoors(project, bedroom)[0];
    // Halfway between the light and the door keeps it off the fixture.
    const toward = d && at(d, d.t, Math.min(36, depthFrom(project, bedroom, d) / 2));
    const p = toward && inRegion(project, bedroom, { x: (c.x + toward.x) / 2, y: (c.y + toward.y) / 2 }) ? { x: (c.x + toward.x) / 2, y: (c.y + toward.y) / 2 } : { x: c.x + 24, y: c.y };
    place(bedroom, inRegion(project, bedroom, p) ? p : c, 'smoke');
  }
  // Bedroom doors onto the same room within SHARE_ALARM of each other share one alarm, centred among them.
  const clusters: { room: Room; pts: Point[] }[] = [];
  for (const { d, outside } of sleepingAreaExits(project)) {
    const out = { ...d, edge: { ...d.edge, inward: { x: -d.edge.inward.x, y: -d.edge.inward.y } } };
    const p = at(out, d.t, Math.min(36, depthFrom(project, outside, out) / 2));
    if (alarms.some((a) => a.room.id === outside.id && dist(a.at, p) <= SHARE_ALARM)) continue;
    const c = clusters.find((k) => k.room.id === outside.id && k.pts.some((q) => dist(q, p) <= SHARE_ALARM));
    if (c) c.pts.push(p);
    else clusters.push({ room: outside, pts: [p] });
  }
  for (const { room, pts } of clusters) {
    const mean = { x: pts.reduce((t, q) => t + q.x, 0) / pts.length, y: pts.reduce((t, q) => t + q.y, 0) / pts.length };
    place(room, inRegion(project, room, mean) ? mean : pts[0], co ? 'smoke-co' : 'smoke');
  }
  // At least one per storey (this plan is one storey).
  if (!alarms.length && project.rooms.length) {
    const pick = [...project.rooms].sort((a, b) => Number(CIRCULATION.has(b.type)) - Number(CIRCULATION.has(a.type)) || exclusiveArea(project, b) - exclusiveArea(project, a))[0];
    const c = roomCenter(project, pick);
    place(pick, { x: c.x + 24, y: c.y }, co ? 'smoke-co' : 'smoke');
  }
  return { fixtures, switches };
}

export interface OutdoorDoor {
  door: Opening;
  wall: Wall;
  /** Door centre on the outside face, and the room it opens from. */
  outside: Point;
  /** Unit vector out of the house. */
  out: Point;
  room?: Room;
}

/** Doors in exterior walls that people walk through (vehicle doors left out). */
export function outdoorDoors(project: Project): OutdoorDoor[] {
  const sides = outerSides(project);
  const out: OutdoorDoor[] = [];
  for (const door of project.openings) {
    if (door.kind !== 'door' || door.width > VEHICLE_DOOR) continue;
    const wall = project.walls.find((w) => w.id === door.wallId);
    const side = wall && sides.get(wall.id);
    if (!wall || !side) continue;
    const n = wallNormal(wall);
    const o = { x: n.x * side, y: n.y * side };
    const c = pointAlong(wall, door.offset);
    const h = wall.thickness / 2;
    out.push({ door, wall, out: o, outside: { x: c.x + o.x * h, y: c.y + o.y * h }, room: roomAt(project, { x: c.x - o.x * (h + 12), y: c.y - o.y * (h + 12) }) });
  }
  return out;
}

/** Beside the door on the outside face, clear of other openings. */
function doorLightSpot(project: Project, x: OutdoorDoor): Point | null {
  const len = dist(x.wall.a, x.wall.b);
  const spans = project.openings.filter((o) => o.wallId === x.wall.id && o.id !== x.door.id).map((o) => [o.offset - o.width / 2, o.offset + o.width / 2]);
  for (const sign of [1, -1]) {
    const t = x.door.offset + sign * (x.door.width / 2 + 10);
    if (t < 6 || t > len - 6 || spans.some(([s, e]) => t > s - 4 && t < e + 4)) continue;
    const p = pointAlong(x.wall, t);
    const k = x.wall.thickness / 2 + 3;
    return { x: Math.round((p.x + x.out.x * k) * 8) / 8, y: Math.round((p.y + x.out.y * k) * 8) / 8 };
  }
  return null;
}

/** Device type per switch: single-pole, or 3-way / 4-way when several switches share a light. */
export function switchWays(project: Project): Map<string, 1 | 3 | 4> {
  const byLight = new Map<string, string[]>();
  for (const s of project.switches) for (const c of s.controls) byLight.set(c, [...(byLight.get(c) ?? []), s.id]);
  const out = new Map<string, 1 | 3 | 4>();
  for (const s of project.switches) {
    let ways: 1 | 3 | 4 = 1;
    for (const c of s.controls) {
      const group = byLight.get(c)!;
      if (group.length < 2) continue;
      // The two ends of a run are 3-ways; any between them are 4-ways.
      const w = group.indexOf(s.id) < 2 ? 3 : 4;
      if (w > ways) ways = w;
    }
    if (ways === 1 && stairPartner(project).has(s.id)) ways = 3;
    out.set(s.id, ways);
  }
  return out;
}

/** Switches on this floor controlling the light of a stair that needs one at each level: each pairs with a 3-way upstairs (or down). */
export function stairPartner(project: Project): Set<string> {
  const out = new Set<string>();
  for (const st of project.furniture.filter(needsTwoSwitches)) {
    const lights = new Set(stairLights(project, st, lightsRoom).map((f) => f.id));
    const foot = stairFoot(st);
    const mine = project.switches.find((s) => s.controls.some((c) => lights.has(c)) && switchNear(project, s, foot));
    if (mine) out.add(mine.id);
  }
  return out;
}

function switchNear(project: Project, s: WallSwitch, p: Point): boolean {
  const w = project.walls.find((x) => x.id === s.wallId);
  return !!w && dist(pointAlong(w, s.offset), p) <= STAIR_SWITCH_REACH + w.thickness;
}

export function lightingLines(project: Project): MaterialLine[] {
  const lines: MaterialLine[] = [];
  const add = (item: string, qty: number, basis: string) => qty > 0 && lines.push({ category: 'Electrical', item, qty, unit: 'ea', basis });
  const count = (k: FixtureKind) => project.fixtures.filter((f) => f.kind === k).length;
  add('Ceiling light fixture (allowance)', count('light'), 'one per lighting outlet on the plan');
  const fanOnly = project.fixtures.filter((f) => f.kind === 'fan' && f.lightKit === false).length;
  add('Ceiling fan with light kit (allowance)', count('fan') - fanOnly, 'from the plan');
  add('Ceiling fan, no light kit (allowance)', fanOnly, 'from the plan; not a lighting outlet');
  add('Exterior wall light (allowance)', count('outdoor'), 'wet-location rated, one per outdoor door light (E3903.4)');
  add('Smoke alarm, hardwired, battery backup', count('smoke'), 'interconnected (R314.4, R314.6)');
  add('Combination smoke / CO alarm, hardwired', count('smoke-co'), 'interconnected, battery backup (R314, R315)');
  add('CO alarm, hardwired', count('co'), 'battery backup (R315)');
  add('Round ceiling box, new-work', project.fixtures.length - count('fan'), 'one per light and alarm');
  add('Fan-rated ceiling box, new-work', count('fan'), 'listed for fan support');
  const ways = [...switchWays(project).values()];
  add('Single-pole switch, 15A', ways.filter((w) => w === 1).length, 'from the plan');
  add('3-way switch, 15A', ways.filter((w) => w === 3).length, 'two per light switched from two places');
  add('3-way switch, 15A, at the other floor level', stairPartner(project).size, 'pairs with the switch by each stair foot (E3903.3, six or more risers)');
  for (const [where, use] of equipmentSpaces(project)) {
    if (use && use !== 'none') add(`Attic / crawlspace light + switch (${where})`, 1, `${use} space: a light at the equipment, switched at the access (E3903.4)`);
  }
  add('4-way switch, 15A', ways.filter((w) => w === 4).length, 'between the 3-ways of a light switched from three or more places');
  return lines;
}

export function lightingChecks(project: Project): CodeCheck[] {
  const out: CodeCheck[] = [];
  if (!project.rooms.length) return out;
  if (!project.fixtures.length) {
    out.push({ rule: 'Lighting and smoke alarms', section: 'E3903 / R314', status: 'info', message: 'no lights or alarms on the plan yet — use “Auto lights” on the Plan tab' });
    return out;
  }
  const where = new Map(project.fixtures.map((f) => [f.id, roomAt(project, f.at)?.id]));
  const switched = new Set(project.switches.flatMap((s) => s.controls));
  const switchedOutlets = project.outlets.filter((o) => switched.has(o.id));
  const inRoom = (room: Room, test: (f: Fixture) => boolean) => project.fixtures.filter((f) => where.get(f.id) === room.id && test(f));

  // E3903.2 / E3903.3 — wall-switched lighting outlets.
  for (const room of project.rooms) {
    const label = room.name || room.type;
    const strict = room.type === 'kitchen' || room.type === 'bath' || room.type === 'hall' || room.type === 'garage';
    if (!strict && !HABITABLE.has(room.type)) continue;
    const section = room.type === 'hall' || room.type === 'garage' ? 'E3903.3' : 'E3903.2';
    const lights = inRoom(room, lightsRoom);
    const byReceptacle = !strict && switchedOutlets.length > 0 && roomOutletCount({ ...project, outlets: switchedOutlets }, room) > 0;
    const ok = lights.some((f) => switched.has(f.id)) || byReceptacle;
    const why = !lights.length ? 'no lighting outlet' : 'its light has no wall switch';
    out.push({
      rule: 'Wall-switched lighting outlet',
      section,
      status: ok ? 'pass' : strict ? 'fail' : 'warn',
      message: ok ? (byReceptacle && !lights.some((f) => switched.has(f.id)) ? `${label}: switched receptacle` : label) : strict ? `${label}: ${why}` : `${label}: ${why} — a wall-switched receptacle is allowed instead here`,
      targetId: room.id,
    });
  }

  // E3903.4 — outdoor doors.
  for (const x of outdoorDoors(project)) {
    const lit = project.fixtures.filter((f) => f.kind === 'outdoor' && dist(f.at, x.outside) <= DOOR_LIGHT_REACH);
    const ok = lit.some((f) => switched.has(f.id));
    out.push({
      rule: 'Light outside each outdoor door',
      section: 'E3903.3',
      status: ok ? 'pass' : 'fail',
      message: `${x.room ? `${x.room.name || x.room.type} door` : 'Exterior door'}: ${ok ? 'wall-switched exterior light' : lit.length ? 'its exterior light has no wall switch' : 'no exterior light beside it'}`,
      targetId: x.door.id,
    });
  }

  // E3903.3 — stairways.
  const ways = switchWays(project);
  for (const st of project.furniture.filter(isStairs)) {
    const lights = stairLights(project, st, lightsRoom);
    const sw = project.switches.filter((s) => s.controls.some((c) => lights.some((f) => f.id === c)));
    const label = `Stairs (${risersOf(st)} risers ${st.down ? 'down' : 'up'})`;
    out.push({
      rule: 'Wall-switched stairway light',
      section: 'E3903.3',
      status: sw.length ? 'pass' : 'fail',
      message: sw.length ? label : `${label}: ${lights.length ? 'its light has no wall switch' : 'no light over the flight'}`,
      targetId: st.id,
    });
    if (!needsTwoSwitches(st) || !lights.length) continue;
    const foot = stairFoot(st);
    const here = sw.find((s) => switchNear(project, s, foot));
    out.push({
      rule: 'Stairway switched at each floor level (6+ risers)',
      section: 'E3903.3',
      status: here ? 'pass' : 'fail',
      message: here
        ? `${label}: ${ways.get(here.id) === 4 ? '4-way' : '3-way'} by the foot here; its 3-way at the ${st.down ? 'lower' : 'upper'} level is counted in the estimate`
        : `${label}: needs a switch within ${formatFtIn(STAIR_SWITCH_REACH)} of the foot on this floor (and one at the other level)`,
      targetId: st.id,
    });
  }

  // E3903.4 — storage / equipment spaces.
  for (const room of project.rooms.filter((r) => hasEquipment(project, r))) {
    const ok = inRoom(room, lightsRoom).some((f) => switched.has(f.id));
    out.push({ rule: 'Light at equipment needing service', section: 'E3903.4', status: ok ? 'pass' : 'fail', message: `${room.name || room.type} (water heater): ${ok ? 'wall-switched light' : 'needs a light switched at the door'}`, targetId: room.id });
  }
  for (const [where, use] of equipmentSpaces(project)) {
    out.push({
      rule: `Light in the ${where}`,
      section: 'E3903.4',
      status: use === undefined ? 'info' : 'pass',
      message:
        use === undefined
          ? `say how the ${where} is used (Project panel): storage or equipment there needs a light switched at the access`
          : use === 'none'
            ? `${where} not used for storage or equipment — no light required`
            : `${where} (${use}): light at the equipment, switched at the access — counted in the estimate`,
    });
  }

  // R314.3 — smoke alarms.
  const smoke = project.fixtures.filter((f) => detectsSmoke(f.kind));
  const bedrooms = project.rooms.filter((r) => r.type === 'bedroom');
  for (const room of bedrooms) {
    const has = inRoom(room, (f) => detectsSmoke(f.kind)).length > 0;
    out.push({ rule: 'Smoke alarm in each sleeping room', section: 'R314.3', status: has ? 'pass' : 'fail', message: room.name || 'bedroom', targetId: room.id });
  }
  const exits = sleepingAreaExits(project);
  const co = coRequired(project);
  const seen = new Set<string>();
  for (const { bedroom, d, outside } of exits) {
    const door = at(d, d.t, 0);
    const near = (test: (k: FixtureKind) => boolean) =>
      project.fixtures.filter((f) => test(f.kind) && where.get(f.id) === outside.id).sort((p, q) => dist(p.at, door) - dist(q.at, door))[0];
    const s = near(detectsSmoke);
    const label = `${bedroom.name || 'bedroom'} → ${outside.name || outside.type}`;
    out.push({
      rule: 'Smoke alarm outside the sleeping area',
      section: 'R314.3',
      status: s ? 'pass' : 'fail',
      message: s ? `${label}: ${formatFtIn(dist(s.at, door))} from the door — “immediate vicinity” is the inspector’s call` : `${label}: no smoke alarm in the ${outside.name || outside.type}`,
      targetId: outside.id,
    });
    if (co && !seen.has(outside.id)) {
      seen.add(outside.id);
      const c = near(detectsCO);
      out.push({ rule: 'CO alarm outside the sleeping area', section: 'R315.3', status: c ? 'pass' : 'fail', message: c ? `${outside.name || outside.type}` : `${outside.name || outside.type}: needs a CO (or combination) alarm`, targetId: outside.id });
    }
  }
  if (!bedrooms.length) {
    out.push({ rule: 'Smoke alarm on each storey', section: 'R314.3', status: smoke.length ? 'pass' : 'fail', message: smoke.length ? `${smoke.length} on this floor` : 'no smoke alarm on this floor' });
  }

  // R314.3 — keep alarms 3 ft from bathroom doors.
  for (const bath of project.rooms.filter((r) => r.type === 'bath')) {
    for (const d of roomDoors(project, bath)) {
      const door = at(d, d.t, 0);
      const close = smoke.filter((f) => where.get(f.id) !== bath.id && dist(f.at, door) < BATH_DOOR_CLEAR);
      if (close.length) {
        out.push({ rule: 'Smoke alarm near a bathroom door', section: 'R314.3', status: 'warn', message: `${bath.name || 'bath'}: an alarm is ${formatFtIn(dist(close[0].at, door))} from the door — keep it 3 ft away unless that blocks a required one`, targetId: bath.id });
      }
    }
  }

  if (smoke.length > 1) {
    out.push({ rule: 'Alarms interconnected, hardwired with battery backup', section: 'R314.4 / R314.6', status: 'info', message: `${smoke.length} smoke alarms — wire them so one sounds them all` });
  }
  if (!co) {
    out.push({
      rule: 'CO alarms',
      section: 'R315',
      status: 'info',
      message: project.electrical?.fuelAppliances === false ? 'not required: no fuel-burning appliances and no attached garage' : 'say whether the house has gas, oil or wood appliances (Project panel) to check CO alarms',
    });
  }
  return out;
}

/** The attic (if there's a roof) and crawlspace (if that's the foundation), with how each is used. */
export function equipmentSpaces(project: Project): ['attic' | 'crawlspace', SpaceUse | undefined][] {
  const out: ['attic' | 'crawlspace', SpaceUse | undefined][] = [];
  if (roofOf(project).type !== 'none') out.push(['attic', project.electrical?.attic]);
  if (foundationOf(project).type === 'crawl') out.push(['crawlspace', project.electrical?.crawl]);
  return out;
}
