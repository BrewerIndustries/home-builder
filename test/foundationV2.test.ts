import assert from 'node:assert/strict';
import { test } from 'node:test';
import { floorLines } from '../src/calc/floor.ts';
import { foundationCalc, foundationChecks, foundationLines, foundationVolumes } from '../src/calc/foundation.ts';
import { foundationScene } from '../src/calc/foundation3d.ts';
import { basementGeometry, foundationV2Lines, padRebarLength } from '../src/calc/foundationV2.ts';
import { buildScene } from '../src/calc/model3d.ts';
import { floorAboveGrade } from '../src/calc/outdoor.ts';
import { DEFAULT_FOUNDATION, type Foundation, type FoundationV2 } from '../src/model/types.ts';
import { box, project, wall } from './helpers.ts';

const house = (f: Partial<Foundation> = {}, v2?: FoundationV2) => {
  const walls = box(480, 360);
  const inner = wall(240, 0, 240, 360, 'interior');
  return project([...walls, inner], [], { foundation: { ...DEFAULT_FOUNDATION, ...f, ...(v2 ? { v2 } : {}) } });
};
const innerId = (p: ReturnType<typeof house>) => p.walls.find((w) => w.kind === 'interior')!.id;
const items = (lines: { item: string }[]) => lines.map((l) => l.item);

test('plans without v2 fields give the same takeoff and checks', () => {
  for (const type of ['slab', 'crawl'] as const) {
    const old = house({ type, footingDepth: 24 });
    const empty = house({ type, footingDepth: 24 }, {});
    assert.deepEqual(foundationLines(old, 0.1), foundationLines(empty, 0.1));
    assert.deepEqual(foundationChecks(old), foundationChecks(empty));
    assert.deepEqual(foundationV2Lines(old, old.foundation!, 1000, 1000, 0.1), []);
  }
  // The crawlspace pier pad line keeps its old name and size.
  const pads = floorLines(house({ type: 'crawl' }), 0.1).filter((l) => l.item.startsWith('Concrete, pier'));
  assert.equal(pads.length, 1);
  assert.equal(pads[0].item, 'Concrete, pier footings 24×24×10');
  assert.ok(!items(floorLines(house({ type: 'crawl' }), 0.1)).some((i) => i.includes('pier pads')));
  // Crawlspace lines unchanged: stem wall, ground cover and vents still there.
  const crawl = items(foundationLines(house({ type: 'crawl', footingDepth: 24 }), 0.1));
  assert.ok(crawl.includes('Concrete, stem wall') && crawl.includes('6-mil poly ground cover, 10×100'));
});

test('interior bearing footings: concrete, rebar and the check', () => {
  const base = house({ type: 'crawl', footingDepth: 24 });
  const p = house({ type: 'crawl', footingDepth: 24 }, { bearingWalls: [innerId(base)] });
  p.walls = base.walls;
  const lines = foundationLines(p, 0.1);
  const conc = lines.find((l) => l.item === 'Concrete, interior bearing footings')!;
  // 30' × 16" × 8" = 26.67 ft³ ≈ 0.99 yd³ +5% → 1.25
  assert.equal(conc.qty, 1.25);
  assert.equal(lines.find((l) => l.item.startsWith('#4 rebar, 20\' (interior'))!.qty, 4); // 60 LF +10% / 20
  const v = foundationVolumes(foundationCalc(p)!, p);
  assert.equal(v.interior, 360 * 16 * 8);
  const check = foundationChecks(p).find((c) => c.rule === 'Interior bearing footing')!;
  assert.equal(check.status, 'info');
  const small = { ...p, foundation: { ...p.foundation!, v2: { ...p.foundation!.v2, interiorFootingWidth: 10 } } };
  assert.equal(foundationChecks(small).find((c) => c.rule === 'Interior bearing footing')!.status, 'fail');
  // Exterior or unknown wall ids are ignored.
  const ext = { ...p, foundation: { ...p.foundation!, v2: { bearingWalls: [p.walls[0].id, 'nope'] } } };
  assert.ok(!items(foundationLines(ext, 0.1)).includes('Concrete, interior bearing footings'));
});

test('slab: interior footing is a thickening below the slab', () => {
  const base = house();
  const p = house({}, { bearingWalls: [innerId(base)], interiorFootingWidth: 12, interiorFootingThickness: 8 });
  p.walls = base.walls;
  const l = foundationLines(p, 0.1).find((x) => x.item === 'Concrete, interior bearing footings')!;
  assert.match(l.basis, /below the slab/);
  const s = foundationScene(p).boxes.filter((b) => b.kind === 'footing' && b.size[1] === 8);
  assert.equal(s.length, 1);
  assert.equal(s[0].c[1], -(4 + 4)); // 8" thick under a 4" slab: centre at −8
});

