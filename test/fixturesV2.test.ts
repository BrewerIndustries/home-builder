import assert from 'node:assert/strict';
import { test } from 'node:test';
import { doorSwing, doorSwingChecks, fixtureSchedule, furnitureChecks, furnitureLines, newFurniture } from '../src/calc/furniture.ts';
import { ircChecks } from '../src/calc/irc.ts';
import { workTriangle } from '../src/calc/kitchen.ts';
import { estimate } from '../src/calc/pricing.ts';
import { historyReducer, initHistory, projectReducer } from '../src/model/store.ts';
import type { FurnitureKind, Point, Project, RoomType } from '../src/model/types.ts';
import { box, door, project } from './helpers.ts';

const rect = (w: number, h: number): Point[] => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];

/** A w × h room of one type with items dropped at points (each backs onto the nearest wall). */
function room(w: number, h: number, type: RoomType, items: [FurnitureKind, Point][] = []): Project {
  let p = project(box(w, h, 'interior'), [], { rooms: [{ id: 'R', name: type === 'bath' ? 'Bath' : 'Kitchen', type, points: rect(w, h) }] });
  items.forEach(([kind, at], i) => {
    p = projectReducer(p, { type: 'addFurniture', item: newFurniture(p, kind, at, `f${i}`) });
  });
  return p;
}

test('fixtures backed onto a wall ride along when it moves; free-standing ones stay', () => {
  let p = room(240, 144, 'bath', [['toilet', { x: 60, y: 20 }], ['bed', { x: 120, y: 72 }]]);
  const t = p.walls[0].thickness;
  const [toilet, bed] = p.furniture;
  assert.deepEqual(toilet.at, { x: 60, y: t / 2 + 14 });
  // Drag the top wall up 2'.
  p = projectReducer(p, { type: 'translatePoints', from: [p.walls[0].a, p.walls[0].b], delta: { x: 0, y: -24 } });
  assert.deepEqual(p.furniture[0].at, { x: 60, y: -24 + t / 2 + 14 });
  assert.equal(p.furniture[0].rot, toilet.rot);
  assert.deepEqual(p.furniture[1], bed);
  // Turn the top wall (move one end): the toilet turns with it and stays on the face.
  const w = p.walls[0];
  p = projectReducer(p, { type: 'moveVertex', from: w.b, to: { x: w.b.x, y: w.b.y + 60 } });
  const f = p.furniture[0];
  assert.notEqual(f.rot, 0);
  const moved = p.walls[0];
  const nx = -(moved.b.y - moved.a.y);
  const ny = moved.b.x - moved.a.x;
  const len = Math.hypot(nx, ny);
  // Centre sits half a wall + half the toilet's depth off the centreline.
  const off = Math.abs(((f.at.x - moved.a.x) * nx + (f.at.y - moved.a.y) * ny) / len);
  assert.ok(Math.abs(off - (t / 2 + 14)) < 0.01);
});

test('the history reducer carries fixtures too (the path the canvas uses)', () => {
  const p = room(240, 144, 'bath', [['lavatory', { x: 200, y: 20 }]]);
  const t = p.walls[0].thickness;
  const h = historyReducer(initHistory(p), { type: 'translatePoints', from: [p.walls[0].a, p.walls[0].b], delta: { x: 0, y: 12 } });
  assert.deepEqual(h.present.furniture[0].at, { x: 200, y: 12 + t / 2 + 10.5 });
});

