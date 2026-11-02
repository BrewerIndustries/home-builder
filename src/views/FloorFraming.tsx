import { useMemo, useState } from 'react';
import { floorLayout } from '../calc/floor.ts';
import { foundationOf } from '../calc/foundation.ts';
import type { Project } from '../model/types.ts';
import { formatFtIn } from '../model/units.ts';

// Framing plan of the floor over a crawlspace: joists, girders, piers, and the
// staggered subfloor sheets. Plan coordinates, fitted to the box.

export function FloorFraming({ project }: { project: Project }) {
  const L = useMemo(() => floorLayout(project), [project]);
  const [show, setShow] = useState<'joists' | 'subfloor'>('joists');
  if (!L) return null;
  const f = foundationOf(project);
  const all = L.outline.flat();
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const pad = 30;
  const [x0, y0] = [Math.min(...xs) - pad, Math.min(...ys) - pad];
  const [w, h] = [Math.max(...xs) - x0 + pad, Math.max(...ys) - y0 + pad];
  const stroke = Math.max(w, h) / 600; // ~1px at typical sizes
  const cut = L.sheets.filter((s) => s.cut).length;

  return (
    <>
      <h3>Floor framing</h3>
      <p className="muted">
        {f.joistSize} joists at {f.joistSpacing}" o.c. running {L.alongX ? 'left–right' : 'top–bottom'}, {L.girders.length ? `lapped over ${L.girders.length} girder line${L.girders.length > 1 ? 's' : ''} on ${L.piers.length} piers` : 'clear-spanning wall to wall'}. Longest span{' '}
        <strong>{formatFtIn(L.maxSpan, { compact: true })}</strong> — check it against the IRC R502.3 span tables. Subfloor: {L.sheets.length} sheets ({cut} cut), long edge across the joists, rows staggered 4'.
      </p>
      <div className="seg floor-toggle" role="group" aria-label="Show">
        <button className={show === 'joists' ? 'active' : ''} onClick={() => setShow('joists')}>
          Joists
        </button>
        <button className={show === 'subfloor' ? 'active' : ''} onClick={() => setShow('subfloor')}>
          Subfloor sheets
        </button>
      </div>
      <svg className="floor-plan" viewBox={`${x0} ${y0} ${w} ${h}`} role="img" aria-label="Floor framing plan">
        {L.outline.map((pts, i) => (
          <polygon key={i} points={pts.map((p) => `${p.x},${p.y}`).join(' ')} className="fp-outline" strokeWidth={stroke * 3} />
        ))}
        {show === 'subfloor'
          ? L.sheets.map((s, i) => <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} className={s.cut ? 'fp-sheet cut' : 'fp-sheet'} strokeWidth={stroke} />)
          : L.joists.map((j, i) => <line key={i} x1={j.a.x} y1={j.a.y} x2={j.b.x} y2={j.b.y} className="fp-joist" strokeWidth={stroke * 1.5} />)}
        {L.girders.map((g, i) => (
          <line key={i} x1={g.a.x} y1={g.a.y} x2={g.b.x} y2={g.b.y} className="fp-girder" strokeWidth={stroke * 6} />
        ))}
        {L.piers.map((p, i) => (
          <rect key={i} x={p.x - 8} y={p.y - 8} width={16} height={16} className="fp-pier" strokeWidth={stroke} />
        ))}
      </svg>
      <div className="legend">
        <span>
          <i className="sw fp-sw-joist" />
          Joist
        </span>
        <span>
          <i className="sw fp-sw-girder" />
          Girder
        </span>
        <span>
          <i className="sw fp-sw-pier" />
          Pier
        </span>
        {show === 'subfloor' && (
          <span>
            <i className="sw fp-sw-cut" />
            Cut sheet
          </span>
        )}
      </div>
    </>
  );
}
