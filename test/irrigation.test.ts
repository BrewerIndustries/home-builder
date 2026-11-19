import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autoLayoutZone, covers, headGpm, headToHead, irrigationLines, layoutPolygon, pipeCapacity, pipeRuns, pvcSize, zoneCoverage, zoneGpm } from '../src/calc/irrigation.ts';
import { materialsList } from '../src/calc/materials.ts';
import { estimate } from '../src/calc/pricing.ts';
import { siteChecks, siteLines } from '../src/calc/site.ts';
import { TYPICAL_NOZZLES, type Irrigation, type IrrigationHead } from '../src/model/irrigation.ts';
import type { Point, Site } from '../src/model/types.ts';
import { project } from './helpers.ts';

const ft = (n: number) => n * 12;
const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
let n = 0;
const ids = () => `h${++n}`;

function lawnProject(irrigation?: Irrigation, extra: Partial<Site> = {}) {
  return project([], [], {
    site: {
      setbacks: [],
      plants: [],
      areas: [
        { id: 'lawn', material: 'sod', points: rect(0, 0, ft(45), ft(30)), depth: 0 },
        { id: 'bed', material: 'mulch', points: rect(ft(50), 0, ft(56), ft(12)), depth: 3 },
      ],
      irrigation,
      ...extra,
    },
  });
}

const lawnZone = { id: 'z1', name: 'Front lawn', kind: 'spray' as const, areaIds: ['lawn'], pattern: 'square' as const };

test('old projects without irrigation are unchanged', () => {
  const p = lawnProject();
  assert.deepEqual(irrigationLines(p), []);
  assert.equal(siteChecks(p).filter((c) => c.section === 'Irrigation').length, 0);
  assert.equal(materialsList(p).filter((l) => /PVC|Irrigation|spray/i.test(l.item)).length, 0);
  assert.deepEqual(pipeRuns(p), []);
  // Site takeoff itself untouched.
  assert.ok(siteLines(p, 0.1).some((l) => l.item === 'Sod'));
});

test('arc-scaled head flow and override', () => {
  const irr: Irrigation = { zones: [lawnZone], heads: [] };
  const h = (arc: number, gpm?: number): IrrigationHead => ({ id: 'x', zoneId: 'z1', kind: 'spray', at: { x: 0, y: 0 }, radius: 180, arc, rotation: 0, gpm });
  assert.equal(headGpm(h(360), irr), TYPICAL_NOZZLES.spray.gpm);
  assert.ok(Math.abs(headGpm(h(90), irr) - TYPICAL_NOZZLES.spray.gpm / 4) < 1e-9);
  assert.equal(headGpm(h(90, 1.2), irr), 1.2);
  // Editable nozzle defaults flow through.
  assert.equal(headGpm(h(180), { ...irr, nozzles: { spray: { radius: 180, gpm: 2 } } }), 1);
});

test('arc direction: y runs down, arc sweeps clockwise on screen from rotation', () => {
  // Quarter circle starting at +x (east) sweeping to +y (south, i.e. down the plan).
  const h: IrrigationHead = { id: 'a', zoneId: 'z', kind: 'spray', at: { x: 0, y: 0 }, radius: 100, arc: 90, rotation: 0 };
  assert.ok(covers(h, { x: 50, y: 50 }));
  assert.ok(!covers(h, { x: 50, y: -50 }));
  assert.ok(!covers(h, { x: -50, y: 50 }));
  assert.ok(!covers(h, { x: 90, y: 90 }), 'beyond throw');
});

test('auto-layout: corner quarters, edge halves, interior fulls at head-to-head spacing', () => {
  const heads = layoutPolygon(rect(0, 0, ft(45), ft(30)), 'spray', TYPICAL_NOZZLES.spray, 'square', 'z1', ids);
  const arcs = heads.map((h) => h.arc);
  assert.equal(arcs.filter((a) => a === 90).length, 4, 'four corner heads');
  // 45' edges → 3 segments → 2 edge heads each; 30' edges → 1 each.
  assert.equal(arcs.filter((a) => a === 180).length, 6);
  assert.equal(arcs.filter((a) => a === 360).length, 2);
  // Every part-circle head sprays into the lawn.
  for (const h of heads) {
    const r = (h.rotation + h.arc / 2) * (Math.PI / 180);
    const probe = { x: h.at.x + Math.cos(r) * 12, y: h.at.y + Math.sin(r) * 12 };
    assert.ok(probe.x > 0 && probe.x < ft(45) && probe.y > 0 && probe.y < ft(30), `head ${h.id} faces out`);
  }
  // L-shaped lawn: the reflex corner gets a 270° head.
  const L = [{ x: 0, y: 0 }, { x: ft(30), y: 0 }, { x: ft(30), y: ft(15) }, { x: ft(15), y: ft(15) }, { x: ft(15), y: ft(30) }, { x: 0, y: ft(30) }];
  assert.ok(layoutPolygon(L, 'spray', TYPICAL_NOZZLES.spray, 'triangular', 'z', ids).some((h) => h.arc === 270));
});

