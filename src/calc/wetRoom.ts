import { dist, pointAlong, pointInPolygon, polygonArea, polygonCentroid, wallDir, wallLength, wallNormal } from '../model/geometry.ts';
import { formatFtIn } from '../model/units.ts';
import type { Furniture, Point, Project, Room, Wall } from '../model/types.ts';
import { FURNITURE, furnitureCorners, SHOWERS } from './furniture.ts';
import type { CodeCheck } from './irc.ts';
import type { MaterialLine } from './materials.ts';
import { exclusiveArea } from './regions.ts';

// Wet rooms and glass walls.
//
// A wet room is a room or area (often inside a bathroom, round the tub and
// shower) that is tiled floor and walls over a waterproofing membrane, with the
// floor sloped to a floor drain. Its walls get cement backer board behind the
// tile instead of drywall, up to the tile height. Walls are found by the room's
// edges: a framed wall whose face the edge runs along. Glass walls (a frameless
// screen closing the wet room off) take no tile.
//
// Code checks (IRC 2021 / NEC 2023, paraphrased, not quoted):
//   R307.2     walls round a tub with a shower head, and in a shower, get a
//              nonabsorbent finish to at least 6 ft above the floor;
//   R308.4.5   glass in walls and enclosures round tubs and showers is a
//              hazardous location — safety glazing (tempered);
//   NEC 406.9(C)  no receptacle within 3 ft horizontally and 8 ft vertically of
//              a tub rim or shower threshold (here: of a tub / shower fixture,
//              or anywhere on a wet room's floor).

/** R307.2: 6 ft of nonabsorbent finish above the floor. */
export const WET_FINISH_MIN = 72;
/** NEC 406.9(C) zone: 3 ft out, 8 ft up. */
const ZONE_OUT = 36;
const ZONE_UP = 96;

/** One stretch of a wet room's edge along a wall face. */
export interface WetFace {
  room: Room;
  wall: Wall;
  /** Along the wall (from wall.a): where the stretch starts and ends. */
  from: number;
  to: number;
  /** Tile height on this stretch. */
  height: number;
  /** Tiled area, openings below the tile line taken off (sq in). */
  area: number;
}

export const isWet = (r: Room) => !!r.wet;

/** Each edge of the room matched to the wall whose face it runs along. */
export function wetFaces(project: Project, room: Room): WetFace[] {
  if (!room.wet) return [];
  const out: WetFace[] = [];
  const pts = room.points;
  for (let i = 0; i < pts.length; i++) {
    const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
    const len = dist(a, b);
    if (len < 1) continue;
    const e = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    for (const w of project.walls) {
      const d = wallDir(w);
      if (Math.abs(d.x * e.y - d.y * e.x) > 0.02) continue; // not parallel
      const n = wallNormal(w);
      const off = (p: Point) => (p.x - w.a.x) * n.x + (p.y - w.a.y) * n.y;
      if (Math.abs(Math.abs(off(a)) - w.thickness / 2) > 1.5 || Math.abs(off(a) - off(b)) > 1) continue;
      const along = (p: Point) => (p.x - w.a.x) * d.x + (p.y - w.a.y) * d.y;
      const from = Math.max(0, Math.min(along(a), along(b)));
      const to = Math.min(wallLength(w), Math.max(along(a), along(b)));
      if (to - from < 1) continue;
      if (w.glass) {
        out.push({ room, wall: w, from, to, height: 0, area: 0 });
        continue;
      }
      const height = Math.min(room.wet.tileHeight ?? w.height, w.height);
      let area = (to - from) * height;
      for (const o of project.openings) {
        if (o.wallId !== w.id) continue;
        const span = Math.min(to, o.offset + o.width / 2) - Math.max(from, o.offset - o.width / 2);
        const bottom = o.kind === 'door' ? 0 : o.sill;
        const rise = Math.min(height, bottom + o.height) - bottom;
        if (span > 0 && rise > 0) area -= span * rise;
      }
      out.push({ room, wall: w, from, to, height, area: Math.max(0, area) });
    }
  }
  return out;
}

/** Tiled wall area per framed wall across every wet room (sq ft), for taking drywall off. */
export function tiledFaceByWall(project: Project): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of project.rooms) for (const f of wetFaces(project, r)) if (f.area) out.set(f.wall.id, (out.get(f.wall.id) ?? 0) + f.area / 144);
  return out;
}

export interface WetSummary {
  room: Room;
  /** Floor tile (sq ft). */
  floor: number;
  /** Wall tile, openings off (sq ft). */
  walls: number;
  /** Lowest tile height on its framed walls (in), or null with none found. */
  minHeight: number | null;
  /** Length of edge closed by glass (in). */
  glassEdge: number;
}

