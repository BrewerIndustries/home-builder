import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autoOutlets } from '../src/calc/electrical.ts';
import { basinReach, furnitureChecks, furnitureCorners, newFurniture, onFurniture, placeFurniture } from '../src/calc/furniture.ts';
import { ircChecks } from '../src/calc/irc.ts';
import { materialsList } from '../src/calc/materials.ts';
import { buildScene } from '../src/calc/model3d.ts';
import { estimate } from '../src/calc/pricing.ts';
import { migrate, projectReducer } from '../src/model/store.ts';
import type { Furniture, FurnitureKind, Point, Project } from '../src/model/types.ts';
import { box, project } from './helpers.ts';

const rect = (w: number, h: number): Point[] => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];

/** A w × h bathroom (interior walls) with the given fixtures dropped at points. */
function bath(w: number, h: number, items: [FurnitureKind, Point][] = []): Project {
  let p = project(box(w, h, 'interior'), [], { rooms: [{ id: 'B', name: 'Bath', type: 'bath', points: rect(w, h) }] });
  items.forEach(([kind, at], i) => {
    p = projectReducer(p, { type: 'addFurniture', item: newFurniture(p, kind, at, `f${i}`) });
  });
  return p;
}
const find = (p: Project, rule: string) => furnitureChecks(p).filter((c) => c.rule.startsWith(rule));

test('placed near a wall, the back goes flat against its face, facing into the room', () => {
  const p = project(box(240, 144));
  const t = p.walls[0].thickness;
  const top = newFurniture(p, 'toilet', { x: 60, y: 20 }, 't');
  assert.deepEqual([top.at, top.rot], [{ x: 60, y: t / 2 + 14 }, 0]);
  // Left wall: turned to face +x.
  const left = newFurniture(p, 'bed', { x: 30, y: 72 }, 'b');
  assert.deepEqual([left.at, left.rot], [{ x: t / 2 + 40, y: 72 }, 270]);
  // Its back (local −y) is on the wall face.
  assert.ok(furnitureCorners(left).filter((c) => Math.abs(c.x - t / 2) < 1e-9).length === 2);
  // Open floor: stays where it was dropped, unturned.
  const free = newFurniture(p, 'table', { x: 120, y: 72 }, 'tb');
  assert.deepEqual([free.at, free.rot], [{ x: 120, y: 72 }, 0]);
  // A turned item hit-tests in its own frame.
  assert.ok(onFurniture(left, { x: t / 2 + 75, y: 72 }));
  assert.ok(!onFurniture(left, { x: t / 2 + 10, y: 72 + 35 }));
  // Dragging it to the bottom wall re-seats it there.
  const moved = placeFurniture(p, top, { x: 60, y: 130 });
  assert.deepEqual([moved.at, moved.rot], [{ x: 60, y: 144 - t / 2 - 14 }, 180]);
});

