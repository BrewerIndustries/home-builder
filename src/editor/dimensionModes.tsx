import { useEffect, useState, type Dispatch } from 'react';
import { angleBetween, pickWall } from '../calc/faces.ts';
import { ordinateAxis } from '../calc/ordinate.ts';
import type { Action } from '../model/store.ts';
import { uid, type DimAnchor, type OrdinateDim, type Point, type Project } from '../model/types.ts';
import { formatFtIn } from '../model/units.ts';
import type { Hit } from './hitTest.ts';

// The Dimension tool's other two kinds, picked on the plan: an angle (click two
// walls → an arc and degrees where their lines meet) and an ordinate set (click
// the origin, then each point to label with its distance from it; Esc finishes).
// Plain two-point dimensions stay in PlanCanvas.

export type DimKind = 'linear' | 'angle' | 'ordinate';

const KINDS: { id: DimKind; label: string; title: string }[] = [
  { id: 'linear', label: 'Linear', title: 'Click two points: the distance between them' },
  { id: 'angle', label: 'Angle', title: 'Click two walls: the angle between them, as an arc where they meet' },
  { id: 'ordinate', label: 'Ordinate', title: 'Click an origin, then each point to label with its distance from it; Esc finishes' },
];

export function useDimensionModes(active: boolean, project: Project, dispatch: Dispatch<Action>, setSelection: (h: Hit | null) => void, onMessage?: (m: string) => void) {
  const [kind, setKindState] = useState<DimKind>('linear');
  /** Angle: the first wall picked. */
  const [firstWall, setFirstWall] = useState<string | null>(null);
  /** Ordinate: the origin picked, and the set once it has a point. */
  const [origin, setOrigin] = useState<{ p: Point; at?: DimAnchor } | null>(null);
  const [ordId, setOrdId] = useState<string | null>(null);

  const reset = () => {
    setFirstWall(null);
    setOrigin(null);
    setOrdId(null);
  };
  // Leaving the tool drops anything half-picked.
  useEffect(() => {
    if (!active) {
      setFirstWall(null);
      setOrigin(null);
      setOrdId(null);
    }
  }, [active]);
  const setKind = (k: DimKind) => {
    reset();
    setKindState(k);
  };
  /** Something in progress that Esc should end first. */
  const busy = !!(firstWall || origin);

  /** An angle pick: `raw` is the click, `slop` the pointer tolerance (inches). */
  const clickAngle = (raw: Point, slop: number) => {
    const id = pickWall(project, raw, slop);
    if (!id) {
      onMessage?.('Click on a wall.');
      return;
    }
    if (!firstWall || firstWall === id) {
      setFirstWall(id);
      onMessage?.('Now click the second wall.');
      return;
    }
    const g = angleBetween(project, firstWall, id);
    if (!g) {
      onMessage?.('Those walls are parallel — no angle between them.');
      return;
    }
    const existing = project.angleDims?.find((d) => (d.a === firstWall && d.b === id) || (d.a === id && d.b === firstWall));
    const dimId = existing?.id ?? uid('ang');
    if (!existing) dispatch({ type: 'addAngleDim', dim: { id: dimId, a: firstWall, b: id } });
    setSelection({ kind: 'dim', id: dimId });
    setFirstWall(null);
    onMessage?.(`Angle ${Math.round(g.deg * 10) / 10}°${existing ? ' (already dimensioned)' : ''} — drag the arc in or out with Select; Delete removes it.`);
  };

  /** An ordinate pick at the snapped point `p`, pinned to `at` when it snapped to something. */
  const clickOrdinate = (p: Point, at: DimAnchor | undefined) => {
    const pt = at ? { p, at } : { p };
    if (!origin) {
      setOrigin(pt);
      onMessage?.('Origin set — click each point to measure from it; Esc finishes.');
      return;
    }
    const set = ordId ? project.ordDims?.find((d) => d.id === ordId) : undefined;
    if (!set) {
      if (Math.hypot(p.x - origin.p.x, p.y - origin.p.y) < 1) return;
      const dim: OrdinateDim = { id: uid('od'), axis: ordinateAxis(origin.p, p), origin, pts: [pt] };
      dispatch({ type: 'addOrdDim', dim });
      setOrdId(dim.id);
      setSelection({ kind: 'dim', id: dim.id });
      onMessage?.(`Ordinate ${dim.axis === 'x' ? 'across' : 'up / down'} the plan: ${formatFtIn(Math.abs(p[dim.axis] - origin.p[dim.axis]))} — keep clicking points; Esc finishes.`);
      return;
    }
    dispatch({ type: 'updateOrdDim', id: set.id, patch: { pts: [...set.pts, pt] } });
    onMessage?.(`${formatFtIn(Math.abs(p[set.axis] - set.origin.p[set.axis]))} from the origin — keep clicking points; Esc finishes.`);
  };

  /** Where the preview line starts from (the ordinate origin), if any. */
  const from = origin?.p;

  /** The first wall picked, outlined; the ordinate origin marked. */
  const overlay = (px: (n: number) => number) => {
    const w = firstWall ? project.walls.find((x) => x.id === firstWall) : undefined;
    return (
      <>
        {w && <line x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} className="cal-line" strokeWidth={Math.max(px(3), w.thickness)} strokeOpacity={0.5} />}
        {origin && <circle cx={origin.p.x} cy={origin.p.y} r={px(5)} className="cal-point" />}
      </>
    );
  };

  const panel = (
    <div className="dim-kinds seg" role="group" aria-label="Dimension kind">
      {KINDS.map((k) => (
        <button key={k.id} className={kind === k.id ? 'active' : ''} onClick={() => setKind(k.id)} title={k.title}>
          {k.label}
        </button>
      ))}
    </div>
  );

  return { kind, setKind, busy, reset, clickAngle, clickOrdinate, from, overlay, panel };
}
