// The project document. Everything downstream (framing, materials, later costing)
// is derived from this — nothing derived is ever stored here.
//
// All lengths are in INCHES. Plan coordinates are inches too: x grows right,
// y grows down (screen convention), origin is arbitrary.

import type { Irrigation } from './irrigation.ts';
import type { NativeRegion } from '../data/plants.ts';
import type { DesignOptions } from './options.ts';
import type { PlanVersion } from './versions.ts';

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
  /** Its own layers (see WallLayer); unset = the project default for its kind. */
  assembly?: WallLayer[];
}

/** One layer of a wall assembly; `stud` is the framing, sized by the wall's stud (its thickness is ignored). */
export type WallLayerKind = 'drywall' | 'stud' | 'sheathing' | 'foam' | 'siding' | 'other';

export interface WallLayer {
  kind: WallLayerKind;
  /** Inches (common product sizes, not code values). */
  thickness: number;
  /** Product name for the estimate, e.g. "OSB" or "Fiber-cement lap". */
  name?: string;
}

/** Default layers per wall kind, listed from one face to the other: inside → outside for exterior walls. */
export interface WallAssemblies {
  exterior: WallLayer[];
  interior: WallLayer[];
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
  /** How a door opens: one hinged leaf (default), a hinged pair, sliding into a wall pocket (on the hinge end's side), bifold panels,
   * two bypass panels sliding past each other in the opening, or a barn door sliding along a track on the swing-side face (toward the hinge end). */
  operation?: DoorOperation;
  /** Window operation — drives the estimated net clear opening for egress checks. */
  style?: WindowStyle;
}

export type DoorOperation = 'swing' | 'double' | 'pocket' | 'bifold' | 'bypass' | 'barn';

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

/** Lighting outlets (ceiling light, ceiling fan with light kit, exterior wall light) and alarms. */
export type FixtureKind = 'light' | 'fan' | 'outdoor' | 'smoke' | 'smoke-co' | 'co';

/** A ceiling device: a lighting outlet or a smoke / CO alarm, at a plan point. */
export interface Fixture {
  id: string;
  kind: FixtureKind;
  at: Point;
  /** Placed by auto-layout (see Outlet.auto). */
  auto: boolean;
  /** Fans: false = fan only, no light kit (doesn't count as the room's lighting outlet). */
  lightKit?: boolean;
}

/** A wall switch. Sits on a wall face like a receptacle and controls lighting outlets. */
export interface WallSwitch {
  id: string;
  wallId: string;
  offset: number;
  side: 1 | -1;
  /** Centre height above the floor. */
  height: number;
  /** Lights (fixture ids) and switched receptacles (outlet ids) this switch controls. Two switches on one light = 3-way. */
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
  /** How the attic and crawlspace are used: storage or equipment needs a light (E3903.4). Unset = not answered. */
  attic?: SpaceUse;
  crawl?: SpaceUse;
  /** Branch circuits (see circuits.ts / loadCalc.ts): appliance nameplates by furniture or cutout id, hand-assigned circuits by device id, per-circuit overrides by circuit key. */
  appliances?: Record<string, ApplianceSetting>;
  circuitOf?: Record<string, string>;
  circuits?: Record<string, CircuitSetting>;
  /** A/C or heat-pump nameplate load, VA — set to add a cooling circuit and weigh cooling against heating. */
  coolingVA?: number;
  /** Finished floor above the outside grade; worked out from the foundation when unset. */
  floorAboveGrade?: number;
  /** Load calculation used for the service size; standard when unset. */
  loadMethod?: 'standard' | 'optional';
}

/** An appliance's nameplate and fuel. Unset VA = a typical figure, flagged as such. */
export interface ApplianceSetting {
  va?: number;
  gas?: boolean;
  /** Sinks: a food-waste disposer under it. Ranges: a microwave-hood over it. */
  disposal?: boolean;
  microwave?: boolean;
}

export interface CircuitSetting {
  amps?: number;
  label?: string;
  afci?: boolean;
  gfci?: boolean;
}

export type SpaceUse = 'none' | 'storage' | 'equipment';

