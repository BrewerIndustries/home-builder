import { rectangleWalls } from '../src/model/store.ts';
import { emptyProject, WALL_DEFAULTS, type Opening, type Project, type Wall, type WallKind } from '../src/model/types.ts';

let n = 0;
export function wall(ax: number, ay: number, bx: number, by: number, kind: WallKind = 'exterior'): Wall {
  n += 1;
  return { id: `w${String(n).padStart(3, '0')}`, a: { x: ax, y: ay }, b: { x: bx, y: by }, kind, ...WALL_DEFAULTS[kind] };
}

export function box(w: number, h: number, kind: WallKind = 'exterior'): Wall[] {
  return rectangleWalls({ x: 0, y: 0 }, { x: w, y: h }, (a, b) => wall(a.x, a.y, b.x, b.y, kind));
}

export function project(walls: Wall[], openings: Opening[] = [], patch: Partial<Project> = {}): Project {
  return { ...emptyProject('test'), walls, openings, ...patch };
}

export function door(wallId: string, offset: number, width = 36, height = 80): Opening {
  return { id: `d${offset}`, wallId, kind: 'door', offset, width, height, sill: 0 };
}

export function window_(wallId: string, offset: number, width = 36, height = 48, sill = 32, style: Opening['style'] = 'single-hung'): Opening {
  return { id: `n${offset}`, wallId, kind: 'window', offset, width, height, sill, style };
}
