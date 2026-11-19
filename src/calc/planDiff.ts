import { dist, pointAlong, pointInPolygon, polygonArea, wallLength, wallNormal } from '../model/geometry.ts';
import { phaseOf, PHASE_LABEL } from '../model/phase.ts';
import type { Counter, Fixture, FixtureKind, Furniture, Opening, Outlet, Point, Project, Room, Wall, WallSwitch } from '../model/types.ts';
import { formatFtIn } from '../model/units.ts';
import { CUTOUT_LABEL } from './counters.ts';
import { FURNITURE } from './furniture.ts';
import { phasedMaterials } from './phasing.ts';
import { DEFAULT_PRICING, samplePrice } from './pricing.ts';
import type { MaterialLine } from './materials.ts';
import type { Pricing } from '../model/types.ts';

// What changed between two plans: every element added, removed or changed (by
// id), in words — "W3 lengthened 12' → 14' 6"", "Door D2 added in Bedroom 2" —
// and the estimate difference line by line, as a change order.

export type ChangeKind = 'added' | 'removed' | 'changed';

export interface PlanChange {
  kind: ChangeKind;
  id: string;
  /** What it is: wall, door, room… */
  what: string;
  text: string;
}

const ft = (n: number) => formatFtIn(n);
const round = (n: number) => Math.round(n * 100) / 100;
const sqft = (pts: Point[]) => Math.round(polygonArea(pts) / 144);

/** Plan tags: walls W1…, doors D1…, windows 1…, counters K1…, by position in the plan's lists. */
function tags(p: Project): Map<string, string> {
  const t = new Map<string, string>();
  p.walls.forEach((w, i) => t.set(w.id, `W${i + 1}`));
  p.openings.filter((o) => o.kind === 'door').forEach((o, i) => t.set(o.id, `Door D${i + 1}`));
  p.openings.filter((o) => o.kind === 'window').forEach((o, i) => t.set(o.id, `Window ${i + 1}`));
  p.counters.forEach((c, i) => t.set(c.id, `Counter K${i + 1}`));
  return t;
}

function roomsAt(p: Project, pts: Point[]): string[] {
  const names = new Set<string>();
  for (const q of pts) for (const r of p.rooms) if (pointInPolygon(q, r.points)) names.add(r.name);
  return [...names];
}

