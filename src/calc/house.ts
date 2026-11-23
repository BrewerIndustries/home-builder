import { pointInPolygon, wallLength } from '../model/geometry.ts';
import { activeStoreyId, isLowestStorey, isMultiStorey, isTopStorey, setStoreyData, storeyElevation, storeyList, storeyView, storeyViews } from '../model/storeys.ts';
import { uid, type Point, type Project, type Storey, type Wall, type WallSwitch } from '../model/types.ts';
import { formatFtIn } from '../model/units.ts';
import { attach } from './electrical.ts';
import { upperFloorLines } from './floor.ts';
import { floorOpenings, openVoids, type FloorOpening } from './floorOpenings.ts';
import { foundationOf } from './foundation.ts';
import { ircChecks, type CodeCheck } from './irc.ts';
import { detectsSmoke, lightsRoom, SWITCH_HEIGHT } from './lighting.ts';
import { materialsList, wallAreas, type MaterialLine } from './materials.ts';
import { buildScene, type Box, type Scene3D, type V3 } from './model3d.ts';
import { subtractHoles } from './outline.ts';
import { roofOf } from './roof.ts';
import { FLOOR_GUARD, openingGuardLength, nearestSwitchWall, needsTwoSwitches, stairEnd, stairLights, stairTarget } from './stairs.ts';

// The whole house across its storeys (Storeys v1). Each storey is a Project view
// (model/storeys.ts) and the per-plan calcs run on each one; the parts the house
// has only once go on the right storey: the foundation (and the site) under the
// lowest, the roof (and its attic) on the top one. Storeys above the lowest sit
// on a framed floor. One-storey projects go straight through to the plain calcs.

/** A storey's view with the once-per-house parts kept only where they belong. */
export function roleView(p: Project, id: string = activeStoreyId(p)): Project {
  if (!isMultiStorey(p)) return p;
  const v = storeyView(p, id);
  const top = isTopStorey(p, id);
  const lowest = isLowestStorey(p, id);
  return {
    ...v,
    roof: top ? v.roof : { ...roofOf(v), type: 'none' },
    foundation: lowest ? v.foundation : { ...foundationOf(v), type: 'none' },
    site: lowest ? v.site : undefined,
  };
}

export { floorOpenings, type FloorOpening } from './floorOpenings.ts';

/** Guard round a floor opening over a stair coming up from below (R312.1.1, 36" round an opening): its open edges, less the end you step off at the top. */
export function openingGuard(upper: Project, o: FloorOpening): number {
  return openingGuardLength(o.stair, upper.walls);
}

/** Does a wall on this storey run through the opening? */
function wallsAcross(v: Project, polys: Point[][]): Wall[] {
  return v.walls.filter((w) => {
    const n = Math.max(2, Math.ceil(wallLength(w) / 6));
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const p = { x: w.a.x + (w.b.x - w.a.x) * t, y: w.a.y + (w.b.y - w.a.y) * t };
      if (polys.some((poly) => pointInPolygon(p, poly))) return true;
    }
    return false;
  });
}

export type HouseCheck = CodeCheck & { storey?: string };

/** Every IRC check, storey by storey (each message says which), plus the checks between storeys. */
export function houseChecks(p: Project): HouseCheck[] {
  if (!isMultiStorey(p)) return ircChecks(p);
  const out: HouseCheck[] = [];
  for (const { storey } of storeyViews(p)) {
    const v = roleView(p, storey.id);
    const tag = (c: CodeCheck): HouseCheck => ({ ...c, message: `${storey.name}: ${c.message}`, storey: storey.id });
    // The storey's own smoke alarm is checked below for every storey, rooms drawn or not.
    for (const c of ircChecks(v)) if (c.rule !== 'Smoke alarm on each storey') out.push(tag(c));
    if (!v.walls.length) continue;
    const smoke = v.fixtures.filter((f) => detectsSmoke(f.kind)).length;
    out.push(tag({ rule: 'Smoke alarm on each storey', section: 'R314.3', status: smoke ? 'pass' : 'fail', message: smoke ? `${smoke} on this floor` : 'no smoke alarm on this floor' }));
    // Floor openings under stairs coming up from below.
    for (const o of floorOpenings(p, storey.id).filter((x) => x.from !== storey.id)) {
      const across = wallsAcross(v, o.polys);
      if (across.length) {
        out.push(tag({ rule: 'Floor opening over the stair kept clear', section: 'R311.7.2', status: 'warn', message: `a wall on this floor runs through the opening over the stair from the floor below — move it or the stair`, targetId: across[0].id }));
      }
      const guard = openingGuard(v, o);
      if (guard > 0) {
        out.push(tag({ rule: 'Guard round the floor opening', section: 'R312.1.1', status: 'info', message: `${formatFtIn(guard)} of open edge round the stair opening: a ${FLOOR_GUARD}" guard (R312.1.2) — counted in the estimate` }));
      }
    }
  }
  return out;
}

