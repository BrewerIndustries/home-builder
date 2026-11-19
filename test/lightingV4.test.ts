import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixtureSchedule, furnitureChecks, furnitureLines, newFurniture } from '../src/calc/furniture.ts';
import { ircChecks } from '../src/calc/irc.ts';
import { autoLighting, lightingChecks, lightingLines, switchWays } from '../src/calc/lighting.ts';
import { estimate } from '../src/calc/pricing.ts';
import { floorToFloor, landingPoint, stairChecks, stairGeometry } from '../src/calc/stairs.ts';
import { projectReducer } from '../src/model/store.ts';
import type { Furniture, Point, Project } from '../src/model/types.ts';
import { box, door, project, wall } from './helpers.ts';

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const lit = (p: Project) => {
  const { fixtures, switches } = autoLighting(p);
  return projectReducer(p, { type: 'replaceAutoLighting', fixtures, switches });
};

test('a furnace or air handler makes its room an E3903.4 equipment room and wants 30" × 30" in front (M1305.1)', () => {
  const walls = [...box(240, 144), wall(200, 0, 200, 48, 'interior'), wall(200, 48, 240, 48, 'interior')];
  const p = project(walls, [{ ...door(walls[5].id, 20, 30), swing: { side: -1, hinge: 'a' } }], {
    rooms: [
      { id: 'L', name: 'Living', type: 'living', points: rect(0, 0, 240, 144) },
      { id: 'C', name: 'Mech', type: 'other', points: rect(200, 0, 240, 48) },
    ],
  });
  const placed = newFurniture(p, 'furnace', { x: 220, y: 16 }, 'fu');
  assert.deepEqual([placed.w, placed.d], [22, 30]);
  const withF = { ...p, furniture: [{ ...placed, at: { x: 220, y: 18.25 }, rot: 0 }] };
  // E3903.4: lit by auto layout.
  const check = lightingChecks(lit(withF)).find((c) => c.section === 'E3903.4' && c.targetId === 'C')!;
  assert.deepEqual([check.status, check.message], ['pass', 'Mech (furnace): wall-switched light']);
  // M1305.1: the closet is 4' deep, so the 30" in front of the furnace runs out through the door gap (the door swings out of the closet).
  const ws = furnitureChecks(withF).find((c) => c.rule === 'Appliance working space (furnace)')!;
  assert.equal(ws.section, 'M1305.1');
  assert.equal(ws.status, 'pass');
  // Without the door it's blocked.
  assert.equal(furnitureChecks({ ...withF, openings: [] }).find((c) => c.rule === 'Appliance working space (furnace)')!.status, 'fail');
  // Scheduled and priced.
  assert.deepEqual(fixtureSchedule(withF).map((r) => r.mark), ['F-1']);
  const lines = furnitureLines(withF);
  assert.equal(lines.find((l) => l.item === 'Furnace (allowance)')!.qty, 1);
  assert.ok(estimate(lines).lines.every((l) => l.unitPrice > 0));
  const ah = projectReducer(p, { type: 'addFurniture', item: newFurniture(p, 'air-handler', { x: 220, y: 16 }, 'ah') });
  assert.match(lightingChecks(lit(ah)).find((c) => c.section === 'E3903.4' && c.targetId === 'C')!.message, /\(air handler\)/);
});

/** A stair along the top of a 20' × 12' room, foot at the right; a 30' × 12' room for a long one. */
const stairRoom = (st: Partial<Furniture>, w = 240) => {
  const p = project(box(w, 144), [], { rooms: [{ id: 'L', name: 'Living', type: 'living', points: rect(0, 0, w, 144) }] });
  const f: Furniture = { id: 'st', kind: 'stairs', at: { x: 3.25 + (st.d ?? 143) / 2, y: 21.25 }, rot: 270, w: 36, d: 143, risers: 14, ...st };
  return { ...p, furniture: [f] };
};

