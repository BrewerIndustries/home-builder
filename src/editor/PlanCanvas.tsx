import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Dispatch, type Ref } from 'react';
import {
  clampOpeningOffset,
  dist,
  nearestWall,
  orthoFrom,
  pointAlong,
  samePoint,
  snapToGrid,
  wallDir,
  wallEndpoints,
  wallLength,
  wallNormal,
} from '../model/geometry.ts';
import { rectangleWalls, type Action } from '../model/store.ts';
import { finishedThickness, uid, type Opening, type Outlet, type Point, type Project, type Wall, type WallKind } from '../model/types.ts';
import { OpeningGlyph, PlanDrawing } from './PlanDrawing.tsx';
import { formatFtIn, parseFtIn } from '../model/units.ts';
import { hitTest, type Hit } from './hitTest.ts';

export type Tool = 'select' | 'wall' | 'room' | 'door' | 'window' | 'outlet' | 'calibrate' | 'moveImage';

interface View {
  /** Screen pixels per inch. */
  scale: number;
  ox: number;
  oy: number;
}

type Drag =
  | { kind: 'pan'; sx: number; sy: number; view: View }
  | { kind: 'vertex'; current: Point }
  | { kind: 'opening'; id: string; grab: number }
  | { kind: 'outlet'; id: string }
  | { kind: 'room'; start: Point; end: Point }
  | { kind: 'underlay'; start: Point; origin: Point };

export interface PlanCanvasHandle {
  fit(): void;
  zoom(factor: number): void;
  /** Plan point at the centre of the viewport. */
  center(): Point;
}

interface Props {
  project: Project;
  dispatch: Dispatch<Action>;
  tool: Tool;
  setTool(t: Tool): void;
  wallKind: WallKind;
  selection: Hit | null;
  setSelection(h: Hit | null): void;
  onRoomCreated?(): void;
  ref?: Ref<PlanCanvasHandle>;
}

const SNAP_PX = 10;
const GRID = 6;

