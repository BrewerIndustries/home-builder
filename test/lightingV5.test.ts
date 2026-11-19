import assert from 'node:assert/strict';
import { test } from 'node:test';
import { furnitureLines } from '../src/calc/furniture.ts';
import { lightingChecks } from '../src/calc/lighting.ts';
import { estimate } from '../src/calc/pricing.ts';
import { stairChecks, stairGeometry, stairRailing, stairSides } from '../src/calc/stairs.ts';
import type { Furniture, Point } from '../src/model/types.ts';
import { box, project } from './helpers.ts';

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
/** A stair against the top wall of a 20' × 12' room, foot at the right, walking up to the left (−x): its right side is the wall. */
const stairRoom = (st: Partial<Furniture> = {}) => {
  const p = project(box(240, 144), [], { rooms: [{ id: 'L', name: 'Living', type: 'living', points: rect(0, 0, 240, 144) }] });
  const f: Furniture = { id: 'st', kind: 'stairs', at: { x: 3.25 + 143 / 2, y: 21.25 }, rot: 270, w: 36, d: 143, risers: 14, ...st };
  return { ...p, furniture: [f] };
};
const check = (p: ReturnType<typeof stairRoom>, rule: RegExp) => stairChecks(p).find((c) => rule.test(c.rule));

test('the side against a wall is found; the room side is open', () => {
  const p = stairRoom();
  assert.deepEqual(stairSides(p, p.furniture[0]), { left: false, right: true });
  // Moved off the wall, both sides are open.
  const free = stairRoom({ at: { x: 3.25 + 143 / 2, y: 72 } });
  assert.deepEqual(stairSides(free, free.furniture[0]), { left: false, right: false });
});

test('R311.7.8: a handrail on a side of four or more risers, 34"–38" high', () => {
  assert.equal(check(stairRoom(), /^Handrail \(/)!.status, 'pass');
  assert.equal(check(stairRoom(), /^Handrail height/)!.status, 'pass');
  assert.equal(check(stairRoom({ handrails: 'none' }), /^Handrail \(/)!.status, 'fail');
  assert.equal(check(stairRoom({ handrails: 'none' }), /^Handrail height/), undefined);
  assert.equal(check(stairRoom({ handrailHeight: 33 }), /^Handrail height/)!.status, 'fail');
  assert.equal(check(stairRoom({ handrailHeight: 38 }), /^Handrail height/)!.status, 'pass');
  // Three risers: no handrail needed, so no check.
  assert.equal(check(stairRoom({ risers: 3, rise: 21, d: 30, at: { x: 20, y: 21.25 } }), /^Handrail/), undefined);
});

test('R312.1.1: a guard on the open side from the first riser more than 30" up', () => {
  const p = stairRoom();
  const g = stairGeometry(p, p.furniture[0]);
  const rail = stairRailing(p, p.furniture[0]);
  assert.deepEqual(rail.open, ['left']);
  // 30" / riser, rounded down, then the next riser.
  assert.equal(rail.guardFrom, Math.floor(30 / g.riser) + 1);
  const c = check(p, /^Guards/)!;
  assert.equal(c.status, 'pass');
  assert.match(c.message, /open on the left: a guard from riser \d+ up, 34" high/);
  assert.equal(check(stairRoom({ guards: false }), /^Guards/)!.status, 'fail');
  // Going down from this floor, the guard is round the opening, 36".
  assert.match(check(stairRoom({ down: true }), /^Guards/)!.message, /36" guard round the floor opening/);
  // A short stair (30" or less) needs no guard.
  assert.equal(check(stairRoom({ risers: 4, rise: 28, d: 40, at: { x: 25, y: 21.25 } }), /^Guards/), undefined);
});

test('handrails and guards are measured along the slope and priced', () => {
  const p = stairRoom({ handrails: 'both' });
  const g = stairGeometry(p, p.furniture[0]);
  const rail = stairRailing(p, p.furniture[0]);
  assert.ok(Math.abs(rail.handrail - 2 * Math.hypot(143, g.rise)) < 1e-6);
  assert.ok(rail.guard > 0 && rail.guard < Math.hypot(143, g.rise));
  const lines = furnitureLines(p);
  assert.equal(lines.find((l) => l.item.startsWith('Stair handrail'))!.qty, Math.ceil(rail.handrail / 12));
  assert.equal(lines.find((l) => l.item.startsWith('Stair guard'))!.qty, Math.ceil(rail.guard / 12));
  assert.ok(estimate(lines).lines.filter((l) => l.item.startsWith('Stair')).every((l) => l.unitPrice > 0));
  assert.equal(furnitureLines(stairRoom({ handrails: 'none', guards: false })).some((l) => l.item.startsWith('Stair')), false);
});

test('M1305.1.3: equipment in the attic lists the access it needs', () => {
  const p = stairRoom();
  const withRoof = { ...p, roof: { type: 'gable' as const }, electrical: { attic: 'equipment' as const } };
  const roofed = lightingChecks({ ...withRoof, fixtures: [{ id: 'l', kind: 'light', at: { x: 120, y: 72 } }] } as never);
  const c = roofed.find((x) => x.section === 'M1305.1.3');
  if (!c) return assert.fail('no attic access check: ' + roofed.map((x) => x.section).join());
  assert.match(c.message, /20" × 30".*30" high and 22" wide.*20 ft.*30" × 30"/);
  const storage = lightingChecks({ ...withRoof, electrical: { attic: 'storage' }, fixtures: [{ id: 'l', kind: 'light', at: { x: 120, y: 72 } }] } as never);
  assert.equal(storage.some((x) => x.section === 'M1305.1.3'), false);
});
