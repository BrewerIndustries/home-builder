import { PLANT_BY_ID, type PlantForm } from '../data/plants.ts';
import { dist } from '../model/geometry.ts';
import { EMPTY_SITE, type Point, type Project, type SurfaceMaterial } from '../model/types.ts';
import type { V3 } from './model3d.ts';

// The site in 3D as simple shapes: lot and hardscape as flat polygons just under
// the floor, plants as a trunk + ellipsoid canopy at mature size, retaining
// walls as blocks. Same axes as model3d.ts (plan x → X, plan y → Z, up = Y).

/** Finished grade sits a little under the floor so the slab edge reads. */
export const GRADE_Y = -8;

export interface SiteFlat {
  kind: 'lot' | SurfaceMaterial;
  y: number;
  outline: Point[];
}

export interface SitePlant {
  form: PlantForm;
  /** Canopy centre and radii (x/z, y). */
  c: V3;
  r: number;
  ry: number;
  /** Trunk height (0 for shrubs and smaller). */
  trunk: number;
}

export interface SiteBlock {
  c: V3;
  size: V3;
  rotY: number;
}

export interface SiteScene {
  flats: SiteFlat[];
  plants: SitePlant[];
  walls: SiteBlock[];
  bounds: { min: V3; max: V3 } | null;
}

export function buildSiteScene(project: Project): SiteScene {
  const site = project.site ?? EMPTY_SITE;
  const flats: SiteFlat[] = [];
  if (site.lot && site.lot.length >= 3) flats.push({ kind: 'lot', y: GRADE_Y, outline: site.lot });
  // Hardscape a hair above the lawn so the two don't z-fight; decks up on joists.
  for (const a of site.areas) flats.push({ kind: a.material, y: GRADE_Y + (a.material === 'decking' ? 18 : 0.5), outline: a.points });

  const plants: SitePlant[] = [];
  for (const p of site.plants) {
    const sp = PLANT_BY_ID.get(p.species);
    if (!sp) continue;
    const h = sp.height * 12;
    const r = (sp.spread * 12) / 2;
    if (sp.form === 'tree') {
      const trunk = Math.max(h * 0.35, Math.min(h - 2 * r, h * 0.6));
      plants.push({ form: sp.form, c: [p.at.x, GRADE_Y + trunk + (h - trunk) / 2, p.at.y], r, ry: (h - trunk) / 2, trunk });
    } else {
      plants.push({ form: sp.form, c: [p.at.x, GRADE_Y + h / 2, p.at.y], r, ry: Math.max(1, h / 2), trunk: 0 });
    }
  }

  const walls: SiteBlock[] = [];
  for (const w of site.retainingWalls ?? []) {
    for (let i = 1; i < w.points.length; i++) {
      const a = w.points[i - 1];
      const b = w.points[i];
      const len = dist(a, b);
      if (len < 1) continue;
      walls.push({ c: [(a.x + b.x) / 2, GRADE_Y + w.height / 2, (a.y + b.y) / 2], size: [len, w.height, 12], rotY: -Math.atan2(b.y - a.y, b.x - a.x) });
    }
  }

  const pts = [...flats.flatMap((f) => f.outline), ...plants.map((p) => ({ x: p.c[0], y: p.c[2] }))];
  const bounds: SiteScene['bounds'] = pts.length
    ? {
        min: [Math.min(...pts.map((p) => p.x)), GRADE_Y, Math.min(...pts.map((p) => p.y))],
        max: [Math.max(...pts.map((p) => p.x)), Math.max(0, ...plants.map((p) => p.c[1] + p.ry)), Math.max(...pts.map((p) => p.y))],
      }
    : null;
  return { flats, plants, walls, bounds };
}
