import { useMemo } from 'react';
import { roofCalc, roofFraming, ventPlan } from '../calc/roof.ts';
import { Stat } from '../editor/Inspector.tsx';
import type { Project } from '../model/types.ts';
import { formatFtIn } from '../model/units.ts';

/** The Framing tab's roof summary: wings, valleys, dormers and attic ventilation. */
export function RoofSummary({ project }: { project: Project }) {
  const c = useMemo(() => roofCalc(project), [project]);
  if (!c) return null;
  const fr = roofFraming(c);
  const vp = ventPlan(c);
  const { roof } = c;
  const name = { gable: 'Gable', hip: 'Hip', shed: 'Shed', none: '' }[roof.type];
  const wings = c.wings.length;
  return (
    <>
      <h3>Roof</h3>
      <p className="muted">
        {name} roof at {roof.pitch}/12
        {wings > 1
          ? ` in ${wings} parts: the main roof over ${formatFtIn(c.x1 - c.x0, { compact: true })} × ${formatFtIn(c.y1 - c.y0, { compact: true })} and ${wings - 1} wing${wings > 2 ? 's' : ''} off it, with ${c.valleys} valley${c.valleys === 1 ? '' : 's'}`
          : ` over the exterior walls' ${formatFtIn(c.x1 - c.x0, { compact: true })} × ${formatFtIn(c.y1 - c.y0, { compact: true })} outline`}
        {c.dormers.length ? `, ${c.dormers.length} dormer${c.dormers.length > 1 ? 's' : ''}` : ''}. Change it under Roof in the Plan tab's project panel; the print sheet has a roof plan.
      </p>
      <div className="stat-grid roof-stats">
        <Stat label={<>Roof area</>} value={<>{Math.round(c.area / 144).toLocaleString()} sq ft · {c.squares.toFixed(1)} sq</>} />
        <Stat label={<>Rise</>} value={<>{formatFtIn(c.rise)}</>} />
        <Stat label={<>{fr.kind === 'trusses' ? 'Trusses' : roof.type === 'hip' ? 'Rafters (approx.)' : 'Common rafters'}</>} value={<>{fr.count} @ {roof.spacing}" o.c.</>} />
        <Stat label={<>{fr.kind === 'trusses' ? 'Truss span' : 'Rafter length'}</>} value={<>{formatFtIn(fr.kind === 'trusses' ? c.W : c.rafterLength)}</>} />
        {c.ridgeLength > 0 && <Stat label={<>Ridge</>} value={<>{formatFtIn(c.ridgeLength)}</>} />}
        {c.hips > 0 && <Stat label={<>Hips ({c.hips})</>} value={<>{formatFtIn(c.hipLength)} total</>} />}
        {c.valleys > 0 && <Stat label={<>Valleys ({c.valleys})</>} value={<>{formatFtIn(c.valleyLength)} total</>} />}
        <Stat
          label={<>Attic vents (R806.2, 1/{c.vent.ratio})</>}
          value={
            <>
              {Math.round(c.vent.required)} sq in net
              {vp.ridgeVentFeet ? ` · ${vp.ridgeVentFeet}' ridge vent` : ''}
              {vp.louvers ? ` · ${vp.louvers} louvers` : ''}
            </>
          }
        />
      </div>
      {c.dormers.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Dormer</th>
                <th className="num">Width</th>
                <th className="num">Depth</th>
                <th className="num">Roof</th>
                <th className="num">Walls</th>
                <th className="num">Rafters</th>
              </tr>
            </thead>
            <tbody>
              {c.dormers.map((d, i) => (
                <tr key={d.dormer.id}>
                  <td>
                    {i + 1}. {d.dormer.type} at {d.dormer.pitch}/12
                  </td>
                  <td className="num">{formatFtIn(d.dormer.width)}</td>
                  <td className="num">{formatFtIn(d.depth)}</td>
                  <td className="num">{Math.round(d.roofArea / 144)} sq ft</td>
                  <td className="num">{Math.round((d.frontArea + d.cheekArea) / 144)} sq ft</td>
                  <td className="num">{d.rafters}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {c.notes.map((n) => (
        <p key={n} className="muted">
          ⚠ {n}
        </p>
      ))}
    </>
  );
}
