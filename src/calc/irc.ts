import { dist, pointAlong, wallLength } from '../model/geometry.ts';
import { HABITABLE, studFor, type Opening, type Point, type Project, type Room, type Wall } from '../model/types.ts';
import { formatFtIn } from '../model/units.ts';
import { ceilingInfo } from './ceilings.ts';
import { roomOutletCount, roomRuns, spacingGaps } from './electrical.ts';
import { exclusiveArea } from './regions.ts';
import { framingTakeoff } from './framing.ts';

// International Residential Code plan checks. Each rule cites its IRC section and
// encodes the numeric requirement only — the code text itself is ICC's and isn't
// reproduced here. Values match the 2018, 2021 and 2024 editions for these rules.
//
// These are a design aid, not a plan review: jurisdictions adopt the IRC with local
// amendments, several rules have exceptions we can't see from a floorplan (e.g.
// mechanical ventilation in lieu of openable windows), and window net clear
// openings are ESTIMATED from the nominal size and operation type.

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'info';

export interface CodeCheck {
  rule: string;
  section: string;
  status: CheckStatus;
  /** What was checked, in plain words. */
  message: string;
  /** Plan element this applies to (room / opening / wall id), for selection. */
  targetId?: string;
}

const SQFT = 144;

/** Estimated net clear opening of a window by operation type (manufacturer data wins). */
export function netClearOpening(o: Opening): { width: number; height: number; area: number } {
  const style = o.style ?? 'single-hung';
  let width: number;
  let height: number;
  switch (style) {
    case 'casement':
      width = o.width - 5;
      height = o.height - 6;
      break;
    case 'slider':
      width = o.width / 2 - 4;
      height = o.height - 5;
      break;
    case 'fixed':
      width = 0;
      height = 0;
      break;
    default: // single-/double-hung: lower sash
      width = o.width - 4;
      height = o.height / 2 - 4;
  }
  width = Math.max(0, width);
  height = Math.max(0, height);
  return { width, height, area: (width * height) / SQFT };
}

/** Openings whose centre lies on one of the room's edges. */
export function openingsInRoom(project: Project, room: Room): { opening: Opening; wall: Wall }[] {
  const walls = new Map(project.walls.map((w) => [w.id, w]));
  const out: { opening: Opening; wall: Wall }[] = [];
  for (const o of project.openings) {
    const wall = walls.get(o.wallId);
    if (!wall) continue;
    const mid = pointAlong(wall, o.offset);
    if (onPolygonEdge(room.points, mid, wall.thickness / 2 + 1)) out.push({ opening: o, wall });
  }
  return out;
}

/** Walls lying along the room's edges (their midpoint is on the boundary). */
export function wallsOfRoom(project: Project, room: Room): Wall[] {
  return project.walls.filter((w) => onPolygonEdge(room.points, pointAlong(w, wallLength(w) / 2), 1));
}

function onPolygonEdge(pts: Point[], p: Point, tol: number): boolean {
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = dist(a, b);
    if (!len) continue;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len)));
    if (dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }) <= tol) return true;
  }
  return false;
}

