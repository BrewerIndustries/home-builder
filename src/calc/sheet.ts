// Print sheet geometry: which architectural scale a plan of a given size prints at.

/** Paper inches per foot, largest first: 1/2", 1/4", 3/16", 1/8", 3/32", 1/16". */
export const SCALES: { label: string; denom: number }[] = [
  { label: '1/2" = 1\'-0"', denom: 24 },
  { label: '1/4" = 1\'-0"', denom: 48 },
  { label: '3/16" = 1\'-0"', denom: 64 },
  { label: '1/8" = 1\'-0"', denom: 96 },
  { label: '3/32" = 1\'-0"', denom: 128 },
  { label: '1/16" = 1\'-0"', denom: 192 },
];

/** Drawable area on a Letter landscape sheet with 1/2" margins and a title strip. */
export const SHEET = { w: 10, h: 6.6 };
/** Paper inches kept around the plan: dimension strings run along the top and left. */
export const DIM_ROOM = { lead: 0.9, trail: 0.3 };

export function pickScale(planW: number, planH: number) {
  return SCALES.find((s) => planW / s.denom + DIM_ROOM.lead + DIM_ROOM.trail <= SHEET.w && planH / s.denom + DIM_ROOM.lead + DIM_ROOM.trail <= SHEET.h) ?? SCALES.at(-1)!;
}

/** Engineering scales for the site sheet (plan inches per paper inch), largest first. */
export const SITE_SCALES: { label: string; denom: number }[] = [10, 20, 30, 40, 50, 60, 100, 200].map((ft) => ({ label: `1" = ${ft}'`, denom: ft * 12 }));
/** Paper inches kept clear around the site drawing. */
export const SITE_MARGIN = 0.3;

export function pickSiteScale(planW: number, planH: number) {
  const m = 2 * SITE_MARGIN;
  return SITE_SCALES.find((s) => planW / s.denom + m <= SHEET.w && planH / s.denom + m <= SHEET.h) ?? SITE_SCALES.at(-1)!;
}

/** Bounding box of plan points, grown by `pad` all round (the roof plan sheet's extent). */
export function pointBounds(pts: { x: number; y: number }[], pad = 0): { x: number; y: number; w: number; h: number } {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
}
