import { projectOnWall, pointAlong, wallLength } from '../model/geometry.ts';
import type { Fixture, Furniture, Point, Project, Wall } from '../model/types.ts';
import { formatFtIn } from '../model/units.ts';
import { HEADER_DEPTH } from './framing.ts';
import type { CodeCheck } from './irc.ts';

// Stairs on a one-storey plan: a flight going up (or down) from this floor.
//   E3903.3  stairways get a wall-switched lighting outlet; where the flight has
//            six or more risers, a switch at each floor level — here, one by the
//            foot on this floor and a matching 3-way counted for the other level.
//            A landing with a door off it gets a switch too (counted as a 4-way).
//   R311.7.1 36" clear width; R311.7.2 6' 8" headroom; R311.7.3 a flight rises
//            151" at most between floor levels or landings; R311.7.5.1 risers
//            7-3/4" at most; R311.7.5.2 treads 10" at least; R311.7.6 a landing
//            as wide as the stair and 36" deep in the direction of travel.
// The foot is the stair's front (+y in its own frame); the flight runs back from it.
// A landing is counted in risers from the foot, and drawn as a step the stair's
// width deep (36" at least) at that point of the run.

/** Risers at which a stairway needs a switch at each floor level. */
export const STAIR_SWITCH_RISERS = 6;
/** A light this close to the stair's outline lights it. */
const STAIR_LIGHT_REACH = 24;
/** A switch this close to the foot is "at" this level's end. */
export const STAIR_SWITCH_REACH = 72;

export const isStairs = (f: Furniture) => f.kind === 'stairs';
export const risersOf = (f: Furniture) => f.risers ?? 13;
export const needsTwoSwitches = (f: Furniture) => isStairs(f) && risersOf(f) >= STAIR_SWITCH_RISERS;

function local(f: Furniture, x: number, y: number): Point {
  const r = (f.rot * Math.PI) / 180;
  return { x: f.at.x + x * Math.cos(r) - y * Math.sin(r), y: f.at.y + x * Math.sin(r) + y * Math.cos(r) };
}

/** Middle of the stair's front edge: where you step on from this floor. */
export const stairFoot = (f: Furniture) => local(f, 0, f.d / 2);

/** Is a plan point over the stair, or within `slop` of it? */
function near(f: Furniture, p: Point, slop: number): boolean {
  const r = (-f.rot * Math.PI) / 180;
  const [dx, dy] = [p.x - f.at.x, p.y - f.at.y];
  const x = dx * Math.cos(r) - dy * Math.sin(r);
  const y = dx * Math.sin(r) + dy * Math.cos(r);
  return Math.abs(x) <= f.w / 2 + slop && Math.abs(y) <= f.d / 2 + slop;
}

/** Room lights over or right beside a stair. */
export const stairLights = (project: Project, f: Furniture, lights: (x: Fixture) => boolean): Fixture[] =>
  project.fixtures.filter((x) => lights(x) && near(f, x.at, STAIR_LIGHT_REACH));

/** The wall nearest the foot (within reach), and the spot on its centreline square to the foot. */
export function stairSwitchWall(project: Project, f: Furniture): { wall: Wall; p: Point } | null {
  const foot = stairFoot(f);
  let best: { wall: Wall; p: Point; d: number } | null = null;
  for (const w of project.walls) {
    const { along, perp } = projectOnWall(w, foot);
    const len = wallLength(w);
    if (along < 3 || along > len - 3) continue;
    const d = Math.abs(perp) - w.thickness / 2;
    if (d > STAIR_SWITCH_REACH || (best && d >= best.d)) continue;
    best = { wall: w, p: pointAlong(w, along), d };
  }
  return best && { wall: best.wall, p: best.p };
}


/** R311.7 limits, inches. */
export const MAX_RISER = 7.75;
export const MIN_TREAD = 10;
export const MIN_HEADROOM = 80;
export const MIN_STAIR_WIDTH = 36;
export const MAX_FLIGHT_RISE = 151;
export const MIN_LANDING = 36;
/** Subfloor on the floor framing, for the estimated floor-to-floor height. */
const SUBFLOOR = 0.75;

/** Floor to floor: as typed, else the wall height plus a floor (the foundation's joists + subfloor). */
export function floorToFloor(project: Project, f: Furniture): number {
  return f.rise ?? project.framing.wallHeight + HEADER_DEPTH[project.foundation?.joistSize ?? '2x10'] + SUBFLOOR;
}

/** The landing's riser count from the foot, if it's a real one (between the first and last riser). */
export const landingAt = (f: Furniture) => (f.landing && f.landing > 0 && f.landing < risersOf(f) ? Math.round(f.landing) : undefined);

export interface StairGeometry {
  risers: number;
  rise: number;
  riser: number;
  tread: number;
  treads: number;
  landingDepth: number;
  /** Rise of each flight between floor levels or the landing. */
  flights: number[];
  /** How long the floor opening over the flight has to be for 6' 8" headroom (0 if the whole run already clears). */
  opening: number;
}

