import assert from 'node:assert/strict';
import { test } from 'node:test';
import { counterRoom, counterSpaces, islandReceptacles, newCounter } from '../src/calc/counters.ts';
import { autoOutlets, counterGaps, spacingGaps } from '../src/calc/electrical.ts';
import { ircChecks } from '../src/calc/irc.ts';
import { materialsList } from '../src/calc/materials.ts';
import { buildScene } from '../src/calc/model3d.ts';
import { projectReducer } from '../src/model/store.ts';
import type { Counter, Project } from '../src/model/types.ts';
import { box, project } from './helpers.ts';

/** A 20' × 12' kitchen with a 14' counter along the top wall (sink in the middle) and a 6' × 3' island. */
function kitchen(): { p: Project; counter: Counter; island: Counter } {
  const walls = box(240, 144);
  let p = project(walls, [], {
    rooms: [{ id: 'K', name: 'Kitchen', type: 'kitchen', points: [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 144 }, { x: 0, y: 144 }] }],
  });
  // Drag from just inside the top wall, x 24 → 192.
  const counter = newCounter(p, { x: 24, y: 10 }, { x: 192, y: 10 }, 'c1');
  counter.cutouts = [{ id: 's', kind: 'sink', offset: 84, width: 33 }];
  const island = newCounter(p, { x: 84, y: 84 }, { x: 156, y: 120 }, 'i1');
  p = projectReducer(projectReducer(p, { type: 'addCounter', counter }), { type: 'addCounter', counter: island });
  return { p, counter, island };
}

test('a drag beside a wall makes a counter on its face; open floor makes an island', () => {
  const { p, counter, island } = kitchen();
  assert.equal(counter.island, false);
  assert.equal(counter.a.y, p.walls[0].thickness / 2);
  assert.deepEqual([counter.a.x, counter.b.x], [24, 192]);
  assert.equal(counter.depth, 25);
  assert.equal(counterRoom(p, counter)?.id, 'K');
  assert.equal(island.island, true);
  assert.deepEqual([island.a, island.b, island.depth], [{ x: 84, y: 84 }, { x: 156, y: 84 }, 36]);
  // A plain click by a wall gives a 6 ft run.
  const click = newCounter(p, { x: 230, y: 40 }, { x: 230, y: 40 }, 'c2');
  assert.equal(Math.abs(click.b.y - click.a.y), 72);
});

test('the sink splits the counter into two countertop spaces', () => {
  const { counter } = kitchen();
  assert.deepEqual(counterSpaces(counter), [[0, 67.5], [100.5, 168]]);
});

test('auto outlets: GFCIs follow the counter spaces, general spacing elsewhere', () => {
  let { p } = kitchen();
  const outlets = autoOutlets(p);
  p = projectReducer(p, { type: 'replaceAutoOutlets', outlets });
  const top = p.walls[0];
  const onTop = p.outlets.filter((o) => o.wallId === top.id);
  // Two counter spaces of 67.5" each need two receptacles apiece (≤ 48" apart).
  assert.equal(onTop.filter((o) => o.height === 44).length, 4);
  // Off the counter: 24" at the left end and 48" at the right are wall space, at outlet height; so are the other walls.
  assert.equal(onTop.filter((o) => o.height === 16).length, 2);
  assert.ok(p.outlets.some((o) => o.height === 16 && o.wallId !== top.id));
  assert.ok(p.outlets.every((o) => o.kind === 'gfci'));
  const c = counterGaps(p, p.rooms[0]);
  assert.equal(c.spaces, 2);
  assert.ok(!c.uncovered && c.worst <= 48, JSON.stringify(c));
  assert.ok(!spacingGaps(p, p.rooms[0]).uncovered);
  const checks = ircChecks(p);
  assert.equal(checks.find((x) => x.section === 'E3901.4' && x.rule.startsWith('Countertop'))!.status, 'pass');
  assert.equal(checks.find((x) => x.section === 'R306.2')!.status, 'pass');
  assert.equal(checks.find((x) => x.rule === 'Island receptacle')!.status, 'info');
});

