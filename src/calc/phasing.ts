import { dist, wallLength } from '../model/geometry.ts';
import { isPhased, phaseOf } from '../model/phase.ts';
import type { Project } from '../model/types.ts';
import { DEMO_ITEM } from './demolition.ts';
import { isFixture } from './furniture.ts';
import { materialsList, type MaterialLine } from './materials.ts';
import { DEFAULT_PRICING, estimate, type Estimate } from './pricing.ts';

// The estimate of a phased (remodel) project: only new work is priced, plus a
// demolition allowance per kind of thing coming out. Existing items cost nothing.
// A project with no phases goes straight through materialsList, unchanged.

export function phasedMaterials(p: Project): MaterialLine[] {
  if (!isPhased(p)) return materialsList(p);
  const isNew = (id: string) => phaseOf(p, id) === 'new';
  const newWalls = p.walls.filter((w) => isNew(w.id));
  const newWallIds = new Set(newWalls.map((w) => w.id));
  const hostIds = new Set(p.walls.filter((w) => phaseOf(p, w.id) === 'existing').map((w) => w.id));
  const onNew = <T extends { id: string; wallId: string }>(x: T) => isNew(x.id) && newWallIds.has(x.wallId);
  const inHost = <T extends { id: string; wallId: string }>(x: T) => isNew(x.id) && hostIds.has(x.wallId);

  const fixtures = p.fixtures.filter((f) => isNew(f.id));
  const outlets = p.outlets.filter(onNew);
  const keep = new Set([...fixtures, ...p.outlets].map((x) => x.id));
  const tidy = (s: Project['switches'][number]) => ({ ...s, controls: s.controls.filter((c) => keep.has(c)) });
  const base: Project = {
    ...p,
    phases: undefined,
    walls: newWalls,
    openings: p.openings.filter(onNew),
    outlets,
    switches: p.switches.filter(onNew).map(tidy),
    rooms: p.rooms.filter((r) => isNew(r.id)),
    fixtures,
    counters: p.counters.filter((c) => isNew(c.id)),
    furniture: p.furniture.filter((f) => isNew(f.id)),
  };
  let lines = materialsList(base);

  // New doors, windows and devices cut into existing walls: what they add to the
  // takeoff of those walls (the unit itself, kings / jacks / header, boxes).
  const hosted = { openings: p.openings.filter(inHost), outlets: p.outlets.filter(inHost), switches: p.switches.filter(inHost).map(tidy) };
  const n = hosted.openings.length + hosted.outlets.length + hosted.switches.length;
  if (n) {
    const withHosts: Project = { ...base, walls: [...newWalls, ...p.walls.filter((w) => hostIds.has(w.id))] };
    const withHosted: Project = {
      ...withHosts,
      openings: [...base.openings, ...hosted.openings],
      outlets: [...base.outlets, ...hosted.outlets],
      switches: [...base.switches, ...hosted.switches],
    };
    const added = lineDelta(materialsList(withHosted), materialsList(withHosts)).map((l) => ({ ...l, basis: `cut into existing walls (${n} new item${n === 1 ? '' : 's'}): ${l.basis}` }));
    lines = mergeLines(lines, added);
  }
  return [...lines, ...demolitionLines(p)];
}

export function phasedEstimate(p: Project): Estimate {
  return estimate(phasedMaterials(p), p.pricing ?? DEFAULT_PRICING);
}

const key = (l: MaterialLine) => `${l.category}|${l.item}`;

/** Lines of `more` beyond `less`: positive quantity differences only (studs a cut-in saves aren't given back). */
export function lineDelta(more: MaterialLine[], less: MaterialLine[]): MaterialLine[] {
  const had = new Map<string, number>();
  for (const l of less) had.set(key(l), (had.get(key(l)) ?? 0) + l.qty);
  const out: MaterialLine[] = [];
  for (const l of more) {
    const qty = Math.round((l.qty - (had.get(key(l)) ?? 0)) * 100) / 100;
    had.set(key(l), Math.max(0, (had.get(key(l)) ?? 0) - l.qty));
    if (qty > 0) out.push({ ...l, qty });
  }
  return out;
}

/** Add `extra` into `lines`, summing quantities of the same item. */
export function mergeLines(lines: MaterialLine[], extra: MaterialLine[]): MaterialLine[] {
  const out = lines.map((l) => ({ ...l }));
  for (const e of extra) {
    const same = out.find((l) => key(l) === key(e));
    if (same) {
      same.qty = Math.round((same.qty + e.qty) * 100) / 100;
      same.basis = `${same.basis}; + ${e.qty} ${e.basis}`;
    } else out.push(e);
  }
  return out;
}

/** One allowance line per kind of thing marked for demolition. Doors, windows and devices in a demolished wall go with it. */
export function demolitionLines(p: Project): MaterialLine[] {
  const demo = (id: string) => phaseOf(p, id) === 'demo';
  const lines: MaterialLine[] = [];
  const add = (item: string, qty: number, unit: string, basis: string) => qty > 0 && lines.push({ category: 'Demolition', item, qty, unit, basis });
  const demoWalls = p.walls.filter((w) => demo(w.id));
  const gone = new Set(demoWalls.map((w) => w.id));
  for (const kind of ['exterior', 'interior'] as const) {
    const ws = demoWalls.filter((w) => w.kind === kind);
    const lf = ws.reduce((s, w) => s + wallLength(w), 0) / 12;
    add(kind === 'exterior' ? DEMO_ITEM.extWall : DEMO_ITEM.intWall, Math.ceil(lf), 'LF', `${ws.length} wall${ws.length === 1 ? '' : 's'}, ${Math.round(lf)} LF — framing, finishes and the doors, windows and devices in them`);
  }
  const loose = <T extends { id: string; wallId: string }>(x: T) => demo(x.id) && !gone.has(x.wallId);
  const doors = p.openings.filter((o) => o.kind === 'door' && loose(o)).length;
  const windows = p.openings.filter((o) => o.kind === 'window' && loose(o)).length;
  add(DEMO_ITEM.door, doors, 'ea', 'doors removed from walls that stay (patch the opening separately)');
  add(DEMO_ITEM.window, windows, 'ea', 'windows removed from walls that stay');
  const devices = p.outlets.filter(loose).length + p.switches.filter(loose).length + p.fixtures.filter((f) => demo(f.id)).length;
  add(DEMO_ITEM.device, devices, 'ea', 'receptacles, switches, lights and alarms (make safe at the panel)');
  const counterLf = p.counters.filter((c) => demo(c.id)).reduce((s, c) => s + dist(c.a, c.b), 0) / 12;
  add(DEMO_ITEM.counter, Math.ceil(counterLf), 'LF', `${Math.round(counterLf)} LF of counter runs`);
  add(DEMO_ITEM.fixture, p.furniture.filter((f) => demo(f.id) && isFixture(f)).length, 'ea', 'disconnect, cap and remove');
  if (lines.length) add(DEMO_ITEM.haul, 1, 'ea', 'one roll-off for the demolition debris');
  return lines;
}
