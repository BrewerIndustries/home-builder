import type { ReactNode } from 'react';
import { exclusiveArea } from '../calc/regions.ts';
import { isFixture } from '../calc/furniture.ts';
import { pointAlong, polygonCentroid, wallDir, wallNormal } from '../model/geometry.ts';
import { roomCenter, switchWays } from '../calc/lighting.ts';
import { counterCorners, counterPoint, islandReceptacles, UPPER_DEPTH, upperSpans } from '../calc/counters.ts';
import { interiorStrings, openingChains, outerCorners, roomClearSizes, wallDimLabels, type DimLabel } from '../calc/faces.ts';
import type { Counter, Fixture, Furniture, Opening, Outlet, Point, Project, Wall } from '../model/types.ts';
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
  /** Schedule tags (WC-1, LAV-1 …) printed beside fixtures. */
  marks?: { at: Point; text: string }[];
}

export function PlanDrawing({ project, px, selection = null, wallDims = true, overallDims = true, outlets = true, marks = [] }: Props) {
  const wallsById = new Map(project.walls.map((w) => [w.id, w]));
  return (
    <g className="plan-drawing">
      {project.rooms.map((r) => {
        // An L-shaped room's corner average can sit in the notch; find its open middle instead.
        const centroid = r.points.length === 4 ? polygonCentroid(r.points) : roomCenter(project, r);
        // Lift the label clear of a ceiling fixture sitting on the room's centre.
        const busy = outlets && project.fixtures.some((f) => Math.abs(f.at.x - centroid.x) < 10 && Math.abs(f.at.y - centroid.y) < 10);
        const c = busy ? { x: centroid.x, y: centroid.y - 8 - px(18) } : centroid;
        const sel = selection?.kind === 'room' && selection.id === r.id;
        // Clear sizes: a rectangle's under its label; an L's body there and its leg's in the leg.
        const [size, leg] = wallDims ? roomClearSizes(project, r) : [];
        return (
          <g key={r.id}>
            <polygon points={r.points.map((p) => `${p.x},${p.y}`).join(' ')} fill={sel ? 'var(--room-sel)' : 'var(--room)'} stroke="none" />
            <text x={c.x} y={c.y - px(4)} className="room-label" fontSize={px(13)} textAnchor="middle">
              {r.name}
            </text>
            <text x={c.x} y={c.y + px(12)} className="room-area" fontSize={px(11)} textAnchor="middle">
              {formatSqFt(exclusiveArea(project, r))}
            </text>
            {size && (
              <text x={c.x} y={c.y + px(25)} className="room-area" fontSize={px(10)} textAnchor="middle">
                {formatFtIn(size.width)} × {formatFtIn(size.depth)}
              </text>
            )}
            {leg && (
              <text x={leg.at.x} y={leg.at.y} className="room-area" fontSize={px(10)} textAnchor="middle" dominantBaseline="middle">
                {formatFtIn(leg.width)} × {formatFtIn(leg.depth)}
              </text>
            )}
          </g>
        );
      })}

      {project.furniture.map((f) => (
        <FurnitureGlyph key={f.id} f={f} selected={selection?.kind === 'furniture' && selection.id === f.id} px={px} />
      ))}
      {project.counters.map((c) => (
        <CounterGlyph key={c.id} c={c} selected={selection?.kind === 'counter' && selection.id === c.id} px={px} />
      ))}
      {project.counters.flatMap((c) =>
        // Wall cabinets overhead: dashed, the usual plan convention for things above the cut.
        upperSpans(project, c).map(([s, e]) => (
          <polygon
            key={`${c.id}u${s}`}
            className="upper"
            points={[counterPoint(c, s, 0), counterPoint(c, e, 0), counterPoint(c, e, UPPER_DEPTH), counterPoint(c, s, UPPER_DEPTH)].map((p) => `${p.x},${p.y}`).join(' ')}
            strokeWidth={px(1)}
            strokeDasharray={`${px(4)} ${px(3)}`}
          />
        )),
      )}
      {outlets && islandReceptacles(project).map((r, i) => <circle key={i} cx={r.at.x} cy={r.at.y} r={4} className="island-recep" strokeWidth={px(1.5)} />)}

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
      {outlets && <Lighting project={project} selection={selection} px={px} />}

      {wallDims && wallDimLabels(project, project.dimMode ?? 'centre').map((l, i) => <WallDimension key={`${l.wall.id}-${i}`} l={l} px={px} />)}
      {wallDims && openingChains(project, project.dimMode ?? 'centre').map((c) => <OpeningChain key={c.wall.id} {...c} extra={project.dimOffsets?.[`chain:${c.wall.id}`] ?? 0} px={px} />)}
      {overallDims && <OverallDimensions project={project} px={px} />}
      {marks.map((m, i) => (
        <text key={`mark${i}`} x={m.at.x} y={m.at.y} className="fixture-mark" fontSize={px(8)} strokeWidth={px(2.5)} textAnchor="middle" dominantBaseline="central">
          {m.text}
        </text>
      ))}
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
  const pts = (project.dimMode ?? 'centre') === 'centre' ? ext.flatMap((w) => [w.a, w.b]) : outerCorners(project);
  const t = Math.max(...ext.map((w) => w.thickness)) / 2;
  const xs = uniq(pts.map((p) => p.x));
  const ys = uniq(pts.map((p) => p.y));
  const minX = xs[0];
  const maxX = xs.at(-1)!;
  const minY = ys[0];
  const maxY = ys.at(-1)!;
  // Leave room for the opening chains that run just outside the walls.
  const shift = project.openings.length ? px(16) : 0;
  const chainOff = t + px(28) + shift;
  const overallOff = t + px(52) + shift;
  const off = (id: string) => project.dimOffsets?.[id] ?? 0;
  // Strings through the interior walls run along the bottom and right, clear of the exterior chains.
  const inner = interiorStrings(project, project.dimMode ?? 'centre', { x: [minX, maxX], y: [minY, maxY] });
  return (
    <g className="dims">
      {xs.length > 2 && <DimString id="top-chain" axis="x" stops={xs} at={minY - chainOff - off('top-chain')} out={-1} px={px} />}
      <DimString id="top-overall" axis="x" stops={[minX, maxX]} at={minY - (xs.length > 2 ? overallOff : chainOff) - off('top-overall')} out={-1} px={px} />
      {ys.length > 2 && <DimString id="left-chain" axis="y" stops={ys} at={minX - chainOff - off('left-chain')} out={-1} px={px} />}
      <DimString id="left-overall" axis="y" stops={[minY, maxY]} at={minX - (ys.length > 2 ? overallOff : chainOff) - off('left-overall')} out={-1} px={px} />
      {inner.x.length > 2 && <DimString id="bottom-interior" axis="x" stops={inner.x} at={maxY + chainOff + off('bottom-interior')} out={1} px={px} />}
      {inner.y.length > 2 && <DimString id="right-interior" axis="y" stops={inner.y} at={maxX + chainOff + off('right-interior')} out={1} px={px} />}
    </g>
  );
}

/** A dimension chain along one wall, outside it: end → each opening centre → end. */
function OpeningChain({ wall, side, stops, extra, px }: { wall: Wall; side: 1 | -1; stops: number[]; extra: number; px(n: number): number }) {
  const d = wallDir(wall);
  const n = wallNormal(wall);
  const off = (wall.thickness / 2 + px(24) + extra) * side;
  const P = (t: number, extra = 0): Point => ({ x: wall.a.x + d.x * t + n.x * (off + extra * side), y: wall.a.y + d.y * t + n.y * (off + extra * side) });
  const tick = px(4);
  let angle = (Math.atan2(d.y, d.x) * 180) / Math.PI;
  if (angle > 90 || angle <= -90) angle += 180;
  const [a, b] = [P(stops[0]), P(stops.at(-1)!)];
  return (
    <g className="dims opening-chain" data-dim={`chain:${wall.id}`} data-out={`${n.x * side},${n.y * side}`}>
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="dim-hit" strokeWidth={px(10)} />
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="dim-line" strokeWidth={px(0.8)} />
      {stops.map((s, i) => {
        const p = P(s);
        // 45° tick, turned with the wall.
        const u = { x: (d.x + n.x) * tick, y: (d.y + n.y) * tick };
        return <line key={i} x1={p.x - u.x} y1={p.y - u.y} x2={p.x + u.x} y2={p.y + u.y} className="dim-line" strokeWidth={px(1)} />;
      })}
      {stops.slice(1).map((s, i) => {
        const len = s - stops[i];
        if (len < px(28)) return null;
        const m = P((stops[i] + s) / 2, px(6));
        return (
          <text key={i} x={m.x} y={m.y} transform={`rotate(${angle} ${m.x} ${m.y})`} className="dim" fontSize={px(9)} textAnchor="middle" dominantBaseline="middle">
            {formatFtIn(len)}
          </text>
        );
      })}
    </g>
  );
}

function uniq(ns: number[]): number[] {
  const out: number[] = [];
  for (const n of [...ns].sort((a, b) => a - b)) if (!out.length || n - out.at(-1)! > 0.5) out.push(n);
  return out;
}

function DimString({ id, axis, stops, at, out, px }: { id: string; axis: 'x' | 'y'; stops: number[]; at: number; out: 1 | -1; px(n: number): number }) {
  const P = (along: number, across: number): Point => (axis === 'x' ? { x: along, y: across } : { x: across, y: along });
  const a = P(stops[0], at);
  const b = P(stops.at(-1)!, at);
  const tick = px(5);
  const outward = axis === 'x' ? { x: 0, y: out } : { x: out, y: 0 };
  return (
    <g data-dim={id} data-out={`${outward.x},${outward.y}`}>
      {/* Wide invisible stroke: grab it to drag the string in or out. */}
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="dim-hit" strokeWidth={px(10)} />
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="dim-line" strokeWidth={px(1)} />
      {stops.map((s) => {
        const p = P(s, at);
        // 45° architectural tick.
        return <line key={s} x1={p.x - tick} y1={p.y + tick} x2={p.x + tick} y2={p.y - tick} className="dim-line" strokeWidth={px(1.2)} />;
      })}
      {stops.slice(1).map((s, i) => {
        // Text on the outer side of the line (hanging below it when outward is +).
        const mid = P((stops[i] + s) / 2, at + out * px(5));
        const len = s - stops[i];
        if (len < px(30)) return null;
        return (
          <text
            key={s}
            x={mid.x}
            y={mid.y}
            fontSize={px(11)}
            textAnchor="middle"
            dominantBaseline={out > 0 ? 'hanging' : undefined}
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

/** Ceiling lights and alarms, wall switches, and dashed switch legs from each switch to what it controls. */
function Lighting({ project, selection, px }: { project: Project; selection: Hit | null; px(n: number): number }) {
  const walls = new Map(project.walls.map((w) => [w.id, w]));
  // What a switch can run: lights, and receptacles (a switched receptacle).
  const targets = new Map<string, Point>(project.fixtures.map((f) => [f.id, f.at]));
  for (const o of project.outlets) {
    const w = walls.get(o.wallId);
    if (w) targets.set(o.id, outletPosition(w, o));
  }
  const switchedOutlets = new Set(project.switches.flatMap((s) => s.controls));
  const ways = switchWays(project);
  const switches = project.switches.flatMap((s) => {
    const w = walls.get(s.wallId);
    return w ? [{ s, w, at: outletPosition(w, { offset: s.offset, side: s.side }) }] : [];
  });
  return (
    <g className="lighting">
      {switches.flatMap(({ s, w, at }) =>
        s.controls.flatMap((id) => {
          const target = targets.get(id);
          if (!target) return [];
          // Bow the leg off the wall into the room so it doesn't run along the wall line.
          const n = { x: -wallDir(w).y * s.side, y: wallDir(w).x * s.side };
          const mid = { x: (at.x + target.x) / 2 + n.x * 18, y: (at.y + target.y) / 2 + n.y * 18 };
          const hot = (selection?.kind === 'switch' && selection.id === s.id) || ((selection?.kind === 'fixture' || selection?.kind === 'outlet') && selection.id === id);
          return [<path key={s.id + id} d={`M ${at.x} ${at.y} Q ${mid.x} ${mid.y} ${target.x} ${target.y}`} className={hot ? 'switch-leg hot' : 'switch-leg'} strokeWidth={px(hot ? 1.5 : 1)} strokeDasharray={`${px(5)} ${px(3)}`} />];
        }),
      )}
      {project.outlets
        .filter((o) => switchedOutlets.has(o.id) && targets.has(o.id))
        .map((o) => {
          const c = targets.get(o.id)!;
          // Switched receptacle: a small S beside the symbol.
          return (
            <text key={`s${o.id}`} x={c.x + 5} y={c.y - 5} fontSize={4.5} className="switched-recep" textAnchor="middle" dominantBaseline="central">
              S
            </text>
          );
        })}
      {project.fixtures.map((f) => (
        <FixtureGlyph key={f.id} f={f} selected={selection?.kind === 'fixture' && selection.id === f.id} px={px} />
      ))}
      {switches.map(({ s, at }) => {
        const sel = selection?.kind === 'switch' && selection.id === s.id;
        const n = ways.get(s.id) ?? 1;
        return (
          <g key={s.id} className={s.auto ? 'switch auto' : 'switch'}>
            <circle cx={at.x} cy={at.y} r={4} fill="var(--canvas)" stroke={sel ? 'var(--accent)' : 'var(--outlet)'} strokeWidth={px(1.2)} />
            <text x={at.x} y={at.y} fontSize={n === 1 ? 5.5 : 4.5} textAnchor="middle" dominantBaseline="central" fill={sel ? 'var(--accent)' : 'var(--outlet)'}>
              {n === 1 ? 'S' : `S${n}`}
            </text>
          </g>
        );
      })}
    </g>
  );
}

const ALARM_LABEL = { smoke: 'SD', co: 'CO', 'smoke-co': 'S/C' } as const;

function FixtureGlyph({ f, selected, px }: { f: Fixture; selected: boolean; px(n: number): number }) {
  const { x, y } = f.at;
  if (f.kind === 'fan') {
    const stroke = selected ? 'var(--accent)' : 'var(--outlet)';
    // Ceiling fan: a hub with four blades.
    return (
      <g className={f.auto ? 'fixture fan auto' : 'fixture fan'}>
        {[0, 90, 180, 270].map((deg) => (
          <ellipse key={deg} cx={x + 8} cy={y} rx={5} ry={2} transform={`rotate(${deg + 45} ${x} ${y})`} fill="var(--canvas)" stroke={stroke} strokeWidth={px(1.1)} />
        ))}
        <circle cx={x} cy={y} r={3.5} fill="var(--canvas)" stroke={stroke} strokeWidth={px(1.5)} />
      </g>
    );
  }
  if (f.kind === 'light' || f.kind === 'outdoor') {
    const stroke = selected ? 'var(--accent)' : 'var(--outlet)';
    const r = f.kind === 'outdoor' ? 4.5 : 6;
    const k = r * Math.SQRT1_2;
    // Ceiling lighting outlet: a circle crossed through.
    return (
      <g className={f.auto ? 'fixture auto' : 'fixture'}>
        <circle cx={x} cy={y} r={r} fill={f.kind === 'outdoor' ? 'var(--outlet-gfci)' : 'var(--canvas)'} stroke={stroke} strokeWidth={px(1.5)} />
        <line x1={x - k} y1={y - k} x2={x + k} y2={y + k} stroke={stroke} strokeWidth={px(1.2)} />
        <line x1={x - k} y1={y + k} x2={x + k} y2={y - k} stroke={stroke} strokeWidth={px(1.2)} />
      </g>
    );
  }
  const stroke = selected ? 'var(--accent)' : 'var(--alarm)';
  return (
    <g className={f.auto ? 'fixture alarm auto' : 'fixture alarm'}>
      <circle cx={x} cy={y} r={6.5} fill="var(--alarm-fill)" stroke={stroke} strokeWidth={px(1.5)} />
      <text x={x} y={y} fontSize={4.2} textAnchor="middle" dominantBaseline="central" fill={stroke} fontWeight={600}>
        {ALARM_LABEL[f.kind]}
      </text>
    </g>
  );
}

function WallDimension({ l, px }: { l: DimLabel; px(n: number): number }) {
  const w = l.wall;
  const len = l.length;
  if (len < 12) return null;
  const n = wallNormal(w);
  const mid = pointAlong(w, l.at);
  const off = (w.thickness / 2 + px(10)) * l.side;
  const pos = { x: mid.x + n.x * off, y: mid.y + n.y * off };
  let angle = (Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x) * 180) / Math.PI;
  if (angle > 90 || angle <= -90) angle += 180;
  return (
    <text x={pos.x} y={pos.y} transform={`rotate(${angle} ${pos.x} ${pos.y})`} className="dim" fontSize={px(11)} textAnchor="middle" dominantBaseline="middle">
      {formatFtIn(len)}
    </text>
  );
}


/** Counter outline with its sinks (double bowl) and ranges (four burners). */
/** A fixture or piece of furniture, drawn in its own frame (back toward −y). */
export function FurnitureGlyph({ f, selected, ghost, px }: { f: Furniture; selected: boolean; ghost?: boolean; px(n: number): number }) {
  const [w, d] = [f.w, f.d];
  const [l, t, r, b] = [-w / 2, -d / 2, w / 2, d / 2];
  const sw = px(1);
  const rect = (x0: number, y0: number, x1: number, y1: number, key?: string, rx = 0) => <rect key={key} x={x0} y={y0} width={x1 - x0} height={y1 - y0} rx={rx} strokeWidth={sw} />;
  const label = (text: string) => (
    <text x={0} y={0} fontSize={Math.min(9, w / 3, d / 2)} textAnchor="middle" dominantBaseline="central">
      {text}
    </text>
  );
  let body: ReactNode;
  switch (f.kind) {
    case 'toilet': {
      const tank = Math.min(9, d / 3);
      body = (
        <>
          {rect(l, t, r, t + tank)}
          <ellipse cx={0} cy={t + tank + (d - tank) / 2} rx={w / 2 - 1.5} ry={(d - tank) / 2} strokeWidth={sw} />
        </>
      );
      break;
    }
    case 'lavatory':
      body = (
        <>
          {rect(l, t, r, b)}
          <ellipse cx={0} cy={1} rx={Math.min(w * 0.32, 9)} ry={d * 0.3} strokeWidth={sw} />
          <circle cx={0} cy={t + 2.5} r={1} strokeWidth={sw} />
        </>
      );
      break;
    case 'tub':
      body = (
        <>
          {rect(l, t, r, b)}
          {rect(l + 3, t + 3, r - 3, b - 3, undefined, Math.min(8, d / 4))}
          <circle cx={l + 9} cy={0} r={1.5} strokeWidth={sw} />
        </>
      );
      break;
    case 'shower':
      body = (
        <>
          {rect(l, t, r, b)}
          <line x1={l} y1={t} x2={r} y2={b} strokeWidth={sw} />
          <line x1={r} y1={t} x2={l} y2={b} strokeWidth={sw} />
          <circle cx={0} cy={0} r={2} strokeWidth={sw} />
        </>
      );
      break;
    case 'bidet':
      body = (
        <>
          <ellipse cx={0} cy={0} rx={w / 2 - 0.5} ry={d / 2 - 0.5} strokeWidth={sw} />
          <ellipse cx={0} cy={2} rx={w / 4} ry={d / 4} strokeWidth={sw} />
          <circle cx={0} cy={t + 3} r={1} strokeWidth={sw} />
        </>
      );
      break;
    case 'kitchen-sink': {
      // Double bowl, faucet at the back.
      const bw = (w - 9) / 2;
      body = (
        <>
          {rect(l, t, r, b)}
          {rect(l + 3, t + 5, l + 3 + bw, b - 3, 'b1', 2)}
          {rect(r - 3 - bw, t + 5, r - 3, b - 3, 'b2', 2)}
          <circle cx={0} cy={t + 2.5} r={1} strokeWidth={sw} />
        </>
      );
      break;
    }
    case 'laundry-sink':
      body = (
        <>
          {rect(l, t, r, b)}
          {rect(l + 3, t + 5, r - 3, b - 3, undefined, 2)}
          <circle cx={0} cy={t + 2.5} r={1} strokeWidth={sw} />
        </>
      );
      break;
    case 'range': {
      const [bx, by] = [w / 4, d / 5];
      body = (
        <>
          {rect(l, t, r, b)}
          {[-1, 1].flatMap((i) => [-1, 1].map((j) => <circle key={`${i}${j}`} cx={i * bx} cy={j * by + 1} r={Math.min(w, d) / 7} strokeWidth={sw} />))}
          <line x1={l} y1={t + 3} x2={r} y2={t + 3} strokeWidth={sw} />
        </>
      );
      break;
    }
    case 'fridge':
      body = (
        <>
          {rect(l, t, r, b)}
          <line x1={l} y1={b - 2} x2={r} y2={b - 2} strokeWidth={sw} />
          {label('REF')}
        </>
      );
      break;
    case 'washer':
      body = (
        <>
          {rect(l, t, r, b)}
          <circle cx={0} cy={2} r={Math.min(w, d) * 0.32} strokeWidth={sw} />
          {label('W')}
        </>
      );
      break;
    case 'dryer':
      body = (
        <>
          {rect(l, t, r, b)}
          {label('D')}
        </>
      );
      break;
    case 'water-heater':
      body = (
        <>
          <circle cx={0} cy={0} r={Math.min(w, d) / 2} strokeWidth={sw} />
          {label('WH')}
        </>
      );
      break;
    case 'bed': {
      const pw = (w - 9) / 2;
      body = (
        <>
          {rect(l, t, r, b)}
          {w > 50 ? [rect(l + 3, t + 3, l + 3 + pw, t + 12, 'p1', 3), rect(r - 3 - pw, t + 3, r - 3, t + 12, 'p2', 3)] : rect(l + 3, t + 3, r - 3, t + 12, 'p', 3)}
          <line x1={l} y1={t + 22} x2={r} y2={t + 22} strokeWidth={sw} />
        </>
      );
      break;
    }
    case 'sofa':
    case 'chair': {
      const [back, arm] = f.kind === 'sofa' ? [9, 7] : [7, 5];
      body = (
        <>
          {rect(l, t, r, b, undefined, 3)}
          {rect(l + arm, t, r - arm, t + back)}
          <line x1={l + arm} y1={t + back} x2={l + arm} y2={b} strokeWidth={sw} />
          <line x1={r - arm} y1={t + back} x2={r - arm} y2={b} strokeWidth={sw} />
        </>
      );
      break;
    }
    case 'table': {
      const n = Math.max(1, Math.floor(w / 30));
      const seats = Array.from({ length: n }, (_, i) => l + (w * (i + 0.5)) / n);
      body = (
        <>
          {seats.flatMap((x) => [rect(x - 8, t - 14, x + 8, t - 2, `t${x}`, 2), rect(x - 8, b + 2, x + 8, b + 14, `b${x}`, 2)])}
          {rect(l, t, r, b)}
        </>
      );
      break;
    }
    case 'desk':
      body = (
        <>
          {rect(l, t, r, b)}
          {rect(-9, b + 2, 9, b + 18, undefined, 3)}
        </>
      );
      break;
    case 'dresser':
      body = (
        <>
          {rect(l, t, r, b)}
          {[1, 2].map((i) => (
            <line key={i} x1={l + (w * i) / 3} y1={t} x2={l + (w * i) / 3} y2={b} strokeWidth={sw} />
          ))}
        </>
      );
      break;
  }
  const cls = ['furniture', isFixture(f) ? 'fixture-sym' : '', selected ? 'sel' : '', ghost ? 'ghost' : ''].filter(Boolean).join(' ');
  return (
    <g className={cls} transform={`translate(${f.at.x} ${f.at.y}) rotate(${f.rot})`}>
      {body}
    </g>
  );
}

export function CounterGlyph({ c, selected, px }: { c: Counter; selected: boolean; px(n: number): number }) {
  const poly = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x},${p.y}`).join(' ');
  return (
    <g className={selected ? 'counter sel' : 'counter'}>
      <polygon points={poly(counterCorners(c))} strokeWidth={px(1.2)} />
      {c.cutouts.map((k) => {
        const [s, e] = [k.offset - k.width / 2, k.offset + k.width / 2];
        const box = (t0: number, t1: number, i0: number, i1: number) => [counterPoint(c, t0, i0), counterPoint(c, t1, i0), counterPoint(c, t1, i1), counterPoint(c, t0, i1)];
        if (k.kind === 'sink') {
          const mid = k.offset;
          return (
            <g key={k.id} className="cutout sink">
              <polygon points={poly(box(s + 1.5, mid - 0.75, 3, c.depth - 4))} strokeWidth={px(1)} />
              <polygon points={poly(box(mid + 0.75, e - 1.5, 3, c.depth - 4))} strokeWidth={px(1)} />
            </g>
          );
        }
        if (k.kind === 'dishwasher' || k.kind === 'fridge') {
          const at = counterPoint(c, k.offset, c.depth / 2);
          return (
            <g key={k.id} className={`cutout ${k.kind}`}>
              <polygon points={poly(box(s + 0.5, e - 0.5, 0.5, c.depth - 0.5))} strokeWidth={px(1)} strokeDasharray={k.kind === 'dishwasher' ? `${px(3)} ${px(2)}` : undefined} />
              <text x={at.x} y={at.y} fontSize={Math.min(7, (e - s) / 4)} textAnchor="middle" dominantBaseline="central">
                {k.kind === 'fridge' ? 'REF' : 'DW'}
              </text>
            </g>
          );
        }
        const w = e - s;
        return (
          <g key={k.id} className="cutout range">
            <polygon points={poly(box(s, e, 0.5, c.depth - 0.5))} strokeWidth={px(1)} />
            {[0.28, 0.72].flatMap((u) => [0.3, 0.7].map((v) => {
              const p = counterPoint(c, s + w * u, c.depth * v);
              return <circle key={`${u}${v}`} cx={p.x} cy={p.y} r={Math.min(w, c.depth) * 0.16} strokeWidth={px(1)} />;
            }))}
          </g>
        );
      })}
    </g>
  );
}
