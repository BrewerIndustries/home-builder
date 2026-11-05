import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autoLighting, lightingChecks, outdoorDoors } from '../src/calc/lighting.ts';
import { materialsList } from '../src/calc/materials.ts';
import { projectReducer } from '../src/model/store.ts';
import type { Outlet, Project } from '../src/model/types.ts';
import { box, door, project } from './helpers.ts';

/** 30' × 20' living room: front door on the bottom wall, a 16' garage-style door on the top. */
function house(): Project {
  const walls = box(360, 240);
  const top = walls.find((w) => w.a.y === 0 && w.b.y === 0)!;
  const bottom = walls.find((w) => w.a.y === 240 && w.b.y === 240)!;
  const rooms = [{ id: 'L', name: 'Living', type: 'living' as const, points: [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 240 }, { x: 0, y: 240 }] }];
  return project(walls, [{ ...door(bottom.id, 180), id: 'front' }, { ...door(top.id, 180, 192, 84), id: 'vehicle' }], { rooms });
}

const lit = (p: Project) => {
  const { fixtures, switches } = autoLighting(p);
  return projectReducer(p, { type: 'replaceAutoLighting', fixtures, switches });
};

test('each outdoor door gets a switched light outside it; vehicle doors are left out', () => {
  const p = house();
  assert.deepEqual(outdoorDoors(p).map((d) => d.door.id), ['front']);
  assert.equal(lightingChecks({ ...p, fixtures: [{ id: 'x', kind: 'light', at: { x: 180, y: 120 }, auto: false }] }).find((c) => c.rule === 'Light outside each outdoor door')!.status, 'fail');
  const q = lit(p);
  const outside = q.fixtures.filter((f) => f.kind === 'outdoor');
  assert.equal(outside.length, 1);
  // Beside the 36" door (162–198), just outside the bottom wall.
  assert.ok(outside[0].at.y > 240, JSON.stringify(outside[0].at));
  assert.equal(Math.abs(outside[0].at.x - 180), 28);
  // Switched from inside at that door — the room's own switch is there too, so they share it.
  assert.ok(q.switches.some((s) => s.controls.includes(outside[0].id)));
  assert.equal(lightingChecks(q).find((c) => c.rule === 'Light outside each outdoor door')!.status, 'pass');
  assert.equal(materialsList(q).find((l) => l.item.startsWith('Exterior wall light'))!.qty, 1);
});

test('a switched receptacle stands in for the ceiling light in a living room', () => {
  const p = house();
  const left = p.walls.find((w) => w.a.x === 0 && w.b.x === 0)!;
  // Inside face of the left wall: the side whose normal points into the room (+x).
  const side = left.b.y - left.a.y > 0 ? 1 : -1;
  const recep: Outlet = { id: 'r', wallId: left.id, offset: 120, side, kind: 'duplex', height: 16, auto: false };
  const sw = { id: 's', wallId: left.id, offset: 40, side: recep.side, height: 48, controls: ['r'], auto: false };
  const q = { ...p, outlets: [recep], switches: [sw], fixtures: [{ id: 'sd', kind: 'smoke' as const, at: { x: 100, y: 100 }, auto: false }] };
  const c = lightingChecks(q).find((x) => x.rule === 'Wall-switched lighting outlet')!;
  assert.equal(c.status, 'pass');
  assert.match(c.message, /switched receptacle/);
  // Re-running Auto outlets drops switch links to the auto receptacles it replaces.
  const auto = { ...q, outlets: [{ ...recep, auto: true }] };
  const r = projectReducer(auto, { type: 'replaceAutoOutlets', outlets: [] });
  assert.deepEqual(r.switches[0].controls, []);
});

test('a ceiling fan counts as the room light and prices with a fan-rated box', () => {
  const p = house();
  const q = { ...p, fixtures: [{ id: 'f', kind: 'fan' as const, at: { x: 180, y: 120 }, auto: false }] };
  const r = lit(q);
  // Auto lights keeps the hand-placed fan instead of adding a ceiling light.
  assert.equal(r.fixtures.filter((f) => f.kind === 'light').length, 0);
  assert.equal(lightingChecks(r).find((c) => c.rule === 'Wall-switched lighting outlet')!.status, 'pass');
  const lines = materialsList(r);
  assert.equal(lines.find((l) => l.item.startsWith('Ceiling fan'))!.qty, 1);
  assert.equal(lines.find((l) => l.item.startsWith('Fan-rated'))!.qty, 1);
});