export type CutoutKind = 'sink' | 'range' | 'dishwasher' | 'fridge' | 'pantry' | 'oven';

/**
 * Something set into a counter run. Sinks, ranges and fridges split it into
 * separate countertop spaces (E3901.4); a dishwasher sits under the countertop.
 */
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
export type FurnitureKind =
  | 'toilet' | 'bidet' | 'lavatory' | 'tub' | 'tub-shower' | 'shower' | 'kitchen-sink' | 'laundry-sink'
  | 'washer' | 'dryer' | 'water-heater' | 'furnace' | 'air-handler' | 'range' | 'fridge'
  | 'bed' | 'sofa' | 'chair' | 'table' | 'desk' | 'dresser'
  | 'stairs' | 'closet-rod' | 'corner-shower' | 'neo-shower' | 'linen';

/**
 * A plan symbol: a plumbing fixture or appliance (priced and code-checked) or a
 * piece of furniture (drawn only). A w × d rectangle centred on `at`; unrotated,
 * its back is toward −y and its front toward +y; `rot` turns it clockwise on the
 * plan, in degrees.
 */
export interface Furniture {
  id: string;
  kind: FurnitureKind;
  at: Point;
  rot: number;
  w: number;
  d: number;
  /** Stairs: risers in the flight, and whether it goes down from this floor (else up). The foot on this floor is the front (+y). */
  risers?: number;
  down?: boolean;
  /** Stairs: floor-to-floor height (else estimated from the wall height and a floor), and a landing so many risers from the foot, with or without a door off it. */
  rise?: number;
  landing?: number;
  landingEntry?: boolean;
  /** Stairs: which sides have a handrail, as you walk up from the foot (right when unset), and its height above the nosings (36" when unset). */
  handrails?: 'none' | 'left' | 'right' | 'both';
  handrailHeight?: number;
  /** Lavatory: a double vanity (two basins, each its own lavatory). */
  basins?: 2;
  /** Double vanity: the two basin centres, local x (left, right); a quarter of the width either side of centre when unset. */
  basinAt?: [number, number];
  /** Shower (stall): curbless walk-in — no curb, no door, one side open; that side is the front unless `entry` says left or right. */
  walkIn?: boolean;
  entry?: 'left' | 'right';
  /** Corner and neo-angle showers: door on the front-right instead of the front-left. */
  mirror?: boolean;
  /** Stairs: guards along any side not against a wall (on unless false). */
  guards?: boolean;
  /** Fixtures: the product picked, and rough-in or other notes, for the schedule. */
  model?: string;
  note?: string;
  /** Closet rod + shelf: one rod under a shelf (default), two rods hung one above the other, or a shelf alone. */
  closet?: 'single' | 'double' | 'shelf';
}

export interface Counter {
  id: string;
  a: Point;
  b: Point;
  depth: number;
  /** Which side of a → b the counter extends: +1 = the left-hand normal (as wallNormal), -1 = the other. */
  side: 1 | -1;
  island: boolean;
  cutouts: Cutout[];
  /** Wall cabinets above (wall counters only); on unless false. */
  uppers?: boolean;
  /** Islands / peninsulas: how much of the depth, at the front, is seating overhang (knee space, no cabinets under). */
  seating?: number;
  /** Islands / peninsulas: the top at bar height (42") instead of counter height (36"). */
  bar?: boolean;
  /** The corner cabinet where this counter meets another (an L or a peninsula's end); see cornerCabinets. */
  corner?: CornerCabinet;
  /** Wall cabinets 30" tall unless set (bottoms stay at 54"). */
  upperHeight?: 36 | 42;
  /** Islands / peninsulas: a two-level top, 36" work side at the back, 42" bar ledge over the seating. */
  twoLevel?: boolean;
  /** Set: the run is laid out and priced cabinet by cabinet (see calc/cabinets.ts); unset (old projects): by the linear foot. */
  cabinets?: CabinetPlan;
}

export type BaseCabinetType = 'standard' | 'drawer' | 'trash' | 'sink';

