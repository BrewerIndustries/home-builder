import type { Project } from './types.ts';

// Remodel phasing. Every plan element (wall, door / window, room, receptacle,
// switch, light / alarm, counter, fixture / furniture) is either existing (stays),
// demo (comes out) or new (built). Phases live in one id → phase map on the
// project, `phases`; an id missing from it is new — so projects from before
// phasing are all new work and load unchanged.

export type Phase = 'existing' | 'demo' | 'new';

export const PHASES: Phase[] = ['existing', 'demo', 'new'];

export const PHASE_LABEL: Record<Phase, string> = { existing: 'Existing', demo: 'Demolish', new: 'New' };

/** Which elements the plan shows: what stands today (existing + demo, demo shown as existing), the demo plan (existing + demo), the new plan (existing + new) or everything. */
export type PhaseView = 'all' | 'existing' | 'demo' | 'new';

export const PHASE_VIEWS: { id: PhaseView; label: string; title: string }[] = [
  { id: 'all', label: 'All', title: 'Every phase: existing grey, demolition dashed, new solid' },
  { id: 'existing', label: 'Existing', title: 'The existing plan: what stands today (demolition items shown as existing)' },
  { id: 'demo', label: 'Demo', title: 'The demolition plan: existing items, with what comes out dashed' },
  { id: 'new', label: 'New', title: 'The new plan: existing items in grey plus the new work' },
];

export function phaseOf(project: Pick<Project, 'phases'>, id: string): Phase {
  return project.phases?.[id] ?? 'new';
}

/** True when anything in the project is marked existing or demolition. */
export function isPhased(project: Pick<Project, 'phases'>): boolean {
  return !!project.phases && Object.keys(project.phases).length > 0;
}

/** Every element id on the plan (the things a phase applies to). */
export function planElementIds(p: Project): string[] {
  return [
    ...p.walls.map((x) => x.id),
    ...p.openings.map((x) => x.id),
    ...p.rooms.map((x) => x.id),
    ...p.outlets.map((x) => x.id),
    ...p.switches.map((x) => x.id),
    ...p.fixtures.map((x) => x.id),
    ...p.counters.map((x) => x.id),
    ...p.furniture.map((x) => x.id),
  ];
}

/** Set the phase of some elements; ids no longer on the plan are pruned from the map; an empty map is dropped. */
export function setPhase(p: Project, ids: string[], phase: Phase): Project {
  const live = new Set(planElementIds(p));
  const map: Record<string, Exclude<Phase, 'new'>> = {};
  for (const [id, ph] of Object.entries(p.phases ?? {})) if (live.has(id)) map[id] = ph;
  for (const id of ids) {
    if (!live.has(id)) continue;
    if (phase === 'new') delete map[id];
    else map[id] = phase;
  }
  const next = { ...p, phases: Object.keys(map).length ? map : undefined };
  if (!next.phases) delete next.phases;
  return next;
}

/** A wall split in two: the new piece keeps the original's phase. */
export function inheritPhase(p: Project, fromId: string, toId: string): Project {
  const ph = p.phases?.[fromId];
  return ph && p.walls.some((w) => w.id === toId) ? { ...p, phases: { ...p.phases, [toId]: ph } } : p;
}

/** CSS class for an element drawn in a phase other than new. */
export function phaseClass(project: Pick<Project, 'phases'>, id: string): string | undefined {
  const ph = project.phases?.[id];
  return ph ? `phase-${ph}` : undefined;
}

/**
 * The plan as a view shows it: elements outside the view dropped (openings and
 * wall devices go with a hidden wall). The existing view shows demolition items
 * as plain existing.
 */
export function phaseView(p: Project, view: PhaseView): Project {
  if (view === 'all' || !isPhased(p)) return p;
  const show = (id: string) => {
    const ph = phaseOf(p, id);
    return ph === 'existing' || (view === 'new' ? ph === 'new' : ph === 'demo');
  };
  const walls = p.walls.filter((w) => show(w.id));
  const wallIds = new Set(walls.map((w) => w.id));
  const onWall = <T extends { id: string; wallId: string }>(x: T) => show(x.id) && wallIds.has(x.wallId);
  const phases = view === 'existing' ? Object.fromEntries(Object.entries(p.phases!).map(([id]) => [id, 'existing' as const])) : p.phases;
  return {
    ...p,
    phases,
    walls,
    openings: p.openings.filter(onWall),
    outlets: p.outlets.filter(onWall),
    switches: p.switches.filter(onWall),
    rooms: p.rooms.filter((r) => show(r.id)),
    fixtures: p.fixtures.filter((f) => show(f.id)),
    counters: p.counters.filter((c) => show(c.id)),
    furniture: p.furniture.filter((f) => show(f.id)),
  };
}

/** Count of elements per phase, for the toolbar summary. */
export function phaseCounts(p: Project): Record<Phase, number> {
  const out: Record<Phase, number> = { existing: 0, demo: 0, new: 0 };
  for (const id of planElementIds(p)) out[phaseOf(p, id)] += 1;
  return out;
}
