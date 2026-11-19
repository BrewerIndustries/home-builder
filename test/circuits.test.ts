import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appliances, circuitChecks, circuitOfDevice, circuits } from '../src/calc/circuits.ts';
import { attach } from '../src/calc/electrical.ts';
import { ircChecks } from '../src/calc/irc.ts';
import { autoOutdoor, deckAreas, deckOutlets, floorAboveGrade } from '../src/calc/outdoor.ts';
import { projectReducer } from '../src/model/store.ts';
import { DEFAULT_FOUNDATION, type Furniture, type Outlet, type Project, type Room } from '../src/model/types.ts';
import { box, door, project } from './helpers.ts';

const rect = (id: string, type: Room['type'], x0: number, y0: number, x1: number, y1: number): Room => ({
  id, name: id, type, points: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
});

/** 40' × 30' house: kitchen, bath, laundry across the top; bedroom and garage below. */
function house(): Project {
  const walls = box(480, 360);
  return project(walls, [], {
    rooms: [rect('K', 'kitchen', 0, 0, 240, 180), rect('B', 'bath', 240, 0, 360, 180), rect('L', 'utility', 360, 0, 480, 180), rect('Bed', 'bedroom', 0, 180, 240, 360), rect('G', 'garage', 240, 180, 480, 360)],
  });
}

/** A receptacle on the exterior wall under `p`, facing `inside`. */
function rec(p: Project, id: string, x: number, y: number, inside: { x: number; y: number }, kind: Outlet['kind'] = 'duplex'): Outlet {
  return { id, ...attach(p, { x, y }, inside)!, kind, height: 16, auto: false };
}

const furn = (id: string, kind: Furniture['kind'], x: number, y: number): Furniture => ({ id, kind, at: { x, y }, rot: 0, w: 30, d: 30 });

function wired(): Project {
  let p = house();
  const outlets = [
    rec(p, 'k1', 40, 0, { x: 40, y: 20 }, 'gfci'),
    rec(p, 'k2', 120, 0, { x: 120, y: 20 }, 'gfci'),
    rec(p, 'k3', 200, 0, { x: 200, y: 20 }, 'gfci'),
    rec(p, 'b1', 300, 0, { x: 300, y: 20 }, 'gfci'),
    rec(p, 'l1', 420, 0, { x: 420, y: 20 }),
    rec(p, 'bed1', 0, 270, { x: 20, y: 270 }),
    rec(p, 'g1', 480, 270, { x: 460, y: 270 }, 'gfci'),
  ];
  p = { ...p, outlets, fixtures: [{ id: 'bedL', kind: 'light', at: { x: 120, y: 270 }, auto: false }] };
  p = { ...p, furniture: [furn('W', 'washer', 400, 60), furn('D', 'dryer', 440, 60), furn('R', 'range', 120, 60), furn('WH', 'water-heater', 400, 120), furn('F', 'furnace', 440, 140)] };
  return p;
}

const sec = (p: Project, s: string) => circuitChecks(p).filter((c) => c.section === s);

test('kitchen receptacles alternate over two 20 A small-appliance circuits, AFCI + GFCI', () => {
  const p = wired();
  const cs = circuits(p);
  const sa = cs.filter((c) => c.kind === 'small-appliance');
  assert.equal(sa.length, 2);
  assert.deepEqual(sa.map((c) => c.devices.length).sort(), [1, 2]);
  assert.ok(sa.every((c) => c.amps === 20 && c.afci && c.gfci && c.va === 1500));
  assert.equal(sec(p, 'NEC 210.11(C)(1)')[0].status, 'pass');
  // All on one circuit: fails.
  const q = projectReducer(p, { type: 'setElectrical', patch: { circuitOf: { k2: 'sa1' } } });
  const one = projectReducer(q, { type: 'setElectrical', patch: { circuitOf: { k2: 'sa1', k1: 'sa1', k3: 'sa1' } } });
  assert.equal(sec(one, 'NEC 210.11(C)(1)')[0].status, 'fail');
  // A bedroom light moved onto a small-appliance circuit fails 210.52(B)(2).
  const lit = projectReducer(p, { type: 'setElectrical', patch: { circuitOf: { bedL: 'sa1' } } });
  assert.equal(sec(lit, 'NEC 210.52(B)(2)')[0].status, 'fail');
});