export function stairGeometry(project: Project, f: Furniture): StairGeometry {
  const risers = risersOf(f);
  const rise = floorToFloor(project, f);
  const riser = rise / risers;
  const L = landingAt(f);
  const landingDepth = L ? Math.max(MIN_LANDING, f.w) : 0;
  const treads = Math.max(0, risers - 1 - (L ? 1 : 0));
  const tread = treads ? Math.max(0, f.d - landingDepth) / treads : f.d;
  const flights = L ? [L * riser, (risers - L) * riser] : [rise];
  // Steps up from the bottom (the landing is one, deeper, step); headroom runs out where a step's
  // height comes within 6' 8" of the ceiling, and the opening has to run from there to the top.
  const depths = Array.from({ length: risers - 1 }, (_, i) => (L && i + 1 === L ? landingDepth : tread));
  if (f.down) depths.reverse();
  const H = project.framing.wallHeight;
  let x = 0;
  let opening = 0;
  for (let k = 1; k <= depths.length; k++) {
    if (k * riser > H - MIN_HEADROOM) {
      opening = f.d - x;
      break;
    }
    x += depths[k - 1];
  }
  return { risers, rise, riser, tread, treads, landingDepth, flights, opening };
}

/** Middle of the landing on the plan. */
export function landingPoint(project: Project, f: Furniture): Point | null {
  const L = landingAt(f);
  if (!L) return null;
  const g = stairGeometry(project, f);
  return local(f, 0, f.d / 2 - ((L - 1) * g.tread + g.landingDepth / 2));
}

/** The wall nearest a plan point (within reach), and the spot on its centreline square to it. */
export function nearestSwitchWall(project: Project, p: Point): { wall: Wall; p: Point } | null {
  let best: { wall: Wall; p: Point; d: number } | null = null;
  for (const w of project.walls) {
    const { along, perp } = projectOnWall(w, p);
    const len = wallLength(w);
    if (along < 3 || along > len - 3) continue;
    const d = Math.abs(perp) - w.thickness / 2;
    if (d > STAIR_SWITCH_REACH || (best && d >= best.d)) continue;
    best = { wall: w, p: pointAlong(w, along), d };
  }
  return best && { wall: best.wall, p: best.p };
}

/** R311.7: width, risers, treads, flight rise, landing and headroom, from the stair as drawn. */
export function stairChecks(project: Project): CodeCheck[] {
  const out: CodeCheck[] = [];
  for (const f of project.furniture.filter(isStairs)) {
    const g = stairGeometry(project, f);
    const label = `Stairs (${g.risers} risers ${f.down ? 'down' : 'up'})`;
    const add = (rule: string, section: string, ok: boolean, message: string, status?: CodeCheck['status']) =>
      out.push({ rule, section, status: status ?? (ok ? 'pass' : 'fail'), message: `${label}: ${message}`, targetId: f.id });
    add('Stair width (36" clear)', 'R311.7.1', f.w >= MIN_STAIR_WIDTH - 0.01, `${formatFtIn(f.w)} wide${f.w >= MIN_STAIR_WIDTH - 0.01 ? '' : ' — wants 3\' 0" clear'}`);
    add('Riser height (7-3/4" max)', 'R311.7.5.1', g.riser <= MAX_RISER + 0.01, `${formatFtIn(g.rise)} floor to floor ÷ ${g.risers} = ${formatFtIn(g.riser)} risers${g.riser <= MAX_RISER + 0.01 ? '' : ` — needs ${Math.ceil(g.rise / MAX_RISER)} or more`}`);
    add(
      'Tread depth (10" min)',
      'R311.7.5.2',
      g.tread >= MIN_TREAD - 0.01,
      `${g.treads} treads in ${formatFtIn(f.d - g.landingDepth)} of run = ${formatFtIn(g.tread)}${g.tread >= MIN_TREAD - 0.01 ? '' : ` — needs ${formatFtIn(g.treads * MIN_TREAD + g.landingDepth)} of run`}`,
    );
    const tall = g.flights.some((r) => r > MAX_FLIGHT_RISE + 0.01);
    add(
      'Flight rise (151" max between landings)',
      'R311.7.3',
      !tall,
      tall ? `rises ${formatFtIn(Math.max(...g.flights))} in one flight — add a landing part way` : g.flights.length > 1 ? `flights of ${g.flights.map((r) => formatFtIn(r)).join(' and ')}` : `one flight of ${formatFtIn(g.rise)}`,
    );
    if (landingAt(f)) {
      const deep = f.w <= g.landingDepth;
      add('Landing size', 'R311.7.6', deep, `landing ${formatFtIn(f.w)} wide × ${formatFtIn(g.landingDepth)} deep (as wide as the stair, 3' 0" deep at least)`);
    }
    add(
      'Headroom (6\' 8")',
      'R311.7.2',
      true,
      g.opening > 0
        ? `with a ${formatFtIn(project.framing.wallHeight)} ceiling, the floor opening over the flight (${f.down ? 'in this floor' : 'in the floor above'}) has to run at least ${formatFtIn(g.opening)} back from the top — check it on that floor`
        : 'clears 6\' 8" under a full ceiling',
      'info',
    );
  }
  return out;
}