test('auto-laid zone passes head-to-head and coverage; a missing head shows up', () => {
  const p0 = lawnProject({ zones: [lawnZone], heads: [] });
  const irr = autoLayoutZone(p0, 'z1', ids);
  const p = lawnProject(irr);
  assert.deepEqual(headToHead(irr, 'z1'), []);
  const cov = zoneCoverage(p, lawnZone);
  assert.ok(cov.cells.length > 100);
  assert.equal(cov.gap, 0);
  assert.ok(siteChecks(p).some((c) => c.rule === 'Head-to-head coverage' && c.status === 'pass'));

  // Stretch spacing: drop the throw so heads no longer reach each other.
  const short = { ...irr, heads: irr.heads.map((h) => ({ ...h, radius: ft(8) })) };
  const ps = lawnProject(short);
  assert.ok(headToHead(short, 'z1').length > 0);
  assert.ok(zoneCoverage(ps, lawnZone).gap > 0.05);
  const checks = siteChecks(ps);
  assert.equal(checks.find((c) => c.rule === 'Head-to-head coverage')?.status, 'warn');
  assert.equal(checks.find((c) => c.rule === 'Coverage gaps')?.status, 'warn');
});

test('zone flow is checked against the entered supply', () => {
  const irr = autoLayoutZone(lawnProject({ zones: [lawnZone], heads: [] }), 'z1', ids);
  // 4 quarters + 6 halves + 2 fulls = 1 + 3 + 2 = 6 full-circle equivalents.
  assert.equal(zoneGpm(irr, 'z1'), Math.round(6 * TYPICAL_NOZZLES.spray.gpm * 100) / 100);
  const flow = (supplyGpm?: number) => siteChecks(lawnProject({ ...irr, supplyGpm })).find((c) => c.rule === 'Zone flow vs water supply');
  assert.equal(flow()?.status, 'info');
  assert.equal(flow(30)?.status, 'pass');
  assert.equal(flow(12)?.status, 'warn');
});

test('pipe sizing by velocity and routed runs', () => {
  assert.ok(pipeCapacity(0.824) > 8 && pipeCapacity(0.824) < 8.6);
  assert.equal(pvcSize(6), '3/4"');
  assert.equal(pvcSize(12), '1"');
  assert.equal(pvcSize(20), '1-1/4"');
  const irr: Irrigation = {
    zones: [lawnZone],
    heads: [
      { id: 'a', zoneId: 'z1', kind: 'spray', at: { x: ft(10), y: ft(10) }, radius: 180, arc: 360, rotation: 0 },
      { id: 'b', zoneId: 'z1', kind: 'spray', at: { x: ft(25), y: ft(10) }, radius: 180, arc: 360, rotation: 0 },
    ],
    manifold: { x: 0, y: ft(10) },
    backflow: { x: 0, y: 0 },
  };
  const runs = pipeRuns(lawnProject(irr));
  const main = runs.find((r) => r.id === 'main')!;
  assert.equal(main.length, ft(10));
  const lat = runs.find((r) => r.id === 'z1')!;
  // Manifold → nearest head (10') + head → head (15').
  assert.equal(lat.length, ft(25));
  assert.equal(lat.size, '3/4"');
  // L route when not aligned.
  const off = pipeRuns(lawnProject({ ...irr, backflow: { x: ft(-5), y: 0 } })).find((r) => r.id === 'main')!;
  assert.equal(off.paths[0].length, 3);
  assert.equal(off.length, ft(15));
});

test('parts list lands in the estimate with sample prices', () => {
  const zones = [lawnZone, { id: 'z2', name: 'Bed', kind: 'drip' as const, areaIds: ['bed'], pattern: 'square' as const }];
  let irr: Irrigation = { zones, heads: [], manifold: { x: ft(-2), y: ft(5) }, backflow: { x: ft(-2), y: 0 } };
  irr = autoLayoutZone(lawnProject(irr), 'z1', ids);
  irr = autoLayoutZone(lawnProject(irr), 'z2', ids);
  const p = lawnProject(irr);
  const lines = irrigationLines(p);
  const get = (item: string) => lines.find((l) => l.item === item)?.qty;
  assert.equal(get('Pop-up spray head + nozzle'), 12);
  // 6' × 12' bed at 18" → 4 × 8 emitters.
  assert.equal(get('Drip emitter'), 32);
  assert.equal(get('Irrigation zone valve'), 2);
  assert.equal(get('Irrigation controller, 4-station'), 1);
  assert.equal(get('Backflow preventer'), 1);
  assert.equal(get('Drip zone kit (filter + pressure regulator)'), 1);
  assert.ok((get('PVC pipe 3/4"') ?? 0) > 0);
  assert.ok((get('Drip tubing 1/2"') ?? 0) > 0);
  const est = estimate(materialsList(p));
  for (const item of ['Pop-up spray head + nozzle', 'Irrigation zone valve', 'Backflow preventer', 'PVC pipe 3/4"', 'Irrigation fittings allowance']) {
    assert.ok((est.lines.find((l) => l.item === item)?.unitPrice ?? 0) > 0, `${item} priced`);
  }
  // Drip zones are not run through the spray coverage check.
  assert.ok(!siteChecks(p).some((c) => c.rule === 'Coverage gaps' && c.message.startsWith('Bed')));
});
