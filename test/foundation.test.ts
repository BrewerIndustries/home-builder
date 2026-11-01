import assert from 'node:assert/strict';
import { test } from 'node:test';
import { foundationCalc, foundationChecks, foundationLines, foundationVolumes } from '../src/calc/foundation.ts';
import { materialsList } from '../src/calc/materials.ts';
import { DEFAULT_FOUNDATION, type Foundation } from '../src/model/types.ts';
import { box, project } from './helpers.ts';

const house = (f: Partial<Foundation> = {}) => project(box(480, 360), [], { foundation: { ...DEFAULT_FOUNDATION, ...f } });

test('outline grows from wall centrelines to the outside face', () => {
  const c = foundationCalc(house())!;
  const t = 6.5; // 2x6 exterior: 5.5 + 1
  assert.equal(c.perimeter, 1680 + 4 * t);
  assert.equal(c.area, (480 + t) * (360 + t));
  // 40' walls: 8 bolts each, 30' walls: 6 each.
  assert.equal(c.anchorBolts, 28);
});

test('slab takeoff: concrete, base, poly, rebar', () => {
  const p = house();
  const c = foundationCalc(p)!;
  const v = foundationVolumes(c);
  assert.equal(v.slab, c.area * 4);
  assert.equal(v.edge, c.perimeter * 12 * 14);
  const lines = foundationLines(p, 0.1);
  const get = (s: string) => lines.find((l) => l.item.startsWith(s));
  const yd = get('Concrete, slab')!.qty;
  assert.ok(yd >= ((v.slab + v.edge) * 1.05) / 46656 && yd % 0.25 === 0);
  assert.equal(get('6-mil poly')!.qty, 2); // ~1,238 sq ft +10%
  assert.equal(get('1/2" × 10" anchor bolt')!.qty, 28);
  assert.ok(materialsList(p)[0].category === 'Foundation');
});

test('crawlspace with block stem wall and vents', () => {
  const lines = foundationLines(house({ type: 'crawl', stemMaterial: 'cmu', footingDepth: 24 }), 0.1);
  const items = lines.map((l) => l.item);
  assert.ok(items.includes('Concrete, footings'));
  assert.ok(items.includes('8×8×16 concrete block'));
  assert.ok(!items.some((i) => i.startsWith('Concrete, stem')));
  // ~1,238 sq ft / 150 = 8.3 sq ft net → 24 vents at 50 sq in
  assert.equal(lines.find((l) => l.item.startsWith('Foundation vent'))!.qty, 24);
});

test('foundation checks', () => {
  const rules = (f: Partial<Foundation>) => Object.fromEntries(foundationChecks(house(f)).map((c) => [c.section, c.status]));
  assert.equal(rules({ slabThickness: 3 })['R506.1'], 'fail');
  assert.equal(rules({})['R403.1.4.1'], 'info');
  assert.equal(rules({ frostDepth: 30, footingDepth: 24 })['R403.1.4.1'], 'fail');
  assert.equal(rules({ frostDepth: 30, footingDepth: 36 })['R403.1.4.1'], 'pass');
  assert.equal(rules({ type: 'crawl', footingWidth: 10 })['R403.1.1'], 'fail');
  assert.equal(rules({ footingDepth: 8 })['R403.1.4'], 'fail');
  assert.deepEqual(foundationChecks(house({ type: 'none' })), []);
});
