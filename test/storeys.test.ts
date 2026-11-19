import assert from 'node:assert/strict';
import { test } from 'node:test';
import { floorOpenings, houseChecks, houseFloorArea, houseMaterials, houseScene, openingGuard, placeStairSwitches, roleView } from '../src/calc/house.ts';
import { ircChecks } from '../src/calc/irc.ts';
import { autoLighting, lightingChecks, lightingLines, switchWays } from '../src/calc/lighting.ts';
import { materialsList } from '../src/calc/materials.ts';
import { buildScene } from '../src/calc/model3d.ts';
import { floorToFloor, stairChecks } from '../src/calc/stairs.ts';
import { historyReducer, initHistory, projectReducer } from '../src/model/store.ts';
import { activeStoreyId, addStorey, isMultiStorey, removeStorey, storeyElevation, storeyHeight, storeyList, storeyOf, storeyView, switchStorey, updateStorey } from '../src/model/storeys.ts';
import { DEFAULT_ROOF, type Furniture, type Point, type Project } from '../src/model/types.ts';
import { box, project } from './helpers.ts';

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const living = (patch: Partial<Project> = {}) => project(box(240, 144), [], { rooms: [{ id: 'L', name: 'Living', type: 'living', points: rect(0, 0, 240, 144) }], roof: DEFAULT_ROOF, ...patch });
/** A 13-riser flight up along the top wall; its foot at x = 123.25, its top end at the left wall. */
const stair = (patch: Partial<Furniture> = {}): Furniture => ({ id: 'st', kind: 'stairs', at: { x: 63.25, y: 21.25 }, rot: 270, w: 36, d: 120, risers: 13, ...patch });
const lit = (p: Project) => {
  const { fixtures, switches } = autoLighting(p);
  return projectReducer(p, { type: 'replaceAutoLighting', fixtures, switches });
};

/** Ground floor with the stair, a second floor (a bedroom) over it. */
function twoStorey(st: Partial<Furniture> = {}): Project {
  let p = lit(living({ furniture: [stair(st)] }));
  p = addStorey(p, 1, 'up');
  p = { ...p, rooms: [{ id: 'B', name: 'Bed', type: 'bedroom', points: rect(0, 0, 240, 144) }] };
  return p;
}

test('a project without storeys is one ground floor and every whole-house calc is the plain one', () => {
  const p = lit(living({ furniture: [stair()] }));
  assert.equal(isMultiStorey(p), false);
  assert.deepEqual(storeyList(p).map((s) => s.level), [0]);
  assert.equal(roleView(p), p);
  assert.deepEqual(houseChecks(p), ircChecks(p));
  assert.deepEqual(houseMaterials(p), materialsList(p));
  assert.deepEqual(houseScene(p), buildScene(p));
  assert.equal(storeyElevation(p), 0);
});

test('adding a storey copies the outline, makes it active, and switching swaps the plans', () => {
  const g = living({ furniture: [stair()] });
  const p = addStorey(g, 1, 'up');
  assert.equal(activeStoreyId(p), 'up');
  assert.deepEqual(storeyList(p).map((s) => [s.name, s.level]), [['Ground floor', 0], ['Second floor', 1]]);
  assert.equal(p.walls.length, 4);
  assert.ok(p.walls.every((w) => !g.walls.some((x) => x.id === w.id)));
  assert.deepEqual([p.rooms, p.furniture], [[], []]);
  // The ground floor's plan is put away, and comes back unchanged.
  const back = switchStorey(p, 'ground');
  assert.deepEqual(back.walls, g.walls);
  assert.deepEqual(back.furniture, g.furniture);
  assert.equal(storeyView(p, 'ground').rooms[0].id, 'L');
  assert.equal(storeyOf(p, 'st'), 'ground');
  // A basement below starts empty and sits under the ground floor.
  const b = addStorey(back, -1, 'bsmt');
  assert.deepEqual(storeyList(b).map((s) => s.name), ['Basement', 'Ground floor', 'Second floor']);
  assert.equal(b.walls.length, 0);
  const h = storeyHeight(b);
  assert.equal(storeyElevation(b, 'up'), h);
  assert.equal(storeyElevation(b, 'bsmt'), -h);
  // Its own height moves the floors above it.
  const tall = updateStorey(b, 'ground', { height: 120 });
  assert.equal(storeyElevation(tall, 'up'), 120);
  assert.equal(storeyHeight(tall, storeyList(tall)[1]), 120);
  // Removing storeys down to one gives a plain project again.
  const one = removeStorey(removeStorey(b, 'bsmt'), 'up');
  assert.equal(one.storeys, undefined);
  assert.deepEqual(one.walls, g.walls);
});

test('storey switches go through the history as one undo step', () => {
  const h0 = initHistory(living());
  const h1 = historyReducer(h0, { type: 'storey', op: { op: 'add', dir: 1, id: 'up' } });
  assert.equal(activeStoreyId(h1.present), 'up');
  const h2 = historyReducer(h1, { type: 'storey', op: { op: 'switch', id: 'ground' } });
  assert.equal(h2.present.rooms[0].id, 'L');
  assert.equal(historyReducer(h2, { type: 'undo' }).present.rooms.length, 0);
});

