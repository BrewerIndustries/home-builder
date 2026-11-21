import { dist, wallDir, wallLength } from '../model/geometry.ts';
import { RAIL_HEIGHT, type Point, type Project, type Wall } from '../model/types.ts';
import { formatFtIn } from '../model/units.ts';
import type { CodeCheck } from './irc.ts';
import type { MaterialLine } from './materials.ts';

// Railing walls (guards) and rooms open to below: the railing line on the
// estimate, and the R312 checks — every edge of an open-to-below room needs a
// wall or a railing along it, and a railing has to be 36" high.

export const railings = (p: Pick<Project, 'walls'>) => p.walls.filter((w) => w.railing);

/** Share of the segment p→q that walls run along (overlaps merged). */
export function edgeCover(walls: Wall[], p: Point, q: Point): number {
  const len = dist(p, q);
  if (len < 1) return 1;
  const u = { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
  const spans: [number, number][] = [];
  for (const w of walls) {
    const d = wallDir(w);
    if (Math.abs(u.x * d.y - u.y * d.x) > 0.02) continue;
    // Off the line p→q by more than the wall's half thickness (and a little): not along it.
    const off = Math.abs((w.a.x - p.x) * u.y - (w.a.y - p.y) * u.x);
    if (off - w.thickness / 2 > 2) continue;
    // The wall's ends as distances from p along p→q.
    const t0 = (w.a.x - p.x) * u.x + (w.a.y - p.y) * u.y;
    const t1 = (w.b.x - p.x) * u.x + (w.b.y - p.y) * u.y;
    const [s, e] = [Math.max(0, Math.min(t0, t1)), Math.min(len, Math.max(t0, t1))];
    if (e > s) spans.push([s, e]);
  }
  spans.sort((x, y) => x[0] - y[0]);
  let covered = 0;
  let end = 0;
  for (const [s, e] of spans) {
    if (e <= end) continue;
    covered += e - Math.max(s, end);
    end = e;
  }
  return covered / len;
}

/** The estimate line for railing walls. */
export function railingLines(project: Project): MaterialLine[] {
  const r = railings(project);
  if (!r.length) return [];
  const ft = Math.ceil(r.reduce((s, w) => s + wallLength(w), 0) / 12);
  return [{ category: 'Lumber', item: 'Guard railing / balustrade (allowance)', qty: ft, unit: 'lf', basis: `${r.length} railing wall${r.length === 1 ? '' : 's'}: top rail, posts and balusters or panels (R312.1)` }];
}

export const RAIL_SAMPLE: [RegExp, number][] = [[/^Guard railing \/ balustrade/, 60]];

/** R312.1.1 / R312.1.2 for open-to-below rooms and railing walls. */
export function guardChecks(project: Project): CodeCheck[] {
  const out: CodeCheck[] = [];
  for (const room of project.rooms.filter((x) => x.openToBelow)) {
    const name = room.name || 'Open-to-below room';
    const pts = room.points;
    let open = 0;
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length];
      open += dist(p, q) * (1 - Math.min(1, edgeCover(project.walls, p, q)));
    });
    if (open > 6) {
      out.push({ rule: 'Guards', section: 'R312.1.1', status: 'fail', message: `${name} is open to below, but ${formatFtIn(open)} of its edge has no wall or railing — an open side more than 30" above the floor below needs a guard`, targetId: room.id });
    } else {
      out.push({ rule: 'Guards', section: 'R312.1.1', status: 'pass', message: `${name} is open to below and every edge has a wall or a railing`, targetId: room.id });
    }
  }
  for (const w of railings(project)) {
    if (w.height < RAIL_HEIGHT) {
      out.push({ rule: 'Guard height', section: 'R312.1.2', status: 'fail', message: `Railing is ${formatFtIn(w.height)} high — a guard needs at least 36" (measured from the floor)`, targetId: w.id });
    }
  }
  if (railings(project).length) {
    out.push({ rule: 'Guard openings', section: 'R312.1.3', status: 'info', message: 'Railings: balusters or panels must not let a 4" sphere through — specify that when ordering' });
  }
  return out;
}
