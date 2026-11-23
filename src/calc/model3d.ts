import { pointAlong, polygonArea, wallDir, wallLength } from '../model/geometry.ts';
import type { Point, Project, Room } from '../model/types.ts';
import { ceilingInfo } from './ceilings.ts';
import { FURNITURE, isFixture } from './furniture.ts';
import { doorLeafBoxes } from './doors3d.ts';
import { clipHalfPlane, slopeFrame, triangulate } from './outline.ts';
import { cofferBeams, trayOutline } from './roomShape.ts';
import { childRooms } from './regions.ts';
import { roofFaces } from './roof.ts';
import { foundationScene } from './foundation3d.ts';
import { stairBoxes } from './stairs3d.ts';
import { counterDir, counterHeight, cornerUppers, counterLength, counterPoint, FRIDGE_HEIGHT, raisedDepth, seatingDepth, seatingHeight, TALL_HEIGHT, UPPER_BOTTOM, UPPER_DEPTH, upperSpans, upperTop } from './counters.ts';

// 3D description of the plan, independent of three.js so it can be tested.
// Axes: plan x → X, plan y → Z, height → Y (up). Inches throughout.

export type V3 = [number, number, number];

/** Axis-aligned-in-wall-space box: a wall piece or a coffer beam. */
export interface Box {
  kind: 'wall-ext' | 'wall-int' | 'beam' | 'glass' | 'counter' | 'fixture' | 'furniture' | 'door' | 'stair' | 'footing' | 'foundation' | 'girder' | 'rim';
  /** Centre. */
  c: V3;
  /** Size along the wall, height, thickness. */
  size: V3;
  /** Rotation about Y, radians. */
  rotY: number;
  /** A door leaf: the id of its door (the walkthrough opens and closes it). */
  door?: string;
}

/** A flat polygon (with optional holes) lying in a horizontal plane at height y. */
export interface FlatSurface {
  kind: 'floor' | 'ceiling';
  y: number;
  outline: Point[];
  holes: Point[][];
}

/** An arbitrary planar polygon in 3D (sloped ceilings, gable infill, tray bands). */
export interface Face {
  kind: 'ceiling' | 'gable' | 'roof';
  pts: V3[];
  /** Part of the roof (its surfaces and gable-end walls), not a room ceiling. */
  roofPart?: boolean;
}

export interface Scene3D {
  boxes: Box[];
  flats: FlatSurface[];
  faces: Face[];
  bounds: { min: V3; max: V3 };
}