export function wetSummary(project: Project, room: Room): WetSummary {
  const faces = wetFaces(project, room);
  const tiled = faces.filter((f) => !f.wall.glass);
  return {
    room,
    floor: exclusiveArea(project, room) / 144,
    walls: tiled.reduce((s, f) => s + f.area, 0) / 144,
    minHeight: tiled.length ? Math.min(...tiled.map((f) => f.height)) : null,
    glassEdge: faces.filter((f) => f.wall.glass).reduce((s, f) => s + f.to - f.from, 0),
  };
}

/** Glass area of a glass wall, its glass doors taken off (sq ft). */
export function glassPanelArea(project: Project, w: Wall): number {
  const doors = project.openings.filter((o) => o.wallId === w.id && o.kind === 'door').reduce((s, o) => s + o.width * Math.min(o.height, w.height), 0);
  return Math.max(0, wallLength(w) * w.height - doors) / 144;
}

/** Materials for glass walls and wet rooms. */
export function wetRoomLines(project: Project): MaterialLine[] {
  const waste = 1 + project.framing.waste;
  const wastePct = `+${Math.round(project.framing.waste * 100)}% waste`;
  const lines: MaterialLine[] = [];
  const glass = project.walls.filter((w) => w.glass);
  if (glass.length) {
    const area = glass.reduce((s, w) => s + glassPanelArea(project, w), 0);
    const lf = glass.reduce((s, w) => s + wallLength(w), 0) / 12;
    lines.push({ category: 'Tile & glass', item: 'Frameless glass panel, 3/8" tempered', qty: Math.ceil(area), unit: 'sq ft', basis: `${glass.length} glass wall${glass.length === 1 ? '' : 's'}, glass doors off (made to measure, no waste)` });
    lines.push({ category: 'Tile & glass', item: 'Glass shoe / U-channel + clips', qty: Math.ceil(lf), unit: 'LF', basis: 'along the foot of each glass wall' });
    const doors = project.openings.filter((o) => o.kind === 'door' && glass.some((w) => w.id === o.wallId)).length;
    if (doors) lines.push({ category: 'Tile & glass', item: 'Frameless glass shower door + hinges (allowance)', qty: doors, unit: 'ea', basis: 'doors in glass walls' });
  }
  const wet = project.rooms.filter(isWet).map((r) => wetSummary(project, r));
  if (!wet.length) return lines;
  const floor = wet.reduce((s, w) => s + w.floor, 0);
  const walls = wet.reduce((s, w) => s + w.walls, 0);
  const names = wet.map((w) => w.room.name || 'wet room').join(', ');
  lines.push({ category: 'Tile & glass', item: 'Floor tile (wet room)', qty: Math.ceil(floor * waste), unit: 'sq ft', basis: `${Math.round(floor)} sq ft (${names}) ${wastePct}` });
  if (walls > 0) lines.push({ category: 'Tile & glass', item: 'Wall tile (wet room)', qty: Math.ceil(walls * waste), unit: 'sq ft', basis: `${Math.round(walls)} sq ft of wall to the tile line, doors and windows off ${wastePct}` });
  lines.push({ category: 'Tile & glass', item: 'Waterproofing membrane (sheet or liquid)', qty: Math.ceil((floor + walls) * waste), unit: 'sq ft', basis: `floor + tiled walls, ${Math.round(floor + walls)} sq ft ${wastePct}` });
  if (walls > 0) lines.push({ category: 'Tile & glass', item: '1/2" cement backer board, 3×5', qty: Math.ceil((walls * waste) / 15), unit: 'sheets', basis: `${Math.round(walls)} sq ft behind the wall tile, in place of drywall ${wastePct}` });
  lines.push({ category: 'Tile & glass', item: 'Thinset + grout (allowance)', qty: Math.ceil(floor + walls), unit: 'sq ft', basis: 'per sq ft tiled' });
  lines.push({ category: 'Tile & glass', item: 'Sloped mortar bed / pre-sloped floor (allowance)', qty: Math.ceil(floor), unit: 'sq ft', basis: 'the whole wet-room floor falls to the drain' });
  const linear = wet.filter((w) => w.room.wet!.drain === 'linear').length;
  const centre = wet.length - linear;
  if (linear) lines.push({ category: 'Plumbing', item: 'Linear shower drain + trap (allowance)', qty: linear, unit: 'ea', basis: 'one per wet room with a linear drain' });
  if (centre) lines.push({ category: 'Plumbing', item: 'Centre floor drain + trap (allowance)', qty: centre, unit: 'ea', basis: 'one per wet room with a centre drain' });
  return lines;
}

export const WET_SAMPLE: [RegExp, number][] = [
  [/^Frameless glass panel/, 45],
  [/^Glass shoe \/ U-channel/, 14],
  [/^Frameless glass shower door/, 900],
  [/^Floor tile \(wet room\)/, 6],
  [/^Wall tile \(wet room\)/, 5],
  [/^Waterproofing membrane/, 2.5],
  [/cement backer board/, 16],
  [/^Thinset \+ grout/, 1],
  [/^Sloped mortar bed/, 4],
  [/^Linear shower drain/, 350],
  [/^Centre floor drain/, 120],
];

