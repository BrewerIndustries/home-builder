import assert from 'node:assert/strict';
import { test } from 'node:test';
import { floorCutPieces } from '../src/calc/cutlist.ts';
import { cantileverOutline, depthLabel, floorLayout, floorLines, floorSpec, storeyFloorLayout, upperFloorLayout } from '../src/calc/floor.ts';
import { houseMaterials, roleView } from '../src/calc/house.ts';
import { materialsList } from '../src/calc/materials.ts';
import { samplePrice } from '../src/calc/pricing.ts';
import { addStorey, floorDepth, switchStorey, updateStorey } from '../src/model/storeys.ts';
import { DEFAULT_FOUNDATION, DEFAULT_ROOF, type FloorFrame, type Foundation, type Furniture, type Point, type Project } from '../src/model/types.ts';
import { box, project, wall } from './helpers.ts';

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const crawl = (floor?: FloorFrame, f: Partial<Foundation> = {}) => project(box(480, 360), [], { foundation: { ...DEFAULT_FOUNDATION, type: 'crawl', ...f, ...(floor && { floor }) } });
const items = (ls: { item: string }[]) => ls.map((l) => l.item);
/** A 13-riser flight up along the top wall (see storeys.test.ts). */
const stair: Furniture = { id: 'st', kind: 'stairs', at: { x: 63.25, y: 21.25 }, rot: 270, w: 36, d: 120, risers: 13 };

/** 40' × 25' ground floor (crawlspace) with a wall across the middle and the stair; a second floor over it. */
function twoStorey(floor?: FloorFrame, walls = [...box(480, 300), wall(0, 150, 480, 150, 'interior')]): Project {
  let p = project(walls, [], { rooms: [{ id: 'L', name: 'Living', type: 'living', points: rect(0, 0, 480, 300) }], roof: DEFAULT_ROOF, furniture: [stair], foundation: { ...DEFAULT_FOUNDATION, type: 'crawl' } });
  p = addStorey(p, 1, 'up');
  p = { ...p, rooms: [{ id: 'B', name: 'Bed', type: 'bedroom', points: rect(0, 0, 480, 300) }] };
  return floor ? updateStorey(p, 'up', { floor }) : p;
}

test('old floors are unchanged: no v2 fields, no v2 members', () => {
  const L = floorLayout(crawl())!;
  assert.deepEqual([L.trimmers, L.headers, L.openings, L.hangers, L.bearing, L.cantilevers, L.notes], [[], [], [], [], [], [], []]);
  assert.equal(L.outline, L.supported);
  const lines = floorLines(crawl(), 0.1);
  assert.ok(!items(lines).some((i) => /hanger|I-joist|Rim board|insulation/i.test(i)));
  // A one-storey plan with a stair going down keeps the v1 layout (no opening cut).
  const down = project(box(480, 360), [], { furniture: [{ ...stair, down: true }], foundation: { ...DEFAULT_FOUNDATION, type: 'basement' } });
  assert.equal(floorLayout(down)!.openings.length, 0);
  assert.equal(floorSpec(crawl()).insulation, 'none');
});

test('cantilever: joists run out past the support on the edges they cross', () => {
  // Joists run top–bottom (the 30' way), so the top / bottom edges can cantilever; the right edge can't.
  const L = floorLayout(crawl({ cantilever: { n: 24, e: 12 } }))!;
  assert.equal(L.alongX, false);
  assert.deepEqual(L.cantilevers, [{ edge: 'n', depth: 24, backSpan: 120 }]);
  assert.equal(L.maxSpan, 120); // the back-span, not the overhang
  assert.equal(Math.min(...L.outline[0].map((p) => p.y)), -24);
  assert.equal(L.rimLength, 2 * (480 + 384));
  assert.match(L.notes.join(' '), /No cantilever on the right edge/);
  // The first piece of each joist line is the overhang plus its back-span.
  assert.equal(Math.max(...L.joists.map((j) => Math.abs(j.b.y - j.a.y))), 144);
  // A long overhang on a short back-span gets the rule-of-thumb note, labelled as such.
  const long = floorLayout(crawl({ cantilever: { s: 72 } }))!;
  assert.match(long.notes.join(' '), /rule of thumb \(not a code figure\)/);
});

test('cantileverOutline leaves edges between rooms alone', () => {
  const out = cantileverOutline([rect(0, 0, 100, 100), rect(100, 0, 200, 100)], { e: 10, n: 5 });
  assert.deepEqual(out[0], [{ x: 0, y: -5 }, { x: 100, y: -5 }, { x: 100, y: 100 }, { x: 0, y: 100 }]);
  assert.deepEqual(out[1], [{ x: 100, y: -5 }, { x: 210, y: -5 }, { x: 210, y: 100 }, { x: 100, y: 100 }]);
});

test('flush girders: joists hung in hangers, no blocking row', () => {
  const L = floorLayout(crawl({ flushGirders: true }))!;
  // 29 joist lines, each broken over 2 girders, a hanger each side.
  assert.equal(L.hangers.length, 29 * 2 * 2);
  const lines = floorLines(crawl({ flushGirders: true }), 0.1);
  const h = lines.find((l) => l.item === 'Joist hanger, 2x10')!;
  assert.equal(h.qty, 116);
  assert.ok(samplePrice(h.item) > 0);
  assert.ok(!items(lines).some((i) => /blocking over girders/.test(i)));
  assert.match(lines.find((l) => /floor joist/.test(l.item))!.basis, /hung between the girders/);
});

