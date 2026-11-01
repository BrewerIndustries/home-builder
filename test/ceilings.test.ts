import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ceilingInfo } from '../src/calc/ceilings.ts';
import { ircChecks } from '../src/calc/irc.ts';
import type { Ceiling, Room } from '../src/model/types.ts';
import { box, project } from './helpers.ts';

const room = (ceiling?: Ceiling): Room => ({
  id: 'r1',
  name: 'Great room',
  type: 'living',
  ceiling,
  points: [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 144 }, { x: 0, y: 144 }],
});

test('flat ceiling = floor area at wall height', () => {
  const c = ceilingInfo(project(box(240, 144)), room());
  assert.equal(c.surface, 240 * 144);
  assert.equal(c.low, 97.125);
});

test('cathedral: 12 ft span rising 6 ft is a 12/12 pitch → √2 × floor', () => {
  const c = ceilingInfo(project(box(240, 144)), room({ type: 'cathedral', height: 96, peak: 168 }));
  assert.ok(Math.abs(c.surface / (240 * 144) - Math.SQRT2) < 1e-9);
  assert.equal(c.high, 168);
});

test('vaulted rises across the short side', () => {
  const c = ceilingInfo(project(box(240, 144)), room({ type: 'vaulted', height: 96, peak: 240 }));
  assert.ok(Math.abs(c.surface / (240 * 144) - Math.SQRT2) < 1e-9);
});

test('coffered adds beam sides and drops the low point', () => {
  const c = ceilingInfo(project(box(240, 144)), room({ type: 'coffered', height: 108, cofferSpacing: 48, cofferDepth: 8 }));
  assert.equal(c.low, 100);
  assert.ok(c.surface > 240 * 144);
  assert.ok(c.beamLength > 0);
});

test('a low vault is a review flag, a low flat ceiling is a fail', () => {
  const vault = ircChecks(project(box(240, 144), [], { rooms: [room({ type: 'vaulted', height: 60, peak: 144 })] }));
  assert.equal(vault.find((c) => c.rule.startsWith('Minimum ceiling'))!.status, 'warn');
  const flat = ircChecks(project(box(240, 144), [], { rooms: [room({ type: 'flat', height: 80 })] }));
  assert.equal(flat.find((c) => c.rule.startsWith('Minimum ceiling'))!.status, 'fail');
});
