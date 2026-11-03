import { openingSpan, wallLength, wallNormal } from '../model/geometry.ts';
import { uid, type FrontSide, type Outlet, type Point, type Project, type Wall } from '../model/types.ts';
import { outerSides } from './faces.ts';
import type { CodeCheck } from './irc.ts';
import type { MaterialLine } from './materials.ts';
import { formatFtIn } from '../model/units.ts';

// Outdoor receptacles (IRC E3901.7, mirroring NEC 210.52(E)): at least one at
// the front and one at the back of the house, readily accessible from grade and
// not more than 6'-6" above it; GFCI protected (E3902). An outdoor receptacle is
// any receptacle on the outside face of an exterior wall. "Front" is the plan
// direction the Project panel says faces the street (bottom of the plan unless
// set). Grade isn't modelled, so heights are checked from the floor.

export const OUTDOOR_HEIGHT = 18;
export const OUTDOOR_MAX_HEIGHT = 78;
const BESIDE_DOOR = 18;
const END_CLEAR = 12;

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
  for (const { outlet } of found) {
    const at = formatFtIn(outlet.height);
    if (outlet.height > OUTDOOR_MAX_HEIGHT)
      out.push({ rule: 'Outdoor receptacle height', section: 'E3901.7', status: 'warn', message: `one at ${at} above the floor; it must be within 6'-6" of grade`, targetId: outlet.id });
    if (outlet.kind !== 'gfci') out.push({ rule: 'GFCI protection', section: 'E3902', status: 'warn', message: `an outdoor receptacle at ${at} isn't marked GFCI`, targetId: outlet.id });
  }
  return out;
}

export function outdoorLines(project: Project): MaterialLine[] {
  const n = outdoorOutlets(project).length;
  return n ? [{ category: 'Electrical', item: 'In-use (bubble) cover, weatherproof', qty: n, unit: 'ea', basis: 'one per outdoor receptacle; use weather-resistant (WR) receptacles there' }] : [];
}
