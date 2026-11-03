// The project document. Everything downstream (framing, materials, later costing)
// is derived from this — nothing derived is ever stored here.
//
// All lengths are in INCHES. Plan coordinates are inches too: x grows right,
// y grows down (screen convention), origin is arbitrary.

export interface Point {
  x: number;
  y: number;
}

export type WallKind = 'exterior' | 'interior';

export interface Wall {
  id: string;
  a: Point;
  b: Point;
  kind: WallKind;
  /** Stud size for this wall; unset = the project default for its kind. */
  stud?: LumberSize;
  /**
   * Finished thickness used for drawing — derived from the stud depth plus
   * finishes (see finishedThickness); the store keeps it in sync.
   */
  thickness: number;
  /** Plate-to-plate height (floor to ceiling framing). */
  height: number;
}

export type OpeningKind = 'door' | 'window';

export interface Opening {
  id: string;
  wallId: string;
  kind: OpeningKind;
  /** Distance from wall.a to the opening's centre, along the wall. */
  offset: number;
  /** Nominal unit width (a "3068" door is 36" wide). */
  width: number;
  /** Nominal unit height. */
  height: number;
  /** Floor to bottom of the unit. 0 for doors. */
  sill: number;
  /** Door swing side: which side of the wall the leaf opens toward, and hinge end. */
  swing?: { side: 1 | -1; hinge: 'a' | 'b' };
  /** Window operation — drives the estimated net clear opening for egress checks. */
  style?: WindowStyle;
}

export type WindowStyle = 'single-hung' | 'slider' | 'casement' | 'fixed';

export type RoomType = 'bedroom' | 'living' | 'kitchen' | 'bath' | 'hall' | 'garage' | 'utility' | 'other';

/** Room types the IRC treats as habitable space (R202): sleeping, living, eating, cooking. */
export const HABITABLE: ReadonlySet<RoomType> = new Set(['bedroom', 'living', 'kitchen']);

export type OutletKind = 'duplex' | 'gfci' | 'dedicated' | '240v';

export interface Outlet {
  id: string;
  wallId: string;
  /** Distance from wall.a along the wall. */
  offset: number;
  /** Which face of the wall: +1 = the wallNormal side, -1 = the other. */
  side: 1 | -1;
  kind: OutletKind;
  /** Centre height above the floor. */
  height: number;
  /** Placed by auto-layout; re-running auto-layout replaces these but never manual ones. */
  auto: boolean;
}

export type FixtureKind = 'light' | 'smoke' | 'smoke-co' | 'co';

/** A ceiling device: a lighting outlet or a smoke / CO alarm, at a plan point. */
export interface Fixture {
  id: string;
  kind: FixtureKind;
  at: Point;
  /** Placed by auto-layout (see Outlet.auto). */
  auto: boolean;
}

/** A wall switch. Sits on a wall face like a receptacle and controls lighting outlets. */
export interface WallSwitch {
  id: string;
  wallId: string;
  offset: number;
  side: 1 | -1;
  /** Centre height above the floor. */
  height: number;
  /** Fixture ids this switch controls. Two switches on one light = 3-way. */
  controls: string[];
  auto: boolean;
}

/** Which side of the plan faces the street — the house's front (E3901.7). */
export type FrontSide = 'bottom' | 'top' | 'left' | 'right';

export interface ElectricalSettings {
  /** Which side of the plan is the front of the house; bottom when unset. */
  front?: FrontSide;
  /** Gas / oil / wood appliances or a fireplace in the house — drives CO alarms (R315). Unset = not answered. */
  fuelAppliances?: boolean;
}

export type CutoutKind = 'sink' | 'range';

/** A sink or range set into a counter. Splits the counter into separate countertop spaces (E3901.4). */
export interface Cutout {
  id: string;
  kind: CutoutKind;
  /** Centre, measured from counter.a along the back edge. */
  offset: number;
  width: number;
}

/**
 * Base cabinets + countertop: a rectangle from its back edge a → b, `depth` deep.
 * A wall counter's back edge sits on a wall face; an island stands free.
 */
export interface Counter {
  id: string;
  a: Point;
  b: Point;
  depth: number;
  /** Which side of a → b the counter extends: +1 = the left-hand normal (as wallNormal), -1 = the other. */
  side: 1 | -1;
  island: boolean;
  cutouts: Cutout[];
}

