import { dist } from '../model/geometry.ts';
import type { BaseCabinetType, CabinetPlan, Counter, Point, Project } from '../model/types.ts';
import { CABINET_MAX, CABINET_MIN, CABINET_STEP, cabinetLayout, type CabinetSlot, counterPoint, seatingDepth, UPPER_DEPTH, upperLayout } from './counters.ts';

// Counters v6: editing a run's cabinets one by one. Dragging the joint between
// two cabinets resizes both (in 3" steps, each kept 9"–36"), pinning that
// stretch's widths on the counter; picking a type changes what a base cabinet
// is (drawer base, trash pull-out, sink base) and so what it's priced as.
// Any of these turns the run over to cabinet-by-cabinet pricing.

export type CabinetLevel = 'base' | 'upper';

export interface CabinetJoint {
  /** Distance along the run's back edge. */
  t: number;
  level: CabinetLevel;
  stretch: number;
  /** The cabinet before the joint; the one after is index + 1. */
  index: number;
}

const slotsOf = (project: Project, c: Counter, level: CabinetLevel): CabinetSlot[] => (level === 'base' ? cabinetLayout(project, c) : upperLayout(project, c));
const sized = (k: CabinetSlot) => (k.kind === 'base' || k.kind === 'wall') && k.stretch !== undefined && k.index !== undefined;

/** Joints between two neighbouring cabinets in the same stretch: the ones a drag can move. */
export function cabinetJoints(project: Project, c: Counter, level: CabinetLevel): CabinetJoint[] {
  const slots = slotsOf(project, c, level).filter(sized);
  const out: CabinetJoint[] = [];
  for (let i = 1; i < slots.length; i++) {
    const [p, q] = [slots[i - 1], slots[i]];
    if (p.stretch === q.stretch && q.index === p.index! + 1) out.push({ t: p.e, level, stretch: p.stretch!, index: p.index! });
  }
  return out;
}

/**
 * Move a joint to `t` along the run: the cabinet before it grows and the one
 * after shrinks by the same amount (3" steps, both kept to stock widths).
 * Returns the counter patch, or null if nothing changes.
 */
export function moveJoint(project: Project, c: Counter, joint: CabinetJoint, t: number): Pick<Counter, 'cabinets'> | null {
  const stretch = slotsOf(project, c, joint.level).filter((k) => sized(k) && k.stretch === joint.stretch);
  const widths = stretch.map((k) => Math.round(k.e - k.s));
  const [l, r] = [widths[joint.index], widths[joint.index + 1]];
  if (l === undefined || r === undefined) return null;
  let delta = Math.round((t - joint.t) / CABINET_STEP) * CABINET_STEP;
  delta = Math.max(CABINET_MIN - l, r - CABINET_MAX, Math.min(CABINET_MAX - l, r - CABINET_MIN, delta));
  if (!delta) return null;
  widths[joint.index] = l + delta;
  widths[joint.index + 1] = r - delta;
  return { cabinets: withWidths(c.cabinets, joint.level, joint.stretch, widths) };
}

function withWidths(plan: CabinetPlan | undefined, level: CabinetLevel, stretch: number, widths: number[]): CabinetPlan {
  const key = level === 'base' ? 'base' : 'upper';
  const list = [...(plan?.[key] ?? [])];
  while (list.length < stretch) list.push(null);
  list[stretch] = widths;
  return { ...plan, [key]: list };
}

/** Set one base cabinet's type (standard clears it). */
export function setCabinetType(c: Counter, stretch: number, index: number, type: BaseCabinetType): Pick<Counter, 'cabinets'> {
  const types = { ...c.cabinets?.types };
  if (type === 'standard') delete types[`${stretch}.${index}`];
  else types[`${stretch}.${index}`] = type;
  return { cabinets: { ...c.cabinets, types } };
}

/** Back to stock widths everywhere on the run (types kept). */
export function resetWidths(c: Counter): Pick<Counter, 'cabinets'> {
  const rest = { ...c.cabinets };
  delete rest.base;
  delete rest.upper;
  return { cabinets: rest };
}

/** Where a joint's handle sits across the run: base joints just inside the cabinet face, wall-cabinet joints mid-depth of the uppers. */
export const jointInset = (c: Counter, level: CabinetLevel) => (level === 'upper' ? UPPER_DEPTH / 2 : c.depth - seatingDepth(c) - 2);

/** The joint handle nearest plan point `p`, within `slop`, if any. */
export function grabJoint(project: Project, c: Counter, p: Point, slop: number): CabinetJoint | null {
  let best: CabinetJoint | null = null;
  let gap = slop;
  for (const j of [...cabinetJoints(project, c, 'base'), ...cabinetJoints(project, c, 'upper')]) {
    const d = dist(p, counterPoint(c, j.t, jointInset(c, j.level)));
    if (d <= gap) [best, gap] = [j, d];
  }
  return best;
}
