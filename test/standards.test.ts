import assert from 'node:assert/strict';
import { test } from 'node:test';
import { doorLeaves } from '../src/calc/doors3d.ts';
import { ircChecks } from '../src/calc/irc.ts';
import { materialsList } from '../src/calc/materials.ts';
import { buildScene } from '../src/calc/model3d.ts';
import { doorInReach, move } from '../src/calc/walk.ts';
import { applyActions } from '../src/api/engine.ts';
import { applyStandards, doorSize, windowSize } from '../src/model/standards.ts';
import { projectReducer } from '../src/model/store.ts';
import { addStorey, storeyView } from '../src/model/storeys.ts';
import { DEFAULT_ROOF, standardsOf, type Project } from '../src/model/types.ts';
import { box, door, project, wall, window_ } from './helpers.ts';

/** A 20' × 12' box, an interior wall across it at x = 120 with a door, a front door and a window. */
function house(patch: Partial<Project> = {}): Project {
  const walls = box(240, 144);
  const inner = wall(120, 0, 120, 144, 'interior');
  return project([...walls, inner], [{ ...door(inner.id, 72), swing: { side: 1, hinge: 'a' } }, { ...door(walls[0].id, 60), id: 'front' }, window_(walls[0].id, 180)], { roof: DEFAULT_ROOF, ...patch });
}

test('standards: defaults match the old sizes, and setStandards sets them', () => {
  const p = house();
  const s = standardsOf(p);
  assert.deepEqual([s.interiorDoorHeight, s.exteriorDoorHeight, s.windowHeight, s.windowHead - s.windowHeight, s.attic, s.roofVent], [80, 80, 48, 34, 'cold', 'vented']);
  const q = projectReducer(p, { type: 'setStandards', patch: { interiorDoorHeight: 96 } });
  assert.equal(standardsOf(q).interiorDoorHeight, 96);
  assert.deepEqual(doorSize(q, { kind: 'interior' }), { width: 36, height: 96 });
  assert.deepEqual(doorSize(q, { kind: 'exterior' }), { width: 36, height: 80 });
  assert.deepEqual(windowSize({ standards: { windowHeight: 60, windowHead: 96 } }), { width: 36, height: 60, sill: 36, style: 'single-hung' });
});

test('new openings through the API take the standards', () => {
  const p = house({ standards: { interiorDoorHeight: 96, windowHead: 96 } });
  const inner = p.walls[4];
  const r = applyActions(p, [{ type: 'addOpening', opening: { wallId: inner.id, offset: 20 } }, { type: 'addOpening', opening: { wallId: p.walls[2].id, offset: 100, kind: 'window' } }], 'test');
  const [d, w] = r.project.openings.slice(-2);
  assert.equal(d.height, 96);
  assert.equal(w.sill + w.height, 96);
});

test('apply to what is drawn: interior doors only, on every storey', () => {
  let p = house({ standards: { interiorDoorHeight: 96 } });
  p = addStorey(p, 1, 'up');
  const upInner = wall(60, 0, 60, 144, 'interior');
  p = { ...p, walls: [...p.walls, upInner], openings: [{ ...door(upInner.id, 50), id: 'upd' }] };
  const { project: q, changed } = applyStandards(p, { interiorDoors: true });
  assert.equal(changed, 2);
  assert.equal(q.openings.find((o) => o.id === 'upd')!.height, 96);
  const g = storeyView(q, 'ground');
  assert.equal(g.openings.find((o) => o.id === 'd72')!.height, 96);
  assert.equal(g.openings.find((o) => o.id === 'front')!.height, 80);
  assert.equal(g.openings.find((o) => o.kind === 'window')!.height, 48);
  assert.equal(applyStandards(q, { interiorDoors: true }).changed, 0);
});

test('attic and roof venting change the estimate and the checks', () => {
  const item = (p: Project, re: RegExp) => materialsList(p).find((l) => re.test(l.item));
  const cold = house();
  assert.ok(item(cold, /^Vented soffit/) && item(cold, /^Ridge vent/) && item(cold, /^Blown-in attic insulation/) && item(cold, /^Rafter vent baffle/));
  const warm = house({ standards: { attic: 'warm', roofVent: 'sealed' } });
  assert.ok(item(warm, /^Solid soffit/) && item(warm, /^Closed-cell spray foam/));
  assert.ok(!item(warm, /^Ridge vent/) && !item(warm, /^Vented soffit/) && !item(warm, /^Blown-in/));
  assert.equal(ircChecks(warm).find((c) => c.section === 'R806.5')?.status, 'warn');
  const bad = house({ standards: { attic: 'cold', roofVent: 'sealed' } });
  assert.equal(ircChecks(bad).find((c) => c.section === 'R806.1')?.status, 'fail');
});

test('doors open and close in the walkthrough: shut, a door fills its opening and stops you', () => {
  const p = house();
  const o = p.openings[0];
  const open = doorLeaves(p, o);
  const shut = doorLeaves(p, o, true);
  assert.equal(shut.length, 1);
  assert.ok(Math.abs(shut[0].size[0] - o.width) < 1e-6);
  assert.ok(Math.abs(shut[0].c[0] - 120) < 1e-6, 'in the wall line');
  assert.notDeepEqual(open[0].c, shut[0].c);
  // Walk from the left room through the door (wall at x = 120, door centred at y = 72).
  const walkThrough = (closed?: Set<string>) => {
    const s = buildScene(p, closed);
    let w = { x: 80, z: 72, y: 0 };
    for (let i = 0; i < 120; i++) w = move(s, w, 1, 0);
    return w.x;
  };
  assert.ok(walkThrough() > 150);
  assert.ok(walkThrough(new Set([o.id])) < 120);
  // The door in reach, facing it (yaw -π/2 faces +x).
  assert.equal(doorInReach(buildScene(p), { x: 90, z: 72, y: 0 }, -Math.PI / 2), o.id);
  assert.equal(doorInReach(buildScene(p), { x: 20, z: 20, y: 0 }, 0) === o.id, false);
});
