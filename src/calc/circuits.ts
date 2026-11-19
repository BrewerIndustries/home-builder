import { pointAlong, wallNormal } from '../model/geometry.ts';
import type { ApplianceSetting, CircuitSetting, Point, Project, Room, RoomType } from '../model/types.ts';
import { counterRoom, CUTOUT_LABEL } from './counters.ts';
import { FURNITURE } from './furniture.ts';
import type { CodeCheck } from './irc.ts';
import { roomAt } from './lighting.ts';
import { outdoorOutlets } from './outdoor.ts';
import { exclusiveArea } from './regions.ts';

// Branch circuits. Every receptacle, light, alarm and fixed appliance on the plan is
// grouped onto a circuit; the user can move any device to another circuit (or a new
// one) and override a circuit's breaker, AFCI and GFCI. The grouping follows the NEC
// (which IRC Chapters 37–39 mirror):
//   210.11(C)(1)  two or more 20 A small-appliance circuits for the kitchen receptacles
//   210.52(B)(2)  … which serve no other outlets (a refrigerator's own circuit is allowed)
//   210.11(C)(2)  a 20 A laundry circuit for the laundry receptacles
//   210.11(C)(3)  a 20 A circuit for the bathroom receptacles
//   422.12        central heating equipment on its own branch circuit
//   210.12        AFCI on 120 V 15/20 A circuits feeding kitchens, living spaces, bedrooms,
//                 halls, closets, laundry areas and similar rooms (not baths, garages, outdoors)
//   210.8         GFCI for kitchen, bath, garage, laundry and outdoor receptacles; 210.8(D) the dishwasher
// Fixed appliances get dedicated circuits. Their loads are the nameplate the user types
// on the appliance; until then a TYPICAL figure is used and flagged — never a code value.
// General lighting / receptacle circuits are grouped room by room up to 600 sq ft each:
// 3 VA per sq ft (the general lighting load) × 600 = 1800 VA = 15 A × 120 V.

export type ApplianceKind = 'range' | 'oven' | 'dishwasher' | 'disposal' | 'fridge' | 'microwave' | 'washer' | 'dryer' | 'water-heater' | 'furnace' | 'air-handler';

export interface Appliance {
  /** Device id: the furniture / cutout id, or `<sink id>:disposal`, `<range id>:microwave`. */
  id: string;
  /** What to select on the plan, and where its settings live. */
  sourceId: string;
  kind: ApplianceKind;
  label: string;
  room?: Room;
  /** Nameplate VA (typical when the user hasn't entered one). */
  va: number;
  typical: boolean;
  volts: 120 | 240;
  gas: boolean;
}

/** Typical loads to start from (manufacturer data varies widely — enter the nameplate). */
export const TYPICAL: Record<ApplianceKind, { va: number; volts: 120 | 240; label: string }> = {
  range: { va: 12000, volts: 240, label: 'Range' },
  oven: { va: 5000, volts: 240, label: 'Wall oven' },
  dishwasher: { va: 1200, volts: 120, label: 'Dishwasher' },
  disposal: { va: 900, volts: 120, label: 'Disposer' },
  fridge: { va: 800, volts: 120, label: 'Refrigerator' },
  microwave: { va: 1500, volts: 120, label: 'Microwave-hood' },
  washer: { va: 1200, volts: 120, label: 'Washer' },
  dryer: { va: 5000, volts: 240, label: 'Dryer' },
  'water-heater': { va: 4500, volts: 240, label: 'Water heater' },
  furnace: { va: 10000, volts: 240, label: 'Furnace' },
  'air-handler': { va: 5000, volts: 240, label: 'Air handler' },
};
/** A gas furnace still needs its blower: a typical 120 V figure. */
const GAS_FURNACE_VA = 800;

/** Appliances that can be gas-fired instead of electric. */
export const GAS_CAPABLE: ReadonlySet<ApplianceKind> = new Set(['range', 'oven', 'dryer', 'water-heater', 'furnace']);
/** Space heating (220.60 heating side); not "fastened-in-place" under 220.53. */
export const HEATING: ReadonlySet<ApplianceKind> = new Set(['furnace', 'air-handler']);

const FURN_KIND: Partial<Record<string, ApplianceKind>> = {
  range: 'range', fridge: 'fridge', washer: 'washer', dryer: 'dryer', 'water-heater': 'water-heater', furnace: 'furnace', 'air-handler': 'air-handler',
};
const CUT_KIND: Partial<Record<string, ApplianceKind>> = { range: 'range', oven: 'oven', dishwasher: 'dishwasher', fridge: 'fridge' };

