import type { Pricing } from '../model/types.ts';
import type { MaterialLine } from './materials.ts';

// Turns the materials list into money. Prices are per the line's unit and keyed
// by the line's item text, so a price the user types sticks to that item across
// edits to the plan. Anything without a user price falls back to SAMPLE_PRICE —
// ballpark US big-box figures that exist so the page isn't empty, not quotes.

export interface PricedLine extends MaterialLine {
  unitPrice: number;
  /** True when the user set this price (vs. the sample fallback). */
  custom: boolean;
  total: number;
}

export interface Estimate {
  lines: PricedLine[];
  byCategory: { category: MaterialLine['category']; total: number }[];
  subtotal: number;
  markup: number;
  tax: number;
  total: number;
}

const SAMPLE: [RegExp, number][] = [
  [/^2x4 stud, 92/, 4.5],
  [/^2x6 stud, 92/, 7.5],
  [/^2x8 stud, 92/, 11],
  [/^2x4 stud, 104|^2x4 stud, 116/, 6.5],
  [/^2x6 stud, 104|^2x6 stud, 116/, 10.5],
  [/^2x8 stud, 104|^2x8 stud, 116/, 15],
  [/^2x4 plate/, 9.5],
  [/^2x6 plate/, 15],
  [/^2x8 plate/, 22],
  [/^2x4 header/, 7],
  [/^2x6 header/, 11],
  [/^2x8 header/, 16],
  [/^2x10 header/, 22],
  [/^2x12 header/, 28],
  [/^LVL header/, 12],
  [/OSB/, 16],
  [/house wrap/, 175],
  [/^R-13/, 0.7],
  [/^R-21/, 1.05],
  [/^R-30/, 1.4],
  [/drywall/, 15],
  [/^2x lumber for tray/, 10],
  [/duplex receptacle/, 2.5],
  [/GFCI receptacle/, 22],
  [/dedicated receptacle/, 4],
  [/240V receptacle/, 14],
  [/new-work box/, 1.2],
  [/^Roof truss|^Gable-end truss|^Mono \(shed\) truss/, 150],
  [/^Hip truss package/, 190],
  [/^2x10 ridge|^2x10 hip/, 25],
  [/^2x12 ridge|^2x12 hip/, 34],
  [/^LVL ridge|^LVL hip/, 120],
  [/^Hurricane tie/, 1.2],
  [/Synthetic underlayment/, 95],
  [/^Architectural shingles/, 38],
  [/^Starter strip/, 40],
  [/^Hip & ridge cap/, 55],
  [/^Drip edge/, 9],
  [/^2x6 fascia/, 16],
  [/^Vented soffit/, 3],
  [/^Pavers$/, 4.5],
  [/^Paver base gravel/, 45],
  [/^Bedding sand/, 40],
  [/^Polymeric joint sand/, 30],
  [/^Paver edge restraint/, 2],
  [/^Concrete$/, 165],
  [/^Decorative gravel/, 55],
  [/^Landscape fabric/, 0.15],
  [/^Hardwood mulch/, 38],
  [/^Sod$/, 250],
  [/^Decking/, 12],
  [/\(tree\)$/, 150],
  [/\(shrub\)$/, 35],
  [/\(perennial\)$|\(grass\)$|\(groundcover\)$/, 12],
  [/^Concrete, /, 165],
  [/^Base gravel/, 45],
  [/vapor retarder|ground cover/, 110],
  [/^Welded wire mesh/, 32],
  [/^#4 rebar/, 14],
  [/^2x12 edge form/, 28],
  [/^8×8×16 concrete block/, 2.4],
  [/^Type S mortar/, 12],
  [/^Foundation vent/, 18],
  [/anchor bolt/, 2.5],
  [/^2x4 pressure-treated sill/, 14],
  [/^2x6 pressure-treated sill/, 22],
  [/^2x8 pressure-treated sill/, 30],
  [/^Sill seal/, 9],
  [/^Pier \/ post/, 45],
  [/subfloor, 4×8/, 38],
  [/^Subfloor adhesive/, 9],
  [/^Door /, 250],
  [/^Window /, 350],
];

/** Per-foot fallback for studs bought at stock lengths (8', 10', …). */
const PER_FOOT: Record<string, number> = { '2x4': 0.6, '2x6': 0.95, '2x8': 1.35, '2x10': 1.9, '2x12': 2.6 };

export function samplePrice(item: string): number {
  for (const [re, price] of SAMPLE) if (re.test(item)) return price;
  const stock = item.match(/^(2x\d+) (?:stud|rafter|ceiling joist|ridge board|hip rafter|floor joist|rim joist|girder ply \(3-ply built-up\)|blocking over girders), (\d+)'/);
  if (stock) return Math.round(PER_FOOT[stock[1]] * Number(stock[2]) * 100) / 100;
  return 0;
}

export const DEFAULT_PRICING: Pricing = { prices: {}, markup: 0.15, tax: 0.0825 };

export function estimate(lines: MaterialLine[], pricing: Pricing = DEFAULT_PRICING): Estimate {
  const priced = lines.map((l) => {
    const custom = l.item in pricing.prices;
    const unitPrice = custom ? pricing.prices[l.item] : samplePrice(l.item);
    return { ...l, unitPrice, custom, total: round2(unitPrice * l.qty) };
  });
  const cats = [...new Set(priced.map((l) => l.category))];
  const byCategory = cats.map((category) => ({ category, total: round2(priced.filter((l) => l.category === category).reduce((s, l) => s + l.total, 0)) }));
  const subtotal = round2(priced.reduce((s, l) => s + l.total, 0));
  // Sales tax on materials; markup (overhead + profit) on top of materials, not taxed.
  const tax = round2(subtotal * pricing.tax);
  const markup = round2(subtotal * pricing.markup);
  return { lines: priced, byCategory, subtotal, markup, tax, total: round2(subtotal + tax + markup) };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function money(n: number): string {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}