export type CeilingType = 'flat' | 'vaulted' | 'cathedral' | 'tray' | 'coffered';

export interface Ceiling {
  type: CeilingType;
  /** Flat height, or the LOW side of a vault. Unset = the room's wall height. */
  height?: number;
  /** vaulted (single slope) / cathedral (ridge down the middle): height at the top. */
  peak?: number;
  /** tray: how far the raised centre goes up, and how far in from the walls it starts. */
  trayDepth?: number;
  trayInset?: number;
  /** coffered: beam grid spacing and beam drop below the ceiling. */
  cofferSpacing?: number;
  cofferDepth?: number;
}

export interface Room {
  id: string;
  name: string;
  type: RoomType;
  /** Closed polygon, in order. */
  points: Point[];
  ceiling?: Ceiling;
}

export interface FramingSettings {
  /** On-centre stud spacing. */
  studSpacing: 16 | 24;
  exteriorStud: LumberSize;
  interiorStud: LumberSize;
  /** Height given to newly drawn walls. */
  wallHeight: number;
  /** Waste factor applied to lumber and sheet goods (0.1 = 10%). */
  waste: number;
}

export type LumberSize = '2x4' | '2x6' | '2x8';

export const LUMBER_SIZES: LumberSize[] = ['2x4', '2x6', '2x8'];

/** Dressed depth of a stud, inches. */
export const STUD_DEPTH: Record<LumberSize, number> = { '2x4': 3.5, '2x6': 5.5, '2x8': 7.25 };

export interface Pricing {
  /** Unit price by materials-list item text. Missing items use the sample price. */
  prices: Record<string, number>;
  /** Overhead + profit, fraction of materials subtotal. */
  markup: number;
  /** Sales tax on materials, fraction. */
  tax: number;
}

export type SurfaceMaterial = 'pavers' | 'concrete' | 'gravel' | 'mulch' | 'sod' | 'decking';

/** A hardscape or planting area on the site plan. */
export interface SiteArea {
  id: string;
  material: SurfaceMaterial;
  points: Point[];
  /** Installed depth of the main material (concrete slab, gravel, mulch). Pavers use their own base build-up. */
  depth: number;
  label?: string;
}

export interface Plant {
  id: string;
  /** Key into the plant library (src/data/plants.ts). */
  species: string;
  at: Point;
}

export interface Site {
  /** Lot boundary, closed polygon. */
  lot?: Point[];
  /** Setback per lot edge (edge i runs lot[i] → lot[i+1]), inches. */
  setbacks: number[];
  /** USDA hardiness zone, e.g. 8 for 8a/8b. */
  zone?: number;
  areas: SiteArea[];
  plants: Plant[];
}

/** A traced-over picture of an existing floorplan, placed in plan space. */
export interface Underlay {
  /** Data URL (downscaled JPEG) so it saves with the project. */
  src: string;
  /** Natural pixel size of `src`. */
  pxWidth: number;
  pxHeight: number;
  /** Plan position of the image's top-left corner. */
  x: number;
  y: number;
  /** Inches per image pixel — set by calibrating against a known dimension. */
  scale: number;
  opacity: number;
  visible: boolean;
}

/** Dimensions to wall centrelines, room-side faces, or the outside face of the exterior walls. */
export type DimMode = 'centre' | 'inside' | 'outside';

export interface Project {
  version: 1;
  name: string;
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  outlets: Outlet[];
  fixtures: Fixture[];
  switches: WallSwitch[];
  counters: Counter[];
  /** What the plan's dimensions measure; centrelines when unset. */
  dimMode?: DimMode;
  electrical?: ElectricalSettings;
  framing: FramingSettings;
  pricing?: Pricing;
  site?: Site;
  roof?: Roof;
  foundation?: Foundation;
  underlay?: Underlay;
}

export type RoofType = 'gable' | 'hip' | 'shed' | 'none';
export type RafterSize = '2x6' | '2x8' | '2x10' | '2x12';
export const RAFTER_SIZES: RafterSize[] = ['2x6', '2x8', '2x10', '2x12'];

