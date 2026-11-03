import assert from 'node:assert/strict';
import { test } from 'node:test';
import { wallLength } from '../src/model/geometry.ts';
import { projectReducer } from '../src/model/store.ts';
import { rotateWall, snapEndToWalls, swingEnd, wallAngle } from '../src/model/wallEdit.ts';
import { box, project, wall } from './helpers.ts';

test('wall angles read anticlockwise from pointing right, with plan y running down', () => {
  assert.equal(wallAngle(wall(0, 0, 100, 0)), 0);
  assert.equal(wallAngle(wall(0, 0, 0, -100)), 90);
  assert.equal(wallAngle(wall(0, 0, -100, 0)), 180);
  assert.equal(wallAngle(wall(0, 0, 0, 100)), 270);
  assert.equal(wallAngle(wall(0, 0, 100, -100)), 45);
});

test('rotating a wall about either end keeps its length; attached walls stretch to follow', () => {
  const w = wall(0, 0, 120, 0);
  assert.deepEqual(rotateWall(w, 90, 'a'), { from: w.b, to: { x: 0, y: -120 } });
  assert.deepEqual(rotateWall(w, 90, 'b'), { from: w.a, to: { x: 120, y: 120 } });
  // An L: turning the first wall about its start drags the second wall's start with it.
  const second = wall(120, 0, 120, 96);
  let p = project([w, second]);
  p = projectReducer(p, { type: 'moveVertex', ...rotateWall(w, 30, 'a') });
  const [a, b] = p.walls;
  assert.ok(Math.abs(wallLength(a) - 120) < 0.01);
  assert.ok(Math.abs(wallAngle(a) - 30) < 0.01);
  assert.deepEqual(b.a, a.b);
  assert.deepEqual(b.b, { x: 120, y: 96 });
});

test('swinging an end goes in 15° steps round the anchor, or any angle', () => {
  const s = swingEnd({ x: 0, y: 0 }, 100, { x: 100, y: -20 }, 15);
  assert.equal(s.angle, 15);
  assert.ok(Math.abs(Math.hypot(s.p.x, s.p.y) - 100) < 0.01);
  assert.equal(swingEnd({ x: 0, y: 0 }, 100, { x: 100, y: -20 }, 0).angle, 11.3);
});

test('a dragged end snaps onto another wall: into its thickness = a T, just outside = its face', () => {
  const walls = box(240, 144);
  const t = walls[2].thickness; // bottom wall, y = 144
  const inner = wall(100, 40, 100, 100, 'interior');
  const p = project([...walls, inner]);
  const tol = 4;
  // Inside the bottom wall: onto its centreline, kept square under the anchor (100, 40).
  assert.deepEqual(snapEndToWalls(p, { x: 101.5, y: 143 }, { exclude: inner.b, anchor: inner.a, tol }), { p: { x: 100, y: 144 }, label: 'onto W3' });
  // Just short of the face: stops on the face line.
  assert.deepEqual(snapEndToWalls(p, { x: 101, y: 144 - t / 2 - 2 }, { exclude: inner.b, anchor: inner.a, tol }), { p: { x: 100, y: 144 - t / 2 }, label: "to W3's face" });
  // Without an anchor it drops straight onto the line.
  assert.deepEqual(snapEndToWalls(p, { x: 101.5, y: 143 }, { exclude: inner.b, tol })?.p, { x: 101.5, y: 144 });
  // Open floor: nothing to snap to.
  assert.equal(snapEndToWalls(p, { x: 100, y: 110 }, { exclude: inner.b, anchor: inner.a, tol }), null);
  // Walls already meeting at the dragged end don't count: dragging a box corner ignores its own two walls.
  assert.equal(snapEndToWalls(p, { x: 1, y: 1 }, { exclude: walls[0].a, tol }), null);
});
