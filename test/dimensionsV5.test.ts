import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anchorFor, partitionStrings, runningLabels } from '../src/calc/faces.ts';
import { historyReducer, initHistory, projectReducer } from '../src/model/store.ts';
import { box, project, wall } from './helpers.ts';

const ends = { x: [0, 360] as [number, number], y: [0, 240] as [number, number] };
const near = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.01);

test('an angled partition is dimensioned where it crosses the string, faces spread by its slope', () => {
  // 30' × 20' with a partition leaning from (100, 0) to (140, 240): 1 across for every 6 down.
  const p = project([...box(360, 240), wall(100, 0, 140, 240, 'interior')]);
  const [s] = partitionStrings(p, 'centre', ends);
  // A third of the way down (y = 80) it's at x = 100 + 80 / 6.
  assert.equal(s.axis, 'x');
  assert.ok(Math.abs(s.at - 80) < 1e-9);
  assert.ok(near(s.stops, [0, 100 + 80 / 6, 360]));
  // Faces: 2.25" off the centreline, along the string 2.25 / cos(lean).
  const lean = 2.25 * (Math.hypot(40, 240) / 240);
  assert.ok(near(partitionStrings(p, 'inside', ends)[0].stops, [-3.25, 100 + 80 / 6 - lean, 100 + 80 / 6 + lean, 363.25]));
  // Leaning more than 60° from square to the line: not on that string (it gets the other one instead).
  const flat = project([...box(360, 240), wall(0, 60, 360, 200, 'interior')]);
  assert.deepEqual(partitionStrings(flat, 'centre', ends).map((x) => x.axis), ['y']);
});

test('inside strings move along their stretch to keep clear of room labels', () => {
  const walls = [...box(360, 240), wall(120, 0, 120, 120, 'interior'), wall(180, 120, 180, 240, 'interior'), wall(240, 0, 240, 240, 'interior')];
  const p = project(walls);
  // A label sitting on the line a third of the way down the lower stretch (y = 160).
  const label = { x0: 20, x1: 100, y0: 150, y1: 170 };
  const at = (keepout = [label]) => partitionStrings(p, 'centre', ends, { keepout, band: [20, 4] }).map((s) => s.at);
  assert.deepEqual(at([]), [40, 160]);
  // Two-thirds down (200) is clear: it goes there; the upper string doesn't move.
  assert.deepEqual(at(), [40, 200]);
  // A label off the string's run (beyond its ends) doesn't count.
  assert.deepEqual(at([{ x0: 400, x1: 500, y0: 150, y1: 170 }]), [40, 160]);
});

test('running strings label each tick with the total so far, skipping crowded ones but never the end', () => {
  assert.deepEqual(runningLabels([0, 120, 240, 360], 12), [120, 240, 360]);
  assert.deepEqual(runningLabels([0, 117.75, 122.25, 240], 12), [117.75, 240]);
  // Crowded at the end: the end wins.
  assert.deepEqual(runningLabels([0, 100, 355, 360], 12), [100, 360]);
  let p = project(box(240, 144));
  p = projectReducer(p, { type: 'setDimStyle', style: 'running' });
  assert.equal(p.dimStyle, 'running');
  assert.equal(projectReducer(p, { type: 'setDimStyle', style: 'chain' }).dimStyle, undefined);
});

test('a placed dimension snapped to wall ends follows them when the walls move', () => {
  const base = project(box(240, 144));
  // From the top-left corner's outside face corner to the top-right centreline corner.
  const a = { x: -3.25, y: -3.25 };
  const b = { x: 240, y: 0 };
  const aAt = anchorFor(base, a)!;
  const bAt = anchorFor(base, b)!;
  assert.ok(aAt && bAt);
  assert.equal(anchorFor(base, { x: 120, y: 72 }), undefined);
  let h = initHistory(projectReducer(base, { type: 'addDim', dim: { id: 'dm_1', a, b, aAt, bAt }, offset: 12 }));
  // Drag the right wall 2' out: the top wall stretches, b goes with its end, a stays.
  const right = base.walls[1];
  h = historyReducer(h, { type: 'translatePoints', from: [right.a, right.b], delta: { x: 24, y: 0 } });
  const d = h.present.dims![0];
  assert.ok(near([d.a.x, d.a.y, d.b.x, d.b.y], [-3.25, -3.25, 264, 0]));
  // Delete the wall a was pinned to: a stays where it was and lets go.
  const gone = historyReducer(h, { type: 'delete', ids: [aAt.wallId] }).present.dims![0];
  assert.ok(near([gone.a.x, gone.a.y], [-3.25, -3.25]));
  assert.equal(gone.aAt, undefined);
});
