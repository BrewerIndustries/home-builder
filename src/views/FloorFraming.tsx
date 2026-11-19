import { useMemo, useState, type Dispatch } from 'react';
import { depthLabel, EDGE_NAME, floorSpec, storeyFloorLayout } from '../calc/floor.ts';
import type { Action } from '../model/store.ts';
import type { Project } from '../model/types.ts';
import { formatFtIn } from '../model/units.ts';
import { FloorFrameFields } from './FloorFrameFields.tsx';

// Framing plan of the storey's framed floor: over a crawlspace / basement on the
// lowest storey (joists, girders, piers), or bearing on the walls below on a
// storey above it. Stair openings with doubled headers and trimmers, hangers,
// cantilevers, and the staggered subfloor sheets. Plan coordinates, fitted to the box.

export function FloorFraming({ project, dispatch }: { project: Project; dispatch?: Dispatch<Action> }) {
  const L = useMemo(() => storeyFloorLayout(project), [project]);
  const s = useMemo(() => floorSpec(project), [project]);
  const [show, setShow] = useState<'joists' | 'subfloor'>('joists');
  if (!L) return null;
  const all = L.outline.flat();
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const pad = 30;
  const [x0, y0] = [Math.min(...xs) - pad, Math.min(...ys) - pad];
  const [w, h] = [Math.max(...xs) - x0 + pad, Math.max(...ys) - y0 + pad];
  const stroke = Math.max(w, h) / 600; // ~1px at typical sizes
  const cut = L.sheets.filter((x) => x.cut).length;
  const joist = s.ijoist ? `${s.ijoist.series} ${depthLabel(s.ijoist.depth)} I-joists` : `${s.joistSize} joists`;
  const support = s.upper
    ? `bearing on the walls below${L.bearing.length ? `, lapped over ${L.bearing.length} wall${L.bearing.length > 1 ? 's' : ''} mid-span` : ''}`
    : L.girders.length
      ? `${s.flushGirders ? 'hung flush between' : 'lapped over'} ${L.girders.length} girder line${L.girders.length > 1 ? 's' : ''} on ${L.piers.length} piers`
      : 'clear-spanning wall to wall';
  const cantilevered = L.outline !== L.supported;

  return (
    <>
      <h3>{s.upper ? 'Floor framing (under this storey)' : 'Floor framing'}</h3>
      <p className="muted">
        {joist} at {s.joistSpacing}" o.c. running {L.alongX ? 'left–right' : 'top–bottom'}, {support}. Longest span <strong>{formatFtIn(L.maxSpan, { compact: true })}</strong> — check it against {s.ijoist ? "the I-joist maker's span tables" : 'the IRC R502.3 span tables'}.
        {L.openings.length > 0 && ` ${L.openings.length} stair opening${L.openings.length > 1 ? 's' : ''} framed with doubled trimmers${L.headers.length ? ' and headers' : ''} (see R502.10 for when singles will do).`}
        {L.hangers.length > 0 && ` ${L.hangers.length} joist hanger${L.hangers.length > 1 ? 's' : ''}.`}
        {L.cantilevers.map((c) => ` ${EDGE_NAME[c.edge][0].toUpperCase()}${EDGE_NAME[c.edge].slice(1)} cantilever ${formatFtIn(c.depth, { compact: true })}, back-span ${formatFtIn(c.backSpan, { compact: true })}.`).join('')} Subfloor: {L.sheets.length} sheets ({cut} cut), long edge across the joists, rows staggered 4'.
      </p>
      {L.notes.length > 0 && (
        <ul className="floor-notes">
          {L.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
      {dispatch && <FloorFrameFields project={project} spec={s} layout={L} dispatch={dispatch} />}
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
        {cantilevered &&
          L.supported.map((pts, i) => <polygon key={`s${i}`} points={pts.map((p) => `${p.x},${p.y}`).join(' ')} className="fp-support" strokeWidth={stroke * 2} strokeDasharray={`${stroke * 8} ${stroke * 5}`} />)}
        {L.bearing.map((b, i) => (
          <line key={`b${i}`} x1={b.a.x} y1={b.a.y} x2={b.b.x} y2={b.b.y} className="fp-bearing" strokeWidth={stroke * 5} strokeDasharray={`${stroke * 10} ${stroke * 6}`} />
        ))}
        {L.openings.map((pts, i) => (
          <polygon key={`o${i}`} points={pts.map((p) => `${p.x},${p.y}`).join(' ')} className="fp-opening" strokeWidth={stroke} />
        ))}
        {show === 'subfloor'
          ? L.sheets.map((x, i) => <rect key={i} x={x.x} y={x.y} width={x.w} height={x.h} className={x.cut ? 'fp-sheet cut' : 'fp-sheet'} strokeWidth={stroke} />)
          : L.joists.map((j, i) => <line key={i} x1={j.a.x} y1={j.a.y} x2={j.b.x} y2={j.b.y} className="fp-joist" strokeWidth={stroke * 1.5} />)}
        {show === 'joists' &&
          [...L.trimmers, ...L.headers].map((t, i) => <line key={`t${i}`} x1={t.a.x} y1={t.a.y} x2={t.b.x} y2={t.b.y} className="fp-trimmer" strokeWidth={stroke * 4} />)}
        {L.girders.map((g, i) => (
          <line key={i} x1={g.a.x} y1={g.a.y} x2={g.b.x} y2={g.b.y} className="fp-girder" strokeWidth={stroke * 6} />
        ))}
        {L.piers.map((p, i) => (
          <rect key={i} x={p.x - 8} y={p.y - 8} width={16} height={16} className="fp-pier" strokeWidth={stroke} />
        ))}
        {show === 'joists' && L.hangers.map((hg, i) => <circle key={`h${i}`} cx={hg.at.x} cy={hg.at.y} r={stroke * (hg.double ? 5 : 3.5)} className="fp-hanger" />)}
      </svg>
      <div className="legend">
        <span>
          <i className="sw fp-sw-joist" />
          Joist
        </span>
        {L.girders.length > 0 && (
          <span>
            <i className="sw fp-sw-girder" />
            Girder
          </span>
        )}
        {L.piers.length > 0 && (
          <span>
            <i className="sw fp-sw-pier" />
            Pier
          </span>
        )}
        {(L.trimmers.length > 0 || L.headers.length > 0) && (
          <span>
            <i className="sw fp-sw-trimmer" />
            Doubled trimmer / header
          </span>
        )}
        {L.hangers.length > 0 && (
          <span>
            <i className="sw fp-sw-hanger" />
            Hanger
          </span>
        )}
        {L.bearing.length > 0 && (
          <span>
            <i className="sw fp-sw-bearing" />
            Bearing wall below
          </span>
        )}
        {cantilevered && (
          <span>
            <i className="sw fp-sw-support" />
            Support line (cantilever beyond)
          </span>
        )}
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
