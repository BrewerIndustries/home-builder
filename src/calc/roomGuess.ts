import { polygonArea } from '../model/geometry.ts';
import type { Project, Room, RoomType } from '../model/types.ts';
import { roomCounters } from './counters.ts';
import { outerSides } from './faces.ts';
import { openingsInRoom } from './irc.ts';
import { VEHICLE_DOOR } from './lighting.ts';
import { narrowest } from './outline.ts';

// A first guess at what a new room is, from its outline, doors and counters. It's
// only a starting point (the Room panel changes it), so the rules stay simple:
//   a vehicle door (over 6' wide) → garage; counters → kitchen; under 30 sq ft → closet;
//   narrower than 4' → hall; under 70 sq ft (too small to sleep in) → bath;
//   150 sq ft or more with a door to the outside, or 250 or more → living;
//   anything else → bedroom.

const SQFT = 144;

export function guessRoom(project: Project, room: Room): { type: RoomType; name: string } {
  const area = polygonArea(room.points) / SQFT;
  const width = narrowest(room.points)?.width ?? 0;
  const doors = openingsInRoom(project, room).filter((x) => x.opening.kind === 'door');
  const exterior = outerSides(project);
  const pick = (): [RoomType, string] => {
    if (doors.some((d) => d.opening.width > VEHICLE_DOOR)) return ['garage', 'Garage'];
    if (roomCounters(project, room).length) return ['kitchen', 'Kitchen'];
    if (area < 30) return ['other', 'Closet'];
    if (width < 48) return ['hall', 'Hall'];
    if (area < 70) return ['bath', 'Bath'];
    if ((area >= 150 && doors.some((d) => exterior.has(d.wall.id))) || area >= 250) return ['living', 'Living'];
    return ['bedroom', 'Bedroom'];
  };
  const [type, base] = pick();
  const taken = project.rooms.filter((r) => r.id !== room.id && (r.name === base || r.name.startsWith(base + ' '))).length;
  return { type, name: taken ? `${base} ${taken + 1}` : base };
}
