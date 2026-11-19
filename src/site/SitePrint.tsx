import { landscapeLines } from '../calc/landscape.ts';
import { pickSiteScale, SITE_MARGIN } from '../calc/sheet.ts';
import { MATERIAL_LABEL, siteSummary, SQFT } from '../calc/site.ts';
import { isNative, PLANT_BY_ID } from '../data/plants.ts';
import { PlanDrawing } from '../editor/PlanDrawing.tsx';
import { polygonArea, polygonCentroid } from '../model/geometry.ts';
import { EMPTY_SITE, type Point, type Project } from '../model/types.ts';
import { formatFtIn, formatSqFt } from '../model/units.ts';
import { LandscapeLayers } from './LandscapeV2.tsx';

// Printable site plan (Letter landscape, engineering scale) + planting schedule.
// Shown only in print, from the Site tab (see App.tsx and @media print).

export function SitePrintSheet({ project }: { project: Project }) {
  const site = project.site ?? EMPTY_SITE;
  const pts: Point[] = [...(site.lot ?? []), ...project.walls.flatMap((w) => [w.a, w.b]), ...site.areas.flatMap((a) => a.points), ...site.plants.map((p) => p.at)];
  if (!pts.length) return null;
  const minX = Math.min(...pts.map((p) => p.x)) - 24;
  const minY = Math.min(...pts.map((p) => p.y)) - 24;
  const w = Math.max(...pts.map((p) => p.x)) + 24 - minX;
  const h = Math.max(...pts.map((p) => p.y)) + 24 - minY;
  const scale = pickSiteScale(w, h);
  const m = SITE_MARGIN * scale.denom;
  const px = (n: number) => ((n * 0.75) / 72) * scale.denom;
  const poly = (p: Point[]) => p.map((q) => `${q.x},${q.y}`).join(' ');
  const s = siteSummary(project);
  const barFt = scale.denom / 12;

  const counts = new Map<string, number>();
  for (const p of site.plants) counts.set(p.species, (counts.get(p.species) ?? 0) + 1);
  const schedule = [...counts].map(([id, n]) => ({ sp: PLANT_BY_ID.get(id), n })).filter((r) => r.sp).sort((a, b) => a.sp!.form.localeCompare(b.sp!.form) || a.sp!.name.localeCompare(b.sp!.name));
  const extras = landscapeLines(project);

  return (
    <>
      <div className="print-only print-sheet">
        <svg width={`${(w + 2 * m) / scale.denom}in`} height={`${(h + 2 * m) / scale.denom}in`} viewBox={`${minX - m} ${minY - m} ${w + 2 * m} ${h + 2 * m}`} className="print-plan site">
          {site.lot && <polygon className="lot" points={poly(site.lot)} strokeWidth={px(1.5)} />}
          {s.buildable.length > 0 && <polygon className="envelope" points={poly(s.buildable)} strokeWidth={px(1)} strokeDasharray={`${px(6)} ${px(4)}`} />}
          {site.areas.map((a) => {
            const c = polygonCentroid(a.points);
            return (
              <g key={a.id}>
                <polygon className={`area area-${a.material}`} points={poly(a.points)} strokeWidth={px(0.6)} />
                {polygonArea(a.points) / (scale.denom * scale.denom) > 0.15 && (
                  <text x={c.x} y={c.y} fontSize={px(7)} textAnchor="middle" className="area-label">
                    {MATERIAL_LABEL[a.material]}
                  </text>
                )}
              </g>
            );
          })}
          <LandscapeLayers project={project} px={px} sel={null} print />
          <PlanDrawing project={project} px={px} wallDims={false} overallDims={false} outlets={false} />
          {site.plants.map((p) => {
            const sp = PLANT_BY_ID.get(p.species);
            return (
              <g key={p.id} className={`plant plant-${sp?.form ?? 'shrub'}`}>
                <circle cx={p.at.x} cy={p.at.y} r={((sp?.spread ?? 3) * 12) / 2} strokeWidth={px(0.5)} />
                <circle cx={p.at.x} cy={p.at.y} r={px(1.2)} className="trunk" />
              </g>
            );
          })}
          {/* North arrow (plan up = north) and scale bar */}
          <g transform={`translate(${minX + w - px(20)} ${minY + px(10)})`}>
            <path d={`M0 ${px(-8)}L${px(5)} ${px(8)}L0 ${px(4)}L${px(-5)} ${px(8)}z`} fill="currentColor" />
            <text y={px(20)} fontSize={px(9)} textAnchor="middle">
              N
            </text>
          </g>
          <g transform={`translate(${minX} ${minY + h - px(14)})`}>
            {Array.from({ length: 4 }, (_, i) => (
              <rect key={i} x={(i * barFt * 12) / 4} y={0} width={(barFt * 12) / 4} height={px(4)} fill={i % 2 ? 'none' : 'currentColor'} stroke="currentColor" strokeWidth={px(0.6)} />
            ))}
            <text x={0} y={px(14)} fontSize={px(8)}>
              0
            </text>
            <text x={barFt * 12} y={px(14)} fontSize={px(8)} textAnchor="middle">
              {barFt}'
            </text>
          </g>
        </svg>
        <div className="title-block">
          <div>
            <div className="tb-name">{project.name}</div>
            <div>
              Site plan
              {site.lot ? ` · lot ${Math.round(s.lotArea / SQFT).toLocaleString()} sq ft · coverage ${(s.coverage * 100).toFixed(1)}% · impervious ${(s.impervious * 100).toFixed(1)}%` : ''}
            </div>
          </div>
          <div>
            <div className="tb-label">Scale</div>
            <div>{scale.label}</div>
          </div>
          <div>
            <div className="tb-label">Date</div>
            <div>{new Date().toLocaleDateString()}</div>
          </div>
          <div className="tb-note">Plan north is up. Lot lines, easements and setbacks as entered — verify against the recorded plat / survey.</div>
        </div>
      </div>
      {(schedule.length > 0 || extras.length > 0) && (
        <div className="print-only schedule-page">
          <div className="tb-name">{project.name} — planting schedule</div>
          {schedule.length > 0 && (
            <table className="schedule">
              <thead>
                <tr>
                  <th>Qty</th>
                  <th>Common name</th>
                  <th>Botanical name</th>
                  <th>Mature h × w</th>
                  <th>Zones</th>
                  <th>Native here</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map(({ sp, n }) => (
                  <tr key={sp!.id}>
                    <td>{n}</td>
                    <td>{sp!.name}</td>
                    <td>
                      <i>{sp!.botanical}</i>
                    </td>
                    <td>
                      {sp!.height}' × {sp!.spread}'
                    </td>
                    <td>
                      {sp!.zones[0]}–{sp!.zones[1]}
                    </td>
                    <td>{site.region ? (isNative(sp!, site.region) ? 'yes' : '—') : 'region not set'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {(site.areas.length > 0 || extras.length > 0) && (
            <table className="schedule">
              <thead>
                <tr>
                  <th>Surface / item</th>
                  <th>Quantity</th>
                  <th>Basis</th>
                </tr>
              </thead>
              <tbody>
                {site.areas.map((a) => (
                  <tr key={a.id}>
                    <td>{MATERIAL_LABEL[a.material]}</td>
                    <td>{formatSqFt(polygonArea(a.points))}</td>
                    <td>{a.depth ? `${formatFtIn(a.depth)} deep` : '—'}</td>
                  </tr>
                ))}
                {extras.map((l) => (
                  <tr key={l.item}>
                    <td>{l.item}</td>
                    <td>
                      {l.qty} {l.unit}
                    </td>
                    <td>{l.basis}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="tb-note">Mature sizes are typical figures; cultivar, climate and pruning change them.</div>
        </div>
      )}
    </>
  );
}
