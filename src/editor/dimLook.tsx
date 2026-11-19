import type { Point, Project } from '../model/types.ts';

// The dimension style (Plan settings → Dimension text / ends): one text scale and
// one end mark for every dimension on the plan and the print sheet.

export type DimEnds = 'tick' | 'arrow' | 'dot';

export interface Look {
  /** Text size, × the usual. */
  text: number;
  ends: DimEnds;
}

export const TEXT_SIZES: { value: number; label: string }[] = [
  { value: 0.75, label: 'Small' },
  { value: 1, label: 'Normal' },
  { value: 1.25, label: 'Large' },
  { value: 1.5, label: 'Extra large' },
];

export const END_KINDS: { value: DimEnds; label: string }[] = [
  { value: 'tick', label: 'Ticks (architectural)' },
  { value: 'arrow', label: 'Arrows' },
  { value: 'dot', label: 'Dots' },
];

export function lookOf(project: Project): Look {
  return { text: project.dimLook?.text ?? 1, ends: project.dimLook?.ends ?? 'tick' };
}

/**
 * The mark where a dimension line meets a stop. `tick` is the half-length vector
 * of the 45° slash (the line's own direction plus its normal, scaled); `dirs` are
 * unit directions along the line pointing at the stop from each side that has
 * a piece (one at an end of the line, two at a stop between pieces) — arrows
 * point along them.
 */
export function DimEnd({ p, tick, dirs, look, px, width = 1.2 }: { p: Point; tick: Point; dirs: Point[]; look: Look; px(n: number): number; width?: number }) {
  if (look.ends === 'dot') return <circle cx={p.x} cy={p.y} r={px(1.8)} className="dim-dot" />;
  if (look.ends === 'arrow') {
    const [len, half] = [px(7), px(2.2)];
    return (
      <>
        {dirs.map((d, i) => {
          const base = { x: p.x - d.x * len, y: p.y - d.y * len };
          const n = { x: -d.y * half, y: d.x * half };
          return <path key={i} d={`M ${p.x} ${p.y} L ${base.x + n.x} ${base.y + n.y} L ${base.x - n.x} ${base.y - n.y} Z`} className="dim-dot" />;
        })}
      </>
    );
  }
  return <line x1={p.x - tick.x} y1={p.y - tick.y} x2={p.x + tick.x} y2={p.y + tick.y} className="dim-line" strokeWidth={px(width)} />;
}

/** Arrow directions at stop `i` of `n` along a line running in direction `u`: into the first stop, into the last, both ways between. */
export function stopDirs(i: number, n: number, u: Point): Point[] {
  const back = { x: -u.x, y: -u.y };
  if (n < 2) return [];
  if (i === 0) return [back];
  if (i === n - 1) return [u];
  return [u, back];
}
