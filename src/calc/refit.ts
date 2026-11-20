import { pointInPolygon, polygonArea } from '../model/geometry.ts';
import { uid, type Point, type Project, type Room } from '../model/types.ts';
import { normaliseLoop, samePolygon, wallFaces } from './enclosure.ts';
import { childRooms, exclusiveArea } from './regions.ts';
import { guessRoom } from './roomGuess.ts';

// Re-fit a room to the walls around it after walls are removed or added.
//
// The room is sampled on a grid (skipping rooms nested inside it). Each sample
// lands in the smallest face the walls close around it. The face holding most
// of the room becomes its new outline:
// - a wall removed → that face reaches into the neighbouring room, which is
//   merged away (this room keeps its name, use and ceiling);
// - a wall added → the room keeps the larger part, and each cut-off part big
//   enough to be a room becomes a new room (same ceiling, name and use guessed).
// Rooms nested inside (closets with their own walls) are left alone.

const MIN_FACE = 144; // 1 sq ft, as for "click inside"
/** A cut-off part becomes a room only if it is at least this big (sq in) ... */
const MIN_NEW_ROOM = 9 * 144;
/** ... and holds at least this share of the old room's samples. */
const MIN_NEW_SHARE = 0.1;

export interface RefitResult {
  roomId: string;
  /** The new outline (unchanged when the room already fits). */
  points: Point[];
  /** Other rooms swallowed by the new outline (their walls are gone). */
  merged: Room[];
  /** New rooms for the parts a new wall cut off. */
  added: Room[];
  changed: boolean;
}

export type Refit = RefitResult | { roomId: string; error: 'open' };

interface Faces {
  loops: Point[][];
  areas: number[];
}

function faces(project: Project): Faces {
  const loops = wallFaces(project.walls).filter((f) => polygonArea(f) >= MIN_FACE);
  return { loops, areas: loops.map(polygonArea) };
}

/** Index of the smallest face around p, or -1 when the walls leave it open. */
function faceAt(f: Faces, p: Point): number {
  let best = -1;
  for (let i = 0; i < f.loops.length; i++) if (pointInPolygon(p, f.loops[i]) && (best < 0 || f.areas[i] < f.areas[best])) best = i;
  return best;
}

/** Sample points spread over the room, outside any room nested in it. */
function samples(project: Project, room: Room): Point[] {
  const xs = room.points.map((p) => p.x);
  const ys = room.points.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const step = Math.max(3, Math.sqrt(Math.max(polygonArea(room.points), 1)) / 14);
  const kids = childRooms(project, room);
  const out: Point[] = [];
  for (let y = y0 + step / 2; y < y1; y += step)
    for (let x = x0 + step / 2; x < x1; x += step) {
      const p = { x, y };
      if (pointInPolygon(p, room.points) && !kids.some((k) => pointInPolygon(p, k.points))) out.push(p);
    }
  if (!out.length) {
    const c = room.points.reduce((t, p) => ({ x: t.x + p.x / room.points.length, y: t.y + p.y / room.points.length }), { x: 0, y: 0 });
    out.push(c);
  }
  return out;
}

/** Which face holds most of the room, with the sample count per face. */
function tally(project: Project, f: Faces, room: Room): { counts: Map<number, number>; total: number; best: number } {
  const counts = new Map<number, number>();
  const pts = samples(project, room);
  for (const p of pts) {
    const i = faceAt(f, p);
    if (i >= 0) counts.set(i, (counts.get(i) ?? 0) + 1);
  }
  let best = -1;
  for (const [i, n] of counts) if (best < 0 || n > counts.get(best)!) best = i;
  return { counts, total: pts.length, best };
}

