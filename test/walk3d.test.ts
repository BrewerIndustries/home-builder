import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildScene } from '../src/calc/model3d.ts';
import { stairBoxes, stepDepths } from '../src/calc/stairs3d.ts';
import { EYE, groundAt, move, RADIUS, startPoint, type Walker } from '../src/calc/walk.ts';
import { newFurniture } from '../src/calc/furniture.ts';
import { box, door, project } from './helpers.ts';

const room = () => {
  const walls = box(240, 180);
  const p = project(walls, [door(walls[0].id, 120)]);
  p.rooms = [{ id: 'R', name: 'Room', type: 'living', points: [{ x: 3, y: 3 }, { x: 237, y: 3 }, { x: 237, y: 177 }, { x: 3, y: 177 }] }];
  return p;
};

test('a straight stair is one block per tread, rising a riser each, filling its run', () => {
  const p = room();
  const s = { ...newFurniture(p, 'stairs', { x: 120, y: 90 }, 'st'), rot: 0 };
  const depths = stepDepths(p, s);
  const boxes = stairBoxes(p, s);
  assert.equal(boxes.length, depths.length);
  const tops = boxes.map((b) => b.c[1] + b.size[1] / 2);
  for (let i = 1; i < tops.length; i++) assert.ok(tops[i] > tops[i - 1]);
  assert.ok(Math.abs(boxes.reduce((t, b) => t + b.size[2], 0) - s.d) < 0.01, 'the steps fill the stair');
  // Turning stairs too: an L and a U.
  for (const shape of ['L', 'U'] as const) {
    const t = { ...s, shape, w: 84, d: 120 };
    assert.equal(stairBoxes(p, t).length, stepDepths(p, t).length);
  }
});

test('walking: walls stop you, doors let you through, stairs lift you a step at a time', () => {
  const p = room();
  const scene = buildScene(p);
  const start = startPoint(scene);
  assert.ok(start.x > 0 && start.x < 240 && start.z > 0 && start.z < 180 && start.y === 0);
  // Walk hard at the left wall: you stop a body's radius off its face.
  let w: Walker = { x: 40, z: 90, y: 0 };
  for (let i = 0; i < 60; i++) w = move(scene, w, -4, 0);
  assert.ok(w.x >= 3.25 + RADIUS - 0.5 && w.x < 20, `stopped at ${w.x}`);
  // Straight out through the door in the top wall (y = 0) is clear... a wall elsewhere isn't.
  w = { x: 120, z: 40, y: 0 };
  for (let i = 0; i < 20; i++) w = move(scene, w, 0, -4);
  assert.ok(w.z < 40 - 40, `through the door to ${w.z}`);
  w = { x: 60, z: 40, y: 0 };
  for (let i = 0; i < 20; i++) w = move(scene, w, 0, -4);
  assert.ok(w.z > 3, `blocked by the wall at ${w.z}`);
  // A stair: from its foot, walking up climbs; the eye stays above the treads.
  const st = { ...newFurniture(p, 'stairs', { x: 120, y: 90 }, 'st'), rot: 0 };
  const withStair = buildScene({ ...p, furniture: [st] });
  w = { x: 120, z: 90 + st.d / 2 + 12, y: 0 };
  let top = 0;
  for (let i = 0; i < 200; i++) {
    w = move(withStair, w, 0, -1);
    top = Math.max(top, w.y);
  }
  assert.ok(top > 60, `climbed to ${top}`);
  assert.ok(EYE > 0 && groundAt(withStair, 120, 90 + st.d / 2 + 12, 0) === 0);
});