export const BREAKERS = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200];
export const breakerFor = (amps: number) => BREAKERS.find((b) => b >= amps - 1e-9) ?? BREAKERS[BREAKERS.length - 1];

const settingOf = (project: Project, id: string): ApplianceSetting => project.electrical?.appliances?.[id] ?? {};

/** Every appliance on the plan: free-standing symbols and counter cutouts, plus disposers and microwave-hoods ticked on them. */
export function appliances(project: Project): Appliance[] {
  const out: Appliance[] = [];
  const make = (id: string, sourceId: string, kind: ApplianceKind, room: Room | undefined, s: ApplianceSetting) => {
    const t = TYPICAL[kind];
    const gas = GAS_CAPABLE.has(kind) && !!s.gas;
    const typicalVa = gas ? (kind === 'furnace' ? GAS_FURNACE_VA : 0) : t.va;
    out.push({ id, sourceId, kind, label: `${gas ? 'Gas ' + t.label.toLowerCase() : t.label}`, room, va: s.va ?? typicalVa, typical: s.va === undefined, volts: gas ? 120 : t.volts, gas });
  };
  for (const f of project.furniture) {
    const s = settingOf(project, f.id);
    const room = roomAt(project, f.at);
    const kind = FURN_KIND[f.kind];
    if (kind) make(f.id, f.id, kind, room, s);
    if (f.kind === 'kitchen-sink' && s.disposal) make(`${f.id}:disposal`, f.id, 'disposal', room, settingOf(project, `${f.id}:disposal`));
    if (f.kind === 'range' && s.microwave) make(`${f.id}:microwave`, f.id, 'microwave', room, settingOf(project, `${f.id}:microwave`));
  }
  for (const c of project.counters) {
    const room = counterRoom(project, c);
    for (const k of c.cutouts) {
      const s = settingOf(project, k.id);
      const kind = CUT_KIND[k.kind];
      if (kind) make(k.id, c.id, kind, room, s);
      if (k.kind === 'sink' && s.disposal) make(`${k.id}:disposal`, c.id, 'disposal', room, settingOf(project, `${k.id}:disposal`));
      if (k.kind === 'range' && s.microwave) make(`${k.id}:microwave`, c.id, 'microwave', room, settingOf(project, `${k.id}:microwave`));
    }
  }
  return out;
}

/** Labels for the furniture / cutout kinds that carry appliance settings. */
export const applianceLabel = (kind: string) => (FURNITURE as Record<string, { label: string }>)[kind]?.label ?? (CUTOUT_LABEL as Record<string, string>)[kind] ?? kind;

export type CircuitKind = 'general' | 'small-appliance' | 'laundry' | 'bath' | 'garage' | 'outdoor' | 'appliance' | 'receptacle' | 'cooling';

export interface Circuit {
  key: string;
  kind: CircuitKind;
  label: string;
  amps: number;
  poles: 1 | 2;
  volts: 120 | 240;
  afci: boolean;
  gfci: boolean;
  afciRequired: boolean;
  gfciRequired: boolean;
  /** Device ids (outlets, fixtures, appliances). */
  devices: string[];
  receptacles: number;
  lights: number;
  /** Rooms the devices are in. */
  rooms: Room[];
  /** Load, VA: 3 VA/sq ft for general circuits, 1500 for small-appliance and laundry, nameplate for appliances; receptacle-only circuits use 180 VA per receptacle as an estimate (their load is in the 3 VA/sq ft general load). */
  va: number;
  /** Already covered by the general lighting load (not added again in the load calc). */
  inGeneralLoad: boolean;
  appliance?: Appliance;
  /** User-set fields. */
  set: CircuitSetting;
}

/** NEC 210.12 rooms (kitchens, living spaces, bedrooms, halls, laundry areas and similar). */
const AFCI_ROOMS: ReadonlySet<RoomType> = new Set(['bedroom', 'living', 'kitchen', 'hall', 'utility', 'other']);
const GFCI_ROOMS: ReadonlySet<RoomType> = new Set(['kitchen', 'bath', 'garage']);

/** Where a wall device is: a few inches off the face it's on. */
function facePoint(project: Project, wallId: string, offset: number, side: 1 | -1): Point | null {
  const w = project.walls.find((x) => x.id === wallId);
  if (!w) return null;
  const n = wallNormal(w);
  const c = pointAlong(w, offset);
  const off = (w.thickness / 2 + 4) * side;
  return { x: c.x + n.x * off, y: c.y + n.y * off };
}

