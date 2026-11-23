import assert from 'node:assert/strict';
import { test } from 'node:test';
import { houseChecks, houseMaterials, houseScene } from '../src/calc/house.ts';
import { leanTos, uncoveredRects } from '../src/calc/lowerRoof.ts';
import { syncThickness } from '../src/model/store.ts';
import { addStorey, storeyElevation, updateStorey } from '../src/model/storeys.ts';
import type { Project, Wall } from '../src/model/types.ts';
import { box, project } from './helpers.ts';

/** Ground floor 480 × 300; the floor above pulled back from the top (plan north) by 120". */
function pulledBack(): Project {
  let p = project(box(480, 300));
  p = { ...p, walls: p.walls.map((w) => ({ ...w, height: 144 })), framing: { ...p.framing, wallHeight: 144 } };
  p = addStorey(p, 1, 'up');
  const wall = (id: string, ax: number, ay: number, bx: number, by: number): Wall => ({ ...p.walls[0], id, a: { x: ax, y: ay }, b: { x: bx, y: by }, height: 120 });
  return syncThickness({ ...p, walls: [wall('n', 0, 120, 480, 120), wall('e', 480, 120, 480, 300), wall('s', 480, 300, 0, 300), wall('w', 0, 300, 0, 120)], openings: [] });
}

test('the part of the ground floor the floor above leaves uncovered is found', () => {
  const p = pulledBack();
  const u = uncoveredRects(p, 'ground')!;
  assert.deepEqual(u.rects, [{ x0: 0, x1: 480, y0: 0, y1: 120 }]);
  assert.equal(uncoveredRects(p, 'up'), null);
});

test('a lean-to rises from the outside wall to the wall above', () => {
  const p = pulledBack();
  const [l] = leanTos(p, 'ground');
  assert.equal(l.high, 's');
  assert.equal(l.sides.s, 'wall');
  assert.equal(l.sides.n, 'free');
  assert.equal(l.sides.e, 'free');
  const t = p.walls[0].thickness / 2;
  // Run from the outside wall's outer face to the upper wall's outer face (same thickness: the centreline distance); 4/12 by default.
  assert.ok(Math.abs(l.run - 120) < 1e-6);
  assert.ok(Math.abs(l.rise - l.run / 3) < 1e-6);
  assert.ok(Math.abs(l.top - (144 + l.rise)) < 1e-6);
  assert.ok(l.headwall > 480 && l.eave === l.headwall);
  assert.equal(l.rakes.length, 2);
  // The roof face: eave low over the outside wall, high edge against the wall above.
  const roof = l.faces.find((f) => f.kind === 'roof')!;
  const zs = roof.pts.map((q) => q[2]);
  assert.ok(Math.min(...zs) < -t && Math.max(...zs) <= 120);
  const lowY = Math.min(...roof.pts.map((q) => q[1]));
  assert.ok(lowY < 144, 'the eave overhang drops below the plate');
});

test('the lean-to is in the 3D house, the estimate and the checks; none when turned off', () => {
  const p = pulledBack();
  const scene = houseScene(p);
  const roofs = scene.faces.filter((f) => f.roofPart && f.kind === 'roof' && Math.min(...f.pts.map((q) => q[1])) < storeyElevation(p, 'up'));
  assert.equal(roofs.length, 1);
  const lines = houseMaterials(p);
  assert.ok(lines.some((x) => x.item.startsWith('2x10 ledger') || x.item.includes('ledger')));
  assert.ok(lines.some((x) => x.item.startsWith('Apron')));
  const checks = houseChecks(p);
  assert.ok(checks.some((c) => c.rule === 'Lower roof slope for shingles' && c.status === 'pass'));

  const off = updateStorey(p, 'ground', { lowerRoof: { type: 'none' } });
  assert.equal(leanTos(off, 'ground').length, 0);
  assert.ok(!houseMaterials(off).some((x) => x.item.startsWith('Apron')));
});

test('a low pitch warns about underlayment and a window above the roof line is flagged', () => {
  let p = updateStorey(pulledBack(), 'ground', { lowerRoof: { pitch: 3 } });
  assert.ok(houseChecks(p).some((c) => c.rule === 'Lower roof slope for shingles' && c.status === 'warn'));
  // A window low in the upper north wall: the 8/12 lean-to runs into it.
  p = updateStorey(p, 'ground', { lowerRoof: { pitch: 8 } });
  p = { ...p, openings: [{ id: 'win', wallId: 'n', kind: 'window', offset: 240, width: 36, height: 48, sill: 30 }] };
  assert.ok(houseChecks(p).some((c) => c.rule === 'Lower roof clears the windows above' && c.targetId === 'win'));
});

test('a band of floor depth runs under the upper walls, not over the uncovered outside wall', () => {
  const p = pulledBack();
  const scene = houseScene(p);
  const bands = scene.boxes.filter((b) => b.kind === 'wall-ext' && b.c[1] > 144 && b.c[1] < storeyElevation(p, 'up'));
  assert.ok(bands.length >= 4);
  assert.ok(bands.every((b) => b.c[2] > 60), 'no band along the pulled-back front wall at y = 0');
});
