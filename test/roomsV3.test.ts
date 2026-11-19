import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ceilingInfo } from '../src/calc/ceilings.ts';
import { ircChecks } from '../src/calc/irc.ts';
import { roomCeiling } from '../src/calc/model3d.ts';
import { slopeFrame } from '../src/calc/outline.ts';
import { clearNarrowest, clearOutline, cofferBeams, insetPolygon, perimeter, trayOutline } from '../src/calc/roomShape.ts';
import { polygonArea } from '../src/model/geometry.ts';
import { mirrorRoom } from '../src/model/wallEdit.ts';
import type { Ceiling, Point, Room, RoomType } from '../src/model/types.ts';
import { box, project, wall } from './helpers.ts';

const rect = (w: number, h: number): Point[] => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const L: Point[] = [{ x: 0, y: 0 }, { x: 144, y: 0 }, { x: 144, y: 60 }, { x: 60, y: 60 }, { x: 60, y: 144 }, { x: 0, y: 144 }];
const room = (points: Point[], type: RoomType = 'bedroom', ceiling?: Ceiling): Room => ({ id: 'r', name: 'R', type, points, ceiling });
const r304 = (p: ReturnType<typeof project>) => ircChecks(p).find((c) => c.section === 'R304.2')!;

test('insetPolygon: a rectangle shrinks evenly, an L keeps its shape, too much inset is refused', () => {
  assert.deepEqual(insetPolygon(rect(100, 50), 10), [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 40 }, { x: 10, y: 40 }]);
  const l = insetPolygon(L, 12)!;
  assert.equal(l.length, 6);
  assert.ok(Math.abs(perimeter(l) - (perimeter(L) - 8 * 12)) < 1e-6);
  assert.equal(insetPolygon(L, 40), null); // the 60" leg can't lose 80"
  // Either winding.
  assert.ok(Math.abs(polygonArea(insetPolygon([...L].reverse(), 12)!) - polygonArea(l)) < 1e-6);
});

test('R304.2 is checked between finished faces: an 84" centreline room is under 7 ft clear', () => {
  // 7' 0" between wall centrelines, 2x4 interior partitions (4-1/2" finished) all round.
  const walls = [wall(0, 0, 144, 0, 'interior'), wall(144, 0, 144, 84, 'interior'), wall(144, 84, 0, 84, 'interior'), wall(0, 84, 0, 0, 'interior')];
  const p = project(walls, [], { rooms: [room(rect(144, 84))] });
  const c = r304(p);
  assert.equal(c.status, 'fail');
  assert.match(c.message, /6' 7-1\/2" clear between finished faces \(7' 0" on the wall lines\)/);
  assert.equal(clearNarrowest(p, p.rooms[0])!.width, 84 - 4.5);
  // 7' 4-1/2" on the lines clears 7 ft at the faces.
  const wide = project(walls.map((w) => ({ ...w, a: { ...w.a, y: w.a.y && 88.5 }, b: { ...w.b, y: w.b.y && 88.5 } })), [], { rooms: [room(rect(144, 88.5))] });
  assert.equal(r304(wide).status, 'pass');
});

test('the clear outline only pulls in edges that have a wall; the narrowest line runs face to face', () => {
  // Bottom edge open (no wall there): only top and sides move in.
  const walls = [wall(0, 0, 144, 0, 'interior'), wall(144, 0, 144, 120, 'interior'), wall(0, 120, 0, 0, 'interior')];
  const p = project(walls, [], { rooms: [room(rect(144, 120))] });
  const o = clearOutline(p, p.rooms[0]);
  assert.deepEqual(o, [{ x: 2.25, y: 2.25 }, { x: 141.75, y: 2.25 }, { x: 141.75, y: 120 }, { x: 2.25, y: 120 }]);
  const n = clearNarrowest(p, p.rooms[0])!;
  assert.equal(n.width, 117.75);
  assert.ok(Math.abs(n.from.y - n.to.y) === 117.75 && n.from.x === n.to.x);
});

test('a tray ceiling on an L follows the outline, not the bounding box', () => {
  const r = room(L, 'living', { type: 'tray', height: 96, trayDepth: 12, trayInset: 12 });
  const p = project(box(240, 240));
  const inner = trayOutline(L, 12)!;
  const info = ceilingInfo(p, r);
  assert.ok(Math.abs(info.surface - (polygonArea(L) + perimeter(inner) * 12)) < 1e-6);
  assert.equal(info.beamLength, perimeter(inner));
  const c = roomCeiling(p, r);
  assert.equal(c.flats.length, 2);
  assert.deepEqual(c.flats[1].outline, inner);
  assert.equal(c.faces.length, 6); // one step face per edge of the L
  // A rectangle is unchanged from the old bounding-box tray.
  const rr = room(rect(240, 144), 'living', { type: 'tray', height: 96, trayDepth: 12, trayInset: 24 });
  assert.equal(ceilingInfo(p, rr).surface, 240 * 144 + 2 * (192 + 96) * 12);
});

test('coffer beams are clipped to the real outline', () => {
  // Rectangle: same grid as before (4 across a 240" side at 48", 2 down a 144" side).
  const rb = cofferBeams(rect(240, 144), 48);
  assert.equal(rb.length, 4 + 2);
  const len = (bs: { a: Point; b: Point }[]) => bs.reduce((s, b) => s + Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y), 0);
  assert.equal(len(rb), 4 * 144 + 2 * 240);
  // L: no beam crosses the notch.
  const lb = cofferBeams(L, 48);
  for (const b of lb) {
    const mid = { x: (b.a.x + b.b.x) / 2, y: (b.a.y + b.b.y) / 2 };
    assert.ok(!(mid.x > 60 && mid.y > 60), JSON.stringify(b));
  }
  const p = project(box(240, 240));
  const info = ceilingInfo(p, room(L, 'living', { type: 'coffered', height: 108, cofferSpacing: 48, cofferDepth: 8 }));
  assert.equal(info.beamLength, len(lb) + perimeter(L));
  assert.equal(roomCeiling(p, room(L, 'living', { type: 'coffered', height: 108 })).boxes.length, lb.length);
});

test('a room picks its slope direction: the low side along any edge', () => {
  // Default: square to the longest edge (rises across the 144").
  assert.deepEqual(slopeFrame(rect(240, 144)), { dir: { x: 0, y: 1 }, d0: 0, span: 144 });
  // Low side along the right edge (index 1): rises leftward across the 240".
  const f = slopeFrame(rect(240, 144), 1)!;
  assert.deepEqual([f.dir, f.span], [{ x: -1, y: 0 }, 240]);
  const p = project(box(240, 144));
  const r = room(rect(240, 144), 'living', { type: 'vaulted', height: 96, peak: 144, slopeEdge: 1 });
  assert.ok(Math.abs(ceilingInfo(p, r).surface - 240 * 144 * Math.hypot(1, 48 / 240)) < 1e-6);
  // In 3D the low side is the right edge (x = 240) and the high side x = 0.
  const pts = roomCeiling(p, r).faces.filter((x) => x.kind === 'ceiling').flatMap((x) => x.pts);
  for (const [x, y] of pts) assert.ok(Math.abs(y - (96 + (48 * (240 - x)) / 240)) < 1e-6);
  // Mirrored left ↔ right, the low side follows to the left edge.
  const m = mirrorRoom({ ...p, rooms: [r] }, 'r', 'x');
  const low = slopeFrame(m.rooms[0].points, m.rooms[0].ceiling!.slopeEdge)!;
  assert.deepEqual(low.dir, { x: 1, y: 0 });
});
