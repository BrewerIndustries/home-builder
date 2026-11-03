import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pointAlong, projectOnWall } from '../src/model/geometry.ts';
import { projectReducer } from '../src/model/store.ts';
import { joinCandidates, splitPoint, wallDragPoints } from '../src/model/wallEdit.ts';
import type { Outlet, Project } from '../src/model/types.ts';
import { box, door, project, wall } from './helpers.ts';

/** 240 × 144 box split by an interior wall at x = 120, with a room each side. */
function plan(): Project {
  const outer = box(240, 144);
  const mid = wall(120, 0, 120, 144, 'interior');
  const rooms = [
    { id: 'L', name: 'L', type: 'other' as const, points: [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 144 }, { x: 0, y: 144 }] },
    { id: 'R', name: 'R', type: 'other' as const, points: [{ x: 120, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 144 }, { x: 120, y: 144 }] },
  ];
  return project([...outer, mid], [{ ...door(mid.id, 72), id: 'dm' }], { rooms });
}

const at = (p: Project, wallId: string, offset: number) => pointAlong(p.walls.find((w) => w.id === wallId)!, offset);

test('dragging a wall carries its ends and the room corners on it', () => {
  let p = plan();
  const mid = p.walls[4];
  const from = wallDragPoints(p, mid);
  assert.equal(from.length, 2);
  p = projectReducer(p, { type: 'translatePoints', from, delta: { x: 24, y: 0 } });
  const moved = p.walls.find((w) => w.id === mid.id)!;
  assert.deepEqual([moved.a, moved.b], [{ x: 144, y: 0 }, { x: 144, y: 144 }]);
  assert.deepEqual(p.rooms[0].points[1], { x: 144, y: 0 });
  assert.deepEqual(p.rooms[1].points[0], { x: 144, y: 0 });
  // The outline walls are untouched: the mid wall's ends sit mid-span on them (Ts).
  assert.deepEqual(p.walls.slice(0, 4).map((w) => [w.a, w.b]), plan().walls.slice(0, 4).map((w) => [w.a, w.b]));
});

test('dragging an outline wall stretches the walls tied to it, Ts included', () => {
  let p = plan();
  const right = p.walls[1]; // (240,0) → (240,144)
  const top = p.walls[0];
  const t = wall(180, 72, 240, 72, 'interior');
  p = { ...p, walls: [...p.walls, t] };
  p = projectReducer(p, { type: 'translatePoints', from: wallDragPoints(p, right), delta: { x: 36, y: 0 } });
  assert.deepEqual(p.walls.find((w) => w.id === top.id)!.b, { x: 276, y: 0 });
  assert.deepEqual(p.walls.find((w) => w.id === t.id)!.b, { x: 276, y: 72 });
  assert.equal(p.rooms[1].points[1].x, 276);
});

test('split keeps every item where it was in the plan; join puts them back', () => {
  let p = plan();
  const top = p.walls[0];
  const outlets: Outlet[] = [
    { id: 'o1', wallId: top.id, offset: 40, side: 1, kind: 'duplex', height: 16, auto: false },
    { id: 'o2', wallId: top.id, offset: 200, side: 1, kind: 'duplex', height: 16, auto: false },
  ];
  p = { ...p, outlets, openings: [...p.openings, { ...door(top.id, 100), id: 'dt' }] };
  const before = outlets.map((o) => at(p, o.wallId, o.offset));
  // The middle (120) is clear of the 82–118 door, so the split lands there.
  assert.equal(splitPoint(p, top), 120);
  p = projectReducer(p, { type: 'splitWall', id: top.id, at: 120, newId: 'top2' });
  assert.equal(p.walls.length, 6);
  assert.deepEqual(p.outlets.map((o) => o.wallId), [top.id, 'top2']);
  assert.deepEqual(p.outlets.map((o) => at(p, o.wallId, o.offset)), before);
  assert.equal(p.openings.find((o) => o.id === 'dt')!.wallId, top.id);

  const first = p.walls.find((w) => w.id === top.id)!;
  assert.deepEqual(joinCandidates(p, first).map((w) => w.id), ['top2']);
  p = projectReducer(p, { type: 'joinWalls', id: top.id, otherId: 'top2' });
  assert.equal(p.walls.length, 5);
  assert.deepEqual(p.outlets.map((o) => [o.wallId, o.offset]), [[top.id, 40], [top.id, 200]]);
});

test('splitting avoids cutting through a door', () => {
  const p = plan();
  const mid = p.walls[4]; // 144 long, door 54–90 straddles the middle (72)
  const t = splitPoint(p, mid)!;
  assert.ok(t <= 54 || t >= 90, String(t));
});

test('joining a reversed wall flips sides and hinges so nothing moves', () => {
  const a = wall(0, 0, 120, 0, 'interior');
  const b = wall(240, 0, 120, 0, 'interior'); // drawn the other way
  let p = project([a, b], [{ ...door(b.id, 60), id: 'db', swing: { side: 1, hinge: 'a' } }], {
    outlets: [{ id: 'ob', wallId: b.id, offset: 20, side: 1, kind: 'duplex', height: 16, auto: false }],
  });
  const dBefore = at(p, b.id, 60);
  p = projectReducer(p, { type: 'joinWalls', id: a.id, otherId: b.id });
  const w = p.walls[0];
  assert.deepEqual([w.a, w.b], [{ x: 0, y: 0 }, { x: 240, y: 0 }]);
  const d = p.openings[0];
  assert.deepEqual(at(p, w.id, d.offset), dBefore);
  assert.deepEqual(d.swing, { side: -1, hinge: 'b' });
  assert.equal(p.outlets[0].side, -1);
  assert.equal(projectOnWall(w, { x: 220, y: 0 }).along, p.outlets[0].offset);
});

test('perpendicular or overlapping walls are not join candidates', () => {
  const p = plan();
  assert.deepEqual(joinCandidates(p, p.walls[4]), []);
});
