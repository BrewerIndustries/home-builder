import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autoLighting, coRequired, roomAt, switchWays } from '../src/calc/lighting.ts';
import { ircChecks } from '../src/calc/irc.ts';
import { materialsList } from '../src/calc/materials.ts';
import { dist, pointAlong } from '../src/model/geometry.ts';
import { projectReducer } from '../src/model/store.ts';
import type { Project, Room } from '../src/model/types.ts';
import { box, door, project, wall } from './helpers.ts';

const rect = (id: string, type: Room['type'], x0: number, y0: number, x1: number, y1: number): Room => ({
  id, name: id, type,
  points: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
});

/**
 * 40' × 24' house: two bedrooms (12' × 12') off a 4' hall along the top,
 * a bath, and the living room below. Hall runs y = 144..192.
 */
function house(patch: Partial<Project> = {}): Project {
  const outer = box(480, 288);
  const bedWall = wall(0, 144, 480, 144, 'interior');
  const hallWall = wall(0, 192, 480, 192, 'interior');
  const split1 = wall(144, 0, 144, 144, 'interior');
  const split2 = wall(288, 0, 288, 144, 'interior');
  const walls = [...outer, bedWall, hallWall, split1, split2];
  const openings = [
    { ...door(bedWall.id, 72), id: 'd-bed1', swing: { side: 1 as const, hinge: 'a' as const } },
    { ...door(bedWall.id, 216), id: 'd-bed2', swing: { side: 1 as const, hinge: 'a' as const } },
    { ...door(bedWall.id, 384), id: 'd-bath' },
    { ...door(hallWall.id, 240), id: 'd-hall' },
    { ...door(outer[2].id, 240), id: 'd-front' },
  ];
  const rooms = [
    rect('Bed 1', 'bedroom', 0, 0, 144, 144),
    rect('Bed 2', 'bedroom', 144, 0, 288, 144),
    rect('Bath', 'bath', 288, 0, 480, 144),
    rect('Hall', 'hall', 0, 144, 480, 192),
    rect('Living', 'living', 0, 192, 480, 288),
  ];
  return project(walls, openings, { rooms, ...patch });
}

function laidOut(p: Project): Project {
  const { fixtures, switches } = autoLighting(p);
  return projectReducer(p, { type: 'replaceAutoLighting', fixtures, switches });
}

test('every room gets a centred light and a switch beside its door', () => {
  const p = laidOut(house());
  for (const room of p.rooms) {
    const lights = p.fixtures.filter((f) => f.kind === 'light' && roomAt(p, f.at)?.id === room.id);
    assert.equal(lights.length, 1, room.name);
    assert.ok(p.switches.some((s) => s.controls.includes(lights[0].id)), `${room.name} switched`);
  }
  const bed1 = p.fixtures.find((f) => f.kind === 'light' && roomAt(p, f.at)?.id === 'Bed 1')!;
  assert.deepEqual(bed1.at, { x: 72, y: 72 });
  // Bed 1's switch is inside the bedroom, 6" past the door opening.
  const sw = p.switches.find((s) => s.controls.includes(bed1.id))!;
  const w = p.walls.find((x) => x.id === sw.wallId)!;
  const c = pointAlong(w, sw.offset);
  assert.ok(Math.abs(Math.abs(c.x - 72) - 24) < 0.01, `switch at x=${c.x}`);
  assert.equal(sw.height, 48);
});

test('the hall gets a 3-way pair; materials count the devices', () => {
  const p = laidOut(house());
  const hallLight = p.fixtures.find((f) => f.kind === 'light' && roomAt(p, f.at)?.id === 'Hall')!;
  const hallSwitches = p.switches.filter((s) => s.controls.includes(hallLight.id));
  assert.equal(hallSwitches.length, 2);
  const ways = switchWays(p);
  assert.deepEqual(hallSwitches.map((s) => ways.get(s.id)), [3, 3]);
  const lines = materialsList(p);
  const qty = (item: string) => lines.find((l) => l.item === item)?.qty ?? 0;
  assert.equal(qty('3-way switch, 15A'), 2);
  assert.equal(qty('Single-pole switch, 15A'), p.switches.length - 2);
  assert.equal(qty('Ceiling light fixture (allowance)'), 5);
  assert.equal(qty('Round ceiling box, new-work'), p.fixtures.length);
});

test('smoke alarms: each bedroom plus one hall alarm shared by both bedroom doors', () => {
  const p = laidOut(house());
  const alarms = p.fixtures.filter((f) => f.kind !== 'light');
  assert.equal(alarms.filter((f) => roomAt(p, f.at)?.id === 'Bed 1').length, 1);
  assert.equal(alarms.filter((f) => roomAt(p, f.at)?.id === 'Bed 2').length, 1);
  const hall = alarms.filter((f) => roomAt(p, f.at)?.id === 'Hall');
  assert.equal(hall.length, 1); // bedroom doors 12 ft apart share one, centred between them
  assert.deepEqual(hall[0].at, { x: 144, y: 168 });
  assert.ok(hall.every((f) => f.kind === 'smoke'), 'no CO without fuel appliances or a garage');
  const checks = ircChecks(p);
  assert.ok(checks.filter((c) => c.section === 'R314.3').every((c) => c.status !== 'fail'), JSON.stringify(checks.filter((c) => c.section === 'R314.3')));
  assert.ok(checks.filter((c) => c.section.startsWith('E3903') && c.status !== 'info').every((c) => c.status === 'pass'));
});

