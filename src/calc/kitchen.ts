import { dist } from '../model/geometry.ts';
import type { Point, Project } from '../model/types.ts';
import { formatFtIn } from '../model/units.ts';
import { counterCorners, counterPoint, roomCounters } from './counters.ts';
import type { CodeCheck } from './irc.ts';

// Kitchen planning guidelines (NKBA, not code — so they warn, never fail):
//   work triangle: sink, range and fridge, each leg 4'–9', the three ≤ 26' in all;
//   work aisle in front of an island ≥ 42" to the next counter; walkway ≥ 36" to a wall.
// Distances are between the appliances' centres at mid-depth, and between the
// counter outlines / wall faces. Inches throughout.

export const LEG_MIN = 48;
export const LEG_MAX = 108;
export const TRIANGLE_MAX = 312;
export const WORK_AISLE = 42;
export const WALKWAY = 36;

const SECTION = 'NKBA guideline';

function segDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return dist(p, { x: a.x + dx * t, y: a.y + dy * t });
}

/** Closest approach of two convex outlines (0 if they touch). Edges only: fine for counters that don't overlap. */
export function outlineGap(p: Point[], q: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < p.length; i++)
    for (let j = 0; j < q.length; j++) {
      best = Math.min(best, segDist(p[i], q[j], q[(j + 1) % q.length]), segDist(q[j], p[i], p[(i + 1) % p.length]));
    }
  return best;
}

/** Sink, range and fridge centres in a kitchen, first of each, if all three are drawn. */
export function workTriangle(project: Project, roomId: string): { sink: Point; range: Point; fridge: Point; legs: number[] } | null {
  const room = project.rooms.find((r) => r.id === roomId);
  if (!room) return null;
  const at = (kind: string) => {
    for (const c of roomCounters(project, room)) for (const k of c.cutouts) if (k.kind === kind) return counterPoint(c, k.offset, c.depth / 2);
    return null;
  };
  const [sink, range, fridge] = [at('sink'), at('range'), at('fridge')];
  if (!sink || !range || !fridge) return null;
  return { sink, range, fridge, legs: [dist(sink, range), dist(range, fridge), dist(fridge, sink)] };
}

export function kitchenChecks(project: Project): CodeCheck[] {
  const out: CodeCheck[] = [];
  for (const room of project.rooms.filter((r) => r.type === 'kitchen')) {
    const counters = roomCounters(project, room);
    if (!counters.length) continue;
    const label = room.name || 'Kitchen';
    const tri = workTriangle(project, room.id);
    if (!tri) {
      out.push({ rule: 'Work triangle', section: SECTION, status: 'info', message: `${label}: add a sink, range and fridge to the counters to check it`, targetId: room.id });
    } else {
      const total = tri.legs.reduce((s, l) => s + l, 0);
      const bad = tri.legs.filter((l) => l < LEG_MIN - 0.5 || l > LEG_MAX + 0.5);
      const ok = !bad.length && total <= TRIANGLE_MAX + 0.5;
      const legs = tri.legs.map((l) => formatFtIn(l)).join(' / ');
      out.push({
        rule: 'Work triangle (each leg 4–9 ft, ≤ 26 ft in all)',
        section: SECTION,
        status: ok ? 'pass' : 'warn',
        message: `${label}: sink–range–fridge ${legs}, ${formatFtIn(total)} in all`,
        targetId: room.id,
      });
    }

    for (const isl of counters.filter((c) => c.island)) {
      const outline = counterCorners(isl);
      const others = counters.filter((c) => c.id !== isl.id).map((c) => outlineGap(outline, counterCorners(c)));
      const aisle = others.length ? Math.min(...others) : Infinity;
      let walk = Infinity;
      for (const w of project.walls) for (const p of outline) walk = Math.min(walk, segDist(p, w.a, w.b) - w.thickness / 2);
      for (const w of project.walls) for (const p of [w.a, w.b]) if (outline.length) walk = Math.min(walk, outlineGap(outline, [p]) - w.thickness / 2);
      const tight = aisle < WORK_AISLE - 0.5 || walk < WALKWAY - 0.5;
      const parts = [Number.isFinite(aisle) ? `${formatFtIn(aisle)} to the nearest counter (min 42")` : null, Number.isFinite(walk) ? `${formatFtIn(Math.max(0, walk))} to the nearest wall (min 36")` : null].filter(Boolean);
      out.push({ rule: 'Clearance around the island', section: SECTION, status: tight ? 'warn' : 'pass', message: `${label}: ${parts.join(', ')}`, targetId: isl.id });
    }
  }
  return out;
}
