import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changeOrder, diffPlans } from '../src/calc/planDiff.ts';
import { phasedEstimate } from '../src/calc/phasing.ts';
import { changeOrderHtml } from '../src/calc/changeOrderHtml.ts';
import { addOption } from '../src/model/options.ts';
import { setPhase } from '../src/model/phase.ts';
import { historyReducer, initHistory, migrate, projectReducer, syncThickness } from '../src/model/store.ts';
import type { Project } from '../src/model/types.ts';
import { CURRENT, deleteVersion, restoreVersion, saveVersion, versionProject } from '../src/model/versions.ts';
import { box, door, project, wall, window_ } from './helpers.ts';

function house(): Project {
  const walls = box(240, 180);
  const inner = wall(120, 0, 120, 180, 'interior');
  const p = project([...walls, inner], [door(walls[0].id, 60), window_(walls[1].id, 90)], {
    rooms: [
      { id: 'r1', name: 'Living', type: 'living', points: [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 180 }, { x: 0, y: 180 }] },
      { id: 'r2', name: 'Bedroom 2', type: 'bedroom', points: [{ x: 120, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 180 }, { x: 120, y: 180 }] },
    ],
  });
  return syncThickness(migrate(p));
}

test('versions: saved inside the project without the underlay, restored as one undo step', () => {
  let p: Project = { ...house(), underlay: { src: 'data:image/jpeg;base64,AAAA', pxWidth: 10, pxHeight: 10, x: 0, y: 0, scale: 1, opacity: 0.5, visible: true } };
  p = saveVersion(p, 'Bid set', 1_700_000_000_000);
  const v = p.versions![0];
  assert.equal(v.name, 'Bid set');
  assert.equal(v.at, 1_700_000_000_000);
  assert.ok(!JSON.stringify(v).includes('base64'));
  assert.ok(!('versions' in v.plan) && !('options' in v.plan));
  // a second version doesn't nest the first
  p = saveVersion(p);
  assert.equal(p.versions![1].name, 'Version 2');
  assert.ok(!JSON.stringify(p.versions![1]).includes('Bid set'));

  let h = initHistory(p);
  h = historyReducer(h, { type: 'delete', ids: [p.walls[4].id] });
  assert.equal(h.present.walls.length, 4);
  h = historyReducer(h, { type: 'replaceProject', project: restoreVersion(h.present, v.id) });
  assert.equal(h.present.walls.length, 5);
  assert.equal(h.present.versions!.length, 2);
  assert.ok(h.present.underlay);
  h = historyReducer(h, { type: 'undo' });
  assert.equal(h.present.walls.length, 4);

  assert.equal(deleteVersion(deleteVersion(p, v.id), p.versions![1].id).versions, undefined);
});

test('versions: record the design option they came from', () => {
  const p = saveVersion(addOption(house(), 'Plan B'));
  assert.equal(p.versions![0].option, 'Plan B');
  assert.equal(saveVersion(house()).versions![0].option, undefined);
});

test('diff: added / removed / changed elements in words', () => {
  const before = house();
  let after = projectReducer(before, { type: 'setWallLength', id: before.walls[0].id, length: 264 }); // W1 20' → 22'
  after = { ...after, openings: [...after.openings, { ...door(after.walls[4].id, 120, 32), id: 'dNew' }] };
  after = { ...after, openings: after.openings.map((o) => (o.id === 'd60' ? { ...o, width: 32 } : o)) };
  after = { ...after, openings: after.openings.filter((o) => o.id !== 'n90'), rooms: after.rooms.map((r) => (r.id === 'r2' ? { ...r, name: 'Primary bedroom' } : r)) };
  after = { ...after, roof: { ...after.roof!, pitch: 8 } };
  const changes = diffPlans(before, after);
  const text = changes.map((c) => `${c.kind}: ${c.text}`);
  assert.ok(text.includes(`changed: W1 lengthened 20' 0" → 22' 0"`), text.join('\n'));
  assert.ok(text.some((t) => t.startsWith('added: Door D2 added between Primary bedroom and Living (2\' 8" × 6\' 8")')), text.join('\n'));
  assert.ok(text.some((t) => t.startsWith('changed: Door D1 in Living narrowed 3\' 0" → 2\' 8"')), text.join('\n'));
  assert.ok(text.some((t) => t.startsWith('removed: Window 1 removed in Bedroom 2')), text.join('\n'));
  assert.ok(text.some((t) => t.includes('renamed "Bedroom 2" → "Primary bedroom"')), text.join('\n'));
  assert.ok(text.includes('changed: Roof: pitch 6 → 8'), text.join('\n'));
  assert.deepEqual(diffPlans(before, before), []);
});

test('diff: phase changes and a moved fixture', () => {
  const before = { ...house(), furniture: [{ id: 'f1', kind: 'toilet' as const, at: { x: 200, y: 100 }, rot: 0, w: 20, d: 28 }] };
  let after = setPhase(before, [before.walls[4].id], 'demo');
  after = { ...after, furniture: [{ ...after.furniture[0], at: { x: 200, y: 124 } }] };
  const text = diffPlans(before, after).map((c) => c.text);
  assert.ok(text.includes('W5 marked for demolition'), text.join('\n'));
  assert.ok(text.includes(`Toilet in Bedroom 2 moved 2' 0"`), text.join('\n'));
});

test('change order: per-line estimate deltas that add up to the estimate difference', () => {
  const before = house();
  const after = { ...before, openings: [...before.openings, { ...door(before.walls[4].id, 120, 32), id: 'dNew' }] };
  const co = changeOrder(before, after);
  const doorLine = co.lines.find((l) => l.item === 'Door 2868')!;
  assert.equal(doorLine.before, 0);
  assert.equal(doorLine.after, 1);
  assert.ok(doorLine.delta > 0);
  assert.equal(co.before.total, phasedEstimate(before).total);
  assert.equal(co.after.total, phasedEstimate(after).total);
  assert.ok(Math.abs(co.total - (co.after.total - co.before.total)) < 0.02);
  // nothing changed → nothing to order
  assert.deepEqual(changeOrder(before, before).lines, []);
  const html = changeOrderHtml('Test <house>', 'V1', 'Current plan', diffPlans(before, after), co);
  assert.ok(html.includes('Test &lt;house&gt;') && html.includes('Door 2868'));
});

test('versionProject: current and saved', () => {
  const p = saveVersion(house());
  assert.equal(versionProject(p, CURRENT), p);
  assert.equal(versionProject(p, p.versions![0].id)!.walls.length, 5);
  assert.equal(versionProject(p, 'nope'), null);
});
