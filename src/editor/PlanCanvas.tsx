import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Dispatch, type Ref } from 'react';
import {
  clampOpeningOffset,
  dist,
  nearestWall,
  orthoFrom,
  pointAlong,
  projectOnWall,
  samePoint,
  snapToGrid,
  wallDir,
  wallEndpoints,
  wallLength,
  wallNormal,
} from '../model/geometry.ts';
import { rectangleWalls, type Action } from '../model/store.ts';
import { coRequired, isLight, roomAt, SWITCH_HEIGHT } from '../calc/lighting.ts';
import { enclosedArea, samePolygon } from '../calc/enclosure.ts';
import { guessRoom } from '../calc/roomGuess.ts';
import { retarget, snapAngle, snapEndToWalls, snapWallMove, splitAt, swingEnd, wallDragPoints, wallSnapTargets, type WallSnapTarget } from '../model/wallEdit.ts';
import { counterDir, newCounters } from '../calc/counters.ts';
import { newFurniture, placeFurniture } from '../calc/furniture.ts';
import { finishedThickness, uid, type Counter, type Fixture, type FurnitureKind, type WallSwitch, type Opening, type Outlet, type Point, type Project, type Wall, type WallKind } from '../model/types.ts';
import { CounterGlyph, FurnitureGlyph, OpeningGlyph, PlanDrawing } from './PlanDrawing.tsx';
import { straightenUnderlay } from '../model/imaging.ts';
import { formatFtIn, parseFtIn } from '../model/units.ts';
import { hitTest, type Hit } from './hitTest.ts';

export type Tool = 'select' | 'wall' | 'room' | 'door' | 'window' | 'outlet' | 'light' | 'switch' | 'alarm' | 'counter' | 'furniture' | 'calibrate' | 'straighten' | 'moveImage';

interface View {
  /** Screen pixels per inch. */
  scale: number;
  ox: number;
  oy: number;
}

type Drag =
  | { kind: 'pan'; sx: number; sy: number; view: View }
  /** A wall end; `anchor` is the selected wall's other end (Alt swings round it, keeping `radius`). */
  | { kind: 'vertex'; start: Point; current: Point; anchor: Point; radius: number; swung: boolean }
  /** Whole-wall drag: slides across its own length; `current` = the points travelling with it. */
  | { kind: 'wall'; start: Point; normal: Point; moved: number; current: Point[]; started: boolean; snap: { start: number; targets: WallSnapTarget[] }; square: boolean }
  | { kind: 'opening'; id: string; grab: number; from: number }
  | { kind: 'outlet'; id: string }
  | { kind: 'switch'; id: string }
  | { kind: 'fixture'; id: string; grab: Point }
  | { kind: 'furniture'; id: string; grab: Point; started: boolean; from: Point }
  | { kind: 'room'; start: Point; end: Point; raw: Point }
  | { kind: 'newCounter'; start: Point; end: Point }
  | { kind: 'counter'; id: string; start: Point; a: Point; b: Point; along: Point | null; started: boolean }
  | { kind: 'underlay'; start: Point; origin: Point }
  /** A dimension string dragged in or out; `out` is its outward unit direction. */
  | { kind: 'dim'; id: string; out: Point; start: Point; base: number; started: boolean };

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
  /** What the Fixture tool places. */
  furnitureKind: FurnitureKind;
  selection: Hit | null;
  setSelection(h: Hit | null): void;
  onRoomCreated?(): void;
  onMessage?(msg: string): void;
  ref?: Ref<PlanCanvasHandle>;
}

/** The last drag, so a typed value can set it exactly: a wall's move, an end's length, or a swing's angle. */
type LastEdit =
  | { kind: 'move'; points: Point[]; normal: Point; moved: number }
  | { kind: 'end'; at: Point; anchor: Point }
  | { kind: 'swing'; at: Point; anchor: Point; radius: number }
  /** An opening (along its wall: x = offset), counter or fixture dragged from → to; a typed distance sets how far, same direction. */
  | { kind: 'item'; item: 'opening' | 'counter' | 'furniture'; id: string; from: Point; to: Point };

const SNAP_PX = 10;
const GRID = 6;

