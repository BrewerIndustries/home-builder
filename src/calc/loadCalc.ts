import type { Project } from '../model/types.ts';
import { appliances, circuits, HEATING, type Appliance, type Circuit } from './circuits.ts';
import { exclusiveArea } from './regions.ts';

// Dwelling service load calculation (NEC Article 220, 2020 numbering) and the panel schedule.
//
// Standard method:
//   220.12  general lighting at 3 VA per sq ft (garages excluded)
//   220.52  1500 VA per small-appliance circuit (at least two) and per laundry circuit (at least one)
//   220.42  the lighting + small-appliance + laundry total at 100% of the first 3000 VA,
//           35% of the next 117,000 VA, 25% of the rest
//   220.53  fastened-in-place appliances (not ranges, dryers, space heating or A/C) at
//           nameplate, 75% of the total when there are four or more
//   220.54  each electric dryer at 5000 VA or its nameplate, whichever is larger
//   220.55  ranges and wall ovens — the demand table is NOT applied here: they're taken
//           at nameplate (conservative); enter the nameplate on the appliance
//   220.60  the larger of the heating and the cooling load
// Optional method (220.82): 3 VA/sq ft + 1500 VA per small-appliance and laundry circuit +
//   every other appliance's nameplate, the first 10 kVA at 100% and the rest at 40%; heating
//   or cooling (the larger) is added at 100% here (220.82(C) allows less for some heating —
//   not applied).
// The result is divided by 240 V for the service amps; the recommendation is the next
// common service rating, never under 100 A (230.79(C)).

export type LoadMethod = 'standard' | 'optional';

export interface LoadLine {
  label: string;
  /** Connected load, VA. */
  va: number;
  /** After demand factors, VA. */
  demand: number;
  note?: string;
}

export interface LoadCalc {
  method: LoadMethod;
  lines: LoadLine[];
  total: number;
  amps: number;
  service: number;
  /** Appliances still on a typical load. */
  typical: Appliance[];
  sqft: number;
}

export const SERVICE_SIZES = [100, 125, 150, 200, 225, 300, 400];
export const MIN_SERVICE = 100;

export const serviceFor = (amps: number) => SERVICE_SIZES.find((s) => s >= Math.max(MIN_SERVICE, amps) - 1e-9) ?? SERVICE_SIZES[SERVICE_SIZES.length - 1];

/** 220.42 demand on the lighting, small-appliance and laundry total. */
export function lightingDemand(va: number): number {
  const a = Math.min(va, 3000);
  const b = Math.min(Math.max(va - 3000, 0), 117000);
  const c = Math.max(va - 120000, 0);
  return a + b * 0.35 + c * 0.25;
}

/** 220.82(B): first 10 kVA at 100%, the remainder at 40%. */
export const optionalDemand = (va: number) => Math.min(va, 10000) + Math.max(va - 10000, 0) * 0.4;

/** General lighting area: every room but garages, sq ft. */
export const livingArea = (project: Project) => project.rooms.filter((r) => r.type !== 'garage').reduce((s, r) => s + exclusiveArea(project, r), 0) / 144;

const FASTENED = new Set(['dishwasher', 'disposal', 'microwave', 'water-heater']);
const COOKING = new Set(['range', 'oven']);

