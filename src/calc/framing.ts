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

  const layout = studLayout(length, framing.studSpacing);
  const removed = new Set<number>();
  let king = 0;
  let jack = 0;
  let cripple = 0;
  let sillLength = 0;
  const headers: HeaderPiece[] = [];

  const openings = project.openings.filter((o) => o.wallId === wall.id).sort((p, q) => p.offset - q.offset);
  for (const o of openings) {
    const ro = roughOpening(o);
    const jacksPerSide = ro.width > 72 ? 2 : 1;
    const start = o.offset - ro.width / 2;
    const end = o.offset + ro.width / 2;
    // Layout studs that land inside the opening (or where its kings/jacks go) are
    // dropped; the ones inside the rough opening come back as cripples.
    const framedStart = start - PLATE_THICKNESS * (jacksPerSide + 1);
    const framedEnd = end + PLATE_THICKNESS * (jacksPerSide + 1);
    let inside = 0;
    layout.forEach((x, i) => {
      if (x > framedStart && x < framedEnd) removed.add(i);
      if (x > start && x < end) inside += 1;
    });

    king += 2;
    jack += 2 * jacksPerSide;

    const size = headerSizeFor(ro.width, bearing);
    if (size === 'LVL') notes.push(`${o.kind} ${Math.round(o.width)}" wide: header needs an engineered (LVL) span check`);
    headers.push({ openingId: o.id, size, plies: 2, length: ro.width + 2 * PLATE_THICKNESS * jacksPerSide });

    const headerTop = o.sill + ro.height + HEADER_DEPTH[size];
    if (headerTop > studLength + 0.01) {
      notes.push(`${o.kind} at ${Math.round(o.offset)}": header top (${headerTop.toFixed(1)}") is above the top plate — lower the unit or raise the wall`);
    } else if (studLength - headerTop >= 2) {
      cripple += Math.max(inside, 1);
    }
    if (o.kind === 'window') {
      sillLength += ro.width;
      if (o.sill >= 3) cripple += Math.max(inside, 2);
    }
  }

  const common = layout.length - removed.size;

  // Corners: at a vertex shared by n walls, add n-1 backer studs, booked to the
  // first wall there (by id) so each corner is counted once. Tees: a wall that
  // dies into the middle of this one needs ladder backing — 2 studs here.
  let corner = 0;
  for (const end of [wall.a, wall.b]) {
    const atVertex = project.walls.filter((w) => samePoint(w.a, end) || samePoint(w.b, end));
    if (atVertex.length > 1 && [...atVertex].sort((p, q) => p.id.localeCompare(q.id))[0].id === wall.id) {
      corner += atVertex.length - 1;
    }
  }
  for (const other of project.walls) {
    if (other.id === wall.id) continue;
    for (const end of [other.a, other.b]) {
      const { along, perp } = projectOnWall(wall, end);
      if (perp < 1 && along > PLATE_THICKNESS && along < length - PLATE_THICKNESS) corner += 2;
    }
  }

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
