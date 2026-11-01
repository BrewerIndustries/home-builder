import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimate } from '../src/calc/pricing.ts';
import { materialsList } from '../src/calc/materials.ts';
import { insetPolygon, siteChecks, siteLines, siteSummary } from '../src/calc/site.ts';
import type { Point, Site } from '../src/model/types.ts';
import { box, project } from './helpers.ts';

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const ft = (n: number) => n * 12;

test('inset rectangle by per-edge setbacks', () => {
  const env = insetPolygon(rect(0, 0, ft(100), ft(150)), [ft(25), ft(5), ft(20), ft(5)]);
  assert.deepEqual(
    env.map((p) => [Math.round(p.x / 12), Math.round(p.y / 12)]),
    [[5, 25], [95, 25], [95, 130], [5, 130]],
  );
  // Same result regardless of winding.
  const ccw = insetPolygon([...rect(0, 0, ft(100), ft(150))].reverse(), [ft(20), ft(5), ft(25), ft(5)]);
  assert.equal(Math.round(Math.abs(ccw[0].x - ccw[2].x) / 12), 90);
  // Setbacks swallowing the lot leave nothing.
  assert.deepEqual(insetPolygon(rect(0, 0, ft(20), ft(20)), [ft(15), ft(15), ft(15), ft(15)]), []);
});

function siteProject(site: Partial<Site>) {
  // 40×30 house sitting 30 ft back from the front lot line.
  const walls = box(ft(40), ft(30)).map((w) => ({ ...w, a: { x: w.a.x + ft(30), y: w.a.y + ft(30) }, b: { x: w.b.x + ft(30), y: w.b.y + ft(30) } }));
  return project(walls, [], { site: { setbacks: [], areas: [], plants: [], lot: rect(0, 0, ft(100), ft(120)), ...site } });
}

test('coverage and setback check', () => {
  const p = siteProject({ setbacks: [ft(25), ft(10), ft(20), ft(10)] });
  const s = siteSummary(p);
  assert.equal(Math.round(s.lotArea / 144), 12000);
  assert.ok(s.coverage > 0.1 && s.coverage < 0.11, `coverage ${s.coverage}`);
  assert.equal(siteChecks(p).find((c) => c.rule === 'House within setbacks')?.status, 'pass');
  const tight = siteProject({ setbacks: [ft(35), ft(10), ft(20), ft(10)] });
  assert.equal(siteChecks(tight).find((c) => c.rule === 'House within setbacks')?.status, 'fail');
});

test('hardscape takeoff and estimate lines', () => {
  const p = siteProject({
    areas: [
      { id: 'a1', material: 'pavers', points: rect(0, 0, ft(10), ft(10)), depth: 0 },
      { id: 'a2', material: 'concrete', points: rect(0, 0, ft(27), ft(10)), depth: 4 },
      { id: 'a3', material: 'mulch', points: rect(0, 0, ft(30), ft(9)), depth: 3 },
    ],
    plants: [
      { id: 'p1', species: 'red-maple', at: { x: ft(80), y: ft(100) } },
      { id: 'p2', species: 'red-maple', at: { x: ft(10), y: ft(100) } },
    ],
  });
  const lines = siteLines(p, 0.1);
  const get = (item: string) => lines.find((l) => l.item === item)?.qty;
  assert.equal(get('Pavers'), 110);
  assert.equal(get('Paver edge restraint'), 40);
  // 270 sq ft × 4" = 3.33 yd³ ×1.1 → 3.75 (quarter yards)
  assert.equal(get('Concrete'), 3.75);
  // 270 sq ft × 3" = 2.5 yd³ ×1.05 → 3 (half yards)
  assert.equal(get('Hardwood mulch'), 3);
  assert.equal(get('Red maple (tree)'), 2);
  const est = estimate(materialsList(p));
  assert.ok(est.byCategory.some((c) => c.category === 'Landscape' && c.total > 0));
});

test('plant checks: tree near foundation, zone', () => {
  const p = siteProject({ zone: 10, plants: [{ id: 'p1', species: 'red-maple', at: { x: ft(75), y: ft(45) } }] });
  const rules = siteChecks(p).map((c) => c.rule);
  assert.ok(rules.includes('Tree too close to the foundation'));
  assert.ok(rules.includes('Hardiness zone'));
});
