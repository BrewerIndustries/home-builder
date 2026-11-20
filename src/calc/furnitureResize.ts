import type { Furniture, Point } from '../model/types.ts';
import { furniturePoint } from './furniture.ts';

// Resizing a fixture by dragging a handle on its outline. Handles sit at the
// corners and edge midpoints, named by which side they're on in the item's own
// frame (sx: -1 left, 1 right; sy: -1 back, 1 front; 0 = middle). The opposite
// edge stays put — or, with `fromCentre`, the item grows evenly about its centre.

export interface Handle {
  sx: -1 | 0 | 1;
  sy: -1 | 0 | 1;
}

/** Smallest a fixture can be dragged down to, each way (inches). */
export const MIN_SIZE = 6;

export const HANDLES: Handle[] = [
  { sx: -1, sy: -1 }, { sx: 0, sy: -1 }, { sx: 1, sy: -1 },
  { sx: -1, sy: 0 }, { sx: 1, sy: 0 },
  { sx: -1, sy: 1 }, { sx: 0, sy: 1 }, { sx: 1, sy: 1 },
];

/** Where a handle sits on the plan. */
export function handlePoint(f: Furniture, h: Handle): Point {
  return furniturePoint(f, (h.sx * f.w) / 2, (h.sy * f.d) / 2);
}

/** A plan point in the item's own frame (x across, y front-to-back). */
export function toLocal(f: Furniture, p: Point): Point {
  const r = (f.rot * Math.PI) / 180;
  const [c, s] = [Math.cos(r), Math.sin(r)];
  const dx = p.x - f.at.x;
  const dy = p.y - f.at.y;
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}

/**
 * The item's new centre and size with handle `h` dragged to plan point `p`.
 * `orig` is the item as it was when the drag began; sizes snap to `step` inches.
 */
export function resizeFurniture(orig: Furniture, h: Handle, p: Point, opts: { fromCentre?: boolean; step?: number } = {}): { at: Point; w: number; d: number } {
  const step = opts.step ?? 1;
  const q = toLocal(orig, p);
  const snap = (v: number) => Math.max(MIN_SIZE, Math.round(v / step) * step);
  let [cx, cy, w, d] = [0, 0, orig.w, orig.d];
  if (h.sx) {
    if (opts.fromCentre) w = snap(2 * q.x * h.sx);
    else {
      const fixed = (-h.sx * orig.w) / 2;
      w = snap((q.x - fixed) * h.sx);
      cx = fixed + (h.sx * w) / 2;
    }
  }
  if (h.sy) {
    if (opts.fromCentre) d = snap(2 * q.y * h.sy);
    else {
      const fixed = (-h.sy * orig.d) / 2;
      d = snap((q.y - fixed) * h.sy);
      cy = fixed + (h.sy * d) / 2;
    }
  }
  const at = furniturePoint(orig, cx, cy);
  return { at: { x: Math.round(at.x * 100) / 100, y: Math.round(at.y * 100) / 100 }, w, d };
}
