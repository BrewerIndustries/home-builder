import { projectOnWall, pointAlong, wallLength } from '../model/geometry.ts';
import type { Fixture, Furniture, Point, Project, Wall } from '../model/types.ts';

// Stairs on a one-storey plan: a flight going up (or down) from this floor.
//   E3903.3  stairways get a wall-switched lighting outlet; where the flight has
//            six or more risers, a switch at each floor level — here, one by the
//            foot on this floor and a matching 3-way counted for the other level.
// The foot is the stair's front (+y in its own frame); the flight runs back from it.

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
