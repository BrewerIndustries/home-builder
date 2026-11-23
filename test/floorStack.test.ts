import assert from 'node:assert/strict';
import { test } from 'node:test';
import { roomWallHeight } from '../src/calc/ceilings.ts';
import { floorOpenings, houseScene } from '../src/calc/house.ts';
import { subtractHoles } from '../src/calc/outline.ts';
import { stairGeometry } from '../src/calc/stairs.ts';
import { stairBoxes } from '../src/calc/stairs3d.ts';
import { stairSegments, straightLandings, straightSteps } from '../src/calc/stairShape.ts';
import { move } from '../src/calc/walk.ts';
import { polygonArea, pointInPolygon } from '../src/model/geometry.ts';
import { syncThickness } from '../src/model/store.ts';
import { addStorey, storeyView } from '../src/model/storeys.ts';
import { RAIL_THICKNESS, type Furniture, type Point, type Project } from '../src/model/types.ts';
import { box, project } from './helpers.ts';

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const area = (ps: Point[][]) => ps.reduce((t, p) => t + polygonArea(p), 0);

test('holes are subtracted into plain pieces, even where they cross or touch the edge', () => {
  const sq = rect(0, 0, 100, 100);
  assert.ok(Math.abs(area(subtractHoles(sq, [rect(40, 40, 60, 60)])) - 9600) < 1e-6);
  // Crossing the edge: only the part inside comes off.
  assert.ok(Math.abs(area(subtractHoles(sq, [rect(80, 40, 120, 60)])) - 9600) < 1e-6);
  // Outside, touching the edge: nothing comes off.
  assert.ok(Math.abs(area(subtractHoles(sq, [rect(100, 0, 200, 100)])) - 10000) < 1e-6);
  // A concave (L) hole.
  const L = [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 30 }, { x: 30, y: 30 }, { x: 30, y: 50 }, { x: 10, y: 50 }];
  assert.ok(Math.abs(area(subtractHoles(sq, [L])) - (10000 - polygonArea(L))) < 1e-6);
});

/** A 12'-wall ground floor with a 20-riser stair (8.9" treads), a second floor with the left half open to below. */
function gallery(): Project {
  const stair: Furniture = { id: 'st', kind: 'stairs', at: { x: 300, y: 200 }, rot: 270, w: 48, d: 209, risers: 20, landing: 10 };
  let p = project(box(480, 300), [], { rooms: [{ id: 'L', name: 'Living', type: 'living', points: rect(0, 0, 480, 300) }], furniture: [stair] });
  p = { ...p, walls: p.walls.map((w) => ({ ...w, height: 144 })), framing: { ...p.framing, wallHeight: 144 } };
  p = addStorey(p, 1, 'up');
  return syncThickness({
    ...p,
    walls: [...p.walls, { id: 'r', a: { x: 0, y: 150 }, b: { x: 160, y: 150 }, kind: 'interior', railing: true, thickness: RAIL_THICKNESS, height: 36 }, { id: 'r2', a: { x: 160, y: 0 }, b: { x: 160, y: 150 }, kind: 'interior', railing: true, thickness: RAIL_THICKNESS, height: 36 }],
    rooms: [
      { id: 'V', name: 'Open', type: 'other', openToBelow: true, points: rect(0, 0, 160, 150) },
      { id: 'U', name: 'Loft', type: 'living', points: [{ x: 160, y: 0 }, { x: 480, y: 0 }, { x: 480, y: 300 }, { x: 0, y: 300 }, { x: 0, y: 150 }, { x: 160, y: 150 }] },
    ],
  });
}

test('railings do not set the ceiling height: the room open to below keeps its full-height ceiling', () => {
  const p = gallery();
  assert.equal(roomWallHeight(p, p.rooms[0]), 144);
  const top = houseScene(p).flats.filter((f) => f.kind === 'ceiling').map((f) => f.y);
  assert.ok(!top.some((y) => y > 144 && y < 200));
});

test('the floor depth between storeys is closed: a band on the outside walls and an edge round the openings', () => {
  const s = houseScene(gallery());
  const rims = s.boxes.filter((b) => b.kind === 'rim');
  assert.ok(rims.length >= 4);
  assert.ok(rims.every((b) => Math.abs(b.c[1] - b.size[1] / 2 - 144) < 0.01));
  assert.ok(s.boxes.some((b) => b.kind === 'wall-ext' && b.c[1] - b.size[1] / 2 >= 143.9 && b.c[1] + b.size[1] / 2 > 150));
  // No edge across the stair opening where its flight and landing pieces meet (they'd read as joists).
  const polys = floorOpenings(gallery(), 'up').flatMap((o) => o.polys);
  assert.ok(polys.length > 1);
  const pts = polys.flat();
  const [x0, x1] = [Math.min(...pts.map((q) => q.x)) + 2, Math.max(...pts.map((q) => q.x)) - 2];
  const [z0, z1] = [Math.min(...pts.map((q) => q.y)) + 2, Math.max(...pts.map((q) => q.y)) - 2];
  assert.deepEqual(rims.filter((b) => b.c[0] > x0 && b.c[0] < x1 && b.c[2] > z0 && b.c[2] < z1), []);
});

test('you can walk up a stair with treads shallower than your body, to the floor above', () => {
  const p = gallery();
  const s = houseScene(p);
  const g = storeyView(p, 'ground');
  const steps = stairBoxes(g, g.furniture[0]);
  const [f, l] = [steps[0], steps[steps.length - 1]];
  let w = { x: f.c[0] + 30, z: f.c[2], y: 0 };
  const dir = Math.sign(l.c[0] - f.c[0]);
  for (let i = 0; i < 600; i++) w = move(s, w, dir, 0);
  assert.equal(Math.round(w.y), Math.round(stairGeometry(g, g.furniture[0]).rise));
  // Off the top onto the loft floor, clear of the stair.
  assert.ok(pointInPolygon({ x: w.x, y: w.z }, p.rooms[1].points));
});

test('a straight stair takes any number of landings', () => {
  const f: Furniture = { id: 's', kind: 'stairs', at: { x: 0, y: 0 }, rot: 0, w: 36, d: 300, risers: 21, landings: [14, 7, 7, 30] };
  assert.deepEqual(straightLandings(f), [7, 14]);
  const { depths, ld } = straightSteps(f);
  assert.equal(depths.length, 20);
  assert.deepEqual([depths[6], depths[13]], [ld, ld]);
  assert.ok(Math.abs(depths.reduce((t, d) => t + d, 0) - 300) < 1e-9);
  const segs = stairSegments(f);
  assert.deepEqual(segs.map((x) => x.kind), ['flight', 'landing', 'flight', 'landing', 'flight']);
  assert.deepEqual(segs.filter((x) => x.kind === 'flight').map((x) => x.risers), [7, 7, 7]);
  assert.ok(Math.abs(segs.reduce((t, x) => t + x.len, 0) - 300) < 1e-9);
  const p = project(box(400, 400));
  const g = stairGeometry(p, f);
  assert.equal(g.landings, 2);
  assert.equal(g.flights.length, 3);
  // The old single `landing` still works.
  assert.deepEqual(straightLandings({ ...f, landings: undefined, landing: 10 }), [10]);
});
