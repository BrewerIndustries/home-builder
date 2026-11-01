import assert from 'node:assert/strict';
import { test } from 'node:test';
import { materialsList } from '../src/calc/materials.ts';
import { estimate, samplePrice } from '../src/calc/pricing.ts';
import { box, door, project } from './helpers.ts';

test('sample prices cover every line the materials list can produce', () => {
  const walls = box(480, 360);
  const lines = materialsList(project(walls, [door(walls[0].id, 240)]));
  for (const l of lines) assert.ok(samplePrice(l.item) > 0, `no sample price for ${l.item}`);
  assert.equal(samplePrice("2x6 stud, 12'"), 11.4);
});

test('custom prices override samples; markup and tax apply to the materials subtotal', () => {
  const lines = [
    { category: 'Lumber' as const, item: '2x6 stud, 92-5/8" precut', qty: 10, unit: 'ea', basis: '' },
    { category: 'Drywall' as const, item: '1/2" drywall, 4×8', qty: 4, unit: 'sheets', basis: '' },
  ];
  const e = estimate(lines, { prices: { '2x6 stud, 92-5/8" precut': 8 }, markup: 0.1, tax: 0.05 });
  assert.equal(e.lines[0].unitPrice, 8);
  assert.ok(e.lines[0].custom);
  assert.ok(!e.lines[1].custom);
  assert.equal(e.subtotal, 80 + 60);
  assert.equal(e.markup, 14);
  assert.equal(e.tax, 7);
  assert.equal(e.total, 161);
  assert.deepEqual(e.byCategory.map((c) => c.total), [80, 60]);
});
