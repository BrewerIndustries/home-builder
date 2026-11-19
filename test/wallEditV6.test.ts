import assert from 'node:assert/strict';
import { test } from 'node:test';
import { historyReducer, initHistory, projectReducer } from '../src/model/store.ts';
import type { Point, Project } from '../src/model/types.ts';
import { alignUnits, boxSelect, centreLine, clipBounds, clipSelection, copyGroup, groupBounds, groupMembers, liveItems, placeClip, reflect, selItems, toggleItem, type SelItem } from '../src/model/selection.ts';
import { mirrorRoom } from '../src/model/wallEdit.ts';
import { box, door, project, wall } from './helpers.ts';

const near = (p: Point, q: Point) => Math.abs(p.x - q.x) < 0.01 && Math.abs(p.y - q.y) < 0.01;
const sameSet = (a: Point[], b: Point[]) => a.length === b.length && a.every((p) => b.some((q) => near(p, q)));

/** A 10' × 8' room with a door, an outlet, a switch running its light, an island, a sofa and a corner shower; plus a loose chair and a loose wall off to the right. */
function plan(): Project {
  const walls = [...box(120, 96), wall(200, 0, 200, 96, 'interior')];
  const top = walls.find((w) => w.a.y === 0 && w.b.y === 0)!;
  return project(walls, [{ ...door(top.id, 30), swing: { side: 1, hinge: 'a' } }], {
    rooms: [{ id: 'R', name: 'Den', type: 'living', points: [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 96 }, { x: 0, y: 96 }] }],
    outlets: [{ id: 'o', wallId: top.id, offset: 90, side: 1, kind: 'duplex', height: 16, auto: false }],
    switches: [{ id: 'sw', wallId: top.id, offset: 60, side: 1, height: 48, controls: ['l', 'elsewhere'], auto: false }],
    counters: [{ id: 'k', a: { x: 40, y: 40 }, b: { x: 80, y: 40 }, depth: 20, side: -1, island: true, cutouts: [{ id: 'c1', kind: 'sink', offset: 20, width: 30 }] }],
    furniture: [
      { id: 's', kind: 'sofa', at: { x: 30, y: 48 }, rot: 90, w: 72, d: 36 },
      { id: 'cs', kind: 'corner-shower', at: { x: 100, y: 75 }, rot: 0, w: 36, d: 36 },
      { id: 'ch', kind: 'chair', at: { x: 160, y: 50 }, rot: 0, w: 24, d: 24 },
    ],
    fixtures: [{ id: 'l', kind: 'light', at: { x: 60, y: 48 }, auto: false }],
  });
}

const loose = (p: Project) => p.walls[4];
const R: SelItem = { kind: 'room', id: 'R' };
const CH: SelItem = { kind: 'furniture', id: 'ch' };

test('picking: Shift-click toggles; dimension strings are dropped; stale picks fall away', () => {
  let sel = toggleItem([], R);
  sel = toggleItem(sel, CH);
  assert.equal(sel.length, 2);
  assert.deepEqual(toggleItem(sel, R), [CH]);
  assert.deepEqual(selItems([{ kind: 'dim', id: 'x' }, { kind: 'wall', id: 'w' }]), [{ kind: 'wall', id: 'w' }]);
  const p = projectReducer(plan(), { type: 'delete', ids: ['ch'] });
  assert.deepEqual(liveItems(p, sel), [R]);
});

test('a box takes in whole rooms with their contents, and loose items wholly inside it', () => {
  const p = plan();
  // Everything: the room (its walls and contents come with it), the loose wall and the chair.
  const all = boxSelect(p, { x: -10, y: -10 }, { x: 210, y: 110 });
  assert.deepEqual(all.map((x) => x.kind).sort(), ['furniture', 'room', 'wall']);
  // Only part of the room: just the loose items in reach, not the room or its walls.
  const part = boxSelect(p, { x: 61, y: -10 }, { x: 210, y: 110 });
  const right = p.walls.find((w) => w.a.x === 120 && w.b.x === 120)!;
  assert.deepEqual(part.map((x) => x.id).sort(), ['ch', 'cs', right.id, loose(p).id].sort());
  // The room carries its door, outlet and switch: grabbing any of them drags the group.
  const members = groupMembers(p, [R]).map((x) => x.id);
  for (const id of ['d30', 'o', 'sw', 'k', 's', 'cs', 'l']) assert.ok(members.includes(id), id);
  assert.ok(!members.includes('ch'));
  const b = groupBounds(p, [R, CH])!;
  assert.deepEqual([b.min.x, b.max.x], [0, 172]);
});

