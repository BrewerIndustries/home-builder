import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cabinetLayout, cornerCabinets, cornerUppers, counterCorners, counterLength, counterLines, counterOverlaps, fillStretch, newCounters, upperSpans } from '../src/calc/counters.ts';
import { dinerClearance, kitchenChecks } from '../src/calc/kitchen.ts';
import { buildScene } from '../src/calc/model3d.ts';
import { estimate } from '../src/calc/pricing.ts';
import type { Counter, Project } from '../src/model/types.ts';
import { box, project } from './helpers.ts';

/** A 20' × 12' kitchen (6-1/2" walls: inside faces at 3.25 and 236.75 / 140.75). */
const kitchen = (counters: Counter[] = []): Project =>
  project(box(240, 144), [], { rooms: [{ id: 'K', name: 'Kitchen', type: 'kitchen', points: [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 144 }, { x: 0, y: 144 }] }], counters });
const qty = (p: Project, item: string) => counterLines(p).find((l) => l.item === item)?.qty ?? 0;

test('one drag from a wall to the wall facing it makes a U along the wall nearest the drag', () => {
  const p = kitchen();
  const u = newCounters(p, { x: 15, y: 100 }, { x: 225, y: 100 }, ['l', 'm', 'r']);
  assert.equal(u.length, 3);
  const [left, mid, right] = u;
  assert.deepEqual([Math.round(counterLength(left) * 4) / 4, Math.round(counterLength(mid) * 4) / 4, Math.round(counterLength(right) * 4) / 4], [40.75, 233.5, 40.75]);
  // The middle run is on the bottom wall's face, every leg's front into the room.
  assert.deepEqual([mid.a.y, mid.b.y], [140.75, 140.75]);
  for (const c of u) assert.ok(counterCorners(c).every((q) => q.x >= 3.25 - 1e-9 && q.x <= 236.75 + 1e-9 && q.y >= 3.25 - 1e-9 && q.y <= 140.75 + 1e-9));
  const withU = kitchen(u);
  assert.equal(counterOverlaps(withU).length, 2);
  assert.equal(cornerCabinets(withU).length, 2);
  // Too short a leg: one straight run instead.
  assert.equal(newCounters(p, { x: 15, y: 120 }, { x: 225, y: 120 }, ['l', 'm', 'r']).length, 1);
  // Two ids (an old caller): never a U.
  assert.equal(newCounters(p, { x: 15, y: 100 }, { x: 225, y: 100 }, ['l', 'm']).length, 1);
});

test('an L with wall cabinets on both runs gets one 24" corner wall cabinet, not two overlapping runs', () => {
  const p = kitchen(newCounters(kitchen(), { x: 60, y: 15 }, { x: 225, y: 100 }, ['a', 'b']));
  const [cu] = cornerUppers(p);
  assert.equal(cornerUppers(p).length, 1);
  assert.equal(cu.outline.length, 5);
  assert.deepEqual(cu.outline[0], { x: 236.75, y: 3.25 });
  // Each run's wall cabinets stop 24" short of the corner.
  const [top, right] = p.counters;
  assert.deepEqual(upperSpans(p, top).map(([s, e]) => [Math.round(s * 4) / 4, Math.round(e * 4) / 4]), [[0, counterLength(top) - 24]]);
  assert.deepEqual(upperSpans(p, right).map(([s, e]) => [s, Math.round(e * 4) / 4]), [[24, Math.round(counterLength(right) * 4) / 4]]);
  assert.equal(qty(p, 'Corner wall cabinet (allowance)'), 1);
  // Uppers off on one run: no corner unit, the other run's uppers go into the corner.
  const off = { ...p, counters: [{ ...top, uppers: false }, right] };
  assert.equal(cornerUppers(off).length, 0);
  assert.equal(upperSpans(off, right)[0][0], 0);
  // Two boxes in 3D for the corner unit, one along each wall.
  assert.ok(buildScene(p).boxes.filter((b) => b.kind === 'counter' && b.size[0] === 24 && b.size[2] === 12).length >= 2);
});

/** An island 10' long, 36" deep with 12" of seating at its front (+y), its back edge at y. */
const island = (y: number, extra: Partial<Counter> = {}): Counter => ({ id: 'i', a: { x: 60, y }, b: { x: 180, y }, depth: 36, side: -1, island: true, cutouts: [], seating: 12, ...extra });

