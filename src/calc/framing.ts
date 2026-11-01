import { samePoint, projectOnWall, wallLength } from '../model/geometry.ts';
import { studFor, type LumberSize, type Opening, type Project, type Wall } from '../model/types.ts';

// Wall framing takeoff, derived from the plan. Conventional platform framing:
// single bottom plate, double top plate, studs on a fixed layout from wall.a,
// king + jack studs and a doubled header at every opening, cripples above the
// header and below window sills, 3-stud corners and ladder backing at tees.
//
// This is an ESTIMATING model, not engineering. Layout follows IRC R602
// conventions (double top plate R602.3.2, king/jack studs R602.7.5), but header
// sizes come from a rule-of-thumb for a single-storey bearing wall — NOT from IRC
// Table R602.7(1), which also depends on ground snow load and building width.
// The IRC checks (src/calc/irc.ts) remind the user of that on every plan.

export const PLATE_THICKNESS = 1.5;
/** Single bottom + double top. */
export const PLATES_TOTAL = PLATE_THICKNESS * 3;

export type HeaderSize = '2x4' | '2x6' | '2x8' | '2x10' | '2x12' | 'LVL';

/** Actual (dressed) depth of each header size, inches. LVL assumed 11-7/8. */
export const HEADER_DEPTH: Record<HeaderSize, number> = {
  '2x4': 3.5,
  '2x6': 5.5,
  '2x8': 7.25,
  '2x10': 9.25,
  '2x12': 11.25,
  LVL: 11.875,
};

export interface HeaderPiece {
  openingId: string;
  size: HeaderSize;
  plies: number;
  /** Length of each ply. */
  length: number;
}

export type MemberKind = 'plate' | 'common' | 'corner' | 'king' | 'jack' | 'cripple' | 'header' | 'sill';

/**
 * One framing member in wall elevation: x along the wall from wall.a, y up from the
 * underside of the bottom plate. Studs are drawn on their 1-1/2" face.
 */