function refitWith(project: Project, f: Faces, room: Room): Refit {
  // An area marked out without walls keeps the outline it was given.
  if (room.area) return { roomId: room.id, points: room.points, merged: [], added: [], changed: false };
  const { counts, total, best } = tally(project, f, room);
  if (best < 0) return { roomId: room.id, error: 'open' };
  const points = normaliseLoop(f.loops[best]);
  // Unchanged: the same outline, or (a room drawn round a closet in its corner) its own floor
  // — nested rooms left out — fills exactly the one face.
  const fits = samePolygon(points, room.points) || (counts.size === 1 && counts.get(best) === total && Math.abs(f.areas[best] - exclusiveArea(project, room)) < 144);
  if (fits) return { roomId: room.id, points: room.points, merged: [], added: [], changed: false };

  // Rooms that lost their own walls and now sit in the same face are merged in.
  const merged = project.rooms.filter((r) => r.id !== room.id && !r.area && tally(project, f, r).best === best);
  const taken = new Set([best]);
  // Parts a new wall cut off, big enough to be rooms and not rooms already.
  const added: Room[] = [];
  for (const [i, n] of counts) {
    if (taken.has(i) || n / total < MIN_NEW_SHARE || f.areas[i] < MIN_NEW_ROOM) continue;
    const pts = normaliseLoop(f.loops[i]);
    if (project.rooms.some((r) => r.id !== room.id && (samePolygon(r.points, pts) || (!r.area && tally(project, f, r).best === i)))) continue;
    taken.add(i);
    const fresh: Room = { id: uid('r'), name: '', type: 'other', points: pts, ...(room.ceiling && { ceiling: { ...room.ceiling, slopeEdge: undefined } }) };
    added.push({ ...fresh, ...guessRoom(project, fresh) });
  }
  return { roomId: room.id, points, merged, added, changed: true };
}

/** Re-fit one room to the walls as they are now. */
export function refitRoom(project: Project, roomId: string): Refit | null {
  const room = project.rooms.find((r) => r.id === roomId);
  return room ? refitWith(project, faces(project), room) : null;
}

/** Rooms whose outline no longer matches the walls (or whose walls no longer close). */
export function staleRooms(project: Project): Refit[] {
  if (!project.rooms.length) return [];
  const f = faces(project);
  return project.rooms.map((r) => refitWith(project, f, r)).filter((x) => 'error' in x || x.changed);
}

/** The project with a re-fit applied: new outline, merged rooms gone, cut-off parts added. */
export function applyRefit(project: Project, fit: RefitResult): Project {
  const gone = new Set(fit.merged.map((r) => r.id));
  const rooms = project.rooms
    .filter((r) => !gone.has(r.id))
    .map((r) => {
      if (r.id !== fit.roomId) return r;
      // A slope edge or pivot picked on the old outline may no longer make sense.
      const ceiling = r.ceiling && r.ceiling.slopeEdge !== undefined && r.ceiling.slopeEdge >= fit.points.length ? { ...r.ceiling, slopeEdge: undefined } : r.ceiling;
      const pivot = r.pivot && pointInPolygon(r.pivot, fit.points) ? r.pivot : undefined;
      return { ...r, points: fit.points, ceiling, pivot };
    });
  return { ...project, rooms: [...rooms, ...fit.added] };
}

/** Re-fit every room that no longer matches its walls, largest first. Rooms whose walls leave a gap are left as they are. */
export function refitAll(project: Project): { project: Project; fitted: number; open: string[] } {
  let p = project;
  let fitted = 0;
  const open: string[] = [];
  const order = [...project.rooms].sort((a, b) => polygonArea(b.points) - polygonArea(a.points)).map((r) => r.id);
  for (const id of order) {
    if (!p.rooms.some((r) => r.id === id)) continue; // merged into a bigger room already
    const fit = refitRoom(p, id);
    if (!fit) continue;
    if ('error' in fit) {
      open.push(id);
      continue;
    }
    if (!fit.changed) continue;
    p = applyRefit(p, fit);
    fitted++;
  }
  return { project: p, fitted, open };
}

/** A short description of what a re-fit will do, for the button's hint. */
export function describeRefit(fit: RefitResult): string {
  const parts: string[] = [];
  if (fit.merged.length) parts.push(`merges ${fit.merged.map((r) => r.name || r.type).join(', ')} into this room`);
  if (fit.added.length) parts.push(`the cut-off part${fit.added.length > 1 ? 's become new rooms' : ' becomes a new room'} (${fit.added.map((r) => r.name).join(', ')})`);
  return parts.length ? parts.join('; ') : 'traces the walls round it again';
}
