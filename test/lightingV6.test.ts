import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accessChecks } from '../src/calc/access.ts';
import { furnitureLines } from '../src/calc/furniture.ts';
import { floorOpenings } from '../src/calc/house.ts';
import { ircChecks } from '../src/calc/irc.ts';
import { lightingChecks } from '../src/calc/lighting.ts';
import { estimate } from '../src/calc/pricing.ts';
import { flightsOf, landingOf, pathLength, stairSegments } from '../src/calc/stairShape.ts';
import { handrailNotes, landingPoint, openingRects, stairChecks, stairEnd, stairFoot, stairGeometry, stairRailing } from '../src/calc/stairs.ts';
import { addStorey, storeyView, switchStorey } from '../src/model/storeys.ts';
import { mirrorRoom } from '../src/model/wallEdit.ts';
import { DEFAULT_FOUNDATION, DEFAULT_ROOF, type Furniture, type Point, type Project } from '../src/model/types.ts';
import { box, project } from './helpers.ts';

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
/** A 30' × 20' room, the stair free-standing in it at (180, 120). */
const room = (f: Partial<Furniture>, patch: Partial<Project> = {}): Project =>
  project(box(360, 240), [], { rooms: [{ id: 'L', name: 'Living', type: 'living', points: rect(0, 0, 360, 240) }], furniture: [{ id: 'st', kind: 'stairs', at: { x: 180, y: 120 }, rot: 0, w: 102, d: 102, risers: 14, ...f }], ...patch });
/** 14 risers, 7 a flight, 36" flights and 11" treads. */
const L: Partial<Furniture> = { shape: 'L', w: 102, d: 102 };
const U: Partial<Furniture> = { shape: 'U', w: 76, d: 102 };
const near = (p: Point, q: Point) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6;
const by = (p: Project) => Object.fromEntries(stairChecks(p).map((c) => [c.section, c]));

test('an L stair: two flights round a square landing, turning right (or left, mirrored)', () => {
  const f = room(L).furniture[0];
  const segs = stairSegments(f);
  assert.deepEqual(segs.map((s) => [s.kind, s.risers, s.len]), [['flight', 7, 66], ['landing', 0, 36], ['flight', 7, 66]]);
  assert.deepEqual(segs[0].rect, { x0: -51, y0: -15, x1: -15, y1: 51 });
  assert.deepEqual(segs[2].rect, { x0: -15, y0: -51, x1: 51, y1: -15 });
  assert.ok(near(stairFoot(f), { x: 180 - 33, y: 120 + 51 }));
  assert.ok(near(stairEnd(f).at, { x: 180 + 51, y: 120 - 33 }));
  assert.ok(near(stairEnd(f).dir, { x: 1, y: 0 }));
  assert.ok(near(landingPoint(room(L), f)!, { x: 180 - 33, y: 120 - 33 }));
  const left = { ...f, turn: 'left' as const };
  assert.ok(near(stairFoot(left), { x: 180 + 33, y: 120 + 51 }));
  assert.ok(near(stairEnd(left).at, { x: 180 - 51, y: 120 - 33 }));
  assert.equal(pathLength(f), 168);
});

test('a U stair: the second flight comes back beside the first across a full-width landing', () => {
  const f = room(U).furniture[0];
  const [a, l, b] = stairSegments(f);
  assert.deepEqual(a.rect, { x0: -38, y0: -15, x1: -2, y1: 51 });
  assert.deepEqual(l.rect, { x0: -38, y0: -51, x1: 38, y1: -15 });
  assert.deepEqual(b.rect, { x0: 2, y0: -15, x1: 38, y1: 51 });
  assert.ok(near(stairEnd(f).at, { x: 180 + 20, y: 120 + 51 }));
  assert.ok(near(stairEnd(f).dir, { x: 0, y: 1 }));
  assert.equal(landingOf({ ...f, landingDepth: 48 })!.rect.y1, -51 + 48);
});

test('R311.7 per flight: width, treads, flight rise and the landing; all pass as drawn', () => {
  for (const shape of [L, U]) {
    const p = room(shape);
    const g = stairGeometry(p, p.furniture[0]);
    assert.deepEqual(g.flightRuns!.map((r) => [r.risers, r.treads, r.tread]), [[7, 6, 11], [7, 6, 11]]);
    const c = by(p);
    for (const s of ['R311.7.1', 'R311.7.5.1', 'R311.7.5.2', 'R311.7.3', 'R311.7.6', 'R311.7.8', 'R311.7.8.1']) assert.equal(c[s].status, 'pass', `${shape.shape} ${s}: ${c[s].message}`);
    assert.match(c['R311.7.5.2'].message, /flight 1: 6 treads in 5' 6" = 11"; flight 2: 6 treads in 5' 6" = 11"/);
    assert.match(c['R311.7.1'].message, new RegExp(`${shape.shape}-shaped`));
  }
  // A short second flight: its treads fail.
  assert.equal(by(room({ ...L, w: 90 }))['R311.7.5.2'].status, 'fail');
  // Narrow flights fail the width; a shallow U landing fails R311.7.6.
  assert.equal(by(room({ ...L, flight: 32 }))['R311.7.1'].status, 'fail');
  assert.equal(by(room({ ...U, landingDepth: 30 }))['R311.7.6'].status, 'fail');
  // Each flight of four or more risers is checked for its handrail.
  const none = stairChecks(room({ ...L, handrails: 'none' })).filter((c) => c.section === 'R311.7.8');
  assert.deepEqual(none.map((c) => c.status), ['fail', 'fail']);
});

