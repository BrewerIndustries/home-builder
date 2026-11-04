import { clampOpeningOffset, dist, samePoint, uncoveredPieces, wallDir, wallLength } from './geometry.ts';
import { DEFAULT_FRAMING, finishedThickness, studFor, type FramingSettings, type Opening, type Outlet, type Fixture, type WallSwitch, type Counter, type Furniture, type ElectricalSettings, type Pricing, type Plant, type Site, type SiteArea, EMPTY_SITE, type Point, type Project, type Room, type Underlay, type Wall, DEFAULT_ROOF, type Roof, DEFAULT_FOUNDATION, type Foundation, type DimMode } from './types.ts';
import { joinWalls, splitWall, translatePoints } from './wallEdit.ts';
import { followWalls as followCounters } from '../calc/counters.ts';
import { followFurniture } from '../calc/furniture.ts';

// A plain reducer over Project with undo/redo. Drags dispatch one `checkpoint`
// on pointer-down and then `transient` edits, so a whole drag is one undo step.

export interface History {
  past: Project[];
  present: Project;
  future: Project[];
}

export type Action =
  | { type: 'load'; project: Project }
  | { type: 'checkpoint' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'rename'; name: string }
  | { type: 'setDimMode'; mode: DimMode }
  | { type: 'setDimFaces'; faces: 'finished' | 'framing' }
  | { type: 'setDimOffset'; id: string; offset: number; transient?: boolean }
  | { type: 'addWalls'; walls: Wall[]; room?: Room }
  | { type: 'updateWall'; id: string; patch: Partial<Omit<Wall, 'id'>> }
  | { type: 'setWallLength'; id: string; length: number }
  | { type: 'moveVertex'; from: Point; to: Point; transient?: boolean }
  /** Slide wall ends and room corners at `from` by `delta` (whole-wall drag; see wallDragPoints). */
  | { type: 'translatePoints'; from: Point[]; delta: Point; transient?: boolean }
  | { type: 'splitWall'; id: string; at: number; newId: string }
  | { type: 'joinWalls'; id: string; otherId: string }
  | { type: 'addOpening'; opening: Opening }
  | { type: 'updateOpening'; id: string; patch: Partial<Omit<Opening, 'id'>>; transient?: boolean }
  | { type: 'updateRoom'; id: string; patch: Partial<Omit<Room, 'id'>> }
  | { type: 'delete'; ids: string[] }
  | { type: 'setFraming'; patch: Partial<FramingSettings> }
  | { type: 'setRoof'; patch: Partial<Roof> }
  | { type: 'setFoundation'; patch: Partial<Foundation> }
  | { type: 'setPricing'; pricing: Pricing }
  | { type: 'setSite'; patch: Partial<Site>; transient?: boolean }
  | { type: 'addArea'; area: SiteArea }
  | { type: 'updateArea'; id: string; patch: Partial<Omit<SiteArea, 'id'>>; transient?: boolean }
  | { type: 'addPlant'; plant: Plant }
  | { type: 'updatePlant'; id: string; patch: Partial<Omit<Plant, 'id'>>; transient?: boolean }
  | { type: 'addOutlet'; outlet: Outlet }
  | { type: 'updateOutlet'; id: string; patch: Partial<Omit<Outlet, 'id'>>; transient?: boolean }
  | { type: 'replaceAutoOutlets'; outlets: Outlet[] }
  /** `linkTo`: switches that should also control the new fixture. */
  | { type: 'addFixture'; fixture: Fixture; linkTo?: string[] }
  | { type: 'updateFixture'; id: string; patch: Partial<Omit<Fixture, 'id'>>; transient?: boolean }
  | { type: 'addSwitch'; sw: WallSwitch }
  | { type: 'updateSwitch'; id: string; patch: Partial<Omit<WallSwitch, 'id'>>; transient?: boolean }
  | { type: 'replaceAutoLighting'; fixtures: Fixture[]; switches: WallSwitch[] }
  | { type: 'addCounter'; counter: Counter }
  | { type: 'addFurniture'; item: Furniture }
  | { type: 'updateFurniture'; id: string; patch: Partial<Omit<Furniture, 'id'>>; transient?: boolean }
  | { type: 'updateCounter'; id: string; patch: Partial<Omit<Counter, 'id'>>; transient?: boolean }
  | { type: 'setElectrical'; patch: Partial<ElectricalSettings> }
  | { type: 'setUnderlay'; underlay: Underlay | undefined }
  | { type: 'updateUnderlay'; patch: Partial<Underlay>; transient?: boolean };

