import assert from 'node:assert/strict';
import { test } from 'node:test';
import { interiorStrings, openingChains, roomClearSize, roomClearSizes } from '../src/calc/faces.ts';
import { projectReducer } from '../src/model/store.ts';
import type { Point, Project, Wall } from '../src/model/types.ts';
import { box, door, project, wall } from './helpers.ts';

/** 240 × 144 exterior box (6-1/2" walls) with 4-1/2" interior walls at x = 120 and y = 72 (right half only). */
function plan(): Project {
  const mid = wall(120, 0, 120, 144, 'interior');
  const cross = wall(120, 72, 240, 72, 'interior');
  const rooms = [
    { id: 'A', name: 'A', type: 'other' as const, points: [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 144 }, { x: 0, y: 144 }] },
    { id: 'B', name: 'B', type: 'other' as const, points: [{ x: 120, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 72 }, { x: 120, y: 72 }] },
  ];
  return project([...box(240, 144), mid, cross], [], { rooms });
}
const ends = { x: [0, 240] as [number, number], y: [0, 144] as [number, number] };

test('strings across the plan stop at every interior wall', () => {
  const p = plan();
  assert.deepEqual(interiorStrings(p, 'centre', ends), { x: [0, 120, 240], y: [0, 72, 144] });
  // To faces: both faces of each 4-1/2" partition.
  assert.deepEqual(interiorStrings(p, 'inside', ends), { x: [0, 117.75, 122.25, 240], y: [0, 69.75, 74.25, 144] });
  // No interior walls, no string.
  assert.deepEqual(interiorStrings(project(box(240, 144)), 'centre', ends), { x: [], y: [] });
});

/** An L-shaped house and room: 20' × 8' across the top, a 10' × 8' leg down the left. */
function lHouse(): Project {
  const P: Point[] = [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 96 }, { x: 120, y: 96 }, { x: 120, y: 192 }, { x: 0, y: 192 }];
  const walls: Wall[] = P.map((a, i) => wall(a.x, a.y, P[(i + 1) % 6].x, P[(i + 1) % 6].y));
  return project(walls, [], { rooms: [{ id: 'L', name: 'L', type: 'living', points: P }] });
}

test('an L-shaped room gets a clear size for its body and its leg', () => {
  const p = lHouse();
  const t = p.walls[0].thickness / 2;
  const [body, leg] = roomClearSizes(p, p.rooms[0]);
  // Body 10' × 16' down the left (walls all round, the notch wall along part of its right side); leg 10' × 8' to the right, open where it meets the body.
  assert.deepEqual([body.width, body.depth], [120 - 2 * t, 192 - 2 * t]);
  assert.deepEqual([leg.width, leg.depth], [120 - t, 96 - 2 * t]);
  assert.deepEqual(leg.at, { x: 180, y: 48 });
  // The single-size helper stays rectangles-only.
  assert.equal(roomClearSize(p, p.rooms[0]), null);
  // Not square to the plan: none.
  assert.deepEqual(roomClearSizes(p, { ...p.rooms[0], points: [{ x: 0, y: 0 }, { x: 100, y: 20 }, { x: 80, y: 100 }, { x: 0, y: 90 }] }), []);
});

test("interior walls with doors get an opening chain on the bigger room's side", () => {
  let p = plan();
  const cross = p.walls[5]; // y = 72, x 120 → 240: room B above it (−y), nothing below
  p = { ...p, openings: [door(cross.id, 60)] };
  const [c] = openingChains(p, 'centre');
  assert.equal(c.wall.id, cross.id);
  // wallNormal of a → b (+x) is (0, −1): the side room B is on.
  assert.equal(c.side, 1);
  assert.deepEqual(c.stops, [0, 60, 120]);
});

test('dimension strings remember how far they were dragged; zero forgets', () => {
  let p = projectReducer(plan(), { type: 'setDimOffset', id: 'top-overall', offset: 24 });
  p = projectReducer(p, { type: 'setDimOffset', id: 'chain:x', offset: -6 });
  assert.deepEqual(p.dimOffsets, { 'top-overall': 24, 'chain:x': -6 });
  p = projectReducer(p, { type: 'setDimOffset', id: 'top-overall', offset: 0 });
  p = projectReducer(p, { type: 'setDimOffset', id: 'chain:x', offset: 0 });
  assert.equal(p.dimOffsets, undefined);
});