/** Split each wall around its openings into solid pieces. */
export function wallBoxes(project: Project): Box[] {
  const boxes: Box[] = [];
  for (const w of project.walls) {
    const len = wallLength(w);
    if (len < 0.5) continue;
    const d = wallDir(w);
    const rotY = -Math.atan2(d.y, d.x);
    if (w.railing) {
      // A guard: a top rail on posts, open (glassy) infill between.
      const mid = pointAlong(w, len / 2);
      boxes.push({ kind: 'stair', c: [mid.x, w.height - 1.75, mid.y], size: [len, 3.5, 3.5], rotY });
      boxes.push({ kind: 'glass', c: [mid.x, (w.height - 3.5) / 2, mid.y], size: [len, w.height - 3.5, 0.5], rotY });
      for (let t = 0; t <= len + 0.01; t += Math.max(24, len / Math.max(1, Math.round(len / 48)))) {
        const p = pointAlong(w, Math.min(t, len));
        boxes.push({ kind: 'stair', c: [p.x, w.height / 2, p.y], size: [3.5, w.height, 3.5], rotY });
      }
      continue;
    }
    if (w.glass) {
      // A glass screen: one pane the wall's length (its door is glass too).
      const mid = pointAlong(w, len / 2);
      boxes.push({ kind: 'glass', c: [mid.x, w.height / 2, mid.y], size: [len, w.height, w.thickness], rotY });
      continue;
    }
    const kind = w.kind === 'exterior' ? 'wall-ext' : 'wall-int';
    const piece = (from: number, to: number, y0: number, y1: number) => {
      if (to - from < 0.1 || y1 - y0 < 0.1) return;
      const mid = pointAlong(w, (from + to) / 2);
      boxes.push({ kind, c: [mid.x, (y0 + y1) / 2, mid.y], size: [to - from, y1 - y0, w.thickness], rotY });
    };
    const ops = project.openings
      .filter((o) => o.wallId === w.id)
      .map((o) => ({ kind: o.kind, arch: o.kind === 'door' ? o.arch : undefined, s: Math.max(0, o.offset - o.width / 2), e: Math.min(len, o.offset + o.width / 2), bottom: o.kind === 'door' ? 0 : o.sill, top: (o.kind === 'door' ? 0 : o.sill) + o.height }))
      .sort((p, q) => p.s - q.s);
    let cursor = 0;
    for (const o of ops) {
      piece(cursor, o.s, 0, w.height);
      piece(o.s, o.e, 0, o.bottom);
      piece(o.s, o.e, Math.min(o.top, w.height), w.height);
      if (o.arch && o.e - o.s > 1) {
        // An arched opening: fill the corners under the head down to the curve (an elliptical arch), in thin slices.
        const n = 16;
        const [half, c, spring] = [(o.e - o.s) / 2, (o.s + o.e) / 2, o.top - o.arch];
        for (let k = 0; k < n; k++) {
          const x0 = o.s + ((o.e - o.s) * k) / n;
          const x1 = o.s + ((o.e - o.s) * (k + 1)) / n;
          const u = Math.min(1, Math.abs((x0 + x1) / 2 - c) / half);
          piece(x0, x1, Math.min(spring + o.arch * Math.sqrt(1 - u * u), w.height), Math.min(o.top, w.height));
        }
      }
      if (o.kind === 'window') {
        const mid = pointAlong(w, (o.s + o.e) / 2);
        boxes.push({ kind: 'glass', c: [mid.x, (o.bottom + Math.min(o.top, w.height)) / 2, mid.y], size: [o.e - o.s, Math.min(o.top, w.height) - o.bottom, 0.5], rotY });
      }
      cursor = Math.max(cursor, o.e);
    }
    piece(cursor, len, 0, w.height);
  }
  return boxes;
}

function bbox(pts: Point[]) {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

function convex(pts: Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const [a, b, c] = [pts[i], pts[(i + 1) % pts.length], pts[(i + 2) % pts.length]];
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(z) < 1e-9) continue;
    if (sign && Math.sign(z) !== sign) return false;
    sign = Math.sign(z);
  }
  return true;
}

/**
 * A vaulted or cathedral ceiling over the room's real outline: the sloped surface
 * (whole pieces where convex, else triangles), plus the wall above the low line
 * along every edge it rises over.
 */
function slopedCeiling(pts: Point[], type: 'vaulted' | 'cathedral', low: number, high: number, edge?: number): Face[] {
  const frame = slopeFrame(pts, edge);
  if (!frame || !frame.span) return [];
  const { dir, d0, span } = frame;
  const along = (p: Point) => (p.x * dir.x + p.y * dir.y - d0) / span;
  const h = (p: Point) => {
    const t = along(p);
    return low + (high - low) * (type === 'vaulted' ? t : 1 - Math.abs(2 * t - 1));
  };
  const lift = (p: Point): V3 => [p.x, h(p), p.y];
  const mid = d0 + span / 2;
  const pieces = type === 'vaulted' ? [pts] : [clipHalfPlane(pts, { x: -dir.x, y: -dir.y }, -mid), clipHalfPlane(pts, dir, mid)].filter((q) => q.length);
  const faces: Face[] = [];
  for (const q of pieces) {
    if (convex(q)) faces.push({ kind: 'ceiling', pts: q.map(lift) });
    else for (const t of triangulate(q)) faces.push({ kind: 'ceiling', pts: t.map(lift) });
  }
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const top = [a];
    const [ta, tb] = [along(a), along(b)];
    if (type === 'cathedral' && (ta - 0.5) * (tb - 0.5) < 0) {
      const k = (0.5 - ta) / (tb - ta);
      top.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
    }
    top.push(b);
    if (Math.max(...top.map(h)) - low < 0.5) continue;
    faces.push({ kind: 'gable', pts: [[a.x, low, a.y], [b.x, low, b.y], ...top.reverse().map(lift)] });
  }
  return faces;
}