test('fuel-burning appliances make the hallway alarm a smoke / CO combination', () => {
  let p = house({ electrical: { fuelAppliances: true } });
  assert.ok(coRequired(p));
  p = laidOut(p);
  const hall = p.fixtures.filter((f) => f.kind !== 'light' && roomAt(p, f.at)?.id === 'Hall');
  assert.ok(hall.length && hall.every((f) => f.kind === 'smoke-co'));
  assert.equal(ircChecks(p).find((c) => c.section === 'R315.3')!.status, 'pass');
  // Swap it for a plain smoke alarm and the CO check fails.
  p = projectReducer(p, { type: 'updateFixture', id: hall[0].id, patch: { kind: 'smoke' } });
  assert.equal(ircChecks(p).find((c) => c.section === 'R315.3')!.status, 'fail');
});

test('missing bedroom alarm and unswitched kitchen fail; bedroom without light only warns', () => {
  let p = laidOut(house());
  const bedAlarm = p.fixtures.find((f) => f.kind !== 'light' && roomAt(p, f.at)?.id === 'Bed 1')!;
  const bedLight = p.fixtures.find((f) => f.kind === 'light' && roomAt(p, f.at)?.id === 'Bed 1')!;
  p = projectReducer(p, { type: 'delete', ids: [bedAlarm.id, bedLight.id] });
  const checks = ircChecks(p);
  assert.equal(checks.find((c) => c.rule === 'Smoke alarm in each sleeping room' && c.targetId === 'Bed 1')!.status, 'fail');
  assert.equal(checks.find((c) => c.section === 'E3903.2' && c.targetId === 'Bed 1')!.status, 'warn');
  // Deleting a light also drops it from the switch that ran it.
  assert.ok(p.switches.every((s) => !s.controls.includes(bedLight.id)));
});

test('alarm right outside a bathroom door warns; manual items survive a re-run', () => {
  let p = laidOut(house());
  const bathDoor = pointAlong(p.walls.find((w) => w.id === p.openings.find((o) => o.id === 'd-bath')!.wallId)!, 384);
  p = projectReducer(p, { type: 'addFixture', fixture: { id: 'mine', kind: 'smoke', at: { x: bathDoor.x, y: bathDoor.y + 20 }, auto: false } });
  assert.ok(ircChecks(p).some((c) => c.rule === 'Smoke alarm near a bathroom door' && c.status === 'warn'));
  const before = p.fixtures.filter((f) => f.auto).length;
  p = laidOut(p);
  assert.ok(p.fixtures.some((f) => f.id === 'mine'));
  assert.equal(p.fixtures.filter((f) => f.auto).length, before);
});

test('a hand-edited switch with nothing ticked is not doubled by a re-run', () => {
  let p = laidOut(house());
  const living = p.fixtures.find((f) => f.kind === 'light' && roomAt(p, f.at)?.id === 'Living')!;
  const sw = p.switches.find((s) => s.controls.includes(living.id))!;
  p = projectReducer(p, { type: 'updateSwitch', id: sw.id, patch: { controls: [], auto: false } });
  p = laidOut(p);
  assert.equal(p.switches.filter((s) => s.wallId === sw.wallId && s.side === sw.side && Math.abs(s.offset - sw.offset) < 1).length, 1);
});

test('a new light joins the switch already running its room', () => {
  let p = laidOut(house());
  const sw = p.switches.find((s) => s.controls.some((c) => roomAt(p, p.fixtures.find((f) => f.id === c)!.at)?.id === 'Living'))!;
  p = projectReducer(p, { type: 'addFixture', fixture: { id: 'extra', kind: 'light', at: { x: 400, y: 240 }, auto: false }, linkTo: [sw.id] });
  assert.ok(p.switches.find((s) => s.id === sw.id)!.controls.includes('extra'));
  assert.ok(dist(p.fixtures.find((f) => f.id === 'extra')!.at, { x: 400, y: 240 }) === 0);
});

test('no bedrooms: one alarm on the storey; an attached garage needs CO', () => {
  const walls = box(240, 240);
  const mid = wall(120, 0, 120, 240, 'interior');
  let p = project([...walls, mid], [{ ...door(mid.id, 120), id: 'd-g' }], {
    rooms: [rect('Living', 'living', 0, 0, 120, 240), rect('Garage', 'garage', 120, 0, 240, 240)],
  });
  assert.ok(coRequired(p));
  p = laidOut(p);
  const alarms = p.fixtures.filter((f) => f.kind !== 'light');
  assert.equal(alarms.length, 1);
  assert.equal(alarms[0].kind, 'smoke-co');
  assert.equal(ircChecks(p).find((c) => c.rule === 'Smoke alarm on each storey')!.status, 'pass');
});