test('a stair going up rises the storey height and leaves an opening in the floor above', () => {
  const p = twoStorey();
  const ground = storeyView(p, 'ground');
  assert.equal(floorToFloor(ground, ground.furniture[0]), storeyHeight(ground));
  assert.equal(floorToFloor(updateStorey(ground, 'ground', { height: 110 }), ground.furniture[0]), 110);
  const ops = floorOpenings(p, 'up');
  assert.equal(ops.length, 1);
  assert.equal(ops[0].from, 'ground');
  assert.equal(floorOpenings(p, 'ground').length, 0);
  // Headroom: the whole stair is open by default; a short opening fails.
  const head = (q: Project) => stairChecks(storeyView(q, 'ground')).find((c) => c.section === 'R311.7.2')!;
  assert.equal(head(p).status, 'pass');
  assert.match(head(p).message, /in the second floor runs 10' 0" back from the top/);
  const short = twoStorey({ floorOpening: 24 });
  assert.equal(head(short).status, 'fail');
  assert.match(head(short).message, /lengthen the opening/);
  // The open edges get a guard upstairs; the left end is against the wall.
  const upper = storeyView(p, 'up');
  assert.ok(Math.abs(openingGuard(upper, ops[0]) - (120 + 36)) < 1);
  const checks = houseChecks(p);
  assert.ok(checks.some((c) => c.rule === 'Guard round the floor opening' && c.storey === 'up'));
  assert.ok(houseMaterials(p).some((l) => l.item === 'Stair guard / balustrade (allowance)' && /stair opening in the floor/.test(l.basis)));
  // A wall upstairs through the opening is flagged.
  const blocked: Project = { ...p, walls: [...p.walls, { id: 'x', a: { x: 60, y: 0 }, b: { x: 60, y: 144 }, kind: 'interior', thickness: 4.5, height: 97.125 }] };
  assert.equal(houseChecks(blocked).find((c) => c.rule === 'Floor opening over the stair kept clear')!.status, 'warn');
});

test('E3903.3: the other level’s stair switch is placed on the storey above', () => {
  const p = twoStorey();
  const ground = storeyView(p, 'ground');
  const rule = (q: Project) => lightingChecks(q).find((c) => c.rule.startsWith('Stairway switched at each'))!;
  assert.equal(rule(ground).status, 'fail');
  assert.match(rule(ground).message, /needs a switch at the top on the second floor/);
  const q = placeStairSwitches(p);
  const up = storeyView(q, 'up');
  assert.equal(up.switches.length, 1);
  const sw = up.switches[0];
  // On the left wall, where you step off at the top, controlling the stair's light below.
  assert.equal(sw.wallId, up.walls[3].id);
  assert.ok(storeyView(q, 'ground').fixtures.some((f) => sw.controls.includes(f.id)));
  assert.equal(switchWays(up).get(sw.id), 3);
  const g2 = storeyView(q, 'ground');
  assert.equal(rule(g2).status, 'pass');
  // Placed, so not counted again as a phantom 3-way.
  assert.ok(!lightingLines(g2).some((l) => l.item.includes('other floor level')));
  // Placing again keeps one.
  assert.equal(storeyView(placeStairSwitches(q), 'up').switches.length, 1);
});

test('R314.3: a smoke alarm on every storey', () => {
  const p = twoStorey();
  const smoke = houseChecks(p).filter((c) => c.rule === 'Smoke alarm on each storey');
  assert.deepEqual(smoke.map((c) => [c.storey, c.status]), [['ground', 'pass'], ['up', 'fail']]);
  assert.match(smoke[1].message, /^Second floor: no smoke alarm/);
  const q = lit(p);
  assert.ok(houseChecks(q).filter((c) => c.rule === 'Smoke alarm on each storey').every((c) => c.status === 'pass'));
});

test('the estimate covers every storey: walls twice, a framed floor upstairs, roof once', () => {
  const g = living();
  const one = materialsList(g);
  let p = addStorey(g, 1, 'up');
  p = { ...p, rooms: [{ id: 'B', name: 'Bed', type: 'bedroom', points: rect(0, 0, 240, 144) }] };
  const lines = houseMaterials(p);
  const studs = (ls: typeof lines) => ls.filter((l) => / stud, /.test(l.item) && l.category === 'Lumber').reduce((t, l) => t + l.qty, 0);
  assert.ok(studs(lines) >= 2 * studs(one) - 2);
  assert.ok(lines.some((l) => l.category === 'Floor' && /floor joist/.test(l.item)));
  assert.ok(!lines.some((l) => /^Pier/.test(l.item)));
  const roof = (ls: typeof lines) => ls.filter((l) => l.category === 'Roof').map((l) => [l.item, l.qty]);
  assert.deepEqual(roof(lines), roof(one));
  const found = (ls: typeof lines) => ls.filter((l) => l.category === 'Foundation').map((l) => [l.item, l.qty]);
  assert.deepEqual(found(lines), found(one));
  assert.ok(Math.abs(houseFloorArea(p) - 2 * houseFloorArea(g)) < 0.01);
  // The roof's checks are on the top storey only.
  assert.ok(houseChecks(p).filter((c) => c.section === 'R905.2.2').every((c) => c.storey === 'up'));
});

test('3D stacks the storeys at their heights and cuts the stair opening', () => {
  const p = twoStorey();
  const s = houseScene(p);
  const h = storeyHeight(p);
  const floors = s.flats.filter((f) => f.kind === 'floor');
  assert.deepEqual([...new Set(floors.map((f) => f.y))].sort((a, b) => a - b), [0, h]);
  assert.equal(floors.find((f) => f.y === h)!.holes.length, 1);
  assert.ok(s.bounds.max[1] > h + 90);
  // Roof faces only over the top storey.
  const roof = s.faces.filter((f) => f.roofPart);
  assert.ok(roof.length && roof.every((f) => f.pts.every((q) => q[1] >= h)));
});