function where(names: string[], fallback = ''): string {
  if (!names.length) return fallback;
  return names.length === 1 ? ` in ${names[0]}` : ` between ${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** Points just off either face of a wall at `offset`, for "which room is this in". */
function faces(w: Wall, offset: number, side?: 1 | -1): Point[] {
  const c = pointAlong(w, offset);
  const n = wallNormal(w);
  const d = w.thickness / 2 + 3;
  return (side ? [side] : [1, -1]).map((s) => ({ x: c.x + n.x * d * s, y: c.y + n.y * d * s }));
}

const FIXTURE_NAME: Record<FixtureKind, string> = { light: 'Ceiling light', fan: 'Ceiling fan', outdoor: 'Exterior light', smoke: 'Smoke alarm', 'smoke-co': 'Smoke / CO alarm', co: 'CO alarm' };
const OUTLET_NAME: Record<Outlet['kind'], string> = { duplex: 'Receptacle', gfci: 'GFCI receptacle', dedicated: 'Dedicated receptacle', '240v': '240V receptacle' };

interface Ctx {
  p: Project;
  walls: Map<string, Wall>;
  tag: Map<string, string>;
}

function ctx(p: Project): Ctx {
  return { p, walls: new Map(p.walls.map((w) => [w.id, w])), tag: tags(p) };
}

type Describe<T> = {
  what: string;
  list(p: Project): T[];
  /** Name and location, from the plan it's in. */
  name(x: T, c: Ctx): string;
  loc(x: T, c: Ctx): string;
  summary?(x: T, c: Ctx): string;
  /** Changes between two states of the same element, in words. */
  changes(a: T, b: T, ca: Ctx, cb: Ctx): string[];
};

const moved = (a: Point, b: Point) => (dist(a, b) > 0.5 ? [`moved ${ft(dist(a, b))}`] : []);

const WALLS: Describe<Wall> = {
  what: 'wall',
  list: (p) => p.walls,
  name: (w, c) => c.tag.get(w.id)!,
  loc: () => '',
  summary: (w) => ` (${w.kind}, ${ft(wallLength(w))})`,
  changes(a, b) {
    const out: string[] = [];
    const [la, lb] = [wallLength(a), wallLength(b)];
    if (Math.abs(la - lb) > 0.01) out.push(`${lb > la ? 'lengthened' : 'shortened'} ${ft(la)} → ${ft(lb)}`);
    else {
      const mid = (w: Wall) => ({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 });
      out.push(...moved(mid(a), mid(b)));
    }
    if (a.kind !== b.kind) out.push(`${a.kind} → ${b.kind}`);
    if (Math.abs(a.height - b.height) > 0.01) out.push(`height ${ft(a.height)} → ${ft(b.height)}`);
    if (a.stud !== b.stud) out.push(`studs ${a.stud ?? 'default'} → ${b.stud ?? 'default'}`);
    if (JSON.stringify(a.assembly) !== JSON.stringify(b.assembly)) out.push('layers changed');
    return out;
  },
};

const OPENINGS: Describe<Opening> = {
  what: 'opening',
  list: (p) => p.openings,
  name: (o, c) => c.tag.get(o.id)!,
  loc(o, c) {
    const w = c.walls.get(o.wallId);
    return w ? where(roomsAt(c.p, faces(w, o.offset)), ` on ${c.tag.get(w.id)}`) : '';
  },
  summary: (o) => ` (${ft(o.width)} × ${ft(o.height)})`,
  changes(a, b, ca, cb) {
    const out: string[] = [];
    if (a.kind !== b.kind) out.push(`${a.kind} → ${b.kind}`);
    if (Math.abs(a.width - b.width) > 0.01) out.push(`${b.width > a.width ? 'widened' : 'narrowed'} ${ft(a.width)} → ${ft(b.width)}`);
    if (Math.abs(a.height - b.height) > 0.01) out.push(`height ${ft(a.height)} → ${ft(b.height)}`);
    if (Math.abs(a.sill - b.sill) > 0.01) out.push(`sill ${ft(a.sill)} → ${ft(b.sill)}`);
    if (a.wallId !== b.wallId) out.push(`moved to ${cb.tag.get(b.wallId) ?? 'another wall'}${OPENINGS.loc(b, cb)}`);
    else {
      const [wa, wb] = [ca.walls.get(a.wallId), cb.walls.get(b.wallId)];
      if (wa && wb) out.push(...moved(pointAlong(wa, a.offset), pointAlong(wb, b.offset)));
    }
    if ((a.operation ?? 'swing') !== (b.operation ?? 'swing')) out.push(`${a.operation ?? 'swing'} → ${b.operation ?? 'swing'}`);
    if (a.style !== b.style) out.push(`${a.style ?? 'unset'} → ${b.style ?? 'unset'}`);
    if (JSON.stringify(a.swing) !== JSON.stringify(b.swing)) out.push('swing flipped');
    return out;
  },
};

const ROOMS: Describe<Room> = {
  what: 'room',
  list: (p) => p.rooms,
  name: (r) => `Room "${r.name}"`,
  loc: () => '',
  summary: (r) => ` (${sqft(r.points)} sq ft)`,
  changes(a, b) {
    const out: string[] = [];
    if (a.name !== b.name) out.push(`renamed "${a.name}" → "${b.name}"`);
    if (a.type !== b.type) out.push(`type ${a.type} → ${b.type}`);
    const [sa, sb] = [sqft(a.points), sqft(b.points)];
    if (sa !== sb) out.push(`${sb > sa ? 'grew' : 'shrank'} ${sa} → ${sb} sq ft`);
    else if (JSON.stringify(a.points) !== JSON.stringify(b.points)) out.push('reshaped or moved');
    if (JSON.stringify(a.ceiling) !== JSON.stringify(b.ceiling)) out.push(`ceiling ${a.ceiling?.type ?? 'flat'} → ${b.ceiling?.type ?? 'flat'}`);
    return out;
  },
};

function wallDevice<T extends Outlet | WallSwitch>(what: string, name: (x: T) => string): Describe<T> {
  return {
    what,
    list: (p) => (what === 'switch' ? p.switches : p.outlets) as T[],
    name: (x) => name(x),
    loc(x, c) {
      const w = c.walls.get(x.wallId);
      return w ? where(roomsAt(c.p, faces(w, x.offset, x.side)), ` on ${c.tag.get(w.id)}`) : '';
    },
    changes(a, b, ca, cb) {
      const out: string[] = [];
      if (name(a) !== name(b)) out.push(`${name(a)} → ${name(b)}`);
      const [wa, wb] = [ca.walls.get(a.wallId), cb.walls.get(b.wallId)];
      if (a.wallId !== b.wallId) out.push(`moved to ${cb.tag.get(b.wallId) ?? 'another wall'}`);
      else if (wa && wb) out.push(...moved(pointAlong(wa, a.offset), pointAlong(wb, b.offset)));
      if (a.side !== b.side) out.push('to the other face');
      if (Math.abs(a.height - b.height) > 0.01) out.push(`height ${ft(a.height)} → ${ft(b.height)}`);
      if ('controls' in a && 'controls' in b && [...a.controls].sort().join() !== [...b.controls].sort().join()) out.push('controls changed');
      return out;
    },
  };
}

const OUTLETS = wallDevice<Outlet>('receptacle', (o) => OUTLET_NAME[o.kind]);
const SWITCHES = wallDevice<WallSwitch>('switch', () => 'Switch');

const FIXTURES: Describe<Fixture> = {
  what: 'light / alarm',
  list: (p) => p.fixtures,
  name: (f) => FIXTURE_NAME[f.kind],
  loc: (f, c) => where(roomsAt(c.p, [f.at])),
  changes(a, b) {
    const out: string[] = [];
    if (a.kind !== b.kind) out.push(`${FIXTURE_NAME[a.kind]} → ${FIXTURE_NAME[b.kind]}`);
    out.push(...moved(a.at, b.at));
    if ((a.lightKit ?? true) !== (b.lightKit ?? true)) out.push(b.lightKit === false ? 'light kit removed' : 'light kit added');
    return out;
  },
};

const COUNTERS: Describe<Counter> = {
  what: 'counter',
  list: (p) => p.counters,
  name: (k, c) => c.tag.get(k.id)!,
  loc: (k, c) => where(roomsAt(c.p, [{ x: (k.a.x + k.b.x) / 2, y: (k.a.y + k.b.y) / 2 }])),
  summary: (k) => ` (${k.island ? 'island, ' : ''}${ft(dist(k.a, k.b))})`,
  changes(a, b) {
    const out: string[] = [];
    const [la, lb] = [dist(a.a, a.b), dist(b.a, b.b)];
    if (Math.abs(la - lb) > 0.01) out.push(`${lb > la ? 'lengthened' : 'shortened'} ${ft(la)} → ${ft(lb)}`);
    else out.push(...moved(a.a, b.a));
    if (Math.abs(a.depth - b.depth) > 0.01) out.push(`depth ${ft(a.depth)} → ${ft(b.depth)}`);
    const cuts = (c: Counter) => new Map(c.cutouts.map((k) => [k.id, k]));
    const [ka, kb] = [cuts(a), cuts(b)];
    for (const [id, k] of kb) if (!ka.has(id)) out.push(`${CUTOUT_LABEL[k.kind].toLowerCase()} added`);
    for (const [id, k] of ka) if (!kb.has(id)) out.push(`${CUTOUT_LABEL[k.kind].toLowerCase()} removed`);
    for (const [id, k] of kb) {
      const was = ka.get(id);
      if (was && JSON.stringify(was) !== JSON.stringify(k)) out.push(`${CUTOUT_LABEL[k.kind].toLowerCase()} changed`);
    }
    const rest = (c: Counter) => JSON.stringify({ ...c, a: 0, b: 0, depth: 0, cutouts: 0 });
    if (rest(a) !== rest(b)) out.push('cabinets / options changed');
    return out;
  },
};

const FURN: Describe<Furniture> = {
  what: 'fixture / furniture',
  list: (p) => p.furniture,
  name: (f) => FURNITURE[f.kind]?.label ?? f.kind,
  loc: (f, c) => where(roomsAt(c.p, [f.at])),
  changes(a, b) {
    const out: string[] = [];
    if (a.kind !== b.kind) out.push(`${FURN.name(a, null!)} → ${FURN.name(b, null!)}`);
    out.push(...moved(a.at, b.at));
    if (a.rot !== b.rot) out.push(`turned ${a.rot}° → ${b.rot}°`);
    if (a.w !== b.w || a.d !== b.d) out.push(`resized ${ft(a.w)} × ${ft(a.d)} → ${ft(b.w)} × ${ft(b.d)}`);
    if (a.model !== b.model) out.push(`model ${a.model ?? '—'} → ${b.model ?? '—'}`);
    const rest = (f: Furniture) => JSON.stringify({ ...f, kind: 0, at: 0, rot: 0, w: 0, d: 0, model: 0 });
    if (rest(a) !== rest(b)) out.push('options changed');
    return out;
  },
};

const KINDS = [WALLS, ROOMS, OPENINGS, COUNTERS, FURN, OUTLETS, SWITCHES, FIXTURES] as Describe<{ id: string }>[];

/** Ignore fields that are derived (a wall's drawn thickness follows its layers). */
const same = (a: object, b: object) => JSON.stringify({ ...a, thickness: 0 }) === JSON.stringify({ ...b, thickness: 0 });

const PHASE_WORD = { existing: 'marked existing', demo: 'marked for demolition', new: 'marked new work' } as const;

export function diffPlans(before: Project, after: Project): PlanChange[] {
  const [ca, cb] = [ctx(before), ctx(after)];
  const out: PlanChange[] = [];
  for (const k of KINDS) {
    const was = new Map(k.list(before).map((x) => [x.id, x]));
    const now = new Map(k.list(after).map((x) => [x.id, x]));
    for (const [id, x] of now) {
      const old = was.get(id);
      if (!old) {
        const ph = phaseOf(after, id);
        out.push({ kind: 'added', id, what: k.what, text: `${k.name(x, cb)} added${k.loc(x, cb)}${k.summary?.(x, cb) ?? ''}${ph === 'new' ? '' : ` (${PHASE_LABEL[ph].toLowerCase()})`}` });
        continue;
      }
      const words = same(old, x) ? [] : k.changes(old, x, ca, cb);
      if (!same(old, x) && !words.length) words.push('edited');
      const [pa, pb] = [phaseOf(before, id), phaseOf(after, id)];
      if (pa !== pb) words.push(PHASE_WORD[pb]);
      if (words.length) out.push({ kind: 'changed', id, what: k.what, text: `${k.name(x, cb)}${k.loc(x, cb)} ${words.join(', ')}` });
    }
    for (const [id, x] of was) if (!now.has(id)) out.push({ kind: 'removed', id, what: k.what, text: `${k.name(x, ca)} removed${k.loc(x, ca)}${k.summary?.(x, ca) ?? ''}` });
  }
  out.push(...settingChanges(before, after));
  return out;
}

const SETTINGS: [keyof Project, string][] = [
  ['framing', 'Framing'],
  ['assemblies', 'Wall layers'],
  ['roof', 'Roof'],
  ['foundation', 'Foundation'],
  ['electrical', 'Electrical settings'],
  ['site', 'Site'],
];

/** Whole-house settings, key by key ("Roof: pitch 6 → 8"). */
function settingChanges(before: Project, after: Project): PlanChange[] {
  const out: PlanChange[] = [];
  for (const [key, label] of SETTINGS) {
    const [a, b] = [(before[key] ?? {}) as Record<string, unknown>, (after[key] ?? {}) as Record<string, unknown>];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    const words = keys.map((k) => {
      const simple = (v: unknown) => v === undefined || ['string', 'number', 'boolean'].includes(typeof v);
      return simple(a[k]) && simple(b[k]) ? `${k} ${String(a[k] ?? '—')} → ${String(b[k] ?? '—')}` : `${k} changed`;
    });
    out.push({ kind: 'changed', id: key, what: 'setting', text: `${label}: ${words.join(', ')}` });
  }
  return out;
}

export interface ChangeOrderLine {
  category: MaterialLine['category'];
  item: string;
  unit: string;
  before: number;
  after: number;
  unitPrice: number;
  /** after − before, money. */
  delta: number;
}

export interface ChangeOrder {
  lines: ChangeOrderLine[];
  before: { subtotal: number; total: number };
  after: { subtotal: number; total: number };
  subtotal: number;
  tax: number;
  markup: number;
  total: number;
}

/** The estimate difference between two plans, line by line, priced with one price list (the current project's) so only the plan's changes show. */
export function changeOrder(before: Project, after: Project, pricing: Pricing = after.pricing ?? DEFAULT_PRICING): ChangeOrder {
  const qty = (p: Project) => {
    const m = new Map<string, { l: MaterialLine; qty: number }>();
    for (const l of phasedMaterials(p)) {
      const k = `${l.category}|${l.item}`;
      const cur = m.get(k);
      if (cur) cur.qty += l.qty;
      else m.set(k, { l, qty: l.qty });
    }
    return m;
  };
  const [qa, qb] = [qty(before), qty(after)];
  const price = (item: string) => (item in pricing.prices ? pricing.prices[item] : samplePrice(item));
  const lines: ChangeOrderLine[] = [];
  let [sa, sb] = [0, 0];
  for (const k of new Set([...qb.keys(), ...qa.keys()])) {
    const l = (qb.get(k) ?? qa.get(k))!.l;
    const [a, b] = [round(qa.get(k)?.qty ?? 0), round(qb.get(k)?.qty ?? 0)];
    const unitPrice = price(l.item);
    sa += round(a * unitPrice);
    sb += round(b * unitPrice);
    if (a !== b) lines.push({ category: l.category, item: l.item, unit: l.unit, before: a, after: b, unitPrice, delta: round(round(b * unitPrice) - round(a * unitPrice)) });
  }
  const subtotal = round(sb - sa);
  const tax = round(subtotal * pricing.tax);
  const markup = round(subtotal * pricing.markup);
  const total = (s: number) => round(s + round(s * pricing.tax) + round(s * pricing.markup));
  return { lines, before: { subtotal: round(sa), total: total(round(sa)) }, after: { subtotal: round(sb), total: total(round(sb)) }, subtotal, tax, markup, total: round(subtotal + tax + markup) };
}
