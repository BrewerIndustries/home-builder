import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildScene, roomCeiling, wallBoxes } from '../src/calc/model3d.ts';
import type { Room } from '../src/model/types.ts';
import { box, door, project, wall, window_ } from './helpers.ts';

test('walls split around openings: full / below sill / above head / full', () => {
  const w = wall(0, 0, 144, 0);
  const all = wallBoxes(project([w], [window_(w.id, 72, 36, 48, 32)]));
  assert.equal(all.filter((b) => b.kind === 'glass').length, 1);
  const boxes = all.filter((b) => b.kind !== 'glass');
  assert.equal(boxes.length, 4);
  const below = boxes.find((b) => b.c[1] === 16)!; // 0..32 sill
  assert.equal(below.size[0], 36);
  const total = boxes.reduce((s, b) => s + b.size[0] * b.size[1], 0);
  assert.ok(Math.abs(total - (144 * 97.125 - 36 * 48)) < 1e-6); // wall area minus window
});

test('doors leave no piece below', () => {
  const w = wall(0, 0, 144, 0);
  assert.equal(wallBoxes(project([w], [door(w.id, 72)])).length, 3);
});

const room = (ceiling: Room['ceiling']): Room => ({
  id: 'r', name: 'R', type: 'living', ceiling,
  points: [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 144 }, { x: 0, y: 144 }],
});

test('cathedral ceiling: two slopes meeting at the ridge, two gables', () => {
  const c = roomCeiling(project(box(240, 144)), room({ type: 'cathedral', height: 96, peak: 168 }));
  assert.equal(c.faces.filter((f) => f.kind === 'ceiling').length, 2);
  assert.equal(c.faces.filter((f) => f.kind === 'gable').length, 2);
  const ridge = Math.max(...c.faces.flatMap((f) => f.pts.map((p) => p[1])));
  assert.equal(ridge, 168);
});

test('coffered and tray produce beams / steps; scene bounds cover the peak', () => {
  assert.ok(roomCeiling(project(box(240, 144)), room({ type: 'coffered', height: 108 })).boxes.length > 0);
  assert.equal(roomCeiling(project(box(240, 144)), room({ type: 'tray' })).flats.length, 2);
  const s = buildScene(project(box(240, 144), [], { rooms: [room({ type: 'vaulted', height: 96, peak: 200 })] }));
  assert.equal(s.bounds.max[1], 200);
});