test('a group moves as one undo step; the room carries its contents, the loose wall and chair come too', () => {
  const start = plan();
  const sel: SelItem[] = [R, CH, { kind: 'wall', id: loose(start).id }];
  const h = historyReducer(initHistory(start), { type: 'groupEdit', sel, op: { kind: 'move', delta: { x: 24, y: 12 } } });
  const p = h.present;
  assert.equal(h.past.length, 1);
  assert.deepEqual(p.rooms[0].points[0], { x: 24, y: 12 });
  assert.ok(near(loose(p).a, { x: 224, y: 12 }));
  assert.deepEqual(p.furniture.find((f) => f.id === 'ch')!.at, { x: 184, y: 62 });
  assert.deepEqual(p.counters[0].a, { x: 64, y: 52 });
  assert.deepEqual(p.fixtures[0].at, { x: 84, y: 60 });
  assert.equal(p.openings[0].offset, 30);
  assert.equal(historyReducer(h, { type: 'undo' }).present, start);
  // A drag: checkpoint, then transient steps — still one undo step.
  let d = historyReducer(initHistory(start), { type: 'checkpoint' });
  for (let i = 1; i <= 3; i++) d = historyReducer(d, { type: 'groupEdit', sel, op: { kind: 'move', delta: { x: 6, y: 0 } }, transient: true });
  assert.equal(d.past.length, 1);
  assert.deepEqual(d.present.rooms[0].points[0], { x: 18, y: 0 });
});

test('a group turns about its centre; symbols turn with it', () => {
  const p = projectReducer(plan(), { type: 'groupEdit', sel: [R, CH], op: { kind: 'turn', deg: 90 } });
  // Box 0…172 × 0…96 → centre (86, 48). A quarter turn anticlockwise (plan y down): (x, y) → (cx + (y − cy), cy − (x − cx)).
  assert.ok(sameSet(p.rooms[0].points, [{ x: 38, y: 134 }, { x: 38, y: 14 }, { x: 134, y: 14 }, { x: 134, y: 134 }]));
  const ch = p.furniture.find((f) => f.id === 'ch')!;
  assert.ok(near(ch.at, { x: 88, y: -26 }));
  assert.equal(ch.rot, 270);
  assert.equal(p.furniture.find((f) => f.id === 's')!.rot, 0);
  // About a picked pivot.
  const q = projectReducer(plan(), { type: 'groupEdit', sel: [CH], op: { kind: 'turn', deg: 180, pivot: { x: 160, y: 0 } } });
  assert.ok(near(q.furniture.find((f) => f.id === 'ch')!.at, { x: 160, y: -50 }));
});

test('mirroring a group about its centre line matches a room mirror: swings, sides, symbols and hands flip', () => {
  const c = { x: 60, y: 48 };
  const viaGroup = projectReducer(plan(), { type: 'groupEdit', sel: [R], op: { kind: 'mirror', ...centreLine(c, 'x') } });
  const viaRoom = mirrorRoom(plan(), 'R', 'x');
  assert.deepEqual(viaGroup.rooms, viaRoom.rooms);
  assert.equal(viaGroup.openings[0].swing!.side, -1);
  assert.equal(viaGroup.outlets[0].side, -1);
  assert.equal(viaGroup.switches[0].side, -1);
  assert.equal(viaGroup.counters[0].side, 1);
  assert.equal(viaGroup.furniture.find((f) => f.id === 's')!.rot, 270);
  // The corner shower's door corner swaps hands (also for the plain room mirror).
  assert.equal(viaGroup.furniture.find((f) => f.id === 'cs')!.mirror, true);
  assert.equal(viaRoom.furniture.find((f) => f.id === 'cs')!.mirror, true);
  // The loose chair isn't in the group.
  assert.deepEqual(viaGroup.furniture.find((f) => f.id === 'ch')!.at, { x: 160, y: 50 });
});

