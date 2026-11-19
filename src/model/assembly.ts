import { emptyProject, STUD_DEPTH, studFor, type LumberSize, type Project, type Wall, type WallAssemblies, type WallKind, type WallLayer, type WallLayerKind } from './types.ts';

// Wall assemblies: each wall is an ordered stack of layers (drywall, the stud
// framing, sheathing, siding…) and its drawn thickness is their sum. The plan
// still draws a wall centred on its line, so each finished face sits half the
// total thickness off the centreline. Thicknesses here are common product sizes
// (what you buy at the yard), not code values. Inches throughout.

/** Picker presets: one entry per product. `stud` takes its depth from the wall's stud size. */
export const LAYER_PRODUCTS: { key: string; label: string; layer: WallLayer }[] = [
  { key: 'drywall-1/2', label: '1/2" drywall', layer: { kind: 'drywall', thickness: 0.5 } },
  { key: 'drywall-5/8', label: '5/8" drywall', layer: { kind: 'drywall', thickness: 0.625 } },
  { key: 'stud', label: 'Studs (wall stud size)', layer: { kind: 'stud', thickness: 0 } },
  { key: 'osb-7/16', label: '7/16" OSB sheathing', layer: { kind: 'sheathing', thickness: 0.4375, name: 'OSB' } },
  { key: 'plywood-1/2', label: '1/2" plywood sheathing', layer: { kind: 'sheathing', thickness: 0.5, name: 'plywood' } },
  { key: 'foam-1', label: '1" rigid foam board', layer: { kind: 'foam', thickness: 1, name: 'rigid foam' } },
  { key: 'foam-1/2', label: '1/2" rigid foam board', layer: { kind: 'foam', thickness: 0.5, name: 'rigid foam' } },
  { key: 'siding-fc', label: '5/16" fiber-cement lap siding', layer: { kind: 'siding', thickness: 0.3125, name: 'fiber-cement lap' } },
  { key: 'siding-stucco', label: '7/8" three-coat stucco', layer: { kind: 'siding', thickness: 0.875, name: 'three-coat stucco' } },
];

const DRYWALL: WallLayer = { kind: 'drywall', thickness: 0.5 };
const STUD: WallLayer = { kind: 'stud', thickness: 0 };
const OSB: WallLayer = { kind: 'sheathing', thickness: 0.4375, name: 'OSB' };

/** New projects: drywall | studs | OSB | fiber-cement lap outside; drywall both sides inside. */
export const DEFAULT_ASSEMBLIES: WallAssemblies = {
  exterior: [DRYWALL, STUD, OSB, { kind: 'siding', thickness: 0.3125, name: 'fiber-cement lap' }],
  interior: [DRYWALL, STUD, DRYWALL],
};

/**
 * Projects saved before assemblies used "stud depth + 1 inch" for every wall.
 * Interior walls were 1/2" drywall each side (exactly +1"); exterior walls were
 * 7/16" OSB + 1/2" drywall rounded up, so a 1/16" allowance keeps their drawn
 * thickness — and every dimension — where it was.
 */
export const LEGACY_ASSEMBLIES: WallAssemblies = {
  exterior: [DRYWALL, STUD, OSB, { kind: 'other', thickness: 0.0625, name: 'finish allowance (old +1" rule)' }],
  interior: [DRYWALL, STUD, DRYWALL],
};

export function projectAssemblies(project: Project): WallAssemblies {
  return project.assemblies ?? LEGACY_ASSEMBLIES;
}

/** The wall's layers: its own, or the project's default for its kind. */
export function assemblyFor(project: Project, wall: Pick<Wall, 'kind' | 'assembly'>): WallLayer[] {
  return wall.assembly ?? projectAssemblies(project)[wall.kind];
}

export function layerThickness(layer: WallLayer, stud: LumberSize): number {
  return layer.kind === 'stud' ? STUD_DEPTH[stud] : Math.max(0, layer.thickness);
}

export function layersThickness(layers: WallLayer[], stud: LumberSize): number {
  // A stack with no stud layer still has framing in it.
  const studs = layers.some((l) => l.kind === 'stud') ? 0 : STUD_DEPTH[stud];
  return studs + layers.reduce((s, l) => s + layerThickness(l, stud), 0);
}

/** Total finished thickness of a wall from its layers. */
export function assemblyThickness(project: Project, wall: Pick<Wall, 'kind' | 'assembly' | 'stud'>): number {
  return layersThickness(assemblyFor(project, wall), studFor(wall as Wall, project.framing));
}

/** Thickness of a new wall of this kind with the project defaults. */
export function defaultWallThickness(project: Project, kind: WallKind): number {
  return assemblyThickness(project, { kind });
}

/** Stud face to stud face: the framing alone. */
export function framingThickness(project: Project, wall: Wall): number {
  return STUD_DEPTH[studFor(wall, project.framing)];
}

/** Layers of each kind on a wall (1/2" drywall both sides of a partition = 2 drywall layers). */
export function layersOf(project: Project, wall: Wall, kind: WallLayerKind): WallLayer[] {
  return assemblyFor(project, wall).filter((l) => l.kind === kind);
}

const FRACTIONS: [number, string][] = [
  [0.0625, '1/16'], [0.125, '1/8'], [0.1875, '3/16'], [0.25, '1/4'], [0.3125, '5/16'], [0.375, '3/8'], [0.4375, '7/16'],
  [0.5, '1/2'], [0.5625, '9/16'], [0.625, '5/8'], [0.6875, '11/16'], [0.75, '3/4'], [0.8125, '13/16'], [0.875, '7/8'], [0.9375, '15/16'],
];

/** 0.4375 → 7/16", 1.5 → 1-1/2", to the nearest 1/16". */
export function inchText(t: number): string {
  const whole = Math.floor(t + 1e-6);
  const rest = Math.round((t - whole) * 16) / 16;
  const frac = FRACTIONS.find(([v]) => Math.abs(v - rest) < 1e-6)?.[1];
  if (!frac) return `${whole}"`;
  return whole ? `${whole}-${frac}"` : `${frac}"`;
}

const KIND_WORD: Record<WallLayerKind, string> = { drywall: 'drywall', stud: 'studs', sheathing: 'sheathing', foam: 'foam board', siding: 'siding', other: 'layer' };

/** "1/2" drywall", "7/16" OSB sheathing", "2x6 studs". */
export function layerLabel(layer: WallLayer, stud?: LumberSize): string {
  if (layer.kind === 'stud') return stud ? `${stud} studs` : 'studs';
  const name = layer.name ? `${layer.name} ` : '';
  const word = layer.kind === 'other' ? '' : KIND_WORD[layer.kind];
  return `${inchText(layer.thickness)} ${name}${word}`.trim();
}

/** Short summary of a stack, e.g. "1/2" drywall · 2x6 studs · 7/16" OSB sheathing". */
export function assemblyText(layers: WallLayer[], stud?: LumberSize): string {
  return layers.map((l) => layerLabel(l, stud)).join(' · ');
}

export function sameLayers(a: WallLayer[], b: WallLayer[]): boolean {
  return a.length === b.length && a.every((l, i) => l.kind === b[i].kind && Math.abs(l.thickness - b[i].thickness) < 1e-6 && (l.name ?? '') === (b[i].name ?? ''));
}

/** A blank project with today's assembly presets (emptyProject alone reads as a pre-assembly save). */
export function newProject(name?: string): Project {
  return { ...emptyProject(name), assemblies: DEFAULT_ASSEMBLIES };
}
