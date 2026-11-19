import assert from 'node:assert/strict';
import { test } from 'node:test';
import { counterCorners } from '../src/calc/counters.ts';
import { projectReducer } from '../src/model/store.ts';
import type { Point, Project } from '../src/model/types.ts';
import { bearing, mirrorRoom, moveRoom, rotateRoom, roomCentre, snapPivot, turnBetween, turnHandle } from '../src/model/wallEdit.ts';
import { box, door, project, wall } from './helpers.ts';

const near = (p: Point, q: Point) => Math.abs(p.x - q.x) < 0.01 && Math.abs(p.y - q.y) < 0.01;
const signedArea = (pts: Point[]) => pts.reduce((s, p, i) => s + p.x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * p.y, 0) / 2;
const sameSet = (a: Point[], b: Point[]) => a.length === b.length && a.every((p) => b.some((q) => near(p, q)));

/** A 10' × 8' room with a wall running off its right side, a door (swinging in), an outlet, an island, a sofa and a light. */
function plan(): Project {
  const walls = [...box(120, 96), wall(120, 48, 240, 48, 'interior')];
  const top = walls.find((w) => w.a.y === 0 && w.b.y === 0)!;
  return project(walls, [{ ...door(top.id, 30), swing: { side: 1, hinge: 'a' } }], {
    rooms: [{ id: 'R', name: 'Den', type: 'living', points: [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 96 }, { x: 0, y: 96 }] }],
    outlets: [{ id: 'o', wallId: top.id, offset: 90, side: 1, kind: 'duplex', height: 16, auto: false }],
    counters: [{ id: 'k', a: { x: 40, y: 40 }, b: { x: 80, y: 40 }, depth: 20, side: -1, island: true, cutouts: [] }],
    furniture: [{ id: 's', kind: 'sofa', at: { x: 30, y: 70 }, rot: 90, w: 84, d: 36 }],
    fixtures: [{ id: 'l', kind: 'light', at: { x: 60, y: 48 }, auto: false }],
  });
}

test('moving a room slides its walls and contents; a wall attached outside stretches to follow', () => {
  const p = projectReducer(plan(), { type: 'moveRoom', id: 'R', delta: { x: 24, y: 0 } });
  assert.deepEqual(p.rooms[0].points[0], { x: 24, y: 0 });
  const tail = p.walls[4];
  assert.ok(near(tail.a, { x: 144, y: 48 }) && near(tail.b, { x: 240, y: 48 }));
  assert.deepEqual(p.counters[0].a, { x: 64, y: 40 });
  assert.deepEqual([p.furniture[0].at, p.furniture[0].rot], [{ x: 54, y: 70 }, 90]);
  assert.deepEqual(p.fixtures[0].at, { x: 84, y: 48 });
  // Openings and outlets ride on their walls: offsets unchanged.
  assert.equal(p.openings[0].offset, 30);
  // Sliding along the attached wall's line: it stays joined where it is (the right wall still runs through it).
  const down = moveRoom(plan(), 'R', { x: 0, y: 12 });
  assert.ok(near(down.walls[4].a, { x: 120, y: 48 }));
  const same = plan();
  assert.equal(moveRoom(same, 'R', { x: 0, y: 0 }), same);
});

