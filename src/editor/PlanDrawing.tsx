import { exclusiveArea } from '../calc/regions.ts';
import { pointAlong, polygonCentroid, wallDir, wallLength, wallNormal } from '../model/geometry.ts';
import type { Opening, Outlet, Point, Project, Wall } from '../model/types.ts';
import { formatFtIn, formatSqFt } from '../model/units.ts';
import type { Hit } from './hitTest.ts';
import { outletPosition } from './outletGeometry.ts';

// The plan as a picture: rooms, walls, openings, outlets and dimensions, in plan
// inches. Shared by the interactive canvas and the to-scale print sheet. `px`
// converts a screen/paper size into plan inches so text and strokes stay legible.

interface Props {
  project: Project;
  px(n: number): number;
  selection?: Hit | null;
  wallDims?: boolean;
  overallDims?: boolean;
  outlets?: boolean;
}

export function PlanDrawing({ project, px, selection = null, wallDims = true, overallDims = true, outlets = true }: Props) {
  const wallsById = new Map(project.walls.map((w) => [w.id, w]));
  return (
    <g className="plan-drawing">
      {project.rooms.map((r) => {
        const c = polygonCentroid(r.points);
        const sel = selection?.kind === 'room' && selection.id === r.id;
        return (
          <g key={r.id}>
            <polygon points={r.points.map((p) => `${p.x},${p.y}`).join(' ')} fill={sel ? 'var(--room-sel)' : 'var(--room)'} stroke="none" />
            <text x={c.x} y={c.y - px(4)} className="room-label" fontSize={px(13)} textAnchor="middle">
              {r.name}
            </text>
            <text x={c.x} y={c.y + px(12)} className="room-area" fontSize={px(11)} textAnchor="middle">
              {formatSqFt(exclusiveArea(project, r))}
            </text>
          </g>
        );
      })}

      {project.walls.map((w) => {
        const sel = selection?.kind === 'wall' && selection.id === w.id;
        return (
          <line
            key={w.id}
            x1={w.a.x}
            y1={w.a.y}
            x2={w.b.x}
            y2={w.b.y}
            strokeWidth={w.thickness}
            strokeLinecap="square"
            stroke={sel ? 'var(--accent)' : w.kind === 'exterior' ? 'var(--wall-ext)' : 'var(--wall-int)'}
          />
        );
      })}

      {project.openings.map((o) => {
        const w = wallsById.get(o.wallId);
        return w ? <OpeningGlyph key={o.id} wall={w} o={o} selected={selection?.kind === 'opening' && selection.id === o.id} px={px} /> : null;
      })}
      {outlets &&
        project.outlets.map((o) => {
          const w = wallsById.get(o.wallId);
          return w ? <OutletGlyph key={o.id} wall={w} o={o} selected={selection?.kind === 'outlet' && selection.id === o.id} px={px} /> : null;
        })}

      {wallDims && project.walls.map((w) => <WallDimension key={w.id} w={w} px={px} />)}
      {overallDims && <OverallDimensions project={project} px={px} />}
    </g>
  );
}

/**
 * Exterior dimension strings: a chain through every exterior corner along the top
 * and left, and the overall size outside it. A plain rectangle gets just the overall.
 */
export function OverallDimensions({ project, px }: { project: Project; px(n: number): number }) {
  const ext = project.walls.filter((w) => w.kind === 'exterior');
  if (!ext.length) return null;
  const pts = ext.flatMap((w) => [w.a, w.b]);
  const t = Math.max(...ext.map((w) => w.thickness)) / 2;
  const xs = uniq(pts.map((p) => p.x));
  const ys = uniq(pts.map((p) => p.y));
  const minX = xs[0];
  const maxX = xs.at(-1)!;
  const minY = ys[0];
  const maxY = ys.at(-1)!;
  const chainOff = t + px(28);
  const overallOff = t + px(52);
  return (
    <g className="dims">
      {xs.length > 2 && <DimString axis="x" stops={xs} at={minY - chainOff} px={px} />}
      <DimString axis="x" stops={[minX, maxX]} at={minY - (xs.length > 2 ? overallOff : chainOff)} px={px} />
      {ys.length > 2 && <DimString axis="y" stops={ys} at={minX - chainOff} px={px} />}
      <DimString axis="y" stops={[minY, maxY]} at={minX - (ys.length > 2 ? overallOff : chainOff)} px={px} />
    </g>
  );
}

function uniq(ns: number[]): number[] {
  const out: number[] = [];
  for (const n of [...ns].sort((a, b) => a - b)) if (!out.length || n - out.at(-1)! > 0.5) out.push(n);
  return out;
}

