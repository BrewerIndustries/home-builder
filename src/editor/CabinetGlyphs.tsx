import { cabinetJoints, jointInset } from '../calc/cabinets.ts';
import { counterLength, counterPoint, raisedDepth, UPPER_DEPTH, upperLayout } from '../calc/counters.ts';
import type { Counter, Project } from '../model/types.ts';

/**
 * Counters v6 plan marks for one run: wall-cabinet joints across the dashed
 * uppers (labelled on the selected run), a two-level island's step line, and
 * on the selected run a dot on every joint that can be dragged.
 */
export function CabinetGlyphs({ project, c, selected, px }: { project: Project; c: Counter; selected: boolean; px(n: number): number }) {
  const upper = upperLayout(project, c);
  const step = raisedDepth(c);
  const joints = selected ? [...cabinetJoints(project, c, 'base'), ...cabinetJoints(project, c, 'upper')] : [];
  const stepLine = step > 0 ? [counterPoint(c, 0, c.depth - step), counterPoint(c, counterLength(c), c.depth - step)] : null;
  return (
    <g className="cabinets">
      {upper.slice(1).map((k) => {
        const [p, q] = [counterPoint(c, k.s, 0), counterPoint(c, k.s, UPPER_DEPTH)];
        return <line key={`u${k.s}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} strokeWidth={px(1)} strokeDasharray={`${px(2)} ${px(2)}`} />;
      })}
      {selected &&
        upper
          .filter((k) => k.kind === 'wall')
          .map((k) => {
            const at = counterPoint(c, (k.s + k.e) / 2, UPPER_DEPTH / 2);
            return (
              <text key={`ut${k.s}`} x={at.x} y={at.y} fontSize={px(8)} textAnchor="middle" dominantBaseline="central">
                {k.label}
              </text>
            );
          })}
      {stepLine && <line x1={stepLine[0].x} y1={stepLine[0].y} x2={stepLine[1].x} y2={stepLine[1].y} strokeWidth={px(1.5)} />}
      {joints.map((j) => {
        const at = counterPoint(c, j.t, jointInset(c, j.level));
        return <circle key={`${j.level}${j.t}`} className="cabinet-joint" cx={at.x} cy={at.y} r={px(3.5)} strokeWidth={px(1)} />;
      })}
    </g>
  );
}
