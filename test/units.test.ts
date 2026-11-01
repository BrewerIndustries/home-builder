import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatFtIn, parseFtIn } from '../src/model/units.ts';

test('formatFtIn', () => {
  assert.equal(formatFtIn(150.5), `12' 6-1/2"`);
  assert.equal(formatFtIn(144), `12' 0"`);
  assert.equal(formatFtIn(144, { compact: true }), `12'`);
  assert.equal(formatFtIn(5.75), `5-3/4"`);
  assert.equal(formatFtIn(92.625), `7' 8-5/8"`);
});

test('parseFtIn accepts the usual spellings', () => {
  assert.equal(parseFtIn(`12'6"`), 150);
  assert.equal(parseFtIn(`12' 6-1/2"`), 150.5);
  assert.equal(parseFtIn('12 6'), 150);
  assert.equal(parseFtIn(`12.5'`), 150);
  assert.equal(parseFtIn('150'), 150);
  assert.equal(parseFtIn('150"'), 150);
  assert.equal(parseFtIn('3/4"'), 0.75);
  assert.equal(parseFtIn('12 ft'), 144);
  assert.equal(parseFtIn('nope'), null);
});