/** Add up material lines with the same item, keeping each storey's basis. */
export function mergeLines(parts: { name: string; lines: MaterialLine[] }[]): MaterialLine[] {
  const out: MaterialLine[] = [];
  const byKey = new Map<string, { line: MaterialLine; bases: string[] }>();
  for (const { name, lines } of parts) {
    for (const l of lines) {
      const key = `${l.category}|${l.item}|${l.unit}`;
      const cur = byKey.get(key);
      if (cur) {
        cur.line.qty += l.qty;
        cur.bases.push(`${name}: ${l.basis}`);
      } else {
        const line = { ...l };
        byKey.set(key, { line, bases: [`${name}: ${l.basis}`] });
        out.push(line);
      }
    }
  }
  for (const { line, bases } of byKey.values()) line.basis = bases.length > 1 ? bases.join('; ') : bases[0].slice(bases[0].indexOf(': ') + 2);
  return out;
}

/** The estimate's lines for the whole house: each storey's, the framed floors over the lower storeys, and the opening guards. */
/** `list` is the per-storey takeoff (plain, or phased for a remodel). */
export function houseMaterials(p: Project, list: (p: Project) => MaterialLine[] = materialsList): MaterialLine[] {
  if (!isMultiStorey(p)) return list(p);
  const parts: { name: string; lines: MaterialLine[] }[] = [];
  for (const { storey } of storeyViews(p)) {
    const v = roleView(p, storey.id);
    const lines = list(v);
    // Floor v2: the framed floor under this storey, joists bearing on the walls below (calc/floor.ts).
    if (!isLowestStorey(p, storey.id) && v.walls.length) lines.push(...upperFloorLines(v, p.framing.waste));
    const guard = floorOpenings(p, storey.id).filter((o) => o.from !== storey.id).reduce((t, o) => t + openingGuard(v, o), 0);
    if (guard > 0) lines.push({ category: 'Lumber', item: 'Stair guard / balustrade (allowance)', qty: Math.ceil(guard / 12), unit: 'lf', basis: 'open edges round the stair opening in the floor (R312.1)' });
    parts.push({ name: storey.name, lines });
  }
  return mergeLines(parts);
}

/** Floor area of every storey, sq ft. */
export function houseFloorArea(p: Project): number {
  if (!isMultiStorey(p)) return wallAreas(p).floor;
  return storeyViews(p).reduce((t, { view }) => t + wallAreas(view).floor, 0);
}

/** Boxes filling the floor depth under a storey at elevation e: over the lower storey's outside walls, and round the holes in this floor. */
function floorBand(p: Project, belowId: string, e: number, holes: Point[][]): Box[] {
  const below = roleView(p, belowId);
  const solid = below.walls.filter((w) => !w.railing && !w.glass);
  if (!solid.length) return [];
  const top = storeyElevation(p, belowId) + Math.max(...solid.map((w) => w.height));
  const depth = e - top;
  if (depth < 0.5) return [];
  const y = top + depth / 2;
  const out: Box[] = [];
  const along = (a: Point, b: Point, t: number, kind: Box['kind']) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.5) return;
    out.push({ kind, c: [(a.x + b.x) / 2, y, (a.y + b.y) / 2], size: [len + (kind === 'rim' ? 0 : t), depth, t], rotY: -Math.atan2(b.y - a.y, b.x - a.x) });
  };
  for (const w of solid) if (w.kind === 'exterior') along(w.a, w.b, w.thickness, 'wall-ext');
  // Edge only where floor meets hole: not where a flight's piece of the opening meets the landing's,
  // nor along a stretch that's open on both sides (a stair opening running into a void).
  const inHole = (q: Point) => holes.some((h) => pointInPolygon(q, h));
  for (const h of holes) {
    h.forEach((a, k) => {
      const b = h[(k + 1) % h.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 0.5) return;
      const [ux, uy] = [(b.x - a.x) / len, (b.y - a.y) / len];
      const n = Math.max(1, Math.ceil(len / 3));
      let start: number | null = null;
      for (let s = 0; s <= n; s++) {
        const t = s < n ? ((s + 0.5) / n) * len : len;
        const real = s < n && inHole({ x: a.x + ux * t - uy, y: a.y + uy * t + ux }) !== inHole({ x: a.x + ux * t + uy, y: a.y + uy * t - ux });
        if (real && start === null) start = (s / n) * len;
        if (!real && start !== null) {
          const end = (s / n) * len;
          along({ x: a.x + ux * start, y: a.y + uy * start }, { x: a.x + ux * end, y: a.y + uy * end }, 1.5, 'rim');
          start = null;
        }
      }
    });
  }
  return out;
}