export interface Member {
  kind: MemberKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WallFraming {
  wallId: string;
  kind: Wall['kind'];
  length: number;
  height: number;
  studSize: LumberSize;
  /** Cut length of a full-height stud. */
  studLength: number;
  common: number;
  /** Extra studs for corners (3-stud corners) and tee backing. */
  corner: number;
  king: number;
  jack: number;
  cripple: number;
  /** Linear inches of plate stock: bottom + 2 × top, plus flat window sills. */
  plateLength: number;
  headers: HeaderPiece[];
  /** Every member, for the elevation drawing. Counts above are derived from this. */
  members: Member[];
  /** Rough openings in elevation, for drawing. */
  openings: { id: string; kind: Opening['kind']; x: number; y: number; w: number; h: number }[];
  notes: string[];
}

export interface FramingTakeoff {
  walls: WallFraming[];
  totals: {
    studs: number;
    byStudSize: Partial<Record<LumberSize, { studs: number; plateLength: number }>>;
    headerLength: Partial<Record<HeaderSize, number>>;
  };
}

/** Rough opening — what the framer leaves for the unit to slide into. */
export function roughOpening(o: Opening): { width: number; height: number } {
  return o.kind === 'door' ? { width: o.width + 2, height: o.height + 2.5 } : { width: o.width + 0.5, height: o.height + 0.5 };
}

/** Rule-of-thumb header for a single-storey bearing wall by rough-opening width. */
export function headerSizeFor(roWidth: number, bearing: boolean): HeaderSize {
  if (!bearing) return roWidth <= 48 ? '2x4' : roWidth <= 72 ? '2x6' : '2x8';
  if (roWidth <= 36) return '2x6';
  if (roWidth <= 48) return '2x8';
  if (roWidth <= 72) return '2x10';
  if (roWidth <= 96) return '2x12';
  return 'LVL';
}

/** Stud centre positions measured from wall.a: layout marks plus the closing end stud. */
export function studLayout(length: number, spacing: number): number[] {
  const half = PLATE_THICKNESS / 2;
  if (length <= PLATE_THICKNESS) return [length / 2];
  const marks = [half];
  for (let x = spacing; x < length - half - 0.5; x += spacing) marks.push(x);
  marks.push(length - half);
  return marks;
}

export function frameWall(wall: Wall, project: Project): WallFraming {
  const { framing } = project;
  const length = wallLength(wall);
  const height = wall.height;
  const studSize = studFor(wall, framing);
  const studLength = height - PLATES_TOTAL;
  const bearing = wall.kind === 'exterior';
  const notes: string[] = [];

  const T = PLATE_THICKNESS;
  const members: Member[] = [];
  const stud = (kind: MemberKind, x: number, y = T, h = studLength) => members.push({ kind, x: x - T / 2, y, w: T, h });

  // Plates: one bottom, two top. (The bottom plate is cut out at doors on site; it's still bought.)
  members.push({ kind: 'plate', x: 0, y: 0, w: length, h: T });
  members.push({ kind: 'plate', x: 0, y: height - 2 * T, w: length, h: T });
  members.push({ kind: 'plate', x: 0, y: height - T, w: length, h: T });

  const layout = studLayout(length, framing.studSpacing);
  const removed = new Set<number>();
  let sillLength = 0;
  const headers: HeaderPiece[] = [];
  const roRects: WallFraming['openings'] = [];

  const openings = project.openings.filter((o) => o.wallId === wall.id).sort((p, q) => p.offset - q.offset);
  for (const o of openings) {
    const ro = roughOpening(o);
    const jacksPerSide = ro.width > 72 ? 2 : 1;
    const start = o.offset - ro.width / 2;
    const end = o.offset + ro.width / 2;
    // Layout studs that land inside the opening (or where its kings/jacks go) are
    // dropped; the ones inside the rough opening come back as cripples.
    const framedStart = start - T * (jacksPerSide + 1);
    const framedEnd = end + T * (jacksPerSide + 1);
    const inside: number[] = [];
    layout.forEach((x, i) => {
      if (x > framedStart && x < framedEnd) removed.add(i);
      if (x > start && x < end) inside.push(x);
    });
    // At least `min` cripples; fall back to even spacing across the opening.
    const cripplesAt = (min: number) =>
      inside.length >= min ? inside : Array.from({ length: min }, (_, i) => start + T / 2 + ((ro.width - T) * (min === 1 ? 0.5 : i / (min - 1))));

    const roBottom = o.kind === 'door' ? 0 : o.sill;
    const roTop = roBottom + ro.height;
    roRects.push({ id: o.id, kind: o.kind, x: start, y: roBottom, w: ro.width, h: ro.height });

    for (let j = 0; j < jacksPerSide; j++) {
      stud('jack', start - T * (j + 0.5), T, roTop - T);
      stud('jack', end + T * (j + 0.5), T, roTop - T);
    }
    stud('king', start - T * (jacksPerSide + 0.5));
    stud('king', end + T * (jacksPerSide + 0.5));

    const size = headerSizeFor(ro.width, bearing);
    if (size === 'LVL') notes.push(`${o.kind} ${Math.round(o.width)}" wide: header needs an engineered (LVL) span check`);
    const headerLen = ro.width + 2 * T * jacksPerSide;
    headers.push({ openingId: o.id, size, plies: 2, length: headerLen });
    members.push({ kind: 'header', x: start - T * jacksPerSide, y: roTop, w: headerLen, h: HEADER_DEPTH[size] });

    const headerTop = roTop + HEADER_DEPTH[size];
    const plateUnderside = height - 2 * T;
    if (headerTop > plateUnderside + 0.01) {
      notes.push(`${o.kind} at ${Math.round(o.offset)}": header top (${(headerTop - T).toFixed(1)}") is above the top plate — lower the unit or raise the wall`);
    } else if (plateUnderside - headerTop >= 2) {
      for (const x of cripplesAt(1)) stud('cripple', x, headerTop, plateUnderside - headerTop);
    }
    if (o.kind === 'window') {
      sillLength += ro.width;
      members.push({ kind: 'sill', x: start, y: roBottom - T, w: ro.width, h: T });
      if (o.sill >= 3) for (const x of cripplesAt(2)) stud('cripple', x, T, roBottom - 2 * T);
    }
  }

  layout.forEach((x, i) => {
    if (!removed.has(i)) stud('common', x);
  });

  // Corners: at a vertex shared by n walls, add n-1 backer studs, booked to the
  // first wall there (by id) so each corner is counted once. Tees: a wall that
  // dies into the middle of this one needs ladder backing — 2 studs here.
  [wall.a, wall.b].forEach((end, e) => {
    const atVertex = project.walls.filter((w) => samePoint(w.a, end) || samePoint(w.b, end));
    if (atVertex.length > 1 && [...atVertex].sort((p, q) => p.id.localeCompare(q.id))[0].id === wall.id) {
      for (let k = 1; k < atVertex.length; k++) stud('corner', e === 0 ? T * (k + 0.5) : length - T * (k + 0.5));
    }
  });
  for (const other of project.walls) {
    if (other.id === wall.id) continue;
    for (const end of [other.a, other.b]) {
      const { along, perp } = projectOnWall(wall, end);
      if (perp < 1 && along > T && along < length - T) {
        const half = other.thickness / 2;
        stud('corner', along - half - T / 2);
        stud('corner', along + half + T / 2);
      }
    }
  }

  const count = (k: MemberKind) => members.filter((m) => m.kind === k).length;
  const common = count('common');
  const corner = count('corner');
  const king = count('king');
  const jack = count('jack');
  const cripple = count('cripple');

  return {
    wallId: wall.id,
    kind: wall.kind,
    length,
    height,
    studSize,
    studLength,
    common,
    corner,
    king,
    jack,
    cripple,
    plateLength: length * 3 + sillLength,
    headers,
    members,
    openings: roRects,
    notes,
  };
}

export function framingTakeoff(project: Project): FramingTakeoff {
  const walls = project.walls.map((w) => frameWall(w, project));
  const byStudSize: FramingTakeoff['totals']['byStudSize'] = {};
  const headerLength: FramingTakeoff['totals']['headerLength'] = {};
  let studs = 0;
  for (const f of walls) {
    const n = studCount(f);
    studs += n;
    const t = (byStudSize[f.studSize] ??= { studs: 0, plateLength: 0 });
    t.studs += n;
    t.plateLength += f.plateLength;
    for (const h of f.headers) headerLength[h.size] = (headerLength[h.size] ?? 0) + h.length * h.plies;
  }
  return { walls, totals: { studs, byStudSize, headerLength } };
}

export function studCount(f: WallFraming): number {
  return f.common + f.corner + f.king + f.jack + f.cripple;
}
