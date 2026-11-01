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
  const pos = layoutRun(300, 144);
  assert.equal(pos.length, 3);
  assert.equal(pos[0], 50);
  assert.ok(pos[1] - pos[0] <= 144);
  assert.deepEqual(layoutRun(20, 144), []); // < 2 ft wall space
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

test('nested rooms: the outline room only gets outlets in its own region', () => {
  const walls = box(480, 288); // 40 × 24 ft outline
  let p = project(walls, [], {
    rooms: [
      { ...room('living', 480, 288), id: 'outer' },
      { id: 'bed', name: 'Bed', type: 'bedroom', points: [{ x: 0, y: 0 }, { x: 144, y: 0 }, { x: 144, y: 144 }, { x: 0, y: 144 }] },
    ],
  });
  p = projectReducer(p, { type: 'addWalls', walls: box(144, 144, 'interior') }); // only the two partitions are new
  p = projectReducer(p, { type: 'replaceAutoOutlets', outlets: autoOutlets(p) });
  for (const r of p.rooms) {
    const g = spacingGaps(p, r);
    assert.ok(!g.uncovered && g.worst <= g.limit + 0.5, `${r.id}: worst ${g.worst}`);
  }
  // Nothing from the outline room lands inside the bedroom.
  const inBed = p.outlets.filter((o) => {
    const w = p.walls.find((x) => x.id === o.wallId)!;
    const t = o.offset / Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    const x = w.a.x + (w.b.x - w.a.x) * t;
    const y = w.a.y + (w.b.y - w.a.y) * t;
    return x < 144 + 3 && y < 144 + 3;
  });
  const bedOnly = autoOutlets({ ...p, rooms: [p.rooms[1]] }).length;
  assert.ok(inBed.length >= bedOnly && inBed.length <= bedOnly + 2, `in bed ${inBed.length} vs ${bedOnly}`);
});
