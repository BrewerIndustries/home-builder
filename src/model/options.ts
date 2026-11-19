import { migrate, syncThickness } from './store.ts';
import { uid, type Project } from './types.ts';

// Design options: named alternates of the plan ("Option A", "Plan B") kept in one
// project, so they save and sync with it. The active option's plan IS the
// project; each other option stores its own plan. Switching swaps them.
//
// A plan is everything in the project but its name, prices, the traced underlay
// image and the option / version bookkeeping — so options share one price list
// (fair cost compares) and one underlay, and new project fields ride along
// automatically.

const PROJECT_KEYS = ['version', 'name', 'pricing', 'underlay', 'options', 'versions'] as const;
type ProjectKey = (typeof PROJECT_KEYS)[number];

export type PlanData = Omit<Project, ProjectKey>;

export interface DesignOption {
  id: string;
  name: string;
  /** The option's plan; unset on the active option (its plan is the project). */
  plan?: PlanData;
}

export interface DesignOptions {
  active: string;
  list: DesignOption[];
}

export function extractPlan(p: Project): PlanData {
  const out: Record<string, unknown> = { ...p };
  for (const k of PROJECT_KEYS) delete out[k];
  return out as PlanData;
}

/** The project with its plan replaced by `plan` (name, prices, underlay and bookkeeping kept). */
export function applyPlan(p: Project, plan: PlanData): Project {
  const keep: Record<string, unknown> = {};
  for (const k of PROJECT_KEYS) if (p[k as keyof Project] !== undefined) keep[k] = p[k as keyof Project];
  return syncThickness(migrate({ ...(plan as Project), ...keep } as Project));
}

const newId = () => uid('opt').replace(/[^A-Za-z0-9_-]/g, '');

/** The project's options, or a single "Option A" standing for the plan as it is. */
export function optionsOf(p: Project): DesignOptions {
  if (p.options?.list.some((o) => o.id === p.options!.active)) return p.options;
  const id = newId();
  return { active: id, list: [{ id, name: 'Option A' }] };
}

export function nextOptionName(opts: DesignOptions): string {
  for (let i = 0; i < 26; i++) {
    const name = `Option ${String.fromCharCode(65 + i)}`;
    if (!opts.list.some((o) => o.name === name)) return name;
  }
  return `Option ${opts.list.length + 1}`;
}

/** A copy of the current plan as a new option, made active (so the next edits go into the copy). */
export function addOption(p: Project, name?: string): Project {
  const opts = optionsOf(p);
  const id = newId();
  const withNew: Project = { ...p, options: { ...opts, list: [...opts.list, { id, name: name?.trim() || nextOptionName(opts), plan: extractPlan(p) }] } };
  return switchOption(withNew, id);
}

export function switchOption(p: Project, id: string): Project {
  const opts = optionsOf(p);
  const target = opts.list.find((o) => o.id === id);
  if (!target?.plan || id === opts.active) return p;
  const list = opts.list.map((o) => (o.id === opts.active ? { id: o.id, name: o.name, plan: extractPlan(p) } : o.id === id ? { id: o.id, name: o.name } : o));
  return applyPlan({ ...p, options: { active: id, list } }, target.plan);
}

export function renameOption(p: Project, id: string, name: string): Project {
  const opts = optionsOf(p);
  if (!name.trim()) return p;
  return { ...p, options: { ...opts, list: opts.list.map((o) => (o.id === id ? { ...o, name: name.trim() } : o)) } };
}

/** Drop an inactive option; with only the active one left, the project goes back to having no options. */
export function deleteOption(p: Project, id: string): Project {
  const opts = optionsOf(p);
  if (id === opts.active) return p;
  const list = opts.list.filter((o) => o.id !== id);
  if (list.length <= 1) {
    const next = { ...p };
    delete next.options;
    return next;
  }
  return { ...p, options: { ...opts, list } };
}

/** Every option as a whole project (the active one is the project itself), for estimates and compares. */
export function optionProjects(p: Project): { option: DesignOption; active: boolean; project: Project }[] {
  const opts = optionsOf(p);
  return opts.list.map((o) => (o.id === opts.active || !o.plan ? { option: o, active: true, project: p } : { option: o, active: false, project: applyPlan(p, o.plan) }));
}
