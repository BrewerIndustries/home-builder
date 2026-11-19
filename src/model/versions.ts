import { applyPlan, extractPlan, optionsOf, type PlanData } from './options.ts';
import { uid, type Project } from './types.ts';

// Plan versions: named, dated snapshots of the plan kept inside the project (so
// they save and sync with it). A snapshot is the plan only (see options.ts) —
// no underlay image, prices, design options or other versions — so each costs
// about as much as the plan itself.

export interface PlanVersion {
  id: string;
  name: string;
  /** When it was saved, ms since epoch. */
  at: number;
  /** The design option it was taken from, by name. */
  option?: string;
  plan: PlanData;
}

/** Pseudo-id for "the plan as it is now" in compares. */
export const CURRENT = 'current';

export function nextVersionName(p: Project): string {
  return `Version ${(p.versions?.length ?? 0) + 1}`;
}

export function saveVersion(p: Project, name?: string, at = Date.now()): Project {
  const opts = p.options ? optionsOf(p) : null;
  const v: PlanVersion = {
    id: uid('ver').replace(/[^A-Za-z0-9_-]/g, ''),
    name: name?.trim() || nextVersionName(p),
    at,
    ...(opts && { option: opts.list.find((o) => o.id === opts.active)?.name }),
    plan: extractPlan(p),
  };
  return { ...p, versions: [...(p.versions ?? []), v] };
}

/** The plan put back as it was in a version (the versions list, options, name and prices are kept). */
export function restoreVersion(p: Project, id: string): Project {
  const v = p.versions?.find((x) => x.id === id);
  return v ? applyPlan(p, v.plan) : p;
}

export function deleteVersion(p: Project, id: string): Project {
  const versions = (p.versions ?? []).filter((v) => v.id !== id);
  const next: Project = { ...p, versions };
  if (!versions.length) delete next.versions;
  return next;
}

export function renameVersion(p: Project, id: string, name: string): Project {
  if (!name.trim()) return p;
  return { ...p, versions: (p.versions ?? []).map((v) => (v.id === id ? { ...v, name: name.trim() } : v)) };
}

/** A version (or CURRENT) as a whole project, for diffs and estimates. */
export function versionProject(p: Project, id: string): Project | null {
  if (id === CURRENT) return p;
  const v = p.versions?.find((x) => x.id === id);
  return v ? applyPlan(p, v.plan) : null;
}

/** Rough stored size of a version, bytes of JSON. */
export function versionBytes(v: PlanVersion): number {
  return JSON.stringify(v).length;
}
