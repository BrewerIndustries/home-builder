import { projectOnWall, pointAlong, wallDir, wallLength } from '../model/geometry.ts';
import type { Fixture, Furniture, Point, Project, Wall } from '../model/types.ts';
import { formatFtIn } from '../model/units.ts';
import { adjacentStorey, isMultiStorey, storeyHeight } from '../model/storeys.ts';
import type { CodeCheck } from './irc.ts';
import { endEdge, flightSides, flightsOf, isTurning, landingOf, openEdge, pathLength, pathRects, rectPolygon, stairSegments, toPlan, turnLanding, walledEdge } from './stairShape.ts';

// Stairs on a one-storey plan: a flight going up (or down) from this floor.
//   E3903.3  stairways get a wall-switched lighting outlet; where the flight has
//            six or more risers, a switch at each floor level — here, one by the
//            foot on this floor and a matching 3-way counted for the other level.
//            A landing with a door off it gets a switch too (counted as a 4-way).
//   R311.7.8 a handrail on at least one side of a flight with four or more
//            risers, 34"–38" above the nosings (R311.7.8.1);
//   R312.1.1 guards on open sides more than 30" above the floor below, 34" high
//            along a stair (R312.1.2), 36" round a floor opening;
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

/** Middle of the stair's far end, where it arrives at the other floor, and the direction of travel off it. */
export function stairEnd(f: Furniture): { at: Point; dir: Point } {
  const last = stairSegments(f).at(-1)!;
  const at = toPlan(f, last.to);
  const beyond = toPlan(f, { x: last.to.x + last.dir.x, y: last.to.y + last.dir.y });
  return { at, dir: { x: beyond.x - at.x, y: beyond.y - at.y } };
}

/** Middle of the stair's front edge: where you step on from this floor. */
export const stairFoot = (f: Furniture) => (isTurning(f) ? toPlan(f, stairSegments(f)[0].from) : local(f, 0, f.d / 2));

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
/**
 * Floor to floor: as typed, else the storey's height — this one's going up, the
 * one below going down — which is the wall height plus a floor (the foundation's
 * joists + subfloor) unless the storey sets it.
 */
export function floorToFloor(project: Project, f: Furniture): number {
  if (f.rise !== undefined) return f.rise;
  const below = f.down && isMultiStorey(project) ? adjacentStorey(project, -1) : null;
  return storeyHeight(project, below ?? undefined);
}

/** The storey a stair arrives at (above going up, below going down), when the project has it. */
export function stairTarget(project: Project, f: Furniture) {
  return isMultiStorey(project) ? adjacentStorey(project, f.down ? -1 : 1) : null;
}

/** Length of the floor opening over the flight, back from the top: as set, else the whole stair. */
export const openingLength = (f: Furniture) => Math.max(0, Math.min(pathLength(f), f.floorOpening ?? pathLength(f)));

/**
 * The floor opening on the plan: the stretch of the stair within `openingLength`
 * of its top. Going up it is in the floor above (the far end of the run is the
 * top); going down it is in this floor (the foot is the top).
 */
export function floorOpeningPolygons(f: Furniture): Point[][] {
  return openingRects(f).map((r) => rectPolygon(f, r));
}

/** The opening as stair-frame rectangles (one per flight / landing it covers). */
export function openingRects(f: Furniture) {
  const o = openingLength(f);
  const S = pathLength(f);
  return f.down ? pathRects(f, 0, o) : pathRects(f, S - o, S);
}

/**
 * Open edge round the floor opening, on the floor it's in (`walls`): its
 * outline less the end you step on or off at the top, and less walls.
 */
export function openingGuardLength(f: Furniture, walls: Wall[]): number {
  const segs = stairSegments(f);
  const top = f.down ? endEdge(segs[0], 'from') : endEdge(segs[segs.length - 1], 'to');
  return openEdge(f, openingRects(f), walls, [top]);
}

