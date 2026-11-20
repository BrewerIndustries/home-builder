import { defaultWallThickness } from '../model/assembly.ts';
import { polygonArea, wallLength } from '../model/geometry.ts';
import { historyReducer, initHistory, migrate, syncThickness, type Action } from '../model/store.ts';
import { GLASS_HEIGHT, GLASS_THICKNESS, uid, type Project } from '../model/types.ts';
import { saveVersion } from '../model/versions.ts';
import { houseChecks, houseMaterials } from '../calc/house.ts';
import { phasedMaterials } from '../calc/phasing.ts';
import { DEFAULT_PRICING, estimate } from '../calc/pricing.ts';
import { FURNITURE } from '../calc/furniture.ts';

// The plan engine behind the public API and MCP server (api/src/*). An AI edits
// a plan the way the app does: with the same typed actions, run through the
// same reducer, so the same rules hold (wall thickness from the assembly,
// fixtures and counters following walls, openings kept on their wall). A batch
// is all-or-nothing, and the plan as it was is kept as a version first.
//
// Pure TypeScript, no DOM: it runs in the Worker and under node --test.

/** Actions an API client may send (cosmetic dimension tweaks included; history, image and whole-project swaps not). */
export const API_ACTIONS: Record<string, string> = {
  rename: '{name} — rename the project',
  addWalls: '{walls:[{a:{x,y}, b:{x,y}, kind?:"exterior"|"interior", glass?:true, height?}], room?} — add walls (inches, y runs down the plan); id/thickness/height filled in when left out',
  updateWall: '{id, patch:{kind?, height?, stud?, glass?, a?, b?}} — change a wall',
  setWallLength: '{id, length} — set a wall\'s centreline length (moves its b end)',
  moveVertex: '{from:{x,y}, to:{x,y}} — move a wall corner (every wall meeting there follows)',
  splitWall: '{id, at, newId} — split a wall `at` inches from its a end',
  joinWalls: '{id, otherId} — join two collinear walls',
  addOpening: '{opening:{wallId, kind:"door"|"window", offset, width?, height?, sill?, operation?, style?, arch?}} — door / window / doorless opening (kind "door" + operation "open", optional arch rise) centred `offset` inches from the wall\'s a end',
  updateOpening: '{id, patch} — change a door, window or opening',
  updateRoom: '{id, patch:{name?, type?, ceiling?, wet?}} — change a room (type: bedroom|living|office|kitchen|bath|hall|garage|utility|other; wet:{drain:"linear"|"centre", tileHeight?})',
  updateRooms: '{ids, ceiling?, patch?:{type?}} — change several rooms at once',
  setRooms: '{rooms} — replace the rooms list (each {id?, name, type, points:[{x,y}...], area?})',
  delete: '{ids} — delete walls, openings, rooms, outlets, fixtures, switches, counters, furniture by id',
  setFraming: '{patch:{studSpacing?, exteriorStud?, interiorStud?, wallHeight?, waste?}} — framing defaults',
  setRoof: '{patch} — roof settings',
  setFoundation: '{patch} — foundation settings',
  setPricing: '{pricing:{prices:{[item]:unitPrice}, markup, tax}} — prices by estimate line item',
  setElectrical: '{patch} — electrical settings',
  addOutlet: '{outlet:{wallId, offset, side:1|-1, kind:"duplex"|"gfci"|"dedicated"|"240v", height?}} — receptacle',
  updateOutlet: '{id, patch}',
  addFixture: '{fixture:{kind:"light"|"fan"|"outdoor"|"smoke"|"smoke-co"|"co", at:{x,y}}}',
  updateFixture: '{id, patch}',
  addSwitch: '{sw}',
  updateSwitch: '{id, patch}',
  addCounter: '{counter}',
  updateCounter: '{id, patch}',
  addFurniture: '{item:{kind, at:{x,y}, rot?, w?, d?}} — fixtures and furniture (kind: ' + Object.keys(FURNITURE).join('|') + ')',
  updateFurniture: '{id, patch}',
  rotateRoom: '{id, deg, pivot?} — turn a room with its walls and contents',
  moveRoom: '{id, delta:{x,y}} — move a room with its walls and contents',
  mirrorRoom: '{id, axis:"x"|"y"}',
  setSite: '{patch} — site / lot settings',
  storey: '{op} — storey operations (add / switch / rename storeys)',
  stairSwitches: '{} — place 3-way switches at every stair',
};

export class ActionError extends Error {
  index: number;
  constructor(message: string, index: number) {
    super(message);
    this.index = index;
  }
}

