import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ircChecks } from '../src/calc/irc.ts';
import { gableInfill, materialsList } from '../src/calc/materials.ts';
import { buildScene } from '../src/calc/model3d.ts';
import { roofCalc, roofFaces, roofFraming, roofLines, stockFeet } from '../src/calc/roof.ts';
import { DEFAULT_ROOF, type Roof } from '../src/model/types.ts';
import { box, project } from './helpers.ts';

// 40 × 30 ft house, 2x6 exterior walls (6.5" finished) → 486.5" × 366.5" outside.
const house = (roof: Partial<Roof> = {}) => project(box(480, 360), [], { roof: { ...DEFAULT_ROOF, ...roof } });
const near = (a: number, b: number, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

test('gable 6/12 geometry', () => {
  const c = roofCalc(house())!;
  assert.equal(c.alongX, true);
  near(c.L, 486.5);
  near(c.W, 366.5);
  near(c.k, Math.sqrt(1.25), 1e-9);
  near(c.rise, (366.5 / 2) * 0.5);
  near(c.area, (486.5 + 24) * (366.5 + 24) * Math.sqrt(1.25));
  near(c.ridgeLength, 486.5 + 24);
  near(c.rafterLength, (366.5 / 2 + 12) * Math.sqrt(1.25));
  near(c.gableArea, 366.5 * c.rise);
});

test('ridge follows the long side unless set', () => {
  assert.equal(roofCalc(house({ ridge: 'y' }))!.alongX, false);
  assert.equal(roofCalc(project(box(300, 600), [], { roof: DEFAULT_ROOF }))!.alongX, false);
  assert.equal(roofCalc(house({ type: 'none' })), null);
});

test('hip and shed', () => {
  const hip = roofCalc(house({ type: 'hip' }))!;
  near(hip.ridgeLength, 486.5 - 366.5);
  near(hip.area, (486.5 + 24) * (366.5 + 24) * Math.sqrt(1.25));
  assert.equal(hip.gableArea, 0);
  assert.ok(hip.hipLength > 4 * (366.5 / 2) * Math.SQRT2);
  const shed = roofCalc(house({ type: 'shed', pitch: 2 }))!;
  near(shed.rise, 366.5 * (2 / 12));
  assert.equal(shed.ridgeLength, 0);
});

test('framing counts', () => {
  const t = roofFraming(roofCalc(house())!);
  assert.equal(t.count, Math.ceil(486.5 / 24) + 1); // 22 trusses incl. 2 gable-end
  const r = roofFraming(roofCalc(house({ framing: 'rafters', spacing: 16 }))!);
  assert.equal(r.count, 2 * (Math.ceil(486.5 / 16) + 1));
  assert.equal(stockFeet(193), 18);
  assert.equal(stockFeet(50), 8);
});

test('roof materials', () => {
  const lines = roofLines(house(), 0.1);
  const get = (re: RegExp) => lines.find((l) => re.test(l.item));
  assert.equal(get(/^Roof truss/)?.qty, 20);
  assert.equal(get(/^Gable-end truss/)?.qty, 2);
  const sq = roofCalc(house())!.squares;
  assert.equal(get(/shingles, bundle/)?.qty, Math.ceil(sq * 1.1 * 3));
  assert.ok(get(/roof sheathing/)!.qty > 0);
  assert.ok(materialsList(house()).some((l) => l.category === 'Roof'));
  // Rafter roofs frame their gable ends with studs; truss roofs don't.
  assert.equal(gableInfill(house()).size, 0);
  assert.ok((gableInfill(house({ framing: 'rafters' })).get('2x6')?.lf ?? 0) > 0);
});

test('vaulted room gets gable infill on its end walls', () => {
  const p = project(box(240, 180), [], {
    roof: { ...DEFAULT_ROOF, type: 'none' },
    rooms: [{ id: 'r1', name: 'Great room', type: 'living', points: [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 180 }, { x: 0, y: 180 }], ceiling: { type: 'cathedral', peak: 168 } }],
  });
  const g = gableInfill(p).get('2x6');
  assert.ok(g && g.lf > 0 && g.sources.includes('Great room'));
});

test('R905.2.2 shingle slope', () => {
  const st = (pitch: number) => ircChecks(house({ pitch })).find((c) => c.section === 'R905.2.2')?.status;
  assert.equal(st(1), 'fail');
  assert.equal(st(3), 'warn');
  assert.equal(st(6), 'pass');
});

test('3D roof faces', () => {
  assert.equal(roofFaces(house()).filter((f) => f.kind === 'roof').length, 2);
  assert.equal(roofFaces(house({ type: 'hip' })).length, 4);
  const top = Math.max(...buildScene(house()).faces.flatMap((f) => f.pts.map((p) => p[1])));
  near(top, 97.125 + (366.5 / 2) * 0.5);
});