test('railing: a handrail along each flight, guards on open sides and the landing', () => {
  const p = room(L);
  const f = p.furniture[0];
  const g = stairGeometry(p, f);
  const r = stairRailing(p, f);
  const flight = Math.hypot(66, 7 * g.riser);
  assert.ok(Math.abs(r.handrail - 2 * flight) < 1e-6);
  assert.deepEqual(r.open, ['left', 'right']);
  assert.ok(r.guard > 2 * flight);
  // Against walls on the outside of the turn (the room's corner): fewer guards.
  const corner = room({ ...L, at: { x: 3.25 + 51, y: 3.25 + 51 } });
  assert.ok(stairRailing(corner, corner.furniture[0]).guard < r.guard);
  assert.ok(furnitureLines(p).some((l) => l.item === 'Stair guard / balustrade (allowance)'));
});

test('R311.7.2: headroom along the walk line, against the floor opening above', () => {
  const p = room(L, { roof: DEFAULT_ROOF });
  const f = p.furniture[0];
  // 97-1/8" ceiling: from the 3rd riser on (2 treads in), the rest of the 168" walk line.
  assert.equal(stairGeometry(p, f).opening, 168 - 22);
  // Just long enough: the upper flight, the landing and most of the first flight; unset, the whole stair.
  assert.equal(openingRects(f).length, 3);
  const rs = openingRects({ ...f, floorOpening: 146 });
  assert.equal(rs.length, 3);
  assert.deepEqual(rs[0], { x0: -51, y0: -15, x1: -15, y1: 29 });
  // With a floor above, a short opening fails.
  let q = addStorey(p, 1, 'up');
  q = switchStorey(q, 'ground');
  const head = (x: Project) => stairChecks(x).find((c) => c.section === 'R311.7.2')!;
  assert.equal(head(q).status, 'pass');
  const short = { ...q, furniture: [{ ...f, floorOpening: 100 }] };
  assert.equal(head(short).status, 'fail');
  // The opening shows on the floor above, one polygon per part.
  assert.equal(floorOpenings(short, 'up')[0].polys.length, 2);
  assert.equal(storeyView(short, 'up').furniture.length, 0);
});

test('R311.7.8.2: a note on handrail continuity and returns, only where a handrail is needed', () => {
  const p = room(L);
  const n = handrailNotes(p);
  assert.equal(n.length, 1);
  assert.match(n[0].message, /continuous from over the lowest riser to over the highest \(a newel post may break it at the turn\)/);
  assert.ok(ircChecks(p).some((c) => c.section === 'R311.7.8.2'));
  assert.equal(handrailNotes(room({ shape: undefined, w: 36, d: 30, risers: 3, rise: 21 })).length, 0);
  assert.equal(handrailNotes(room({ ...L, handrails: 'none' })).length, 0);
  assert.ok(!/\d+"/.test(n[0].message.replace(/^Stairs \(\d+ risers \w+\)/, '')));
});

test('mirroring a room turns an L stair the other way', () => {
  const p = room(L);
  const m = mirrorRoom(p, 'L', 'x');
  assert.equal(m.furniture[0].turn, 'left');
  assert.equal(mirrorRoom(m, 'L', 'x').furniture[0].turn, undefined);
});

const hatch = (patch: Partial<Furniture> = {}): Furniture => ({ id: 'ha', kind: 'attic-access', at: { x: 300, y: 60 }, rot: 0, w: 22.5, d: 30, ...patch });

test('M1305.1.3: an attic access placed on the plan, its opening and passageway checked', () => {
  const base = room(L, { roof: DEFAULT_ROOF, electrical: { attic: 'equipment' }, fixtures: [{ id: 'l', kind: 'light', at: { x: 60, y: 60 }, auto: false }] });
  const p = { ...base, furniture: [...base.furniture, hatch()] };
  const c = accessChecks(p);
  assert.deepEqual(c.map((x) => [x.rule, x.status]), [
    ['Attic access opening (20" × 30")', 'pass'],
    ['Attic passageway (30" high, 22" wide, 20 ft max)', 'info'],
    ['Service space at the appliance', 'info'],
  ]);
  const small = accessChecks({ ...p, furniture: [hatch({ w: 18 })] });
  assert.equal(small[0].status, 'fail');
  assert.equal(accessChecks({ ...p, furniture: [hatch({ passage: 200 })] })[1].status, 'pass');
  assert.equal(accessChecks({ ...p, furniture: [hatch({ passage: 300 })] })[1].status, 'fail');
  // Placed, it replaces the "not placed" note.
  assert.ok(lightingChecks(base).some((x) => x.rule === 'Attic equipment access'));
  assert.ok(!lightingChecks(p).some((x) => x.rule === 'Attic equipment access'));
  // No equipment: the sizes are only a note.
  assert.deepEqual(accessChecks({ ...p, electrical: { attic: 'storage' } }).map((x) => x.status), ['info']);
  // On a floor with another above it: flagged.
  const two = switchStorey(addStorey(p, 1, 'up'), 'ground');
  assert.ok(accessChecks(two).some((x) => x.rule === 'Attic access on the top floor'));
  // Priced in the estimate.
  const line = furnitureLines(p).find((l) => l.item === 'Attic access hatch (allowance)')!;
  assert.equal(line.qty, 1);
  assert.ok(estimate([line]).lines[0].unitPrice > 0);
});

test('M1305.1.4: equipment under the floor gets a note, without figures', () => {
  const p = room(L, { foundation: { ...DEFAULT_FOUNDATION, type: 'crawl' }, electrical: { crawl: 'equipment' } });
  const c = accessChecks(p).find((x) => x.section === 'M1305.1.4')!;
  assert.equal(c.status, 'info');
  assert.ok(!/\d/.test(c.message.replace('M1305.1.4', '')));
  assert.equal(accessChecks({ ...p, electrical: { crawl: 'storage' } }).length, 0);
  assert.equal(flightsOf(p.furniture[0]).length, 2);
});
