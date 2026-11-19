import { pointAlong, pointInPolygon, wallDir, wallLength, wallNormal } from '../model/geometry.ts';
import type { Point, Project, Wall } from '../model/types.ts';
import { floorLayout, floorOutline } from './floor.ts';
import { foundationOf } from './foundation.ts';
import { bearingWalls, foundationWallHeight, interiorFootingSize, pierPadSize } from './foundationV2.ts';
import type { Box, FlatSurface } from './model3d.ts';

// The foundation below the floor for the 3D view (floor surface at y = 0, up is +y):
// slab thickened edges, crawlspace / basement walls on their footings, interior
// bearing footings, girders on posts and pier pads, and the basement slab.
// The perimeter wall's outside face is flush with the house wall's outside face.

const JOIST_DEPTH = { '2x8': 7.25, '2x10': 9.25, '2x12': 11.25 } as const;
const SUBFLOOR = 0.75;
const SILL = 1.5;
const POST = 3.5;
const GIRDER_WIDTH = 4.5; // 3-ply 2x

/** +1 / −1: which side of the wall (along its normal) is outside the footprint. */
function outsideSign(w: Wall, polys: Point[][]): 1 | -1 {
  const n = wallNormal(w);
  const mid = pointAlong(w, wallLength(w) / 2);
  const probe = { x: mid.x + n.x * (w.thickness + 1), y: mid.y + n.y * (w.thickness + 1) };
  return polys.some((p) => pointInPolygon(probe, p)) ? -1 : 1;
}

export function foundationScene(project: Project): { boxes: Box[]; flats: FlatSurface[] } {
  const f = foundationOf(project);
  const boxes: Box[] = [];
  const flats: FlatSurface[] = [];
  const ext = project.walls.filter((w) => w.kind === 'exterior' && wallLength(w) > 0.5);
  if (f.type === 'none' || !ext.length) return { boxes, flats };
  const polys = floorOutline(project);

  /** A box along a wall line, `off` out from its centreline, from y0 up to y1. */
  const along = (w: Wall, kind: Box['kind'], off: number, width: number, extra: number, y0: number, y1: number) => {
    if (y1 - y0 < 0.1 || width < 0.1) return;
    const len = wallLength(w);
    const n = wallNormal(w);
    const mid = pointAlong(w, len / 2);
    const d = wallDir(w);
    boxes.push({ kind, c: [mid.x + n.x * off, (y0 + y1) / 2, mid.y + n.y * off], size: [len + extra, y1 - y0, width], rotY: -Math.atan2(d.y, d.x) });
  };

  if (f.type === 'slab') {
    for (const w of ext) {
      const s = outsideSign(w, polys);
      along(w, 'footing', s * (w.thickness / 2 - f.edgeWidth / 2), f.edgeWidth, w.thickness, -f.edgeDepth, 0);
    }
    const { width, thickness } = interiorFootingSize(f);
    for (const w of bearingWalls(project, f)) along(w, 'footing', 0, width, 0, -(f.slabThickness + thickness), -f.slabThickness);
    return { boxes, flats };
  }

  // Crawlspace / basement: wall top under the sill, joists and subfloor.
  const joist = JOIST_DEPTH[f.joistSize];
  const top = -(SUBFLOOR + joist + SILL);
  const H = foundationWallHeight(f);
  const bottom = top - H;
  const footBottom = bottom - f.footingThickness;
  const t = f.stemThickness;
  for (const w of ext) {
    const s = outsideSign(w, polys);
    const wallOff = s * (w.thickness / 2 - t / 2);
    along(w, 'foundation', wallOff, t, w.thickness, bottom, top);
    along(w, 'footing', wallOff, f.footingWidth, w.thickness + f.footingWidth - t, footBottom, bottom);
  }
  const fs = interiorFootingSize(f);
  for (const w of bearingWalls(project, f)) along(w, 'footing', 0, fs.width, 0, footBottom, footBottom + fs.thickness);

  // Basement slab on the footings' level.
  const slabTop = bottom + (f.type === 'basement' ? f.slabThickness : 0);
  if (f.type === 'basement') for (const p of polys) flats.push({ kind: 'floor', y: slabTop, outline: p, holes: [] });

  // Girders under the joists, on posts standing on pier pads.
  const L = floorLayout(project);
  if (L) {
    const gTop = -(SUBFLOOR + joist);
    const gBottom = gTop - joist;
    for (const g of L.girders) {
      const len = Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y);
      boxes.push({ kind: 'girder', c: [(g.a.x + g.b.x) / 2, (gTop + gBottom) / 2, (g.a.y + g.b.y) / 2], size: [len, joist, GIRDER_WIDTH], rotY: -Math.atan2(g.b.y - g.a.y, g.b.x - g.a.x) });
    }
    const pad = pierPadSize(f);
    const padBottom = f.type === 'basement' ? bottom - pad.thickness : footBottom;
    const postFoot = f.type === 'basement' ? slabTop : padBottom + pad.thickness;
    for (const p of L.piers) {
      boxes.push({ kind: 'footing', c: [p.x, padBottom + pad.thickness / 2, p.y], size: [pad.side, pad.thickness, pad.side], rotY: 0 });
      if (gBottom - postFoot > 0.1) boxes.push({ kind: 'foundation', c: [p.x, (postFoot + gBottom) / 2, p.y], size: [POST, gBottom - postFoot, POST], rotY: 0 });
    }
  }
  return { boxes, flats };
}
