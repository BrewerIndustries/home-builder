import assert from 'node:assert/strict';
import { test } from 'node:test';
import { furniturePoint } from '../src/calc/furniture.ts';
import { handlePoint, MIN_SIZE, resizeFurniture } from '../src/calc/furnitureResize.ts';
import type { Furniture } from '../src/model/types.ts';

const bed = (rot = 0): Furniture => ({ id: 'f', kind: 'bed-queen' as Furniture['kind'], at: { x: 100, y: 100 }, rot, w: 60, d: 80 });
const near = (a: number, b: number) => Math.abs(a - b) < 0.02;

test('dragging the right edge out widens it and the left edge stays put', () => {
  const f = bed();
  const r = resizeFurniture(f, { sx: 1, sy: 0 }, { x: 142.4, y: 100 });
  assert.equal(r.w, 72); // left edge at 70, dragged to 142 → 72"
  assert.equal(r.d, 80);
  assert.ok(near(r.at.x - r.w / 2, 70) && near(r.at.y, 100));
});

test('a corner handle sets both sizes with the opposite corner fixed', () => {
  const f = bed();
  const r = resizeFurniture(f, { sx: -1, sy: 1 }, { x: 60, y: 150 });
  assert.equal(r.w, 70); // right edge 130 fixed, dragged to x 60
  assert.equal(r.d, 90); // back edge 60 fixed, dragged to y 150
  const g = { ...f, ...r };
  assert.ok(near(handlePoint(g, { sx: 1, sy: -1 }).x, 130) && near(handlePoint(g, { sx: 1, sy: -1 }).y, 60));
});

test('Alt (from the centre) grows evenly and keeps the centre', () => {
  const r = resizeFurniture(bed(), { sx: 1, sy: 0 }, { x: 140, y: 100 }, { fromCentre: true });
  assert.equal(r.w, 80);
  assert.deepEqual(r.at, { x: 100, y: 100 });
});

test('a turned fixture resizes along its own sides', () => {
  const f = bed(90); // turned a quarter: its width now runs up and down the plan
  const right = handlePoint(f, { sx: 1, sy: 0 });
  // Pull the right-hand handle 10" further out along the item's own x.
  const out = furniturePoint(f, 30 + 10, 0);
  assert.ok(near(right.x, furniturePoint(f, 30, 0).x));
  const r = resizeFurniture(f, { sx: 1, sy: 0 }, out);
  assert.equal(r.w, 70);
  assert.equal(r.d, 80);
  const g = { ...f, ...r };
  // The left edge did not move.
  const leftBefore = handlePoint(f, { sx: -1, sy: 0 });
  const leftAfter = handlePoint(g, { sx: -1, sy: 0 });
  assert.ok(near(leftBefore.x, leftAfter.x) && near(leftBefore.y, leftAfter.y));
});

test('it never shrinks below the minimum, even dragged past the far edge', () => {
  const r = resizeFurniture(bed(), { sx: 1, sy: 0 }, { x: 20, y: 100 });
  assert.equal(r.w, MIN_SIZE);
});
