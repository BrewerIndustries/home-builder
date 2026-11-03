import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autoOutlets } from '../src/calc/electrical.ts';
import { ircChecks } from '../src/calc/irc.ts';
import { materialsList } from '../src/calc/materials.ts';
import { autoOutdoor, outdoorOutlets } from '../src/calc/outdoor.ts';
import { pointAlong } from '../src/model/geometry.ts';
import { projectReducer } from '../src/model/store.ts';
import { box, door, project } from './helpers.ts';

/** 40' × 30' house, a room filling it, the front door on the bottom wall. */
function house() {
  const walls = box(480, 360);
  const bottom = walls.find((w) => w.a.y === 360 && w.b.y === 360)!;
  const rooms = [{ id: 'R', name: 'Living', type: 'living' as const, points: [{ x: 0, y: 0 }, { x: 480, y: 0 }, { x: 480, y: 360 }, { x: 0, y: 360 }] }];
  return { p: project(walls, [{ ...door(bottom.id, 240), id: 'front' }], { rooms }), walls, bottom };
}

const outdoorChecks = (p: ReturnType<typeof house>['p']) => ircChecks(p).filter((c) => c.section === 'E3901.7');

test('no outdoor receptacles fails front and back', () => {
  const { p } = house();
  assert.deepEqual(outdoorChecks(p).map((c) => c.status), ['fail', 'fail']);
});

test('auto layout puts one GFCI outside the front (beside the door) and one at the back', () => {
  const { p, bottom } = house();
  const out = autoOutdoor(p);
  assert.equal(out.length, 2);
  const front = out.find((o) => o.wallId === bottom.id)!;
  // Beside the 36" door at 240: 18" past its edge, outside (below the wall).
  assert.equal(Math.abs(front.offset - 240), 18 + 18);
  const at = pointAlong(bottom, front.offset);
  assert.equal(at.y, 360);
  assert.ok(out.every((o) => o.kind === 'gfci' && o.height === 18));

  const q = projectReducer(p, { type: 'replaceAutoOutlets', outlets: autoOutlets(p) });
  assert.deepEqual(outdoorOutlets(q).map((f) => f.facing).sort(), ['back', 'front']);
  assert.deepEqual(outdoorChecks(q).map((c) => c.status), ['pass', 'pass']);
  // Indoor spacing is unaffected: outdoor receptacles don't count for the room.
  assert.equal(ircChecks(q).find((c) => c.section === 'E3901.2')!.status, 'pass');
  assert.equal(materialsList(q).find((l) => l.item.startsWith('In-use'))!.qty, 2);
});

test('front follows the Project setting; a non-GFCI or high outdoor receptacle warns', () => {
  const { p, walls } = house();
  const left = walls.find((w) => w.a.x === 0 && w.b.x === 0)!;
  let q = projectReducer(p, { type: 'setElectrical', patch: { front: 'left' } });
  const out = autoOutdoor(q);
  assert.ok(out.some((o) => o.wallId === left.id));
  // The outer side of the left wall, as a hand-placed duplex way up high.
  q = { ...q, outlets: [{ ...out.find((o) => o.wallId === left.id)!, kind: 'duplex', height: 84, auto: false }] };
  const checks = outdoorChecks(q);
  assert.deepEqual(checks.filter((c) => c.rule.startsWith('Outdoor receptacle at')).map((c) => c.status), ['pass', 'fail']);
  assert.ok(checks.some((c) => c.rule === 'Outdoor receptacle height' && c.status === 'warn'));
  assert.ok(ircChecks(q).some((c) => c.section === 'E3902' && c.message.includes('outdoor')));
});
