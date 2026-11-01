import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autoOutlets, layoutRun, spacingGaps } from '../src/calc/electrical.ts';
import { ircChecks } from '../src/calc/irc.ts';
import { projectReducer } from '../src/model/store.ts';
import type { Room } from '../src/model/types.ts';
import { box, door, project } from './helpers.ts';

const room = (type: Room['type'], w = 240, h = 144): Room => ({
  id: 'r1', name: 'R', type,
  points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }],
});

test('even spacing keeps gaps ≤ 12 ft and ends ≤ 6 ft', () => {
  const pos = layoutRun({ start: 0, length: 300 }, 144);
  assert.equal(pos.length, 3);
  assert.equal(pos[0], 50);
  assert.ok(pos[1] - pos[0] <= 144);
  assert.deepEqual(layoutRun({ start: 0, length: 20 }, 144), []); // < 2 ft wall space
});

test('auto-placed bedroom passes E3901.2; removing outlets fails it', () => {
  const walls = box(240, 144);
  let p = project(walls, [door(walls[0].id, 120)], { rooms: [room('bedroom')] });
  const outlets = autoOutlets(p);
  assert.ok(outlets.length >= 4);
  assert.ok(outlets.every((o) => o.side !== undefined && o.auto));
  p = projectReducer(p, { type: 'replaceAutoOutlets', outlets });
  const g = spacingGaps(p, p.rooms[0]);
  assert.ok(!g.uncovered && g.worst <= 144.5, `worst ${g.worst}`);
  assert.equal(ircChecks(p).find((c) => c.section === 'E3901.2')!.status, 'pass');
  p = projectReducer(p, { type: 'delete', ids: p.outlets.slice(0, 2).map((o) => o.id) });
  assert.equal(ircChecks(p).find((c) => c.section === 'E3901.2')!.status, 'fail');
});

test('kitchens get GFCIs at countertop spacing; manual outlets survive a re-run', () => {
  const walls = box(240, 144);
  let p = project(walls, [], { rooms: [room('kitchen')] });
  p = projectReducer(p, { type: 'addOutlet', outlet: { id: 'manual', wallId: walls[0].id, offset: 30, side: 1, kind: '240v', height: 16, auto: false } });
  p = projectReducer(p, { type: 'replaceAutoOutlets', outlets: autoOutlets(p) });
  const auto = p.outlets.filter((o) => o.auto);
  assert.ok(auto.length >= Math.ceil((2 * (240 + 144)) / 48));
  assert.ok(auto.every((o) => o.kind === 'gfci'));
  p = projectReducer(p, { type: 'replaceAutoOutlets', outlets: autoOutlets(p) });
  assert.ok(p.outlets.some((o) => o.id === 'manual'));
});
