import type { Point, TraverseLeg } from '../model/types.ts';

// Lot from survey calls: a closed traverse of quadrant bearings + distances,
// as written on a plat or deed ("N 45°30'00\" E 120.50'"). North is up the
// screen (plan −y); east is +x.

/**
 * Parse a quadrant bearing into an azimuth (degrees clockwise from north).
 * Accepts N 45°30'15" E, N45-30-15E, N 45 30 E, n45.5e, S 12° W …
 */
export function parseBearing(text: string): number | null {
  const t = text
    .trim()
    .toUpperCase()
    .replace(/[°º˚]/g, ' ')
    .replace(/[′’']/g, ' ')
    .replace(/[″"]/g, ' ')
    .replace(/[-:]/g, ' ');
  const m = /^([NS])\s*(\d+(?:\.\d+)?)(?:\s+(\d+(?:\.\d+)?))?(?:\s+(\d+(?:\.\d+)?))?\s*([EW])$/.exec(t.replace(/\s+/g, ' '));
  if (!m) return null;
  const deg = Number(m[2]);
  const min = m[3] ? Number(m[3]) : 0;
  const sec = m[4] ? Number(m[4]) : 0;
  if (min >= 60 || sec >= 60) return null;
  const a = deg + min / 60 + sec / 3600;
  if (a > 90) return null;
  const [ns, ew] = [m[1], m[5]];
  if (ns === 'N') return ew === 'E' ? a : (360 - a) % 360;
  return ew === 'E' ? 180 - a : 180 + a;
}

/** Azimuth (degrees) → quadrant bearing text, to the nearest second. */
export function formatBearing(azimuth: number): string {
  const az = ((azimuth % 360) + 360) % 360;
  const [ns, ew, a] = az <= 90 ? ['N', 'E', az] : az <= 180 ? ['S', 'E', 180 - az] : az <= 270 ? ['S', 'W', az - 180] : ['N', 'W', 360 - az];
  let total = Math.round(a * 3600);
  const d = Math.floor(total / 3600);
  total -= d * 3600;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${ns} ${d}°${pad(m)}'${pad(s)}" ${ew}`;
}

/** Azimuth of the line a → b in plan space. */
export function azimuthOf(a: Point, b: Point): number {
  const az = (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI;
  return (az + 360) % 360;
}

export interface Traverse {
  /** Corner points, starting at the point of beginning (one per leg; the last leg returns toward it). */
  points: Point[];
  /** Where the last leg actually ends, relative to the point of beginning. */
  misclosure: Point;
  /** Length of the misclosure, inches. */
  error: number;
  perimeter: number;
  /** Precision as 1 : N (perimeter / error); Infinity when it closes exactly. */
  precision: number;
  /** Index of the first leg whose bearing doesn't parse (−1 if all good). */
  badLeg: number;
}

export function runTraverse(legs: TraverseLeg[], start: Point = { x: 0, y: 0 }): Traverse {
  const points: Point[] = [{ ...start }];
  let p = { ...start };
  let perimeter = 0;
  let badLeg = -1;
  legs.forEach((leg, i) => {
    const az = parseBearing(leg.bearing);
    if (az === null || !(leg.distance > 0)) {
      if (badLeg < 0) badLeg = i;
      return;
    }
    const r = (az * Math.PI) / 180;
    p = { x: p.x + leg.distance * Math.sin(r), y: p.y - leg.distance * Math.cos(r) };
    perimeter += leg.distance;
    points.push(p);
  });
  const end = points.pop()!;
  const misclosure = { x: end.x - start.x, y: end.y - start.y };
  const error = Math.hypot(misclosure.x, misclosure.y);
  if (!points.length) points.push(end);
  return { points, misclosure, error, perimeter, precision: error > 1e-6 ? perimeter / error : Infinity, badLeg };
}

/** Survey calls for an existing lot outline (so a drawn lot can be shown / edited as bearings). */
export function legsFromLot(lot: Point[]): TraverseLeg[] {
  return lot.map((a, i) => {
    const b = lot[(i + 1) % lot.length];
    return { bearing: formatBearing(azimuthOf(a, b)), distance: Math.hypot(b.x - a.x, b.y - a.y) };
  });
}
