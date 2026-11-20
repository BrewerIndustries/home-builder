import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ActionError, applyActions, planSummary, report } from '../src/api/engine.ts';
import { newProject } from '../src/model/assembly.ts';

const rect = (x0: number, y0: number, x1: number, y1: number, kind = 'exterior') => [
  { a: { x: x0, y: y0 }, b: { x: x1, y: y0 }, kind },
  { a: { x: x1, y: y0 }, b: { x: x1, y: y1 }, kind },
  { a: { x: x1, y: y1 }, b: { x: x0, y: y1 }, kind },
  { a: { x: x0, y: y1 }, b: { x: x0, y: y0 }, kind },
];

test('a batch of plain actions builds a plan, filling ids, thickness and heights', () => {
  const r = applyActions(newProject('API'), [
    { type: 'addWalls', walls: rect(0, 0, 360, 240), room: { name: 'Great room', type: 'living', points: [{ x: 3, y: 3 }, { x: 357, y: 3 }, { x: 357, y: 237 }, { x: 3, y: 237 }] } },
    { type: 'setFraming', patch: { wallHeight: 144 } },
  ]);
  const s = planSummary(r.project);
  assert.equal(s.walls.length, 4);
  assert.ok(s.walls.every((w) => w.id && w.thickness > 4 && w.height > 90));
  assert.equal(s.rooms[0].name, 'Great room');
  // A door on the first wall, then every wall to 12 ft.
  const wallId = s.walls[0].id;
  const r2 = applyActions(r.project, [{ type: 'addOpening', opening: { wallId, kind: 'door', offset: 100 } }, ...s.walls.map((w) => ({ type: 'updateWall', id: w.id, patch: { height: 144 } }))]);
  const s2 = planSummary(r2.project);
  assert.equal(s2.openings.length, 1);
  assert.ok(s2.walls.every((w) => w.height === 144));
  // The plan as it was is kept as a version.
  assert.ok(r2.versionId && s2.versions.some((v) => v.id === r2.versionId));
});

test('a bad action rejects the whole batch with its index', () => {
  const base = applyActions(newProject('API'), [{ type: 'addWalls', walls: rect(0, 0, 120, 120) }]).project;
  assert.throws(() => applyActions(base, [{ type: 'rename', name: 'ok' }, { type: 'addOpening', opening: { wallId: 'nope', offset: 10 } }]), (e: unknown) => e instanceof ActionError && e.index === 1);
  assert.throws(() => applyActions(base, [{ type: 'replaceProject', project: {} }]), ActionError);
  assert.throws(() => applyActions(base, [{ type: 'undo' }]), ActionError);
});

test('reports: estimate, checks and materials come back as data; old API versions are pruned', () => {
  let p = applyActions(newProject('API'), [{ type: 'addWalls', walls: rect(0, 0, 480, 360) }]).project;
  const est = report(p, 'estimate') as { total: number; lines: unknown[] };
  assert.ok(est.total > 0 && est.lines.length > 5);
  const checks = report(p, 'checks') as { counts: Record<string, number> };
  assert.ok(checks.counts.fail + checks.counts.pass > 0);
  for (let i = 0; i < 14; i++) p = applyActions(p, [{ type: 'rename', name: `n${i}` }]).project;
  assert.equal(p.versions!.filter((v) => v.name.startsWith('Before API edit')).length, 10);
});

