import { pointAlong, polygonArea, wallDir, wallLength } from '../model/geometry.ts';
import type { Point, Project, Room } from '../model/types.ts';
import { ceilingInfo } from './ceilings.ts';
import { FURNITURE, isFixture } from './furniture.ts';
import { clipHalfPlane, slopeFrame, triangulate } from './outline.ts';
import { childRooms } from './regions.ts';
import { roofFaces } from './roof.ts';
import { COUNTER_HEIGHT, counterDir, counterLength, counterPoint, FRIDGE_HEIGHT, UPPER_BOTTOM, UPPER_DEPTH, UPPER_TOP, upperSpans } from './counters.ts';

// 3D description of the plan, independent of three.js so it can be tested.
// Axes: plan x → X, plan y → Z, height → Y (up). Inches throughout.

export type V3 = [number, number, number];

/** Axis-aligned-in-wall-space box: a wall piece or a coffer beam. */
export interface Box {
  kind: 'wall-ext' | 'wall-int' | 'beam' | 'glass' | 'counter' | 'fixture' | 'furniture';
  /** Centre. */
  c: V3;
  /** Size along the wall, height, thickness. */
  size: V3;
  /** Rotation about Y, radians. */
  rotY: number;
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
    const kind = w.kind === 'exterior' ? 'wall-ext' : 'wall-int';
    const piece = (from: number, to: number, y0: number, y1: number) => {
      if (to - from < 0.1 || y1 - y0 < 0.1) return;
      const mid = pointAlong(w, (from + to) / 2);
      boxes.push({ kind, c: [mid.x, (y0 + y1) / 2, mid.y], size: [to - from, y1 - y0, w.thickness], rotY });
    };
    const ops = project.openings
      .filter((o) => o.wallId === w.id)
      .map((o) => ({ kind: o.kind, s: Math.max(0, o.offset - o.width / 2), e: Math.min(len, o.offset + o.width / 2), bottom: o.kind === 'door' ? 0 : o.sill, top: (o.kind === 'door' ? 0 : o.sill) + o.height }))
      .sort((p, q) => p.s - q.s);
    let cursor = 0;
    for (const o of ops) {
      piece(cursor, o.s, 0, w.height);
      piece(o.s, o.e, 0, o.bottom);
      piece(o.s, o.e, Math.min(o.top, w.height), w.height);
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
function slopedCeiling(pts: Point[], type: 'vaulted' | 'cathedral', low: number, high: number): Face[] {
  const frame = slopeFrame(pts);
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
  const { x0, x1, y0, y1 } = bbox(room.points);
  const faces: Face[] = [];
  const boxes: Box[] = [];
  const flats: FlatSurface[] = [];

  switch (c.type) {
    case 'vaulted':
    case 'cathedral':
      faces.push(...slopedCeiling(room.points, c.type, low, info.high));
      break;
    case 'tray': {
      const depth = c.trayDepth ?? 12;
      const inset = Math.min(c.trayInset ?? 24, Math.min(x1 - x0, y1 - y0) / 2 - 6);
      const inner = [
        { x: x0 + inset, y: y0 + inset },
        { x: x1 - inset, y: y0 + inset },
        { x: x1 - inset, y: y1 - inset },
        { x: x0 + inset, y: y1 - inset },
      ];
      flats.push(flat(low, room.points, [inner]));
      flats.push(flat(low + depth, inner));
      for (let i = 0; i < 4; i++) {
        const a = inner[i];
        const b = inner[(i + 1) % 4];
        faces.push({ kind: 'ceiling', pts: [[a.x, low, a.y], [b.x, low, b.y], [b.x, low + depth, b.y], [a.x, low + depth, a.y]] });
      }
      break;
    }
    case 'coffered': {
      const spacing = Math.max(24, c.cofferSpacing ?? 48);
      const depth = c.cofferDepth ?? 8;
      flats.push(flat(low, room.points));
      const W = x1 - x0;
      const H = y1 - y0;
      for (let i = 1; i < Math.ceil(W / spacing); i++) {
        const x = x0 + (W * i) / Math.ceil(W / spacing);
        boxes.push({ kind: 'beam', c: [x, low - depth / 2, (y0 + y1) / 2], size: [5.5, depth, H], rotY: 0 });
      }
      for (let i = 1; i < Math.ceil(H / spacing); i++) {
        const y = y0 + (H * i) / Math.ceil(H / spacing);
        boxes.push({ kind: 'beam', c: [(x0 + x1) / 2, low - depth / 2, y], size: [W, depth, 5.5], rotY: 0 });
      }
      break;
    }
  }
  return { flats, faces, boxes };
}

export function buildScene(project: Project): Scene3D {
  const boxes = wallBoxes(project);
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
    const mid = counterPoint(c, len / 2, c.depth / 2);
    boxes.push({ kind: 'counter', c: [mid.x, COUNTER_HEIGHT / 2, mid.y], size: [len, COUNTER_HEIGHT, c.depth], rotY: -Math.atan2(d.y, d.x) });
    for (const [s, e] of upperSpans(project, c)) {
      const at = counterPoint(c, (s + e) / 2, UPPER_DEPTH / 2);
      boxes.push({ kind: 'counter', c: [at.x, (UPPER_BOTTOM + UPPER_TOP) / 2, at.y], size: [e - s, UPPER_TOP - UPPER_BOTTOM, UPPER_DEPTH], rotY: -Math.atan2(d.y, d.x) });
    }
    for (const k of c.cutouts.filter((x) => x.kind === 'fridge')) {
      const at = counterPoint(c, k.offset, c.depth / 2);
      boxes.push({ kind: 'counter', c: [at.x, FRIDGE_HEIGHT / 2, at.y], size: [k.width, FRIDGE_HEIGHT, c.depth], rotY: -Math.atan2(d.y, d.x) });
    }
  }
  for (const f of project.furniture) {
    const h = FURNITURE[f.kind].h;
    if (!h) continue; // stairs: plan only
    boxes.push({ kind: isFixture(f) ? 'fixture' : 'furniture', c: [f.at.x, h / 2, f.at.y], size: [f.w, h, f.d], rotY: (-f.rot * Math.PI) / 180 });
  }
  faces.push(...roofFaces(project).map((f) => ({ ...f, roofPart: true })));
  const pts = project.walls.flatMap((w) => [w.a, w.b]);
  const maxH = Math.max(0, ...project.walls.map((w) => w.height), ...faces.flatMap((f) => f.pts.map((p) => p[1])));
  const b = pts.length ? bbox(pts) : { x0: 0, x1: 0, y0: 0, y1: 0 };
  return { boxes, flats, faces, bounds: { min: [b.x0, 0, b.y0], max: [b.x1, maxH, b.y1] } };
}