export function loadCalc(project: Project, method: LoadMethod = project.electrical?.loadMethod ?? 'standard', cs: Circuit[] = circuits(project)): LoadCalc {
  const apps = appliances(project).filter((a) => a.va > 0);
  const sqft = livingArea(project);
  const sa = Math.max(2, cs.filter((c) => c.kind === 'small-appliance').length);
  const laundry = Math.max(1, cs.filter((c) => c.kind === 'laundry').length);
  const lighting = Math.round(3 * sqft);
  const heat = apps.filter((a) => HEATING.has(a.kind)).reduce((s, a) => s + a.va, 0);
  const cool = project.electrical?.coolingVA ?? 0;
  const hvac = Math.max(heat, cool);
  const hvacLine: LoadLine = { label: `Heating or cooling, the larger (${heat > cool ? 'heating' : 'cooling'})`, va: hvac, demand: hvac, note: `heating ${heat.toLocaleString()} VA · cooling ${cool.toLocaleString()} VA${cool ? '' : ' (enter the A/C nameplate in the Electrical tab)'} — 220.60` };
  const lines: LoadLine[] = [];
  const nameOf = (list: Appliance[]) => list.map((a) => `${a.label.toLowerCase()} ${a.va.toLocaleString()}${a.typical ? '*' : ''}`).join(', ');

  if (method === 'standard') {
    const base = lighting + 1500 * (sa + laundry);
    lines.push({ label: `General lighting, ${Math.round(sqft).toLocaleString()} sq ft × 3 VA`, va: lighting, demand: 0, note: '220.12; garages excluded' });
    lines.push({ label: `Small-appliance circuits, ${sa} × 1500 VA`, va: 1500 * sa, demand: 0, note: '220.52(A)' });
    lines.push({ label: `Laundry circuit${laundry > 1 ? 's' : ''}, ${laundry} × 1500 VA`, va: 1500 * laundry, demand: 0, note: '220.52(B)' });
    lines.push({ label: 'Demand on the three lines above', va: base, demand: Math.round(lightingDemand(base)), note: 'first 3000 VA at 100%, next 117,000 VA at 35%, rest at 25% — 220.42' });
    const fixed = apps.filter((a) => FASTENED.has(a.kind));
    if (fixed.length) {
      const sum = fixed.reduce((s, a) => s + a.va, 0);
      lines.push({ label: `Fastened-in-place appliances (${fixed.length})`, va: sum, demand: Math.round(fixed.length >= 4 ? sum * 0.75 : sum), note: `${nameOf(fixed)}${fixed.length >= 4 ? ' — four or more at 75%' : ''} — 220.53` });
    }
    for (const a of apps.filter((x) => x.kind === 'dryer' && !x.gas)) {
      lines.push({ label: a.label, va: a.va, demand: Math.max(5000, a.va), note: '5000 VA or the nameplate, whichever is larger — 220.54' });
    }
    for (const a of apps.filter((x) => COOKING.has(x.kind))) {
      lines.push({ label: a.label, va: a.va, demand: a.va, note: `nameplate${a.typical ? ' (typical — enter it)' : ''}; Table 220.55 demand not applied` });
    }
    if (hvac) lines.push(hvacLine);
  } else {
    const others = apps.filter((a) => !HEATING.has(a.kind) && a.kind !== 'washer');
    const appVa = others.reduce((s, a) => s + a.va, 0);
    const general = lighting + 1500 * (sa + laundry) + appVa;
    lines.push({ label: `General lighting, ${Math.round(sqft).toLocaleString()} sq ft × 3 VA`, va: lighting, demand: 0, note: '220.82(B)(1)' });
    lines.push({ label: `Small-appliance and laundry circuits, ${sa + laundry} × 1500 VA`, va: 1500 * (sa + laundry), demand: 0, note: '220.82(B)(2)' });
    if (others.length) lines.push({ label: `Appliances at nameplate (${others.length})`, va: appVa, demand: 0, note: `${nameOf(others)} — 220.82(B)(3)` });
    lines.push({ label: 'Demand on the general load', va: general, demand: Math.round(optionalDemand(general)), note: 'first 10 kVA at 100%, the rest at 40% — 220.82(B)' });
    if (hvac) lines.push({ ...hvacLine, note: `${hvacLine.note}; taken at 100% (220.82(C) reductions not applied)` });
  }
  const total = lines.reduce((s, l) => s + l.demand, 0);
  const amps = total / 240;
  return { method, lines, total, amps, service: serviceFor(amps), typical: apps.filter((a) => a.typical), sqft };
}

export interface PanelSlot {
  /** Circuit number(s): one slot, or two on the same side for a 2-pole breaker. */
  numbers: number[];
  circuit: Circuit;
  /** VA on each leg. */
  a: number;
  b: number;
}

export interface PanelSchedule {
  slots: PanelSlot[];
  phaseA: number;
  phaseB: number;
  /** Spaces used (highest circuit number, rounded up to a full row). */
  spaces: number;
}

/** Leg of a slot: rows of two (1 & 2, 3 & 4 …) alternate A, B, A, B down the bus. */
export const legOf = (n: number): 'A' | 'B' => (Math.ceil(n / 2) % 2 === 1 ? 'A' : 'B');

/**
 * Number the circuits and balance the legs: 2-pole breakers first (they load both
 * legs equally) down the left then right side, then 120 V circuits largest first,
 * each onto the lighter leg's next free slot.
 */
export function panelSchedule(cs: Circuit[]): PanelSchedule {
  const used = new Set<number>();
  const slots: PanelSlot[] = [];
  let A = 0;
  let B = 0;
  const two = cs.filter((c) => c.poles === 2).sort((p, q) => q.va - p.va);
  const one = cs.filter((c) => c.poles === 1).sort((p, q) => q.va - p.va);
  let side = 1;
  for (const c of two) {
    let n = side;
    while (used.has(n) || used.has(n + 2)) n += 2;
    used.add(n).add(n + 2);
    slots.push({ numbers: [n, n + 2], circuit: c, a: c.va / 2, b: c.va / 2 });
    A += c.va / 2;
    B += c.va / 2;
    side = side === 1 ? 2 : 1;
  }
  for (const c of one) {
    const want: 'A' | 'B' = A <= B ? 'A' : 'B';
    let n = 1;
    while (used.has(n) || legOf(n) !== want) n += 1;
    used.add(n);
    slots.push({ numbers: [n], circuit: c, a: want === 'A' ? c.va : 0, b: want === 'B' ? c.va : 0 });
    if (want === 'A') A += c.va;
    else B += c.va;
  }
  slots.sort((p, q) => p.numbers[0] - q.numbers[0]);
  const top = Math.max(0, ...used);
  return { slots, phaseA: Math.round(A), phaseB: Math.round(B), spaces: top + (top % 2) };
}
