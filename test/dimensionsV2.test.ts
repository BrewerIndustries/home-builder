import assert from 'node:assert/strict';
import { test } from 'node:test';
import { centrelineForFace, faceSpans, openingChains, outerSides, roomClearSize, wallDimLabels } from '../src/calc/faces.ts';
import { projectReducer } from '../src/model/store.ts';
import type { Project } from '../src/model/types.ts';
import { box, door, project, wall, window_ } from './helpers.ts';

/** 240 × 144 exterior box (6-1/2" walls) split by a 4-1/2" interior wall at x = 120, a room each side. */
function plan(): Project {
  const outer = box(240, 144);
  const mid = wall(120, 0, 120, 144, 'interior');
  const rooms = [
    { id: 'L', name: 'L', type: 'other' as const, points: [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 144 }, { x: 0, y: 144 }] },
    { id: 'R', name: 'R', type: 'other' as const, points: [{ x: 120, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 144 }, { x: 120, y: 144 }] },
  ];
  return project([...outer, mid], [], { rooms });
}

test('framing faces sit 1/2" inside the finished ones', () => {
  const p = plan();
  const top = p.walls[0];
  const at = (q: Project, mode: 'inside' | 'outside') => wallDimLabels(q, mode).filter((l) => l.wall.id === top.id).map((l) => l.length);
  const f = { ...p, dimFaces: 'framing' as const };
  // Outside: one 1/2" less at each end. Inside: each room 1/2" more at each end.
  assert.deepEqual(at(f, 'outside').map((x) => at(p, 'outside')[0] - x), [1]);
  assert.deepEqual(at(f, 'inside').map((x, i) => x - at(p, 'inside')[i]), [1, 1]);
});

test('rectangular rooms report their clear size to the faces', () => {
  const p = plan();
  // 120 wide less half of 6.5 (outside) and half of 4.5 (interior); 144 deep less 6.5.
  assert.deepEqual(roomClearSize(p, p.rooms[0]), { width: 120 - 3.25 - 2.25, depth: 144 - 6.5 });
  assert.deepEqual(roomClearSize({ ...p, dimFaces: 'framing' }, p.rooms[0]), { width: 120 - 2.75 - 1.75, depth: 144 - 5.5 });
  const L = { ...p.rooms[0], points: [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 60 }, { x: 60, y: 144 }] };
  assert.equal(roomClearSize(p, L), null);
});

test('opening chains run from the outside face to each opening centre', () => {
  let p = plan();
  const top = p.walls[0]; // (0,0) → (240,0)
  p = { ...p, openings: [{ ...window_(top.id, 60), id: 'n1' }, { ...door(top.id, 180), id: 'd1' }] };
  const [c] = openingChains(p, 'outside');
  assert.equal(c.wall.id, top.id);
  assert.equal(c.side, outerSides(p).get(top.id));
  assert.deepEqual(c.stops, [-3.25, 60, 180, 243.25]);
  assert.deepEqual(openingChains(p, 'centre')[0].stops, [0, 60, 180, 240]);
  // Interior walls get none.
  p = { ...p, openings: [{ ...door(p.walls[4].id, 72), id: 'd2' }] };
  assert.deepEqual(openingChains(p, 'outside'), []);
});

test('typing an outside length sets the centreline that gives it', () => {
  let p = plan();
  const right = p.walls[1]; // (240,0) → (240,144): 144 long, 150.5 outside
  const outside = faceSpans(p).find((f) => f.wall.id === right.id && f.side === outerSides(p).get(right.id))!.length;
  assert.equal(outside, 150.5);
  // Moving the end tilts the bottom wall a little, so the panel refines the centreline until the face reads right.
  const length = centrelineForFace(p, right.id, outerSides(p).get(right.id)!, 156.5)!;
  p = projectReducer(p, { type: 'setWallLength', id: right.id, length });
  const again = faceSpans(p).find((f) => f.wall.id === right.id && f.side === outerSides(p).get(right.id))!.length;
  assert.ok(Math.abs(again - 156.5) <= 1 / 64, String(again));
});