const HISTORY_LIMIT = 200;

export function initHistory(project: Project): History {
  return { past: [], present: project, future: [] };
}

export function historyReducer(h: History, action: Action): History {
  switch (action.type) {
    case 'undo': {
      const prev = h.past.at(-1);
      return prev ? { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] } : h;
    }
    case 'redo': {
      const [next, ...rest] = h.future;
      return next ? { past: [...h.past, h.present], present: next, future: rest } : h;
    }
    case 'checkpoint':
      return push(h, h.present);
    case 'load':
      return initHistory(syncThickness(migrate(action.project)));
  }
  const reduced = projectReducer(h.present, action);
  const next = followWalls(reduced, syncThickness(reduced));
  if (next === h.present) return h;
  if ('transient' in action && action.transient) return { ...h, present: next };
  return push(h, next);
}

function push(h: History, next: Project): History {
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

/** Counters and wall-backed fixtures ride along when walls move. */
const followWalls = (prev: Project, next: Project) => followFurniture(prev, followCounters(prev, next));

export function projectReducer(p: Project, action: Action): Project {
  switch (action.type) {
    case 'rename':
      return { ...p, name: action.name };

    case 'setDimMode':
      return { ...p, dimMode: action.mode };

    case 'setDimOffset': {
      const rest = Object.fromEntries(Object.entries(p.dimOffsets ?? {}).filter(([k]) => k !== action.id));
      const dimOffsets = action.offset ? { ...rest, [action.id]: action.offset } : rest;
      return { ...p, dimOffsets: Object.keys(dimOffsets).length ? dimOffsets : undefined };
    }

    case 'setDimFaces':
      return { ...p, dimFaces: action.faces };

    case 'addWalls': {
      // Drop any stretch already covered by an existing wall, so a room drawn
      // against the outline (or a neighbour) doesn't double up the shared wall.
      const added: Wall[] = [];
      for (const w of action.walls) {
        for (const piece of uncoveredPieces(w, [...p.walls, ...added])) added.push(piece);
      }
      return {
        ...p,
        walls: [...p.walls, ...added.filter((w) => wallLength(w) > 0.5)],
        rooms: action.room ? [...p.rooms, action.room] : p.rooms,
      };
    }

    case 'updateWall':
      return followWalls(p, reclampOpenings({ ...p, walls: p.walls.map((w) => (w.id === action.id ? { ...w, ...action.patch } : w)) }));

    case 'setWallLength': {
      const w = p.walls.find((x) => x.id === action.id);
      if (!w || action.length <= 0) return p;
      const d = wallDir(w);
      const to = { x: w.a.x + d.x * action.length, y: w.a.y + d.y * action.length };
      return projectReducer(p, { type: 'moveVertex', from: w.b, to });
    }

    case 'moveVertex': {
      const { from, to } = action;
      const move = (q: Point) => (samePoint(q, from) ? { ...to } : q);
      return followWalls(p, reclampOpenings({
        ...p,
        walls: p.walls.map((w) => ({ ...w, a: move(w.a), b: move(w.b) })),
        rooms: p.rooms.map((r) => ({ ...r, points: r.points.map(move) })),
      }));
    }

    case 'translatePoints':
      return followWalls(p, reclampOpenings(translatePoints(p, action.from, action.delta)));

    case 'splitWall':
      return splitWall(p, action.id, action.at, action.newId);

    case 'joinWalls':
      return reclampOpenings(joinWalls(p, action.id, action.otherId));

    case 'addCounter':
      return { ...p, counters: [...p.counters, action.counter] };

    case 'addFurniture':
      return { ...p, furniture: [...p.furniture, action.item] };

    case 'updateFurniture':
      return { ...p, furniture: p.furniture.map((f) => (f.id === action.id ? { ...f, ...action.patch } : f)) };

    case 'updateCounter':
      return { ...p, counters: p.counters.map((c) => (c.id === action.id ? clampCutouts({ ...c, ...action.patch }) : c)) };

    case 'addOpening':
      return reclampOpenings({ ...p, openings: [...p.openings, action.opening] });

    case 'updateOpening':
      return reclampOpenings({
        ...p,
        openings: p.openings.map((o) => (o.id === action.id ? { ...o, ...action.patch } : o)),
      });

    case 'updateRoom':
      return { ...p, rooms: p.rooms.map((r) => (r.id === action.id ? { ...r, ...action.patch } : r)) };

    case 'delete': {
      const ids = new Set(action.ids);
      if (!ids.size) return p;
      const walls = p.walls.filter((w) => !ids.has(w.id));
      const wallIds = new Set(walls.map((w) => w.id));
      return {
        ...p,
        walls,
        openings: p.openings.filter((o) => !ids.has(o.id) && wallIds.has(o.wallId)),
        outlets: p.outlets.filter((o) => !ids.has(o.id) && wallIds.has(o.wallId)),
        fixtures: p.fixtures.filter((f) => !ids.has(f.id)),
        switches: p.switches.filter((s) => !ids.has(s.id) && wallIds.has(s.wallId)).map((s) => (s.controls.some((c) => ids.has(c)) ? { ...s, controls: s.controls.filter((c) => !ids.has(c)) } : s)),
        rooms: p.rooms.filter((r) => !ids.has(r.id)),
        counters: p.counters.filter((c) => !ids.has(c.id)),
        furniture: p.furniture.filter((f) => !ids.has(f.id)),
        site: p.site && {
          ...p.site,
          lot: ids.has('lot') ? undefined : p.site.lot,
          setbacks: ids.has('lot') ? [] : p.site.setbacks,
          areas: p.site.areas.filter((a) => !ids.has(a.id)),
          plants: p.site.plants.filter((x) => !ids.has(x.id)),
        },
      };
    }

    case 'setFraming':
      return { ...p, framing: { ...p.framing, ...action.patch } };

    case 'addOutlet':
      return { ...p, outlets: [...p.outlets, action.outlet] };

    case 'updateOutlet':
      return { ...p, outlets: p.outlets.map((o) => (o.id === action.id ? { ...o, ...action.patch } : o)) };

    case 'replaceAutoOutlets': {
      const outlets = [...p.outlets.filter((o) => !o.auto), ...action.outlets];
      // A switch that ran a replaced receptacle lets go of it.
      const gone = new Set(p.outlets.filter((o) => o.auto).map((o) => o.id));
      const switches = p.switches.map((s) => (s.controls.some((c) => gone.has(c)) ? { ...s, controls: s.controls.filter((c) => !gone.has(c)) } : s));
      return { ...p, outlets, switches };
    }

    case 'addFixture': {
      const link = new Set(action.linkTo ?? []);
      return {
        ...p,
        fixtures: [...p.fixtures, action.fixture],
        switches: link.size ? p.switches.map((s) => (link.has(s.id) ? { ...s, controls: [...s.controls, action.fixture.id] } : s)) : p.switches,
      };
    }

    case 'updateFixture':
      return { ...p, fixtures: p.fixtures.map((f) => (f.id === action.id ? { ...f, ...action.patch } : f)) };

    case 'addSwitch':
      return { ...p, switches: [...p.switches, action.sw] };

    case 'updateSwitch':
      return { ...p, switches: p.switches.map((s) => (s.id === action.id ? { ...s, ...action.patch } : s)) };

    case 'replaceAutoLighting': {
      const fixtures = [...p.fixtures.filter((f) => !f.auto), ...action.fixtures];
      const keep = new Set(fixtures.map((f) => f.id));
      // Hand-placed switches stay, minus links to auto fixtures that were just replaced.
      const manual = p.switches.filter((s) => !s.auto).map((s) => ({ ...s, controls: s.controls.filter((c) => keep.has(c)) }));
      return { ...p, fixtures, switches: [...manual, ...action.switches] };
    }

    case 'setElectrical':
      return { ...p, electrical: { ...p.electrical, ...action.patch } };

    case 'setSite':
      return { ...p, site: { ...site(p), ...action.patch } };

    case 'addArea':
      return { ...p, site: { ...site(p), areas: [...site(p).areas, action.area] } };

    case 'updateArea':
      return { ...p, site: { ...site(p), areas: site(p).areas.map((a) => (a.id === action.id ? { ...a, ...action.patch } : a)) } };

    case 'addPlant':
      return { ...p, site: { ...site(p), plants: [...site(p).plants, action.plant] } };

    case 'updatePlant':
      return { ...p, site: { ...site(p), plants: site(p).plants.map((x) => (x.id === action.id ? { ...x, ...action.patch } : x)) } };

    case 'setRoof':
      return { ...p, roof: { ...DEFAULT_ROOF, ...p.roof, ...action.patch } };

    case 'setFoundation':
      return { ...p, foundation: { ...DEFAULT_FOUNDATION, ...p.foundation, ...action.patch } };

    case 'setPricing':
      return { ...p, pricing: action.pricing };

    case 'setUnderlay':
      return { ...p, underlay: action.underlay };

    case 'updateUnderlay':
      return p.underlay ? { ...p, underlay: { ...p.underlay, ...action.patch } } : p;

    default:
      return p;
  }
}

function site(p: Project): Site {
  return p.site ?? EMPTY_SITE;
}

/** Fill fields added after a project was saved, so old saves keep loading. */
export function migrate(p: Project): Project {
  return {
    ...p,
    outlets: p.outlets ?? [],
    fixtures: p.fixtures ?? [],
    switches: p.switches ?? [],
    counters: p.counters ?? [],
    furniture: p.furniture ?? [],
    rooms: p.rooms.map((r) => ({ ...r, type: r.type ?? 'other' })),
    framing: { ...DEFAULT_FRAMING, ...p.framing },
    roof: { ...DEFAULT_ROOF, ...p.roof },
  };
}

/** Wall thickness follows its effective stud size; only allocate when something changed. */
export function syncThickness(p: Project): Project {
  let changed = false;
  const walls = p.walls.map((w) => {
    const t = finishedThickness(studFor(w, p.framing));
    if (t === w.thickness) return w;
    changed = true;
    return { ...w, thickness: t };
  });
  return changed ? { ...p, walls } : p;
}

/** Keep sinks and ranges inside their counter. */
function clampCutouts(c: Counter): Counter {
  const len = dist(c.a, c.b);
  return { ...c, cutouts: c.cutouts.map((k) => ({ ...k, width: Math.min(k.width, len), offset: Math.max(Math.min(k.width, len) / 2, Math.min(len - Math.min(k.width, len) / 2, k.offset)) })) };
}

/** After any geometry change, keep every opening fully on its wall. */
function reclampOpenings(p: Project): Project {
  const byId = new Map(p.walls.map((w) => [w.id, w]));
  let changed = false;
  const openings = p.openings.map((o) => {
    const w = byId.get(o.wallId);
    if (!w) return o;
    const offset = clampOpeningOffset(w, o.width, o.offset);
    if (offset === o.offset) return o;
    changed = true;
    return { ...o, offset };
  });
  const outlets = p.outlets.map((o) => {
    const w = byId.get(o.wallId);
    if (!w) return o;
    const offset = Math.max(2, Math.min(wallLength(w) - 2, o.offset));
    if (offset === o.offset) return o;
    changed = true;
    return { ...o, offset };
  });
  const switches = p.switches.map((s) => {
    const w = byId.get(s.wallId);
    if (!w) return s;
    const offset = Math.max(2, Math.min(wallLength(w) - 2, s.offset));
    if (offset === s.offset) return s;
    changed = true;
    return { ...s, offset };
  });
  return changed ? { ...p, openings, outlets, switches } : p;
}

/** Four walls (clockwise) and a room for a dragged rectangle. */
export function rectangleWalls(p1: Point, p2: Point, make: (a: Point, b: Point) => Wall): Wall[] {
  const x0 = Math.min(p1.x, p2.x);
  const x1 = Math.max(p1.x, p2.x);
  const y0 = Math.min(p1.y, p2.y);
  const y1 = Math.max(p1.y, p2.y);
  const c = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  return c.map((a, i) => make(a, c[(i + 1) % 4]));
}
