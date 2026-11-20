import { useEffect, useRef, useState, type Dispatch } from 'react';
import { HANDLES, handlePoint, resizeFurniture, type Handle } from '../calc/furnitureResize.ts';
import { furniturePoint } from '../calc/furniture.ts';
import { dist } from '../model/geometry.ts';
import type { Action } from '../model/store.ts';
import type { Furniture, Point, Project } from '../model/types.ts';
import { formatFtIn } from '../model/units.ts';

// Double-click a fixture to resize it: handles appear on its corners and edge
// midpoints; drag one and the opposite edge stays put (Alt: grow about the
// centre). Whole inches; each drag is one undo step. Esc, or selecting
// something else, puts the handles away. Exact sizes: Width / Depth in the panel.

interface Opts {
  project: Project;
  dispatch: Dispatch<Action>;
  /** The selected fixture's id, if a fixture is selected (handles go away when it isn't). */
  selectedId: string | null;
  active: boolean;
}

export function useFurnitureResize({ project, dispatch, selectedId, active }: Opts) {
  const [id, setId] = useState<string | null>(null);
  const drag = useRef<{ id: string; h: Handle; orig: Furniture; started: boolean } | null>(null);
  const [live, setLive] = useState<{ w: number; d: number } | null>(null);
  const f = id ? project.furniture.find((x) => x.id === id) : undefined;

  // Put the handles away when the fixture is no longer the selection, it's gone, or the tool changes.
  useEffect(() => {
    if (id && (!active || selectedId !== id || !f)) setId(null);
  }, [id, active, selectedId, f]);

  useEffect(() => {
    if (!id) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      setId(null);
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [id]);

  return {
    resizing: id,
    start(fid: string) {
      setId(fid);
    },
    /** Pointer down: grab a handle if one is under the pointer (`tol` in inches). */
    down(raw: Point, tol: number): boolean {
      if (!f) return false;
      let best: Handle | null = null;
      let bestD = tol;
      for (const h of HANDLES) {
        const d = dist(handlePoint(f, h), raw);
        if (d <= bestD) [best, bestD] = [h, d];
      }
      if (!best) return false;
      drag.current = { id: f.id, h: best, orig: f, started: false };
      return true;
    },
    move(raw: Point, fromCentre: boolean): boolean {
      const g = drag.current;
      if (!g) return false;
      const next = resizeFurniture(g.orig, g.h, raw, { fromCentre });
      const cur = project.furniture.find((x) => x.id === g.id);
      if (!cur || (cur.w === next.w && cur.d === next.d && cur.at.x === next.at.x && cur.at.y === next.at.y)) return true;
      if (!g.started) dispatch({ type: 'checkpoint' });
      g.started = true;
      dispatch({ type: 'updateFurniture', id: g.id, patch: next, transient: true });
      setLive({ w: next.w, d: next.d });
      return true;
    },
    up(): boolean {
      if (!drag.current) return false;
      drag.current = null;
      setLive(null);
      return true;
    },
    /** The handles (and a live size readout while dragging). */
    svg(px: (n: number) => number) {
      if (!f) return null;
      const s = px(9);
      const label = live;
      const c = furniturePoint(f, 0, f.d / 2 + px(18));
      return (
        <g className="resize-handles">
          <polygon
            points={[furniturePoint(f, -f.w / 2, -f.d / 2), furniturePoint(f, f.w / 2, -f.d / 2), furniturePoint(f, f.w / 2, f.d / 2), furniturePoint(f, -f.w / 2, f.d / 2)].map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            strokeWidth={px(1.25)}
            strokeDasharray={`${px(5)} ${px(4)}`}
          />
          {HANDLES.map((h) => {
            const p = handlePoint(f, h);
            const cursor = h.sx && h.sy ? (h.sx * h.sy > 0 ? 'nwse-resize' : 'nesw-resize') : h.sx ? 'ew-resize' : 'ns-resize';
            return <rect key={`${h.sx}${h.sy}`} x={p.x - s / 2} y={p.y - s / 2} width={s} height={s} strokeWidth={px(1.5)} transform={`rotate(${f.rot} ${p.x} ${p.y})`} style={{ cursor }} />;
          })}
          {label && (
            <text x={c.x} y={c.y} fontSize={px(13)} textAnchor="middle" className="preview-label">
              {formatFtIn(label.w, { compact: true })} × {formatFtIn(label.d, { compact: true })}
            </text>
          )}
        </g>
      );
    },
  };
}
