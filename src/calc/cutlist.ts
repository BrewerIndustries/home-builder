// Cut lists: the framing members that are cut from dimensional stock (plates,
// jacks, cripples, flat sills, header plies), packed onto stock lengths with as
// little waste as practical, plus a waste report.
//
// Full-height studs (commons, kings, corners) are bought cut to length (precuts,
// or the next stock length up) and aren't packed. Plates longer than the longest
// stock board are split into pieces with every joint landed on a stud, the top
// plate's joints offset from the cap plate's (R602.3.2). LVL headers (and LVL
// ridges) are engineered and ordered by length, so they're left out.
//
// The roof (rafters, ridge, hips, ceiling joists, fascia) and a framed floor
// (rim, blocking over the girders) get their own groups; those aren't priced
// from the cut list — their own materials lines already buy them.
//
// Packing is first-fit decreasing onto the longest stock, then each board is
// cut down to the shortest stock length that still holds its pieces. Allowance:
// a 1/8" saw kerf per cut. Offcuts of KEEP_OFFCUT or more are listed as blocking stock.

import { floorSpec, storeyFloorLayout } from './floor.ts';
import { frameWall, PLATE_THICKNESS, type MemberKind, type WallFraming } from './framing.ts';
import { roofCutMembers } from './roof.ts';
import { framedWalls, type Project } from '../model/types.ts';

/** Stock lengths, inches (8' to 16' in 2' steps; 20' for a long header). */
export const STOCK = [96, 120, 144, 168, 192];
export const LONG_STOCK = 240;
export const KERF = 0.125;
/** Offcuts at least this long are worth keeping (blocking, fire-stops). */
export const KEEP_OFFCUT = 12;

export interface Piece {
  /** Lumber size: a stud size or a header size. */
  size: string;
  length: number;
  /** What it is and where: "W3 top plate", "W1 jack". */
  label: string;
}

export interface Board {
  stock: number;
  cuts: Piece[];
  /** Left over after the cuts and kerfs. */
  offcut: number;
}

export type CutSection = 'Walls' | 'Roof' | 'Floor';

export interface CutListGroup {
  section: CutSection;
  size: string;
  boards: Board[];
  /** Boards needed per stock length. */
  byStock: { stock: number; n: number }[];
  pieces: number;
  stockLength: number;
  usedLength: number;
  /** Offcuts long enough to keep. */
  keep: number;
  wastePct: number;
}

const NAMES: Partial<Record<MemberKind, string>> = { jack: 'jack', cripple: 'cripple', sill: 'sill' };

/** R602.3.2: end joints in the top plate and the cap plate over it offset at least 24". */
export const PLATE_JOINT_OFFSET = 24;

/**
 * Plate piece lengths along a wall: the bottom and cap plates in equal pieces no
 * longer than the longest stock; the top plate with its joints at least 24" from
 * the cap plate's (shifted 24" either way, or one more piece if that won't fit).
 *
 * Given the wall's stud centres, every joint lands on a stud instead: each one
 * snapped to the stud nearest its even-split spot that keeps the pieces within
 * the longest stock (and, for the top plate, 24" clear of the cap's joints). If
 * no stud layout allows that, the unsnapped split above is used.
 */
export function platePieces(length: number, longest = STOCK[STOCK.length - 1], studs?: number[]): { bottom: number[]; top: number[]; cap: number[] } {
  const n = Math.ceil(length / longest - 1e-9);
  const even = (k: number) => Array.from({ length: k }, () => length / k);
  const cap = even(n);
  if (n === 1) return { bottom: cap, top: cap, cap };
  if (studs?.length) {
    const landed = studLandedPlates(length, longest, studs, n);
    if (landed) return landed;
  }
  const capJoints = cap.slice(0, -1).map((_, i) => (length / n) * (i + 1));
  const ok = (pieces: number[]) =>
    pieces.every((x) => x <= longest + 1e-9 && x > 0) && plateJoints(pieces).every((j) => capJoints.every((c) => Math.abs(j - c) >= PLATE_JOINT_OFFSET - 1e-9));
  const s = PLATE_JOINT_OFFSET;
  const options = [
    [length / n + s, ...even(n).slice(2), length / n - s],
    [length / n - s, ...even(n).slice(2), length / n + s],
  ];
  // One more piece: keep shifting the even split until every joint clears the cap's.
  for (let k = n + 1; k <= n + 3; k++) for (const shift of [0, s, -s]) {
    const p = even(k);
    options.push([p[0] + shift, ...p.slice(1, -1), p[p.length - 1] - shift]);
  }
  return { bottom: cap, top: options.find(ok) ?? even(n + 1), cap };
}

/** Joint positions (from the wall's start) of consecutive plate pieces. */
export function plateJoints(pieces: number[]): number[] {
  const out: number[] = [];
  let at = 0;
  for (const x of pieces.slice(0, -1)) out.push((at += x));
  return out;
}

const toPieces = (length: number, joints: number[]) => [...joints, length].map((j, i) => j - (i ? joints[i - 1] : 0));

