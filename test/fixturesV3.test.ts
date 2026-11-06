import assert from 'node:assert/strict';
import { test } from 'node:test';
import { doorSwingChecks, fixtureSchedule, furnitureChecks, furnitureLines, newFurniture, spacingChecks } from '../src/calc/furniture.ts';
import { buildScene } from '../src/calc/model3d.ts';
import { estimate } from '../src/calc/pricing.ts';
import { historyReducer, initHistory, projectReducer } from '../src/model/store.ts';
import type { FurnitureKind, Point, Project } from '../src/model/types.ts';
import { box, door, project } from './helpers.ts';

const rect = (w: number, h: number): Point[] => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];

function bath(w: number, h: number, items: [FurnitureKind, Point][] = []): Project {
  let p = project(box(w, h, 'interior'), [], { rooms: [{ id: 'R', name: 'Bath', type: 'bath', points: rect(w, h) }] });
  items.forEach(([kind, at], i) => {
    p = projectReducer(p, { type: 'addFurniture', item: newFurniture(p, kind, at, `f${i}`) });
  });
  return p;
}

test('two door swings that overlap warn on each door; swung apart they clear', () => {
  // Doors in the top and left walls, both swinging in, hinged at the shared corner.
  const p = bath(120, 120);
  const [top, , , left] = p.walls;
  const a = { ...door(top.id, 24), id: 'da', swing: { side: -1 as const, hinge: 'a' as const } };
  const b = { ...door(left.id, 96), id: 'db', swing: { side: -1 as const, hinge: 'b' as const } };
  const both = { ...p, openings: [a, b] };
  const warn = doorSwingChecks(both);
  assert.deepEqual(warn.map((c) => [c.targetId, c.status]), [['da', 'warn'], ['db', 'warn']]);
  assert.match(warn[0].message, new RegExp(`swings into the 3' 0" door on ${left.id}'s swing`));
  // The left door swinging out of the room: clear.
  const out = { ...p, openings: [a, { ...b, swing: { side: 1 as const, hinge: 'b' as const } }] };
  assert.deepEqual(doorSwingChecks(out).map((c) => c.status), ['pass']);
});

test('a tub needs 21" clear in front (R307.1)', () => {
  // A 5' tub along the top wall of a 5' × 4' room: 4' - 6-1/2" … plenty in front.
  const ok = bath(66, 72, [['tub', { x: 33, y: 20 }]]);
  assert.equal(furnitureChecks(ok).find((c) => c.rule === 'Fixture clearances (bathtub)')!.status, 'pass');
  // A 3'-4" deep room: 30" tub leaves under 21".
  const tight = bath(66, 48, [['tub', { x: 33, y: 20 }]]);
  const c = furnitureChecks(tight).find((x) => x.rule === 'Fixture clearances (bathtub)')!;
  assert.deepEqual([c.status, c.message], ['fail', 'Bath: bathtub needs 21" clear in front']);
});

test('water closet and bidet want 30" centre to centre (R307.1)', () => {
  const close = bath(144, 96, [['toilet', { x: 40, y: 10 }], ['bidet', { x: 66, y: 10 }]]);
  const [c] = spacingChecks(close);
  assert.equal(c.status, 'fail');
  assert.equal(c.message, 'Bath: toilet and bidet centres 2\' 2-1/16" apart — wants 2\' 6"');
  assert.ok(furnitureChecks(close).some((x) => x.rule.startsWith('Fixture spacing') && x.status === 'fail'));
  const apart = bath(144, 96, [['toilet', { x: 40, y: 10 }], ['bidet', { x: 72, y: 10 }]]);
  assert.deepEqual(spacingChecks(apart).map((x) => x.status), ['pass']);
  // One alone: nothing to space.
  assert.deepEqual(spacingChecks(bath(144, 96, [['toilet', { x: 40, y: 10 }]])), []);
});

test('a fixture on a wall that was split follows the piece it sits on', () => {
  const p = bath(240, 144, [['toilet', { x: 180, y: 20 }]]);
  const t = p.walls[0].thickness;
  let h = initHistory(p);
  h = historyReducer(h, { type: 'splitWall', id: p.walls[0].id, at: 120, newId: 'wn' });
  assert.deepEqual(h.present.furniture[0].at, p.furniture[0].at);
  const piece = h.present.walls.find((w) => w.id === 'wn')!;
  h = historyReducer(h, { type: 'translatePoints', from: [piece.a, piece.b], delta: { x: 0, y: -24 } });
  assert.deepEqual(h.present.furniture[0].at, { x: 180, y: -24 + t / 2 + 14 });
});

test('the schedule splits rows by model and carries rough-in notes', () => {
  let p = bath(240, 144, [['toilet', { x: 30, y: 10 }], ['toilet', { x: 120, y: 10 }], ['toilet', { x: 200, y: 10 }]]);
  p = projectReducer(p, { type: 'updateFurniture', id: 'f0', patch: { model: 'Acme 100', note: '12" rough-in' } });
  p = projectReducer(p, { type: 'updateFurniture', id: 'f1', patch: { model: 'Acme 100', note: '10" rough-in' } });
  const rows = fixtureSchedule(p);
  assert.deepEqual(rows.map((r) => [r.mark, r.model, r.qty, r.notes]), [
    ['WC-1', 'Acme 100', 2, '12" rough-in; 10" rough-in'],
    ['WC-2', '', 1, ''],
  ]);
});

test('closet rod + shelf: priced by the foot, a shelf in 3D, no door-swing clash, not scheduled', () => {
  const p = bath(120, 96, [['closet-rod', { x: 40, y: 8 }], ['closet-rod', { x: 90, y: 8 }]]);
  const rod = p.furniture[0];
  assert.deepEqual([rod.w, rod.d], [48, 12]);
  const line = furnitureLines(p).find((l) => l.item === 'Closet rod + shelf (allowance)')!;
  assert.deepEqual([line.qty, line.unit], [8, 'lf']);
  assert.ok(estimate([line]).lines.every((l) => l.unitPrice > 0));
  assert.deepEqual(buildScene(p).boxes.filter((b) => b.kind === 'furniture').map((b) => [b.c[1], b.size[1]]), [[66, 0.75], [66, 0.75]]);
  assert.deepEqual(fixtureSchedule(p), []);
  const swung = { ...p, openings: [{ ...door(p.walls[0].id, 40), swing: { side: -1 as const, hinge: 'a' as const } }] };
  assert.deepEqual(doorSwingChecks(swung).map((c) => c.status), ['pass']);
});
