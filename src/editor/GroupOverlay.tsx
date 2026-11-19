import { counterCorners } from '../calc/counters.ts';
import { furnitureCorners } from '../calc/furniture.ts';
import { openingSpan, pointAlong } from '../model/geometry.ts';
import type { Bounds, SelItem } from '../model/selection.ts';
import type { Point, Project } from '../model/types.ts';
import { outletPosition } from './outletGeometry.ts';

// Wall edits v6: what's picked as a group (highlights, the group's box and its
// turn handle), the box being dragged out, and a mirror line being picked.

const HL = { fill: 'var(--room-sel)', stroke: 'var(--accent)' } as const;
const poly = (pts: Point[]) => pts.map((q) => `${q.x},${q.y}`).join(' ');

interface Props {
  project: Project;
  /** Every item the group carries (see groupMembers). */
  members: SelItem[];
  bounds: Bounds | null;
  /** The group's turn handle (null: no handle, e.g. a single room has its own). */
  turn: Point | null;
  boxDrag: { a: Point; b: Point } | null;
  /** A mirror line being picked: its first point and where the second would go. */
  mirrorLine: { a: Point; b: Point } | null;
  px(n: number): number;
}

export function GroupOverlay({ project, members, bounds, turn, boxDrag, mirrorLine, px }: Props) {
  const walls = new Map(project.walls.map((w) => [w.id, w]));
  const dash = `${px(4)} ${px(3)}`;
  return (
    <g className="group-overlay" style={{ pointerEvents: 'none' }}>
      {members.map((x) => {
        const key = `${x.kind}:${x.id}`;
        switch (x.kind) {
          case 'room': {
            const r = project.rooms.find((y) => y.id === x.id);
            return r && <polygon key={key} points={poly(r.points)} style={{ ...HL, strokeWidth: px(1.5), strokeDasharray: dash }} />;
          }
          case 'wall': {
            const w = walls.get(x.id);
            return w && <line key={key} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} style={{ stroke: 'var(--accent)', strokeOpacity: 0.35, strokeWidth: w.thickness + px(4) }} />;
          }
          case 'opening': {
            const o = project.openings.find((y) => y.id === x.id);
            const w = o && walls.get(o.wallId);
            if (!o || !w) return null;
            const s = openingSpan(o);
            const [a, b] = [pointAlong(w, s.start), pointAlong(w, s.end)];
            return <line key={key} x1={a.x} y1={a.y} x2={b.x} y2={b.y} style={{ stroke: 'var(--accent)', strokeWidth: w.thickness + px(6), strokeOpacity: 0.25 }} />;
          }
          case 'outlet':
          case 'switch': {
            const o = (x.kind === 'outlet' ? project.outlets : project.switches).find((y) => y.id === x.id);
            const w = o && walls.get(o.wallId);
            if (!o || !w) return null;
            const q = outletPosition(w, o);
            return <circle key={key} cx={q.x} cy={q.y} r={px(9)} style={{ ...HL, strokeWidth: px(1.5) }} />;
          }
          case 'fixture': {
            const f = project.fixtures.find((y) => y.id === x.id);
            return f && <circle key={key} cx={f.at.x} cy={f.at.y} r={px(11)} style={{ ...HL, strokeWidth: px(1.5) }} />;
          }
          case 'counter': {
            const c = project.counters.find((y) => y.id === x.id);
            return c && <polygon key={key} points={poly(counterCorners(c))} style={{ ...HL, strokeWidth: px(1.5) }} />;
          }
          case 'furniture': {
            const f = project.furniture.find((y) => y.id === x.id);
            return f && <polygon key={key} points={poly(furnitureCorners(f))} style={{ ...HL, strokeWidth: px(1.5) }} />;
          }
        }
        return null;
      })}
      {bounds && (
        <rect
          x={bounds.min.x - px(6)}
          y={bounds.min.y - px(6)}
          width={bounds.max.x - bounds.min.x + px(12)}
          height={bounds.max.y - bounds.min.y + px(12)}
          style={{ fill: 'none', stroke: 'var(--accent)', strokeWidth: px(1), strokeDasharray: dash }}
        />
      )}
      {bounds && turn && (
        <g className="room-grips">
          <line x1={(bounds.min.x + bounds.max.x) / 2} y1={bounds.min.y - px(6)} x2={turn.x} y2={turn.y} strokeWidth={px(1)} strokeDasharray={`${px(3)} ${px(3)}`} />
          <circle cx={turn.x} cy={turn.y} r={px(7)} className="handle turn-handle" strokeWidth={px(2)} />
          <path d={`M ${turn.x - px(3)} ${turn.y - px(1)} a ${px(3)} ${px(3)} 0 1 1 ${px(3)} ${px(3)}`} fill="none" strokeWidth={px(1.2)} />
        </g>
      )}
      {boxDrag && (
        <rect
          x={Math.min(boxDrag.a.x, boxDrag.b.x)}
          y={Math.min(boxDrag.a.y, boxDrag.b.y)}
          width={Math.abs(boxDrag.a.x - boxDrag.b.x)}
          height={Math.abs(boxDrag.a.y - boxDrag.b.y)}
          style={{ fill: 'var(--room-sel)', stroke: 'var(--accent)', strokeWidth: px(1), strokeDasharray: dash }}
        />
      )}
      {mirrorLine && (
        <g>
          <circle cx={mirrorLine.a.x} cy={mirrorLine.a.y} r={px(5)} className="cal-point" />
          <line x1={mirrorLine.a.x} y1={mirrorLine.a.y} x2={mirrorLine.b.x} y2={mirrorLine.b.y} className="cal-line" strokeWidth={px(1.5)} />
        </g>
      )}
    </g>
  );
}
