import { ordinateLayout } from '../calc/ordinate.ts';
import type { OrdinateDim, Point } from '../model/types.ts';
import { formatFtIn } from '../model/units.ts';
import { DimEnd, type Look } from './dimLook.tsx';

/**
 * An ordinate (baseline) dimension: one baseline above the points (an across set)
 * or left of them (an up / down set), a leader from each point to it, an open
 * circle and "0" at the origin and each point's distance from the origin written
 * square to the line. Drag it to move the baseline out; it follows what its
 * points were snapped to.
 */
export function OrdinateDimension({ d, offset, selected, look, px }: { d: OrdinateDim; offset: number; selected: boolean; look: Look; px(n: number): number }) {
  if (!d.pts.length) return null;
  const { at, stops } = ordinateLayout(d, offset);
  const x = d.axis === 'x';
  const P = (along: number, across: number): Point => (x ? { x: along, y: across } : { x: across, y: along });
  const alongs = stops.map((s) => s.along);
  const [lo, hi] = [Math.min(...alongs), Math.max(...alongs)];
  const out = x ? { x: 0, y: -1 } : { x: -1, y: 0 };
  const tick = px(5);
  const fs = px(10 * look.text);
  return (
    <g className={`dims ord-dim${selected ? ' selected' : ''}`} data-dim={d.id} data-out={`${out.x},${out.y}`}>
      <line x1={P(lo, at).x} y1={P(lo, at).y} x2={P(hi, at).x} y2={P(hi, at).y} className="dim-hit" strokeWidth={px(10)} />
      <line x1={P(lo, at).x} y1={P(lo, at).y} x2={P(hi, at).x} y2={P(hi, at).y} className="dim-line" strokeWidth={px(1)} />
      {stops.map((s, i) => {
        const p = P(s.along, at);
        // Leader from just off the point to just past the line.
        const from = x ? s.from.y : s.from.x;
        const start = P(s.along, from - px(3));
        const end = P(s.along, at - px(4));
        const label = P(s.along, at - px(6));
        return (
          <g key={i}>
            {from - px(3) > at && <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} className="dim-line" strokeWidth={px(0.6)} />}
            {i === 0 ? (
              <circle cx={p.x} cy={p.y} r={px(3)} className="dim-line" fill="none" strokeWidth={px(1.2)} />
            ) : (
              <DimEnd p={p} tick={x ? { x: -tick, y: tick } : { x: tick, y: -tick }} dirs={[out]} look={look} px={px} />
            )}
            {/* Written outward from the line, square to it, so close stops don't collide. */}
            <text x={label.x} y={label.y} fontSize={fs} textAnchor={x ? 'start' : 'end'} dominantBaseline="middle" className="dim" transform={x ? `rotate(-90 ${label.x} ${label.y})` : undefined}>
              {i === 0 ? '0' : formatFtIn(s.value)}
            </text>
          </g>
        );
      })}
    </g>
  );
}
