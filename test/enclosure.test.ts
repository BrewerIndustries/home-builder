import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enclosedArea, samePolygon } from '../src/calc/enclosure.ts';
import { polygonArea } from '../src/model/geometry.ts';
import { box, wall } from './helpers.ts';

const pts = (...xy: number[]) => Array.from({ length: xy.length / 2 }, (_, i) => ({ x: xy[2 * i], y: xy[2 * i + 1] }));

test('a click inside a box finds the box; outside finds nothing', () => {
  const walls = box(240, 180);
  assert.deepEqual(enclosedArea(walls, { x: 100, y: 100 }), pts(0, 0, 240, 0, 240, 180, 0, 180));
  assert.equal(enclosedArea(walls, { x: 300, y: 100 }), null);
});

test('interior walls meeting at Ts split the box into rooms', () => {
  // A wall across the middle, then a wall from it up to the top.
  const walls = [...box(240, 180), wall(0, 96, 240, 96, 'interior'), wall(120, 0, 120, 96, 'interior')];
  assert.deepEqual(enclosedArea(walls, { x: 60, y: 40 }), pts(0, 0, 120, 0, 120, 96, 0, 96));
  assert.deepEqual(enclosedArea(walls, { x: 200, y: 40 }), pts(120, 0, 240, 0, 240, 96, 120, 96));
  // The bottom room's top edge has a T at x=120 from the wall above it; that point is dropped.
  assert.deepEqual(enclosedArea(walls, { x: 60, y: 150 }), pts(0, 96, 240, 96, 240, 180, 0, 180));
});

test('an L-shaped room comes back with all six corners', () => {
  // 240 × 180 box with a 120 × 96 bedroom cut out of the top-right corner.
  const walls = [...box(240, 180), wall(120, 0, 120, 96, 'interior'), wall(120, 96, 240, 96, 'interior')];
  const L = enclosedArea(walls, { x: 40, y: 150 })!;
  assert.ok(samePolygon(L, pts(0, 0, 120, 0, 120, 96, 240, 96, 240, 180, 0, 180)), JSON.stringify(L));
  assert.equal(polygonArea(L), 240 * 180 - 120 * 96);
});

test('walls that cross, stubs that dead-end, and angled walls', () => {
  // A wall drawn right across the box (crossing, not ending on, the other walls) and a stub.
  const cross = [...box(240, 180), wall(-24, 90, 264, 90, 'interior'), wall(60, 0, 60, 40, 'interior')];
  assert.deepEqual(enclosedArea(cross, { x: 100, y: 40 }), pts(0, 0, 240, 0, 240, 90, 0, 90));
  // A 45° corner wall cuts a triangle off the box.
  const angled = [...box(240, 180), wall(180, 0, 240, 60, 'interior')];
  assert.ok(samePolygon(enclosedArea(angled, { x: 225, y: 15 })!, pts(180, 0, 240, 0, 240, 60)));
  assert.equal(polygonArea(enclosedArea(angled, { x: 60, y: 90 })!), 240 * 180 - 1800);
});

test('a gap in the walls leaves the area open', () => {
  const walls = box(240, 180).slice(0, 3); // missing the left side
  assert.equal(enclosedArea(walls, { x: 100, y: 100 }), null);
});