/** Distance from p to a polygon (0 inside). */
function distToPolygon(p: Point, pts: Point[]): number {
  if (pointInPolygon(p, pts)) return 0;
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2));
    best = Math.min(best, dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }));
  }
  return best;
}

const TUBS = new Set(['tub', 'tub-shower']);
const wetFixture = (f: Furniture) => TUBS.has(f.kind) || SHOWERS.has(f.kind);

/** The smallest room holding p. */
function roomHolding(project: Project, p: Point): Room | undefined {
  return project.rooms.filter((r) => pointInPolygon(p, r.points)).sort((a, b) => polygonArea(a.points) - polygonArea(b.points))[0];
}

/** Wet-room and tub / shower checks: R307.2 finish height, R308.4.5 safety glazing, NEC 406.9(C) receptacle zone. */
export function wetChecks(project: Project): CodeCheck[] {
  const out: CodeCheck[] = [];
  for (const r of project.rooms.filter(isWet)) {
    const s = wetSummary(project, r);
    const name = r.name || 'Wet room';
    if (s.minHeight === null) {
      out.push({ rule: 'Wet room finish', section: 'R307.2', status: 'info', message: `${name}: no framed walls found along its edges — tile height can't be checked`, targetId: r.id });
    } else if (s.minHeight < WET_FINISH_MIN) {
      out.push({ rule: 'Wet room finish', section: 'R307.2', status: 'fail', message: `${name}: wall tile stops at ${formatFtIn(s.minHeight)} — a shower's walls need a nonabsorbent finish to at least 6' 0" above the floor`, targetId: r.id });
    } else {
      out.push({ rule: 'Wet room finish', section: 'R307.2', status: 'pass', message: `${name}: walls tiled to ${formatFtIn(s.minHeight)} or more (6' 0" needed)`, targetId: r.id });
    }
    out.push({ rule: 'Wet room floor', section: 'R307.2', status: 'info', message: `${name}: tile floor over a waterproofing membrane, sloped to the ${r.wet!.drain === 'linear' ? 'linear' : 'centre'} drain (a common rule of thumb is 1/4" per foot)`, targetId: r.id });
  }
  const glass = project.walls.filter((w) => w.glass);
  if (glass.length) {
    out.push({ rule: 'Safety glazing', section: 'R308.4.5', status: 'info', message: `${glass.length} glass wall${glass.length === 1 ? '' : 's'}: glass round a tub or shower must be safety glazing (tempered) — order it marked as such` });
  }

  // NEC 406.9(C): receptacle zones round tubs, showers and wet-room floors.
  const zones: { label: string; pts: Point[]; top: number; room?: Room }[] = [
    ...project.furniture.filter(wetFixture).map((f) => ({ label: `the ${FURNITURE[f.kind].label.toLowerCase()}`, pts: furnitureCorners(f), top: FURNITURE[f.kind].h, room: roomHolding(project, f.at) })),
    ...project.rooms.filter(isWet).map((r) => ({ label: r.name || 'the wet room', pts: r.points, top: 0, room: r })),
  ];
  if (!zones.length) return out;
  const walls = new Map(project.walls.map((w) => [w.id, w]));
  let fails = 0;
  for (const o of project.outlets) {
    const w = walls.get(o.wallId);
    if (!w) continue;
    const n = wallNormal(w);
    const at = pointAlong(w, o.offset);
    const face = { x: at.x + n.x * o.side * (w.thickness / 2), y: at.y + n.y * o.side * (w.thickness / 2) };
    const probe = { x: face.x + n.x * o.side * 2, y: face.y + n.y * o.side * 2 };
    for (const z of zones) {
      // The zone doesn't reach through a wall: only receptacles facing into the zone's room (or the wet room itself).
      if (z.room && !pointInPolygon(probe, z.room.points)) {
        const holder = roomHolding(project, probe);
        if (!holder || (holder.id !== z.room.id && !pointInPolygon(polygonCentroid(holder.points), z.room.points))) continue;
      }
      const d = distToPolygon(face, z.pts);
      if (d <= ZONE_OUT && o.height <= z.top + ZONE_UP) {
        fails++;
        out.push({ rule: 'Receptacle near tub / shower', section: 'NEC 406.9(C)', status: 'fail', message: `a receptacle ${d < 1 ? 'is inside' : `is ${formatFtIn(d)} from`} ${z.label} — none allowed within 3' 0" horizontally and 8' 0" above the rim or threshold`, targetId: o.id });
        break;
      }
    }
  }
  if (!fails) out.push({ rule: 'Receptacle near tub / shower', section: 'NEC 406.9(C)', status: 'pass', message: `no receptacles within 3' 0" of ${zones.length} tub / shower zone${zones.length === 1 ? '' : 's'}` });
  return out;
}
