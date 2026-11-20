import assert from 'node:assert/strict';
import { test } from 'node:test';
import { circuits } from '../src/calc/circuits.ts';
import { ircChecks } from '../src/calc/irc.ts';
import { HABITABLE } from '../src/model/types.ts';
import { box, project } from './helpers.ts';

const office = (w: number, d: number) =>
  project(box(w, d), [], {
    rooms: [{ id: 'O', name: 'Office', type: 'office', points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d }] }],
    outlets: [],
  });

test('an office is habitable: a small one fails the 70 sq ft / 7 ft room-size checks', () => {
  assert.ok(HABITABLE.has('office'));
  const small = ircChecks(office(72, 96)).filter((c) => c.targetId === 'O' && /Minimum habitable room/.test(c.rule));
  assert.ok(small.length >= 1);
  assert.ok(small.some((c) => c.status === 'fail'));
  const roomy = ircChecks(office(132, 120)).filter((c) => c.targetId === 'O' && /Minimum habitable room/.test(c.rule));
  assert.ok(roomy.every((c) => c.status === 'pass'));
});

test('an office is not a sleeping room (no smoke alarm required in it)', () => {
  const checks = ircChecks(office(132, 120));
  assert.ok(!checks.some((c) => c.rule === 'Smoke alarm in each sleeping room' && c.targetId === 'O'));
});

test("an office's general circuit is AFCI protected", () => {
  const p = office(132, 120);
  p.outlets = [{ id: 'r1', wallId: p.walls[0].id, offset: 40, side: -1, kind: 'duplex', height: 16, auto: false }];
  const c = circuits(p).find((x) => x.devices.includes('r1'));
  assert.ok(c, 'receptacle is on a circuit');
  assert.equal(c!.afciRequired, true);
});