test('bath, laundry and garage circuits: 20 A, GFCI; AFCI only where 210.12 reaches', () => {
  const p = wired();
  const cs = circuits(p);
  const bath = cs.find((c) => c.kind === 'bath')!;
  assert.deepEqual([bath.amps, bath.gfci, bath.afci], [20, true, false]);
  const laundry = cs.find((c) => c.kind === 'laundry')!;
  assert.deepEqual(laundry.devices.sort(), ['W', 'l1']);
  assert.deepEqual([laundry.amps, laundry.gfci, laundry.afci, laundry.va], [20, true, true, 1500]);
  const garage = cs.find((c) => c.kind === 'garage')!;
  assert.deepEqual([garage.gfci, garage.afci], [true, false]);
  const gen = circuitOfDevice(cs, 'bed1')!;
  assert.equal(gen, circuitOfDevice(cs, 'bedL'));
  assert.deepEqual([gen.kind, gen.amps, gen.afci, gen.gfci, gen.va], ['general', 15, true, false, 3 * 300]);
  assert.equal(sec(p, 'NEC 210.11(C)(3)')[0].status, 'pass');
  assert.equal(sec(p, 'NEC 210.11(C)(2)')[0].status, 'pass');
  // The bedroom light moved onto the bathroom circuit.
  const q = projectReducer(p, { type: 'setElectrical', patch: { circuitOf: { bedL: bath.key } } });
  assert.equal(sec(q, 'NEC 210.11(C)(3)')[0].status, 'fail');
  // Turning AFCI off where it's needed warns.
  const off = projectReducer(p, { type: 'setElectrical', patch: { circuits: { [gen.key]: { afci: false } } } });
  assert.equal(sec(off, 'NEC 210.12')[0].status, 'warn');
});

test('fixed appliances get dedicated circuits sized from the nameplate (typical until entered)', () => {
  let p = wired();
  const by = (id: string) => circuitOfDevice(circuits(p), id)!;
  assert.deepEqual([by('R').amps, by('R').poles, by('R').volts], [50, 2, 240]); // 12 kW typical
  assert.deepEqual([by('D').amps, by('D').poles], [30, 2]);
  assert.equal(by('WH').amps, 25); // 4500 VA × 1.25 / 240
  assert.equal(by('F').amps, 60); // 10 kW electric furnace × 1.25
  assert.ok(appliances(p).find((a) => a.id === 'R')!.typical);
  p = projectReducer(p, { type: 'setElectrical', patch: { appliances: { R: { va: 8000 }, F: { gas: true }, WH: { gas: true } } } });
  assert.equal(by('R').amps, 35);
  assert.deepEqual([by('F').amps, by('F').volts, by('F').va], [15, 120, 800]);
  assert.equal(circuitOfDevice(circuits(p), 'WH'), undefined); // gas water heater: no circuit
  // Heating equipment sharing its circuit fails 422.12.
  const shared = projectReducer(p, { type: 'setElectrical', patch: { circuitOf: { bedL: by('F').key } } });
  assert.equal(sec(shared, 'NEC 422.12')[0].status, 'fail');
  // Disposer under a sink and microwave-hood over a cutout range.
  p = {
    ...p,
    counters: [{ id: 'C', a: { x: 10, y: 3.25 }, b: { x: 230, y: 3.25 }, depth: 25, side: -1, island: false, cutouts: [{ id: 'dw', kind: 'dishwasher', offset: 40, width: 24 }, { id: 'sk', kind: 'sink', offset: 80, width: 33 }] }],
  };
  p = projectReducer(p, { type: 'setElectrical', patch: { appliances: { sk: { disposal: true }, R: { microwave: true } } } });
  const kinds = appliances(p).map((a) => a.kind).sort();
  assert.ok(['dishwasher', 'disposal', 'microwave'].every((k) => kinds.includes(k as never)));
  const dw = circuitOfDevice(circuits(p), 'dw')!;
  assert.deepEqual([dw.amps, dw.gfci, dw.afci], [20, true, true]);
  assert.ok(circuitOfDevice(circuits(p), 'sk:disposal'));
  assert.ok(circuitOfDevice(circuits(p), 'R:microwave'));
});

