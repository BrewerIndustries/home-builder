import assert from 'node:assert/strict';
import { test } from 'node:test';
import { doorSweeps } from '../src/calc/furniture.ts';
import { framingTakeoff } from '../src/calc/framing.ts';
import { ircChecks } from '../src/calc/irc.ts';
import { materialsList } from '../src/calc/materials.ts';
import { wallBoxes } from '../src/calc/model3d.ts';
import { doorLeaves } from '../src/calc/doors3d.ts';
import { isOpenWay, type Opening } from '../src/model/types.ts';
import { box, project } from './helpers.ts';

const walls = box(240, 180);
// As the Opening tool makes them (newOpening in PlanCanvas.tsx).
const way = (patch: Partial<Opening> = {}): Opening => ({ id: 'p1', wallId: walls[0].id, kind: 'door', width: 36, offset: 120, height: 80, sill: 0, operation: 'open', ...patch });

test('the Opening tool makes a doorless door: no leaf, no swing, framed like a door', () => {
  const o = way();
  assert.ok(isOpenWay(o));
  assert.equal(o.sill, 0);
  assert.equal(o.swing, undefined);
  const p = project(walls, [o]);
  assert.deepEqual(doorSweeps(p, o), []);
  assert.deepEqual(doorLeaves(p, o), []);
  const f = framingTakeoff(p).walls[0];
  assert.ok(f.headers.length === 1 && f.king >= 2 && f.jack >= 2);
});

test('openings are trim kits in the estimate, not schedule doors, and never the egress door', () => {
  const lines = materialsList(project(walls, [way({ width: 72, height: 96 }), way({ id: 'p2', offset: 40, arch: 18 })]));
  assert.ok(!lines.some((l) => l.category === 'Openings' && /^Door /.test(l.item)));
  assert.equal(lines.find((l) => l.item.startsWith('Cased opening trim kit'))?.qty, 1);
  assert.equal(lines.find((l) => l.item.startsWith('Arched opening kit'))?.qty, 1);
  const egress = ircChecks(project(walls, [way()])).find((c) => c.section === 'R311.2');
  assert.equal(egress?.status, 'fail');
});

test('an arch fills the corners under the head in 3D', () => {
  const square = wallBoxes(project(walls, [way()])).length;
  const arched = wallBoxes(project(walls, [way({ arch: 18 })])).length;
  assert.ok(arched > square);
});