test('mirroring a room flips it left ↔ right: doors swing and devices sit the mirrored way, symbols turn', () => {
  const before = plan();
  const p = mirrorRoom(before, 'R', 'x');
  // The outline maps onto itself and keeps its winding.
  assert.ok(sameSet(p.rooms[0].points, before.rooms[0].points));
  assert.equal(Math.sign(signedArea(p.rooms[0].points)), Math.sign(signedArea(before.rooms[0].points)));
  // The top wall now runs right → left: the door (30" from a) sits at the mirrored spot and swings the same way into the room.
  const top = p.walls.find((w) => w.id === before.openings[0].wallId)!;
  assert.deepEqual([top.a, top.b], [{ x: 120, y: 0 }, { x: 0, y: 0 }]);
  assert.deepEqual(p.openings[0].swing, { side: -1, hinge: 'a' });
  assert.equal(p.outlets[0].side, -1);
  // The island: same footprint, mirrored, still on the floor it covered.
  assert.equal(p.counters[0].side, 1);
  assert.ok(sameSet(counterCorners(p.counters[0]), counterCorners(before.counters[0]).map((q) => ({ x: 120 - q.x, y: q.y }))));
  // A sofa facing left (rot 90) now faces right; top ↔ bottom turns rot 0 to 180.
  assert.deepEqual([p.furniture[0].at, p.furniture[0].rot], [{ x: 90, y: 70 }, 270]);
  assert.equal(mirrorRoom(before, 'R', 'y').furniture[0].rot, 90);
  assert.equal(mirrorRoom({ ...before, furniture: [{ ...before.furniture[0], rot: 0 }] }, 'R', 'y').furniture[0].rot, 180);
  // The wall attached outside stays joined: a wall (the mirrored left one) still runs through its end.
  assert.ok(near(p.walls[4].a, { x: 120, y: 48 }));
  // Twice is back where it started.
  const twice = mirrorRoom(p, 'R', 'x');
  assert.ok(twice.walls.every((w, i) => near(w.a, before.walls[i].a) && near(w.b, before.walls[i].b)));
  assert.deepEqual(twice.openings[0].swing, before.openings[0].swing);
});

test('a room turns about its own pivot when it has one; the pivot moves with the room', () => {
  const p = { ...plan(), rooms: [{ ...plan().rooms[0], pivot: { x: 0, y: 0 } }] };
  const q = rotateRoom(p, 'R', -90);
  // Clockwise about the top-left corner: the room now hangs to its left.
  assert.ok(sameSet(q.rooms[0].points, [{ x: 0, y: 0 }, { x: 0, y: 120 }, { x: -96, y: 120 }, { x: -96, y: 0 }]));
  assert.deepEqual(q.rooms[0].pivot, { x: 0, y: 0 });
  assert.deepEqual(moveRoom(p, 'R', { x: 6, y: 6 }).rooms[0].pivot, { x: 6, y: 6 });
  assert.deepEqual(roomCentre(plan().rooms[0].points), { x: 60, y: 48 });
});

test('turn handle and pivot helpers: bearings, 15° steps, snapping to corners', () => {
  assert.equal(bearing({ x: 0, y: 0 }, { x: 0, y: -10 }), 90);
  assert.equal(turnBetween(90, 180, 15), 90);
  assert.equal(turnBetween(170, -170, 15), 15);
  assert.equal(turnBetween(0, 22, 15), 15);
  assert.equal(turnBetween(0, 22, 1), 22);
  assert.deepEqual(turnHandle(plan().rooms[0].points, 30), { x: 60, y: -30 });
  assert.deepEqual(snapPivot(plan(), 'R', { x: 117, y: 3 }, 6), { x: 120, y: 0 });
  assert.deepEqual(snapPivot(plan(), 'R', { x: 30.4, y: 20.6 }, 6), { x: 30, y: 21 });
});

test('a wall counter on a room turned a quarter turn stays on its own (turned) wall', () => {
  // Square room: the turned counter lands where another wall used to be; it mustn't be re-seated onto that wall.
  const walls = box(120, 120);
  const p0 = project(walls, [], {
    rooms: [{ id: 'R', name: 'K', type: 'kitchen', points: [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 120 }, { x: 0, y: 120 }] }],
    counters: [{ id: 'c', a: { x: 20, y: 3.25 }, b: { x: 80, y: 3.25 }, depth: 25, side: -1, island: false, cutouts: [] }],
  });
  const p = projectReducer(p0, { type: 'rotateRoom', id: 'R', deg: 90 });
  const c = p.counters[0];
  // Anticlockwise: the top run goes to the left wall's face, its back on x = 3.25.
  assert.ok(near(c.a, { x: 3.25, y: 100 }) && near(c.b, { x: 3.25, y: 40 }));
});