test('I-joists: priced by the foot with rim board, no span values', () => {
  const p = crawl({ joistType: 'ijoist', iJoistSeries: 'TJI 210', iJoistDepth: 11.875 });
  const lines = floorLines(p, 0.1);
  assert.ok(!items(lines).some((i) => /floor joist|rim joist/.test(i)));
  const ij = lines.find((l) => l.item === 'I-joist, TJI 210 11-7/8"')!;
  assert.equal(ij.unit, 'lf');
  assert.match(ij.basis, /maker's tables/);
  const rim = lines.find((l) => l.item === 'Rim board, 11-7/8"')!;
  assert.equal(rim.qty, Math.ceil((1680 * 1.1) / 12));
  for (const l of lines.filter((x) => x.category === 'Floor' && !/^Concrete/.test(x.item))) assert.ok(samplePrice(l.item) > 0, l.item);
  assert.equal(floorDepth(p), 11.875 + 0.75);
  assert.equal(floorDepth(crawl()), 9.25 + 0.75);
  assert.deepEqual(floorCutPieces(p), []);
  assert.equal(depthLabel(9.5), '9-1/2"');
  assert.equal(depthLabel(14), '14"');
});

test('floor insulation: batts by joist-bay area, off unless chosen', () => {
  const lines = floorLines(crawl({ insulation: 'R-30' }), 0.1);
  const batts = lines.find((l) => l.item === 'R-30 floor insulation batts')!;
  assert.equal(batts.category, 'Insulation & wrap');
  assert.equal(batts.qty, Math.ceil(1200 * 1.1));
  assert.ok(samplePrice(batts.item) > 0);
  assert.ok(lines.some((l) => l.item === 'Insulation supports (wire)'));
  assert.ok(samplePrice('R-19 floor insulation batts') > 0 && samplePrice('R-38 floor insulation batts') > 0);
});

test('upper storey: a real framed floor, joists bearing on the walls below', () => {
  const p = twoStorey();
  const L = storeyFloorLayout(p)!;
  assert.deepEqual(L, upperFloorLayout(p));
  assert.equal(floorLayout(p), null); // the foundation's floor is the lowest storey's only
  // 40' × 25': joists run top–bottom and lap over the wall across the middle below.
  assert.equal(L.alongX, false);
  assert.equal(L.bearing.length, 1);
  assert.equal(L.maxSpan, 150);
  assert.equal(L.girders.length, 0);
  assert.equal(L.piers.length, 0);
  assert.equal(L.unsupportedEnds, 0);
  // The stair opening: doubled trimmers either side, a header on the open side (the top edge sits on the wall).
  assert.equal(L.openings.length, 1);
  assert.equal(L.trimmers.length, 4); // two trimmer lines, each lapped over the middle wall
  assert.equal(L.headers.length, 1);
  assert.ok(L.hangers.filter((h) => !h.double).length > 0);
  assert.equal(L.hangers.filter((h) => h.double).length, 2);
  // The whole-house estimate uses it (no more plain allowance).
  const lines = houseMaterials(p);
  assert.ok(lines.some((l) => l.item === 'Joist hanger, 2x10'));
  assert.ok(lines.some((l) => /floor joist/.test(l.item) && /lapped over the walls below/.test(l.basis) && /trimmer \/ header plies/.test(l.basis)));
  // The lowest storey's own crawlspace floor is still there, with its girders.
  assert.ok(lines.some((l) => /girder ply/.test(l.item)));
  // The per-storey Framing view and cut list see it too.
  assert.ok(storeyFloorLayout(roleView(p, 'up')));
  assert.ok(floorCutPieces(roleView(p, 'up')).some((x) => /opening header/.test(x.label)));
  // The ground floor's materials alone don't carry the upper floor.
  assert.deepEqual(materialsList(roleView(p, 'ground')), materialsList(roleView(switchStorey(p, 'ground'), 'ground')));
});

test('upper storey: direction, cantilever and insulation picked per storey, kept across switches', () => {
  const p = twoStorey({ joistDir: 'x', insulation: 'R-19' });
  const L = storeyFloorLayout(p)!;
  assert.equal(L.alongX, true);
  // Left–right joists run along the middle wall, so nothing carries them mid-span.
  assert.equal(L.bearing.length, 0);
  assert.equal(L.maxSpan, 480);
  // Switching away and back keeps the storey's floor settings.
  const back = switchStorey(switchStorey(p, 'ground'), 'up');
  assert.deepEqual(back.storeys!.find((s) => s.id === 'up')!.floor, { joistDir: 'x', insulation: 'R-19' });
  assert.ok(houseMaterials(back).some((l) => l.item === 'R-19 floor insulation batts'));
  // No insulation upstairs unless chosen.
  assert.ok(!houseMaterials(twoStorey()).some((l) => /floor insulation/.test(l.item)));
  // A cantilever upstairs: the overhang has no wall under its end, but its support does.
  const c = storeyFloorLayout(twoStorey({ cantilever: { s: 24 } }))!;
  assert.deepEqual(c.cantilevers, [{ edge: 's', depth: 24, backSpan: 150 }]);
  assert.equal(c.unsupportedEnds, 0);
});

test('upper storey wider than the one below: unsupported joist ends are flagged', () => {
  let p = twoStorey();
  p = { ...p, rooms: [{ id: 'B', name: 'Bed', type: 'bedroom', points: rect(0, -36, 480, 300) }] };
  const L = storeyFloorLayout(p)!;
  assert.ok(L.unsupportedEnds > 0);
  assert.match(L.notes.join(' '), /no wall below carries/);
});
