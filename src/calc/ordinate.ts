import type { OrdinateDim, Point } from '../model/types.ts';

// Ordinate (baseline) dimensions: one picked origin, then every further point
// labelled with its distance from that origin along one axis — across the plan
// (x) or up / down it (y). Drawn as a single baseline with a leader from each
// point, a "0" at the origin and the distance at each other point.

/** The axis an ordinate set measures along, from its first point: whichever way it's further from the origin. */
export function ordinateAxis(origin: Point, p: Point): 'x' | 'y' {
  return Math.abs(p.x - origin.x) >= Math.abs(p.y - origin.y) ? 'x' : 'y';
}

/** Each point's distance from the origin along the set's axis (always positive), in the order picked. */
export function ordinateValues(d: OrdinateDim): number[] {
  const k = d.axis;
  return d.pts.map((q) => Math.abs(q.p[k] - d.origin.p[k]));
}

/**
 * Where the set is drawn: the baseline sits `gap` past the outermost point on the
 * low side (above an across set, left of an up / down one), pushed further out by
 * `offset`. Returns the baseline's position across the axis and every stop along
 * it (origin first), with the value written at each.
 */
export function ordinateLayout(d: OrdinateDim, offset: number, gap = 24): { at: number; stops: { along: number; from: Point; value: number }[] } {
  const k = d.axis;
  const across = k === 'x' ? 'y' : 'x';
  const all = [d.origin, ...d.pts];
  const at = Math.min(...all.map((q) => q.p[across])) - gap - offset;
  const stops = all.map((q, i) => ({ along: q.p[k], from: q.p, value: i === 0 ? 0 : Math.abs(q.p[k] - d.origin.p[k]) }));
  return { at, stops };
}