export function PlanCanvas({ project, dispatch, tool, setTool, wallKind, selection, setSelection, onRoomCreated, ref }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ scale: 1.2, ox: 80, oy: 80 });
  const [cursor, setCursor] = useState<{ p: Point; snapped: 'endpoint' | 'grid' | null } | null>(null);
  const [chain, setChain] = useState<{ start: Point; first: Point } | null>(null);
  const [roomDrag, setRoomDrag] = useState<{ a: Point; b: Point } | null>(null);
  const [calPoints, setCalPoints] = useState<Point[]>([]);
  const [calText, setCalText] = useState('');
  const [lengthText, setLengthText] = useState('');
  const [shift, setShift] = useState(false);
  const [space, setSpace] = useState(false);
  const drag = useRef<Drag | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const toWorld = useCallback((sx: number, sy: number): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (sx - r.left - v.ox) / v.scale, y: (sy - r.top - v.oy) / v.scale };
  }, []);

  const fit = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const pts = project.walls.flatMap((w) => [w.a, w.b]);
    const u = project.underlay;
    if (u?.visible) pts.push({ x: u.x, y: u.y }, { x: u.x + u.pxWidth * u.scale, y: u.y + u.pxHeight * u.scale });
    const { width, height } = svg.getBoundingClientRect();
    if (!pts.length) {
      setView({ scale: 1.2, ox: 80, oy: 80 });
      return;
    }
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const w = Math.max(Math.max(...xs) - minX, 48);
    const h = Math.max(Math.max(...ys) - minY, 48);
    const scale = Math.min((width - 120) / w, (height - 120) / h, 8);
    setView({ scale, ox: (width - w * scale) / 2 - minX * scale, oy: (height - h * scale) / 2 - minY * scale });
  }, [project.walls, project.underlay]);

  const zoomAt = useCallback((factor: number, sx?: number, sy?: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const cx = sx ?? r.width / 2;
    const cy = sy ?? r.height / 2;
    setView((v) => {
      const scale = Math.min(20, Math.max(0.1, v.scale * factor));
      const k = scale / v.scale;
      return { scale, ox: cx - (cx - v.ox) * k, oy: cy - (cy - v.oy) * k };
    });
  }, []);

  useImperativeHandle(ref, () => ({
    fit,
    zoom: (f) => zoomAt(f),
    center: () => {
      const r = svgRef.current!.getBoundingClientRect();
      return toWorld(r.left + r.width / 2, r.top + r.height / 2);
    },
  }), [fit, zoomAt, toWorld]);

  // Fit once on first mount so a reloaded project opens framed.
  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current) {
      fitted.current = true;
      fit();
    }
  }, [fit]);

  // Wheel: pinch / ctrl-wheel zooms, plain scroll pans (trackpad-friendly).
  useEffect(() => {
    const svg = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      else setView((v) => ({ ...v, ox: v.ox - e.deltaX, oy: v.oy - e.deltaY }));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // Reset in-progress gestures when the tool changes.
  useEffect(() => {
    setChain(null);
    setRoomDrag(null);
    setCalPoints([]);
    setLengthText('');
  }, [tool]);

  const endpoints = wallEndpoints(project.walls);

  const snap = useCallback(
    (raw: Point, opts: { origin?: Point; exclude?: Point; free?: boolean } = {}): { p: Point; snapped: 'endpoint' | 'grid' | null } => {
      const tol = SNAP_PX / viewRef.current.scale;
      let best: Point | null = null;
      for (const e of endpoints) {
        if (opts.exclude && samePoint(e, opts.exclude)) continue;
        if (dist(e, raw) <= tol && (!best || dist(e, raw) < dist(best, raw))) best = e;
      }
      if (best) return { p: { ...best }, snapped: 'endpoint' };
      if (opts.free) return { p: raw, snapped: null };
      let p = raw;
      if (opts.origin && !shift) p = orthoFrom(opts.origin, p);
      p = snapToGrid(p, GRID);
      if (opts.origin && !shift) p = orthoFrom(opts.origin, p);
      return { p, snapped: 'grid' };
    },
    [endpoints, shift],
  );

  const { framing } = project;
  const newWallThickness = finishedThickness(wallKind === 'exterior' ? framing.exteriorStud : framing.interiorStud);
  const makeWall = useCallback(
    (a: Point, b: Point): Wall => ({ id: uid('w'), a, b, kind: wallKind, thickness: newWallThickness, height: framing.wallHeight }),
    [wallKind, newWallThickness, framing.wallHeight],
  );

  const placeWall = useCallback(
    (to: Point) => {
      if (!chain) return;
      if (dist(chain.start, to) < 0.5) return;
      dispatch({ type: 'addWalls', walls: [makeWall(chain.start, to)] });
      const closed = samePoint(to, chain.first);
      setChain(closed ? null : { start: to, first: chain.first });
      setLengthText('');
    },
    [chain, dispatch, makeWall],
  );

  // Keyboard: space-to-pan, shift-for-free-angle, Esc, and typed wall lengths.
  useEffect(() => {
    const isField = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShift(true);
      if (isField(e)) return;
      if (e.key === ' ') {
        setSpace(true);
        e.preventDefault();
      }
      if (e.key === 'Escape') {
        if (lengthText) setLengthText('');
        else if (chain) setChain(null);
        else setTool('select');
      }
      if (tool === 'wall' && chain) {
        if (/^[0-9'". /-]$/.test(e.key) && !(e.key === ' ' && !lengthText)) {
          setLengthText((t) => t + e.key);
          e.preventDefault();
        } else if (e.key === 'Backspace' && lengthText) {
          setLengthText((t) => t.slice(0, -1));
          e.preventDefault();
          e.stopPropagation();
        } else if (e.key === 'Enter' && lengthText && cursor) {
          const len = parseFtIn(lengthText);
          if (len && len > 0) {
            const target = shift ? cursor.p : orthoFrom(chain.start, cursor.p);
            const d = dist(chain.start, target) || 1;
            const dir = d > 0.01 ? { x: (target.x - chain.start.x) / d, y: (target.y - chain.start.y) / d } : { x: 1, y: 0 };
            placeWall({ x: chain.start.x + dir.x * len, y: chain.start.y + dir.y * len });
          }
          e.preventDefault();
        }
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShift(false);
      if (e.key === ' ') setSpace(false);
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up);
    };
  }, [tool, chain, lengthText, cursor, shift, placeWall, setTool]);

  const selectedWall = selection?.kind === 'wall' ? project.walls.find((w) => w.id === selection.id) : undefined;

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (e.button === 2) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const raw = toWorld(e.clientX, e.clientY);
    const slop = 6 / view.scale;

    if (e.button === 1 || space) {
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, view };
      return;
    }

    switch (tool) {
      case 'select': {
        // Endpoint handles of the selected wall first.
        if (selectedWall) {
          for (const end of [selectedWall.a, selectedWall.b]) {
            if (dist(end, raw) <= 10 / view.scale) {
              dispatch({ type: 'checkpoint' });
              drag.current = { kind: 'vertex', current: end };
              return;
            }
          }
        }
        const hit = hitTest(project, raw, slop);
        setSelection(hit);
        if (hit?.kind === 'outlet') {
          dispatch({ type: 'checkpoint' });
          drag.current = { kind: 'outlet', id: hit.id };
        } else if (hit?.kind === 'opening') {
          const o = project.openings.find((x) => x.id === hit.id)!;
          const w = project.walls.find((x) => x.id === o.wallId)!;
          const along = (raw.x - w.a.x) * wallDir(w).x + (raw.y - w.a.y) * wallDir(w).y;
          dispatch({ type: 'checkpoint' });
          drag.current = { kind: 'opening', id: o.id, grab: along - o.offset };
        } else if (!hit) {
          drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, view };
        }
        return;
      }
      case 'wall': {
        const { p } = snap(raw, { origin: chain?.start });
        if (!chain) setChain({ start: p, first: p });
        else placeWall(p);
        return;
      }
      case 'room': {
        const { p } = snap(raw);
        drag.current = { kind: 'room', start: p, end: p };
        setRoomDrag({ a: p, b: p });
        return;
      }
      case 'door':
      case 'window': {
        const near = nearestWall(project.walls, raw, 18 / view.scale + 6);
        if (!near) return;
        const opening = newOpening(tool, near.wall, near.along);
        dispatch({ type: 'addOpening', opening });
        setSelection({ kind: 'opening', id: opening.id });
        return;
      }
      case 'outlet': {
        const near = nearestWall(project.walls, raw, 18 / view.scale + 6);
        if (!near) return;
        const n = wallNormal(near.wall);
        const foot = pointAlong(near.wall, near.along);
        const side = (raw.x - foot.x) * n.x + (raw.y - foot.y) * n.y >= 0 ? 1 : -1;
        const outlet: Outlet = { id: uid('e'), wallId: near.wall.id, offset: Math.round(near.along), side, kind: 'duplex', height: 16, auto: false };
        dispatch({ type: 'addOutlet', outlet });
        setSelection({ kind: 'outlet', id: outlet.id });
        return;
      }
      case 'calibrate': {
        setCalPoints((prev) => (prev.length >= 2 ? [raw] : [...prev, raw]));
        return;
      }
      case 'moveImage': {
        if (!project.underlay) return;
        dispatch({ type: 'checkpoint' });
        drag.current = { kind: 'underlay', start: raw, origin: { x: project.underlay.x, y: project.underlay.y } };
        return;
      }
    }
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const raw = toWorld(e.clientX, e.clientY);
    const d = drag.current;
    if (d?.kind === 'pan') {
      setView({ ...d.view, ox: d.view.ox + e.clientX - d.sx, oy: d.view.oy + e.clientY - d.sy });
      return;
    }
    if (d?.kind === 'vertex') {
      const { p, snapped } = snap(raw, { exclude: d.current });
      setCursor({ p, snapped });
      if (!samePoint(p, d.current)) {
        dispatch({ type: 'moveVertex', from: d.current, to: p, transient: true });
        d.current = p;
      }
      return;
    }
    if (d?.kind === 'opening') {
      const o = project.openings.find((x) => x.id === d.id);
      const w = o && project.walls.find((x) => x.id === o.wallId);
      if (o && w) {
        const dir = wallDir(w);
        const along = (raw.x - w.a.x) * dir.x + (raw.y - w.a.y) * dir.y - d.grab;
        const offset = clampOpeningOffset(w, o.width, Math.round(along));
        if (offset !== o.offset) dispatch({ type: 'updateOpening', id: o.id, patch: { offset }, transient: true });
      }
      return;
    }
    if (d?.kind === 'outlet') {
      const o = project.outlets.find((x) => x.id === d.id);
      const w = o && project.walls.find((x) => x.id === o.wallId);
      if (o && w) {
        const dir = wallDir(w);
        const along = Math.round(Math.max(2, Math.min(wallLength(w) - 2, (raw.x - w.a.x) * dir.x + (raw.y - w.a.y) * dir.y)));
        // Hand-moving an auto outlet adopts it, so re-running auto-layout won't undo the edit.
        if (along !== o.offset) dispatch({ type: 'updateOutlet', id: o.id, patch: { offset: along, auto: false }, transient: true });
      }
      return;
    }
    if (d?.kind === 'room') {
      const { p } = snap(raw);
      d.end = p;
      setRoomDrag({ a: d.start, b: p });
      setCursor({ p, snapped: 'grid' });
      return;
    }
    if (d?.kind === 'underlay') {
      dispatch({ type: 'updateUnderlay', patch: { x: d.origin.x + raw.x - d.start.x, y: d.origin.y + raw.y - d.start.y }, transient: true });
      return;
    }
    if (tool === 'wall') setCursor(snap(raw, { origin: chain?.start }));
    else if (tool === 'room') setCursor(snap(raw));
    else setCursor({ p: raw, snapped: null });
  }

  function onPointerUp(e?: React.PointerEvent<SVGSVGElement>) {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === 'room' && e) d.end = snap(toWorld(e.clientX, e.clientY)).p;
    setRoomDrag(null);
    if (d?.kind === 'room') {
      // Read the rectangle from the ref, not state: a fast drag can release before the last move renders.
      const { start: a, end: b } = d;
      if (Math.abs(a.x - b.x) >= 24 && Math.abs(a.y - b.y) >= 24) {
        const walls = rectangleWalls(a, b, (p, q) => makeWall(p, q));
        const id = uid('r');
        const corners = walls.map((w) => ({ ...w.a }));
        const count = project.rooms.length + 1;
        dispatch({ type: 'addWalls', walls, room: { id, name: `Room ${count}`, type: 'other', points: corners } });
        setSelection({ kind: 'room', id });
        onRoomCreated?.();
      }
    }
  }

  function finishCalibration() {
    const u = project.underlay;
    const real = parseFtIn(calText);
    if (!u || calPoints.length !== 2 || !real) return;
    const measured = dist(calPoints[0], calPoints[1]);
    if (measured < 0.01) return;
    const k = real / measured;
    // Rescale about the first picked point so it stays put under the cursor.
    const anchor = calPoints[0];
    dispatch({
      type: 'updateUnderlay',
      patch: { scale: u.scale * k, x: anchor.x + (u.x - anchor.x) * k, y: anchor.y + (u.y - anchor.y) * k },
    });
    setCalPoints([]);
    setCalText('');
    setTool('select');
    requestAnimationFrame(fit);
  }

  const s = view.scale;
  const px = (n: number) => n / s; // screen px → world inches, for strokes and fonts
  const cursorStyle = space || drag.current?.kind === 'pan' ? 'grab' : tool === 'select' ? 'default' : tool === 'moveImage' ? 'move' : 'crosshair';

  // Ghost opening under the cursor for door/window tools.
  let ghost: { wall: Wall; opening: Opening } | null = null;
  if ((tool === 'door' || tool === 'window') && cursor) {
    const near = nearestWall(project.walls, cursor.p, 18 / s + 6);
    if (near) ghost = { wall: near.wall, opening: newOpening(tool, near.wall, near.along) };
  }

  const u = project.underlay;

  return (
    <div className="canvas-wrap">
      <svg
        ref={svgRef}
        className="plan"
        style={{ cursor: cursorStyle }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => onPointerUp()}
        onLostPointerCapture={() => drag.current && onPointerUp()}
        onPointerLeave={() => !drag.current && setCursor(null)}
        onDoubleClick={() => tool === 'wall' && setChain(null)}
        onContextMenu={(e) => {
          e.preventDefault();
          setChain(null);
        }}
      >
        <defs>
          <pattern id="grid-minor" width={12 * s} height={12 * s} x={view.ox} y={view.oy} patternUnits="userSpaceOnUse">
            <path d={`M ${12 * s} 0 L 0 0 0 ${12 * s}`} fill="none" stroke="var(--grid-minor)" strokeWidth={1} />
          </pattern>
          <pattern id="grid-major" width={120 * s} height={120 * s} x={view.ox} y={view.oy} patternUnits="userSpaceOnUse">
            <rect width={120 * s} height={120 * s} fill="url(#grid-minor)" />
            <path d={`M ${120 * s} 0 L 0 0 0 ${120 * s}`} fill="none" stroke="var(--grid-major)" strokeWidth={1} />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={s * 12 > 6 ? 'url(#grid-major)' : 'var(--canvas)'} />

        <g transform={`translate(${view.ox} ${view.oy}) scale(${s})`}>
          {u?.visible && (
            <image
              href={u.src}
              x={u.x}
              y={u.y}
              width={u.pxWidth * u.scale}
              height={u.pxHeight * u.scale}
              opacity={u.opacity}
              preserveAspectRatio="none"
              style={{ pointerEvents: 'none' }}
            />
          )}

          <PlanDrawing project={project} selection={selection} px={px} wallDims={s * 12 > 4} overallDims={s * 12 > 2} />
          {ghost && <OpeningGlyph wall={ghost.wall} o={ghost.opening} selected={false} ghost px={px} />}

          {selectedWall &&
            [selectedWall.a, selectedWall.b].map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={px(6)} className="handle" strokeWidth={px(2)} />
            ))}

          {chain && cursor && tool === 'wall' && (
            <PreviewSegment a={chain.start} b={cursor.p} thickness={newWallThickness} px={px} />
          )}
          {roomDrag && <PreviewRect a={roomDrag.a} b={roomDrag.b} px={px} />}

          {calPoints.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={px(5)} className="cal-point" />
          ))}
          {calPoints.length === 1 && cursor && <line x1={calPoints[0].x} y1={calPoints[0].y} x2={cursor.p.x} y2={cursor.p.y} className="cal-line" strokeWidth={px(2)} />}
          {calPoints.length === 2 && <line x1={calPoints[0].x} y1={calPoints[0].y} x2={calPoints[1].x} y2={calPoints[1].y} className="cal-line" strokeWidth={px(2)} />}

          {cursor?.snapped === 'endpoint' && <circle cx={cursor.p.x} cy={cursor.p.y} r={px(7)} className="snap" strokeWidth={px(2)} />}
        </g>
      </svg>

      {lengthText && (
        <div className="length-entry">
          Length: <strong>{lengthText}</strong> <span className="muted">↵ to place · Esc to clear</span>
        </div>
      )}

      {tool === 'calibrate' && (
        <div className="float-panel">
          {calPoints.length < 2 ? (
            <p>
              <strong>Calibrate image scale.</strong> Click both ends of a dimension you know on the picture ({calPoints.length}/2).
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                finishCalibration();
              }}
            >
              <label>
                That distance is really
                <input autoFocus value={calText} onChange={(e) => setCalText(e.target.value)} placeholder={`e.g. 12' 6"`} />
              </label>
              <button type="submit" className="primary" disabled={!parseFtIn(calText)}>
                Set scale
              </button>
            </form>
          )}
        </div>
      )}

      <div className="hint">{hintFor(tool, !!chain)}</div>
    </div>
  );
}