test('a bare countertop space fails; no sink fails R306.2', () => {
  let { p, counter } = kitchen();
  p = projectReducer(p, { type: 'updateCounter', id: counter.id, patch: { cutouts: [] } });
  const checks = ircChecks(p);
  assert.equal(checks.find((x) => x.section === 'R306.2')!.status, 'fail');
  // An outlet only at the far end of the 14 ft counter leaves the rest more than 24" away.
  const top = p.walls[0];
  p = { ...p, outlets: [{ id: 'o', wallId: top.id, offset: 180, side: -1, kind: 'gfci', height: 44, auto: false }] };
  const g = counterGaps(p, p.rooms[0]);
  assert.ok(g.worst > 48 || g.uncovered, JSON.stringify(g));
});

test('islands get receptacles in the estimate; counters price and show in 3D', () => {
  const { p } = kitchen();
  assert.equal(islandReceptacles(p).length, 1);
  const lines = materialsList(p);
  const qty = (item: string) => lines.find((l) => l.item === item)?.qty ?? 0;
  assert.equal(qty('20A GFCI receptacle (TR)'), 1);
  assert.equal(qty('Base cabinets (allowance)'), 20); // 14 ft + 6 ft
  assert.equal(qty('Kitchen sink + faucet (allowance)'), 1);
  assert.equal(qty('Countertop (allowance)'), Math.ceil((168 * 25 + 72 * 36) / 144));
  assert.equal(buildScene(p).boxes.filter((b) => b.kind === 'counter').length, 2);
});

test('cutouts stay inside the counter, and deleting a counter removes it', () => {
  let { p, counter } = kitchen();
  p = projectReducer(p, { type: 'updateCounter', id: counter.id, patch: { cutouts: [{ id: 's', kind: 'sink', offset: 400, width: 33 }] } });
  assert.equal(p.counters[0].cutouts[0].offset, 168 - 16.5);
  p = projectReducer(p, { type: 'delete', ids: [counter.id] });
  assert.deepEqual(p.counters.map((c) => c.id), ['i1']);
});

test('a wall counter rides along when its wall is dragged, stretched or thickened', () => {
  let { p, counter } = kitchen();
  const top = p.walls[0]; // (0,0) → (240,0); the counter hangs below it
  // Drag the top wall down 12": the counter follows, the island stays.
  p = projectReducer(p, { type: 'translatePoints', from: [top.a, top.b], delta: { x: 0, y: 12 } });
  const c = p.counters.find((x) => x.id === counter.id)!;
  assert.deepEqual([c.a, c.b], [{ x: 24, y: 12 + top.thickness / 2 }, { x: 192, y: 12 + top.thickness / 2 }]);
  assert.deepEqual(p.counters.find((x) => x.island)!.a, { x: 84, y: 84 });
  // Shorten the wall to 10 ft: the counter is cut back to the new end.
  p = projectReducer(p, { type: 'setWallLength', id: top.id, length: 120 });
  assert.equal(p.counters.find((x) => x.id === counter.id)!.b.x, 120);
  // Thicker wall: the back edge moves to the new face.
  p = projectReducer(p, { type: 'updateWall', id: top.id, patch: { thickness: 10 } });
  assert.equal(p.counters.find((x) => x.id === counter.id)!.a.y, 17);
});

test('dishwashers stay under the countertop; fridges cut it and price separately', () => {
  let { p, counter } = kitchen();
  p = projectReducer(p, {
    type: 'updateCounter',
    id: counter.id,
    patch: { cutouts: [...counter.cutouts, { id: 'dw', kind: 'dishwasher', offset: 112.5, width: 24 }, { id: 'f', kind: 'fridge', offset: 150, width: 36 }] },
  });
  const c = p.counters.find((x) => x.id === counter.id)!;
  // Sink 67.5–100.5 and fridge 132–168 cut; the dishwasher (100.5–124.5) doesn't.
  assert.deepEqual(counterSpaces(c), [[0, 67.5], [100.5, 132]]);
  const lines = materialsList(p);
  const qty = (item: string) => lines.find((l) => l.item === item)?.qty ?? 0;
  assert.equal(qty('Base cabinets (allowance)'), Math.ceil(((168 - 60 + 72) / 12) * 2) / 2);
  assert.equal(qty('Dishwasher (allowance)'), 1);
  assert.equal(qty('Refrigerator (allowance)'), 1);
  assert.equal(buildScene(p).boxes.filter((b) => b.kind === 'counter').length, 3);
});