test('pier pads: user size and a rebar allowance', () => {
  const p = house({ type: 'crawl' }, { pierPad: 30, pierPadThickness: 12, pierBars: 3 });
  const lines = floorLines(p, 0.1);
  const pad = lines.find((l) => l.item.startsWith('Concrete, pier footings'))!;
  assert.equal(pad.item, 'Concrete, pier footings 30×30×12');
  assert.equal(padRebarLength(p.foundation!), 3 * 2 * 24);
  assert.ok(lines.find((l) => l.item === '#4 rebar, 20\' (pier pads)')!.qty > 0);
  assert.equal(foundationChecks(p).find((c) => c.rule === 'Pier pad size')!.status, 'info');
  const tiny = house({ type: 'crawl' }, { pierPad: 10 });
  assert.equal(foundationChecks(tiny).find((c) => c.rule === 'Pier pad size')!.status, 'fail');
});

test('basement: walls, slab, drainage, coating, foam and wells', () => {
  const p = house({ type: 'basement', footingDepth: 92 }, { basementHeight: 96, footingDrain: true, wallCoating: 'dampproof', wallFoam: 2, wells: { count: 2, width: 36, projection: 36, depth: 48 } });
  const c = foundationCalc(p)!;
  const g = basementGeometry(p.foundation!, c.perimeter, c.area);
  assert.equal(g.H, 96);
  assert.equal(g.belowGrade, 84); // 92 − 8" footing
  const v = foundationVolumes(c, p);
  assert.equal(v.stem, (c.perimeter - 32) * 8 * 96);
  assert.equal(v.slab, g.slabArea * 4);
  const it = items(foundationLines(p, 0.1));
  for (const want of ['Concrete, footings', 'Concrete, basement wall', 'Concrete, basement slab', '4" perforated drain pipe, 10\'', 'Foundation dampproofing', '2" rigid foam board, 4×8', 'Window well, 36" × 36" × 48" deep']) {
    assert.ok(it.includes(want), want);
  }
  // No crawlspace vents or ground cover under a basement.
  assert.ok(!it.some((i) => i.startsWith('Foundation vent') || i.startsWith('6-mil poly ground')));
  // Framed floor over the basement on girders and piers.
  assert.ok(items(floorLines(p, 0.1)).some((i) => i.includes('floor joist')));
  const rules = Object.fromEntries(foundationChecks(p).map((x) => [x.rule, x.status]));
  assert.equal(rules['Window well size'], 'pass');
  assert.equal(rules['Window well ladder'], 'info');
  assert.equal(rules['Slab thickness'], 'pass');
  const narrow = house({ type: 'basement' }, { wells: { count: 1, width: 30, projection: 24, depth: 36 } });
  assert.equal(foundationChecks(narrow).find((x) => x.rule === 'Window well size')!.status, 'warn');
  // Floor above grade: footing + wall − depth + sill + joist + subfloor.
  assert.equal(floorAboveGrade(p).height, 8 + 96 - 92 + 1.5 + 9.25 + 0.75);
});

test('R403.1 inputs only add a reminder; no table values', () => {
  assert.ok(!foundationChecks(house()).some((c) => c.section === 'R403.1'));
  const c = foundationChecks(house({ type: 'crawl', footingWidth: 16 }, { soilBearing: 2000, storeys: 2 })).find((x) => x.section === 'R403.1')!;
  assert.equal(c.status, 'info');
  assert.match(c.message, /16" footing, 2 storeys, 2,000 psf soil/);
});

test('3D: foundation below the floor, framing unchanged', () => {
  const slab = buildScene(house());
  const edges = slab.boxes.filter((b) => b.kind === 'footing');
  assert.equal(edges.length, 4);
  assert.ok(edges.every((b) => b.c[1] === -9 && b.size[1] === 18));
  // Outside face flush with the house wall's outside face: the top wall (y = 0) edge sits outward (−y).
  const top = edges.find((b) => Math.abs(b.c[2]) < 10)!;
  assert.equal(top.c[2], -(6.5 / 2 - 6));
  assert.equal(slab.bounds.min[1], 0);

  const crawl = foundationScene(house({ type: 'crawl' }));
  assert.equal(crawl.boxes.filter((b) => b.kind === 'foundation' && b.size[2] === 8).length, 4);
  assert.ok(crawl.boxes.some((b) => b.kind === 'girder'));
  assert.ok(crawl.boxes.every((b) => b.c[1] + b.size[1] / 2 <= 0));

  const bsmt = foundationScene(house({ type: 'basement' }, { basementHeight: 96 }));
  const wall = bsmt.boxes.find((b) => b.kind === 'foundation' && b.size[1] === 96)!;
  assert.equal(wall.c[1] + 48, -(0.75 + 9.25 + 1.5));
  assert.equal(bsmt.flats.length, 1);
  assert.ok(bsmt.flats[0].y < -96);
  assert.deepEqual(foundationScene(house({ type: 'none' })), { boxes: [], flats: [] });
});
