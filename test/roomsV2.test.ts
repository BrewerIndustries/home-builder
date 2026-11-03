import assert from 'node:assert/strict';
import { test } from 'node:test';
import { areaWithHeadroom, ceilingInfo } from '../src/calc/ceilings.ts';
import { ircChecks } from '../src/calc/irc.ts';
import { roomCeiling } from '../src/calc/model3d.ts';
import { narrowest, slopeFrame, triangulate } from '../src/calc/outline.ts';
import { guessRoom } from '../src/calc/roomGuess.ts';
import { polygonArea } from '../src/model/geometry.ts';
import type { Ceiling, Point, Room, RoomType } from '../src/model/types.ts';
import { box, door, project, wall } from './helpers.ts';

const rect = (w: number, h: number): Point[] => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
/** 12' × 12' overall with a 5' leg: the bounding box says 12', the room is 5' wide down the leg. */
const L: Point[] = [{ x: 0, y: 0 }, { x: 144, y: 0 }, { x: 144, y: 60 }, { x: 60, y: 60 }, { x: 60, y: 144 }, { x: 0, y: 144 }];
const room = (points: Point[], type: RoomType = 'bedroom', ceiling?: Ceiling): Room => ({ id: 'r', name: 'R', type, points, ceiling });
const check = (rooms: Room[], rule: string) => ircChecks(project(box(240, 240), [], { rooms })).find((c) => c.rule.startsWith(rule))!;

test('narrowest: a rectangle reads its short side, an L its narrower leg, either winding', () => {
  assert.equal(narrowest(rect(240, 144))!.width, 144);
  assert.equal(narrowest(L)!.width, 60);
  assert.equal(narrowest([...L].reverse())!.width, 60);
  // A 45° chamfer on one corner doesn't make it narrower than its sides.
  const chamfer = [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 144, y: 24 }, { x: 144, y: 120 }, { x: 0, y: 120 }];
  assert.equal(narrowest(chamfer)!.width, 120);
});

test('R304.2 measures the real outline, not the bounding box', () => {
  const l = check([room(L)], 'Minimum habitable room dimension');
  assert.equal(l.status, 'fail');
  assert.match(l.message, /5' 0"/);
  assert.equal(check([room(rect(144, 120))], 'Minimum habitable room dimension').status, 'pass');
});

test('sloped ceilings rise square to the longest edge, across the real outline', () => {
  assert.deepEqual(slopeFrame(rect(240, 144)), { dir: { x: 0, y: 1 }, d0: 0, span: 144 });
  // A vault on a 20' × 12' room: 8' → 12' across 12'.
  const r = room(rect(240, 144), 'living', { type: 'vaulted', height: 96, peak: 144 });
  const info = ceilingInfo(project(box(240, 144)), r);
  assert.ok(Math.abs(info.surface - 240 * 144 * Math.hypot(1, 48 / 144)) < 1e-6);
  // Headroom: all of it clears 8', half of it 10', none of it 12' 1".
  const p = project(box(240, 144));
  assert.equal(areaWithHeadroom(p, r, 96), 240 * 144);
  assert.ok(Math.abs(areaWithHeadroom(p, r, 120) - 240 * 72) < 1e-6);
  assert.equal(areaWithHeadroom(p, r, 145), 0);
  // Cathedral: the band around the ridge.
  const cath = room(rect(240, 144), 'living', { type: 'cathedral', height: 96, peak: 144 });
  assert.ok(Math.abs(areaWithHeadroom(p, cath, 120) - 240 * 72) < 1e-6);
});

test('R304.3: floor under 5 ft of headroom does not count toward the 70 sq ft', () => {
  // 10' × 8' bedroom vaulted 3' → 9' across the 8': only the high two thirds clears 5 ft.
  const r = room(rect(120, 96), 'bedroom', { type: 'vaulted', height: 36, peak: 108 });
  const c = check([r], 'Minimum habitable room area');
  assert.deepEqual([c.status, c.section], ['fail', 'R304.3']);
  assert.match(c.message, /53\.3 sq ft with 5 ft headroom/);
  // The same room with a flat 8' ceiling is 80 sq ft and passes R304.1.
  assert.deepEqual([check([room(rect(120, 96))], 'Minimum habitable room area').status, check([room(rect(120, 96))], 'Minimum habitable room area').section], ['pass', 'R304.1']);
});

test('R305.1.1 fails a vault with too little 7 ft headroom', () => {
  // 10' × 10' vaulted 4' → 7' 6": only the top 6% of the way across clears 7 ft.
  const r = room(rect(120, 120), 'bedroom', { type: 'vaulted', height: 48, peak: 90 });
  const c = check([r], 'Minimum ceiling height');
  assert.deepEqual([c.status, c.section], ['fail', 'R305.1.1']);
  // A bath is flagged for review instead.
  assert.equal(check([{ ...r, type: 'bath' }], 'Minimum ceiling height').status, 'warn');
});

test('a vault over an L-shaped room covers the outline in 3D and tops out at the peak', () => {
  const r = room(L, 'living', { type: 'vaulted', height: 96, peak: 168 });
  const c = roomCeiling(project(box(240, 240)), r);
  const ceil = c.faces.filter((f) => f.kind === 'ceiling');
  const projected = ceil.reduce((s, f) => s + polygonArea(f.pts.map(([x, , z]) => ({ x, y: z }))), 0);
  assert.ok(Math.abs(projected - polygonArea(L)) < 1e-6, `${projected}`);
  assert.equal(Math.max(...c.faces.flatMap((f) => f.pts.map((p) => p[1]))), 168);
  assert.ok(c.faces.some((f) => f.kind === 'gable'));
  assert.equal(triangulate(L).length, 4);
});

test('guessing a room from its size, doors and counters', () => {
  const p = project(box(480, 480));
  const guess = (pts: Point[], extra: Partial<typeof p> = {}) => guessRoom({ ...p, ...extra }, room(pts));
  assert.deepEqual(guess(rect(48, 60)), { type: 'other', name: 'Closet' });
  assert.deepEqual(guess(rect(42, 240)), { type: 'hall', name: 'Hall' });
  assert.deepEqual(guess(rect(96, 96)), { type: 'bath', name: 'Bath' });
  assert.deepEqual(guess(rect(144, 132)), { type: 'bedroom', name: 'Bedroom' });
  assert.deepEqual(guess(rect(240, 180)), { type: 'living', name: 'Living' });
  // A 16' door makes it a garage; the top wall of the box is (0,0) → (480,0).
  const top = p.walls[0];
  assert.deepEqual(guess(rect(240, 240), { openings: [door(top.id, 120, 192, 84)] }).type, 'garage');
  // 13' × 12' with a front door to the outside reads as a living room, not a bedroom.
  assert.equal(guess(rect(156, 144), { openings: [door(top.id, 72)] }).type, 'living');
  assert.equal(guess(rect(156, 144)).type, 'bedroom');
  // Numbered when the name is taken.
  const taken = { rooms: [{ id: 'b1', name: 'Bedroom', type: 'bedroom' as const, points: rect(10, 10) }, { id: 'b2', name: 'Bedroom 2', type: 'bedroom' as const, points: rect(10, 10) }] };
  assert.equal(guess(rect(144, 132), taken).name, 'Bedroom 3');
  // An interior wall's door doesn't count as a way outside.
  const inner = wall(0, 144, 156, 144, 'interior');
  assert.equal(guess(rect(156, 144), { walls: [...p.walls, inner], openings: [door(inner.id, 72)] }).type, 'bedroom');
});
