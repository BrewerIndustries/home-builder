import assert from 'node:assert/strict';
import { test } from 'node:test';
import { edgeCover, guardChecks, railingLines } from '../src/calc/guards.ts';
import { houseFloorArea, houseScene } from '../src/calc/house.ts';
import { materialsList } from '../src/calc/materials.ts';
import { buildScene } from '../src/calc/model3d.ts';
import { estimate } from '../src/calc/pricing.ts';
import { pointInPolygon } from '../src/model/geometry.ts';
import { syncThickness } from '../src/model/store.ts';
import { addStorey } from '../src/model/storeys.ts';
import { framedWalls, RAIL_THICKNESS, type Point, type Project, type Wall } from '../src/model/types.ts';
import { box, project } from './helpers.ts';

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const rail = (id: string, a: Point, b: Point, height = 36): Wall => ({ id, a, b, kind: 'interior', railing: true, thickness: RAIL_THICKNESS, height });

/** Ground floor 240×144 (living); upstairs the left half (0..120) is open to below, edged by a railing at x = 120. */
function gallery(withRail = true): Project {
  let p = project(box(240, 144), [], { rooms: [{ id: 'L', name: 'Living', type: 'living', points: rect(0, 0, 240, 144) }] });
  p = addStorey(p, 1, 'up');
  const walls = withRail ? [...p.walls, rail('r1', { x: 120, y: 0 }, { x: 120, y: 144 })] : p.walls;
  return syncThickness({
    ...p,
    walls,
    rooms: [
      { id: 'V', name: 'Open to living', type: 'other', points: rect(0, 0, 120, 144), openToBelow: true },
      { id: 'B', name: 'Loft', type: 'bedroom', points: rect(120, 0, 240, 144) },
    ],
  });
}

test('railings are not framed, are 2" thick and priced by the foot', () => {
  const p = gallery();
  assert.equal(framedWalls(p).some((w) => w.railing), false);
  assert.equal(p.walls.find((w) => w.id === 'r1')!.thickness, RAIL_THICKNESS);
  assert.deepEqual(railingLines(p).map((l) => [l.item, l.qty, l.unit]), [['Guard railing / balustrade (allowance)', 12, 'lf']]);
  assert.ok(materialsList(p).some((l) => l.item.startsWith('Guard railing')));
  const line = estimate(materialsList(p), p.pricing).lines.find((l) => l.item.startsWith('Guard railing'))!;
  assert.ok(line.unitPrice > 0);
});

test('edge cover merges walls along a segment', () => {
  const p = gallery();
  assert.equal(edgeCover(p.walls, { x: 120, y: 0 }, { x: 120, y: 144 }), 1);
  assert.equal(edgeCover(p.walls, { x: 0, y: 0 }, { x: 120, y: 0 }), 1);
  const half = [rail('a', { x: 0, y: 50 }, { x: 0, y: 100 })];
  assert.ok(Math.abs(edgeCover(half, { x: 0, y: 0 }, { x: 0, y: 200 }) - 0.25) < 1e-9);
});

test('an open-to-below room needs a guard on every open edge, 36" high', () => {
  assert.deepEqual(guardChecks(gallery()).filter((c) => c.section === 'R312.1.1').map((c) => c.status), ['pass']);
  const bare = guardChecks(gallery(false)).find((c) => c.section === 'R312.1.1')!;
  assert.equal(bare.status, 'fail');
  assert.match(bare.message, /12' 0"/);
  const low = gallery();
  low.walls = low.walls.map((w) => (w.railing ? { ...w, height: 30 } : w));
  assert.equal(guardChecks(low).find((c) => c.section === 'R312.1.2')?.status, 'fail');
});

test('the void is cut from the upper floor and the ceiling below, and left out of the floor area', () => {
  const p = gallery();
  const s = houseScene(p);
  const at = { x: 60, y: 72 };
  const floors = s.flats.filter((f) => f.kind === 'floor' && f.y > 0);
  assert.ok(floors.length);
  assert.ok(floors.every((f) => !pointInPolygon(at, f.outline) || f.holes.some((h) => pointInPolygon(at, h))));
  const ceilings = s.flats.filter((f) => f.kind === 'ceiling' && f.y < floors[0].y + 1);
  assert.ok(ceilings.every((f) => !pointInPolygon(at, f.outline) || f.holes.some((h) => pointInPolygon(at, h))));
  // Upstairs over the loft is still floored.
  assert.ok(floors.some((f) => pointInPolygon({ x: 180, y: 72 }, f.outline) && !f.holes.some((h) => pointInPolygon({ x: 180, y: 72 }, h))));
  const without = { ...p, rooms: p.rooms.map((r) => ({ ...r, openToBelow: undefined })) };
  assert.ok(houseFloorArea(p) < houseFloorArea(without));
  // A railing in 3D: top rail, infill and posts, no wall slab.
  assert.ok(buildScene(p).boxes.some((b) => b.kind === 'glass'));
});