test('a new stair gets enough risers for the floor height and 11" treads; R311.7 checks pass', () => {
  const p = project(box(240, 144));
  // 8' 1-1/8" walls + 2x10 joists + 3/4" subfloor.
  assert.equal(floorToFloor(p, { id: 'x', kind: 'stairs', at: { x: 0, y: 0 }, rot: 0, w: 36, d: 120 }), 107.125);
  const st = newFurniture(p, 'stairs', { x: 120, y: 72 }, 's');
  assert.deepEqual([st.risers, st.d], [14, 143]);
  const checks = stairChecks({ ...p, furniture: [st] });
  assert.deepEqual(
    checks.map((c) => [c.section, c.status]),
    [
      ['R311.7.1', 'pass'],
      ['R311.7.5.1', 'pass'],
      ['R311.7.5.2', 'pass'],
      ['R311.7.3', 'pass'],
      ['R311.7.2', 'info'],
    ],
  );
  // Headroom: with a 97-1/8" ceiling, steps over 17-1/8" up need the opening: from the 3rd tread on.
  const g = stairGeometry(p, st);
  assert.equal(g.opening, 143 - 2 * 11);
  assert.match(checks[4].message, /floor opening over the flight \(in the floor above\) has to run at least 10' 1" back from the top/);
  // Reaches the report.
  assert.ok(ircChecks({ ...p, furniture: [st] }).some((c) => c.section === 'R311.7.5.1'));
});

test('steep, shallow, narrow and tall stairs fail; a landing splits a tall flight', () => {
  const p = project(box(240, 144));
  const st: Furniture = { id: 's', kind: 'stairs', at: { x: 120, y: 72 }, rot: 0, w: 32, d: 120, risers: 13 };
  const by = (q: Furniture) => Object.fromEntries(stairChecks({ ...p, furniture: [q] }).map((c) => [c.section, c]));
  const c = by(st);
  assert.equal(c['R311.7.1'].status, 'fail');
  assert.match(c['R311.7.5.1'].message, /needs 14 or more/);
  assert.match(c['R311.7.5.2'].message, /12 treads in 10' 0" of run = 10"$/);
  assert.equal(c['R311.7.5.2'].status, 'pass');
  assert.equal(by({ ...st, d: 100 })['R311.7.5.2'].status, 'fail');
  // A 13' 4" rise in one flight is too much; a landing at riser 11 of 21 splits it.
  const tall: Furniture = { ...st, w: 36, risers: 21, rise: 160, d: 20 * 11 };
  assert.equal(by(tall)['R311.7.3'].status, 'fail');
  const landed = { ...tall, landing: 11, d: 19 * 11 + 36 };
  const l = by(landed);
  assert.equal(l['R311.7.3'].status, 'pass');
  assert.equal(l['R311.7.6'].status, 'pass');
  assert.equal(stairGeometry(p, landed).tread, 11);
});

test('a landing with a door off it gets its own switch: a 4-way between the foot\'s 3-way and the other level\'s', () => {
  // A 30' room; 21-riser stair along the top wall (foot at the right end), landing at riser 11.
  const st: Partial<Furniture> = { risers: 21, rise: 160, landing: 11, landingEntry: true, d: 19 * 11 + 36 };
  const p = stairRoom(st, 360);
  const lp = landingPoint(p, p.furniture[0])!;
  // 10 treads of 11" from the foot, then half the 36" landing.
  assert.ok(Math.abs(lp.x - (3.25 + 245 - 110 - 18)) < 1e-9);
  const q = lit(p);
  const ways = switchWays(q);
  const stairSw = q.switches.filter((s) => s.controls.length && q.fixtures.some((f) => s.controls.includes(f.id) && Math.abs(f.at.y - 21) < 2));
  assert.deepEqual(stairSw.map((s) => ways.get(s.id)).sort(), [3, 4]);
  const check = lightingChecks(q).find((c) => c.rule === 'Stairway switched at the landing with an entry')!;
  assert.deepEqual([check.status, check.message], ['pass', 'Stairs (21 risers up): 4-way at the landing (riser 11)']);
  assert.equal(lightingLines(q).find((l) => l.item === '4-way switch, 15A')!.qty, 1);
  // No entry at the landing: no landing switch asked for.
  assert.ok(!lightingChecks(lit(stairRoom({ ...st, landingEntry: undefined }, 360))).some((c) => c.rule.includes('landing')));
});
