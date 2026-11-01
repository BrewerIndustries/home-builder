import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ircChecks, netClearOpening } from '../src/calc/irc.ts';
import type { Room } from '../src/model/types.ts';
import { box, door, project, window_ } from './helpers.ts';

const room = (w: number, h: number, type: Room['type'] = 'bedroom'): Room => ({
  id: 'r1',
  name: 'Bed 1',
  type,
  points: [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ],
});

const find = (checks: ReturnType<typeof ircChecks>, section: string) => checks.filter((c) => c.section === section);

test('net clear opening estimates by window style', () => {
  assert.equal(netClearOpening(window_('w', 0, 36, 60, 24, 'casement')).width, 31);
  assert.equal(netClearOpening(window_('w', 0, 36, 60, 24, 'fixed')).area, 0);
  // 36x60 single-hung → 32 × 26 = 5.78 sq ft
  assert.ok(Math.abs(netClearOpening(window_('w', 0, 36, 60, 24)).area - 5.78) < 0.01);
});

test('bedroom without an escape window fails R310', () => {
  const walls = box(144, 144);
  const checks = ircChecks(project(walls, [window_(walls[0].id, 72, 24, 36)], { rooms: [room(144, 144)] }));
  assert.equal(find(checks, 'R310.1–R310.2')[0].status, 'fail');
});

test('bedroom with a big enough window passes R310 and R304', () => {
  const walls = box(144, 144);
  const checks = ircChecks(project(walls, [window_(walls[0].id, 72, 36, 60, 24)], { rooms: [room(144, 144)] }));
  assert.equal(find(checks, 'R310.1–R310.2')[0].status, 'pass');
  assert.ok(find(checks, 'R304.1').every((c) => c.status === 'pass'));
});

test('tiny or narrow habitable rooms fail R304', () => {
  const walls = box(72, 144);
  const checks = ircChecks(project(walls, [], { rooms: [room(72, 120, 'living')] }));
  assert.equal(find(checks, 'R304.1')[0].status, 'fail'); // 72 × 120 = 60 sq ft
  assert.equal(find(checks, 'R304.2')[0].status, 'fail'); // 6 ft wide
});

test('egress door must be at least a 3068', () => {
  const walls = box(240, 240);
  assert.equal(find(ircChecks(project(walls, [door(walls[0].id, 120, 32)])), 'R311.2')[0].status, 'fail');
  assert.equal(find(ircChecks(project(walls, [door(walls[0].id, 120, 36)])), 'R311.2')[0].status, 'pass');
  assert.equal(find(ircChecks(project(walls)), 'R311.2')[0].status, 'fail');
});

test('glazing next to a door flags safety glass', () => {
  const walls = box(240, 240);
  const checks = ircChecks(project(walls, [door(walls[0].id, 60), window_(walls[0].id, 110)]));
  assert.equal(find(checks, 'R308.4.2').length, 1);
});