interface Device {
  id: string;
  room?: Room;
  kind: 'receptacle' | 'light' | 'alarm' | 'appliance';
  outdoor?: boolean;
}

const KIND_LABEL: Record<CircuitKind, string> = {
  general: 'Lights & receptacles',
  'small-appliance': 'Kitchen small-appliance',
  laundry: 'Laundry',
  bath: 'Bathroom receptacles',
  garage: 'Garage receptacles',
  outdoor: 'Outdoor receptacles',
  appliance: 'Appliance',
  receptacle: 'Dedicated receptacle',
  cooling: 'A/C condenser',
};

/** Rooms with a washer in them: their receptacles are the laundry circuit's. */
const laundryRooms = (project: Project) => new Set(appliances(project).filter((a) => a.kind === 'washer' && a.room).map((a) => a.room!.id));

/** Branch circuits for the plan, auto-assigned then adjusted by the user's overrides. */
export function circuits(project: Project): Circuit[] {
  const apps = appliances(project);
  const outdoor = new Set(outdoorOutlets(project).map((o) => o.outlet.id));
  const laundry = laundryRooms(project);
  const byKey = new Map<string, { kind: CircuitKind; label?: string; devices: Device[]; amps: number; poles: 1 | 2; volts: 120 | 240; appliance?: Appliance; areaRooms: Room[] }>();
  const add = (key: string, kind: CircuitKind, d: Device | null, init: Partial<{ label: string; amps: number; poles: 1 | 2; volts: 120 | 240; appliance: Appliance }> = {}) => {
    let c = byKey.get(key);
    if (!c) {
      c = { kind, devices: [], amps: init.amps ?? (kind === 'general' ? 15 : 20), poles: init.poles ?? 1, volts: init.volts ?? 120, label: init.label, appliance: init.appliance, areaRooms: [] };
      byKey.set(key, c);
    }
    if (d) c.devices.push(d);
    return c;
  };

  // Kitchens: two small-appliance circuits even before receptacles are placed.
  const kitchens = project.rooms.some((r) => r.type === 'kitchen');
  if (kitchens) {
    add('sa1', 'small-appliance', null);
    add('sa2', 'small-appliance', null);
  }

  // Appliances.
  for (const a of apps) {
    const d: Device = { id: a.id, room: a.room, kind: 'appliance' };
    if (a.kind === 'washer' || (a.kind === 'dryer' && a.gas)) {
      add('laundry', 'laundry', d);
      continue;
    }
    if (a.gas && a.kind !== 'furnace') continue; // a gas range / oven / water heater's igniter or vent plugs in nearby
    const heat = HEATING.has(a.kind) || a.kind === 'water-heater';
    const raw = (a.va / a.volts) * (heat ? 1.25 : 1);
    const amps = a.volts === 120 ? (a.kind === 'furnace' ? 15 : 20) : a.kind === 'dryer' ? Math.max(30, breakerFor(raw)) : breakerFor(raw);
    add(`a:${a.id}`, 'appliance', d, { label: a.label, amps, poles: a.volts === 240 ? 2 : 1, volts: a.volts, appliance: a });
  }

  // Receptacles.
  let kitchenIx = 0;
  const general: Device[] = [];
  for (const o of project.outlets) {
    const p = facePoint(project, o.wallId, o.offset, o.side);
    if (!p) continue;
    const room = outdoor.has(o.id) ? undefined : roomAt(project, p);
    const d: Device = { id: o.id, room, kind: 'receptacle', outdoor: outdoor.has(o.id) };
    if (d.outdoor) add('outdoor', 'outdoor', d);
    else if (o.kind === '240v') add(`o:${o.id}`, 'receptacle', d, { poles: 2, volts: 240, label: `240 V receptacle${room ? ` — ${room.name || room.type}` : ''}` });
    else if (o.kind === 'dedicated') add(`o:${o.id}`, 'receptacle', d, { label: `Dedicated receptacle${room ? ` — ${room.name || room.type}` : ''}` });
    else if (room?.type === 'kitchen') add(`sa${(kitchenIx++ % 2) + 1}`, 'small-appliance', d);
    else if (room && laundry.has(room.id)) add('laundry', 'laundry', d);
    else if (room?.type === 'bath') add('bath', 'bath', d);
    else if (room?.type === 'garage') add('garage', 'garage', d);
    else general.push(d);
  }
  for (const f of project.fixtures) {
    const room = f.kind === 'outdoor' ? undefined : roomAt(project, f.at);
    general.push({ id: f.id, room, kind: f.kind === 'light' || f.kind === 'fan' || f.kind === 'outdoor' ? 'light' : 'alarm', outdoor: f.kind === 'outdoor' });
  }

  // General circuits, room by room up to 600 sq ft each (garages and the outside ride along).
  const CAP = (15 * 120) / 3; // sq ft
  let n = 0;
  let area = Infinity;
  const roomKey = new Map<string, string>();
  for (const room of project.rooms) {
    if (!general.some((d) => d.room?.id === room.id)) continue;
    const a = exclusiveArea(project, room) / 144;
    if (area + a > CAP || n === 0) {
      n += 1;
      area = 0;
    }
    area += a;
    roomKey.set(room.id, `g${n}`);
  }
  for (const d of general) {
    const key = (d.room && roomKey.get(d.room.id)) ?? 'g1';
    add(key, 'general', d);
  }
  for (const room of project.rooms) {
    const key = roomKey.get(room.id);
    if (key) byKey.get(key)!.areaRooms.push(room);
  }

  // Cooling.
  const cool = project.electrical?.coolingVA;
  if (cool && cool > 0) {
    add('ac', 'cooling', { id: 'ac', kind: 'appliance' }, { label: 'A/C condenser', amps: breakerFor((cool / 240) * 1.25), poles: 2, volts: 240 });
  }

  // The user's moves.
  const moves = project.electrical?.circuitOf ?? {};
  for (const [id, key] of Object.entries(moves)) {
    let from: string | undefined;
    for (const [k, c] of byKey) if (c.devices.some((d) => d.id === id)) from = k;
    if (!from || from === key) continue;
    const src = byKey.get(from)!;
    const d = src.devices.find((x) => x.id === id)!;
    src.devices = src.devices.filter((x) => x !== d);
    add(key, 'general', d);
  }

  const sets = project.electrical?.circuits ?? {};
  const out: Circuit[] = [];
  for (const [key, c] of byKey) {
    if (!c.devices.length && c.kind !== 'small-appliance') continue;
    const set = sets[key] ?? {};
    const rooms = [...new Map(c.devices.filter((d) => d.room).map((d) => [d.room!.id, d.room!])).values()];
    const receptacles = c.devices.filter((d) => d.kind === 'receptacle').length;
    const lights = c.devices.filter((d) => d.kind === 'light').length;
    const app = c.devices.length === 1 && c.devices[0].kind === 'appliance' ? apps.find((a) => a.id === c.devices[0].id) : undefined;
    const kinds = new Set(c.devices.map((d) => d.kind));
    // AFCI: a 120 V 15/20 A circuit feeding outlets in a listed room.
    const afciRequired = c.volts === 120 && c.devices.some((d) => !d.outdoor && d.room && AFCI_ROOMS.has(d.room.type));
    const gfciRequired =
      c.kind === 'outdoor' ||
      c.devices.some((d) => d.kind === 'receptacle' && (d.outdoor || (d.room && (GFCI_ROOMS.has(d.room.type) || laundry.has(d.room.id))))) ||
      c.devices.some((d) => apps.find((a) => a.id === d.id)?.kind === 'dishwasher');
    let va: number;
    let inGeneralLoad = false;
    if (c.kind === 'small-appliance' || c.kind === 'laundry') va = 1500;
    else if (c.kind === 'cooling') va = cool ?? 0;
    else if (app) va = app.va;
    else if (c.kind === 'general') va = Math.round(3 * c.areaRooms.filter((r) => r.type !== 'garage').reduce((s, r) => s + exclusiveArea(project, r) / 144, 0));
    else {
      va = 180 * receptacles;
      inGeneralLoad = c.kind !== 'receptacle';
    }
    const where = rooms.map((r) => r.name || r.type);
    const auto =
      c.label ??
      (c.kind === 'general'
        ? `${kinds.has('receptacle') ? (kinds.has('light') ? 'Lights & receptacles' : 'Receptacles') : kinds.has('light') ? 'Lights' : 'Alarms'}${where.length ? ` — ${where.slice(0, 3).join(', ')}${where.length > 3 ? ` +${where.length - 3}` : ''}` : c.devices.some((d) => d.outdoor) ? ' — outside' : ''}`
        : c.kind === 'small-appliance'
          ? `${KIND_LABEL[c.kind]} ${key.slice(2)}`
          : KIND_LABEL[c.kind]);
    out.push({
      key,
      kind: c.kind,
      label: set.label ?? auto,
      amps: set.amps ?? c.amps,
      poles: c.poles,
      volts: c.volts,
      afci: set.afci ?? afciRequired,
      gfci: set.gfci ?? gfciRequired,
      afciRequired,
      gfciRequired,
      devices: c.devices.map((d) => d.id),
      receptacles,
      lights,
      rooms,
      va,
      inGeneralLoad,
      appliance: app,
      set,
    });
  }
  return out;
}

