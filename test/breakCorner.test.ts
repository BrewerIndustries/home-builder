import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectReducer } from '../src/model/store.ts';
import { box, project } from './helpers.ts';

test('moving one wall end at a broken corner leaves the other wall where it was', () => {
  const p = project(box(240, 120));
  const corner = { x: 240, y: 0 };
  const [a, b] = p.walls.filter((w) => (w.a.x === 240 && w.a.y === 0) || (w.b.x === 240 && w.b.y === 0));
  const q = projectReducer(p, { type: 'moveWallEnd', id: a.id, from: corner, to: { x: 200, y: 0 } });
  const a2 = q.walls.find((w) => w.id === a.id)!;
  const b2 = q.walls.find((w) => w.id === b.id)!;
  assert.ok([a2.a, a2.b].some((e) => e.x === 200 && e.y === 0));
  assert.deepEqual(b2, b);
  // moveVertex still moves both.
  const r = projectReducer(p, { type: 'moveVertex', from: corner, to: { x: 200, y: 0 } });
  assert.ok([r.walls.find((w) => w.id === b.id)!.a, r.walls.find((w) => w.id === b.id)!.b].some((e) => e.x === 200));
});