test('a door swinging into a fixture warns; flipping the swing clears it', () => {
  const base = room(120, 120, 'bath', [['toilet', { x: 60, y: 20 }]]);
  const into = { ...door(base.walls[0].id, 60), swing: { side: -1 as const, hinge: 'a' as const } };
  const p = { ...base, openings: [into] };
  const arc = doorSwing(p, into)!;
  // Quarter circle: hinge plus nine points round the arc, all 36" from the hinge.
  assert.equal(arc.length, 10);
  assert.ok(arc.slice(1).every((q) => Math.abs(Math.hypot(q.x - arc[0].x, q.y - arc[0].y) - 36) < 1e-9));
  const [c] = doorSwingChecks(p);
  assert.equal(c.status, 'warn');
  assert.match(c.message, /swings into the toilet/);
  assert.equal(c.targetId, into.id);
  // Swinging out of the room instead: clear.
  const out = { ...p, openings: [{ ...into, swing: { side: 1 as const, hinge: 'a' as const } }] };
  assert.deepEqual(doorSwingChecks(out).map((x) => x.status), ['pass']);
  // Windows and garage doors don't swing.
  assert.equal(doorSwing(p, { ...into, kind: 'window' }), null);
  assert.equal(doorSwing(p, { ...into, width: 96 }), null);
  // It reaches the report through the fixture checks.
  assert.ok(furnitureChecks(p).some((x) => x.rule === 'Door swing clear' && x.status === 'warn'));
});

test('a free-standing sink, range and fridge count for R306.2 and the work triangle', () => {
  const none = room(144, 144, 'kitchen');
  assert.equal(ircChecks(none).find((c) => c.rule === 'Kitchen sink')!.status, 'info');
  const p = room(144, 144, 'kitchen', [['kitchen-sink', { x: 72, y: 15 }], ['range', { x: 15, y: 72 }], ['fridge', { x: 129, y: 72 }]]);
  assert.equal(ircChecks(p).find((c) => c.rule === 'Kitchen sink')!.status, 'pass');
  const tri = workTriangle(p, 'R')!;
  assert.deepEqual(tri.sink, p.furniture[0].at);
  assert.equal(tri.legs.length, 3);
});

test('a bidet gets the toilet clearances; new fixtures price and rough in', () => {
  const tight = room(60, 96, 'bath', [['bidet', { x: 10, y: 10 }]]);
  const c = furnitureChecks(tight).find((x) => x.rule === 'Fixture clearances (bidet)')!;
  assert.equal(c.status, 'fail');
  assert.match(c.message, /15" from its centre/);
  const p = room(240, 144, 'bath', [['bidet', { x: 40, y: 10 }], ['laundry-sink', { x: 120, y: 10 }], ['kitchen-sink', { x: 200, y: 10 }], ['range', { x: 10, y: 72 }], ['fridge', { x: 230, y: 72 }]]);
  const lines = furnitureLines(p);
  assert.deepEqual(lines.map((l) => [l.item, l.qty]), [
    ['Bidet (allowance)', 1],
    ['Kitchen sink + faucet (allowance)', 1],
    ['Laundry sink + faucet (allowance)', 1],
    ['Range (allowance)', 1],
    ['Refrigerator (allowance)', 1],
    ['Plumbing rough-in per fixture (allowance)', 3],
  ]);
  assert.ok(estimate(lines).lines.every((l) => l.unitPrice > 0));
});

test('the fixture schedule tags each kind and size, with a count and its rooms', () => {
  let p = room(240, 144, 'bath', [['toilet', { x: 30, y: 10 }], ['toilet', { x: 200, y: 10 }], ['lavatory', { x: 120, y: 10 }], ['bed', { x: 120, y: 72 }]]);
  p = projectReducer(p, { type: 'updateFurniture', id: 'f1', patch: { w: 18 } });
  const rows = fixtureSchedule(p);
  assert.deepEqual(rows.map((r) => [r.mark, r.item, r.qty, r.rooms]), [
    ['WC-1', 'Toilet', 1, 'Bath'],
    ['WC-2', 'Toilet', 1, 'Bath'],
    ['LAV-1', 'Vanity + basin', 1, 'Bath'],
  ]);
  assert.equal(rows[1].size, '1\' 6" × 2\' 4"');
  // Same size → one row, two tags.
  const same = fixtureSchedule(room(240, 144, 'bath', [['toilet', { x: 30, y: 10 }], ['toilet', { x: 200, y: 10 }]]));
  assert.deepEqual([same.length, same[0].qty, same[0].at.length], [1, 2, 2]);
  // Furniture isn't scheduled.
  assert.deepEqual(fixtureSchedule(room(120, 120, 'bedroom', [['bed', { x: 60, y: 60 }]])), []);
});