test('mirror about a picked line: a diagonal through the origin swaps x and y', () => {
  assert.deepEqual(reflect({ x: 10, y: 3 }, { x: 0, y: 0 }, { x: 5, y: 5 }), { x: 3, y: 10 });
  const p = projectReducer(plan(), { type: 'groupEdit', sel: [CH], op: { kind: 'mirror', a: { x: 0, y: 0 }, b: { x: 5, y: 5 } } });
  const ch = p.furniture.find((f) => f.id === 'ch')!;
  assert.deepEqual(ch.at, { x: 50, y: 160 });
  // Front was +y; reflected across y = x it faces +x: a symbol turned 270° clockwise (= 90° anticlockwise).
  assert.equal(ch.rot, 270);
  // A room mirrored about its own right wall's line lands next door, still wound the same way.
  const q = projectReducer(plan(), { type: 'groupEdit', sel: [R], op: { kind: 'mirror', a: { x: 120, y: 0 }, b: { x: 120, y: 96 } } });
  assert.ok(sameSet(q.rooms[0].points, [{ x: 120, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 96 }, { x: 120, y: 96 }]));
});

test('align and distribute move whole units (a room with its contents, loose items)', () => {
  const base = project([], [], {
    furniture: [
      { id: 'a', kind: 'chair', at: { x: 0, y: 0 }, rot: 0, w: 20, d: 20 },
      { id: 'b', kind: 'chair', at: { x: 30, y: 40 }, rot: 0, w: 20, d: 20 },
      { id: 'c', kind: 'table', at: { x: 200, y: 10 }, rot: 0, w: 40, d: 40 },
    ],
  });
  const sel: SelItem[] = ['a', 'b', 'c'].map((id) => ({ kind: 'furniture', id }));
  const left = projectReducer(base, { type: 'groupEdit', sel, op: { kind: 'align', how: 'left' } });
  assert.deepEqual(left.furniture.map((f) => f.at.x), [0, 0, 10]);
  const top = projectReducer(base, { type: 'groupEdit', sel, op: { kind: 'align', how: 'top' } });
  assert.deepEqual(top.furniture.map((f) => f.at.y), [0, 0, 10]);
  const mid = projectReducer(base, { type: 'groupEdit', sel, op: { kind: 'align', how: 'middle' } });
  // Box y −10…50 → middle 20.
  assert.deepEqual(mid.furniture.map((f) => f.at.y), [20, 20, 20]);
  // Distribute along x: outer two stay, equal gaps: −10…10, then 10 + g … , …180…220 → g = (230 − 80) / 2 = 75.
  const dist = projectReducer(base, { type: 'groupEdit', sel, op: { kind: 'distribute', axis: 'x' } });
  assert.deepEqual(dist.furniture.map((f) => f.at.x), [0, 95, 200]);
  // Fewer than three units: nothing to space out.
  assert.equal(projectReducer(base, { type: 'groupEdit', sel: sel.slice(0, 2), op: { kind: 'distribute', axis: 'x' } }), base);
  // A room and a chair in it count as one unit.
  assert.equal(alignUnits(plan(), [R, { kind: 'furniture', id: 's' }, CH]).length, 2);
  const p = projectReducer(plan(), { type: 'groupEdit', sel: [R, CH], op: { kind: 'align', how: 'bottom' } });
  assert.deepEqual(p.rooms[0].points[0], { x: 0, y: 0 });
  assert.equal(p.furniture.find((f) => f.id === 'ch')!.at.y, 84);
});

