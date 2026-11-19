import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cabinetJoints, grabJoint, jointInset, moveJoint, resetWidths, setCabinetType } from '../src/calc/cabinets.ts';
import { cabinetLayout, counterLength, counterLines, counterPoint, kneeSpaceFor, newCounters, plannedWidths, raisedDepth, upperLayout } from '../src/calc/counters.ts';
import { kitchenChecks } from '../src/calc/kitchen.ts';
import { buildScene } from '../src/calc/model3d.ts';
import { estimate, samplePrice } from '../src/calc/pricing.ts';
import type { Counter, Project } from '../src/model/types.ts';
import { box, project } from './helpers.ts';

/** A 20' × 12' kitchen (6-1/2" walls: inside faces at 3.25 and 236.75 / 140.75). */
const kitchen = (counters: Counter[] = []): Project =>
  project(box(240, 144), [], { rooms: [{ id: 'K', name: 'Kitchen', type: 'kitchen', points: [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 144 }, { x: 0, y: 144 }] }], counters });
const lines = (p: Project) => counterLines(p);
const qty = (p: Project, item: string) => lines(p).find((l) => l.item === item)?.qty ?? 0;
/** A 60" wall counter on the top wall, front into the room. */
const run = (extra: Partial<Counter> = {}): Counter => ({ id: 'r', a: { x: 3.25, y: 3.25 }, b: { x: 63.25, y: 3.25 }, depth: 25, side: -1, island: false, cutouts: [], ...extra });
const labels = (p: Project, c: Counter) => cabinetLayout(p, c).map((k) => k.label);
const tiles = (slots: { s: number; e: number }[], from: number, to: number) => {
  assert.ok(Math.abs(slots[0].s - from) < 1e-9);
  assert.ok(Math.abs(slots.at(-1)!.e - to) < 1e-9);
  for (let i = 1; i < slots.length; i++) assert.ok(Math.abs(slots[i].s - slots[i - 1].e) < 1e-9);
};

test('wall cabinets are laid out by width too, labelled width then height; 30" / 36" / 42" tall', () => {
  const c = run();
  const p = kitchen([c]);
  assert.deepEqual(upperLayout(p, c).map((k) => k.label), ['W3030', 'W3030']);
  tiles(upperLayout(p, c), 0, 60);
  const tall = run({ upperHeight: 42 });
  const pt = kitchen([tall]);
  assert.deepEqual(upperLayout(pt, tall).map((k) => k.label), ['W3042', 'W3042']);
  // In 3D the uppers grow upward from the same 54" bottom.
  const uppers = buildScene(pt).boxes.filter((b) => b.kind === 'counter' && b.size[2] === 12);
  assert.ok(uppers.length > 0 && uppers.every((b) => b.size[1] === 42 && b.c[1] - b.size[1] / 2 === 54));
  // An island has none.
  const isl: Counter = { id: 'i', a: { x: 60, y: 60 }, b: { x: 132, y: 60 }, depth: 36, side: -1, island: true, cutouts: [] };
  assert.deepEqual(upperLayout(kitchen([isl]), isl), []);
});

test('dragging a cabinet joint resizes its neighbours in 3" steps, each kept 9"–36"', () => {
  const c = run();
  const p = kitchen([c]);
  assert.deepEqual(labels(p, c), ['B30', 'B30']);
  const [j] = cabinetJoints(p, c, 'base');
  assert.deepEqual([j.t, j.stretch, j.index], [30, 0, 0]);
  // The handle sits just inside the cabinet face; grabbing near it finds the joint.
  assert.deepEqual(grabJoint(p, c, counterPoint(c, 31, jointInset(c, 'base')), 3), j);
  assert.equal(grabJoint(p, c, counterPoint(c, 45, jointInset(c, 'base')), 3), null);
  const moved = { ...c, ...moveJoint(p, c, j, 37)! };
  assert.deepEqual(moved.cabinets?.base, [[36, 24]]);
  assert.deepEqual(labels(kitchen([moved]), moved), ['B36', 'B24']);
  tiles(cabinetLayout(kitchen([moved]), moved), 0, 60);
  // Past the limits it stops at 36" / 9"... and the other way round too.
  assert.deepEqual(moveJoint(p, c, j, 80)!.cabinets?.base, [[36, 24]]);
  assert.deepEqual(moveJoint(p, c, j, -40)!.cabinets?.base, [[24, 36]]);
  assert.equal(moveJoint(p, c, j, 31), null); // under half a step: nothing
  // Wall cabinets drag the same way, independently.
  const [ju] = cabinetJoints(p, c, 'upper');
  const up = { ...c, ...moveJoint(p, c, ju, 24)! };
  assert.deepEqual(upperLayout(kitchen([up]), up).map((k) => k.label), ['W2430', 'W3630']);
  assert.deepEqual(labels(kitchen([up]), up), ['B30', 'B30']);
  // Back to stock widths.
  const reset = { ...moved, ...resetWidths(moved) };
  assert.deepEqual(labels(kitchen([reset]), reset), ['B30', 'B30']);
});

test('dragged widths that no longer fit their stretch fall back to the stock fill', () => {
  assert.deepEqual(plannedWidths(60, [36, 24]), [36, 24]);
  assert.deepEqual(plannedWidths(62, [36, 24]), [36, 24]); // 2" short: a filler
  assert.equal(plannedWidths(59, [36, 24]), null); // too long
  assert.equal(plannedWidths(80, [36, 24]), null); // a cabinet's worth short
  assert.equal(plannedWidths(60, [51, 9]), null); // not a stock width
  // A sink added mid-run splits the stretch: the old widths no longer fit, stock fill instead.
  const c = run({ cabinets: { base: [[36, 24]] }, cutouts: [{ id: 's', kind: 'sink', offset: 30, width: 30 }] });
  const p = kitchen([c]);
  assert.deepEqual(labels(p, c), ['B15', 'SB30', 'B15']);
});