/** Ceiling geometry for one room. Rooms with nested rooms get a flat ceiling with holes. */
export function roomCeiling(project: Project, room: Room): { flats: FlatSurface[]; faces: Face[]; boxes: Box[] } {
  const info = ceilingInfo(project, room);
  const c = room.ceiling ?? { type: 'flat' as const };
  const children = childRooms(project, room);
  const low = c.type === 'coffered' ? info.low + (c.cofferDepth ?? 8) : info.low;
  const flat = (y: number, outline: Point[], holes: Point[][] = []): FlatSurface => ({ kind: 'ceiling', y, outline, holes });
  if (children.length || c.type === 'flat') {
    return { flats: [flat(low, room.points, children.map((r) => r.points))], faces: [], boxes: [] };
  }
  const faces: Face[] = [];
  const boxes: Box[] = [];
  const flats: FlatSurface[] = [];

  switch (c.type) {
    case 'vaulted':
    case 'cathedral':
      faces.push(...slopedCeiling(room.points, c.type, low, info.high, c.slopeEdge));
      break;
    case 'tray': {
      // The raised centre follows the room's outline, inset all round.
      const depth = c.trayDepth ?? 12;
      const inner = trayOutline(room.points, c.trayInset ?? 24);
      if (!inner) {
        flats.push(flat(low, room.points));
        break;
      }
      flats.push(flat(low, room.points, [inner]));
      flats.push(flat(low + depth, inner));
      for (let i = 0; i < inner.length; i++) {
        const a = inner[i];
        const b = inner[(i + 1) % inner.length];
        faces.push({ kind: 'ceiling', pts: [[a.x, low, a.y], [b.x, low, b.y], [b.x, low + depth, b.y], [a.x, low + depth, a.y]] });
      }
      break;
    }
    case 'coffered': {
      const spacing = Math.max(24, c.cofferSpacing ?? 48);
      const depth = c.cofferDepth ?? 8;
      flats.push(flat(low, room.points));
      // Beam grid square to the longest edge, each beam clipped to the real outline.
      for (const { a, b } of cofferBeams(room.points, spacing)) {
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        boxes.push({ kind: 'beam', c: [(a.x + b.x) / 2, low - depth / 2, (a.y + b.y) / 2], size: [len, depth, 5.5], rotY: -Math.atan2(b.y - a.y, b.x - a.x) });
      }
      break;
    }
  }
  return { flats, faces, boxes };
}