test('behind seated diners: 44" to walk past, 36" to edge past, 32" with no one passing (NKBA)', () => {
  const rule = (p: Project) => kitchenChecks(p).find((c) => c.rule.startsWith('Clearance behind seated diners'))!;
  // Front edge at y = 96; the wall face at 140.75.
  const front = island(60);
  assert.ok(counterCorners(front).every((q) => q.y >= 60 - 1e-9 && q.y <= 96 + 1e-9));
  assert.equal(dinerClearance(kitchen([front]), front), 44.75);
  assert.deepEqual([rule(kitchen([front])).status, rule(kitchen([front])).message], ['pass', `Kitchen: 3' 8-3/4" from the seating edge — room to walk past behind them`]);
  assert.equal(rule(kitchen([island(68)])).status, 'pass'); // 36-3/4": edge past
  assert.match(rule(kitchen([island(68)])).message, /room to edge past; 44" to walk past/);
  assert.equal(rule(kitchen([island(72)])).status, 'info'); // 32-3/4": no one passing
  assert.equal(rule(kitchen([island(80)])).status, 'warn'); // 24-3/4"
  // A counter behind the stools counts as well as a wall.
  const run: Counter = { id: 'r', a: { x: 3.25, y: 140.75 }, b: { x: 236.75, y: 140.75 }, depth: 25, side: 1, island: false, cutouts: [] };
  const withRun = kitchen([front, { ...run, side: counterCorners(run).every((q) => q.y <= 140.75 + 1e-9) ? 1 : -1 }]);
  assert.equal(Math.round(dinerClearance(withRun, front) * 4) / 4, 19.75);
});

test('bar-height seating: 42" top, 12" of knee space is enough', () => {
  const knee = (c: Counter) => kitchenChecks(kitchen([c])).find((x) => x.rule.startsWith('Seating knee space'))!;
  assert.equal(knee(island(60)).status, 'warn');
  const bar = island(60, { bar: true });
  assert.deepEqual([knee(bar).status, knee(bar).rule], ['pass', 'Seating knee space (12" deep, 24" per seat)']);
  assert.match(knee(bar).message, /at bar height \(42"\)/);
  const tops = buildScene(kitchen([bar])).boxes.filter((b) => b.kind === 'counter').map((b) => b.c[1] + b.size[1] / 2);
  assert.ok(tops.includes(42));
});

test('cabinet-by-cabinet layout: stock widths in 3" steps up to 36", a sink base, fillers at the wall', () => {
  assert.deepEqual(fillStretch(72), [36, 36]);
  assert.deepEqual(fillStretch(100), [33, 33, 33]);
  assert.deepEqual(fillStretch(45), [24, 21]);
  assert.deepEqual(fillStretch(8), []);
  const run: Counter = { id: 'r', a: { x: 3.25, y: 3.25 }, b: { x: 120, y: 3.25 }, depth: 25, side: -1, island: false, cutouts: [{ id: 's', kind: 'sink', offset: 60, width: 33 }] };
  const p = kitchen([run]);
  assert.ok(counterCorners(run).every((q) => q.y >= 3.25 - 1e-9));
  assert.deepEqual(cabinetLayout(p, run).map((k) => k.label), ['Filler 1-1/2"', 'B21', 'B21', 'SB33', 'B21', 'B18', 'Filler 1-1/4"']);
  // Slots tile the run.
  const slots = cabinetLayout(p, run);
  assert.equal(slots[0].s, 0);
  assert.ok(Math.abs(slots.at(-1)!.e - counterLength(run)) < 1e-9);
  for (let i = 1; i < slots.length; i++) assert.ok(Math.abs(slots[i].s - slots[i - 1].e) < 1e-9);
  assert.equal(qty(p, 'Cabinet filler strips (allowance)'), 2);
  assert.ok(estimate(counterLines(p)).lines.every((l) => l.unitPrice > 0));
  // An L: the corner unit sits in the corner square of both runs.
  const L = kitchen(newCounters(kitchen(), { x: 60, y: 15 }, { x: 225, y: 100 }, ['a', 'b']));
  assert.ok(L.counters.every((c) => cabinetLayout(L, c).some((k) => k.kind === 'corner' && k.label === 'Corner (lazy susan)')));
});
