import { clearNarrowest } from '../calc/roomShape.ts';
import { HABITABLE, type Project, type Room } from '../model/types.ts';
import { formatFtIn } from '../model/units.ts';

// The line that measures a room's narrowest clear width (R304.2, between
// finished faces): shown on the selected room, and on any habitable room
// (kitchens aside) that comes in under 7 ft, in the fail colour.

export function NarrowestLine({ project, room, selected, px }: { project: Project; room: Room; selected: boolean; px(n: number): number }) {
  const checked = HABITABLE.has(room.type) && room.type !== 'kitchen';
  const n = selected || checked ? clearNarrowest(project, room) : null;
  if (!n) return null;
  const short = checked && n.width < 84 - 0.5;
  if (!selected && !short) return null;
  const stroke = short ? 'var(--fail)' : 'var(--accent)';
  const mid = { x: (n.from.x + n.to.x) / 2, y: (n.from.y + n.to.y) / 2 };
  const len = Math.hypot(n.to.x - n.from.x, n.to.y - n.from.y) || 1;
  const u = { x: (n.to.x - n.from.x) / len, y: (n.to.y - n.from.y) / len };
  const tick = px(5);
  const ticks = [n.from, n.to].map((p, i) => (
    <line key={i} x1={p.x - u.y * tick} y1={p.y + u.x * tick} x2={p.x + u.y * tick} y2={p.y - u.x * tick} stroke={stroke} strokeWidth={px(1.5)} />
  ));
  // Text reads along the line, kept upright.
  let deg = (Math.atan2(u.y, u.x) * 180) / Math.PI;
  if (deg > 90) deg -= 180;
  if (deg <= -90) deg += 180;
  return (
    <g className="narrowest-line" pointerEvents="none">
      <line x1={n.from.x} y1={n.from.y} x2={n.to.x} y2={n.to.y} stroke={stroke} strokeWidth={px(1.5)} strokeDasharray={`${px(6)} ${px(4)}`} />
      {ticks}
      <text x={mid.x} y={mid.y} fontSize={px(10)} fill={stroke} textAnchor="middle" dominantBaseline="middle" transform={`rotate(${deg} ${mid.x} ${mid.y}) translate(0 ${-px(8)})`}>
        {`${formatFtIn(n.width)} clear${short ? ' — under 7 ft (R304.2)' : ''}`}
      </text>
    </g>
  );
}