/** The landing's riser count from the foot, if it's a real one (between the first and last riser). */
export const landingAt = (f: Furniture) => (isTurning(f) ? turnLanding(f) : f.landing && f.landing > 0 && f.landing < risersOf(f) ? Math.round(f.landing) : undefined);

export interface StairGeometry {
  risers: number;
  rise: number;
  riser: number;
  tread: number;
  treads: number;
  landingDepth: number;
  /** Rise of each flight between floor levels or the landing. */
  flights: number[];
  /** How long the floor opening over the flight has to be for 6' 8" headroom (0 if the whole run already clears), along the walk line. */
  opening: number;
  /** L / U stairs: each flight's risers, treads, tread depth, run and rise. */
  flightRuns?: { risers: number; treads: number; tread: number; run: number; rise: number }[];
}

export function stairGeometry(project: Project, f: Furniture): StairGeometry {
  if (isTurning(f)) return turningGeometry(project, f);
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

/** An L or U stair: each flight from its own run; the landing is one (long) step on the walk line. */
function turningGeometry(project: Project, f: Furniture): StairGeometry {
  const risers = risersOf(f);
  const rise = floorToFloor(project, f);
  const riser = rise / risers;
  const runs = flightsOf(f).map((s) => ({ risers: s.risers, treads: Math.max(0, s.risers - 1), tread: s.risers > 1 ? s.len / (s.risers - 1) : s.len, run: s.len, rise: s.risers * riser }));
  const landing = landingOf(f)!;
  const depths = [...Array(runs[0].treads).fill(runs[0].tread), landing.len, ...Array(runs[1].treads).fill(runs[1].tread)] as number[];
  if (f.down) depths.reverse();
  const S = pathLength(f);
  const H = project.framing.wallHeight;
  let x = 0;
  let opening = 0;
  for (let k = 1; k <= depths.length; k++) {
    if (k * riser > H - MIN_HEADROOM) {
      opening = S - x;
      break;
    }
    x += depths[k - 1];
  }
  const { x0, x1, y0, y1 } = landing.rect;
  return {
    risers,
    rise,
    riser,
    tread: Math.min(...runs.map((r) => r.tread)),
    treads: runs.reduce((t, r) => t + r.treads, 0),
    landingDepth: f.shape === 'U' ? y1 - y0 : Math.min(x1 - x0, y1 - y0),
    flights: runs.map((r) => r.rise),
    opening,
    flightRuns: runs,
  };
}

/** Middle of the landing on the plan. */
export function landingPoint(project: Project, f: Furniture): Point | null {
  if (isTurning(f)) {
    const r = landingOf(f)!.rect;
    return toPlan(f, { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });
  }
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

/** Handrails and guards, inches. */
export const HANDRAIL_RISERS = 4;
export const HANDRAIL_MIN = 34;
export const HANDRAIL_MAX = 38;
export const GUARD_DROP = 30;
export const STAIR_GUARD = 34;
export const FLOOR_GUARD = 36;

/** The stair's two long sides, walking up from the foot (−x is the left): is each against a wall? */
export function stairSides(project: Project, f: Furniture): { left: boolean; right: boolean } {
  const walled = (x: number) => {
    const [p, q] = [local(f, x, -f.d / 2), local(f, x, f.d / 2)];
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const u = { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
    return project.walls.some((w) => {
      const d = wallDir(w);
      if (Math.abs(u.x * d.y - u.y * d.x) > 0.02) return false;
      const [a, b] = [projectOnWall(w, p), projectOnWall(w, q)];
      // Its face within a couple of inches of the side, along most of the run.
      if (a.perp - w.thickness / 2 > 2 || b.perp - w.thickness / 2 > 2) return false;
      const [lo, hi] = [Math.max(0, Math.min(a.along, b.along)), Math.min(wallLength(w), Math.max(a.along, b.along))];
      return hi - lo >= len * 0.75;
    });
  };
  return { left: walled(-f.w / 2), right: walled(f.w / 2) };
}

const RAIL_SIDES = { none: [], left: ['left'], right: ['right'], both: ['left', 'right'] } as const;
export const railSides = (f: Furniture): readonly ('left' | 'right')[] => RAIL_SIDES[f.handrails ?? 'right'];

/**
 * Handrail and guard runs along a stair: the sloped length of each handrail,
 * and of a guard on each open side from the first riser more than 30" up
 * (going down from this floor, the guard is round the floor opening, 36" high).
 */
export function stairRailing(project: Project, f: Furniture): { handrail: number; guard: number; open: ('left' | 'right')[]; guardFrom: number } {
  if (isTurning(f)) return turningRailing(project, f);
  const g = stairGeometry(project, f);
  const slope = (run: number, rise: number) => Math.hypot(run, rise);
  const handrail = g.risers >= HANDRAIL_RISERS ? railSides(f).length * slope(f.d, g.rise) : 0;
  const sides = stairSides(project, f);
  const open = (['left', 'right'] as const).filter((s) => !sides[s]);
  const guardFrom = Math.floor(GUARD_DROP / g.riser) + 1;
  const runFrom = Math.min(f.d, (guardFrom - 1) * g.tread);
  const guard = g.rise > GUARD_DROP && f.guards !== false ? open.length * (f.down ? f.d : slope(f.d - runFrom, g.rise - (guardFrom - 1) * g.riser)) : 0;
  return { handrail, guard, open, guardFrom };
}

/** R311.7: width, risers, treads, flight rise, landing and headroom, from the stair as drawn. */
export function stairChecks(project: Project): CodeCheck[] {
  const out: CodeCheck[] = [];
  for (const f of project.furniture.filter(isStairs)) {
    const g = stairGeometry(project, f);
    const label = `Stairs (${g.risers} risers ${f.down ? 'down' : 'up'}${isTurning(f) ? `, ${f.shape}-shaped` : ''})`;
    const add = (rule: string, section: string, ok: boolean, message: string, status?: CodeCheck['status']) =>
      out.push({ rule, section, status: status ?? (ok ? 'pass' : 'fail'), message: `${label}: ${message}`, targetId: f.id });
    if (isTurning(f)) turningChecks(project, f, g, add);
    else {
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
    // Handrails and guards.
    if (g.risers >= HANDRAIL_RISERS) {
      const sides = railSides(f);
      add('Handrail (one side at least, 4+ risers)', 'R311.7.8', sides.length > 0, sides.length ? `handrail on the ${sides.join(' and ')}` : 'no handrail — a flight of four or more risers needs one on a side');
      if (sides.length) {
        const h = f.handrailHeight ?? 36;
        add('Handrail height (34"–38")', 'R311.7.8.1', h >= HANDRAIL_MIN - 0.01 && h <= HANDRAIL_MAX + 0.01, `${formatFtIn(h)} above the nosings`);
      }
    }
    const rail = stairRailing(project, f);
    if (g.rise > GUARD_DROP && rail.open.length) {
      const where = rail.open.join(' and ');
      add(
        'Guards on open sides (more than 30" up)',
        'R312.1.1',
        f.guards !== false,
        f.down
          ? `open on the ${where}: a ${FLOOR_GUARD}" guard round the floor opening on this floor (R312.1.2)${f.guards === false ? ' — none shown' : ''}`
          : `open on the ${where}: a guard from riser ${rail.guardFrom} up, ${STAIR_GUARD}" high along the stair (R312.1.2)${f.guards === false ? ' — none shown' : ''}`,
      );
    }
    }
    const target = stairTarget(project, f);
    if (target || f.floorOpening !== undefined) {
      // A real floor (or a set opening): the opening has to reach back far enough for 6' 8" at every nosing under the floor.
      const have = openingLength(f);
      const where = f.down ? 'in this floor' : target ? `in the ${target.name.toLowerCase()}` : 'in the floor above';
      const ok = g.opening <= have + 0.01;
      add(
        'Headroom (6\' 8")',
        'R311.7.2',
        ok,
        g.opening > 0
          ? `the floor opening ${where} runs ${formatFtIn(have)} back from the top; 6' 8" headroom under a ${formatFtIn(project.framing.wallHeight)} ceiling needs ${formatFtIn(g.opening)}${ok ? '' : ' — lengthen the opening'}`
          : `clears 6' 8" under a full ceiling (opening ${formatFtIn(have)})`,
      );
    } else add(
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

type Add = (rule: string, section: string, ok: boolean, message: string, status?: CodeCheck['status']) => void;

/** Each flight's sides, walking up it: is each against a wall? */
function turningSides(project: Project, f: Furniture) {
  return flightsOf(f).map((s) => {
    const { left, right } = flightSides(s);
    const walled = ([a, b]: [Point, Point]) => walledEdge(project.walls, toPlan(f, a), toPlan(f, b));
    return { left: walled(left), right: walled(right) };
  });
}

/**
 * Railing on an L / U stair, flight by flight: a handrail on the chosen sides
 * of each flight of four or more risers; a guard on each open side from the
 * first riser more than 30" up, and round the landing's open edges once it's
 * more than 30" up. Going down, the guard runs round the opening in this floor.
 */
function turningRailing(project: Project, f: Furniture): { handrail: number; guard: number; open: ('left' | 'right')[]; guardFrom: number } {
  const g = stairGeometry(project, f);
  const runs = g.flightRuns!;
  const sides = turningSides(project, f);
  const open = (['left', 'right'] as const).filter((k) => sides.some((s) => !s[k]));
  const guardFrom = Math.floor(GUARD_DROP / g.riser) + 1;
  let handrail = 0;
  let guard = 0;
  let below = 0;
  runs.forEach((r, i) => {
    if (r.risers >= HANDRAIL_RISERS) handrail += railSides(f).length * Math.hypot(r.run, r.rise);
    const m = Math.max(1, guardFrom - below);
    if (!f.down && m <= r.risers) {
      const openHere = (['left', 'right'] as const).filter((k) => !sides[i][k]).length;
      guard += openHere * Math.hypot(Math.max(0, r.run - (m - 1) * r.tread), r.rise - (m - 1) * g.riser);
    }
    below += r.risers;
  });
  if (f.guards === false || g.rise <= GUARD_DROP) guard = 0;
  else if (f.down) guard = openingGuardLength({ ...f, floorOpening: undefined }, project.walls);
  else if (runs[0].rise > GUARD_DROP) {
    // The landing's open edges: not where the flights meet it, not along a wall.
    const flights = flightsOf(f).map((s) => s.rect);
    guard += openEdge(f, [landingOf(f)!.rect], project.walls, [], flights);
  }
  return { handrail, guard, open, guardFrom };
}

/** R311.7 for an L or U stair: each flight's width, treads, rise and handrail, and the landing where it turns. */
function turningChecks(project: Project, f: Furniture, g: StairGeometry, add: Add) {
  const runs = g.flightRuns!;
  const b = flightsOf(f)[0];
  const width = b.dir.x === 0 ? b.rect.x1 - b.rect.x0 : b.rect.y1 - b.rect.y0;
  const wide = width >= MIN_STAIR_WIDTH - 0.01;
  add('Stair width (36" clear)', 'R311.7.1', wide, `flights ${formatFtIn(width)} wide${wide ? '' : " — wants 3' 0\" clear"}`);
  add('Riser height (7-3/4" max)', 'R311.7.5.1', g.riser <= MAX_RISER + 0.01, `${formatFtIn(g.rise)} floor to floor ÷ ${g.risers} = ${formatFtIn(g.riser)} risers${g.riser <= MAX_RISER + 0.01 ? '' : ` — needs ${Math.ceil(g.rise / MAX_RISER)} or more`}`);
  const shallow = runs.findIndex((r) => r.treads > 0 && r.tread < MIN_TREAD - 0.01);
  add(
    'Tread depth (10" min)',
    'R311.7.5.2',
    shallow < 0,
    runs.map((r, i) => `flight ${i + 1}: ${r.treads} treads in ${formatFtIn(r.run)} = ${formatFtIn(r.tread)}${r.treads > 0 && r.tread < MIN_TREAD - 0.01 ? ` — needs ${formatFtIn(r.treads * MIN_TREAD)} of run` : ''}`).join('; '),
  );
  const tall = runs.some((r) => r.rise > MAX_FLIGHT_RISE + 0.01);
  add('Flight rise (151" max between landings)', 'R311.7.3', !tall, `flights of ${runs.map((r) => formatFtIn(r.rise)).join(' and ')}${tall ? ' — too tall: move the landing or add one' : ''}`);
  const land = landingOf(f)!.rect;
  const [lw, ld] = f.shape === 'U' ? [land.x1 - land.x0, g.landingDepth] : [width, g.landingDepth];
  const deep = ld >= Math.max(MIN_LANDING, width) - 0.01;
  add('Landing size', 'R311.7.6', deep, `${f.shape === 'U' ? 'U-turn' : 'quarter-turn'} landing ${formatFtIn(lw)} wide × ${formatFtIn(ld)} deep (at least as deep as the stair is wide, and 3' 0")`);
  const sides = railSides(f);
  runs.forEach((r, i) => {
    if (r.risers < HANDRAIL_RISERS) return;
    add('Handrail (one side at least, 4+ risers)', 'R311.7.8', sides.length > 0, `flight ${i + 1}: ${sides.length ? `handrail on the ${sides.join(' and ')}` : 'no handrail — a flight of four or more risers needs one on a side'}`);
  });
  if (sides.length && runs.some((r) => r.risers >= HANDRAIL_RISERS)) {
    const h = f.handrailHeight ?? 36;
    add('Handrail height (34"–38")', 'R311.7.8.1', h >= HANDRAIL_MIN - 0.01 && h <= HANDRAIL_MAX + 0.01, `${formatFtIn(h)} above the nosings`);
  }
  const rail = stairRailing(project, f);
  if (g.rise > GUARD_DROP && (rail.open.length || f.shape === 'U')) {
    add(
      'Guards on open sides (more than 30" up)',
      'R312.1.1',
      f.guards !== false,
      f.down
        ? `a ${FLOOR_GUARD}" guard round the floor opening on this floor (R312.1.2)${f.guards === false ? ' — none shown' : ''}`
        : `open ${rail.open.length ? `on the ${rail.open.join(' and ')} of a flight` : 'at the well'}: a guard from riser ${rail.guardFrom} up, ${STAIR_GUARD}" high along the stair and round the landing's open edges (R312.1.2)${f.guards === false ? ' — none shown' : ''}`,
    );
  }
}

/**
 * R311.7.8.2 in plain words, for every stair that needs a handrail: run it
 * unbroken from above the lowest riser to above the top one, and finish both
 * ends into a wall return, a newel post or a safety terminal. On an L or U it
 * may break at a newel post at the turn.
 */
export function handrailNotes(project: Project): CodeCheck[] {
  const out: CodeCheck[] = [];
  for (const f of project.furniture.filter(isStairs)) {
    const g = stairGeometry(project, f);
    const runs = g.flightRuns ?? [{ risers: g.risers }];
    if (!railSides(f).length || !runs.some((r) => r.risers >= HANDRAIL_RISERS)) continue;
    out.push({
      rule: 'Handrail continuity and ends',
      section: 'R311.7.8.2',
      status: 'info',
      message: `Stairs (${g.risers} risers ${f.down ? 'down' : 'up'}): keep each handrail continuous from over the lowest riser to over the highest${isTurning(f) ? ' (a newel post may break it at the turn)' : ''}, and finish its ends by returning them to the wall or into a newel post or safety terminal`,
      targetId: f.id,
    });
  }
  return out;
}
