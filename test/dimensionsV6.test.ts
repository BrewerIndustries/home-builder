import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anchorFor, anchorTarget, angleBetween, angleNeighbours, dimSnapPoints, stringStyle } from '../src/calc/faces.ts';
import { historyReducer, initHistory, projectReducer } from '../src/model/store.ts';
import type { Furniture, Project } from '../src/model/types.ts';
import { door, project, wall } from './helpers.ts';

const near = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.01);

test('each string can read chained or running on its own; unset follows the plan', () => {
  let p = project([wall(0, 0, 240, 0)]);
  assert.equal(stringStyle(p, 'top-overall'), 'chain');
  p = projectReducer(p, { type: 'setStringStyle', id: 'chain:w1', style: 'running' });
  assert.equal(stringStyle(p, 'chain:w1'), 'running');
  assert.equal(stringStyle(p, 'top-overall'), 'chain');
  p = projectReducer(p, { type: 'setDimStyle', style: 'running' });
  p = projectReducer(p, { type: 'setStringStyle', id: 'top-overall', style: 'chain' });
  assert.equal(stringStyle(p, 'top-overall'), 'chain');
  assert.equal(stringStyle(p, 'left-chain'), 'running');
  // Back to the plan's.
  p = projectReducer(p, { type: 'setStringStyle', id: 'top-overall', style: undefined });
  p = projectReducer(p, { type: 'setStringStyle', id: 'chain:w1', style: undefined });
  assert.equal(p.dimStyles, undefined);
});

test('a placed dimension pinned to a door jamb or a fixture corner follows it; let go when it is deleted', () => {
  const w = wall(0, 0, 240, 0);
  const sofa: Furniture = { id: 'sofa', kind: 'sofa', at: { x: 120, y: 80 }, rot: 0, w: 84, d: 36 };
  const base: Project = project([w], [door(w.id, 120)], { furniture: [sofa] });
  // The door's start jamb on the centreline, and the sofa's back-left corner.
  const a = { x: 102, y: 0 };
  const b = { x: 78, y: 62 };
  assert.ok(dimSnapPoints(base).some((s) => near([s.p.x, s.p.y], [a.x, a.y])));
  const aAt = anchorFor(base, a)!;
  const bAt = anchorFor(base, b)!;
  assert.deepEqual(aAt, { openingId: 'd120', along: -18, perp: 0 });
  assert.deepEqual(bAt, { furnitureId: 'sofa', x: -42, y: -18 });
  assert.equal(anchorTarget(base, aAt), 'the door start jamb');
  assert.equal(anchorTarget(base, bAt), 'the sofa');
  let h = initHistory(projectReducer(base, { type: 'addDim', dim: { id: 'dm_1', a, b, aAt, bAt }, offset: 12 }));
  h = historyReducer(h, { type: 'updateOpening', id: 'd120', patch: { offset: 150 } });
  h = historyReducer(h, { type: 'updateFurniture', id: 'sofa', patch: { at: { x: 140, y: 90 } } });
  const d = h.present.dims![0];
  assert.ok(near([d.a.x, d.a.y, d.b.x, d.b.y], [132, 0, 98, 72]));
  // A turned sofa: its corner turns with it.
  h = historyReducer(h, { type: 'updateFurniture', id: 'sofa', patch: { rot: 90 } });
  assert.ok(near([h.present.dims![0].b.x, h.present.dims![0].b.y], [140 + 18, 90 - 42]));
  // The door deleted: that end stays and lets go.
  const gone = historyReducer(h, { type: 'delete', ids: ['d120'] }).present.dims![0];
  assert.ok(near([gone.a.x, gone.a.y], [132, 0]));
  assert.equal(gone.aAt, undefined);
  // Wall ends still pin as before when nothing else is that close.
  assert.deepEqual(anchorFor(base, { x: 240, y: 0 }), { wallId: w.id, end: 'b', along: 0, perp: 0 });
});

test('angle dimensions between walls: where their lines meet, measured between them; gone with either wall', () => {
  const a = wall(0, 0, 120, 0);
  const b = wall(0, 0, 0, 120);
  const c = wall(120, 0, 200, 80); // 45° off the end of a
  const p0 = project([a, b, c]);
  assert.equal(Math.round(angleBetween(p0, a.id, b.id)!.deg), 90);
  // a runs back toward x = 0 from the corner at (120, 0); c runs on down-right: 135° between them.
  assert.equal(Math.round(angleBetween(p0, a.id, c.id)!.deg), 135);
  assert.deepEqual(angleBetween(p0, a.id, c.id)!.at, { x: 120, y: 0 });
  assert.equal(angleBetween(project([a, wall(0, 50, 120, 50)]), a.id, 'w999'), null);
  assert.deepEqual(angleNeighbours(p0, a.id).map((w) => w.id).sort(), [b.id, c.id].sort());
  let p = projectReducer(p0, { type: 'addAngleDim', dim: { id: 'ang_1', a: a.id, b: c.id } });
  // The same pair again (either way round) isn't added twice.
  p = projectReducer(p, { type: 'addAngleDim', dim: { id: 'ang_2', a: c.id, b: a.id } });
  assert.equal(p.angleDims!.length, 1);
  // It follows the walls: swing c square and it reads 90°.
  const swung = projectReducer(p, { type: 'moveVertex', from: { x: 200, y: 80 }, to: { x: 120, y: 80 } });
  assert.equal(Math.round(angleBetween(swung, a.id, c.id)!.deg), 90);
  assert.equal(projectReducer(p, { type: 'delete', ids: [c.id] }).angleDims!.length, 0);
  assert.equal(projectReducer(p, { type: 'delete', ids: ['ang_1'] }).angleDims!.length, 0);
});
