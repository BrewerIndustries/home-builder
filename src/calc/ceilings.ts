import { polygonArea } from '../model/geometry.ts';
import type { Ceiling, Point, Project, Room } from '../model/types.ts';
import { formatFtIn } from '../model/units.ts';
import { wallsOfRoom } from './irc.ts';

// Ceiling geometry per room: finished surface area (for drywall) and the low /
// high heights (for code checks). Rooms are treated by their bounding box for
// slope spans — exact for the rectangles the Room tool draws.
//
// Vaulted = single slope (shed) rising across the room's SHORT dimension.
// Cathedral = two slopes meeting at a ridge down the middle of the long dimension.

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

export function ceilingInfo(project: Project, room: Room): CeilingInfo {
  const c: Ceiling = room.ceiling ?? { type: 'flat' };
  const floor = polygonArea(room.points);
  const low = c.height ?? roomWallHeight(project, room);
  const { short, w, h } = bbox(room.points);
  const flat = { type: c.type, low, high: low, surface: floor, beamLength: 0, label: `Flat ${formatFtIn(low, { compact: true })}` };

  switch (c.type) {
    case 'vaulted': {
      const peak = Math.max(low, c.peak ?? low + 48);
      const slope = Math.hypot(1, (peak - low) / (short || 1));
      return { ...flat, high: peak, surface: floor * slope, label: `Vaulted ${formatFtIn(low, { compact: true })} → ${formatFtIn(peak, { compact: true })}` };
    }
    case 'cathedral': {
      const peak = Math.max(low, c.peak ?? low + 48);
      const slope = Math.hypot(1, (peak - low) / ((short || 1) / 2));
      return { ...flat, high: peak, surface: floor * slope, label: `Cathedral ${formatFtIn(low, { compact: true })} → ${formatFtIn(peak, { compact: true })}` };
    }
    case 'tray': {
      const depth = c.trayDepth ?? 12;
      const inset = Math.min(c.trayInset ?? 24, short / 2 - 6);
      const innerPerimeter = 2 * (w - 2 * inset + (h - 2 * inset));
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
      // Interior beams only (the perimeter gets a beam against the wall too).
      const across = Math.max(0, Math.ceil(w / spacing) - 1);
      const down = Math.max(0, Math.ceil(h / spacing) - 1);
      const interior = across * h + down * w;
      const perimeter = 2 * (w + h);
      const beamLength = interior + perimeter;
      // Each interior beam shows two sides; perimeter beams one.
      const surface = floor + (interior * 2 + perimeter) * depth;
      return { ...flat, low: low - depth, surface, beamLength, label: `Coffered ${formatFtIn(spacing, { compact: true })} grid` };
    }
    default:
      return flat;
  }
}