/** The 3D scene with every storey stacked at its height, the roof on the top one and stair openings cut in the floors. */
export function houseScene(p: Project): Scene3D {
  if (!isMultiStorey(p)) return buildScene(p);
  const scene: Scene3D = { boxes: [], flats: [], faces: [], bounds: { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] } };
  const views = storeyViews(p);
  views.forEach(({ storey }, i) => {
    const v = roleView(p, storey.id);
    if (!v.walls.length) return;
    const s = buildScene(v);
    const e = storeyElevation(p, storey.id);
    const up = (q: V3): V3 => [q[0], q[1] + e, q[2]];
    const holes = [...floorOpenings(p, storey.id).flatMap((o) => o.polys), ...openVoids(v)];
    // The storey above's stair openings and open-to-below rooms: no ceiling here under them either.
    const next = views[i + 1]?.storey.id;
    const above = next ? [...floorOpenings(p, next).flatMap((o) => o.polys), ...openVoids(roleView(p, next))] : [];
    scene.boxes.push(...s.boxes.map((b) => ({ ...b, c: up(b.c) })));
    // Cut each floor / ceiling into plain pieces: an opening can cross or touch the edge of a floor.
    for (const f of s.flats) {
      const cut = f.kind === 'floor' ? [...f.holes, ...holes] : [...f.holes, ...above];
      const pieces = cut.length ? subtractHoles(f.outline, cut) : [f.outline];
      for (const outline of pieces) scene.flats.push({ ...f, y: f.y + e, outline, holes: [] });
    }
    // The floor's depth between the ceiling below and this floor: a band on the outside walls
    // under it, and a finished edge round every stair opening and open-to-below void.
    if (i > 0) scene.boxes.push(...floorBand(p, views[i - 1].storey.id, e, holes));
    scene.faces.push(...s.faces.map((f) => ({ ...f, pts: f.pts.map(up) })));
    for (let k = 0; k < 3; k++) {
      scene.bounds.min[k] = Math.min(scene.bounds.min[k], up(s.bounds.min)[k]);
      scene.bounds.max[k] = Math.max(scene.bounds.max[k], up(s.bounds.max)[k]);
    }
  });
  if (!Number.isFinite(scene.bounds.min[0])) scene.bounds = { min: [0, 0, 0], max: [0, 0, 0] };
  return scene;
}

/** Switches placed on another storey for a stair's light (E3903.3); Auto lights replaces them. */
const STAIR_SWITCH_PREFIX = 'swst_';
export const isStairSwitch = (s: WallSwitch) => s.id.startsWith(STAIR_SWITCH_PREFIX);

/**
 * E3903.3 with real storeys: a stair of six or more risers gets the switch at
 * its other end placed on the storey it arrives at, by the wall nearest where
 * you step off, controlling the stair's light. Earlier ones placed this way are
 * replaced; a switch already on that storey controlling the light is kept.
 */
export function placeStairSwitches(p: Project): Project {
  if (!isMultiStorey(p)) return p;
  let q = p;
  // Clear the old ones everywhere.
  for (const s of storeyList(q)) {
    const v = storeyView(q, s.id);
    if (v.switches.some(isStairSwitch)) q = setStoreyData(q, s.id, { switches: v.switches.filter((x) => !isStairSwitch(x)) });
  }
  for (const s of storeyList(q)) {
    const v = storeyView(q, s.id);
    for (const st of v.furniture.filter(needsTwoSwitches)) {
      const target: Storey | null = stairTarget(v, st);
      if (!target) continue;
      const lights = stairLights(v, st, lightsRoom).map((f) => f.id);
      if (!lights.length) continue;
      const tv = storeyView(q, target.id);
      if (tv.switches.some((x) => x.controls.some((c) => lights.includes(c)))) continue;
      const end = stairEnd(st);
      const off = { x: end.at.x + end.dir.x * 12, y: end.at.y + end.dir.y * 12 };
      const spot = nearestSwitchWall(tv, off);
      const a = spot && attach(tv, spot.p, off);
      if (!a) continue;
      const sw: WallSwitch = { id: uid('swst'), ...a, height: SWITCH_HEIGHT, controls: lights, auto: true };
      q = setStoreyData(q, target.id, { switches: [...tv.switches, sw] });
    }
  }
  return q;
}
