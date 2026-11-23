import { pointInPolygon, polygonArea, polygonCentroid } from '../model/geometry.ts';
import type { Point } from '../model/types.ts';
import type { Box, FlatSurface, Scene3D } from './model3d.ts';

// Walkthrough physics, kept apart from three.js so it can be tested: what you
// stand on (floors, and stair treads you can step up onto) and what stops you
// (walls, fixtures, counters, furniture — any box across your body above
// stepping height). Doors are gaps in the wall boxes, so you walk through them.
// Plan coordinates: x, z (= plan y); height y. Inches.

/** Eye height above the floor (about 5' 4"). */
export const EYE = 64;
/** Body radius for collisions. */
export const RADIUS = 9;
/** Highest step you walk up without jumping (a stair riser is at most 7-3/4"). */
export const STEP = 12;
/** Boxes that never block (a ceiling beam is overhead; glass in a window is in a wall that already blocks). */
const PASS: ReadonlySet<Box['kind']> = new Set(['beam']);

export interface Walker {
  x: number;
  z: number;
  /** Height of the feet. */
  y: number;
}

/** A box's footprint as a centre, half sizes and its axes on the plan. */
function local(b: Box, x: number, z: number): { u: number; v: number; hu: number; hv: number } {
  // three.js rotates the box's local X by rotY about Y: local X = (cos, -sin) on the plan (x, z).
  const [c, s] = [Math.cos(b.rotY), Math.sin(b.rotY)];
  const dx = x - b.c[0];
  const dz = z - b.c[2];
  return { u: dx * c - dz * s, v: dx * s + dz * c, hu: b.size[0] / 2, hv: b.size[2] / 2 };
}

/** Is the plan point (x, z) over the box's footprint (grown by r)? */
export function overBox(b: Box, x: number, z: number, r = 0): boolean {
  const { u, v, hu, hv } = local(b, x, z);
  return Math.abs(u) <= hu + r && Math.abs(v) <= hv + r;
}

/** Push (x, z) out of the box's footprint grown by r; null when it's clear. */
function pushOut(b: Box, x: number, z: number, r: number): Point | null {
  const { u, v, hu, hv } = local(b, x, z);
  const cu = Math.max(-hu, Math.min(hu, u));
  const cv = Math.max(-hv, Math.min(hv, v));
  const [du, dv] = [u - cu, v - cv];
  const d = Math.hypot(du, dv);
  if (d >= r) return null;
  let nu: number;
  let nv: number;
  if (d > 1e-6) {
    // Out along the line from the nearest point on the box, to r away from it.
    nu = cu + (du / d) * r;
    nv = cv + (dv / d) * r;
  } else if (hu - Math.abs(u) < hv - Math.abs(v)) {
    // Centre inside the box: out through the nearest side.
    [nu, nv] = [(Math.sign(u) || 1) * (hu + r), v];
  } else {
    [nu, nv] = [u, (Math.sign(v) || 1) * (hv + r)];
  }
  // Back to the plan.
  const [c, s] = [Math.cos(b.rotY), Math.sin(b.rotY)];
  return { x: b.c[0] + nu * c + nv * s, y: b.c[2] - nu * s + nv * c };
}

const blocks = (b: Box, feet: number) => !PASS.has(b.kind) && b.c[1] + b.size[1] / 2 > feet + STEP && b.c[1] - b.size[1] / 2 < feet + EYE;

/** Highest floor or tread under (x, z) you can stand on from `feet` (step up at most STEP). */
export function groundAt(scene: Pick<Scene3D, 'boxes' | 'flats'>, x: number, z: number, feet: number): number | null {
  let best: number | null = null;
  const take = (y: number) => {
    if (y <= feet + STEP && (best === null || y > best)) best = y;
  };
  for (const f of scene.flats) if (f.kind === 'floor' && onFlat(f, x, z)) take(f.y);
  for (const b of scene.boxes) if (b.kind === 'stair' && overBox(b, x, z)) take(b.c[1] + b.size[1] / 2);
  return best;
}

const onFlat = (f: FlatSurface, x: number, z: number) => pointInPolygon({ x, y: z }, f.outline) && !f.holes.some((h) => pointInPolygon({ x, y: z }, h));

/** One step of movement: slide round what blocks, then settle onto the ground (falling, or stepping up). */
export function move(scene: Pick<Scene3D, 'boxes' | 'flats'>, w: Walker, dx: number, dz: number, dt = 1 / 60): Walker {
  let x = w.x + dx;
  let z = w.z + dz;
  // A stair's next riser (or the floor edge at the top) stops your feet, not your whole body: treads (often under 10") are
  // shallower than the body's radius, so you'd be pushed off the first step before standing on it.
  const reach = (b: Box) => (b.kind === 'stair' || b.kind === 'rim' ? 1 : RADIUS);
  const near = scene.boxes.filter((b) => blocks(b, w.y) && overBox(b, x, z, reach(b) + 1));
  // A few passes so corners (two walls at once) resolve.
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const b of near) {
      const p = pushOut(b, x, z, reach(b));
      if (p) {
        [x, z] = [p.x, p.y];
        moved = true;
      }
    }
    if (!moved) break;
  }
  // Outside the house (no floor under you) is the yard, at grade.
  const g = groundAt(scene, x, z, w.y) ?? Math.min(0, w.y);
  // Step up at once; fall at most ~0.5 ft a frame (so a stair down reads as steps, a drop as a fall).
  const y = g >= w.y ? g : Math.max(g, w.y - 480 * dt);
  return { x, z, y };
}

/** Where to start: the middle of the biggest floor at ground level (or of any floor). */
export function startPoint(scene: Pick<Scene3D, 'flats' | 'bounds'>): Walker {
  const floors = scene.flats.filter((f) => f.kind === 'floor');
  const ground = floors.filter((f) => Math.abs(f.y) < 1);
  const pick = (ground.length ? ground : floors).sort((a, b) => polygonArea(b.outline) - polygonArea(a.outline))[0];
  if (!pick) {
    const [x0, , z0] = scene.bounds.min;
    const [x1, , z1] = scene.bounds.max;
    return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, y: 0 };
  }
  let c = polygonCentroid(pick.outline);
  if (!pointInPolygon(c, pick.outline)) c = { x: (pick.outline[0].x + pick.outline[1].x + pick.outline[2].x) / 3, y: (pick.outline[0].y + pick.outline[1].y + pick.outline[2].y) / 3 };
  return { x: c.x, z: c.y, y: pick.y };
}

/** How far away a door can be opened or closed from (about 6 ft). */
export const REACH = 72;

/**
 * The door to open or close: the nearest leaf within reach on your floor,
 * preferring one in front of you. `yaw` 0 faces -z (plan up).
 */
export function doorInReach(scene: Pick<Scene3D, 'boxes'>, w: Walker, yaw: number): string | null {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  let best: { id: string; score: number } | null = null;
  for (const b of scene.boxes) {
    if (!b.door) continue;
    const bottom = b.c[1] - b.size[1] / 2;
    if (Math.abs(bottom - w.y) > 30) continue;
    const [dx, dz] = [b.c[0] - w.x, b.c[2] - w.z];
    const d = Math.hypot(dx, dz);
    if (d > REACH) continue;
    // In front counts double: distance, less a bonus for facing it.
    const facing = d > 1e-6 ? (dx * fx + dz * fz) / d : 1;
    const score = d - facing * 24;
    if (!best || score < best.score) best = { id: b.door, score };
  }
  return best?.id ?? null;
}