/** One roof over the whole house (v1: over the exterior walls' bounding rectangle). */
export interface Roof {
  type: RoofType;
  /** Rise per 12 of run. */
  pitch: number;
  /** Eave overhang, horizontal inches past the wall face. */
  overhang: number;
  /** Rake (gable-end) overhang, inches. */
  rake: number;
  /** Ridge direction: along plan x, plan y, or the long side. */
  ridge: 'auto' | 'x' | 'y';
  framing: 'trusses' | 'rafters';
  rafterSize: RafterSize;
  spacing: 16 | 24;
}

export const DEFAULT_ROOF: Roof = { type: 'gable', pitch: 6, overhang: 12, rake: 12, ridge: 'auto', framing: 'trusses', rafterSize: '2x8', spacing: 24 };

export type FoundationType = 'slab' | 'crawl' | 'none';

/** One foundation under the exterior walls. Depths are measured down from finished grade. */
export interface Foundation {
  type: FoundationType;
  /** Slab: concrete thickness. */
  slabThickness: number;
  /** Slab: thickened (turned-down) edge width and overall depth from the top of the slab. */
  edgeWidth: number;
  edgeDepth: number;
  /** Crawlspace: spread footing and stem wall. */
  footingWidth: number;
  footingThickness: number;
  stemHeight: number;
  stemThickness: number;
  stemMaterial: 'poured' | 'cmu';
  /** Bottom of footing (or thickened edge) below grade. */
  footingDepth: number;
  /** Local frost depth, if known — checked against footingDepth. */
  frostDepth?: number;
  /** Framed floor over a crawlspace. */
  joistSize: JoistSize;
  joistSpacing: 12 | 16 | 19.2 | 24;
  /** Direction the joists run (their length): along plan x, plan y, or across the short side. */
  joistDir: 'auto' | 'x' | 'y';
  /** Girder lines under the joists; 'auto' keeps each joist span to 12 ft or less. */
  girders: 'auto' | number;
  /** Posts / piers along a girder, on centre. */
  pierSpacing: number;
  subfloor: 'osb' | 'plywood';
}

export type JoistSize = '2x8' | '2x10' | '2x12';
export const JOIST_SIZES: JoistSize[] = ['2x8', '2x10', '2x12'];

export const DEFAULT_FOUNDATION: Foundation = {
  type: 'slab',
  slabThickness: 4,
  edgeWidth: 12,
  edgeDepth: 18,
  footingWidth: 16,
  footingThickness: 8,
  stemHeight: 24,
  stemThickness: 8,
  stemMaterial: 'poured',
  footingDepth: 12,
  joistSize: '2x10',
  joistSpacing: 16,
  joistDir: 'auto',
  girders: 'auto',
  pierSpacing: 96,
  subfloor: 'osb',
};

export const EMPTY_SITE: Site = { setbacks: [], areas: [], plants: [] };

export const DEFAULT_FRAMING: FramingSettings = {
  studSpacing: 16,
  exteriorStud: '2x6',
  interiorStud: '2x4',
  wallHeight: 97.125,
  waste: 0.1,
};

export function studFor(wall: Wall, framing: FramingSettings): LumberSize {
  return wall.stud ?? (wall.kind === 'exterior' ? framing.exteriorStud : framing.interiorStud);
}

/**
 * Stud depth + finishes: exterior gets 7/16" sheathing + 1/2" drywall, interior
 * 1/2" drywall each side — both round to +1". So 2x6 exterior = 6-1/2", 2x4 interior = 4-1/2".
 */
export function finishedThickness(stud: LumberSize): number {
  return STUD_DEPTH[stud] + 1;
}

// 97-1/8" is the standard "8 foot" wall: three 1-1/2" plates + a 92-5/8" precut stud,
// leaving room for 96" of drywall plus the floor and ceiling finishes.
export const WALL_DEFAULTS: Record<WallKind, { thickness: number; height: number }> = {
  exterior: { thickness: 6.5, height: 97.125 },
  interior: { thickness: 4.5, height: 97.125 },
};

export function emptyProject(name = 'Untitled house'): Project {
  return { version: 1, name, walls: [], openings: [], rooms: [], outlets: [], fixtures: [], switches: [], counters: [], framing: { ...DEFAULT_FRAMING } };
}

let counter = 0;
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}
