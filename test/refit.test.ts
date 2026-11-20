import assert from 'node:assert/strict';
import { test } from 'node:test';
import { polygonArea } from '../src/model/geometry.ts';
import { historyReducer, initHistory } from '../src/model/store.ts';
import type { Room } from '../src/model/types.ts';
import { applyRefit, refitAll, refitRoom, staleRooms, type RefitResult } from '../src/calc/refit.ts';
import { box, project, wall } from './helpers.ts';

const rect = (id: string, x0: number, y0: number, x1: number, y1: number, extra: Partial<Room> = {}): Room => ({
  id,
  name: id,
  type: 'bedroom',
  points: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
  ...extra,
});
const sqft = (r: Room) => polygonArea(r.points) / 144;
const ok = (f: ReturnType<typeof refitRoom>) => {
  assert.ok(f && !('error' in f));
  return f as RefitResult;
};

test('rooms that match their walls are not flagged', () => {
  const p = project([...box(240, 120), wall(120, 0, 120, 120, 'interior')], [], { rooms: [rect('A', 0, 0, 120, 120), rect('B', 120, 0, 240, 120)] });
  assert.deepEqual(staleRooms(p), []);
  assert.equal(ok(refitRoom(p, 'A')).changed, false);
});

test('a wall removed: re-fitting merges the neighbour into this room, which keeps its name, use and ceiling', () => {
  // Two 10x10 rooms; the wall between them has been deleted.
  const p = project(box(240, 120), [], {
    rooms: [rect('A', 0, 0, 120, 120, { name: 'Office', type: 'office', ceiling: { type: 'flat', height: 108 } }), rect('B', 120, 0, 240, 120)],
  });
  assert.equal(staleRooms(p).length, 2);
  const fit = ok(refitRoom(p, 'A'));
  assert.deepEqual(fit.merged.map((r) => r.id), ['B']);
  const q = applyRefit(p, fit);
  assert.equal(q.rooms.length, 1);
  assert.equal(q.rooms[0].name, 'Office');
  assert.equal(q.rooms[0].type, 'office');
  assert.equal(q.rooms[0].ceiling!.height, 108);
  assert.equal(Math.round(sqft(q.rooms[0])), 200);
  assert.deepEqual(staleRooms(q), []);
});

test('a wall added: the room keeps the larger part and the cut-off part becomes a new room', () => {
  // One 20x10 room, now with a wall 14 ft along.
  const p = project([...box(240, 120), wall(168, 0, 168, 120, 'interior')], [], { rooms: [rect('A', 0, 0, 240, 120, { name: 'Den', ceiling: { type: 'tray', trayDepth: 10 } })] });
  const fit = ok(refitRoom(p, 'A'));
  assert.equal(fit.added.length, 1);
  const q = applyRefit(p, fit);
  const a = q.rooms.find((r) => r.id === 'A')!;
  assert.equal(a.name, 'Den');
  assert.equal(Math.round(sqft(a)), 140);
  const b = q.rooms.find((r) => r.id !== 'A')!;
  assert.equal(Math.round(sqft(b)), 60);
  assert.equal(b.ceiling!.type, 'tray', 'the new room takes the old ceiling');
  assert.ok(b.name.length > 0, 'the new room gets a guessed name');
  assert.deepEqual(staleRooms(q), []);
});

test('walls with a gap: the room is flagged but left as drawn', () => {
  // The right wall is gone and nothing closes the room.
  const walls = box(240, 120).filter((w) => !(w.a.x === 240 && w.b.x === 240));
  const p = project(walls, [], { rooms: [rect('A', 0, 0, 240, 120)] });
  const f = refitRoom(p, 'A')!;
  assert.ok('error' in f);
  const all = refitAll(p);
  assert.deepEqual(all.open, ['A']);
  assert.equal(all.fitted, 0);
  assert.deepEqual(all.project.rooms, p.rooms);
});

test('a room drawn round a closet in its corner is not flagged while its walls are unchanged', () => {
  const walls = [...box(240, 120), wall(0, 48, 48, 48, 'interior'), wall(48, 0, 48, 48, 'interior')];
  const p = project(walls, [], { rooms: [rect('A', 0, 0, 240, 120), rect('C', 0, 0, 48, 48, { name: 'Closet', type: 'other' })] });
  assert.deepEqual(staleRooms(p), []);
});

test('a closet with its own walls is kept when the room round it is re-fitted', () => {
  // A 20x10 room with a 4x4 closet in the corner; the end wall has been moved out to 24 ft.
  const walls = [...box(288, 120), wall(0, 48, 48, 48, 'interior'), wall(48, 0, 48, 48, 'interior')];
  const p = project(walls, [], { rooms: [rect('A', 0, 0, 240, 120), rect('C', 0, 0, 48, 48, { name: 'Closet', type: 'other' })] });
  const q = refitAll(p).project;
  assert.equal(q.rooms.length, 2);
  assert.ok(q.rooms.some((r) => r.id === 'C' && Math.round(sqft(r)) === 16), 'closet kept');
  // The room is traced round the closet: 24 x 10 less the 4 x 4 closet.
  assert.ok(q.rooms.some((r) => r.id === 'A' && Math.round(sqft(r)) === 224));
  assert.deepEqual(staleRooms(q), []);
});

test('re-fit is one undo step', () => {
  const p = project(box(240, 120), [], { rooms: [rect('A', 0, 0, 120, 120), rect('B', 120, 0, 240, 120)] });
  let h = initHistory(p);
  h = historyReducer(h, { type: 'setRooms', rooms: refitAll(p).project.rooms });
  assert.equal(h.present.rooms.length, 1);
  h = historyReducer(h, { type: 'undo' });
  assert.equal(h.present.rooms.length, 2);
});
