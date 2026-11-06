import assert from 'node:assert/strict';
import { test } from 'node:test';
import { partitionStrings, roomClearSizes } from '../src/calc/faces.ts';
import { projectReducer } from '../src/model/store.ts';
import type { Point, Project, Wall } from '../src/model/types.ts';
import { box, project, wall } from './helpers.ts';

const outline = (P: Point[]): Wall[] => P.map((a, i) => wall(a.x, a.y, P[(i + 1) % P.length].x, P[(i + 1) % P.length].y));

test('partition strings run at each height the partitions stand, not just once each way', () => {
  // 30' × 20': a partition at x = 10' down the top half, one at 15' down the bottom half, one at 20' all the way.
  const walls = [...box(360, 240), wall(120, 0, 120, 120, 'interior'), wall(180, 120, 180, 240, 'interior'), wall(240, 0, 240, 240, 'interior')];
  const p = project(walls);
  const ends = { x: [0, 360] as [number, number], y: [0, 240] as [number, number] };
  const strings = partitionStrings(p, 'centre', ends);
  // The full-height wall alone would repeat part of each, so it doesn't get its own.
  assert.deepEqual(
    strings.map((s) => [s.axis, s.at, s.stops]),
    [
      ['x', 40, [0, 120, 240, 360]],
      ['x', 160, [0, 180, 240, 360]],
    ],
  );
});

test('a string ends at the exterior walls it meets at its height (an L house)', () => {
  // 20' across the top, a 10' leg down the left; a partition splits the leg.
  const P: Point[] = [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 96 }, { x: 120, y: 96 }, { x: 120, y: 192 }, { x: 0, y: 192 }];
  const p = project([...outline(P), wall(60, 96, 60, 192, 'interior')]);
  const [s] = partitionStrings(p, 'centre', { x: [0, 240], y: [0, 192] });
  assert.deepEqual([s.axis, s.at, s.stops], ['x', 128, [0, 60, 120]]);
  // To faces: out to the outside faces of the leg's walls, both faces of the partition.
  assert.deepEqual(partitionStrings(p, 'inside', { x: [0, 240], y: [0, 192] })[0].stops, [-3.25, 57.75, 62.25, 123.25]);
});

const room = (P: Point[]): Project => project(outline(P), [], { rooms: [{ id: 'R', name: 'R', type: 'living', points: P }] });
const sizes = (p: Project) =>
  roomClearSizes(p, p.rooms[0])
    .map((s) => [s.width, s.depth, s.at.x, s.at.y])
    .sort((a, b) => b[0] * b[1] - a[0] * a[1] || a[2] - b[2]);

test('a U-shaped room: its full-width bar, then each arm (open where it meets the bar)', () => {
  const p = room([{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 96 }, { x: 180, y: 96 }, { x: 180, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 144 }, { x: 0, y: 144 }]);
  const t = p.walls[0].thickness / 2;
  assert.deepEqual(sizes(p), [
    [240 - 2 * t, 48 - 2 * t, 120, 120],
    [60 - 2 * t, 96 - t, 30, 48],
    [60 - 2 * t, 96 - t, 210, 48],
  ]);
});

test('a T-shaped room: the cross bar, then the stem', () => {
  const p = room([{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 72 }, { x: 150, y: 72 }, { x: 150, y: 192 }, { x: 90, y: 192 }, { x: 90, y: 72 }, { x: 0, y: 72 }]);
  const t = p.walls[0].thickness / 2;
  // The bar's bottom edge is walled either side of the stem: it counts.
  assert.deepEqual(sizes(p), [
    [240 - 2 * t, 72 - 2 * t, 120, 36],
    [60 - 2 * t, 120 - t, 120, 132],
  ]);
  // Not square to the plan: nothing.
  assert.deepEqual(roomClearSizes(p, { ...p.rooms[0], points: [{ x: 0, y: 0 }, { x: 100, y: 20 }, { x: 80, y: 120 }, { x: 0, y: 100 }] }), []);
});

test('placed dimensions: added 1\' out, deleted with their offset; strings hide and all come back', () => {
  let p = project(box(240, 144));
  const dim = { id: 'dm_1', a: { x: 0, y: 0 }, b: { x: 120, y: 0 } };
  p = projectReducer(p, { type: 'addDim', dim, offset: 12 });
  assert.deepEqual([p.dims, p.dimOffsets], [[dim], { dm_1: 12 }]);
  p = projectReducer(p, { type: 'delete', ids: ['dm_1'] });
  assert.deepEqual([p.dims, p.dimOffsets], [[], {}]);
  p = projectReducer(p, { type: 'setDimHidden', id: 'top-overall', hidden: true });
  p = projectReducer(p, { type: 'setDimHidden', id: 'chain:w1', hidden: true });
  assert.deepEqual(p.hiddenDims, ['top-overall', 'chain:w1']);
  p = projectReducer(p, { type: 'setDimHidden', id: 'top-overall', hidden: false });
  assert.deepEqual(p.hiddenDims, ['chain:w1']);
  p = projectReducer(p, { type: 'showAllDims' });
  assert.equal(p.hiddenDims, undefined);
  // Deleting something else leaves dims alone.
  const q = projectReducer({ ...p, dims: [dim] }, { type: 'delete', ids: [p.walls[0].id] });
  assert.deepEqual(q.dims, [dim]);
});