/**
 * Joints for k pieces, each snapped to the stud centre nearest its ideal spot
 * (even split + shift), keeping every piece within `longest` and clear of
 * `avoid` by the R602.3.2 offset; null if the studs don't allow it.
 */
function snapJoints(length: number, k: number, studs: number[], longest: number, avoid: number[], shift: number): number[] | null {
  const eps = 1e-6;
  const joints: number[] = [];
  let prev = 0;
  for (let i = 1; i < k; i++) {
    const ideal = (length * i) / k + shift;
    let best: number | null = null;
    for (const c of studs) {
      if (c <= prev + eps || c >= length - eps || c - prev > longest + eps) continue;
      if (length - c > longest * (k - i) + eps) continue;
      if (avoid.some((a) => Math.abs(c - a) < PLATE_JOINT_OFFSET - eps)) continue;
      if (best === null || Math.abs(c - ideal) < Math.abs(best - ideal) - eps) best = c;
    }
    if (best === null) return null;
    joints.push(best);
    prev = best;
  }
  return length - prev <= longest + eps ? joints : null;
}

function studLandedPlates(length: number, longest: number, studs: number[], n: number): { bottom: number[]; top: number[]; cap: number[] } | null {
  const sorted = [...new Set(studs)].sort((a, b) => a - b);
  const s = PLATE_JOINT_OFFSET;
  for (let k = n; k <= n + 2; k++) {
    const capJ = snapJoints(length, k, sorted, longest, [], 0);
    if (!capJ) continue;
    for (let t = k; t <= k + 3; t++) {
      for (const shift of [s, -s, 0]) {
        const topJ = snapJoints(length, t, sorted, longest, capJ, shift);
        if (!topJ) continue;
        const cap = toPieces(length, capJ);
        return { bottom: cap, top: toPieces(length, topJ), cap };
      }
    }
  }
  return null;
}

/** Stud centres a plate joint can land on: the full-height studs (commons, corners, kings). */
export function plateStuds(f: WallFraming): number[] {
  return f.members.filter((m) => m.kind === 'common' || m.kind === 'corner' || m.kind === 'king').map((m) => m.x + m.w / 2);
}

/** Every piece cut from stock, by wall (W1, W2… in plan order). */
export function cutPieces(project: Project, walls: WallFraming[] = framedWalls(project).map((w) => frameWall(w, project))): Piece[] {
  const out: Piece[] = [];
  walls.forEach((f, i) => {
    const tag = `W${i + 1}`;
    // Three plates: bottom, top and cap, joints on studs, the top plate's offset from the cap's.
    const plates = platePieces(f.length, undefined, plateStuds(f));
    for (const [plate, pieces] of [['bottom plate', plates.bottom], ['top plate', plates.top], ['cap plate', plates.cap]] as const) {
      pieces.forEach((len, k) => out.push({ size: f.studSize, length: len, label: `${tag} ${plate}${pieces.length > 1 ? ` ${k + 1}/${pieces.length}` : ''}` }));
    }
    for (const m of f.members) {
      const name = NAMES[m.kind];
      if (!name) continue;
      out.push({ size: f.studSize, length: m.kind === 'sill' ? m.w : m.h, label: `${tag} ${name}` });
    }
    for (const h of f.headers) {
      if (h.size === 'LVL') continue;
      for (let k = 0; k < h.plies; k++) out.push({ size: h.size, length: h.length, label: `${tag} header` });
    }
  });
  return out.filter((p) => p.length > 0.01);
}

/** First-fit decreasing onto the longest stock, then each board trimmed to the shortest stock that holds it. */
export function packBoards(pieces: Piece[], stock: number[] = STOCK, kerf = KERF): Board[] {
  const sorted = [...pieces].sort((a, b) => b.length - a.length);
  const longest = Math.max(...stock);
  const open: { cap: number; used: number; cuts: Piece[] }[] = [];
  for (const p of sorted) {
    const need = p.length + kerf;
    const fit = open.find((b) => b.cap - b.used >= p.length - 1e-9 && (b.used === 0 || b.cap - b.used >= need - 1e-9));
    if (fit) {
      fit.used += fit.used === 0 ? p.length : need;
      fit.cuts.push(p);
    } else {
      // A piece longer than the longest stock gets a long board of its own.
      open.push({ cap: p.length > longest ? LONG_STOCK : longest, used: p.length, cuts: [p] });
    }
  }
  return open.map((b) => {
    const len = [...stock, LONG_STOCK].sort((x, y) => x - y).find((s) => s >= b.used - 1e-9) ?? Math.ceil(b.used / 24) * 24;
    return { stock: len, cuts: b.cuts, offcut: len - b.used };
  });
}

