// Demolition line items and their sample allowances (US ballpark, labour +
// disposal per unit) — kept free of imports so pricing.ts can spread them into
// its sample table without a cycle (see phasing.ts for the takeoff).

export const DEMO_ITEM = {
  extWall: 'Demolition, exterior wall (allowance)',
  intWall: 'Demolition, interior wall (allowance)',
  door: 'Demolition, remove door (allowance)',
  window: 'Demolition, remove window (allowance)',
  device: 'Demolition, remove electrical device / light (allowance)',
  counter: 'Demolition, remove cabinets + countertop (allowance)',
  fixture: 'Demolition, remove plumbing fixture / appliance (allowance)',
  haul: 'Demolition, debris haul-off (dumpster allowance)',
} as const;

export const DEMO_SAMPLE: [RegExp, number][] = [
  [/^Demolition, exterior wall/, 45],
  [/^Demolition, interior wall/, 18],
  [/^Demolition, remove door/, 75],
  [/^Demolition, remove window/, 120],
  [/^Demolition, remove electrical device/, 25],
  [/^Demolition, remove cabinets/, 30],
  [/^Demolition, remove plumbing fixture/, 150],
  [/^Demolition, debris haul-off/, 550],
];