function minDimension(pts: Point[]): number {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

const sqft = (n: number) => `${n.toFixed(1)} sq ft`;

export function ircChecks(project: Project): CodeCheck[] {
  const checks: CodeCheck[] = [];
  const add = (c: CodeCheck) => checks.push(c);

  for (const room of project.rooms) {
    const area = exclusiveArea(project, room) / SQFT;
    const habitable = HABITABLE.has(room.type);
    const label = room.name || room.type;

    // R304 — minimum room area and dimension (kitchens exempt).
    if (habitable && room.type !== 'kitchen') {
      add({
        rule: 'Minimum habitable room area (70 sq ft)',
        section: 'R304.1',
        status: area >= 70 ? 'pass' : 'fail',
        message: `${label}: ${sqft(area)}`,
        targetId: room.id,
      });
      const dim = minDimension(room.points);
      add({
        rule: 'Minimum habitable room dimension (7 ft)',
        section: 'R304.2',
        status: dim >= 84 ? 'pass' : 'fail',
        message: `${label}: narrowest ${formatFtIn(dim)}`,
        targetId: room.id,
      });
    }

    // R305 — ceiling height. Sloped ceilings (R305.1.1 exception) may dip below 7 ft
    // over part of the room; we flag those for review rather than fail them.
    if (habitable || ['hall', 'bath', 'utility'].includes(room.type)) {
      const ceil = ceilingInfo(project, room);
      const sloped = ceil.type === 'vaulted' || ceil.type === 'cathedral';
      add({
        rule: 'Minimum ceiling height (7 ft)',
        section: sloped && ceil.low < 84 ? 'R305.1.1' : 'R305.1',
        status: ceil.low >= 84 ? 'pass' : sloped && ceil.high >= 84 ? 'warn' : 'fail',
        message:
          ceil.low >= 84
            ? `${label}: ${ceil.label}`
            : sloped
              ? `${label}: low side ${formatFtIn(ceil.low)} — at least half the required floor area needs 7 ft, and anything under 5 ft doesn't count as floor area`
              : `${label}: ${formatFtIn(ceil.low)}${ceil.type === 'coffered' ? ' under the coffer beams' : ''}`,
        targetId: room.id,
      });
    }

    const inRoom = openingsInRoom(project, room);
    const windows = inRoom.filter((x) => x.opening.kind === 'window').map((x) => x.opening);

    // R303.1 — natural light (glazing ≥ 8% of floor) and ventilation (openable ≥ 4%).
    if (habitable && area > 0) {
      const glazing = windows.reduce((s, o) => s + (o.width * o.height) / SQFT, 0);
      const openable = windows.reduce((s, o) => {
        const g = (o.width * o.height) / SQFT;
        return s + (o.style === 'fixed' ? 0 : o.style === 'casement' ? g : g / 2);
      }, 0);
      add({
        rule: 'Natural light: glazing ≥ 8% of floor area',
        section: 'R303.1',
        status: glazing >= area * 0.08 ? 'pass' : 'warn',
        message: `${label}: ${sqft(glazing)} glazing, needs ${sqft(area * 0.08)} (or artificial light per exception)`,
        targetId: room.id,
      });
      add({
        rule: 'Natural ventilation: openable ≥ 4% of floor area',
        section: 'R303.1',
        status: openable >= area * 0.04 ? 'pass' : 'warn',
        message: `${label}: ~${sqft(openable)} openable, needs ${sqft(area * 0.04)} (or mechanical ventilation per exception)`,
        targetId: room.id,
      });
    }

    // R310 — emergency escape and rescue opening in every sleeping room.
    if (room.type === 'bedroom') {
      const exteriorDoor = inRoom.some((x) => x.opening.kind === 'door' && x.wall.kind === 'exterior');
      const qualifying = windows.filter((o) => {
        const nc = netClearOpening(o);
        return nc.area >= 5.7 && nc.height >= 24 && nc.width >= 20 && o.sill <= 44;
      });
      const best = windows.map((o) => ({ o, nc: netClearOpening(o) })).sort((p, q) => q.nc.area - p.nc.area)[0];
      add({
        rule: 'Sleeping room emergency escape opening',
        section: 'R310.1–R310.2',
        status: qualifying.length || exteriorDoor ? 'pass' : 'fail',
        message: qualifying.length || exteriorDoor
          ? `${label}: ${exteriorDoor ? 'exterior door' : `window ≈ ${sqft(netClearOpening(qualifying[0]).area)} net clear`}`
          : best
            ? `${label}: best window ≈ ${sqft(best.nc.area)} net clear, ${formatFtIn(best.nc.width)} W × ${formatFtIn(best.nc.height)} H, sill ${formatFtIn(best.o.sill)} — needs 5.7 sq ft (5.0 at grade), 20" W, 24" H, sill ≤ 44"`
            : `${label}: no window — needs an escape opening of 5.7 sq ft net clear`,
        targetId: room.id,
      });
    }
  }

  // E3901 — receptacle layout. Only once the plan has outlets; before that, one nudge.
  if (project.rooms.length && !project.outlets.length) {
    add({ rule: 'Receptacles', section: 'E3901', status: 'info', message: 'no receptacles on the plan yet — use “Auto-place outlets” on the Plan tab' });
  } else {
    for (const room of project.rooms) {
      const label = room.name || room.type;
      if (room.type === 'bath') {
        const has = roomOutletCount(project, room, 'gfci') > 0;
        add({ rule: 'Bathroom GFCI receptacle near the basin', section: 'E3901.6 / E3902', status: has ? 'pass' : 'fail', message: `${label}: ${has ? 'GFCI present — confirm it is within 36" of the basin' : 'needs a GFCI receptacle within 36" of each basin'}`, targetId: room.id });
        continue;
      }
      if (room.type === 'hall') {
        const long = roomRuns(project, room).some((r) => r.length >= 120);
        if (long) {
          const has = roomOutletCount(project, room) > 0;
          add({ rule: 'Hallway receptacle (10 ft or longer)', section: 'E3901.10', status: has ? 'pass' : 'fail', message: `${label}`, targetId: room.id });
        }
        continue;
      }
      const g = spacingGaps(project, room);
      const kitchen = room.type === 'kitchen';
      add({
        rule: kitchen ? 'Countertop receptacle spacing (≤ 4 ft apart)' : 'Receptacle spacing (no point > 6 ft away)',
        section: kitchen ? 'E3901.4' : 'E3901.2',
        status: !g.uncovered && g.worst <= g.limit + 0.5 ? 'pass' : 'fail',
        message: g.uncovered
          ? `${label}: a wall space has no receptacle`
          : `${label}: widest gap ${formatFtIn(g.worst)} (max ${formatFtIn(g.limit, { compact: true })})`,
        targetId: room.id,
      });
      if (['kitchen', 'garage', 'utility'].includes(room.type)) {
        const bad = roomOutletCount(project, room, 'duplex');
        if (bad) add({ rule: 'GFCI protection', section: 'E3902', status: 'warn', message: `${label}: ${bad} receptacle(s) not marked GFCI`, targetId: room.id });
      }
    }
  }

  // R311.2 — at least one egress door: side-hinged, 32" clear width, 78" clear height.
  const wallsById = new Map(project.walls.map((w) => [w.id, w]));
  const exteriorDoors = project.openings.filter((o) => o.kind === 'door' && wallsById.get(o.wallId)?.kind === 'exterior');
  if (project.walls.length) {
    // A nominal 36" × 80" door leaf yields ~32-3/4" × 78-1/2" clear once stops and the open leaf are deducted.
    const egress = exteriorDoors.find((o) => o.width - 3.25 >= 32 && o.height - 1.5 >= 78);
    add({
      rule: 'Egress door (32" clear width, 78" clear height)',
      section: 'R311.2',
      status: egress ? 'pass' : 'fail',
      message: egress
        ? `${Math.round(egress.width)}" × ${Math.round(egress.height)}" exterior door`
        : exteriorDoors.length
          ? 'no exterior door is big enough — use at least a 3068 (36" × 80") side-hinged door'
          : 'no exterior door on the plan',
      targetId: egress?.id,
    });
  }

  // R308.4 — hazardous locations for glazing.
  for (const o of project.openings) {
    if (o.kind !== 'window') continue;
    const wall = wallsById.get(o.wallId);
    if (!wall) continue;
    const nearDoor = project.openings.some(
      (d) => d.kind === 'door' && d.wallId === o.wallId && Math.abs(d.offset - o.offset) - (d.width + o.width) / 2 <= 24,
    );
    if (nearDoor && o.sill < 60) {
      add({
        rule: 'Safety glazing next to a door',
        section: 'R308.4.2',
        status: 'warn',
        message: `window within 24" of a door with its bottom below 60" — specify tempered glass`,
        targetId: o.id,
      });
    }
    const pane = (o.width * o.height) / SQFT;
    if (pane > 9 && o.sill < 18 && o.sill + o.height > 36) {
      add({
        rule: 'Safety glazing in large low windows',
        section: 'R308.4.3',
        status: 'warn',
        message: `${sqft(pane)} window with sill ${formatFtIn(o.sill)} — specify tempered glass (or raise the sill to 18")`,
        targetId: o.id,
      });
    }
  }

  // R602.3 — prescriptive stud walls stop at 10 ft laterally unsupported height.
  for (const w of project.walls) {
    if (w.height > 120) {
      add({
        rule: 'Stud wall height beyond prescriptive limit',
        section: 'R602.3(5)',
        status: 'warn',
        message: `${formatFtIn(w.height)} wall exceeds 10 ft — needs an engineered design`,
        targetId: w.id,
      });
    }
  }
  if (project.framing.studSpacing === 24 && project.walls.some((w) => w.kind === 'exterior' && studFor(w, project.framing) === '2x4')) {
    add({
      rule: 'Stud spacing',
      section: 'R602.3(5)',
      status: 'info',
      message: '2x4 at 24" o.c. is allowed only for walls carrying a roof and ceiling — not a floor above',
    });
  }

  // Header sizing reminder — the framing takeoff uses a rule of thumb.
  const takeoff = framingTakeoff(project);
  if (takeoff.walls.some((f) => f.headers.length)) {
    add({
      rule: 'Header sizes',
      section: 'R602.7',
      status: 'info',
      message: 'header sizes in the framing takeoff are a rule of thumb — confirm against Table R602.7(1) for your ground snow load and building width',
    });
  }
  for (const f of takeoff.walls) for (const n of f.notes) add({ rule: 'Framing', section: 'R602.7', status: 'warn', message: n, targetId: f.wallId });

  return checks;
}

/** Things this checker does not look at — shown so nobody mistakes silence for compliance. */
export const NOT_CHECKED = [
  'Wall bracing (R602.10)',
  'Smoke and CO alarms (R314, R315)',
  'Lighting outlets, switches, dedicated appliance circuits, AFCI (E3903, E3703, E3902.16)',
  'Outdoor receptacles front and back (E3901.7)',
  'Stairways, handrails and guards (R311.7, R312)',
  'Hallway width (R311.6)',
  'Fire separation, garage–dwelling (R302)',
  'Energy efficiency (Chapter 11)',
  'Foundations, floors and roof framing (Chapters 4, 5, 8)',
];
