import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autoLighting, lightingChecks, lightingLines, switchWays } from '../src/calc/lighting.ts';
import { estimate } from '../src/calc/pricing.ts';
import { projectReducer } from '../src/model/store.ts';
import { DEFAULT_FOUNDATION, DEFAULT_ROOF, type Furniture, type Point, type Project } from '../src/model/types.ts';
import { box, door, project, wall } from './helpers.ts';

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

const lit = (p: Project) => {
  const { fixtures, switches } = autoLighting(p);
  return projectReducer(p, { type: 'replaceAutoLighting', fixtures, switches });
};

/** 20' × 12' living room. */
const living = (patch: Partial<Project> = {}) => project(box(240, 144), [], { rooms: [{ id: 'L', name: 'Living', type: 'living', points: rect(0, 0, 240, 144) }], ...patch });

/** A 13-riser flight along the top wall, its back to the left wall, the foot (on this floor) at x = 123.25. */
const stair = (risers = 13, patch: Partial<Furniture> = {}): Furniture => ({ id: 'st', kind: 'stairs', at: { x: 63.25, y: 21.25 }, rot: 270, w: 36, d: 120, risers, ...patch });

test('a fan without a light kit is not the room’s light: auto adds one beside it', () => {
  const fan = { id: 'fan', kind: 'fan' as const, at: { x: 120, y: 72 }, auto: false, lightKit: false };
  const p = { ...project(box(240, 144), [], { rooms: [{ id: 'K', name: 'Kitchen', type: 'kitchen', points: rect(0, 0, 240, 144) }] }), fixtures: [fan] };
  const c = lightingChecks(p).find((x) => x.rule === 'Wall-switched lighting outlet')!;
  assert.deepEqual([c.status, c.message], ['fail', 'Kitchen: no lighting outlet']);
  const q = lit(p);
  const light = q.fixtures.find((f) => f.kind === 'light')!;
  assert.deepEqual(light.at, { x: 156, y: 72 });
  assert.equal(lightingChecks(q).find((x) => x.rule === 'Wall-switched lighting outlet')!.status, 'pass');
  const lines = lightingLines(q);
  assert.equal(lines.find((l) => l.item.startsWith('Ceiling fan, no light kit'))!.qty, 1);
  assert.ok(!lines.some((l) => l.item.startsWith('Ceiling fan with light kit')));
  assert.ok(estimate(lines).lines.every((l) => l.unitPrice > 0));
  // With its kit it counts, and auto adds nothing.
  const kit = { ...p, fixtures: [{ ...fan, lightKit: undefined }] };
  assert.equal(autoLighting(kit).fixtures.filter((f) => f.kind === 'light').length, 0);
});

test('stairs of 6+ risers: a light over the flight and a 3-way by the foot, its partner counted for the other level', () => {
  const p = lit(living({ furniture: [stair()] }));
  const over = p.fixtures.find((f) => f.at.x === 63 && f.at.y === 21)!;
  assert.ok(over);
  const sw = p.switches.find((s) => s.controls.includes(over.id))!;
  // On the top wall, square to the foot.
  assert.equal(sw.wallId, p.walls[0].id);
  assert.ok(Math.abs(sw.offset - 123.25) < 0.01);
  assert.equal(switchWays(p).get(sw.id), 3);
  const checks = lightingChecks(p).filter((c) => c.targetId === 'st');
  assert.deepEqual(checks.map((c) => [c.rule, c.status]), [
    ['Wall-switched stairway light', 'pass'],
    ['Stairway switched at each floor level (6+ risers)', 'pass'],
  ]);
  assert.match(checks[1].message, /3-way by the foot here; its 3-way at the upper level/);
  assert.equal(lightingLines(p).find((l) => l.item === '3-way switch, 15A, at the other floor level')!.qty, 1);
  // Its switch moved to the far end of the room: fails.
  const far = { ...p, switches: p.switches.map((s) => (s.id === sw.id ? { ...s, offset: 230 } : s)) };
  assert.equal(lightingChecks(far).find((c) => c.rule.startsWith('Stairway switched'))!.status, 'fail');
});

