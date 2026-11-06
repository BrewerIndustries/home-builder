import assert from 'node:assert/strict';
import { test } from 'node:test';
import { wallLength } from '../src/model/geometry.ts';
import { projectReducer } from '../src/model/store.ts';
import type { Point, Project } from '../src/model/types.ts';
import { retarget, rotateRoom, snapAngle, turnPoint, wallAngle } from '../src/model/wallEdit.ts';
import { box, door, project, wall } from './helpers.ts';

const near = (p: Point, q: Point) => Math.abs(p.x - q.x) < 0.01 && Math.abs(p.y - q.y) < 0.01;

test('a typed distance re-sets a dragged item: same direction, measured from where it started', () => {
  assert.deepEqual(retarget({ x: 0, y: 0 }, { x: 30, y: 40 }, 100), { x: 60, y: 80 });
  // Negative: back the other way.
  assert.deepEqual(retarget({ x: 10, y: 0 }, { x: 20, y: 0 }, -5), { x: 5, y: 0 });
  assert.equal(retarget({ x: 1, y: 1 }, { x: 1, y: 1 }, 5), null);
});

test('turning a point: anticlockwise on the plan (y runs down)', () => {
  assert.deepEqual(turnPoint({ x: 10, y: 0 }, { x: 0, y: 0 }, 90), { x: 0, y: -10 });
  assert.deepEqual(turnPoint({ x: 10, y: 0 }, { x: 0, y: 0 }, -90), { x: 0, y: 10 });
});

/** A 10' × 8' room with a wall running off its right side, an island, a sofa and a ceiling light inside. */
function plan(): Project {
  const walls = [...box(120, 96), wall(120, 48, 240, 48, 'interior')];
  return project(walls, [door(walls[0].id, 60)], {
    rooms: [{ id: 'R', name: 'Den', type: 'living', points: [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 96 }, { x: 0, y: 96 }] }],
    counters: [{ id: 'k', a: { x: 40, y: 40 }, b: { x: 80, y: 40 }, depth: 20, side: -1, island: true, cutouts: [] }],
    furniture: [{ id: 's', kind: 'sofa', at: { x: 60, y: 70 }, rot: 0, w: 84, d: 36 }],
    fixtures: [{ id: 'l', kind: 'light', at: { x: 60, y: 48 }, auto: false }],
  });
}

test('turning a room turns its walls and contents about its centre; an attached wall stretches', () => {
  const p = rotateRoom(plan(), 'R', 90);
  const c = { x: 60, y: 48 };
  // Room corners turned a quarter about (60, 48).
  assert.ok(near(p.rooms[0].points[0], turnPoint({ x: 0, y: 0 }, c, 90)));
  for (const w of p.walls.slice(0, 4)) assert.ok(Math.abs(wallLength(w) - (w.id === p.walls[0].id || w.id === p.walls[2].id ? 120 : 96)) < 0.01);
  // The outside wall keeps its far end and now starts at the turned point.
  const out = p.walls[4];
  assert.deepEqual(out.b, { x: 240, y: 48 });
  assert.ok(near(out.a, turnPoint({ x: 120, y: 48 }, c, 90)));
  // The door rides on its wall.
  assert.equal(p.openings[0].offset, 60);
  // Island, sofa and light turn too; the sofa's rotation (clockwise-positive) goes the other way.
  assert.ok(near(p.counters[0].a, turnPoint({ x: 40, y: 40 }, c, 90)));
  assert.deepEqual([p.furniture[0].rot, p.fixtures[0].at], [270, { x: 60, y: 48 }]);
  assert.ok(near(p.furniture[0].at, turnPoint({ x: 60, y: 70 }, c, 90)));
  // Turned back: where it started.
  const back = rotateRoom(p, 'R', -90);
  assert.ok(back.walls.every((w, i) => near(w.a, plan().walls[i].a) && near(w.b, plan().walls[i].b)));
});

test('the reducer turns a room in one step and wall counters follow their walls', () => {
  let p = plan();
  const top = p.walls[0];
  p = { ...p, counters: [{ id: 'wc', a: { x: 20, y: 3.25 }, b: { x: 80, y: 3.25 }, depth: 25, side: -1, island: false, cutouts: [] }] };
  const q = projectReducer(p, { type: 'rotateRoom', id: 'R', deg: 30 });
  const w = q.walls.find((x) => x.id === top.id)!;
  assert.ok(Math.abs(wallAngle(w) - 30) < 0.01);
  const c = q.counters[0];
  // Still 60" long and parallel to its wall.
  assert.ok(Math.abs(Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y) - 60) < 0.01);
  assert.ok(Math.abs(Math.atan2(-(c.b.y - c.a.y), c.b.x - c.a.x) * (180 / Math.PI) - 30) < 0.01);
});

test('drawing or swinging at a free angle locks parallel or square to an existing wall', () => {
  // A wall at 30°.
  const angled = wall(0, 0, 100 * Math.cos(Math.PI / 6), -100 * Math.sin(Math.PI / 6));
  const from = { x: 200, y: 200 };
  const at = (deg: number, r = 100) => ({ x: from.x + r * Math.cos((deg * Math.PI) / 180), y: from.y - r * Math.sin((deg * Math.PI) / 180) });
  const par = snapAngle([angled], from, at(32))!;
  assert.deepEqual([par.angle, par.label], [30, `parallel to ${angled.id}`]);
  assert.ok(near(par.p, at(30)));
  // The other way along the line counts too (210°), and square to it (120°).
  assert.equal(snapAngle([angled], from, at(208))!.angle, 210);
  const sq = snapAngle([angled], from, at(118))!;
  assert.deepEqual([sq.angle, sq.label], [120, `square to ${angled.id}`]);
  // Not close to any: nothing; too short to judge: nothing.
  assert.equal(snapAngle([angled], from, at(75)), null);
  assert.equal(snapAngle([angled], from, at(30, 3)), null);
  // The wall being swung doesn't snap to itself.
  assert.equal(snapAngle([angled], angled.a, at(32), { exclude: angled.b }), null);
});
