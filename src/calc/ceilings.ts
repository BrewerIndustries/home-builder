import { polygonArea } from '../model/geometry.ts';
import type { Ceiling, Point, Project, Room } from '../model/types.ts';
import { formatFtIn } from '../model/units.ts';
import { wallsOfRoom } from './irc.ts';
import { areaBetween, slopeFrame } from './outline.ts';
import { cofferBeams, perimeter, trayOutline } from './roomShape.ts';

// Ceiling geometry per room: finished surface area (for drywall) and the low /
// high heights (for code checks). Slopes run on the room's real outline: they
// rise square to its longest edge (or the edge the room picks as its low side),
// across however far the room reaches that way (a rectangle's short dimension).
// Trays step up round the outline inset; coffer beams are clipped to it.
//
// Vaulted = single slope (shed) rising away from the longest edge.
// Cathedral = two slopes meeting at a ridge parallel to it, halfway across.

export interface CeilingInfo {
  type: Ceiling['type'];
  /** Lowest finished ceiling height. */
  low: number;
  /** Highest finished ceiling height. */
  high: number;
  /** Finished ceiling surface area, square inches. */
  surface: number;
  /** Extra framing called out for trays / coffers, linear inches. */
  beamLength: number;
  label: string;
}

export function roomWallHeight(project: Project, room: Room): number {
  const walls = wallsOfRoom(project, room);
  return walls.length ? Math.min(...walls.map((w) => w.height)) : project.framing.wallHeight;
}

function bbox(pts: Point[]) {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  return { short: Math.min(w, h), w, h };
}

/** The room's slope frame, honouring its picked low side. */
export function roomSlopeFrame(room: Room) {
  return slopeFrame(room.points, room.ceiling?.slopeEdge);
}

export function ceilingInfo(project: Project, room: Room): CeilingInfo {
  const c: Ceiling = room.ceiling ?? { type: 'flat' };
  const floor = polygonArea(room.points);
  const low = c.height ?? roomWallHeight(project, room);
  const { short } = bbox(room.points);
  const across = roomSlopeFrame(room)?.span || short;
  const flat = { type: c.type, low, high: low, surface: floor, beamLength: 0, label: `Flat ${formatFtIn(low, { compact: true })}` };

  switch (c.type) {
    case 'vaulted': {
      const peak = Math.max(low, c.peak ?? low + 48);
      const slope = Math.hypot(1, (peak - low) / (across || 1));
      return { ...flat, high: peak, surface: floor * slope, label: `Vaulted ${formatFtIn(low, { compact: true })} → ${formatFtIn(peak, { compact: true })}` };
    }
    case 'cathedral': {
      const peak = Math.max(low, c.peak ?? low + 48);
      const slope = Math.hypot(1, (peak - low) / ((across || 1) / 2));
      return { ...flat, high: peak, surface: floor * slope, label: `Cathedral ${formatFtIn(low, { compact: true })} → ${formatFtIn(peak, { compact: true })}` };
    }
    case 'tray': {
      const depth = c.trayDepth ?? 12;
      const inner = trayOutline(room.points, c.trayInset ?? 24);
      const innerPerimeter = inner ? perimeter(inner) : 0;
      // Flat area stays the same; the step adds a vertical band around the tray.
      return {
        ...flat,
        high: low + depth,
        surface: floor + innerPerimeter * depth,
        beamLength: innerPerimeter,
        label: `Tray ${formatFtIn(low, { compact: true })} + ${formatFtIn(depth)}`,
      };
    }
    case 'coffered': {
      const spacing = Math.max(24, c.cofferSpacing ?? 48);
      const depth = c.cofferDepth ?? 8;
      // Interior beams clipped to the outline, plus a beam round the perimeter against the wall.
      const interior = cofferBeams(room.points, spacing).reduce((s, b) => s + Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y), 0);
      const edge = perimeter(room.points);
      const beamLength = interior + edge;
      // Each interior beam shows two sides; perimeter beams one.
      const surface = floor + (interior * 2 + edge) * depth;
      return { ...flat, low: low - depth, surface, beamLength, label: `Coffered ${formatFtIn(spacing, { compact: true })} grid` };
    }
    default:
      return flat;
  }
}

/**
 * Floor area (square inches, the room's own outline) with at least `min` of
 * headroom under the finished ceiling. Flat, tray and coffered ceilings are all
 * or nothing at their lowest height; sloped ones count the strip that clears it.
 */
export function areaWithHeadroom(project: Project, room: Room, min: number): number {
  const info = ceilingInfo(project, room);
  const all = polygonArea(room.points);
  if (info.low >= min) return all;
  const frame = roomSlopeFrame(room);
  if (!frame || info.high <= info.low || info.high < min || (info.type !== 'vaulted' && info.type !== 'cathedral')) return 0;
  const { dir, d0, span } = frame;
  const rise = (min - info.low) / (info.high - info.low);
  if (info.type === 'vaulted') return areaBetween(room.points, dir, d0 + span * rise, d0 + span);
  const k = (span / 2) * rise;
  return areaBetween(room.points, dir, d0 + k, d0 + span - k);
}