function hintFor(tool: Tool, drawing: boolean): string {
  switch (tool) {
    case 'select':
      return 'Click to select · drag empty space to pan · drag wall ends or openings to move · ⌫ deletes';
    case 'wall':
      return drawing ? 'Click to add the next corner · type a length + ↵ · Shift = any angle · double-click / Esc to finish' : 'Click to start a wall';
    case 'room':
      return 'Drag a rectangle — walls already on the plan are reused, not doubled';
    case 'door':
    case 'window':
      return `Click on a wall to place a ${tool}`;
    case 'outlet':
      return 'Click beside a wall to add a receptacle on that face';
    case 'calibrate':
      return 'Pick two points on the image whose real distance you know';
    case 'moveImage':
      return 'Drag to line the picture up with your walls';
  }
}

export function newOpening(kind: 'door' | 'window', wall: Wall, along: number): Opening {
  const width = 36;
  const base = { id: uid(kind === 'door' ? 'd' : 'n'), wallId: wall.id, kind, width, offset: clampOpeningOffset(wall, width, Math.round(along)) };
  return kind === 'door'
    ? { ...base, height: 80, sill: 0, swing: { side: 1, hinge: 'a' } }
    : { ...base, height: 48, sill: 34, style: 'single-hung' };
}

function PreviewSegment({ a, b, thickness, px }: { a: Point; b: Point; thickness: number; px(n: number): number }) {
  const len = dist(a, b);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return (
    <g className="preview">
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={thickness} strokeLinecap="square" />
      {len > 1 && (
        <text x={mid.x} y={mid.y - thickness / 2 - px(10)} fontSize={px(12)} textAnchor="middle" className="preview-label">
          {formatFtIn(len)}
        </text>
      )}
    </g>
  );
}

function PreviewRect({ a, b, px }: { a: Point; b: Point; px(n: number): number }) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(a.x - b.x);
  const h = Math.abs(a.y - b.y);
  return (
    <g className="preview">
      <rect x={x} y={y} width={w} height={h} fill="var(--room-sel)" strokeWidth={px(2)} />
      <text x={x + w / 2} y={y + h / 2} fontSize={px(13)} textAnchor="middle" className="preview-label">
        {formatFtIn(w, { compact: true })} × {formatFtIn(h, { compact: true })}
      </text>
    </g>
  );
}
