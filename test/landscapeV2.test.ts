import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bedFillPoints, easementChecks, easementPolygon, fillBed, GRADE_FALL, gradeChecks, gradeRuns, landscapeLines, wallTakeoff } from '../src/calc/landscape.ts';
import { estimate } from '../src/calc/pricing.ts';
import { materialsList } from '../src/calc/materials.ts';
import { pickSiteScale } from '../src/calc/sheet.ts';
import { siteChecks, siteLines } from '../src/calc/site.ts';
import { buildSiteScene, GRADE_Y } from '../src/calc/site3d.ts';
import { azimuthOf, formatBearing, legsFromLot, parseBearing, runTraverse } from '../src/calc/survey.ts';
import { isNative, PLANT_BY_ID, PLANTS, REGION_LABEL } from '../src/data/plants.ts';
import { dist, pointInPolygon, polygonArea } from '../src/model/geometry.ts';
import { migrate } from '../src/model/store.ts';
import type { Point, Site } from '../src/model/types.ts';
import { box, project } from './helpers.ts';

const ft = (n: number) => n * 12;
const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** 40×30 house 30 ft in from the lot's top-left corner, on a 100×120 lot. */
function siteProject(site: Partial<Site>) {
  const walls = box(ft(40), ft(30)).map((w) => ({ ...w, a: { x: w.a.x + ft(30), y: w.a.y + ft(30) }, b: { x: w.b.x + ft(30), y: w.b.y + ft(30) } }));
  return project(walls, [], { site: { setbacks: [], areas: [], plants: [], lot: rect(0, 0, ft(100), ft(120)), ...site } });
}

test('parse quadrant bearings in the usual spellings', () => {
  assert.equal(parseBearing(`N 45°30' E`), 45.5);
  assert.equal(parseBearing('N45-30-00E'), 45.5);
  assert.equal(parseBearing('n 45 30 e'), 45.5);
  assert.equal(parseBearing(`S 12°15'36" W`), 192.26);
  assert.equal(parseBearing('S 10 E'), 170);
  assert.equal(parseBearing('N 10 W'), 350);
  assert.equal(parseBearing('N 0 E'), 0);
  assert.equal(parseBearing('N 91 E'), null);
  assert.equal(parseBearing(`N 45°61' E`), null);
  assert.equal(parseBearing('45 E'), null);
  // Round trip through the formatter.
  for (const az of [0, 33.25, 90, 135.5, 200.123, 359]) assert.ok(Math.abs(parseBearing(formatBearing(az))! - az) < 1 / 3600);
  assert.equal(formatBearing(45.5), `N 45°30'00" E`);
  assert.equal(formatBearing(192.26), `S 12°15'36" W`);
});

test('traverse: closed square, misclosure and precision', () => {
  // North is up (−y), east is +x.
  const legs = [
    { bearing: 'N 90 E', distance: ft(100) },
    { bearing: 'S 0 E', distance: ft(150) },
    { bearing: 'S 90 W', distance: ft(100) },
    { bearing: 'N 0 W', distance: ft(150) },
  ];
  const t = runTraverse(legs, { x: 0, y: 0 });
  assert.equal(t.points.length, 4);
  assert.deepEqual(
    t.points.map((p) => [Math.round(p.x / 12) + 0, Math.round(p.y / 12) + 0]),
    [[0, 0], [100, 0], [100, 150], [0, 150]],
  );
  assert.ok(t.error < 1e-6);
  assert.equal(t.precision, Infinity);
  assert.equal(Math.round(polygonArea(t.points) / 144), 15000);

  // A 0.5 ft blunder on the last call: misclosure shows it, 500 ft / 0.5 ft = 1 : 1000.
  const off = runTraverse([...legs.slice(0, 3), { bearing: 'N 0 W', distance: ft(150.5) }]);
  assert.ok(Math.abs(off.error - 6) < 1e-6);
  assert.ok(Math.abs(off.misclosure.y + 6) < 1e-6, 'overshoots to the north');
  assert.equal(Math.round(off.precision), Math.round(ft(500.5) / 6));

  // A bad bearing is reported, not silently dropped.
  assert.equal(runTraverse([legs[0], { bearing: 'NE 45', distance: 120 }, legs[2]]).badLeg, 1);
});

