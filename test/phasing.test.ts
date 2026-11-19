import assert from 'node:assert/strict';
import { test } from 'node:test';
import { materialsList } from '../src/calc/materials.ts';
import { compareOptions } from '../src/calc/optionCompare.ts';
import { demolitionLines, phasedEstimate, phasedMaterials } from '../src/calc/phasing.ts';
import { estimate } from '../src/calc/pricing.ts';
import { addOption, applyPlan, deleteOption, extractPlan, optionsOf, renameOption, switchOption } from '../src/model/options.ts';
import { phaseOf, phaseView, planElementIds, setPhase } from '../src/model/phase.ts';
import { historyReducer, initHistory, migrate, projectReducer, syncThickness } from '../src/model/store.ts';
import type { Project } from '../src/model/types.ts';
import { box, door, project, wall, window_ } from './helpers.ts';

function house(): Project {
  const walls = box(240, 180);
  const inner = wall(120, 0, 120, 180, 'interior');
  return syncThickness(project([...walls, inner], [door(walls[0].id, 60), window_(walls[1].id, 90), door(inner.id, 90, 32)]));
}

const total = (p: Project) => phasedEstimate(p).total;

test('phases: old projects are all new and price exactly as before', () => {
  const p = house();
  assert.equal(phaseOf(p, p.walls[0].id), 'new');
  assert.deepEqual(phasedMaterials(p), materialsList(p));
});

test('setPhase: sets, clears back to new, prunes ids no longer on the plan, drops an empty map', () => {
  let p = house();
  p = setPhase(p, [p.walls[0].id, 'nope'], 'existing');
  assert.deepEqual(p.phases, { [p.walls[0].id]: 'existing' });
  p = setPhase(p, [p.walls[0].id], 'new');
  assert.equal(p.phases, undefined);
  assert.ok(!('phases' in p));
});

test('estimate: an all-existing plan costs nothing; demolition adds allowance lines only', () => {
  let p = house();
  p = setPhase(p, planElementIds(p), 'existing');
  assert.equal(phasedMaterials(p).length, 0);
  assert.equal(total(p), 0);
  const inner = p.walls[4];
  p = setPhase(p, [inner.id], 'demo');
  const lines = phasedMaterials(p);
  assert.ok(lines.every((l) => l.category === 'Demolition'));
  const wallLine = lines.find((l) => l.item.startsWith('Demolition, interior wall'))!;
  assert.equal(wallLine.qty, 15); // 180" = 15 LF
  // The door in the demolished wall goes with it — no separate door line.
  assert.ok(!lines.some((l) => l.item.startsWith('Demolition, remove door')));
  assert.ok(lines.some((l) => l.item.startsWith('Demolition, debris haul-off')));
  assert.ok(total(p) > 0);
});

test('estimate: a new door cut into an existing wall prices the unit and its extra framing, not the wall', () => {
  let p = house();
  const ext = p.walls[2];
  p = setPhase(p, planElementIds(p), 'existing');
  p = { ...p, openings: [...p.openings, { ...door(ext.id, 120), id: 'cut' }] };
  const lines = phasedMaterials(p);
  assert.ok(lines.some((l) => l.item === 'Door 3068' && l.qty === 1));
  // kings / jacks for the new opening, but nowhere near a whole wall's studs
  const studs = lines.filter((l) => / stud, /.test(l.item)).reduce((s, l) => s + l.qty, 0);
  assert.ok(studs > 0 && studs < 8, `studs ${studs}`);
  assert.ok(!lines.some((l) => l.category === 'Drywall' || l.category === 'Insulation & wrap'));
});

test('estimate: a new wall in an existing house is priced like that wall alone', () => {
  let p = house();
  p = setPhase(p, planElementIds(p), 'existing');
  const add = wall(0, 90, 120, 90, 'interior');
  p = syncThickness({ ...p, walls: [...p.walls, add] });
  const alone = syncThickness(project([add]));
  assert.deepEqual(
    phasedMaterials(p).filter((l) => l.category !== 'Demolition'),
    materialsList(alone),
  );
});

test('demolition: loose doors, windows, devices, counters and fixtures', () => {
  let p = house();
  p = {
    ...p,
    outlets: [{ id: 'o1', wallId: p.walls[0].id, offset: 30, side: 1, kind: 'duplex', height: 12, auto: false }],
    fixtures: [{ id: 'f1', kind: 'light', at: { x: 60, y: 60 }, auto: false }],
    counters: [{ id: 'c1', a: { x: 0, y: 3 }, b: { x: 96, y: 3 }, depth: 25, side: -1, island: false, cutouts: [] }],
    furniture: [
      { id: 't1', kind: 'toilet', at: { x: 200, y: 100 }, rot: 0, w: 20, d: 28 },
      { id: 'b1', kind: 'bed', at: { x: 60, y: 120 }, rot: 0, w: 60, d: 80 },
    ],
  };
  p = setPhase(p, ['d60', 'n90', 'o1', 'f1', 'c1', 't1', 'b1'], 'demo');
  const by = Object.fromEntries(demolitionLines(p).map((l) => [l.item.split(' (')[0], l.qty]));
  assert.equal(by['Demolition, remove door'], 1);
  assert.equal(by['Demolition, remove window'], 1);
  assert.equal(by['Demolition, remove electrical device / light'], 2);
  assert.equal(by['Demolition, remove cabinets + countertop'], 8);
  assert.equal(by['Demolition, remove plumbing fixture / appliance'], 1); // the bed is furniture, not demolition
  assert.ok(estimate(demolitionLines(p)).lines.every((l) => l.unitPrice > 0));
});

