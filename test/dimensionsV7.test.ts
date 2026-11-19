import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anchorFor, anchorTarget, dimSnapPoints, pickWall } from '../src/calc/faces.ts';
import { ordinateAxis, ordinateLayout, ordinateValues } from '../src/calc/ordinate.ts';
import { historyReducer, initHistory, migrate, projectReducer } from '../src/model/store.ts';
import type { Counter, OrdinateDim, Project, Room } from '../src/model/types.ts';
import { project, wall } from './helpers.ts';

const near = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.01);

const counter: Counter = { id: 'c1', a: { x: 300, y: 0 }, b: { x: 396, y: 0 }, depth: 25, side: -1, island: false, cutouts: [] };
const room: Room = { id: 'r1', name: 'Den', type: 'other', points: [{ x: 500, y: 100 }, { x: 620, y: 100 }, { x: 620, y: 220 }, { x: 500, y: 220 }] };

test('a placed dimension pins to counter ends / corners and follows the counter; let go when it is deleted', () => {
  const base: Project = project([wall(0, 0, 240, 0)], [], { counters: [counter] });
  // side -1 off a → b along +x: the front is toward +y. The front-right corner, and the middle of the left end.
  const front = { x: 396, y: 25 };
  const end = { x: 300, y: 12.5 };
  assert.ok(dimSnapPoints(base).some((s) => near([s.p.x, s.p.y], [front.x, front.y])));
  const bAt = anchorFor(base, front)!;
  const aAt = anchorFor(base, end)!;
  assert.deepEqual(bAt, { counterId: 'c1', from: 'b', along: 0, inset: 25 });
  assert.deepEqual(aAt, { counterId: 'c1', along: 0, inset: 12.5 });
  assert.equal(anchorTarget(base, bAt), 'the counter');
  let h = initHistory(projectReducer(base, { type: 'addDim', dim: { id: 'dm_1', a: end, b: front, aAt, bAt }, offset: 12 }));
  // Slide the counter 24" right and make it 30" longer: each end follows its own end of the counter.
  h = historyReducer(h, { type: 'updateCounter', id: 'c1', patch: { a: { x: 324, y: 0 }, b: { x: 450, y: 0 } } });
  const d = h.present.dims![0];
  assert.ok(near([d.a.x, d.a.y, d.b.x, d.b.y], [324, 12.5, 450, 25]));
  const gone = historyReducer(h, { type: 'delete', ids: ['c1'] }).present.dims![0];
  assert.ok(near([gone.b.x, gone.b.y], [450, 25]));
  assert.equal(gone.bAt, undefined);
});

test('a placed dimension pins to room corners and the room centre and follows the room', () => {
  const base: Project = project([], [], { rooms: [room] });
  const cAt = anchorFor(base, { x: 560, y: 160 })!;
  const kAt = anchorFor(base, { x: 620, y: 220 })!;
  assert.deepEqual(cAt, { roomId: 'r1' });
  assert.deepEqual(kAt, { roomId: 'r1', corner: 2 });
  assert.equal(anchorTarget(base, cAt), 'the Den centre');
  assert.equal(anchorTarget(base, kAt), 'the Den corner');
  let h = initHistory(projectReducer(base, { type: 'addDim', dim: { id: 'dm_1', a: { x: 560, y: 160 }, b: { x: 620, y: 220 }, aAt: cAt, bAt: kAt }, offset: 12 }));
  h = historyReducer(h, { type: 'moveRoom', id: 'r1', delta: { x: 10, y: -20 } });
  const d = h.present.dims![0];
  assert.ok(near([d.a.x, d.a.y, d.b.x, d.b.y], [570, 140, 630, 200]));
  // A corner that's also a wall end pins to the wall (it follows the same point either way).
  const w = wall(500, 100, 620, 100);
  assert.ok('wallId' in anchorFor(project([w], [], { rooms: [room] }), { x: 500, y: 100 })!);
  assert.equal(historyReducer(h, { type: 'delete', ids: ['r1'] }).present.dims![0].aAt, undefined);
});

