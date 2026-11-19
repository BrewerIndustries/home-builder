import { roofCalc, roofPlan } from '../calc/roof.ts';
import { DIM_ROOM, pickScale, pointBounds } from '../calc/sheet.ts';
import type { Project } from '../model/types.ts';

// Print sheet page 2: the roof plan, to scale — overhung outline, ridges, hips,
// valleys, dormers, the walls below dashed, and each wing's pitch.

export function RoofPlanSheet({ project }: { project: Project }) {
  const plan = roofPlan(project);
  const c = roofCalc(project);
  if (!plan || !c || !plan.outline.length) return null;
  const b = pointBounds(plan.outline.flat(), 12);
  const scale = pickScale(b.w, b.h);
  const lead = DIM_ROOM.lead * scale.denom;
  const trail = DIM_ROOM.trail * scale.denom;
  const px = (n: number) => ((n * 0.75) / 72) * scale.denom;
  const line = (s: [{ x: number; y: number }, { x: number; y: number }], i: number, w: number, dash?: number) => (
    <line key={i} x1={s[0].x} y1={s[0].y} x2={s[1].x} y2={s[1].y} stroke="currentColor" strokeWidth={px(w)} strokeDasharray={dash ? `${px(dash)} ${px(dash)}` : undefined} />
  );
  const ext = project.walls.filter((w) => w.kind === 'exterior');
  const name = { gable: 'Gable', hip: 'Hip', shed: 'Shed', none: '' }[c.roof.type];
  return (
    <div className="print-only print-sheet roof-sheet">
      <svg width={`${(b.w + lead + trail) / scale.denom}in`} height={`${(b.h + lead + trail) / scale.denom}in`} viewBox={`${b.x - lead} ${b.y - lead} ${b.w + lead + trail} ${b.h + lead + trail}`}>
        <g opacity={0.5}>{ext.map((w, i) => line([w.a, w.b], i, 0.6, 3))}</g>
        <g>{plan.outline.map((s, i) => line(s, i, 1.4))}</g>
        <g>{plan.ridges.map((s, i) => line(s, i, 1.2))}</g>
        <g>{plan.hips.map((s, i) => line(s, i, 0.9))}</g>
        <g>{plan.valleys.map((s, i) => line(s, i, 0.9, 4))}</g>
        {plan.dormers.map((d, i) => (
          <g key={i}>
            <polygon points={d.outline.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="currentColor" strokeWidth={px(0.9)} />
            {d.ridge && line(d.ridge, 0, 0.9)}
            {d.valleys.map((s, k) => line(s, k + 1, 0.7, 3))}
          </g>
        ))}
        {plan.labels.map((l, i) => (
          <text key={i} x={l.at.x} y={l.at.y} fontSize={px(9)} textAnchor="middle" fill="currentColor">
            {l.text}
          </text>
        ))}
      </svg>
      <div className="title-block">
        <div>
          <div className="tb-name">{project.name} — roof plan</div>
          <div>
            {name} roof, {c.roof.pitch}/12 · {Math.round(c.area / 144).toLocaleString()} sq ft · {c.roof.overhang}" eaves
            {c.roof.type === 'gable' || c.roof.type === 'shed' ? `, ${c.roof.rake}" rakes` : ''} · attic vents {Math.round(c.vent.required)} sq in net (R806.2, 1/{c.vent.ratio})
          </div>
          <div className="tb-note">Solid: eaves, ridges, hips · dashed: valleys, walls below</div>
        </div>
        <div>
          <div className="tb-label">Scale</div>
          <div>{scale.label}</div>
        </div>
        <div>
          <div className="tb-label">Date</div>
          <div>{new Date().toLocaleDateString()}</div>
        </div>
        <div className="tb-note">Design drawing — not for construction without code / engineering review.</div>
      </div>
    </div>
  );
}
