import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bifoldDepth, doorSweeps, doorSwing, doorSwingChecks, fixtureSchedule, furnitureChecks, furnitureLines, newFurniture, pocketChecks, pocketSpan } from '../src/calc/furniture.ts';
import { materialsList } from '../src/calc/materials.ts';
import { buildScene } from '../src/calc/model3d.ts';
import { estimate } from '../src/calc/pricing.ts';
import { projectReducer } from '../src/model/store.ts';
import type { FurnitureKind, Opening, Point, Project } from '../src/model/types.ts';
import { box, door, project } from './helpers.ts';

const rect = (w: number, h: number): Point[] => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];

function bath(w: number, h: number, items: [FurnitureKind, Point][] = []): Project {
  let p = project(box(w, h, 'interior'), [], { rooms: [{ id: 'R', name: 'Bath', type: 'bath', points: rect(w, h) }] });
  items.forEach(([kind, at], i) => {
    p = projectReducer(p, { type: 'addFurniture', item: newFurniture(p, kind, at, `f${i}`) });
  });
  return p;
}

test('a door standing open in a fixture’s clear space warns, not just one hitting the fixture', () => {
  // 7' × 8' bath, toilet against the left wall; a door in the top wall swinging in near it.
  const p = bath(84, 96, [['toilet', { x: 10, y: 38 }]]);
  const toilet = p.furniture[0];
  assert.equal(toilet.rot, 270);
  // The toilet's front clear space runs 21" out from its bowl (x ≈ 30 … 51, y 28 … 48); a 36" door hinged at x = 66 swings over its corner.
  const d: Opening = { ...door(p.walls[0].id, 48, 36), swing: { side: -1, hinge: 'b' } };
  const [c] = doorSwingChecks({ ...p, openings: [d] });
  assert.equal(c.status, 'warn');
  assert.match(c.message, /swings into the toilet's clear space \(21" clear in front, R307\.1\)/);
  // Not the body itself (that would be named on its own).
  assert.doesNotMatch(c.message, /swings into the toilet and/);
  // Swinging out of the bath instead: clear.
  const away = { ...d, swing: { side: 1 as const, hinge: 'b' as const } };
  assert.deepEqual(doorSwingChecks({ ...p, openings: [away] }).map((x) => x.status), ['pass']);
});

test('door operations: a pair sweeps two half circles, a bifold a strip, a pocket nothing', () => {
  const p = bath(144, 120);
  const base: Opening = { ...door(p.walls[0].id, 72, 60), swing: { side: -1, hinge: 'a' } };
  const pair = doorSweeps(p, { ...base, operation: 'double' });
  assert.equal(pair.length, 2);
  // Each leaf 30": every arc point 30" from its hinge (on the face, 2.25" in).
  assert.ok(pair.every((s) => s.slice(1).every((q) => Math.abs(Math.hypot(q.x - s[0].x, q.y - s[0].y) - 30) < 1e-9)));
  assert.deepEqual(pair.map((s) => s[0]), [{ x: 42, y: 2.25 }, { x: 102, y: 2.25 }]);
  const [strip] = doorSweeps(p, { ...base, operation: 'bifold' });
  // 60" bifold: two panels a side, 15" deep.
  assert.equal(bifoldDepth(60), 15);
  assert.equal(bifoldDepth(30), 15);
  assert.deepEqual(strip.map((q) => q.y), [2.25, 2.25, 17.25, 17.25]);
  assert.deepEqual(doorSweeps(p, { ...base, operation: 'pocket' }), []);
  // doorSwing is the single leaf only.
  assert.equal(doorSwing(p, { ...base, operation: 'double' }), null);
  assert.equal(doorSwing(p, base)!.length, 10);
  // A pocket door clears a toilet a hinged one would hit.
  const tight = bath(84, 96, [['toilet', { x: 10, y: 38 }]]);
  const d: Opening = { ...door(tight.walls[0].id, 48, 36), swing: { side: -1, hinge: 'b' } };
  assert.equal(doorSwingChecks({ ...tight, openings: [d] })[0].status, 'warn');
  assert.equal(doorSwingChecks({ ...tight, openings: [{ ...d, operation: 'pocket' }] }).length, 0);
});

test('a pocket needs clear wall: not past the wall end, nor over another opening, receptacle or switch', () => {
  const p = bath(144, 120);
  const top = p.walls[0];
  const pocket: Opening = { ...door(top.id, 90, 30), swing: { side: -1, hinge: 'a' }, operation: 'pocket' };
  assert.deepEqual(pocketSpan(pocket), [45, 75]);
  assert.deepEqual(pocketSpan({ ...pocket, swing: { side: -1, hinge: 'b' } }), [105, 135]);
  assert.deepEqual(pocketChecks({ ...p, openings: [pocket] }).map((c) => c.status), ['pass']);
  const crowded = {
    ...p,
    openings: [pocket, { ...door(top.id, 40, 24), id: 'other' }],
    outlets: [{ id: 'o', wallId: top.id, offset: 60, side: -1 as const, kind: 'duplex' as const, height: 16, auto: false }],
  };
  const [c] = pocketChecks(crowded);
  assert.equal(c.status, 'warn');
  assert.match(c.message, /pocket runs into a door and a receptacle/);
  // Too near the wall's start for the pocket.
  assert.match(pocketChecks({ ...p, openings: [{ ...pocket, offset: 30 }] })[0].message, /the wall’s end/);
  // Priced: a frame kit per pocket door, hardware per bifold.
  const lines = materialsList({ ...p, openings: [pocket, { ...door(p.walls[2].id, 72, 48), id: 'bf', operation: 'bifold' }] }).filter((l) => /Pocket|Bifold/.test(l.item));
  assert.deepEqual(lines.map((l) => [l.item, l.qty]), [['Pocket door frame kit (allowance)', 1], ['Bifold door hardware (allowance)', 1]]);
  assert.ok(estimate(lines).lines.every((l) => l.unitPrice > 0));
});

test('a tub / shower combo counts as the tub or shower, wants 21" in front, and is TS on the schedule', () => {
  const p = bath(120, 120, [['toilet', { x: 90, y: 10 }], ['lavatory', { x: 10, y: 80 }], ['tub-shower', { x: 33, y: 16 }]]);
  const checks = furnitureChecks(p);
  assert.equal(checks.find((c) => c.section === 'R306.1')!.status, 'pass');
  assert.equal(checks.find((c) => c.rule === 'Fixture clearances (tub / shower combo)')!.status, 'pass');
  assert.ok(!checks.some((c) => c.section === 'P2708.1'));
  assert.deepEqual(fixtureSchedule(p).map((r) => r.mark), ['WC-1', 'LAV-1', 'TS-1']);
  const lines = furnitureLines(p);
  assert.equal(lines.find((l) => l.item.startsWith('Tub / shower combo'))!.qty, 1);
  assert.equal(lines.find((l) => l.item.startsWith('Plumbing rough-in'))!.qty, 3);
  assert.ok(estimate(lines).lines.every((l) => l.unitPrice > 0));
});

test('closets: a double hang prices two runs and two shelves in 3D; a shelf alone prices as a shelf', () => {
  let p = bath(144, 96, [['closet-rod', { x: 40, y: 8 }], ['closet-rod', { x: 100, y: 8 }]]);
  p = projectReducer(p, { type: 'updateFurniture', id: 'f0', patch: { closet: 'double' } });
  p = projectReducer(p, { type: 'updateFurniture', id: 'f1', patch: { closet: 'shelf' } });
  const qty = (item: string) => furnitureLines(p).find((l) => l.item === item)?.qty;
  assert.equal(qty('Closet rod + shelf (allowance)'), 8);
  assert.equal(qty('Closet shelf (allowance)'), 4);
  assert.ok(estimate(furnitureLines(p)).lines.every((l) => l.unitPrice > 0));
  assert.deepEqual(buildScene(p).boxes.filter((b) => b.kind === 'furniture').map((b) => b.c[1]), [84, 42, 66]);
});

test('the schedule by room: a section per room in name order, a row never spans rooms', () => {
  const walls = [...box(240, 120, 'interior')];
  let p = project(walls, [], {
    rooms: [
      { id: 'B', name: 'Primary bath', type: 'bath', points: [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 120 }, { x: 0, y: 120 }] },
      { id: 'A', name: 'Hall bath', type: 'bath', points: [{ x: 120, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 120 }, { x: 120, y: 120 }] },
    ],
  });
  const add = (kind: FurnitureKind, at: Point, id: string) => (p = projectReducer(p, { type: 'addFurniture', item: newFurniture(p, kind, at, id) }));
  add('toilet', { x: 30, y: 10 }, 't1');
  add('lavatory', { x: 80, y: 10 }, 'l1');
  add('toilet', { x: 200, y: 10 }, 't2');
  assert.deepEqual(fixtureSchedule(p).map((r) => [r.mark, r.qty, r.rooms]), [
    ['WC-1', 2, 'Primary bath, Hall bath'],
    ['LAV-1', 1, 'Primary bath'],
  ]);
  p = projectReducer(p, { type: 'setScheduleBy', by: 'room' });
  assert.deepEqual(fixtureSchedule(p).map((r) => [r.mark, r.qty, r.rooms]), [
    ['WC-1', 1, 'Hall bath'],
    ['WC-2', 1, 'Primary bath'],
    ['LAV-1', 1, 'Primary bath'],
  ]);
  assert.equal(projectReducer(p, { type: 'setScheduleBy', by: 'kind' }).scheduleBy, undefined);
});
