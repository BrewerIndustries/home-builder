import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cornerCabinets, counterCorners, counterLines, counterOverlaps, counterSpaces, flipCounter, newCounter, newCounters, seats, upperSpans } from '../src/calc/counters.ts';
import { fixtureSchedule } from '../src/calc/furniture.ts';
import { ircChecks } from '../src/calc/irc.ts';
import { kitchenChecks } from '../src/calc/kitchen.ts';
import { buildScene } from '../src/calc/model3d.ts';
import { estimate } from '../src/calc/pricing.ts';
import { projectReducer } from '../src/model/store.ts';
import type { Counter, Project } from '../src/model/types.ts';
import { box, project } from './helpers.ts';

/** A 20' × 12' kitchen (6-1/2" walls: inside faces at 3.25 and 236.75 / 140.75). */
const kitchen = (counters: Counter[] = []): Project =>
  project(box(240, 144), [], { rooms: [{ id: 'K', name: 'Kitchen', type: 'kitchen', points: [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 144 }, { x: 0, y: 144 }] }], counters });

const qty = (p: Project, item: string) => counterLines(p).find((l) => l.item === item)?.qty ?? 0;

test('one drag round a corner makes an L: a run on each wall sharing the corner square', () => {
  const p = kitchen();
  const [top, right] = newCounters(p, { x: 60, y: 15 }, { x: 225, y: 100 }, ['a', 'b']);
  assert.deepEqual([top.a, top.b], [{ x: 60, y: 3.25 }, { x: 236.75, y: 3.25 }]);
  assert.deepEqual([right.a, right.b], [{ x: 236.75, y: 3.25 }, { x: 236.75, y: 100 }]);
  assert.ok(!top.island && !right.island);
  // Both fronts face into the room.
  assert.ok(counterCorners(top).every((q) => q.y >= 3.25 && q.y <= 28.25 + 1e-9));
  assert.ok(counterCorners(right).every((q) => q.x <= 236.75 + 1e-9 && q.x >= 211.75 - 1e-9));
  const withL = projectReducer(p, { type: 'addCounters', counters: [top, right] });
  assert.equal(Math.round(counterOverlaps(withL)[0].area), 625);
  // Ending still by the first wall: one straight run. Ending in open floor: one run too.
  assert.equal(newCounters(p, { x: 60, y: 15 }, { x: 200, y: 20 }, ['a', 'b']).length, 1);
  assert.equal(newCounters(p, { x: 60, y: 15 }, { x: 120, y: 90 }, ['a', 'b']).length, 1);
  // Open floor start: an island.
  const [isl] = newCounters(p, { x: 80, y: 60 }, { x: 160, y: 96 }, ['a', 'b']);
  assert.ok(isl.island);
});

test('corner cabinets: an L corner is a lazy susan unless set to blind; a peninsula meets a run at a blind corner', () => {
  const p = kitchen(newCounters(kitchen(), { x: 60, y: 15 }, { x: 225, y: 100 }, ['a', 'b']));
  const [corner] = cornerCabinets(p);
  assert.deepEqual([corner.kind, Math.round(corner.size)], ['lazy-susan', 25]);
  assert.equal(qty(p, 'Corner base cabinet, lazy susan (allowance)'), 1);
  // Runs 176.75" + 96.75", less the corner square twice (shared, then priced as the corner unit).
  assert.equal(qty(p, 'Base cabinets (allowance)'), Math.ceil(((176.75 + 96.75 - 50) / 12) * 2) / 2);
  const blind = projectReducer(p, { type: 'updateCounter', id: 'b', patch: { corner: 'blind' } });
  assert.equal(qty(blind, 'Corner base cabinet, blind corner (allowance)'), 1);
  assert.equal(qty(blind, 'Corner base cabinet, lazy susan (allowance)'), 0);
  // A peninsula started on the top run, running down into the room.
  const top = p.counters[0];
  const pen = newCounter({ ...p, counters: [top] }, { x: 80, y: 10 }, { x: 116, y: 100 }, 'pen');
  assert.ok(pen.island);
  assert.equal(cornerCabinets({ ...p, counters: [top, pen] })[0].kind, 'blind');
  assert.ok(estimate(counterLines(blind)).lines.every((l) => l.unitPrice > 0));
});

