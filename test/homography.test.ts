import assert from 'node:assert/strict';
import { test } from 'node:test';
import { homography, orderCorners, project, quadSize } from '../src/model/homography.ts';

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('homography maps the four corners exactly and keeps lines straight', () => {
  const src = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 60 },
    { x: 0, y: 60 },
  ];
  // A photo-like keystone: top edge foreshortened.
  const dst = [
    { x: 20, y: 10 },
    { x: 80, y: 12 },
    { x: 98, y: 70 },
    { x: 2, y: 68 },
  ];
  const h = homography(src, dst);
  src.forEach((p, i) => {
    const q = project(h, p);
    near(q.x, dst[i].x);
    near(q.y, dst[i].y);
  });
  // The midpoint of an edge stays on that edge.
  const m = project(h, { x: 50, y: 0 });
  const t = (m.x - 20) / 60;
  near(m.y, 10 + 2 * t, 1e-6);
});

test('corner order is TL, TR, BR, BL whatever order they were clicked in', () => {
  const q = orderCorners([
    { x: 98, y: 70 },
    { x: 20, y: 10 },
    { x: 2, y: 68 },
    { x: 80, y: 12 },
  ]);
  assert.deepEqual(q, [
    { x: 20, y: 10 },
    { x: 80, y: 12 },
    { x: 98, y: 70 },
    { x: 2, y: 68 },
  ]);
  const s = quadSize(q);
  assert.ok(s.w > 70 && s.w < 80 && s.h > 55 && s.h < 62);
});

test('collinear points are rejected', () => {
  const line = [0, 1, 2, 3].map((i) => ({ x: i * 10, y: i * 10 }));
  assert.throws(() => homography(line, line));
});
