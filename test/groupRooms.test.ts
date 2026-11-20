import assert from 'node:assert/strict';
import { test } from 'node:test';
import { historyReducer, initHistory } from '../src/model/store.ts';
import type { Room } from '../src/model/types.ts';
import { box, project } from './helpers.ts';

const room = (id: string, x: number, extra: Partial<Room> = {}): Room => ({
  id,
  name: id,
  type: 'bedroom',
  points: [{ x, y: 0 }, { x: x + 120, y: 0 }, { x: x + 120, y: 96 }, { x, y: 96 }],
  ...extra,
});

test('a ceiling height typed for several picked rooms changes every one of them, in one undo step', () => {
  const p = project(box(400, 96), [], {
    rooms: [room('A', 0), room('B', 130, { ceiling: { type: 'tray', trayDepth: 10 } }), room('C', 260, { ceiling: { type: 'flat', height: 100 } })],
  });
  let h = initHistory(p);
  h = historyReducer(h, { type: 'updateRooms', ids: ['A', 'B'], ceiling: { height: 108 } });
  const byId = (id: string) => h.present.rooms.find((r) => r.id === id)!;
  assert.deepEqual(byId('A').ceiling, { type: 'flat', height: 108 });
  // B keeps its tray settings; only the height changes.
  assert.deepEqual(byId('B').ceiling, { type: 'tray', trayDepth: 10, height: 108 });
  // C wasn't picked.
  assert.equal(byId('C').ceiling!.height, 100);
  h = historyReducer(h, { type: 'undo' });
  assert.equal(h.present.rooms.find((r) => r.id === 'A')!.ceiling, undefined);
  assert.equal(h.present.rooms.find((r) => r.id === 'B')!.ceiling!.height, undefined);
});

test('style and use can be set for several rooms at once', () => {
  const p = project(box(400, 96), [], { rooms: [room('A', 0), room('B', 130)] });
  let h = initHistory(p);
  h = historyReducer(h, { type: 'updateRooms', ids: ['A', 'B'], ceiling: { type: 'vaulted' }, patch: { type: 'living' } });
  for (const r of h.present.rooms) {
    assert.equal(r.ceiling!.type, 'vaulted');
    assert.equal(r.type, 'living');
  }
});
