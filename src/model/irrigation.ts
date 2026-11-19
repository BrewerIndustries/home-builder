import type { Point } from './types.ts';

// Sprinkler / irrigation layout data, stored on Site.irrigation (optional, so older
// projects load unchanged). Units: inches; angles in degrees, measured the way the
// plan draws them (y runs down, so increasing angle turns clockwise on screen).

export type HeadKind = 'spray' | 'rotor' | 'drip';

/** Nozzle figures used for new heads and flow totals. */
export interface Nozzle {
  /** Throw radius (spray / rotor) or wetted radius (drip emitter), inches. */
  radius: number;
  /** Flow, GPM: for a full 360° arc on spray / rotor (part arcs scale with the arc), per emitter on drip. */
  gpm: number;
  /** Emitter spacing for drip auto-layout, inches. */
  spacing?: number;
}

export interface IrrigationHead {
  id: string;
  zoneId: string;
  kind: HeadKind;
  at: Point;
  /** Throw radius, inches. */
  radius: number;
  /** Arc swept, degrees (1–360). */
  arc: number;
  /** Direction the arc starts at, degrees from +x; the arc sweeps clockwise on screen. */
  rotation: number;
  /** Flow override, GPM; otherwise from the zone's nozzle default × arc. */
  gpm?: number;
}

export type LayoutPattern = 'square' | 'triangular';

export interface IrrigationZone {
  id: string;
  name: string;
  kind: HeadKind;
  /** Site areas (lawn / bed polygons) this zone waters. */
  areaIds: string[];
  pattern: LayoutPattern;
}

export interface Irrigation {
  zones: IrrigationZone[];
  heads: IrrigationHead[];
  /** Valve manifold location — every zone's lateral starts here. */
  manifold?: Point;
  /** Backflow device / point of connection — the mainline runs from here to the manifold. */
  backflow?: Point;
  /** Available water supply, GPM (measure at the hose bib or ask the water utility). */
  supplyGpm?: number;
  /** Per-kind nozzle figures overriding TYPICAL_NOZZLES. */
  nozzles?: Partial<Record<HeadKind, Nozzle>>;
}

/**
 * Typical manufacturer catalogue figures, as editable defaults — not a spec:
 * 15' fixed-spray nozzle ≈ 3.7 GPM full circle at 30 psi; 30' rotor with a
 * matched-precipitation nozzle ≈ 3 GPM full circle at 45 psi; 1 GPH drip emitter
 * at 18" spacing. Check your nozzle chart and edit these to match.
 */
export const TYPICAL_NOZZLES: Record<HeadKind, Nozzle> = {
  spray: { radius: 15 * 12, gpm: 3.7 },
  rotor: { radius: 30 * 12, gpm: 3.0 },
  drip: { radius: 12, gpm: 1 / 60, spacing: 18 },
};

export const HEAD_LABEL: Record<HeadKind, string> = { spray: 'Spray', rotor: 'Rotor', drip: 'Drip' };

export const EMPTY_IRRIGATION: Irrigation = { zones: [], heads: [] };
