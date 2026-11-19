import assert from 'node:assert/strict';
import { test } from 'node:test';
import { circuits, type Circuit } from '../src/calc/circuits.ts';
import { legOf, lightingDemand, loadCalc, optionalDemand, panelSchedule, serviceFor } from '../src/calc/loadCalc.ts';
import { projectReducer } from '../src/model/store.ts';
import type { Furniture, Project, Room } from '../src/model/types.ts';
import { box, project } from './helpers.ts';

const rect = (id: string, type: Room['type'], x0: number, y0: number, x1: number, y1: number): Room => ({
  id, name: id, type, points: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
});
const furn = (id: string, kind: Furniture['kind'], x: number, y: number): Furniture => ({ id, kind, at: { x, y }, rot: 0, w: 30, d: 30 });

/** 2000 sq ft of living space (50' × 40') plus a 20' × 20' garage outside it. */
function house(): Project {
  return project(box(600, 480), [], {
    rooms: [rect('K', 'kitchen', 0, 0, 240, 240), rect('L', 'living', 240, 0, 600, 240), rect('Bed', 'bedroom', 0, 240, 360, 480), rect('U', 'utility', 360, 240, 600, 480), rect('G', 'garage', 600, 0, 840, 240)],
    furniture: [furn('R', 'range', 100, 30), furn('W', 'washer', 400, 300), furn('D', 'dryer', 450, 300), furn('WH', 'water-heater', 500, 300)],
  });
}

test('220.42 demand: first 3000 VA at 100%, next 117,000 at 35%, rest at 25%', () => {
  assert.equal(lightingDemand(2000), 2000);
  assert.equal(lightingDemand(10000), 3000 + 7000 * 0.35);
  assert.equal(lightingDemand(130000), 3000 + 117000 * 0.35 + 10000 * 0.25);
  assert.equal(optionalDemand(8000), 8000);
  assert.equal(optionalDemand(30000), 10000 + 20000 * 0.4);
});

test('standard method: lighting + 2 small-appliance + laundry, dryer at 5000 min, range at nameplate', () => {
  let p = house();
  let c = loadCalc(p, 'standard');
  assert.equal(c.sqft, 2000);
  const base = 3 * 2000 + 1500 * 3;
  const demand = c.lines.find((l) => l.label.startsWith('Demand'))!;
  assert.deepEqual([demand.va, demand.demand], [base, Math.round(3000 + (base - 3000) * 0.35)]);
  // Typical loads: range 12 kW, dryer 5 kW, water heater 4.5 kW (fastened, fewer than four → 100%).
  assert.equal(c.total, demand.demand + 4500 + 5000 + 12000);
  assert.equal(c.service, serviceFor(c.total / 240));
  assert.ok(c.typical.length >= 3);
  // Nameplates: a 4000 VA dryer still counts 5000; an 8 kW range at 8000.
  p = projectReducer(p, { type: 'setElectrical', patch: { appliances: { D: { va: 4000 }, R: { va: 8000 } } } });
  c = loadCalc(p, 'standard');
  assert.equal(c.lines.find((l) => l.label === 'Dryer')!.demand, 5000);
  assert.equal(c.total, demand.demand + 4500 + 5000 + 8000);
});

test('four or more fastened-in-place appliances take 75%; the larger of heating and cooling counts', () => {
  let p = house();
  p = {
    ...p,
    counters: [{ id: 'C', a: { x: 10, y: 3.25 }, b: { x: 230, y: 3.25 }, depth: 25, side: -1, island: false, cutouts: [{ id: 'dw', kind: 'dishwasher', offset: 40, width: 24 }, { id: 'sk', kind: 'sink', offset: 80, width: 33 }] }],
    furniture: [...p.furniture, furn('F', 'furnace', 550, 400)],
  };
  p = projectReducer(p, { type: 'setElectrical', patch: { appliances: { sk: { disposal: true }, R: { microwave: true }, F: { va: 9000 } }, coolingVA: 6000 } });
  const c = loadCalc(p, 'standard');
  const fixed = c.lines.find((l) => l.label.startsWith('Fastened'))!;
  assert.equal(fixed.va, 1200 + 900 + 1500 + 4500);
  assert.equal(fixed.demand, Math.round(fixed.va * 0.75));
  const hvac = c.lines.find((l) => l.label.startsWith('Heating or cooling'))!;
  assert.equal(hvac.demand, 9000);
  // Cooling bigger than heating.
  const q = projectReducer(p, { type: 'setElectrical', patch: { coolingVA: 12000 } });
  assert.equal(loadCalc(q, 'standard').lines.find((l) => l.label.startsWith('Heating or cooling'))!.demand, 12000);
  assert.ok(circuits(q).some((x) => x.kind === 'cooling' && x.poles === 2));
});

test('optional method: first 10 kVA at 100%, the rest at 40%, plus heating or cooling', () => {
  const p = projectReducer(house(), { type: 'setElectrical', patch: { coolingVA: 5000, loadMethod: 'optional' } });
  const c = loadCalc(p);
  assert.equal(c.method, 'optional');
  const general = 3 * 2000 + 1500 * 3 + 12000 + 5000 + 4500;
  const d = c.lines.find((l) => l.label.startsWith('Demand'))!;
  assert.deepEqual([d.va, d.demand], [general, Math.round(10000 + (general - 10000) * 0.4)]);
  assert.equal(c.total, d.demand + 5000);
});

test('service size rounds up to a common rating, never under 100 A', () => {
  assert.equal(serviceFor(40), 100);
  assert.equal(serviceFor(100.2), 125);
  assert.equal(serviceFor(180), 200);
  assert.equal(serviceFor(900), 400);
});

test('panel schedule: 2-pole breakers span two rows, 120 V circuits balance the legs', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(legOf), ['A', 'A', 'B', 'B', 'A', 'A']);
  const mk = (key: string, poles: 1 | 2, va: number): Circuit =>
    ({ key, kind: 'general', label: key, amps: 20, poles, volts: poles === 2 ? 240 : 120, afci: false, gfci: false, afciRequired: false, gfciRequired: false, devices: [], receptacles: 0, lights: 0, rooms: [], va, inGeneralLoad: false, set: {} }) as Circuit;
  const s = panelSchedule([mk('r', 2, 12000), mk('d', 2, 5000), mk('a', 1, 1500), mk('b', 1, 1500), mk('c', 1, 900), mk('e', 1, 600)]);
  assert.deepEqual(s.slots.find((x) => x.circuit.key === 'r')!.numbers, [1, 3]);
  assert.deepEqual(s.slots.find((x) => x.circuit.key === 'd')!.numbers, [2, 4]);
  const nums = s.slots.flatMap((x) => x.numbers);
  assert.equal(new Set(nums).size, nums.length);
  assert.equal(s.phaseA + s.phaseB, 12000 + 5000 + 1500 + 1500 + 900 + 600);
  assert.ok(Math.abs(s.phaseA - s.phaseB) <= 600);
  // The real plan: every circuit gets a number.
  const real = panelSchedule(circuits(house()));
  assert.equal(real.slots.length, circuits(house()).length);
});