test('traverse: skewed lot round-trips through legsFromLot', () => {
  const lot = [
    { x: 0, y: 0 },
    { x: 1200, y: -300 },
    { x: 1400, y: 1300 },
    { x: -100, y: 1500 },
  ];
  const legs = legsFromLot(lot);
  assert.equal(azimuthOf(lot[0], lot[1]) < 90, true, 'first leg heads north-east');
  assert.match(legs[0].bearing, /^N \d+°\d\d'\d\d" E$/);
  const back = runTraverse(legs, lot[0]);
  back.points.forEach((p, i) => assert.ok(dist(p, lot[i]) < 0.1, `corner ${i}`));
  assert.ok(back.error < 0.1);
});

test('easements: edge strip sits inside the lot; things in it are flagged', () => {
  const lot = rect(0, 0, ft(100), ft(120));
  const strip = easementPolygon({ id: 'e1', edge: 2, width: ft(10) }, lot);
  assert.equal(strip.length, 4);
  assert.equal(Math.round(polygonArea(strip) / 144), 1000);
  assert.ok(pointInPolygon({ x: ft(50), y: ft(115) }, strip), 'along the rear (bottom) line');
  assert.ok(!pointInPolygon({ x: ft(50), y: ft(105) }, strip));
  // Winding doesn't matter.
  const ccw = [...lot].reverse();
  assert.ok(pointInPolygon({ x: ft(50), y: ft(115) }, easementPolygon({ id: 'e', edge: 0, width: ft(10) }, ccw)));

  const clear = siteProject({ easements: [{ id: 'e1', edge: 2, width: ft(10), label: 'Utility' }] });
  assert.equal(easementChecks(clear)[0].status, 'pass');

  const busy = siteProject({
    easements: [{ id: 'e1', edge: 2, width: ft(10) }, { id: 'e2', points: rect(ft(25), ft(20), ft(35), ft(40)) }],
    areas: [{ id: 'a1', material: 'concrete', points: rect(ft(40), ft(105), ft(60), ft(125)), depth: 4 }],
    plants: [
      { id: 'p1', species: 'red-maple', at: { x: ft(80), y: ft(116) } },
      { id: 'p2', species: 'boxwood', at: { x: ft(20), y: ft(116) } },
    ],
    retainingWalls: [{ id: 'w1', points: [{ x: ft(5), y: ft(100) }, { x: ft(5), y: ft(119) }], height: 24 }],
  });
  const [rear, drawn] = easementChecks(busy);
  assert.equal(rear.status, 'warn');
  assert.match(rear.message, /1 hardscape area/);
  assert.match(rear.message, /1 tree\b/);
  assert.match(rear.message, /1 retaining wall/);
  assert.doesNotMatch(rear.message, /house/);
  assert.equal(drawn.status, 'warn');
  assert.match(drawn.message, /the house/);
  // Lands on the Code check tab via siteChecks.
  assert.ok(siteChecks(busy).some((c) => c.section === 'Recorded plat' && c.status === 'warn'));
});

test('retaining wall, topsoil and edging takeoff + prices', () => {
  // 30 ft wall, 2 ft exposed: 3 courses + 1 buried = 4; 360"/18" = 20 per course.
  const w = { id: 'w1', points: [{ x: 0, y: 0 }, { x: ft(20), y: 0 }, { x: ft(20), y: ft(10) }], height: 24 };
  assert.deepEqual(wallTakeoff(w), { length: ft(30), courses: 4, blocks: 80, caps: 20 });
  const p = siteProject({
    retainingWalls: [w],
    areas: [
      { id: 'a1', material: 'sod', points: rect(0, 0, ft(30), ft(30)), depth: 0, topsoil: 4, edging: true },
      { id: 'a2', material: 'pavers', points: rect(0, 0, ft(10), ft(10)), depth: 0, edging: true },
    ],
  });
  const lines = landscapeLines(p);
  const get = (item: string) => lines.find((l) => l.item === item)?.qty;
  assert.equal(get('Retaining wall block'), 84); // 80 × 1.05
  assert.equal(get('Retaining wall cap'), 21);
  assert.equal(get('Perforated drain pipe, 4"'), 32);
  // 900 sq ft × 4" = 11.11 yd³ × 1.15 = 12.78 → 13 (half yards)
  assert.equal(get('Topsoil'), 13);
  // Sod perimeter 120 ft (pavers have their own restraint) × 1.05 = 126
  assert.equal(get('Landscape edging'), 126);
  assert.ok(get('Wall drainage stone')! > 0 && get('Retaining wall base gravel')! > 0);
  // Rolled into the site / estimate lines, all with a sample price.
  assert.ok(siteLines(p, 0.1).some((l) => l.item === 'Topsoil'));
  const est = estimate(materialsList(p));
  for (const item of ['Retaining wall block', 'Retaining wall cap', 'Topsoil', 'Landscape edging', 'Wall drainage stone', 'Perforated drain pipe, 4"']) {
    const l = est.lines.find((x) => x.item === item);
    assert.ok(l && l.unitPrice > 0, item);
  }
  // Tall walls get an info note, not a code citation.
  const tall = siteChecks(siteProject({ retainingWalls: [{ ...w, height: 60 }] })).find((c) => c.rule === 'Tall retaining wall');
  assert.equal(tall?.status, 'info');
});

test('bed fill: triangular grid at mature spacing, kept off the edge', () => {
  const bed = rect(0, 0, ft(20), ft(10));
  const s = ft(3);
  const pts = bedFillPoints(bed, s);
  assert.ok(pts.length >= 14 && pts.length <= 24, `${pts.length} plants`);
  for (const p of pts) {
    assert.ok(p.x >= s / 2 - 1e-6 && p.x <= ft(20) - s / 2 + 1e-6 && p.y >= s / 2 - 1e-6 && p.y <= ft(10) - s / 2 + 1e-6, 'half a spacing in');
  }
  // Nearest neighbours are exactly one spacing apart (no crowding, no gaps).
  for (const p of pts) {
    const near = Math.min(...pts.filter((q) => q !== p).map((q) => dist(p, q)));
    assert.ok(Math.abs(near - s) < 1e-6, `nearest ${near}`);
  }
  // Rows are √3/2 × spacing apart and alternate rows shift half a spacing.
  const ys = [...new Set(pts.map((p) => Math.round(p.y * 1000) / 1000))].sort((a, b) => a - b);
  assert.ok(Math.abs(ys[1] - ys[0] - (s * Math.sqrt(3)) / 2) < 1e-3);
  // Narrow bed: one plant in the middle.
  assert.equal(bedFillPoints(rect(0, 0, ft(2), ft(2)), s).length, 1);
  // Plants come tagged with the bed; filled plants don't trip the crowding check.
  let n = 0;
  const plants = fillBed({ id: 'a1', material: 'mulch', points: bed, depth: 3 }, 'boxwood', () => `f${n++}`);
  assert.equal(plants.length, bedFillPoints(bed, ft(4)).length);
  assert.ok(plants.every((p) => p.bed === 'a1' && p.species === 'boxwood'));
  const p = siteProject({ lot: undefined, areas: [{ id: 'a1', material: 'mulch', points: rect(ft(120), 0, ft(140), ft(10)), depth: 3 }], plants: fillBed({ id: 'a1', material: 'mulch', points: rect(ft(120), 0, ft(140), ft(10)), depth: 3 }, 'boxwood', () => `g${n++}`) });
  assert.ok(!siteChecks(p).some((c) => c.rule === 'Plants overlap at maturity'));
});

test('grading: R401.3 fall of 6" in the first 10 ft', () => {
  // House exterior runs x 30–70 ft (outer face a few inches beyond); spots on the east side.
  const near = { id: 'g1', at: { x: ft(71), y: ft(45) }, elev: 1200 };
  const far = (elev: number) => ({ id: 'g2', at: { x: ft(81), y: ft(45) }, elev });
  const runs = gradeRuns(siteProject({ grades: [near, far(1200 - 5)] }));
  assert.equal(runs.length, 1);
  assert.ok(runs[0].dNear > 0 && runs[0].dNear <= 36);
  assert.equal(Math.round(runs[0].dFar - runs[0].dNear), 120);
  assert.ok(Math.abs(runs[0].fall - 5) < 1e-6);
  assert.equal(gradeChecks(siteProject({ grades: [near, far(1200 - 5)] }))[0].status, 'fail');
  assert.equal(gradeChecks(siteProject({ grades: [near, far(1200 - GRADE_FALL)] }))[0].status, 'pass');
  // Spot only 5 ft out with 3" of fall = 6" per 10 ft at an even slope.
  const half = gradeRuns(siteProject({ grades: [near, { id: 'g3', at: { x: ft(76), y: ft(45) }, elev: 1197 }] }));
  assert.equal(half.length, 1);
  assert.ok(half[0].ok);
  // A far spot on another side of the house isn't paired.
  const lonely = gradeChecks(siteProject({ grades: [near, { id: 'g4', at: { x: ft(50), y: ft(70) }, elev: 1190 }] }));
  assert.equal(lonely.length, 1);
  assert.equal(lonely[0].status, 'info');
  // No spot grades → no check at all (old projects stay quiet).
  assert.deepEqual(gradeChecks(siteProject({})), []);
});

test('plant library: ~300 well-formed species with a native flag', () => {
  assert.ok(PLANTS.length >= 280, `${PLANTS.length} species`);
  assert.equal(PLANT_BY_ID.size, PLANTS.length, 'unique ids');
  assert.equal(new Set(PLANTS.map((p) => p.botanical)).size, PLANTS.length, 'no duplicate botanical names');
  const regions = new Set(Object.keys(REGION_LABEL));
  for (const p of PLANTS) {
    assert.ok(p.height > 0 && p.spread > 0, p.id);
    assert.ok(p.zones[0] >= 1 && p.zones[1] <= 13 && p.zones[0] <= p.zones[1], p.id);
    assert.ok(p.sun.length > 0, p.id);
    assert.ok(p.native.every((r) => regions.has(r)), p.id);
  }
  // The original ids are all still there (saved projects reference them).
  for (const id of ['red-maple', 'live-oak', 'crape-myrtle', 'boxwood', 'knockout-rose', 'muhly', 'blue-rug', 'liriope', 'fountain-grass']) assert.ok(PLANT_BY_ID.has(id), id);
  assert.ok(isNative(PLANT_BY_ID.get('red-maple')!, 'northeast'));
  assert.ok(!isNative(PLANT_BY_ID.get('red-maple')!, 'southwest'));
  assert.ok(!isNative(PLANT_BY_ID.get('crape-myrtle')!, 'southeast'), 'introduced species are never native');
  assert.ok(!isNative(PLANT_BY_ID.get('red-maple')!, undefined));
  assert.ok(PLANTS.filter((p) => p.native.length).length > 150);
});

test('site in 3D: lot, hardscape, plants and walls as simple shapes', () => {
  const p = siteProject({
    areas: [{ id: 'a1', material: 'pavers', points: rect(0, 0, ft(10), ft(10)), depth: 0 }],
    plants: [
      { id: 'p1', species: 'red-maple', at: { x: ft(80), y: ft(100) } },
      { id: 'p2', species: 'boxwood', at: { x: ft(10), y: ft(100) } },
    ],
    retainingWalls: [{ id: 'w1', points: [{ x: 0, y: ft(110) }, { x: ft(30), y: ft(110) }], height: 30 }],
  });
  const s = buildSiteScene(p);
  assert.deepEqual(s.flats.map((f) => f.kind), ['lot', 'pavers']);
  assert.ok(s.flats[1].y > s.flats[0].y);
  const tree = s.plants.find((x) => x.form === 'tree')!;
  assert.ok(tree.trunk > 0);
  // Canopy top at the species' mature height.
  assert.ok(Math.abs(tree.c[1] + tree.ry - (GRADE_Y + ft(50))) < 1e-6);
  assert.equal(tree.r, ft(35) / 2);
  assert.equal(s.plants.find((x) => x.form === 'shrub')!.trunk, 0);
  assert.equal(s.walls.length, 1);
  assert.equal(s.walls[0].size[0], ft(30));
  assert.ok(s.bounds && s.bounds.max[0] === ft(100));
  assert.equal(buildSiteScene(project([])).bounds, null);
});

test('site print scale and old projects unchanged', () => {
  assert.equal(pickSiteScale(ft(100), ft(60)).denom, ft(20)); // 5" × 3" at 1" = 20'
  assert.equal(pickSiteScale(ft(100), ft(150)).denom, ft(30)); // 150 ft tall: 1" = 30' → 5" + margins
  assert.equal(pickSiteScale(ft(5000), ft(5000)).denom, ft(200));
  // A v1 site (no v2 fields) yields exactly the v1 lines and no new checks.
  const v1 = siteProject({ setbacks: [ft(25), ft(10), ft(20), ft(10)], areas: [{ id: 'a1', material: 'mulch', points: rect(0, 0, ft(10), ft(10)), depth: 3 }] });
  assert.deepEqual(landscapeLines(v1), []);
  assert.ok(!siteChecks(v1).some((c) => ['Recorded plat', 'IRC R401.3', 'Local permit'].includes(c.section)));
  const m = migrate(v1);
  assert.deepEqual(m.site, v1.site);
});