test('R307.1: a toilet needs 15" each side of centre and 21" in front', () => {
  assert.deepEqual(find(bath(60, 96, [['toilet', { x: 30, y: 10 }]]), 'Fixture clearances').map((c) => c.status), ['pass']);
  // Shoved toward the side wall: its centre is under 15" from the face.
  const tight = find(bath(60, 96, [['toilet', { x: 12, y: 10 }]]), 'Fixture clearances')[0];
  assert.equal(tight.status, 'fail');
  assert.match(tight.message, /15" from its centre/);
  // A 4' deep closet leaves less than 21" in front.
  assert.match(find(bath(60, 48, [['toilet', { x: 30, y: 10 }]]), 'Fixture clearances')[0].message, /21" clear in front/);
  // A vanity right beside the toilet is in its side zone.
  const crowded = bath(96, 96, [['toilet', { x: 30, y: 10 }], ['lavatory', { x: 52, y: 10 }]]);
  assert.equal(find(crowded, 'Fixture clearances (toilet)')[0].status, 'fail');
});

test('P2708.1: a shower is 900 sq in and 30" each way', () => {
  const p = bath(96, 96, [['shower', { x: 30, y: 20 }]]);
  assert.equal(find(p, 'Shower size')[0].status, 'pass');
  const narrow = projectReducer(p, { type: 'updateFurniture', id: 'f0', patch: { w: 40, d: 27 } });
  assert.equal(find(narrow, 'Shower size')[0].status, 'fail');
});

test('R306.1: info until fixtures are drawn, then toilet + lavatory + tub or shower', () => {
  assert.equal(find(bath(96, 96), 'Required sanitary')[0].status, 'info');
  const some = find(bath(96, 96, [['toilet', { x: 30, y: 10 }]]), 'Required sanitary')[0];
  assert.equal(some.status, 'fail');
  assert.match(some.message, /a lavatory, a tub or shower/);
  const all = bath(120, 96, [['toilet', { x: 30, y: 10 }], ['lavatory', { x: 80, y: 10 }], ['tub', { x: 60, y: 86 }]]);
  assert.equal(find(all, 'Required sanitary')[0].status, 'pass');
});

test('E3901.6 measures the vanity once it is drawn; auto outlets put a GFCI over it', () => {
  let p = bath(96, 96, [['lavatory', { x: 60, y: 10 }]]);
  p = { ...p, outlets: [{ id: 'far', wallId: p.walls[2].id, offset: 90, side: p.walls[2].b.y > 0 ? -1 : 1, kind: 'gfci', height: 16, auto: false }] };
  const far = ircChecks(p).find((c) => c.rule.startsWith('Bathroom receptacle within 36'))!;
  assert.equal(far.status, 'fail');
  p = projectReducer({ ...p, outlets: [] }, { type: 'replaceAutoOutlets', outlets: autoOutlets(p) });
  assert.equal(p.outlets.length, 1);
  assert.deepEqual([p.outlets[0].kind, p.outlets[0].height, p.outlets[0].offset], ['gfci', 44, 60]);
  assert.equal(basinReach(p, p.furniture[0]), 0);
  const checks = ircChecks(p);
  assert.equal(checks.find((c) => c.rule.startsWith('Bathroom receptacle within 36'))!.status, 'pass');
  assert.equal(checks.find((c) => c.rule === 'Bathroom receptacles GFCI protected')!.status, 'pass');
  assert.ok(!checks.some((c) => c.rule === 'Bathroom GFCI receptacle near the basin'));
});

test('fixtures price in the estimate and stand up in 3D; furniture is drawn only', () => {
  const p = bath(120, 96, [['toilet', { x: 30, y: 10 }], ['lavatory', { x: 80, y: 10 }], ['tub', { x: 60, y: 86 }], ['bed', { x: 60, y: 48 }]]);
  const lines = materialsList(p).filter((l) => l.category === 'Plumbing');
  assert.deepEqual(lines.map((l) => [l.item, l.qty]), [
    ['Toilet (allowance)', 1],
    ['Vanity + lavatory faucet (allowance)', 1],
    ['Bathtub + valve (allowance)', 1],
    ['Plumbing rough-in per fixture (allowance)', 3],
  ]);
  assert.ok(estimate(lines).lines.every((l) => l.unitPrice > 0));
  const boxes = buildScene(p).boxes;
  assert.equal(boxes.filter((b) => b.kind === 'fixture').length, 3);
  assert.equal(boxes.filter((b) => b.kind === 'furniture').length, 1);
});

test('furniture saves, edits, deletes and loads into old projects', () => {
  const old = { ...project(box(120, 120)) } as Partial<Project>;
  delete old.furniture;
  assert.deepEqual(migrate(old as Project).furniture, []);
  const item: Furniture = { id: 'x', kind: 'sofa', at: { x: 60, y: 60 }, rot: 0, w: 84, d: 36 };
  let p = projectReducer(project(box(120, 120)), { type: 'addFurniture', item });
  p = projectReducer(p, { type: 'updateFurniture', id: 'x', patch: { rot: 90 } });
  assert.equal(p.furniture[0].rot, 90);
  p = projectReducer(p, { type: 'delete', ids: ['x'] });
  assert.equal(p.furniture.length, 0);
});