/** Per-run cabinet choices. Stretches are the gaps between fixed units (corner, sink, appliances, tall), start to end. */
export interface CabinetPlan {
  /** Base-cabinet widths per stretch, set by dragging joints; null / missing = stock fill. */
  base?: (number[] | null)[];
  /** Wall-cabinet widths per wall-cabinet span, likewise. */
  upper?: (number[] | null)[];
  /** Base-cabinet types, keyed "stretch.index"; standard when unset. */
  types?: Record<string, BaseCabinetType>;
}

export type CornerCabinet = 'lazy-susan' | 'blind';

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
  /** vaulted / cathedral: index of the outline edge (points[i] → points[i+1]) along the low side; unset = the longest edge. */
  slopeEdge?: number;
}

export interface Room {
  id: string;
  name: string;
  type: RoomType;
  /** Closed polygon, in order. */
  points: Point[];
  ceiling?: Ceiling;
  /** The point the room turns about (its handle on the plan); its outline's centre when unset. */
  pivot?: Point;
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
  /** Price plates, jacks, cripples, sills and header plies from the cut list's boards instead of LF + waste. */
  cutListEstimate?: boolean;
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
  /** Topsoil spread under this area before planting / sod, inches (Landscape v2). */
  topsoil?: number;
  /** Bed / lawn edging around this area's perimeter (Landscape v2). */
  edging?: boolean;
}

export interface Plant {
  id: string;
  /** Key into the plant library (src/data/plants.ts). */
  species: string;
  at: Point;
  /** Set when the plant came from auto-filling this bed (area id); a re-fill replaces them. */
  bed?: string;
}

export interface Site {
  /** Lot boundary, closed polygon. */
  lot?: Point[];
  /** Setback per lot edge (edge i runs lot[i] → lot[i+1]), inches. */
  setbacks: number[];
  /** USDA hardiness zone, e.g. 8 for 8a/8b. */
  zone?: number;
  // Landscape v2 — all optional so older saves load unchanged (see src/calc/landscape.ts).
  /** Region for the plant library's native flag. */
  region?: NativeRegion;
  /** Survey calls the lot was built from (kept for re-editing). */
  traverse?: TraverseLeg[];
  /** Plat / aerial picture under the site plan. */
  underlay?: Underlay;
  easements?: Easement[];
  retainingWalls?: RetainingWall[];
  /** Spot elevations for the foundation-drainage check. */
  grades?: SpotGrade[];
  areas: SiteArea[];
  plants: Plant[];
  /** Sprinkler / drip layout (src/model/irrigation.ts). */
  irrigation?: Irrigation;
}

/** One survey call: a quadrant bearing ("N 45°30' E") and a distance in inches. */
export interface TraverseLeg {
  bearing: string;
  distance: number;
}

/** An easement: a strip along a lot edge (`edge` + `width`) or a drawn area (`points`). */
export interface Easement {
  id: string;
  label?: string;
  edge?: number;
  width?: number;
  points?: Point[];
}

/** A segmental-block retaining wall along a polyline; `height` is exposed height, inches. */
export interface RetainingWall {
  id: string;
  points: Point[];
  height: number;
}

