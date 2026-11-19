import { dist } from '../model/geometry.ts';
import { formatFtIn } from '../model/units.ts';
import { slopeFrame } from '../calc/outline.ts';
import type { Point } from '../model/types.ts';

// Picks the edge a vaulted ceiling's low side (or a cathedral's ridge) runs
// along. Edges are named by the side of the room they're on and their length.

function signedArea(pts: Point[]): number {
  return pts.reduce((s, a, i) => {
    const b = pts[(i + 1) % pts.length];
    return s + a.x * b.y - b.x * a.y;
  }, 0);
}

/** "top", "left", "lower right"…: the side of the room an edge faces out to (plan y runs down). */
export function edgeSide(pts: Point[], i: number): string {
  const a = pts[i];
  const b = pts[(i + 1) % pts.length];
  const len = dist(a, b) || 1;
  const s = signedArea(pts) > 0 ? 1 : -1;
  // Outward normal.
  const n = { x: ((b.y - a.y) / len) * s, y: (-(b.x - a.x) / len) * s };
  const v = Math.abs(n.y) > 0.38 ? (n.y < 0 ? 'top' : 'bottom') : '';
  const h = Math.abs(n.x) > 0.38 ? (n.x < 0 ? 'left' : 'right') : '';
  if (v && h) return `${v === 'top' ? 'upper' : 'lower'} ${h}`;
  return v || h;
}

export function SlopeEdgeSelect({ points, value, onChange }: { points: Point[]; value: number | undefined; onChange(edge: number | undefined): void }) {
  const auto = slopeFrame(points);
  const label = (i: number) => `${edgeSide(points, i)} edge, ${formatFtIn(dist(points[i], points[(i + 1) % points.length]))}`;
  const longest = points.reduce((best, _, i) => (dist(points[i], points[(i + 1) % points.length]) > dist(points[best], points[(best + 1) % points.length]) + 0.5 ? i : best), 0);
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}>
      <option value="">Auto — longest edge{auto ? ` (${label(longest)})` : ''}</option>
      {points.map((_, i) =>
        dist(points[i], points[(i + 1) % points.length]) > 0.5 ? (
          <option key={i} value={i}>
            {label(i)}
          </option>
        ) : null,
      )}
    </select>
  );
}