export function buildScene(project: Project, closedDoors?: ReadonlySet<string>): Scene3D {
  const boxes = [...wallBoxes(project), ...doorLeafBoxes(project, closedDoors)];
  const flats: FlatSurface[] = [];
  const faces: Face[] = [];
  // Floors: outermost rooms only (nested rooms sit on the same slab).
  const outer = project.rooms.filter((r) => !project.rooms.some((o) => o !== r && childRooms(project, o).includes(r)));
  for (const r of outer) flats.push({ kind: 'floor', y: 0, outline: r.points, holes: [] });
  if (!project.rooms.length && project.walls.length) {
    const pts = project.walls.flatMap((w) => [w.a, w.b]);
    const { x0, x1, y0, y1 } = bbox(pts);
    flats.push({ kind: 'floor', y: 0, outline: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], holes: [] });
  }
  for (const r of project.rooms) {
    if (polygonArea(r.points) < 1) continue;
    const c = roomCeiling(project, r);
    flats.push(...c.flats);
    faces.push(...c.faces);
    boxes.push(...c.boxes);
  }
  for (const c of project.counters) {
    const len = counterLength(c);
    if (len < 0.5) continue;
    const d = counterDir(c);
    // Cabinets to the floor; a seating overhang is just the top, 1-1/2" thick.
    const knee = seatingDepth(c);
    const base = c.depth - knee;
    const mid = counterPoint(c, len / 2, base / 2);
    const h = counterHeight(c);
    boxes.push({ kind: 'counter', c: [mid.x, h / 2, mid.y], size: [len, h, base], rotY: -Math.atan2(d.y, d.x) });
    // Two-level: a riser on the cabinets' front edge carries the 42" bar ledge out over the seating.
    const ledge = raisedDepth(c) - knee;
    if (ledge > 0) {
      const riser = counterPoint(c, len / 2, base - ledge / 2);
      boxes.push({ kind: 'counter', c: [riser.x, (h + seatingHeight(c)) / 2, riser.y], size: [len, seatingHeight(c) - h, ledge], rotY: -Math.atan2(d.y, d.x) });
    }
    if (knee > 0) {
      const top = counterPoint(c, len / 2, base + knee / 2);
      boxes.push({ kind: 'counter', c: [top.x, seatingHeight(c) - 0.75, top.y], size: [len, 1.5, knee], rotY: -Math.atan2(d.y, d.x) });
    }
    const upTop = upperTop(c);
    for (const [s, e] of upperSpans(project, c)) {
      const at = counterPoint(c, (s + e) / 2, UPPER_DEPTH / 2);
      boxes.push({ kind: 'counter', c: [at.x, (UPPER_BOTTOM + upTop) / 2, at.y], size: [e - s, upTop - UPPER_BOTTOM, UPPER_DEPTH], rotY: -Math.atan2(d.y, d.x) });
    }
    for (const k of c.cutouts.filter((x) => x.kind === 'fridge' || x.kind === 'pantry' || x.kind === 'oven')) {
      const h = k.kind === 'fridge' ? FRIDGE_HEIGHT : TALL_HEIGHT;
      const at = counterPoint(c, k.offset, c.depth / 2);
      boxes.push({ kind: 'counter', c: [at.x, h / 2, at.y], size: [k.width, h, c.depth], rotY: -Math.atan2(d.y, d.x) });
    }
  }
  // Corner wall cabinets: a 24" × 12" box along each wall from the inside corner.
  for (const u of cornerUppers(project)) {
    for (const [c, t] of [[u.a, u.ta], [u.b, u.tb]] as const) {
      const d = counterDir(c);
      const at = counterPoint(c, t === 0 ? 12 : t - 12, UPPER_DEPTH / 2);
      const top = upperTop(c);
      boxes.push({ kind: 'counter', c: [at.x, (UPPER_BOTTOM + top) / 2, at.y], size: [24, top - UPPER_BOTTOM, UPPER_DEPTH], rotY: -Math.atan2(d.y, d.x) });
    }
  }
  for (const f of project.furniture) {
    // A curbless walk-in shower's floor is flush: just a sliver to show it.
    if (f.kind === 'stairs') {
      boxes.push(...stairBoxes(project, f));
      continue;
    }
    const h = f.kind === 'shower' && f.walkIn ? 0.5 : FURNITURE[f.kind].h;
    if (!h) continue;
    if (f.kind === 'closet-rod') {
      // A shelf at 5' 6" (a double hang: shelves at 7' and 3' 6", a rod under each).
      for (const y of f.closet === 'double' ? [84, 42] : [66]) boxes.push({ kind: 'furniture', c: [f.at.x, y, f.at.y], size: [f.w, 0.75, f.d], rotY: (-f.rot * Math.PI) / 180 });
      continue;
    }
    boxes.push({ kind: isFixture(f) ? 'fixture' : 'furniture', c: [f.at.x, h / 2, f.at.y], size: [f.w, h, f.d], rotY: (-f.rot * Math.PI) / 180 });
  }
  faces.push(...roofFaces(project).map((f) => ({ ...f, roofPart: true })));
  // Below the floor (y < 0); bounds stay from the floor up so the camera framing is unchanged.
  const below = foundationScene(project);
  boxes.push(...below.boxes);
  flats.push(...below.flats);
  const pts = project.walls.flatMap((w) => [w.a, w.b]);
  const maxH = Math.max(0, ...project.walls.map((w) => w.height), ...faces.flatMap((f) => f.pts.map((p) => p[1])));
  const b = pts.length ? bbox(pts) : { x0: 0, x1: 0, y0: 0, y1: 0 };
  return { boxes, flats, faces, bounds: { min: [b.x0, 0, b.y0], max: [b.x1, maxH, b.y1] } };
}