function DimString({ axis, stops, at, px }: { axis: 'x' | 'y'; stops: number[]; at: number; px(n: number): number }) {
  const P = (along: number, across: number): Point => (axis === 'x' ? { x: along, y: across } : { x: across, y: along });
  const a = P(stops[0], at);
  const b = P(stops.at(-1)!, at);
  const tick = px(5);
  return (
    <g>
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="dim-line" strokeWidth={px(1)} />
      {stops.map((s) => {
        const p = P(s, at);
        // 45° architectural tick.
        return <line key={s} x1={p.x - tick} y1={p.y + tick} x2={p.x + tick} y2={p.y - tick} className="dim-line" strokeWidth={px(1.2)} />;
      })}
      {stops.slice(1).map((s, i) => {
        const mid = P((stops[i] + s) / 2, at - px(5));
        const len = s - stops[i];
        if (len < px(30)) return null;
        return (
          <text
            key={s}
            x={mid.x}
            y={mid.y}
            fontSize={px(11)}
            textAnchor="middle"
            className="dim"
            transform={axis === 'y' ? `rotate(-90 ${mid.x} ${mid.y})` : undefined}
          >
            {formatFtIn(len)}
          </text>
        );
      })}
    </g>
  );
}

export function OpeningGlyph({ wall, o, selected, ghost, px }: { wall: Wall; o: Opening; selected: boolean; ghost?: boolean; px(n: number): number }) {
  const d = wallDir(wall);
  const n = wallNormal(wall);
  const c = pointAlong(wall, o.offset);
  const half = o.width / 2;
  const t = wall.thickness / 2;
  const p1 = { x: c.x - d.x * half, y: c.y - d.y * half };
  const p2 = { x: c.x + d.x * half, y: c.y + d.y * half };
  const corner = (p: Point, k: number) => `${p.x + n.x * t * k},${p.y + n.y * t * k}`;
  const gap = [corner(p1, 1), corner(p2, 1), corner(p2, -1), corner(p1, -1)].join(' ');
  const stroke = selected ? 'var(--accent)' : 'var(--opening)';
  const cls = ghost ? 'ghost' : undefined;

  if (o.kind === 'window') {
    return (
      <g className={cls}>
        <polygon points={gap} fill="var(--canvas)" />
        <polygon points={gap} fill="none" stroke={stroke} strokeWidth={px(1.5)} />
        <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={stroke} strokeWidth={px(1.5)} />
      </g>
    );
  }
  const side = o.swing?.side ?? 1;
  const hingeAtA = (o.swing?.hinge ?? 'a') === 'a';
  const hinge = hingeAtA ? p1 : p2;
  const free = hingeAtA ? p2 : p1;
  const offEdge = (p: Point) => ({ x: p.x + n.x * t * side, y: p.y + n.y * t * side });
  const h = offEdge(hinge);
  const leafEnd = { x: h.x + n.x * o.width * side, y: h.y + n.y * o.width * side };
  const f = offEdge(free);
  // Sweep direction depends on which end the hinge is and which side it swings to.
  const sweep = (hingeAtA ? 1 : 0) ^ (side === 1 ? 0 : 1);
  return (
    <g className={cls}>
      <polygon points={gap} fill="var(--canvas)" />
      <line x1={h.x} y1={h.y} x2={leafEnd.x} y2={leafEnd.y} stroke={stroke} strokeWidth={px(2)} />
      <path d={`M ${leafEnd.x} ${leafEnd.y} A ${o.width} ${o.width} 0 0 ${sweep} ${f.x} ${f.y}`} fill="none" stroke={stroke} strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`} />
    </g>
  );
}

function OutletGlyph({ wall, o, selected, px }: { wall: Wall; o: Outlet; selected: boolean; px(n: number): number }) {
  const c = outletPosition(wall, o);
  const d = wallDir(wall);
  const r = 4;
  const stroke = selected ? 'var(--accent)' : 'var(--outlet)';
  // Standard duplex symbol: a circle with two prongs parallel to the wall face.
  const prong = (k: number) => {
    const n = wallNormal(wall);
    const ox = n.x * k * 1.6;
    const oy = n.y * k * 1.6;
    return <line x1={c.x + ox - d.x * r * 0.6} y1={c.y + oy - d.y * r * 0.6} x2={c.x + ox + d.x * r * 0.6} y2={c.y + oy + d.y * r * 0.6} stroke={stroke} strokeWidth={px(1.2)} />;
  };
  return (
    <g className={o.auto ? 'outlet auto' : 'outlet'}>
      <circle cx={c.x} cy={c.y} r={r} fill={o.kind === 'gfci' ? 'var(--outlet-gfci)' : 'var(--canvas)'} stroke={stroke} strokeWidth={px(1.5)} />
      {o.kind === '240v' ? (
        <text x={c.x} y={c.y} fontSize={4} textAnchor="middle" dominantBaseline="central" fill={stroke}>240</text>
      ) : (
        <>
          {prong(1)}
          {prong(-1)}
        </>
      )}
    </g>
  );
}

function WallDimension({ w, px }: { w: Wall; px(n: number): number }) {
  const len = wallLength(w);
  if (len < 12) return null;
  const n = wallNormal(w);
  const mid = pointAlong(w, len / 2);
  const off = w.thickness / 2 + px(10);
  const pos = { x: mid.x + n.x * off, y: mid.y + n.y * off };
  let angle = (Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x) * 180) / Math.PI;
  if (angle > 90 || angle <= -90) angle += 180;
  return (
    <text x={pos.x} y={pos.y} transform={`rotate(${angle} ${pos.x} ${pos.y})`} className="dim" fontSize={px(11)} textAnchor="middle" dominantBaseline="middle">
      {formatFtIn(len)}
    </text>
  );
}