/** Pieces grouped by size and packed: one group per lumber size. */
export function groupPieces(pieces: Piece[], section: CutSection = 'Walls'): CutListGroup[] {
  const bySize = new Map<string, Piece[]>();
  for (const p of pieces) bySize.set(p.size, [...(bySize.get(p.size) ?? []), p]);
  return [...bySize.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([size, pieces]) => {
      const boards = packBoards(pieces).sort((a, b) => b.stock - a.stock || a.offcut - b.offcut);
      const counts = new Map<number, number>();
      for (const b of boards) counts.set(b.stock, (counts.get(b.stock) ?? 0) + 1);
      const stockLength = boards.reduce((t, b) => t + b.stock, 0);
      const usedLength = pieces.reduce((t, p) => t + p.length, 0);
      return {
        section,
        size,
        boards,
        byStock: [...counts.entries()].sort((a, b) => b[0] - a[0]).map(([stock, n]) => ({ stock, n })),
        pieces: pieces.length,
        stockLength,
        usedLength,
        keep: boards.filter((b) => b.offcut >= KEEP_OFFCUT).length,
        wastePct: stockLength ? ((stockLength - usedLength) / stockLength) * 100 : 0,
      };
    });
}

/** The walls' cut list (what "price these boards" buys), grouped by lumber size. */
export function cutList(project: Project, walls?: WallFraming[]): CutListGroup[] {
  return groupPieces(cutPieces(project, walls), 'Walls');
}

/** A run longer than the longest stock in equal pieces that each fit it. */
export function splitRun(length: number, longest = STOCK[STOCK.length - 1]): number[] {
  if (length <= 0.01) return [];
  const n = Math.max(1, Math.ceil(length / longest - 1e-9));
  return Array.from({ length: n }, () => length / n);
}

/** Pieces for a run, labelled "name k/n" when it takes more than one. */
function runPieces(size: string, length: number, label: string): Piece[] {
  const parts = splitRun(length);
  return parts.map((len, k) => ({ size, length: len, label: parts.length > 1 ? `${label} ${k + 1}/${parts.length}` : label }));
}

/** Roof members cut from stock: rafters, ridge, hips, valleys, ceiling joists, fascia. */
export function roofCutPieces(project: Project): Piece[] {
  const out: Piece[] = [];
  for (const m of roofCutMembers(project)) {
    if (m.size === 'LVL') continue;
    for (let i = 0; i < m.count; i++) {
      if (m.run) out.push(...runPieces(m.size, m.length, m.label));
      else out.push({ size: m.size, length: m.length, label: m.label });
    }
  }
  return out.filter((p) => p.length > 0.01);
}

/** Floor members cut from stock (framed floors): rim board by edge, blocking over the girders, headers at floor openings. I-joist floors buy rim board by the foot. */
export function floorCutPieces(project: Project): Piece[] {
  const L = storeyFloorLayout(project);
  if (!L) return [];
  const f = floorSpec(project);
  if (f.ijoist) return [];
  const out: Piece[] = [];
  let edge = 0;
  for (const pts of L.outline) {
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length];
      edge += 1;
      out.push(...runPieces(f.joistSize, Math.hypot(q.x - p.x, q.y - p.y), `rim ${edge}`));
    });
  }
  // A solid block in each joist bay along each girder line.
  const block = f.joistSpacing - PLATE_THICKNESS;
  if (!f.flushGirders) {
    L.girders.forEach((g, i) => {
      const n = Math.max(1, Math.round(Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y) / f.joistSpacing));
      for (let k = 0; k < n; k++) out.push({ size: f.joistSize, length: block, label: `girder ${i + 1} block` });
    });
  }
  // Doubled headers round floor openings.
  L.headers.forEach((h, i) => {
    for (let k = 0; k < 2; k++) out.push({ size: f.joistSize, length: Math.hypot(h.b.x - h.a.x, h.b.y - h.a.y), label: `opening header ${i + 1}` });
  });
  return out.filter((p) => p.length > 0.01);
}

/** Every cut-list group: walls, then roof, then floor. */
export function fullCutList(project: Project, walls?: WallFraming[]): CutListGroup[] {
  return [...cutList(project, walls), ...groupPieces(roofCutPieces(project), 'Roof'), ...groupPieces(floorCutPieces(project), 'Floor')];
}

export interface KeptOffcut {
  section: CutSection;
  size: string;
  length: number;
  /** Which board it comes off: "Walls 2x4 board 3". */
  from: string;
}

/** Offcuts long enough to keep, by size then longest first: blocking and fire-stop stock. */
export function keptOffcuts(groups: CutListGroup[]): KeptOffcut[] {
  const out: KeptOffcut[] = [];
  for (const g of groups) g.boards.forEach((b, i) => b.offcut >= KEEP_OFFCUT && out.push({ section: g.section, size: g.size, length: b.offcut, from: `${g.section} ${g.size} board ${i + 1}` }));
  return out.sort((a, b) => a.size.localeCompare(b.size, undefined, { numeric: true }) || b.length - a.length);
}

/** CSV: one row per cut, by board. */
export function cutListCsv(groups: CutListGroup[], fmt: (n: number) => string): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows = [['Section', 'Size', 'Board', 'Stock', 'Cut', 'Length', 'Offcut'].join(',')];
  for (const g of groups) {
    g.boards.forEach((b, i) => {
      b.cuts.forEach((c, k) => rows.push([g.section, g.size, i + 1, q(fmt(b.stock)), q(c.label), q(fmt(c.length)), k === b.cuts.length - 1 ? q(fmt(b.offcut)) : ''].join(',')));
    });
  }
  return rows.join('\n') + '\n';
}