test('per-cabinet types: drawer base, trash pull-out, sink base — priced from the layout, not by the foot', () => {
  let c = run();
  c = { ...c, ...setCabinetType(c, 0, 0, 'drawer') };
  c = { ...c, ...setCabinetType(c, 0, 1, 'trash') };
  const p = kitchen([c]);
  assert.deepEqual(labels(p, c), ['DB30', 'TR30']);
  assert.equal(qty(p, 'Base cabinets (allowance)'), 0);
  assert.equal(qty(p, 'Wall cabinets (allowance)'), 0);
  assert.equal(qty(p, 'Drawer base DB30 (allowance)'), 1);
  assert.equal(qty(p, 'Trash pull-out base TR30 (allowance)'), 1);
  assert.equal(qty(p, 'Wall cabinet W3030 (allowance)'), 2);
  // Every line has a sample price, and a wider cabinet costs more.
  assert.ok(estimate(lines(p)).lines.every((l) => l.unitPrice > 0));
  assert.ok(samplePrice('Base cabinet B36 (allowance)') > samplePrice('Base cabinet B18 (allowance)'));
  assert.ok(samplePrice('Wall cabinet W3042 (allowance)') > samplePrice('Wall cabinet W3030 (allowance)'));
  // Standard clears the type; a sink-base pick prices as one.
  const back = { ...c, ...setCabinetType(c, 0, 0, 'standard') };
  assert.deepEqual(labels(kitchen([back]), back), ['B30', 'TR30']);
  assert.deepEqual(back.cabinets?.types, { '0.1': 'trash' });
  const sb = { ...c, ...setCabinetType(c, 0, 0, 'sink') };
  assert.equal(qty(kitchen([sb]), 'Sink base SB30 (allowance)'), 1);
  // A sink cutout's cabinet prices as a sink base too.
  const withSink = run({ cabinets: {}, cutouts: [{ id: 's', kind: 'sink', offset: 30, width: 33 }] });
  assert.equal(qty(kitchen([withSink]), 'Sink base SB33 (allowance)'), 1);
});

test('old projects (no cabinet plan) price exactly as before; a mixed L splits the run', () => {
  const p = kitchen([run()]);
  assert.equal(qty(p, 'Base cabinets (allowance)'), 5);
  assert.equal(qty(p, 'Wall cabinets (allowance)'), 5);
  assert.ok(!lines(p).some((l) => /^Base cabinet |^Wall cabinet W/.test(l.item)));
  // An L: one run laid out, the other by the foot — the corner square is in neither.
  const L = newCounters(kitchen(), { x: 60, y: 15 }, { x: 225, y: 100 }, ['a', 'b']);
  const mixed = kitchen([{ ...L[0], cabinets: {} }, L[1]]);
  const [lenA, lenB] = L.map(counterLength);
  const sq = 25;
  assert.equal(qty(mixed, 'Base cabinets (allowance)'), Math.ceil(((lenB - sq) / 12) * 2) / 2);
  const laid = cabinetLayout(mixed, mixed.counters[0]).filter((k) => k.kind === 'base');
  assert.equal(lines(mixed).filter((l) => /^Base cabinet [A-Z]/.test(l.item)).reduce((s, l) => s + l.qty, 0), laid.length);
  assert.ok(laid.reduce((s, k) => s + k.e - k.s, 0) <= lenA - sq + 1e-6);
  assert.equal(qty(mixed, 'Corner base cabinet, lazy susan (allowance)'), 1);
});

test('two-level island: 36" work side, 42" bar ledge over the seating with 12" knee space', () => {
  const isl: Counter = { id: 'i', a: { x: 60, y: 60 }, b: { x: 180, y: 60 }, depth: 36, side: -1, island: true, cutouts: [], seating: 12, twoLevel: true };
  const p = kitchen([isl]);
  assert.equal(kneeSpaceFor(isl), 12);
  assert.equal(raisedDepth(isl), 18);
  assert.equal(raisedDepth({ ...isl, seating: undefined }), 0);
  assert.equal(raisedDepth({ ...isl, twoLevel: undefined }), 0);
  const knee = kitchenChecks(p).find((x) => x.rule.startsWith('Seating knee space'))!;
  assert.equal(knee.status, 'pass');
  assert.match(knee.message, /at the 42" bar side/);
  // 3D: cabinets at 36", a 6" riser to 42", the overhang slab at 42".
  const boxes = buildScene(p).boxes.filter((b) => b.kind === 'counter');
  const tops = boxes.map((b) => b.c[1] + b.size[1] / 2);
  assert.ok(tops.includes(36) && tops.includes(42));
  assert.ok(boxes.some((b) => b.size[1] === 6 && b.size[2] === 6));
  assert.equal(qty(p, 'Two-level island riser (allowance)'), 10);
  assert.ok(estimate(lines(p)).lines.every((l) => l.unitPrice > 0));
  // The island's base cabinets are laid out under the work side only (the overhang has none) — unchanged by two-level.
  assert.deepEqual(labels(p, isl), labels(kitchen([{ ...isl, twoLevel: undefined }]), { ...isl, twoLevel: undefined }));
});