const obj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const pt = (v: unknown) => obj(v) && Number.isFinite(v.x) && Number.isFinite(v.y);

/** Fill in what the app would (ids, wall thickness / height, door and window sizes); reject what it can't use. */
function normalise(p: Project, a: Record<string, any>, i: number): Action {
  const bad = (m: string) => new ActionError(`action ${i} (${a.type}): ${m}`, i);
  if (!(a.type in API_ACTIONS)) throw new ActionError(`action ${i}: unknown type "${a.type}" — see list_action_types`, i);
  const out: Record<string, any> = { ...a };
  delete out.transient;
  switch (a.type) {
    case 'addWalls': {
      if (!Array.isArray(a.walls) || !a.walls.length) throw bad('walls must be a non-empty array');
      out.walls = a.walls.map((w: any, k: number) => {
        if (!obj(w) || !pt(w.a) || !pt(w.b)) throw bad(`walls[${k}] needs a:{x,y} and b:{x,y}`);
        const glass = !!w.glass;
        const kind = w.kind === 'exterior' ? 'exterior' : 'interior';
        return {
          ...w,
          id: w.id ?? uid('w'),
          kind,
          ...(glass && { glass: true }),
          thickness: glass ? GLASS_THICKNESS : defaultWallThickness(p, kind),
          height: Number(w.height) > 0 ? Number(w.height) : glass ? GLASS_HEIGHT : p.framing.wallHeight,
        };
      });
      if (a.room) out.room = { id: uid('r'), type: 'other', name: '', ...a.room };
      break;
    }
    case 'addOpening': {
      const o = a.opening;
      if (!obj(o) || !p.walls.some((w) => w.id === o.wallId)) throw bad('opening.wallId must be an existing wall');
      if (!Number.isFinite(o.offset)) throw bad('opening.offset (inches from the wall\'s a end to the centre) is required');
      const kind = o.kind === 'window' ? 'window' : 'door';
      const base = kind === 'door' ? { width: 36, height: 80, sill: 0, ...(o.operation !== 'open' && { swing: { side: 1, hinge: 'a' } }) } : { width: 36, height: 48, sill: 34, style: 'single-hung' };
      out.opening = { ...base, ...o, kind, id: o.id ?? uid(kind === 'window' ? 'n' : 'd') };
      break;
    }
    case 'setRooms':
      if (!Array.isArray(a.rooms)) throw bad('rooms must be an array');
      out.rooms = a.rooms.map((r: any, k: number) => {
        if (!obj(r) || !Array.isArray(r.points) || r.points.length < 3 || !r.points.every(pt)) throw bad(`rooms[${k}] needs 3+ points`);
        return { type: 'other', name: '', ...r, id: r.id ?? uid('r') };
      });
      break;
    case 'addOutlet':
      if (!obj(a.outlet)) throw bad('outlet required');
      out.outlet = { kind: 'duplex', side: 1, height: 16, ...a.outlet, auto: false, id: a.outlet.id ?? uid('e') };
      break;
    case 'addFixture':
      if (!obj(a.fixture) || !pt(a.fixture.at)) throw bad('fixture.at {x,y} required');
      out.fixture = { kind: 'light', ...a.fixture, auto: false, id: a.fixture.id ?? uid('f') };
      break;
    case 'addFurniture': {
      const f = a.item;
      if (!obj(f) || !(f.kind in FURNITURE) || !pt(f.at)) throw bad('item needs a known kind and at {x,y}');
      const s = FURNITURE[f.kind as keyof typeof FURNITURE];
      out.item = { rot: 0, w: s.w, d: s.d, ...f, id: f.id ?? uid('u') };
      break;
    }
    case 'addCounter':
      if (!obj(a.counter)) throw bad('counter required');
      out.counter = { ...a.counter, id: a.counter.id ?? uid('c') };
      break;
    case 'addSwitch':
      if (!obj(a.sw)) throw bad('sw required');
      out.sw = { ...a.sw, id: a.sw.id ?? uid('s') };
      break;
    case 'splitWall':
      out.newId = a.newId ?? uid('w');
      break;
  }
  return out as Action;
}

const AI_VERSION = 'Before API edit';
/** API edits keep at most this many "before" versions; older ones are dropped. */
const KEEP_API_VERSIONS = 10;

export interface ApplyResult {
  project: Project;
  applied: number;
  /** The version saved before the batch (restore it to roll back). */
  versionId: string | null;
}