/** The circuit a device is on. */
export const circuitOfDevice = (cs: Circuit[], id: string) => cs.find((c) => c.devices.includes(id));

/** Keys for a new circuit the user starts. */
export function newCircuitKey(cs: Circuit[]): string {
  let i = 1;
  while (cs.some((c) => c.key === `c${i}`)) i += 1;
  return `c${i}`;
}

export function circuitChecks(project: Project): CodeCheck[] {
  const cs = circuits(project);
  if (!cs.length) return [];
  const out: CodeCheck[] = [];
  const devRoom = new Map<string, Room | undefined>();
  const devKind = new Map<string, 'receptacle' | 'other'>();
  const outdoor = new Set(outdoorOutlets(project).map((o) => o.outlet.id));
  for (const o of project.outlets) {
    const p = facePoint(project, o.wallId, o.offset, o.side);
    devRoom.set(o.id, p && !outdoor.has(o.id) ? roomAt(project, p) : undefined);
    devKind.set(o.id, 'receptacle');
  }
  const apps = appliances(project);
  const fridge = new Set(apps.filter((a) => a.kind === 'fridge' || (a.kind === 'range' && a.gas)).map((a) => a.id));

  // Kitchen small-appliance circuits.
  const kitchenRecs = project.outlets.filter((o) => devRoom.get(o.id)?.type === 'kitchen' && o.kind !== '240v' && o.kind !== 'dedicated');
  if (project.rooms.some((r) => r.type === 'kitchen')) {
    const serving = cs.filter((c) => kitchenRecs.some((o) => c.devices.includes(o.id)));
    const sa = cs.filter((c) => c.kind === 'small-appliance');
    const count = kitchenRecs.length ? serving.length : sa.length;
    const small = serving.filter((c) => c.amps < 20);
    out.push({
      rule: 'Small-appliance circuits',
      section: 'NEC 210.11(C)(1)',
      status: count < 2 || small.length ? 'fail' : 'pass',
      message:
        count < 2
          ? `the kitchen receptacles are on ${count} circuit${count === 1 ? '' : 's'}; they need two or more 20 A circuits`
          : small.length
            ? `${small.map((c) => c.label).join(', ')} ${small.length === 1 ? 'is' : 'are'} under 20 A`
            : `${count} × 20 A circuits serve the kitchen receptacles`,
    });
    for (const c of serving) {
      const foreign = c.devices.filter((id) => !fridge.has(id) && !(devKind.get(id) === 'receptacle' && devRoom.get(id)?.type === 'kitchen'));
      if (foreign.length)
        out.push({ rule: 'Small-appliance circuits serve no other outlets', section: 'NEC 210.52(B)(2)', status: 'fail', message: `${c.label} also feeds ${foreign.length} other outlet${foreign.length === 1 ? '' : 's'} (lights, appliances or other rooms)`, targetId: foreign[0] });
    }
  }

  // Laundry.
  const laundry = laundryRooms(project);
  if (laundry.size) {
    const recs = project.outlets.filter((o) => laundry.has(devRoom.get(o.id)?.id ?? ''));
    const washers = apps.filter((a) => a.kind === 'washer').map((a) => a.id);
    const serving = cs.filter((c) => [...recs.map((o) => o.id), ...washers].some((id) => c.devices.includes(id)));
    for (const c of serving) {
      const foreign = c.devices.filter((id) => devKind.get(id) !== 'receptacle' ? !apps.some((a) => a.id === id && (a.kind === 'washer' || (a.kind === 'dryer' && a.gas))) : !laundry.has(devRoom.get(id)?.id ?? ''));
      out.push({
        rule: 'Laundry circuit',
        section: 'NEC 210.11(C)(2)',
        status: c.amps < 20 || foreign.length ? 'fail' : 'pass',
        message: c.amps < 20 ? `${c.label} is ${c.amps} A; the laundry receptacles need a 20 A circuit` : foreign.length ? `${c.label} also feeds ${foreign.length} outlet${foreign.length === 1 ? '' : 's'} outside the laundry` : `20 A, laundry outlets only`,
      });
    }
  }

  // Bathrooms.
  const bathRecs = project.outlets.filter((o) => devRoom.get(o.id)?.type === 'bath');
  for (const c of cs.filter((x) => bathRecs.some((o) => x.devices.includes(o.id)))) {
    const baths = new Set(bathRecs.filter((o) => c.devices.includes(o.id)).map((o) => devRoom.get(o.id)!.id));
    const foreign = c.devices.filter((id) => {
      const isBathRec = bathRecs.some((o) => o.id === id);
      if (isBathRec) return false;
      if (baths.size > 1) return true;
      // One bathroom: other equipment in that same bathroom is allowed.
      const fx = project.fixtures.find((f) => f.id === id);
      const r = fx ? roomAt(project, fx.at) : (devRoom.get(id) ?? apps.find((a) => a.id === id)?.room);
      return r?.id !== [...baths][0];
    });
    out.push({
      rule: 'Bathroom receptacle circuit',
      section: 'NEC 210.11(C)(3)',
      status: c.amps < 20 || foreign.length ? 'fail' : 'pass',
      message:
        c.amps < 20
          ? `${c.label} is ${c.amps} A; bathroom receptacles need a 20 A circuit`
          : foreign.length
            ? baths.size > 1
              ? `${c.label} serves ${baths.size} bathrooms, so it may feed only their receptacles — it also feeds ${foreign.length} other outlet${foreign.length === 1 ? '' : 's'}`
              : `${c.label} feeds ${foreign.length} outlet${foreign.length === 1 ? '' : 's'} outside its bathroom`
            : `20 A, ${baths.size} bathroom${baths.size === 1 ? '' : 's'}`,
    });
  }

  // Dedicated appliance circuits.
  const dedicated = cs.filter((c) => c.kind === 'appliance');
  for (const a of apps.filter((x) => HEATING.has(x.kind) && x.kind === 'furnace')) {
    const c = circuitOfDevice(cs, a.id);
    if (c && c.devices.length > 1) out.push({ rule: 'Heating equipment on its own circuit', section: 'NEC 422.12', status: 'fail', message: `the ${a.label.toLowerCase()} shares ${c.label} with ${c.devices.length - 1} other outlet${c.devices.length > 2 ? 's' : ''}`, targetId: a.sourceId });
  }
  if (dedicated.length) {
    const typical = apps.filter((a) => a.typical && a.va > 0);
    out.push({
      rule: 'Dedicated appliance circuits',
      section: 'Circuits',
      status: typical.length ? 'info' : 'pass',
      message:
        `${dedicated.map((c) => `${c.label} ${c.amps} A${c.poles === 2 ? ' 2-pole' : ''}`).join(', ')}` +
        (typical.length ? ` — ${typical.length} use${typical.length === 1 ? 's' : ''} a typical load (${typical.map((a) => a.label.toLowerCase()).join(', ')}); enter the nameplate on the appliance` : ''),
      targetId: typical[0]?.sourceId,
    });
  }

  // AFCI / GFCI turned off where needed.
  for (const c of cs) {
    if (c.afciRequired && !c.afci) out.push({ rule: 'AFCI protection', section: 'NEC 210.12', status: 'warn', message: `${c.label} feeds ${c.rooms.map((r) => r.name || r.type).join(', ') || 'living space'} but isn't marked AFCI`, targetId: c.devices[0] });
    if (c.gfciRequired && !c.gfci) out.push({ rule: 'GFCI protection', section: 'NEC 210.8', status: 'warn', message: `${c.label} isn't marked GFCI (breaker or a GFCI receptacle first on the run)`, targetId: c.devices[0] });
  }
  const afci = cs.filter((c) => c.afci).length;
  const gfci = cs.filter((c) => c.gfci).length;
  out.push({ rule: 'AFCI / GFCI circuits', section: 'NEC 210.12 / 210.8', status: 'info', message: `${afci} AFCI and ${gfci} GFCI circuit${gfci === 1 ? '' : 's'} of ${cs.length} — see the panel schedule (Electrical tab)` });
  return out;
}
