import { openingSpan, pointAlong, pointInPolygon, wallLength, wallNormal } from '../model/geometry.ts';
import { uid, type FrontSide, type Opening, type Outlet, type Point, type Project, type SiteArea, type Wall } from '../model/types.ts';
import { outerSides } from './faces.ts';
import { foundationOf } from './foundation.ts';
import { foundationWallHeight } from './foundationV2.ts';
import type { CodeCheck } from './irc.ts';
import type { MaterialLine } from './materials.ts';
import { formatFtIn } from '../model/units.ts';

// Outdoor receptacles (IRC E3901.7, mirroring NEC 210.52(E)): at least one at
// the front and one at the back of the house, readily accessible from grade and
// not more than 6'-6" above it; GFCI protected (E3902). An outdoor receptacle is
// any receptacle on the outside face of an exterior wall. "Front" is the plan
// direction the Project panel says faces the street (bottom of the plan unless
// set).
//
// v2: heights are checked above GRADE — the floor's height above the outside
// ground comes from the foundation (slab: thickened edge less its depth below
// grade; crawlspace: footing + stem less the footing depth, plus sill, joists and
// subfloor) unless typed in the Project panel. Decks, balconies and porches
// (NEC 210.52(E)(3)) are site areas drawn as Deck, or labelled porch / balcony /
// deck / stoop, that a door opens onto: each needs a receptacle reached from its
// walking surface, not more than 6'-6" above it. The walking surface is taken as
// the floor level (decks are framed to sit just below the door threshold).

export const OUTDOOR_HEIGHT = 18;
export const OUTDOOR_MAX_HEIGHT = 78;
const BESIDE_DOOR = 18;
const END_CLEAR = 12;

const JOIST_DEPTH = { '2x8': 7.25, '2x10': 9.25, '2x12': 11.25 } as const;

/** Finished floor above the outside grade, and where the figure came from. */
export function floorAboveGrade(project: Project): { height: number; from: 'set' | 'foundation' | 'unknown' } {
  const set = project.electrical?.floorAboveGrade;
  if (set !== undefined) return { height: set, from: 'set' };
  const f = foundationOf(project);
  if (f.type === 'slab') return { height: Math.max(0, f.edgeDepth - f.footingDepth), from: 'foundation' };
  if (f.type === 'crawl' || f.type === 'basement') return { height: Math.max(0, f.footingThickness + foundationWallHeight(f) - f.footingDepth) + 1.5 + JOIST_DEPTH[f.joistSize] + 0.75, from: 'foundation' };
  return { height: 0, from: 'unknown' };
}

const DECK_LABEL = /porch|balcon|deck|stoop|veranda|lanai/i;

/** Site areas that are a deck, balcony or porch. */
export const isDeck = (a: SiteArea) => a.material === 'decking' || ((a.material === 'concrete' || a.material === 'pavers') && DECK_LABEL.test(a.label ?? ''));

/** A point just outside a wall's outer face. */
function outside(w: Wall, side: 1 | -1, t: number, out = 12): Point {
  const n = wallNormal(w);
  const c = pointAlong(w, t);
  const d = (w.thickness / 2 + out) * side;
  return { x: c.x + n.x * d, y: c.y + n.y * d };
}

export interface DeckArea {
  area: SiteArea;
  /** Exterior doors that open onto it. */
  doors: { door: Opening; wall: Wall; side: 1 | -1 }[];
}

/** Decks, balconies and porches reached by a door from inside. */
export function deckAreas(project: Project): DeckArea[] {
  const areas = (project.site?.areas ?? []).filter(isDeck);
  if (!areas.length) return [];
  const walls = outdoorWalls(project);
  return areas
    .map((area) => ({
      area,
      doors: walls.flatMap(({ wall, side }) =>
        project.openings.filter((o) => o.wallId === wall.id && o.kind === 'door' && pointInPolygon(outside(wall, side, o.offset), area.points)).map((door) => ({ door, wall, side })),
      ),
    }))
    .filter((d) => d.doors.length > 0);
}

