import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickScale, SHEET } from '../src/calc/sheet.ts';

test('picks the largest architectural scale that fits a Letter sheet', () => {
  // Usable sheet is 10" × 6.6"; 0.9" top/left for dimension strings + 0.3" bottom/right.
  assert.equal(pickScale(10 * 12, 8 * 12).denom, 24); // 10×8 ft shed → 1/2" (5" × 4")
  assert.equal(pickScale(16 * 12, 12 * 12).denom, 48); // 12 ft at 1/2" = 6" + 1.2" > 6.6" → 1/4"
  assert.equal(pickScale(40 * 12, 28 * 12).denom, 64); // typical 40×28 ranch → 3/16"
  assert.equal(pickScale(40 * 12, 30 * 12).denom, 96); // 30 ft at 3/16" = 5.6" + 1.2" > 6.6" → 1/8"
  assert.equal(pickScale(60 * 12, 40 * 12).denom, 96);
  const big = pickScale(400 * 12, 300 * 12);
  assert.equal(big.denom, 192); // falls back to the smallest scale
  assert.ok(SHEET.w > SHEET.h);
});