test('a short flight (under 6 risers) needs a switched light but only one switch', () => {
  const p = lit(living({ furniture: [stair(4, { down: true })] }));
  const checks = lightingChecks(p).filter((c) => c.targetId === 'st');
  assert.deepEqual(checks.map((c) => [c.rule, c.status, c.message]), [['Wall-switched stairway light', 'pass', 'Stairs (4 risers down)']]);
  assert.ok(!lightingLines(p).some((l) => l.item.includes('other floor level')));
  // No light at all: fails.
  const dark = { ...living({ furniture: [stair()] }), fixtures: [{ id: 'x', kind: 'light' as const, at: { x: 200, y: 100 }, auto: false }] };
  assert.equal(lightingChecks(dark).find((c) => c.targetId === 'st')!.message, 'Stairs (13 risers up): no light over the flight');
});

test('E3903.4: a closet with a water heater gets a switched light', () => {
  const walls = [...box(240, 144), wall(200, 0, 200, 48, 'interior'), wall(200, 48, 240, 48, 'interior')];
  const cl = walls[5];
  const p = project(walls, [{ ...door(cl.id, 20, 24), swing: { side: 1, hinge: 'a' } }], {
    rooms: [
      { id: 'L', name: 'Living', type: 'living', points: rect(0, 0, 240, 144) },
      { id: 'C', name: 'WH closet', type: 'other', points: rect(200, 0, 240, 48) },
    ],
    furniture: [{ id: 'wh', kind: 'water-heater', at: { x: 222, y: 16 }, rot: 0, w: 24, d: 24 }],
  });
  const unlit = { ...p, fixtures: [{ id: 'x', kind: 'light' as const, at: { x: 100, y: 72 }, auto: false }] };
  assert.equal(lightingChecks(unlit).find((c) => c.section === 'E3903.4' && c.targetId === 'C')!.status, 'fail');
  const q = lit(p);
  const check = lightingChecks(q).find((c) => c.section === 'E3903.4' && c.targetId === 'C')!;
  assert.deepEqual([check.status, check.message], ['pass', 'WH closet (water heater): wall-switched light']);
  // Without the water heater a closet that small gets none.
  assert.ok(!lit({ ...p, furniture: [] }).fixtures.some((f) => f.kind === 'light' && f.at.x > 200 && f.at.y < 48));
});

test('E3903.4: attic and crawlspace lights follow how the spaces are used', () => {
  const ask = lightingChecks(lit(living()));
  assert.deepEqual(ask.filter((c) => c.section === 'E3903.4').map((c) => [c.rule, c.status]), [['Light in the attic', 'info']]);
  const p = lit(living({ roof: DEFAULT_ROOF, foundation: { ...DEFAULT_FOUNDATION, type: 'crawl' }, electrical: { attic: 'equipment', crawl: 'none' } }));
  assert.deepEqual(lightingChecks(p).filter((c) => c.section === 'E3903.4').map((c) => [c.rule, c.status]), [
    ['Light in the attic', 'pass'],
    ['Light in the crawlspace', 'pass'],
  ]);
  const lines = lightingLines(p).filter((l) => l.item.startsWith('Attic / crawlspace'));
  assert.deepEqual(lines.map((l) => [l.item, l.qty]), [['Attic / crawlspace light + switch (attic)', 1]]);
  assert.ok(estimate(lines).lines.every((l) => l.unitPrice > 0));
  // Not answered: asked about, not priced.
  const open = lit(living({ foundation: { ...DEFAULT_FOUNDATION, type: 'crawl' } }));
  assert.deepEqual(lightingChecks(open).filter((c) => c.section === 'E3903.4').map((c) => c.status), ['info', 'info']);
  assert.ok(!lightingLines(open).some((l) => l.item.startsWith('Attic / crawlspace')));
  // No roof: no attic.
  assert.ok(!lightingChecks(lit(living({ roof: { ...DEFAULT_ROOF, type: 'none' } }))).some((c) => c.section === 'E3903.4'));
});

test('outdoor-door lights are filed under E3903.3', () => {
  const walls = box(240, 144);
  const p = lit(project(walls, [{ ...door(walls[2].id, 120), id: 'front' }], { rooms: [{ id: 'L', name: 'Living', type: 'living', points: rect(0, 0, 240, 144) }] }));
  assert.equal(lightingChecks(p).find((c) => c.rule === 'Light outside each outdoor door')!.section, 'E3903.3');
});
