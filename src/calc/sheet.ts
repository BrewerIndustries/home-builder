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