test('copy / paste a room with its walls, door, devices, counter, symbols and light: new ids, one undo step', () => {
  const p = plan();
  const clip = copyGroup(p, [R])!;
  assert.equal(clip.walls.length, 4);
  assert.deepEqual([clip.openings.length, clip.outlets.length, clip.switches.length, clip.counters.length, clip.fixtures.length, clip.furniture.length], [1, 1, 1, 1, 1, 2]);
  // The switch keeps only its link to the copied light.
  assert.deepEqual(clip.switches[0].controls, ['l']);
  assert.deepEqual(clipBounds(clip), { min: { x: 0, y: 0 }, max: { x: 120, y: 96 } });
  let n = 0;
  const placed = placeClip(clip, { x: 0, y: 200 }, (prefix) => `${prefix}_new${++n}`);
  const h = historyReducer(initHistory(p), { type: 'paste', clip: placed });
  const q = h.present;
  assert.equal(h.past.length, 1);
  assert.equal(q.walls.length, 9);
  assert.equal(q.rooms.length, 2);
  const room = q.rooms[1];
  assert.deepEqual(room.points[0], { x: 0, y: 200 });
  assert.notEqual(room.id, 'R');
  const sw = q.switches[1];
  assert.deepEqual(sw.controls, [q.fixtures[1].id]);
  assert.ok(q.walls.some((w) => w.id === sw.wallId && w.a.y === 200));
  assert.ok(q.openings[1].wallId !== q.openings[0].wallId && q.openings[1].offset === 30);
  assert.notEqual(q.counters[1].cutouts[0].id, 'c1');
  // The original is untouched, and the copy picks as one room.
  assert.deepEqual(q.rooms[0], p.rooms[0]);
  assert.deepEqual(clipSelection(q, placed), [{ kind: 'room', id: room.id }]);
});

test('a copy pasted against the original shares the wall: its door moves onto the existing wall', () => {
  const p = plan();
  const clip = copyGroup(p, [R])!;
  // Mirror the copy about the room's right wall first, as for a mirrored twin next door: paste it there.
  const placed = placeClip(clip, { x: 120, y: 0 }, (() => {
    let n = 0;
    return (prefix: string) => `${prefix}_t${++n}`;
  })());
  const q = projectReducer(p, { type: 'paste', clip: placed });
  // The copy's left wall (x = 120) lands on the original's right wall: only three new walls.
  assert.equal(q.walls.length, 8);
  const right = p.walls.find((w) => w.a.x === 120 && w.b.x === 120)!;
  assert.ok(q.walls.some((w) => w.id === right.id));
  // Nothing hangs on a wall that isn't there.
  for (const o of [...q.openings, ...q.outlets, ...q.switches]) assert.ok(q.walls.some((w) => w.id === o.wallId), o.id);
});

test('copying nothing gives nothing; old projects load unchanged', () => {
  assert.equal(copyGroup(plan(), []), null);
  const p = plan();
  assert.equal(projectReducer(p, { type: 'groupEdit', sel: [], op: { kind: 'move', delta: { x: 6, y: 0 } } }), p);
  const h = historyReducer(initHistory(p), { type: 'load', project: p });
  assert.deepEqual(h.present.rooms, p.rooms);
});

test('a door on a pasted wall that lands reversed on an existing wall keeps its place and swing', () => {
  // One wall b → a reversed relative to the existing one, with a door 30" from its own start.
  const existing = wall(0, 0, 120, 0);
  const p = project([existing]);
  const clip = { walls: [{ ...existing, id: 'x', a: { x: 120, y: 0 }, b: { x: 0, y: 0 } }], rooms: [], openings: [{ ...door('x', 30), id: 'dx', swing: { side: 1 as const, hinge: 'a' as const } }], outlets: [], switches: [], counters: [], fixtures: [], furniture: [] };
  const q = projectReducer(p, { type: 'paste', clip });
  assert.equal(q.walls.length, 1);
  assert.deepEqual([q.openings[0].wallId, q.openings[0].offset, q.openings[0].swing], [existing.id, 90, { side: -1, hinge: 'b' }]);
});