/** A spot elevation, inches (any datum, as long as all spots share it). */
export interface SpotGrade {
  id: string;
  at: Point;
  elev: number;
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

/**
 * Where a placed dimension's point sits relative to what it was snapped to, so
 * it follows it: a wall end (along the wall from that end, off its centreline),
 * a door or window (from its centre along its wall, off the centreline), or a
 * fixture / piece of furniture (in its own frame: x across, y back to front).
 */
export type DimAnchor =
  | { wallId: string; end: 'a' | 'b'; along: number; perp: number }
  | { openingId: string; along: number; perp: number }
  | { furnitureId: string; x: number; y: number }
  /** A counter: `along` its back edge (a → b) from its a end (or its b end / middle), `inset` toward its front. */
  | { counterId: string; from?: 'b' | 'mid'; along: number; inset: number }
  /** A room: one of its outline's corners by index, or its centre when `corner` is unset. */
  | { roomId: string; corner?: number };

/** An angle dimension between two walls: an arc where their lines meet, marked in degrees. */
export interface AngleDim {
  id: string;
  a: string;
  b: string;
}

/** A point an ordinate dimension measures to, pinned like a placed dimension's ends. */
export interface OrdPoint {
  p: Point;
  at?: DimAnchor;
}

/** An ordinate (baseline) dimension: a picked origin, then each further point labelled with its distance from it along `axis`. */
export interface OrdinateDim {
  id: string;
  axis: 'x' | 'y';
  origin: OrdPoint;
  pts: OrdPoint[];
}

/** How the plan's dimensions look: text size (× the usual) and the marks at their ends. Unset = 1×, ticks. */
export interface DimLook {
  text?: number;
  ends?: 'tick' | 'arrow' | 'dot';
}

export interface UserDim {
  id: string;
  a: Point;
  b: Point;
  aAt?: DimAnchor;
  bAt?: DimAnchor;
}

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
  furniture: Furniture[];
  /** What the plan's dimensions measure; centrelines when unset. */
  dimMode?: DimMode;
  /** Which wall faces inside / outside dimensions measure to; finished when unset. */
  dimFaces?: 'finished' | 'framing';
  /** How the plan's strings read: each piece between ticks (chained, the default) or running totals from the first tick. */
  dimStyle?: 'chain' | 'running';
  /** Per-string overrides of dimStyle (string id → style); opening chains included. */
  dimStyles?: Record<string, 'chain' | 'running'>;
  /** Angle dimensions between walls. */
  angleDims?: AngleDim[];
  /** Fixture schedule order: by kind (default) or a section per room. */
  scheduleBy?: 'kind' | 'room';
  /** Dimension strings dragged out from where they're drawn: id → extra inches outward. */
  dimOffsets?: Record<string, number>;
  /** Dimension strings switched off (same ids as dimOffsets): skipped on screen and in print. */
  hiddenDims?: string[];
  /** Dimensions the user placed by picking two points; drawn aligned with a → b, offset by dimOffsets[id]. */
  dims?: UserDim[];
  /** Ordinate (baseline) dimensions; drawn offset by dimOffsets[id]. */
  ordDims?: OrdinateDim[];
  /** Dimension text size and end marks, on the plan and the print sheet. */
  dimLook?: DimLook;
  electrical?: ElectricalSettings;
  framing: FramingSettings;
  /** Default wall layers per kind; unset (projects saved before assemblies) = LEGACY_ASSEMBLIES, the old "+1\" finish" rule. */
  assemblies?: WallAssemblies;
  pricing?: Pricing;
  site?: Site;
  roof?: Roof;
  foundation?: Foundation;
  underlay?: Underlay;
  /** Remodel phase per element id (see phase.ts); missing = new work. */
  phases?: Record<string, 'existing' | 'demo'>;
  /** Design alternates ("Option A", "Plan B"); the active one's plan is this project itself (see options.ts). */
  options?: DesignOptions;
  /** Named, dated snapshots of the plan (see versions.ts). */
  versions?: PlanVersion[];
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
  /** Roof v2: false = one roof over the outline's bounding box (v1); otherwise a roof per wing, valleys where they meet. */
  perWing?: boolean;
  /** Roof v2: dormers on the main roof. */
  dormers?: Dormer[];
  /** Roof v2: attic vent area at 1/300 of the attic (the R806.2 exception conditions are met) instead of 1/150. */
  vent300?: boolean;
}

/** A dormer on one long face of the main roof. Inches. */
export interface Dormer {
  id: string;
  type: 'gable' | 'shed';
  /** Main-roof face: 'a' = the low-x / low-y eave side, 'b' = the other. */
  side: 'a' | 'b';
  /** Centre along the main ridge, from the main roof's start wall face. */
  at: number;
  width: number;
  /** Front wall height above the main roof surface. */
  height: number;
  /** Front wall set back from the main wall line, horizontal. */
  setback: number;
  /** Dormer roof pitch (rise per 12); a shed dormer's must be lower than the main roof's. */
  pitch: number;
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
  return { version: 1, name, walls: [], openings: [], rooms: [], outlets: [], fixtures: [], switches: [], counters: [], furniture: [], framing: { ...DEFAULT_FRAMING } };
}

let counter = 0;
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}