test('tall pantry and oven cabinets split the countertop, skip wall cabinets and stand full height', () => {
  const [run] = newCounters(kitchen(), { x: 20, y: 15 }, { x: 200, y: 15 }, ['r', 'x']);
  const c: Counter = { ...run, cutouts: [{ id: 'p', kind: 'pantry', offset: 12, width: 24 }, { id: 'o', kind: 'oven', offset: 60, width: 30 }] };
  const p = kitchen([c]);
  const len = c.b.x - c.a.x;
  assert.deepEqual(counterSpaces(c), [[24, 45], [75, len]]);
  assert.deepEqual(upperSpans(p, c), [[24, 45], [75, len]]);
  assert.equal(qty(p, 'Tall pantry cabinet (allowance)'), 1);
  assert.equal(qty(p, 'Wall oven cabinet (allowance)'), 1);
  assert.equal(qty(p, 'Wall oven (allowance)'), 1);
  assert.equal(qty(p, 'Base cabinets (allowance)'), Math.ceil(((len - 54) / 12) * 2) / 2);
  assert.equal(qty(p, 'Countertop (allowance)'), Math.ceil(((len - 54) * 25) / 144));
  assert.equal(buildScene(p).boxes.filter((b) => b.kind === 'counter' && b.size[1] === 84).length, 2);
  // The oven gets the NKBA landing check; the pantry doesn't.
  assert.deepEqual(kitchenChecks(p).filter((k) => k.rule.startsWith('Landing area')).map((k) => k.rule), ['Landing area beside the wall oven']);
  // Scheduled as OV-1; a pantry is a cabinet, not a fixture.
  assert.deepEqual(fixtureSchedule(p).map((r) => r.mark), ['OV-1']);
});

test('island seating: overhang drawn as knee space, a stool per 24", NKBA wants 15"', () => {
  const isl = newCounter(kitchen(), { x: 70, y: 60 }, { x: 166, y: 96 }, 'i');
  assert.deepEqual([isl.island, isl.b.x - isl.a.x, isl.depth], [true, 96, 36]);
  const p = kitchen([{ ...isl, seating: 12 }]);
  assert.deepEqual(seats(p, p.counters[0]), [12, 36, 60, 84]);
  const knee = kitchenChecks(p).find((c) => c.rule.startsWith('Seating knee space'))!;
  assert.equal(knee.status, 'warn');
  assert.match(knee.message, /1' 0" overhang, 4 seats — wants 15"/);
  const ok = kitchen([{ ...isl, seating: 15 }]);
  assert.equal(kitchenChecks(ok).find((c) => c.rule.startsWith('Seating knee space'))!.status, 'pass');
  // 3D: cabinets 21" deep plus a 1-1/2" top over the overhang.
  const boxes = buildScene(ok).boxes.filter((b) => b.kind === 'counter');
  assert.deepEqual(boxes.map((b) => b.size), [[96, 36, 21], [96, 1.5, 15]]);
  assert.equal(qty(ok, 'Countertop support brackets (allowance)'), 4);
  // No seating, no check.
  assert.ok(!kitchenChecks(kitchen([isl])).some((c) => c.rule.startsWith('Seating')));
  // Flipping keeps the same footprint, front the other way.
  const f = { ...isl, ...flipCounter(isl) };
  const key = (c: Counter) => counterCorners(c).map((q) => `${q.x},${q.y}`).sort().join(' ');
  assert.equal(key(f), key(isl));
  assert.notEqual(f.side, isl.side);
});

test('the island receptacle note shows before any outlets are placed', () => {
  const isl = newCounter(kitchen(), { x: 70, y: 60 }, { x: 166, y: 96 }, 'i');
  const checks = ircChecks(kitchen([isl]));
  assert.ok(checks.some((c) => c.rule === 'Receptacles' && c.status === 'info'));
  const note = checks.find((c) => c.rule === 'Island receptacle')!;
  assert.match(note.message, /2 receptacles included in the estimate|1 receptacle included in the estimate/);
});
