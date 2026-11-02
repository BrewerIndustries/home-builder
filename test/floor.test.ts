import assert from 'node:assert/strict';
import { test } from 'node:test';
import { floorLayout, floorLines, scan } from '../src/calc/floor.ts';
import { samplePrice } from '../src/calc/pricing.ts';
import { DEFAULT_FOUNDATION, type Foundation } from '../src/model/types.ts';
import { box, project } from './helpers.ts';

const crawl = (f: Partial<Foundation> = {}, w = 480, h = 360) => project(box(w, h), [], { foundation: { ...DEFAULT_FOUNDATION, type: 'crawl', ...f } });

test('scan finds the inside of an L shape', () => {
  // L: 0..40 wide at the top, 0..20 below
  const L = [
    { u: 0, v: 0 },
    { u: 40, v: 0 },
    { u: 40, v: 10 },
    { u: 20, v: 10 },
    { u: 20, v: 30 },
    { u: 0, v: 30 },
  ];
  assert.deepEqual(scan([L], 10), [[0, 30]]);
  assert.deepEqual(scan([L], 30), [[0, 10]]);
  assert.deepEqual(scan([L], 50), []);
});

test('joists span the short way, broken over auto girders', () => {
  const L = floorLayout(crawl())!;
  // 40' × 30': joists run along y (30'); two girders keep spans to 10'.
  assert.equal(L.alongX, false);
  assert.equal(L.girders.length, 2);
  assert.equal(L.maxSpan, 120);
  // 16" o.c. inside 480": positions 16..464 → 29 joist lines × 3 pieces
  assert.equal(L.joists.length, 87);
  // two 40' girders, piers at 8' → 4 interior posts each
  assert.equal(L.piers.length, 8);
  // 30' / 4' = 7.5 rows; 40' = 5 sheets per row, staggered rows need 6
  assert.equal(L.sheets.length, 4 * 5 + 4 * 6);
});

test('girder count and direction overrides', () => {
  const L = floorLayout(crawl({ joistDir: 'x', girders: 0 }))!;
  assert.equal(L.alongX, true);
  assert.equal(L.girders.length, 0);
  assert.equal(L.maxSpan, 480);
  assert.equal(floorLayout(crawl({ girders: 2 }))!.girders.length, 2);
  assert.equal(floorLayout(crawl({ type: 'slab' })), null);
});

test('floor lines and prices', () => {
  const lines = floorLines(crawl(), 0.1);
  const joist = lines.find((l) => l.item.startsWith('2x10 floor joist'))!;
  assert.equal(joist.item, "2x10 floor joist, 12'");
  assert.ok(joist.qty >= 87);
  assert.ok(samplePrice(joist.item) > 20);
  assert.ok(lines.some((l) => l.item.startsWith('23/32" T&G OSB')));
  assert.ok(samplePrice('23/32" T&G OSB subfloor, 4×8') > 0);
  assert.ok(samplePrice('Pier / post with footing') > 0);
});