/** Outdoor receptacles reached from a deck's walking surface. */
export function deckOutlets(project: Project, d: DeckArea): Outlet[] {
  const walls = new Map(project.walls.map((w) => [w.id, w]));
  return outdoorOutlets(project)
    .map((f) => f.outlet)
    .filter((o) => {
      const w = walls.get(o.wallId);
      return !!w && pointInPolygon(outside(w, o.side, o.offset), d.area.points);
    });
}

const FRONT_DIR: Record<FrontSide, Point> = { bottom: { x: 0, y: 1 }, top: { x: 0, y: -1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

export const frontOf = (project: Project): FrontSide => project.electrical?.front ?? 'bottom';

export type Facing = 'front' | 'back' | 'side';

interface OutdoorWall {
  wall: Wall;
  /** Outer side, relative to wallNormal. */
  side: 1 | -1;
  facing: Facing;
}

/** Exterior walls with their outside face and which way it faces. */
export function outdoorWalls(project: Project): OutdoorWall[] {
  const f = FRONT_DIR[frontOf(project)];
  const out: OutdoorWall[] = [];
  for (const [id, side] of outerSides(project)) {
    const wall = project.walls.find((w) => w.id === id)!;
    const n = wallNormal(wall);
    const d = (n.x * f.x + n.y * f.y) * side;
    out.push({ wall, side, facing: d >= 0.7 ? 'front' : d <= -0.7 ? 'back' : 'side' });
  }
  return out;
}

/** Receptacles on the outside face of an exterior wall, with the way they face. */
export function outdoorOutlets(project: Project): { outlet: Outlet; facing: Facing }[] {
  const walls = new Map(outdoorWalls(project).map((w) => [w.wall.id, w]));
  return project.outlets.flatMap((o) => {
    const w = walls.get(o.wallId);
    return w && o.side === w.side ? [{ outlet: o, facing: w.facing }] : [];
  });
}

/** A clear spot on a wall: beside an exterior door if there is one, else its middle. */
function spotOn(project: Project, w: Wall): number | null {
  const len = wallLength(w);
  const spans = project.openings.filter((o) => o.wallId === w.id).map(openingSpan);
  const clear = (t: number) => t >= END_CLEAR && t <= len - END_CLEAR && spans.every((s) => t < s.start - 3 || t > s.end + 3);
  const doors = project.openings.filter((o) => o.wallId === w.id && o.kind === 'door').map(openingSpan);
  const candidates = [...doors.flatMap((s) => [s.end + BESIDE_DOOR, s.start - BESIDE_DOOR]), len / 2, ...spans.flatMap((s) => [s.end + BESIDE_DOOR, s.start - BESIDE_DOOR])];
  const t = candidates.find(clear);
  return t === undefined ? null : Math.round(t);
}

/** One GFCI at the front and one at the back, preferring a wall with a door, then the longest. */
export function autoOutdoor(project: Project): Outlet[] {
  const out: Outlet[] = [];
  const all = outdoorWalls(project);
  for (const facing of ['front', 'back'] as const) {
    const hasDoor = (w: Wall) => project.openings.some((o) => o.wallId === w.id && o.kind === 'door');
    const ranked = all
      .filter((w) => w.facing === facing)
      .sort((p, q) => Number(hasDoor(q.wall)) - Number(hasDoor(p.wall)) || wallLength(q.wall) - wallLength(p.wall));
    for (const w of ranked) {
      const t = spotOn(project, w.wall);
      if (t === null) continue;
      out.push({ id: uid('e'), wallId: w.wall.id, offset: t, side: w.side, kind: 'gfci', height: OUTDOOR_HEIGHT, auto: true });
      break;
    }
  }
  // Decks, balconies and porches: one beside a door onto each, unless one already lands there.
  for (const d of deckAreas(project)) {
    if (deckOutlets({ ...project, outlets: [...project.outlets.filter((o) => !o.auto), ...out] }, d).length) continue;
    for (const { door, wall, side } of d.doors) {
      const len = wallLength(wall);
      const spans = project.openings.filter((o) => o.wallId === wall.id).map(openingSpan);
      const s = openingSpan(door);
      const t = [s.end + BESIDE_DOOR, s.start - BESIDE_DOOR, s.end + 6, s.start - 6].find(
        (x) => x >= END_CLEAR && x <= len - END_CLEAR && spans.every((o) => x < o.start - 3 || x > o.end + 3) && pointInPolygon(outside(wall, side, x), d.area.points),
      );
      if (t === undefined) continue;
      out.push({ id: uid('e'), wallId: wall.id, offset: Math.round(t), side, kind: 'gfci', height: OUTDOOR_HEIGHT, auto: true });
      break;
    }
  }
  return out;
}

export function outdoorChecks(project: Project): CodeCheck[] {
  const walls = outdoorWalls(project);
  if (!walls.length) return [];
  const out: CodeCheck[] = [];
  const found = outdoorOutlets(project);
  const front = frontOf(project);
  for (const facing of ['front', 'back'] as const) {
    const has = found.some((f) => f.facing === facing);
    const wall = walls.find((w) => w.facing === facing);
    out.push({
      rule: `Outdoor receptacle at the ${facing}`,
      section: 'E3901.7',
      status: has ? 'pass' : 'fail',
      message: has
        ? `${found.filter((f) => f.facing === facing).length} on the ${facing} (front = ${front} of the plan)`
        : `none on the outside of the ${facing} walls (front = ${front} of the plan; change it in the Project panel)`,
      targetId: wall?.wall.id,
    });
  }
  const onDeck = new Set<string>();
  for (const d of deckAreas(project)) {
    const here = deckOutlets(project, d);
    for (const o of here) onDeck.add(o.id);
    const name = d.area.label || (d.area.material === 'decking' ? 'deck' : 'porch');
    out.push({
      rule: 'Deck, balcony or porch receptacle',
      section: 'NEC 210.52(E)(3)',
      status: here.length ? 'pass' : 'fail',
      message: here.length ? `${here.length} reached from the ${name}` : `the ${name} a door opens onto needs a receptacle reached from its walking surface (on the wall beside the door)`,
      targetId: d.doors[0].door.id,
    });
  }
  const grade = floorAboveGrade(project);
  const gradeNote =
    grade.from === 'set'
      ? `the floor is ${formatFtIn(grade.height)} above grade (Project panel)`
      : grade.from === 'foundation'
        ? `the floor is ${formatFtIn(grade.height)} above grade (from the foundation)`
        : 'no foundation, so the floor is taken at grade';
  for (const { outlet } of found) {
    const at = formatFtIn(outlet.height);
    if (onDeck.has(outlet.id)) {
      if (outlet.height > OUTDOOR_MAX_HEIGHT)
        out.push({ rule: 'Deck receptacle height', section: 'NEC 210.52(E)(3)', status: 'warn', message: `one at ${at} above the deck (taken at floor level); keep it within 6'-6" of the walking surface`, targetId: outlet.id });
    } else if (outlet.height + grade.height > OUTDOOR_MAX_HEIGHT) {
      out.push({ rule: 'Outdoor receptacle height', section: 'E3901.7', status: 'warn', message: `one at ${at} above the floor is ${formatFtIn(outlet.height + grade.height)} above grade — ${gradeNote}; it must be within 6'-6" of grade`, targetId: outlet.id });
    }
    if (outlet.kind !== 'gfci') out.push({ rule: 'GFCI protection', section: 'E3902', status: 'warn', message: `an outdoor receptacle at ${at} isn't marked GFCI`, targetId: outlet.id });
  }
  return out;
}

export function outdoorLines(project: Project): MaterialLine[] {
  const n = outdoorOutlets(project).length;
  return n ? [{ category: 'Electrical', item: 'In-use (bubble) cover, weatherproof', qty: n, unit: 'ea', basis: 'one per outdoor receptacle; use weather-resistant (WR) receptacles there' }] : [];
}
