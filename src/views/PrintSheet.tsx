import { wallAreas } from '../calc/materials.ts';
import { PlanDrawing } from '../editor/PlanDrawing.tsx';
import type { Project } from '../model/types.ts';
import { DIM_ROOM, pickScale } from '../calc/sheet.ts';

// A to-scale floor plan sheet for printing / Save as PDF: US Letter landscape,
// largest standard architectural scale that fits, title block and scale bar.
// Only visible in print (see @media print in styles.css).

export function PrintSheet({ project }: { project: Project }) {
  const pts = project.walls.flatMap((w) => [w.a, w.b]);
  if (!pts.length) return null;
  const pad = Math.max(...project.walls.map((w) => w.thickness));
  const minX = Math.min(...pts.map((p) => p.x)) - pad;
  const minY = Math.min(...pts.map((p) => p.y)) - pad;
  const w = Math.max(...pts.map((p) => p.x)) + pad - minX;
  const h = Math.max(...pts.map((p) => p.y)) + pad - minY;
  const scale = pickScale(w, h);
  const lead = DIM_ROOM.lead * scale.denom; // plan inches of margin for dims (top / left)
  const trail = DIM_ROOM.trail * scale.denom;
  const vbW = w + lead + trail;
  const vbH = h + lead + trail;
  // Text and strokes are specified in "px" ≈ 3/4 pt on paper.
  const px = (n: number) => ((n * 0.75) / 72) * scale.denom;
  const floor = wallAreas(project).floor;
  const barFt = scale.denom >= 96 ? 20 : 10;

  return (
    <div className="print-only print-sheet">
      <svg
        width={`${vbW / scale.denom}in`}
        height={`${vbH / scale.denom}in`}
        viewBox={`${minX - lead} ${minY - lead} ${vbW} ${vbH}`}
        className="print-plan"
      >
        <PlanDrawing project={project} px={px} outlets />
        <g transform={`translate(${minX} ${minY + h + trail - px(22)})`}>
          {Array.from({ length: barFt / 5 }, (_, i) => (
            <rect key={i} x={i * 60} y={0} width={60} height={px(5)} fill={i % 2 ? 'none' : 'currentColor'} stroke="currentColor" strokeWidth={px(0.6)} />
          ))}
          <text x={0} y={px(16)} fontSize={px(9)}>
            0
          </text>
          <text x={barFt * 12} y={px(16)} fontSize={px(9)} textAnchor="middle">
            {barFt}'
          </text>
        </g>
      </svg>
      <div className="title-block">
        <div>
          <div className="tb-name">{project.name}</div>
          <div>Floor plan · {Math.round(floor).toLocaleString()} sq ft · dimensions to wall centrelines</div>
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