test('phaseView: existing / demo / new plans', () => {
  let p = house();
  const [w0, , , , inner] = p.walls;
  p = setPhase(p, planElementIds(p), 'existing');
  p = setPhase(p, [inner.id], 'demo');
  const added = wall(0, 90, 120, 90, 'interior');
  p = { ...p, walls: [...p.walls, added] };
  const ids = (q: Project) => q.walls.map((w) => w.id).sort();
  assert.deepEqual(ids(phaseView(p, 'all')), ids(p));
  assert.ok(!phaseView(p, 'new').walls.some((w) => w.id === inner.id));
  assert.ok(phaseView(p, 'new').walls.some((w) => w.id === added.id));
  // the door in the demolished wall goes with it on the new plan
  assert.ok(!phaseView(p, 'new').openings.some((o) => o.wallId === inner.id));
  assert.ok(phaseView(p, 'demo').walls.some((w) => w.id === inner.id));
  assert.ok(!phaseView(p, 'demo').walls.some((w) => w.id === added.id));
  // existing view: demolition drawn as existing
  assert.equal(phaseView(p, 'existing').phases![inner.id], 'existing');
  assert.equal(phaseOf(phaseView(p, 'existing'), w0.id), 'existing');
});

test('splitWall: the new piece keeps the phase', () => {
  let p = house();
  p = setPhase(p, [p.walls[0].id], 'demo');
  p = projectReducer(p, { type: 'splitWall', id: p.walls[0].id, at: 100, newId: 'w_split' });
  assert.equal(phaseOf(p, 'w_split'), 'demo');
});

test('replaceProject: one undo step; transient folds into the current step', () => {
  const p = house();
  let h = initHistory(p);
  h = historyReducer(h, { type: 'replaceProject', project: setPhase(p, [p.walls[0].id], 'existing') });
  assert.equal(h.past.length, 1);
  h = historyReducer(h, { type: 'replaceProject', project: setPhase(h.present, [p.walls[1].id], 'existing'), transient: true });
  assert.equal(h.past.length, 1);
  h = historyReducer(h, { type: 'undo' });
  assert.equal(h.present.phases, undefined);
});

test('options: copy, edit, switch back and forth, rename, delete', () => {
  const p = house();
  assert.equal(optionsOf(p).list.length, 1);
  let q = addOption(p, 'Plan B');
  const opts = q.options!;
  assert.equal(opts.list.length, 2);
  assert.equal(opts.list.find((o) => o.id === opts.active)!.name, 'Plan B');
  const a = opts.list.find((o) => o.id !== opts.active)!;
  assert.equal(a.name, 'Option A');
  // Plan B grows a wall
  q = syncThickness({ ...q, walls: [...q.walls, wall(0, 90, 120, 90, 'interior')] });
  assert.equal(q.walls.length, 6);
  const backToA = switchOption(q, a.id);
  assert.equal(backToA.walls.length, 5);
  assert.equal(backToA.options!.active, a.id);
  const b = switchOption(backToA, opts.active);
  assert.equal(b.walls.length, 6);
  // only the inactive option stores a plan
  assert.equal(b.options!.list.filter((o) => o.plan).length, 1);
  const renamed = renameOption(b, a.id, 'Option A — open kitchen');
  assert.equal(renamed.options!.list.find((o) => o.id === a.id)!.name, 'Option A — open kitchen');
  assert.equal(deleteOption(renamed, renamed.options!.active), renamed); // can't delete the active one
  assert.equal(deleteOption(renamed, a.id).options, undefined);
});

test('options: plans exclude name, prices, underlay; applyPlan keeps them', () => {
  const p: Project = { ...house(), name: 'Mine', pricing: { prices: { x: 1 }, markup: 0.1, tax: 0 }, underlay: { src: 'data:', pxWidth: 1, pxHeight: 1, x: 0, y: 0, scale: 1, opacity: 1, visible: true } };
  const plan = extractPlan(p);
  assert.ok(!('name' in plan) && !('pricing' in plan) && !('underlay' in plan) && !('version' in plan));
  const other = applyPlan({ ...p, walls: [] }, plan);
  assert.equal(other.walls.length, 5);
  assert.equal(other.name, 'Mine');
  assert.ok(other.underlay);
  // an older saved plan gets migrated
  const old = applyPlan(p, { ...plan, outlets: undefined } as never);
  assert.deepEqual(old.outlets, []);
  assert.deepEqual(migrate(old).walls.length, 5);
});

test('compare: per option totals and per-category differences', () => {
  let p = house();
  p = addOption(p, 'Bigger');
  p = syncThickness({ ...p, walls: [...p.walls, wall(0, 90, 120, 90, 'interior')] });
  const cmp = compareOptions(p);
  assert.equal(cmp.options.length, 2);
  const [a, b] = cmp.options;
  assert.equal(b.active, true);
  assert.ok(b.est.total > a.est.total);
  assert.ok(cmp.categories.includes('Lumber'));
  assert.ok(b.byCategory.Lumber > a.byCategory.Lumber);
});
