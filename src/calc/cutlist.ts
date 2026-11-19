// Cut lists: the framing members that are cut from dimensional stock (plates,
// jacks, cripples, flat sills, header plies), packed onto stock lengths with as
// little waste as practical, plus a waste report.
//
// Full-height studs (commons, kings, corners) are bought cut to length (precuts,
// or the next stock length up) and aren't packed. Plates longer than the longest
// stock board are split into equal pieces (the joints land on studs on site; top
// and cap plate joints are offset — R602.3.2 — which this doesn't lay out).
// LVL headers are engineered and ordered by length, so they're left out.
//
// Packing is first-fit decreasing onto the longest stock, then each board is
// cut down to the shortest stock length that still holds its pieces. Allowance:
// a 1/8" saw kerf per cut.

import { frameWall, type MemberKind } from './framing.ts';
import type { Project } from '../model/types.ts';

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

export interface CutListGroup {
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

/** Every piece cut from stock, by wall (W1, W2… in plan order). */
export function cutPieces(project: Project): Piece[] {
  const out: Piece[] = [];
  project.walls.forEach((w, i) => {
    const f = frameWall(w, project);
    const tag = `W${i + 1}`;
    // Three plates (bottom, top, cap), each split into equal pieces no longer than the longest stock.
    const n = Math.ceil(f.length / STOCK[STOCK.length - 1] - 1e-9);
    for (const plate of ['bottom plate', 'top plate', 'cap plate']) {
      for (let k = 0; k < n; k++) out.push({ size: f.studSize, length: f.length / n, label: `${tag} ${plate}${n > 1 ? ` ${k + 1}/${n}` : ''}` });
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

/** The cut list for the whole house, grouped by lumber size. */
export function cutList(project: Project): CutListGroup[] {
  const bySize = new Map<string, Piece[]>();
  for (const p of cutPieces(project)) bySize.set(p.size, [...(bySize.get(p.size) ?? []), p]);
  return [...bySize.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([size, pieces]) => {
      const boards = packBoards(pieces).sort((a, b) => b.stock - a.stock || a.offcut - b.offcut);
      const counts = new Map<number, number>();
      for (const b of boards) counts.set(b.stock, (counts.get(b.stock) ?? 0) + 1);
      const stockLength = boards.reduce((t, b) => t + b.stock, 0);
      const usedLength = pieces.reduce((t, p) => t + p.length, 0);
      return {
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

/** CSV: one row per cut, by board. */
export function cutListCsv(groups: CutListGroup[], fmt: (n: number) => string): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows = [['Size', 'Board', 'Stock', 'Cut', 'Length', 'Offcut'].join(',')];
  for (const g of groups) {
    g.boards.forEach((b, i) => {
      b.cuts.forEach((c, k) => rows.push([g.size, i + 1, q(fmt(b.stock)), q(c.label), q(fmt(c.length)), k === b.cuts.length - 1 ? q(fmt(b.offcut)) : ''].join(',')));
    });
  }
  return rows.join('\n') + '\n';
}