test('ordinate dimensions: an origin, then each point labelled with its distance along the axis; they follow their points', () => {
  assert.equal(ordinateAxis({ x: 0, y: 0 }, { x: 100, y: 30 }), 'x');
  assert.equal(ordinateAxis({ x: 0, y: 0 }, { x: 10, y: -80 }), 'y');
  const base: Project = project([wall(0, 0, 240, 0)], [], { counters: [counter] });
  const origin = { p: { x: 0, y: 0 }, at: anchorFor(base, { x: 0, y: 0 }) };
  const od: OrdinateDim = { id: 'od_1', axis: 'x', origin, pts: [{ p: { x: 120, y: 40 } }, { p: { x: 396, y: 25 }, at: anchorFor(base, { x: 396, y: 25 }) }] };
  let p = projectReducer(base, { type: 'addOrdDim', dim: od });
  assert.deepEqual(ordinateValues(p.ordDims![0]), [120, 396]);
  // A third point to the left of the origin reads its distance, not a negative.
  p = projectReducer(p, { type: 'updateOrdDim', id: 'od_1', patch: { pts: [...p.ordDims![0].pts, { p: { x: -30, y: 10 } }] } });
  assert.deepEqual(ordinateValues(p.ordDims![0]), [120, 396, 30]);
  // The baseline sits 24" above the highest point, pushed further out by its offset.
  const lay = ordinateLayout(p.ordDims![0], 6);
  assert.equal(lay.at, 0 - 24 - 6);
  assert.deepEqual(lay.stops.map((s) => [s.along, s.value]), [[0, 0], [120, 120], [396, 396], [-30, 30]]);
  // Move the counter: the pinned point follows; switch the axis and the values read up / down.
  let h = initHistory(p);
  h = historyReducer(h, { type: 'updateCounter', id: 'c1', patch: { a: { x: 330, y: 0 }, b: { x: 426, y: 0 } } });
  assert.deepEqual(ordinateValues(h.present.ordDims![0]), [120, 426, 30]);
  h = historyReducer(h, { type: 'updateOrdDim', id: 'od_1', patch: { axis: 'y' } });
  assert.deepEqual(ordinateValues(h.present.ordDims![0]), [40, 25, 10]);
  // The origin's wall stretched: the origin is pinned to its end and moves with it.
  h = historyReducer(h, { type: 'moveVertex', from: { x: 0, y: 0 }, to: { x: -12, y: 0 } });
  assert.ok(near([h.present.ordDims![0].origin.p.x], [-12]));
  // Dragged out, then deleted: its offset goes with it.
  h = historyReducer(h, { type: 'setDimOffset', id: 'od_1', offset: 18 });
  h = historyReducer(h, { type: 'delete', ids: ['od_1'] });
  assert.equal(h.present.ordDims!.length, 0);
  assert.equal(h.present.dimOffsets?.od_1, undefined);
});

test('dimension style: text size and end marks; defaults drop out so old projects stay as they were', () => {
  const old = project([wall(0, 0, 240, 0)]);
  // An old project (no ordinates, no style) loads unchanged.
  const loaded = migrate(JSON.parse(JSON.stringify(old)));
  assert.equal(loaded.dimLook, undefined);
  assert.equal(loaded.ordDims, undefined);
  let p = projectReducer(old, { type: 'setDimLook', patch: { text: 1.25 } });
  p = projectReducer(p, { type: 'setDimLook', patch: { ends: 'arrow' } });
  assert.deepEqual(p.dimLook, { text: 1.25, ends: 'arrow' });
  p = projectReducer(p, { type: 'setDimLook', patch: { text: 1 } });
  assert.deepEqual(p.dimLook, { ends: 'arrow' });
  p = projectReducer(p, { type: 'setDimLook', patch: { ends: 'tick' } });
  assert.equal(p.dimLook, undefined);
});

test('an angle dimension picked on the plan: the wall under each click, then the pair', () => {
  const a = wall(0, 0, 120, 0);
  const b = wall(0, 0, 0, 120);
  const p0 = project([a, b]);
  assert.equal(pickWall(p0, { x: 60, y: 2 }, 2), a.id);
  assert.equal(pickWall(p0, { x: 4, y: 80 }, 2), b.id);
  assert.equal(pickWall(p0, { x: 60, y: 60 }, 2), null);
  let p = projectReducer(p0, { type: 'addAngleDim', dim: { id: 'ang_1', a: a.id, b: b.id } });
  p = projectReducer(p, { type: 'addAngleDim', dim: { id: 'ang_2', a: b.id, b: a.id } });
  assert.equal(p.angleDims!.length, 1);
});
