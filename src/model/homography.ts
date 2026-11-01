import type { Point } from './types.ts';

// Plane-to-plane projective transform, for straightening a photo of a plan taken
// at an angle. H is row-major 3×3 with h[8] = 1.

export type Homography = number[];

/** Solve H with H·src[i] ≅ dst[i] for four point pairs (no three collinear). */
export function homography(src: Point[], dst: Point[]): Homography {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gaussian elimination with partial pivoting on the 8×9 augmented matrix.
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) throw new Error('Those four points are in a line — pick the corners of a rectangle.');
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  return [...A.map((row, i) => row[8] / row[i]), 1];
}

export function project(h: Homography, p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

/** Put four clicked corners in top-left, top-right, bottom-right, bottom-left order (y down). */
export function orderCorners(pts: Point[]): Point[] {
  const c = { x: pts.reduce((s, p) => s + p.x, 0) / 4, y: pts.reduce((s, p) => s + p.y, 0) / 4 };
  const ring = [...pts].sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x));
  // atan2 order with y down is clockwise on screen; start at the top-left-most.
  const start = ring.reduce((best, p, i) => (p.x + p.y < ring[best].x + ring[best].y ? i : best), 0);
  return [0, 1, 2, 3].map((i) => ring[(start + i) % 4]);
}

/** Rectified size of a quad (TL, TR, BR, BL): mean of opposite edge lengths. */
export function quadSize(q: Point[]): { w: number; h: number } {
  const d = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  return { w: (d(q[0], q[1]) + d(q[3], q[2])) / 2, h: (d(q[0], q[3]) + d(q[1], q[2])) / 2 };
}