/** Run a batch of actions, all or nothing. The plan as it was is saved as a version first (when anything changed). */
export function applyActions(input: Project, actions: unknown[], label = 'API', now = Date.now()): ApplyResult {
  if (!Array.isArray(actions) || !actions.length) throw new ActionError('actions must be a non-empty array', -1);
  if (actions.length > 500) throw new ActionError('at most 500 actions per batch', -1);
  const start = syncThickness(migrate(input));
  let h = initHistory(start);
  actions.forEach((raw, i) => {
    if (!obj(raw) || typeof raw.type !== 'string') throw new ActionError(`action ${i}: must be an object with a "type"`, i);
    const action = normalise(h.present, raw, i);
    try {
      h = historyReducer(h, action);
    } catch (e) {
      throw new ActionError(`action ${i} (${raw.type}) failed: ${e instanceof Error ? e.message : String(e)}`, i);
    }
  });
  if (h.present === start) return { project: start, applied: actions.length, versionId: null };
  // Keep the plan as it was, then prune old API versions.
  const withVersion = saveVersion(start, `${AI_VERSION} (${label}) ${new Date(now).toISOString().slice(0, 16).replace('T', ' ')} UTC`, now);
  const version = withVersion.versions!.at(-1)!;
  const versions = withVersion.versions!;
  const api = versions.filter((v) => v.name.startsWith(AI_VERSION));
  const drop = new Set(api.slice(0, Math.max(0, api.length - KEEP_API_VERSIONS)).map((v) => v.id));
  return { project: { ...h.present, versions: versions.filter((v) => !drop.has(v.id)) }, applied: actions.length, versionId: version.id };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** A compact, AI-readable view of the plan: every element with its id and the numbers that matter. */
export function planSummary(p: Project) {
  const q = migrate(p);
  return {
    name: q.name,
    units: 'inches; plan x runs right, y runs down',
    framing: q.framing,
    storeys: q.storeys?.map((s) => ({ id: s.id, name: s.name })) ?? [],
    walls: q.walls.map((w) => ({ id: w.id, a: w.a, b: w.b, kind: w.glass ? 'glass' : w.kind, length: r1(wallLength(w)), height: w.height, thickness: r1(w.thickness) })),
    openings: q.openings.map((o) => ({
      id: o.id,
      wallId: o.wallId,
      kind: o.kind === 'door' && o.operation === 'open' ? (o.arch ? 'arched opening' : 'opening') : o.kind,
      offset: o.offset,
      width: o.width,
      height: o.height,
      ...(o.kind === 'window' && { sill: o.sill, style: o.style }),
      ...(o.operation && o.operation !== 'open' && { operation: o.operation }),
    })),
    rooms: q.rooms.map((r) => ({ id: r.id, name: r.name, type: r.type, sqft: r1(polygonArea(r.points) / 144), points: r.points, ...(r.area && { area: true }), ...(r.wet && { wet: r.wet }), ...(r.ceiling && { ceiling: r.ceiling }) })),
    furniture: q.furniture.map((f) => ({ id: f.id, kind: f.kind, at: f.at, rot: f.rot, w: f.w, d: f.d })),
    counters: q.counters.map((c) => ({ id: c.id })),
    outlets: q.outlets.map((o) => ({ id: o.id, wallId: o.wallId, offset: o.offset, side: o.side, kind: o.kind, height: o.height })),
    lights: q.fixtures.map((f) => ({ id: f.id, kind: f.kind, at: f.at })),
    versions: (q.versions ?? []).map((v) => ({ id: v.id, name: v.name, at: v.at })),
  };
}

export type ReportKind = 'estimate' | 'checks' | 'materials' | 'summary';

/** The same numbers the app's Estimate and Code check tabs show. */
export function report(p: Project, kind: ReportKind) {
  const q = syncThickness(migrate(p));
  switch (kind) {
    case 'summary':
      return planSummary(q);
    case 'materials':
      return { lines: houseMaterials(q, phasedMaterials) };
    case 'estimate': {
      const e = estimate(houseMaterials(q, phasedMaterials), q.pricing ?? DEFAULT_PRICING);
      return { ...e, lines: e.lines.map((l) => ({ category: l.category, item: l.item, qty: l.qty, unit: l.unit, unitPrice: l.unitPrice, total: l.total, basis: l.basis })) };
    }
    case 'checks': {
      const checks = houseChecks(q);
      const count = (s: string) => checks.filter((c) => c.status === s).length;
      return { counts: { fail: count('fail'), warn: count('warn'), pass: count('pass'), info: count('info') }, checks };
    }
  }
}
