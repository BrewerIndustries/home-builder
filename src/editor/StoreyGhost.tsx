import { floorOpenings } from '../calc/house.ts';
import { adjacentStorey, isMultiStorey, storeyView } from '../model/storeys.ts';
import type { Project } from '../model/types.ts';
import { FurnitureGlyph } from './PlanDrawing.tsx';

// Storeys v1 on the plan: the storey below drawn faint under this one (its walls
// and stairs, to trace over), and the openings in this floor over stairs —
// hatched, with "OPEN" — so walls and furniture keep clear of them. The print
// sheet draws the openings only.

export function StoreyGhost({ project, px, openingsOnly = false }: { project: Project; px(n: number): number; openingsOnly?: boolean }) {
  if (!isMultiStorey(project)) return null;
  const below = adjacentStorey(project, -1);
  const v = below && !openingsOnly ? storeyView(project, below.id) : null;
  const openings = floorOpenings(project);
  return (
    <g className="storey-ghost" style={{ pointerEvents: 'none' }}>
      {v && (
        <g opacity={0.28}>
          {v.walls.map((w) => (
            <line key={w.id} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke="var(--wall-int)" strokeWidth={w.thickness} strokeLinecap="square" />
          ))}
          {v.furniture
            .filter((f) => f.kind === 'stairs')
            .map((f) => (
              <FurnitureGlyph key={f.id} f={f} selected={false} ghost px={px} />
            ))}
        </g>
      )}
      {openings.flatMap((o) => o.polys).map((poly, i) => {
        const pts = poly.map((p) => `${p.x},${p.y}`).join(' ');
        const [a, b, c, d] = poly;
        const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
        return (
          <g key={i}>
            <polygon points={pts} fill="var(--canvas)" fillOpacity={0.6} stroke="var(--wall-ext)" strokeWidth={px(1)} strokeDasharray={`${px(5)} ${px(3)}`} />
            <line x1={a.x} y1={a.y} x2={c.x} y2={c.y} stroke="var(--muted)" strokeWidth={px(0.75)} />
            <line x1={b.x} y1={b.y} x2={d.x} y2={d.y} stroke="var(--muted)" strokeWidth={px(0.75)} />
            <text x={mid.x} y={mid.y} fontSize={px(10)} textAnchor="middle" dominantBaseline="central" fill="var(--muted)">
              OPEN
            </text>
          </g>
        );
      })}
    </g>
  );
}
