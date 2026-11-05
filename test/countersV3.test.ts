import assert from 'node:assert/strict';
import { test } from 'node:test';
import { counterOverlaps, freeSpaces, islandReceptacles, newCounter, peninsulaJoin, upperSpans } from '../src/calc/counters.ts';
import { kitchenChecks, landing } from '../src/calc/kitchen.ts';
import { materialsList } from '../src/calc/materials.ts';
import { projectReducer } from '../src/model/store.ts';
import type { Counter, Project } from '../src/model/types.ts';
import { box, project, window_ } from './helpers.ts';

/** 16' × 12' kitchen: a 10' counter on the top wall from the left corner, and one down the left wall (an L). */
function kitchen(): { p: Project; top: Counter; left: Counter } {
  let p = project(box(192, 144), [], {
    rooms: [{ id: 'K', name: 'Kitchen', type: 'kitchen', points: [{ x: 0, y: 0 }, { x: 192, y: 0 }, { x: 192, y: 144 }, { x: 0, y: 144 }] }],
  });
  const h = p.walls[0].thickness / 2;
  // Both run from the inside corner; a → b's left-hand normal is up for +x, so the top one fronts down (side −1).
  const top: Counter = { id: 'top', a: { x: h, y: h }, b: { x: 120, y: h }, depth: 25, side: -1, island: false, cutouts: [] };
  const left: Counter = { id: 'left', a: { x: h, y: h }, b: { x: h, y: 100 }, depth: 25, side: 1, island: false, cutouts: [] };
  p = projectReducer(projectReducer(p, { type: 'addCounter', counter: top }), { type: 'addCounter', counter: left });
  return { p, top, left };
}

const qty = (p: Project, item: string) => materialsList(p).find((l) => l.item === item)?.qty ?? 0;

test('an L shares its corner square: the top and cabinets are not counted twice', () => {
  const { p, top, left } = kitchen();
  const o = counterOverlaps(p);
  assert.equal(o.length, 1);
  assert.equal(Math.round(o[0].area), 25 * 25);
  const lenTop = 120 - top.a.x;
  const lenLeft = 100 - left.a.y;
  assert.equal(qty(p, 'Countertop (allowance)'), Math.ceil(((lenTop + lenLeft) * 25 - 625) / 144));
  // The corner square is one cabinet, priced as a corner unit (Counters v4), so it leaves the run entirely.
  assert.equal(qty(p, 'Base cabinets (allowance)'), Math.ceil(((lenTop + lenLeft - 50) / 12) * 2) / 2);
  assert.equal(qty(p, 'Corner base cabinet, lazy susan (allowance)'), 1);
});

test('a sink in the corner warns; landing area carries on round the corner', () => {
  const { p, top } = kitchen();
  let q = projectReducer(p, { type: 'updateCounter', id: top.id, patch: { cutouts: [{ id: 's', kind: 'sink', offset: 20, width: 33 }] } });
  assert.ok(kitchenChecks(q).some((c) => c.rule === 'Appliance in the corner'));
  q = projectReducer(p, { type: 'updateCounter', id: top.id, patch: { cutouts: [{ id: 's', kind: 'sink', offset: 50, width: 33 }] } });
  assert.ok(!kitchenChecks(q).some((c) => c.rule === 'Appliance in the corner'));
  const c = q.counters.find((x) => x.id === top.id)!;
  const [l, r] = landing(q, c, c.cutouts[0]);
  assert.equal(l, Infinity);
  assert.ok(Math.abs(r - (c.b.x - c.a.x - 66.5)) < 0.01);
  assert.equal(kitchenChecks(q).find((x) => x.rule.startsWith('Landing area beside the sink'))!.status, 'pass');
});

test('a range jammed against the end of a run warns its landing area', () => {
  const { p, left } = kitchen();
  const len = 100 - left.a.y;
  const q = projectReducer(p, { type: 'updateCounter', id: left.id, patch: { cutouts: [{ id: 'r', kind: 'range', offset: len - 20, width: 30 }] } });
  const c = kitchenChecks(q).find((x) => x.rule.startsWith('Landing area beside the range'))!;
  assert.equal(c.status, 'warn', c.message);
});

test('a drag off a wall counter makes a peninsula, measured from its connecting edge', () => {
  let { p, top } = kitchen();
  // Lengthen the top counter to x = 186, then drag from inside it down into the room: 3' wide, to y = 96.
  p = projectReducer(p, { type: 'updateCounter', id: top.id, patch: { b: { x: 186, y: top.b.y } } });
  const pen = newCounter(p, { x: 140, y: 10 }, { x: 176, y: 96 }, 'pen');
  assert.equal(pen.island, true);
  p = projectReducer(p, { type: 'addCounter', counter: pen });
  const join = peninsulaJoin(p, p.counters.find((c) => c.id === 'pen')!)!;
  assert.equal(join.end, 'a');
  // 96 − 10 = 86 long; the part over the wall counter (to its front at 3.25 + 25) doesn't count.
  const spaces = freeSpaces(p, p.counters.find((c) => c.id === 'pen')!);
  assert.equal(Math.round(spaces[0][1] - spaces[0][0]), Math.round(96 - (top.a.y + 25)));
  assert.equal(islandReceptacles(p).length, 1);
});

test('wall cabinets skip windows and the range; they can be turned off', () => {
  let { p, top } = kitchen();
  const wall = p.walls[0]; // runs +x from (0,0)
  p = { ...p, openings: [{ ...window_(wall.id, 80, 36), id: 'w' }] };
  p = projectReducer(p, { type: 'updateCounter', id: top.id, patch: { cutouts: [{ id: 'r', kind: 'range', offset: 30, width: 30 }] } });
  const c = p.counters.find((x) => x.id === top.id)!;
  const a = c.a.x;
  // Range 15–45 along the counter; the window's 62–98 on the wall is 58.75–94.75 along the counter (which starts at x = 3.25).
  assert.equal(a, 3.25);
  assert.deepEqual(upperSpans(p, c).map(([s, e]) => [Math.round(s), Math.round(e)]), [[0, 15], [45, 59], [95, 117]]);
  assert.equal(qty(p, 'Range hood (allowance)'), 1);
  assert.ok(qty(p, 'Wall cabinets (allowance)') > 0);
  p = projectReducer(p, { type: 'updateCounter', id: top.id, patch: { uppers: false } });
  p = projectReducer(p, { type: 'updateCounter', id: 'left', patch: { uppers: false } });
  assert.equal(qty(p, 'Wall cabinets (allowance)'), 0);
});
