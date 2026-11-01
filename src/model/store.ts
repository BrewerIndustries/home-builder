import { clampOpeningOffset, samePoint, uncoveredPieces, wallDir, wallLength } from './geometry.ts';
import { DEFAULT_FRAMING, finishedThickness, studFor, type FramingSettings, type Opening, type Outlet, type Pricing, type Point, type Project, type Room, type Underlay, type Wall } from './types.ts';

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
  | { type: 'addWalls'; walls: Wall[]; room?: Room }
  | { type: 'updateWall'; id: string; patch: Partial<Omit<Wall, 'id'>> }
  | { type: 'setWallLength'; id: string; length: number }
  | { type: 'moveVertex'; from: Point; to: Point; transient?: boolean }
  | { type: 'addOpening'; opening: Opening }
  | { type: 'updateOpening'; id: string; patch: Partial<Omit<Opening, 'id'>>; transient?: boolean }
  | { type: 'updateRoom'; id: string; patch: Partial<Omit<Room, 'id'>> }
  | { type: 'delete'; ids: string[] }
  | { type: 'setFraming'; patch: Partial<FramingSettings> }
  | { type: 'setPricing'; pricing: Pricing }
  | { type: 'addOutlet'; outlet: Outlet }
  | { type: 'updateOutlet'; id: string; patch: Partial<Omit<Outlet, 'id'>>; transient?: boolean }
  | { type: 'replaceAutoOutlets'; outlets: Outlet[] }
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
  const next = syncThickness(projectReducer(h.present, action));
  if (next === h.present) return h;
  if ('transient' in action && action.transient) return { ...h, present: next };
  return push(h, next);
}

function push(h: History, next: Project): History {
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

export function projectReducer(p: Project, action: Action): Project {
  switch (action.type) {
    case 'rename':
      return { ...p, name: action.name };

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
      return reclampOpenings({ ...p, walls: p.walls.map((w) => (w.id === action.id ? { ...w, ...action.patch } : w)) });

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
      return reclampOpenings({
        ...p,
        walls: p.walls.map((w) => ({ ...w, a: move(w.a), b: move(w.b) })),
        rooms: p.rooms.map((r) => ({ ...r, points: r.points.map(move) })),
      });
    }

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
        rooms: p.rooms.filter((r) => !ids.has(r.id)),
      };
    }

    case 'setFraming':
      return { ...p, framing: { ...p.framing, ...action.patch } };

    case 'addOutlet':
      return { ...p, outlets: [...p.outlets, action.outlet] };

    case 'updateOutlet':
      return { ...p, outlets: p.outlets.map((o) => (o.id === action.id ? { ...o, ...action.patch } : o)) };

    case 'replaceAutoOutlets':
      return { ...p, outlets: [...p.outlets.filter((o) => !o.auto), ...action.outlets] };

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

/** Fill fields added after a project was saved, so old saves keep loading. */
export function migrate(p: Project): Project {
  return {
    ...p,
    outlets: p.outlets ?? [],
    rooms: p.rooms.map((r) => ({ ...r, type: r.type ?? 'other' })),
    framing: { ...DEFAULT_FRAMING, ...p.framing },
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
  return changed ? { ...p, openings, outlets } : p;
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
