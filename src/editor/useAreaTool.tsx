import { useEffect, useState, type Dispatch } from 'react';
import { dist, polygonArea } from '../model/geometry.ts';
import type { Action } from '../model/store.ts';
import { uid, type Point, type Project, type Room } from '../model/types.ts';
import { formatFtIn, formatSqFt } from '../model/units.ts';
import type { Hit } from './hitTest.ts';

// The Area tool: mark out a room without drawing walls (an open-plan kitchen,
// a dining area, a zone of a great room). Drag a rectangle, or click its
// corners one by one and close it on the first corner, double-click or Enter.
// Backspace takes the last corner off; Esc drops the draft. The room gets the
// `area` flag: it keeps the outline it was given and is never re-fitted to walls.

/** A drag at least this big (inches, each way) is a rectangle; anything less is a corner click. */
const RECT_MIN = 24;
/** Smallest area worth making a room of: 1 sq ft. */
const MIN_AREA = 144;

interface Opts {
  project: Project;
  dispatch: Dispatch<Action>;
  active: boolean;
  setSelection(h: Hit | null): void;
  onMessage?(msg: string): void;
  onCreated?(): void;
}

/** A clockwise-on-screen loop starting top-left, like rooms made from walls. */
function tidy(pts: Point[]): Point[] {
  const out = pts.filter((p, i) => dist(p, pts[(i + 1) % pts.length]) > 0.5);
  let s = 0;
  for (let i = 0; i < out.length; i++) if (out[i].y < out[s].y - 0.5 || (Math.abs(out[i].y - out[s].y) <= 0.5 && out[i].x < out[s].x)) s = i;
  const loop = [...out.slice(s), ...out.slice(0, s)];
  let signed = 0;
  for (let i = 0; i < loop.length; i++) signed += loop[i].x * loop[(i + 1) % loop.length].y - loop[(i + 1) % loop.length].x * loop[i].y;
  return signed >= 0 ? loop : [loop[0], ...loop.slice(1).reverse()];
}

export function useAreaTool({ project, dispatch, active, setSelection, onMessage, onCreated }: Opts) {
  const [corners, setCorners] = useState<Point[]>([]);
  const [hover, setHover] = useState<Point | null>(null);
  const [rect, setRect] = useState<{ a: Point; b: Point } | null>(null);

  function make(points: Point[]) {
    const pts = tidy(points);
    setCorners([]);
    setRect(null);
    if (pts.length < 3 || polygonArea(pts) < MIN_AREA) {
      onMessage?.('Too small for a room — give it at least three corners and some floor.');
      return;
    }
    // No doors or walls to guess from, so it gets a plain name: "Area 1", "Area 2"…
    let n = 1;
    while (project.rooms.some((r) => r.name === `Area ${n}`)) n++;
    const room: Room = { id: uid('r'), name: `Area ${n}`, type: 'other', points: pts, area: true };
    dispatch({ type: 'addWalls', walls: [], room });
    setSelection({ kind: 'room', id: room.id });
    onMessage?.(`Marked out ${room.name} (${formatSqFt(polygonArea(pts))}) — no walls added. Name it and set its use (kitchen, dining…) in the Room panel.`);
    onCreated?.();
  }

  /** Close the corner outline into a room (3+ corners). */
  function finish() {
    if (corners.length >= 3) make(corners);
  }

  function cancel() {
    setCorners([]);
    setRect(null);
  }

  // Esc / Enter / Backspace while a draft is open (capture phase, so Esc doesn't also drop the tool).
  useEffect(() => {
    if (!active) return;
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      if (!corners.length) return;
      if (e.key === 'Escape') cancel();
      else if (e.key === 'Enter') finish();
      else if (e.key === 'Backspace') setCorners((c) => c.slice(0, -1));
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });

  useEffect(() => {
    if (!active) cancel();
  }, [active]);

  return {
    busy: corners.length > 0,
    /** Pointer down at a snapped point: start a possible rectangle. */
    down(p: Point) {
      setRect({ a: p, b: p });
    },
    /** Pointer moved to a snapped point (dragging or not). */
    move(p: Point) {
      setHover(p);
      if (rect) setRect({ a: rect.a, b: p });
    },
    /** Pointer up at a snapped point: a big enough drag is a rectangle, otherwise a corner. */
    up(p: Point) {
      const r = rect;
      setRect(null);
      if (!r) return;
      if (!corners.length && Math.abs(p.x - r.a.x) >= RECT_MIN && Math.abs(p.y - r.a.y) >= RECT_MIN) {
        make([r.a, { x: p.x, y: r.a.y }, p, { x: r.a.x, y: p.y }]);
        return;
      }
      // A corner click; clicking the first corner again closes the outline.
      if (corners.length >= 3 && dist(r.a, corners[0]) < 1) {
        finish();
        return;
      }
      if (corners.length && dist(r.a, corners[corners.length - 1]) < 1) return;
      setCorners([...corners, r.a]);
    },
    finish,
    cancel,
    hint: corners.length
      ? `Click the next corner · click the first corner, double-click or Enter to close (${corners.length} so far) · Backspace takes one off · Esc cancels`
      : 'Drag a rectangle, or click corners one by one, to mark out a room without walls (e.g. a dining or kitchen area in an open plan) · snaps to wall ends and the grid',
    svg(px: (n: number) => number) {
      if (rect && !corners.length && (rect.a.x !== rect.b.x || rect.a.y !== rect.b.y)) {
        const x = Math.min(rect.a.x, rect.b.x);
        const y = Math.min(rect.a.y, rect.b.y);
        const w = Math.abs(rect.a.x - rect.b.x);
        const h = Math.abs(rect.a.y - rect.b.y);
        return (
          <g className="preview">
            <rect x={x} y={y} width={w} height={h} fill="var(--room-sel)" strokeWidth={px(2)} strokeDasharray={`${px(8)} ${px(5)}`} />
            <text x={x + w / 2} y={y + h / 2} fontSize={px(13)} textAnchor="middle" className="preview-label">
              {formatFtIn(w, { compact: true })} × {formatFtIn(h, { compact: true })}
            </text>
          </g>
        );
      }
      if (!corners.length) return null;
      const pts = hover ? [...corners, hover] : corners;
      return (
        <g className="preview">
          <polygon points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="var(--room-sel)" strokeWidth={px(2)} strokeDasharray={`${px(8)} ${px(5)}`} />
          {corners.map((c, i) => (
            <circle key={i} cx={c.x} cy={c.y} r={px(i === 0 ? 6 : 4)} />
          ))}
          {pts.length >= 3 && (
            <text x={pts.reduce((t, p) => t + p.x, 0) / pts.length} y={pts.reduce((t, p) => t + p.y, 0) / pts.length} fontSize={px(13)} textAnchor="middle" className="preview-label">
              {formatSqFt(polygonArea(pts))}
            </text>
          )}
        </g>
      );
    },
  };
}