test('a device moved to a new circuit key starts that circuit', () => {
  const p = projectReducer(wired(), { type: 'setElectrical', patch: { circuitOf: { bed1: 'c1' } } });
  const c = circuits(p).find((x) => x.key === 'c1')!;
  assert.deepEqual(c.devices, ['bed1']);
  assert.ok(c.afci);
});

test('outdoor receptacle height is checked above grade from the foundation', () => {
  const walls = box(480, 360);
  const bottom = walls.find((w) => w.a.y === 360 && w.b.y === 360)!;
  let p = project(walls, [door(bottom.id, 240)], { rooms: [rect('R', 'living', 0, 0, 480, 360)] });
  assert.deepEqual(floorAboveGrade(p), { height: 6, from: 'foundation' }); // default slab: 18" edge, 12" below grade
  p = { ...p, foundation: { ...DEFAULT_FOUNDATION, type: 'crawl' } };
  assert.equal(floorAboveGrade(p).height, 8 + 24 - 12 + 1.5 + 9.25 + 0.75);
  const o = rec(p, 'out', 120, 360, { x: 120, y: 400 }, 'gfci');
  const height = (h: number, q: Project = p) => ircChecks({ ...q, outlets: [{ ...o, height: h }] }).filter((c) => c.rule === 'Outdoor receptacle height');
  assert.equal(height(40).length, 0);
  assert.equal(height(50).length, 1); // 81-1/2" above grade
  const set = projectReducer(p, { type: 'setElectrical', patch: { floorAboveGrade: 12 } });
  assert.equal(height(50, set).length, 0);
});

test('a deck a door opens onto needs a receptacle reached from it; auto layout adds one', () => {
  const walls = box(480, 360);
  const bottom = walls.find((w) => w.a.y === 360 && w.b.y === 360)!;
  const top = walls.find((w) => w.a.y === 0 && w.b.y === 0)!;
  let p = project(walls, [door(bottom.id, 240), { ...door(top.id, 400), id: 'deckdoor' }], {
    rooms: [rect('R', 'living', 0, 0, 480, 360)],
    site: { setbacks: [], plants: [], areas: [{ id: 'deck', material: 'decking', depth: 0, points: [{ x: 300, y: -144 }, { x: 470, y: -144 }, { x: 470, y: -3 }, { x: 300, y: -3 }] }] },
  });
  assert.equal(deckAreas(p).length, 1);
  const deckCheck = (q: Project) => ircChecks(q).find((c) => c.section === 'NEC 210.52(E)(3)')!;
  assert.equal(deckCheck(p).status, 'fail');
  // A back receptacle off the deck doesn't count.
  p = { ...p, outlets: [rec(p, 'back', 60, 0, { x: 60, y: -40 }, 'gfci')] };
  assert.equal(deckCheck(p).status, 'fail');
  const auto = autoOutdoor(p);
  p = projectReducer(p, { type: 'replaceAutoOutlets', outlets: auto });
  assert.equal(deckOutlets(p, deckAreas(p)[0]).length, 1);
  assert.equal(deckCheck(p).status, 'pass');
  // Measured from the deck (floor level): 84" up warns.
  const id = deckOutlets(p, deckAreas(p)[0])[0].id;
  const high = { ...p, outlets: p.outlets.map((o) => (o.id === id ? { ...o, height: 84 } : o)) };
  assert.ok(ircChecks(high).some((c) => c.rule === 'Deck receptacle height'));
  // A concrete pad only counts when labelled as a porch.
  const pad = { ...p, site: { ...p.site!, areas: [{ ...p.site!.areas[0], material: 'concrete' as const }] } };
  assert.equal(deckAreas(pad).length, 0);
  assert.equal(deckAreas({ ...pad, site: { ...pad.site, areas: [{ ...pad.site.areas[0], label: 'Back porch' }] } }).length, 1);
});