export function PlanCanvas({ project, dispatch, tool, setTool, wallKind, furnitureKind, selection, setSelection, onRoomCreated, onMessage, ref }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ scale: 1.2, ox: 80, oy: 80 });
  const [cursor, setCursor] = useState<{ p: Point; snapped: 'endpoint' | 'grid' | null } | null>(null);
  const [chain, setChain] = useState<{ start: Point; first: Point } | null>(null);
  const [roomDrag, setRoomDrag] = useState<{ a: Point; b: Point } | null>(null);
  const [counterDraft, setCounterDraft] = useState<Counter[]>([]);
  const [calPoints, setCalPoints] = useState<Point[]>([]);
  const [calText, setCalText] = useState('');
  const [realW, setRealW] = useState('');
  const [realH, setRealH] = useState('');
  const [straightening, setStraightening] = useState(false);
  const [lengthText, setLengthText] = useState('');
  const [moveText, setMoveText] = useState<string | null>(null);
  const lastEdit = useRef<LastEdit | null>(null);
  const [entry, setEntry] = useState('');
  // A typed value only applies straight after the drag it sets.
  useEffect(() => {
    lastEdit.current = null;
    setEntry('');
    setMoveText(null);
  }, [tool, project.name]);
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
    if (width < 200 || height < 200) return; // not laid out yet (hidden tab, print, first paint)
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
    const scale = Math.max(0.05, Math.min((width - 120) / w, (height - 120) / h, 8));
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
    (raw: Point, opts: { origin?: Point; exclude?: Point; free?: boolean } = {}): { p: Point; snapped: 'endpoint' | 'grid' | null; note?: string } => {
      const tol = SNAP_PX / viewRef.current.scale;
      let best: Point | null = null;
      for (const e of endpoints) {
        if (opts.exclude && samePoint(e, opts.exclude)) continue;
        if (dist(e, raw) <= tol && (!best || dist(e, raw) < dist(best, raw))) best = e;
      }
      if (best) return { p: { ...best }, snapped: 'endpoint' };
      if (opts.free) return { p: raw, snapped: null };
      // Shift (free angle) from a wall start: lock parallel or square to another wall when close.
      if (opts.origin && shift) {
        const a = snapAngle(project.walls, opts.origin, raw);
        if (a) return { p: a.p, snapped: null, note: a.label };
      }
      let p = raw;
      if (opts.origin && !shift) p = orthoFrom(opts.origin, p);
      p = snapToGrid(p, GRID);
      if (opts.origin && !shift) p = orthoFrom(opts.origin, p);
      return { p, snapped: 'grid' };
    },
    [endpoints, shift, project.walls],
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
      const last = lastEdit.current;
      if (last && !(tool === 'wall' && chain)) {
        if (/^[0-9'". /°-]$/.test(e.key) && !(e.key === ' ' && !entry)) {
          setEntry((t) => t + e.key);
          e.preventDefault();
          return;
        }
        if (e.key === 'Backspace' && entry) {
          setEntry((t) => t.slice(0, -1));
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (e.key === 'Enter' && entry) {
          applyEntry(last, entry);
          setEntry('');
          e.preventDefault();
          return;
        }
        if (e.key === 'Escape') {
          lastEdit.current = null;
          setEntry('');
          setMoveText(null);
          return;
        }
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
  }, [tool, chain, lengthText, cursor, shift, placeWall, setTool, entry]);

  /** Set the last drag exactly from typed text: a distance moved, an end's length, or a swing's angle. */
  function applyEntry(last: LastEdit, text: string) {
    const neg = text.trim().startsWith('-');
    const body = text.replace(/^\s*-/, '');
    if (last.kind === 'swing') {
      const deg = Number(body.replace('°', '').trim()) * (neg ? -1 : 1);
      if (!Number.isFinite(deg)) return;
      const to = swingEnd(last.anchor, last.radius, { x: last.anchor.x + Math.cos((deg * Math.PI) / 180), y: last.anchor.y - Math.sin((deg * Math.PI) / 180) }, 0).p;
      dispatch({ type: 'moveVertex', from: last.at, to, transient: true });
      lastEdit.current = { ...last, at: to };
      setMoveText(`Turned to ${(((deg % 360) + 360) % 360)}° · length kept`);
      return;
    }
    const len = parseFtIn(body);
    if (len === null || len < 0) return;
    if (last.kind === 'item') {
      const to = retarget(last.from, last.to, neg ? -len : len);
      if (!to) return;
      if (last.item === 'opening') {
        const o = project.openings.find((x) => x.id === last.id);
        const w = o && project.walls.find((x) => x.id === o.wallId);
        if (!o || !w) return;
        const offset = clampOpeningOffset(w, o.width, to.x);
        dispatch({ type: 'updateOpening', id: o.id, patch: { offset }, transient: true });
        lastEdit.current = { ...last, to: { x: offset, y: 0 } };
        setMoveText(`Moved ${formatFtIn(Math.abs(offset - last.from.x))}${offset !== to.x ? ' (kept inside the wall)' : ''}`);
        return;
      }
      if (last.item === 'counter') {
        const c = project.counters.find((x) => x.id === last.id);
        if (!c) return;
        const shift = { x: to.x - c.a.x, y: to.y - c.a.y };
        dispatch({ type: 'updateCounter', id: c.id, patch: { a: to, b: { x: c.b.x + shift.x, y: c.b.y + shift.y } }, transient: true });
      } else {
        dispatch({ type: 'updateFurniture', id: last.id, patch: { at: to }, transient: true });
      }
      lastEdit.current = { ...last, to };
      setMoveText(`Moved ${formatFtIn(len)}${neg ? ' back' : ''}`);
      return;
    }
    if (last.kind === 'move') {
      const want = (neg ? -1 : 1) * (Math.sign(last.moved) || 1) * len;
      const delta = { x: last.normal.x * (want - last.moved), y: last.normal.y * (want - last.moved) };
      dispatch({ type: 'translatePoints', from: last.points, delta, transient: true });
      lastEdit.current = { ...last, points: last.points.map((q) => ({ x: q.x + delta.x, y: q.y + delta.y })), moved: want };
      setMoveText(`Moved ${formatFtIn(len)}${neg ? ' back' : ''}`);
      return;
    }
    if (len < 1) return;
    const d = dist(last.anchor, last.at) || 1;
    const to = { x: Math.round((last.anchor.x + ((last.at.x - last.anchor.x) / d) * len) * 1000) / 1000, y: Math.round((last.anchor.y + ((last.at.y - last.anchor.y) / d) * len) * 1000) / 1000 };
    dispatch({ type: 'moveVertex', from: last.at, to, transient: true });
    lastEdit.current = { ...last, at: to };
    setMoveText(`Length ${formatFtIn(len)}`);
  }

  const selectedWall = selection?.kind === 'wall' ? project.walls.find((w) => w.id === selection.id) : undefined;

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (e.button === 2) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    lastEdit.current = null;
    setEntry('');
    setMoveText(null);
    const raw = toWorld(e.clientX, e.clientY);
    const slop = 6 / view.scale;

    if (e.button === 1 || space) {
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, view };
      return;
    }

    // A dimension string: drag it in or out (any tool but the drawing ones).
    const dimEl = tool === 'select' ? (e.target as Element).closest?.('[data-dim]') : null;
    if (dimEl) {
      const id = dimEl.getAttribute('data-dim')!;
      const [ox, oy] = (dimEl.getAttribute('data-out') ?? '0,0').split(',').map(Number);
      drag.current = { kind: 'dim', id, out: { x: ox, y: oy }, start: raw, base: project.dimOffsets?.[id] ?? 0, started: false };
      return;
    }

    switch (tool) {
      case 'select': {
        // Endpoint handles of the selected wall first.
        if (selectedWall) {
          for (const end of [selectedWall.a, selectedWall.b]) {
            if (dist(end, raw) <= 10 / view.scale) {
              dispatch({ type: 'checkpoint' });
              const anchor = end === selectedWall.a ? selectedWall.b : selectedWall.a;
              drag.current = { kind: 'vertex', start: end, current: end, anchor, radius: wallLength(selectedWall), swung: false };
              return;
            }
          }
        }
        const hit = hitTest(project, raw, slop);
        setSelection(hit);
        if (hit?.kind === 'outlet' || hit?.kind === 'switch') {
          dispatch({ type: 'checkpoint' });
          drag.current = { kind: hit.kind, id: hit.id };
        } else if (hit?.kind === 'fixture') {
          const f = project.fixtures.find((x) => x.id === hit.id)!;
          dispatch({ type: 'checkpoint' });
          drag.current = { kind: 'fixture', id: f.id, grab: { x: raw.x - f.at.x, y: raw.y - f.at.y } };
        } else if (hit?.kind === 'furniture') {
          const f = project.furniture.find((x) => x.id === hit.id)!;
          drag.current = { kind: 'furniture', id: f.id, grab: { x: raw.x - f.at.x, y: raw.y - f.at.y }, started: false, from: f.at };
        } else if (hit?.kind === 'opening') {
          const o = project.openings.find((x) => x.id === hit.id)!;
          const w = project.walls.find((x) => x.id === o.wallId)!;
          const along = (raw.x - w.a.x) * wallDir(w).x + (raw.y - w.a.y) * wallDir(w).y;
          dispatch({ type: 'checkpoint' });
          drag.current = { kind: 'opening', id: o.id, grab: along - o.offset, from: o.offset };
        } else if (hit?.kind === 'counter') {
          const c = project.counters.find((x) => x.id === hit.id)!;
          // Wall counters slide along their wall; islands move freely.
          drag.current = { kind: 'counter', id: c.id, start: raw, a: c.a, b: c.b, along: c.island ? null : counterDir(c), started: false };
        } else if (hit?.kind === 'wall') {
          const w = project.walls.find((x) => x.id === hit.id)!;
          const n = wallNormal(w);
          const square = Math.abs(n.x) < 1e-6 || Math.abs(n.y) < 1e-6;
          drag.current = { kind: 'wall', start: raw, normal: n, moved: 0, current: wallDragPoints(project, w), started: false, snap: wallSnapTargets(project, w), square };
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
        drag.current = { kind: 'room', start: p, end: p, raw };
        setRoomDrag({ a: p, b: p });
        return;
      }
      case 'counter': {
        const p = { x: Math.round(raw.x), y: Math.round(raw.y) };
        drag.current = { kind: 'newCounter', start: p, end: p };
        setCounterDraft(newCounters(project, p, p, ['draft', 'draft2']));
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
      case 'switch': {
        const near = nearestWall(project.walls, raw, 18 / view.scale + 6);
        if (!near) return;
        const n = wallNormal(near.wall);
        const foot = pointAlong(near.wall, near.along);
        const side = (raw.x - foot.x) * n.x + (raw.y - foot.y) * n.y >= 0 ? 1 : -1;
        // Controls the lights of the room it faces.
        const room = roomAt(project, { x: foot.x + n.x * side * (near.wall.thickness / 2 + 12), y: foot.y + n.y * side * (near.wall.thickness / 2 + 12) });
        const controls = room ? project.fixtures.filter((f) => isLight(f.kind) && roomAt(project, f.at)?.id === room.id).map((f) => f.id) : [];
        const sw: WallSwitch = { id: uid('sw'), wallId: near.wall.id, offset: Math.round(near.along), side, height: SWITCH_HEIGHT, controls, auto: false };
        dispatch({ type: 'addSwitch', sw });
        setSelection({ kind: 'switch', id: sw.id });
        return;
      }
      case 'light':
      case 'alarm': {
        const p = { x: Math.round(raw.x), y: Math.round(raw.y) };
        const room = roomAt(project, p);
        const fixture: Fixture = { id: uid(tool === 'light' ? 'lt' : 'sa'), kind: tool === 'light' ? 'light' : coRequired(project) ? 'smoke-co' : 'smoke', at: p, auto: false };
        // A new light joins whatever switches already run the room's lights.
        const lights = new Set(room ? project.fixtures.filter((f) => isLight(f.kind) && roomAt(project, f.at)?.id === room.id).map((f) => f.id) : []);
        const linkTo = tool === 'light' ? project.switches.filter((s) => s.controls.some((c) => lights.has(c))).map((s) => s.id) : [];
        dispatch({ type: 'addFixture', fixture, linkTo });
        setSelection({ kind: 'fixture', id: fixture.id });
        return;
      }
      case 'furniture': {
        const item = newFurniture(project, furnitureKind, { x: Math.round(raw.x), y: Math.round(raw.y) }, uid('fu'));
        dispatch({ type: 'addFurniture', item });
        setSelection({ kind: 'furniture', id: item.id });
        return;
      }
      case 'calibrate': {
        setCalPoints((prev) => (prev.length >= 2 ? [raw] : [...prev, raw]));
        return;
      }
      case 'straighten': {
        setCalPoints((prev) => (prev.length >= 4 ? [raw] : [...prev, raw]));
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
      let p: Point;
      let snapped: 'endpoint' | 'grid' | null = null;
      let note: string | null = null;
      d.swung = e.altKey && d.radius > 0;
      if (d.swung) {
        // Alt: swing round the other end, length kept; 15° steps, Shift for any angle.
        const along = shift ? snapAngle(project.walls, d.anchor, raw, { exclude: d.current }) : null;
        const sw = swingEnd(d.anchor, d.radius, along ? along.p : raw, shift ? 0 : 15);
        p = sw.p;
        note = `Turned to ${sw.angle}°${along ? ` · ${along.label}` : ''} · length kept`;
      } else {
        const sn = snap(raw, { exclude: d.current });
        const onWall = sn.snapped === 'endpoint' || shift ? null : snapEndToWalls(project, raw, { exclude: d.current, anchor: d.anchor, tol: SNAP_PX / viewRef.current.scale });
        [p, snapped, note] = onWall ? [onWall.p, null, onWall.label] : [sn.p, sn.snapped, null];
      }
      setCursor({ p, snapped });
      setMoveText(`${note ? `${note} · ` : ''}Length ${formatFtIn(dist(d.anchor, p))}`);
      if (!samePoint(p, d.current)) {
        dispatch({ type: 'moveVertex', from: d.current, to: p, transient: true });
        d.current = p;
      }
      return;
    }
    if (d?.kind === 'dim') {
      const moved = (raw.x - d.start.x) * d.out.x + (raw.y - d.start.y) * d.out.y;
      const offset = Math.round(d.base + moved);
      if (offset === (project.dimOffsets?.[d.id] ?? 0)) return;
      if (!d.started) dispatch({ type: 'checkpoint' });
      d.started = true;
      dispatch({ type: 'setDimOffset', id: d.id, offset, transient: true });
      setMoveText(offset ? `Dimension ${offset > 0 ? 'out' : 'in'} ${formatFtIn(Math.abs(offset))} · double-click it to put it back` : 'Dimension back in its usual place');
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
    if (d?.kind === 'wall') {
      // Across the wall, snapping to parallel walls' lines and faces, then the grid (Shift: whole inches); attached walls stretch to follow.
      const rawPerp = (raw.x - d.start.x) * d.normal.x + (raw.y - d.start.y) * d.normal.y;
      // A click (or the first press of a double-click) mustn't nudge an off-grid wall onto the grid.
      if (!d.started && Math.abs(rawPerp) < 4 / viewRef.current.scale) return;
      const { perp, label } = snapWallMove(d.snap, rawPerp, { tol: SNAP_PX / viewRef.current.scale, grid: GRID, square: d.square, free: shift });
      if (d.started || perp !== 0) setMoveText(`Moved ${formatFtIn(Math.abs(perp))}${label ? ` · ${label}` : ''}`);
      if (Math.abs(perp - d.moved) > 1e-6) {
        // Checkpoint on the first real move, so a plain click to select adds no undo step.
        if (!d.started) dispatch({ type: 'checkpoint' });
        d.started = true;
        const delta = { x: d.normal.x * (perp - d.moved), y: d.normal.y * (perp - d.moved) };
        dispatch({ type: 'translatePoints', from: d.current, delta, transient: true });
        d.current = d.current.map((q) => ({ x: q.x + delta.x, y: q.y + delta.y }));
        d.moved = perp;
      }
      return;
    }
    if (d?.kind === 'newCounter') {
      d.end = { x: Math.round(raw.x), y: Math.round(raw.y) };
      setCounterDraft(newCounters(project, d.start, d.end, ['draft', 'draft2']));
      return;
    }
    if (d?.kind === 'counter') {
      let dx = Math.round(raw.x - d.start.x);
      let dy = Math.round(raw.y - d.start.y);
      if (d.along) {
        const t = Math.round(dx * d.along.x + dy * d.along.y);
        [dx, dy] = [d.along.x * t, d.along.y * t];
      }
      if (!dx && !dy && !d.started) return;
      if (!d.started) dispatch({ type: 'checkpoint' });
      d.started = true;
      dispatch({ type: 'updateCounter', id: d.id, patch: { a: { x: d.a.x + dx, y: d.a.y + dy }, b: { x: d.b.x + dx, y: d.b.y + dy } }, transient: true });
      return;
    }
    if (d?.kind === 'switch') {
      const o = project.switches.find((x) => x.id === d.id);
      const w = o && project.walls.find((x) => x.id === o.wallId);
      if (o && w) {
        const dir = wallDir(w);
        const along = Math.round(Math.max(2, Math.min(wallLength(w) - 2, (raw.x - w.a.x) * dir.x + (raw.y - w.a.y) * dir.y)));
        if (along !== o.offset) dispatch({ type: 'updateSwitch', id: o.id, patch: { offset: along, auto: false }, transient: true });
      }
      return;
    }
    if (d?.kind === 'furniture') {
      const f = project.furniture.find((x) => x.id === d.id);
      if (!f) return;
      const p = { x: Math.round(raw.x - d.grab.x), y: Math.round(raw.y - d.grab.y) };
      if (!d.started && dist(p, f.at) < 2) return;
      // Re-seats against whichever wall it's dragged to; Shift keeps it free-standing.
      const next = shift ? { ...f, at: p } : placeFurniture(project, f, p);
      if (next.at.x === f.at.x && next.at.y === f.at.y && next.rot === f.rot) return;
      if (!d.started) dispatch({ type: 'checkpoint' });
      d.started = true;
      dispatch({ type: 'updateFurniture', id: f.id, patch: { at: next.at, rot: next.rot }, transient: true });
      return;
    }
    if (d?.kind === 'fixture') {
      const at = { x: Math.round(raw.x - d.grab.x), y: Math.round(raw.y - d.grab.y) };
      const f = project.fixtures.find((x) => x.id === d.id);
      if (f && (at.x !== f.at.x || at.y !== f.at.y)) dispatch({ type: 'updateFixture', id: d.id, patch: { at, auto: false }, transient: true });
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
    if (tool === 'wall') {
      const s = snap(raw, { origin: chain?.start });
      setCursor(s);
      setMoveText(s.note ? `Angle ${s.note}` : null);
    }
    else if (tool === 'room') setCursor(snap(raw));
    else setCursor({ p: raw, snapped: null });
  }

  function onPointerUp(e?: React.PointerEvent<SVGSVGElement>) {
    const d = drag.current;
    drag.current = null;
    setMoveText(null);
    // Remember a real wall move or end drag, so a typed value can set it exactly.
    if (d?.kind === 'wall' && d.started && d.moved) {
      lastEdit.current = { kind: 'move', points: d.current, normal: d.normal, moved: d.moved };
      setMoveText(`Moved ${formatFtIn(Math.abs(d.moved))} · type a distance + ↵ to set it exactly`);
    } else if (d?.kind === 'vertex' && !samePoint(d.start, d.current)) {
      lastEdit.current = d.swung ? { kind: 'swing', at: d.current, anchor: d.anchor, radius: d.radius } : { kind: 'end', at: d.current, anchor: d.anchor };
      setMoveText(d.swung ? 'Type an angle + ↵ to set it exactly (0° = right, 90° = up)' : `Length ${formatFtIn(dist(d.anchor, d.current))} · type a length + ↵ to set it exactly`);
    }
    // Openings, counters and fixtures: a typed distance sets how far they moved.
    const item: LastEdit | null =
      d?.kind === 'opening'
        ? ((o) => (o && o.offset !== d.from ? { kind: 'item', item: 'opening', id: d.id, from: { x: d.from, y: 0 }, to: { x: o.offset, y: 0 } } : null))(project.openings.find((x) => x.id === d.id))
        : d?.kind === 'counter' && d.started
          ? ((c) => (c && !samePoint(c.a, d.a) ? { kind: 'item', item: 'counter', id: d.id, from: d.a, to: c.a } : null))(project.counters.find((x) => x.id === d.id))
          : d?.kind === 'furniture' && d.started
            ? ((f) => (f && !samePoint(f.at, d.from) ? { kind: 'item', item: 'furniture', id: d.id, from: d.from, to: f.at } : null))(project.furniture.find((x) => x.id === d.id))
            : null;
    if (item?.kind === 'item') {
      lastEdit.current = item;
      setMoveText(`Moved ${formatFtIn(dist(item.from, item.to))} · type a distance + ↵ to set it exactly`);
    }
    if (d?.kind === 'room' && e) d.end = snap(toWorld(e.clientX, e.clientY)).p;
    setRoomDrag(null);
    if (d?.kind === 'newCounter') {
      setCounterDraft([]);
      // One drag can make an L: two counters, one undo step.
      const counters = newCounters(project, d.start, d.end, [uid('ct'), uid('ct')]);
      dispatch({ type: 'addCounters', counters });
      setSelection({ kind: 'counter', id: counters[0].id });
      return;
    }
    if (d?.kind === 'room') {
      // Read the rectangle from the ref, not state: a fast drag can release before the last move renders.
      const { start: a, end: b } = d;
      if (Math.abs(a.x - b.x) >= 24 && Math.abs(a.y - b.y) >= 24) {
        const walls = rectangleWalls(a, b, (p, q) => makeWall(p, q));
        const id = uid('r');
        const corners = walls.map((w) => ({ ...w.a }));
        const room = { id, name: '', type: 'other' as const, points: corners };
        dispatch({ type: 'addWalls', walls, room: { ...room, ...guessRoom(project, room) } });
        setSelection({ kind: 'room', id });
        onRoomCreated?.();
      } else {
        // Too small to be a rectangle: a click.
        roomFromClick(d.raw);
      }
    }
  }

  /** A click (not a drag) with the Room tool: make a room of whatever the walls enclose there. */
  function roomFromClick(p: Point) {
    const points = enclosedArea(project.walls, p);
    if (!points) {
      onMessage?.('No closed walls around that spot — close the gap, or drag a rectangle.');
      return;
    }
    const existing = project.rooms.find((r) => samePolygon(r.points, points));
    if (existing) {
      setSelection({ kind: 'room', id: existing.id });
      onMessage?.(`That's already ${existing.name}.`);
      return;
    }
    const id = uid('r');
    const room = { id, name: '', type: 'other' as const, points };
    const guess = guessRoom(project, room);
    dispatch({ type: 'addWalls', walls: [], room: { ...room, ...guess } });
    onMessage?.(`Named it ${guess.name} from its size and doors — change it in the Room panel.`);
    setSelection({ kind: 'room', id });
    onRoomCreated?.();
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

  async function finishStraighten() {
    const u = project.underlay;
    if (!u || calPoints.length !== 4) return;
    const w = parseFtIn(realW);
    const h = parseFtIn(realH);
    setStraightening(true);
    try {
      dispatch({ type: 'setUnderlay', underlay: await straightenUnderlay(u, calPoints, w && h ? { w, h } : undefined) });
      setCalPoints([]);
      setRealW('');
      setRealH('');
      setTool(w && h ? 'select' : 'calibrate');
      requestAnimationFrame(fit);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setStraightening(false);
    }
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
  const furnitureGhost = tool === 'furniture' && cursor ? newFurniture(project, furnitureKind, { x: Math.round(cursor.p.x), y: Math.round(cursor.p.y) }, 'ghost') : null;

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
        onDoubleClick={(e) => {
          if (tool === 'wall') setChain(null);
          if (tool !== 'select') return;
          // Double-click a dragged dimension string to put it back.
          const dimEl = (e.target as Element).closest?.('[data-dim]');
          if (dimEl) {
            const id = dimEl.getAttribute('data-dim')!;
            if (project.dimOffsets?.[id]) dispatch({ type: 'setDimOffset', id, offset: 0 });
            return;
          }
          // Double-click a wall to split it there.
          const raw = toWorld(e.clientX, e.clientY);
          const hit = hitTest(project, raw, 6 / viewRef.current.scale);
          if (hit?.kind !== 'wall') return;
          const w = project.walls.find((x) => x.id === hit.id)!;
          const t = splitAt(project, w, projectOnWall(w, raw).along);
          if (t === null) {
            onMessage?.('Can’t split there — too close to an end, or through a door or window.');
            return;
          }
          dispatch({ type: 'splitWall', id: w.id, at: t, newId: uid('w') });
          setSelection({ kind: 'wall', id: w.id });
          onMessage?.(`Split ${formatFtIn(t)} from the wall’s start.`);
        }}
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
          {furnitureGhost && <FurnitureGlyph f={furnitureGhost} selected={false} ghost px={px} />}

          {selectedWall &&
            [selectedWall.a, selectedWall.b].map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={px(6)} className="handle" strokeWidth={px(2)} />
            ))}

          {chain && cursor && tool === 'wall' && (
            <PreviewSegment a={chain.start} b={cursor.p} thickness={newWallThickness} px={px} />
          )}
          {roomDrag && <PreviewRect a={roomDrag.a} b={roomDrag.b} px={px} />}
          {counterDraft.map((c) => (
            <CounterGlyph key={c.id} c={c} selected px={px} />
          ))}

          {calPoints.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={px(5)} className="cal-point" />
          ))}
          {tool === 'straighten' && calPoints.length > 1 && (
            <polyline points={[...calPoints, ...(calPoints.length === 4 ? [calPoints[0]] : cursor ? [cursor.p] : [])].map((p) => `${p.x},${p.y}`).join(' ')} fill="none" className="cal-line" strokeWidth={px(2)} />
          )}
          {tool === 'calibrate' && calPoints.length === 1 && cursor && <line x1={calPoints[0].x} y1={calPoints[0].y} x2={cursor.p.x} y2={cursor.p.y} className="cal-line" strokeWidth={px(2)} />}
          {tool === 'calibrate' && calPoints.length === 2 && <line x1={calPoints[0].x} y1={calPoints[0].y} x2={calPoints[1].x} y2={calPoints[1].y} className="cal-line" strokeWidth={px(2)} />}

          {cursor?.snapped === 'endpoint' && <circle cx={cursor.p.x} cy={cursor.p.y} r={px(7)} className="snap" strokeWidth={px(2)} />}
        </g>
      </svg>

      {(moveText || entry) && (
        <div className="length-entry">
          {entry ? (
            <>
              {lastEdit.current?.kind === 'move' || lastEdit.current?.kind === 'item' ? 'Move' : lastEdit.current?.kind === 'swing' ? 'Angle' : 'Length'}: <strong>{entry}</strong> <span className="muted">↵ to set · Esc to clear</span>
            </>
          ) : (
            moveText
          )}
        </div>
      )}
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

      {tool === 'straighten' && (
        <div className="float-panel">
          {calPoints.length < 4 ? (
            <p>
              <strong>Straighten a photo.</strong> Click the four corners of something that is really a rectangle — the house outline or the sheet border ({calPoints.length}/4).
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                finishStraighten();
              }}
            >
              <p className="small muted">If you know that rectangle's real size, enter it to set the scale too (optional).</p>
              <label>
                Width (top edge)
                <input autoFocus value={realW} onChange={(e) => setRealW(e.target.value)} placeholder={`e.g. 40'`} />
              </label>
              <label>
                Depth (left edge)
                <input value={realH} onChange={(e) => setRealH(e.target.value)} placeholder={`e.g. 28' 6"`} />
              </label>
              <button type="submit" className="primary" disabled={straightening}>
                {straightening ? 'Straightening…' : 'Straighten'}
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
      return 'Click to select · drag empty space to pan · drag a wall to slide it (attached walls follow; snaps to other walls and the grid, Shift = free) · double-click a wall to split it there · drag its ends (they snap onto other walls; Alt swings an end round the other) or openings · drag a dimension string to move it (double-click resets) · after a drag, type a value + ↵ to set it exactly · ⌫ deletes';
    case 'wall':
      return drawing ? 'Click to add the next corner · type a length + ↵ · Shift = any angle · double-click / Esc to finish' : 'Click to start a wall';
    case 'room':
      return 'Click inside closed walls to make a room of that shape · or drag a rectangle (walls already on the plan are reused)';
    case 'door':
    case 'window':
      return `Click on a wall to place a ${tool}`;
    case 'outlet':
      return 'Click beside a wall to add a receptacle on that face';
    case 'switch':
      return 'Click beside a wall to add a switch — it controls the lights in the room it faces';
    case 'light':
      return 'Click in a room to add a ceiling light — it joins that room’s switches';
    case 'alarm':
      return 'Click in a room to add a smoke alarm (smoke / CO where CO alarms are required)';
    case 'furniture':
      return 'Click to place the chosen fixture or furniture — near a wall its back goes flat against it · drag to move (Shift = free-standing) · turn it in the panel';
    case 'counter':
      return 'Drag along a wall for a counter on that face (click = 6 ft) · carry the drag round a corner onto the next wall for an L · drag in open floor for an island · add a sink, range or tall cabinet in the panel';
    case 'calibrate':
      return 'Pick two points on the image whose real distance you know';
    case 'straighten':
      return 'Click four corners of a rectangle in the photo, in any order';
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
