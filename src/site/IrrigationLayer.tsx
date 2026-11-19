import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode } from 'react';
import { autoLayoutZone, headGpm, headToHead, irrigationLines, irrigationOf, nozzleFor, pipeRuns, zoneCoverage, zoneGpm, zoneHeads } from '../calc/irrigation.ts';
import { MATERIAL_LABEL } from '../calc/site.ts';
import { Field, Stat } from '../editor/Inspector.tsx';
import { LengthInput } from '../editor/LengthInput.tsx';
import { dist, polygonArea, snapToGrid } from '../model/geometry.ts';
import { HEAD_LABEL, TYPICAL_NOZZLES, type HeadKind, type Irrigation, type IrrigationHead, type IrrigationZone, type LayoutPattern } from '../model/irrigation.ts';
import type { Action } from '../model/store.ts';
import { EMPTY_SITE, uid, type Point, type Project } from '../model/types.ts';
import { formatFtIn, formatSqFt } from '../model/units.ts';

// Irrigation tool on the Site tab: zones over lawn / bed areas, heads with
// coverage arcs, a sampled gap map, routed pipe from the manifold, and the
// zone flow / parts panel. Everything is written back through `setSite`.

type Mode = 'select' | 'head' | 'manifold' | 'backflow';
type Drag = { kind: 'head'; id: string; grab: Point } | { kind: 'manifold' | 'backflow' };

const KINDS: HeadKind[] = ['spray', 'rotor', 'drip'];
const HIT_PX = 9;

/** SVG path for a head's wetted sector. */
function sectorPath(h: IrrigationHead): string {
  const { x, y } = h.at;
  const r = h.radius;
  if (h.arc >= 360) return `M ${x - r} ${y} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
  const a0 = (h.rotation * Math.PI) / 180;
  const a1 = ((h.rotation + h.arc) * Math.PI) / 180;
  const large = h.arc > 180 ? 1 : 0;
  return `M ${x} ${y} L ${x + r * Math.cos(a0)} ${y + r * Math.sin(a0)} A ${r} ${r} 0 ${large} 1 ${x + r * Math.cos(a1)} ${y + r * Math.sin(a1)} Z`;
}

export interface IrrigationTool {
  /** Handle a press on the plan; false = nothing hit (caller may pan). */
  onDown(p: Point): boolean;
  /** Handle a move; true while this tool is dragging. */
  onMove(p: Point): boolean;
  onUp(): void;
  /** Handle a key; true if consumed. */
  onKey(e: KeyboardEvent): boolean;
  svg(px: (n: number) => number): ReactNode;
  panel: ReactNode;
  hint: string;
}

export function useIrrigationTool(project: Project, dispatch: Dispatch<Action>, scale: number, active: boolean): IrrigationTool {
  const irr = irrigationOf(project);
  const [mode, setMode] = useState<Mode>('select');
  const [zoneId, setZoneId] = useState<string | null>(irr.zones[0]?.id ?? null);
  const [selHead, setSelHead] = useState<string | null>(null);
  const [showGaps, setShowGaps] = useState(true);
  const drag = useRef<Drag | null>(null);
  const zone = irr.zones.find((z) => z.id === zoneId) ?? null;

  const put = (next: Partial<Irrigation>, transient = false) => dispatch({ type: 'setSite', patch: { irrigation: { ...irr, ...next } }, transient });

  // Drop stale selections after undo / delete.
  useEffect(() => {
    if (zoneId && !irr.zones.some((z) => z.id === zoneId)) setZoneId(irr.zones[0]?.id ?? null);
    if (selHead && !irr.heads.some((h) => h.id === selHead)) setSelHead(null);
  }, [irr, zoneId, selHead]);

  const runs = useMemo(() => pipeRuns(project), [project]);
  const coverage = useMemo(() => (active && showGaps && zone && zone.kind !== 'drip' ? zoneCoverage(project, zone) : null), [active, showGaps, zone, project]);

  const tol = HIT_PX / scale;
  function onDown(p: Point): boolean {
    if (mode === 'manifold' || mode === 'backflow') {
      put({ [mode]: snapToGrid(p, 6) });
      setMode('select');
      return true;
    }
    if (mode === 'head') {
      if (!zone) return true;
      const n = nozzleFor(irr, zone.kind);
      const h: IrrigationHead = { id: uid('h'), zoneId: zone.id, kind: zone.kind, at: snapToGrid(p, 6), radius: n.radius, arc: 360, rotation: 0 };
      put({ heads: [...irr.heads, h] });
      setSelHead(h.id);
      return true;
    }
    for (const k of ['manifold', 'backflow'] as const) {
      const at = irr[k];
      if (at && dist(at, p) <= tol) {
        dispatch({ type: 'checkpoint' });
        drag.current = { kind: k };
        setSelHead(null);
        return true;
      }
    }
    const h = irr.heads.filter((x) => dist(x.at, p) <= Math.max(tol, 4)).sort((a, b) => dist(a.at, p) - dist(b.at, p))[0];
    if (h) {
      setSelHead(h.id);
      setZoneId(h.zoneId);
      dispatch({ type: 'checkpoint' });
      drag.current = { kind: 'head', id: h.id, grab: { x: p.x - h.at.x, y: p.y - h.at.y } };
      return true;
    }
    setSelHead(null);
    return false;
  }

  function onMove(p: Point): boolean {
    const d = drag.current;
    if (!d) return false;
    if (d.kind === 'head') {
      const at = snapToGrid({ x: p.x - d.grab.x, y: p.y - d.grab.y }, 6);
      put({ heads: irr.heads.map((h) => (h.id === d.id ? { ...h, at } : h)) }, true);
    } else put({ [d.kind]: snapToGrid(p, 6) }, true);
    return true;
  }

  function onKey(e: KeyboardEvent): boolean {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selHead) {
      put({ heads: irr.heads.filter((h) => h.id !== selHead) });
      setSelHead(null);
      return true;
    }
    if (e.key === 'Escape' && (selHead || mode !== 'select')) {
      setSelHead(null);
      setMode('select');
      return true;
    }
    return false;
  }

  function svg(px: (n: number) => number): ReactNode {
    if (!irr.heads.length && !irr.manifold && !irr.backflow && !active) return null;
    const dim = active ? 1 : 0.55;
    return (
      <g opacity={dim}>
        {coverage &&
          coverage.cells
            .filter((c) => c.n < 2)
            .map((c, i) => (
              <rect key={i} fill={c.n === 0 ? '#dc2626' : '#f59e0b'} fillOpacity={c.n === 0 ? 0.45 : 0.25} x={c.at.x - coverage.step / 2} y={c.at.y - coverage.step / 2} width={coverage.step} height={coverage.step} />
            ))}
        {irr.heads
          .filter((h) => h.kind !== 'drip')
          .map((h) => (
            <path key={h.id} d={sectorPath(h)} fill={h.kind === 'rotor' ? '#7c3aed' : '#0ea5e9'} fillOpacity={h.zoneId === zoneId && active ? 0.16 : 0.08} stroke={h.kind === 'rotor' ? '#7c3aed' : '#0284c7'} strokeOpacity={0.6} strokeWidth={px(1)} pointerEvents="none" />
          ))}
        {runs.map((r) =>
          r.paths.map((pts, i) => (
            <polyline
              key={`${r.label}-${i}`}
              stroke={r.id === 'main' ? '#1e3a8a' : r.kind === 'drip' ? '#7c4a1e' : '#2563eb'}
              strokeLinejoin="round"
              points={pts.map((q) => `${q.x},${q.y}`).join(' ')}
              fill="none"
              strokeWidth={px(r.id === 'main' ? 3.5 : r.kind === 'drip' ? 1.5 : 2.5)}
              strokeDasharray={r.kind === 'drip' ? `${px(4)} ${px(3)}` : undefined}
            />
          )),
        )}
        {runs
          .filter((r) => r.id === 'main')
          .map((r) => {
            const pts = r.paths[0];
            const m = pts[Math.floor(pts.length / 2)];
            return (
              <text key="main-label" x={m.x + px(6)} y={m.y - px(6)} fontSize={px(10)} fill="#1e3a8a" fontWeight={600} paintOrder="stroke" stroke="white" strokeWidth={px(3)}>
                {formatFtIn(r.length, { compact: true })} main
              </text>
            );
          })}
        {irr.heads.map((h) => (
          <circle
            key={h.id}
            fill={h.kind === 'drip' ? '#7c4a1e' : h.kind === 'rotor' ? '#7c3aed' : '#0284c7'}
            stroke={h.id === selHead ? 'var(--accent)' : 'white'}
            cx={h.at.x}
            cy={h.at.y}
            r={px(h.kind === 'drip' ? 2.5 : h.id === selHead ? 5 : 4)}
            strokeWidth={px(1.2)}
          />
        ))}
        {irr.backflow && (
          <g fill="white" stroke="#1e3a8a">
            <circle cx={irr.backflow.x} cy={irr.backflow.y} r={px(8)} strokeWidth={px(1.5)} />
            <text stroke="none" fill="#1e3a8a" fontWeight={700} x={irr.backflow.x} y={irr.backflow.y + px(3.5)} fontSize={px(9)} textAnchor="middle">
              BF
            </text>
          </g>
        )}
        {irr.manifold && (
          <g fill="white" stroke="#1e3a8a">
            <rect x={irr.manifold.x - px(8)} y={irr.manifold.y - px(8)} width={px(16)} height={px(16)} strokeWidth={px(1.5)} />
            <text stroke="none" fill="#1e3a8a" fontWeight={700} x={irr.manifold.x} y={irr.manifold.y + px(3.5)} fontSize={px(9)} textAnchor="middle">
              V
            </text>
          </g>
        )}
      </g>
    );
  }

  const hint =
    mode === 'head'
      ? zone
        ? `Click to add a ${HEAD_LABEL[zone.kind].toLowerCase()} head to ${zone.name} · Esc to stop`
        : 'Add a zone first'
      : mode === 'manifold'
        ? 'Click where the valve manifold goes'
        : mode === 'backflow'
          ? 'Click the backflow device / point of connection'
          : 'Click a head to edit · drag heads, manifold (V) or backflow (BF) · red = dry, amber = one head only';

  const panel = (
    <IrrigationPanel
      project={project}
      irr={irr}
      put={put}
      mode={mode}
      setMode={setMode}
      zone={zone}
      setZoneId={setZoneId}
      selHead={irr.heads.find((h) => h.id === selHead) ?? null}
      setSelHead={setSelHead}
      showGaps={showGaps}
      setShowGaps={setShowGaps}
      runs={runs}
      coverage={coverage}
    />
  );

  return { onDown, onMove, onUp: () => (drag.current = null), onKey, svg, panel, hint };
}

interface PanelProps {
  project: Project;
  irr: Irrigation;
  put(next: Partial<Irrigation>): void;
  mode: Mode;
  setMode(m: Mode): void;
  zone: IrrigationZone | null;
  setZoneId(id: string | null): void;
  selHead: IrrigationHead | null;
  setSelHead(id: string | null): void;
  showGaps: boolean;
  setShowGaps(v: boolean): void;
  runs: ReturnType<typeof pipeRuns>;
  coverage: ReturnType<typeof zoneCoverage> | null;
}

function NumberInput({ value, onChange, step = 1, min = 0, max }: { value: number; onChange(v: number): void; step?: number; min?: number; max?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input
      type="number"
      value={text}
      step={step}
      min={min}
      max={max}
      onChange={(e) => {
        setText(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value !== '' && Number.isFinite(v) && v >= min && (max == null || v <= max)) onChange(v);
      }}
    />
  );
}

function IrrigationPanel({ project, irr, put, mode, setMode, zone, setZoneId, selHead, setSelHead, showGaps, setShowGaps, runs, coverage }: PanelProps) {
  const site = project.site ?? EMPTY_SITE;
  const [newKind, setNewKind] = useState<HeadKind>('spray');
  const lines = irrigationLines(project);
  const updateZone = (patch: Partial<IrrigationZone>) => zone && put({ zones: irr.zones.map((z) => (z.id === zone.id ? { ...z, ...patch } : z)) });
  const updateHead = (patch: Partial<IrrigationHead>) => selHead && put({ heads: irr.heads.map((h) => (h.id === selHead.id ? { ...h, ...patch } : h)) });

  function addZone() {
    const id = uid('z');
    const material = newKind === 'drip' ? 'mulch' : 'sod';
    const areaIds = site.areas.filter((a) => a.material === material).map((a) => a.id);
    put({ zones: [...irr.zones, { id, name: `Zone ${irr.zones.length + 1}`, kind: newKind, areaIds, pattern: 'square' }] });
    setZoneId(id);
  }

  const modeBtn = (m: Mode, label: string) => (
    <button className={mode === m ? 'active' : ''} onClick={() => setMode(mode === m ? 'select' : m)}>
      {label}
    </button>
  );

  if (selHead) {
    const n = nozzleFor(irr, selHead.kind);
    return (
      <aside className="inspector">
        <h3>{HEAD_LABEL[selHead.kind]} head</h3>
        <Field label="Zone">
          <select value={selHead.zoneId} onChange={(e) => updateHead({ zoneId: e.target.value })}>
            {irr.zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Type">
          <select value={selHead.kind} onChange={(e) => {
            const kind = e.target.value as HeadKind;
            updateHead({ kind, radius: nozzleFor(irr, kind).radius, gpm: undefined });
          }}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {HEAD_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={selHead.kind === 'drip' ? 'Wetted radius' : 'Throw radius'}>
          <LengthInput value={selHead.radius} min={1} onChange={(v) => updateHead({ radius: v })} />
        </Field>
        {selHead.kind !== 'drip' && (
          <div className="row">
            <Field label="Arc °">
              <NumberInput value={selHead.arc} min={1} max={360} onChange={(v) => updateHead({ arc: v })} />
            </Field>
            <Field label="Start °" hint="0 = east, 90 = down the plan; sweeps clockwise">
              <NumberInput value={selHead.rotation} min={0} max={359} onChange={(v) => updateHead({ rotation: v })} />
            </Field>
          </div>
        )}
        <Field label="Flow override, GPM" hint={`Blank = nozzle default (${selHead.kind === 'drip' ? `${Math.round(n.gpm * 60 * 100) / 100} GPH` : `${n.gpm} GPM full circle × arc`})`}>
          <input
            type="number"
            step={0.01}
            min={0}
            value={selHead.gpm ?? ''}
            placeholder={String(Math.round(headGpm({ ...selHead, gpm: undefined }, irr) * 100) / 100)}
            onChange={(e) => updateHead({ gpm: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })}
          />
        </Field>
        <div className="stat-grid">
          <Stat label="Flow" value={`${Math.round(headGpm(selHead, irr) * 100) / 100} GPM`} />
        </div>
        <button onClick={() => setSelHead(null)}>Back to zones</button>
        <button
          className="danger"
          onClick={() => {
            put({ heads: irr.heads.filter((h) => h.id !== selHead.id) });
            setSelHead(null);
          }}
        >
          Delete head
        </button>
      </aside>
    );
  }

  const short = zone ? headToHead(irr, zone.id) : [];
  const zoneRuns = zone ? runs.filter((r) => r.id === zone.id) : [];
  const gpm = zone ? zoneGpm(irr, zone.id) : 0;
  const over = !!(irr.supplyGpm && gpm > irr.supplyGpm);
  const main = runs.find((r) => r.id === 'main');

  return (
    <aside className="inspector">
      <h3>Irrigation</h3>
      <div className="row wrap">
        {modeBtn('head', '+ Head')}
        {modeBtn('manifold', irr.manifold ? 'Move valves' : 'Place valves')}
        {modeBtn('backflow', irr.backflow ? 'Move backflow' : 'Place backflow')}
      </div>
      <label className="link-row">
        <input type="checkbox" checked={showGaps} onChange={(e) => setShowGaps(e.target.checked)} /> Show coverage gaps
      </label>

      <h4>Zones</h4>
      {irr.zones.length > 0 && (
        <table className="mini">
          <tbody>
            {irr.zones.map((z) => (
              <tr key={z.id} className={z.id === zone?.id ? 'active' : ''} onClick={() => setZoneId(z.id)} style={{ cursor: 'pointer', fontWeight: z.id === zone?.id ? 600 : undefined }}>
                <td>{z.name}</td>
                <td>{HEAD_LABEL[z.kind]}</td>
                <td className="num">{zoneHeads(irr, z.id).length} hd</td>
                <td className="num">{zoneGpm(irr, z.id)} GPM</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row">
        <select value={newKind} onChange={(e) => setNewKind(e.target.value as HeadKind)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {HEAD_LABEL[k]}
            </option>
          ))}
        </select>
        <button onClick={addZone}>Add zone</button>
      </div>

      {zone && (
        <>
          <h4>{zone.name}</h4>
          <Field label="Name">
            <input value={zone.name} onChange={(e) => updateZone({ name: e.target.value })} />
          </Field>
          <div className="row">
            <Field label="Heads">
              <select value={zone.kind} onChange={(e) => updateZone({ kind: e.target.value as HeadKind })}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {HEAD_LABEL[k]}
                  </option>
                ))}
              </select>
            </Field>
            {zone.kind !== 'drip' && (
              <Field label="Pattern">
                <select value={zone.pattern} onChange={(e) => updateZone({ pattern: e.target.value as LayoutPattern })}>
                  <option value="square">Square</option>
                  <option value="triangular">Triangular</option>
                </select>
              </Field>
            )}
          </div>
          <Field label="Waters these areas">
            <div>
              {site.areas.length === 0 && <small className="muted">Draw lawn (sod) or bed (mulch) areas with the Area tool first.</small>}
              {site.areas.map((a) => (
                <label key={a.id} className="link-row">
                  <input
                    type="checkbox"
                    checked={zone.areaIds.includes(a.id)}
                    onChange={(e) => updateZone({ areaIds: e.target.checked ? [...zone.areaIds, a.id] : zone.areaIds.filter((x) => x !== a.id) })}
                  />{' '}
                  {a.label ?? MATERIAL_LABEL[a.material]} · {formatSqFt(polygonArea(a.points))}
                </label>
              ))}
            </div>
          </Field>
          <div className="row">
            <button disabled={!zone.areaIds.length} onClick={() => put(autoLayoutZone(project, zone.id))} title="Replaces this zone's heads">
              Auto-layout heads
            </button>
            <button disabled={!zoneHeads(irr, zone.id).length} onClick={() => put({ heads: irr.heads.filter((h) => h.zoneId !== zone.id) })}>
              Clear heads
            </button>
          </div>
          <div className="stat-grid">
            <Stat label="Heads" value={zoneHeads(irr, zone.id).length} />
            <Stat label="Zone flow" value={<span style={{ color: over ? 'var(--warn)' : undefined }}>{gpm} GPM</span>} />
            {zone.kind !== 'drip' && <Stat label="Short of neighbour" value={short.length} />}
            {coverage && coverage.cells.length > 0 && <Stat label="Dry area" value={`${Math.round(coverage.gap * 1000) / 10}%`} />}
            {zoneRuns.map((r) => (
              <Stat key={r.label} label={`${r.kind === 'drip' ? 'Drip line' : r.label.endsWith('supply') ? 'Supply' : 'Lateral'} ${r.size}`} value={formatFtIn(r.length, { compact: true })} />
            ))}
          </div>
          {over && <small className="muted">Zone flow is over the water supply — split it into two zones.</small>}
          <button
            className="danger"
            onClick={() => {
              put({ zones: irr.zones.filter((z) => z.id !== zone.id), heads: irr.heads.filter((h) => h.zoneId !== zone.id) });
              setZoneId(null);
            }}
          >
            Delete zone
          </button>
        </>
      )}

      <h4>Supply</h4>
      <Field label="Water supply capacity, GPM" hint="Measure with a bucket test at the hose bib, or ask your water utility.">
        <input
          type="number"
          step={0.5}
          min={0}
          value={irr.supplyGpm ?? ''}
          placeholder="not set"
          onChange={(e) => put({ supplyGpm: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })}
        />
      </Field>
      <div className="stat-grid">
        <Stat label="Mainline" value={main ? `${formatFtIn(main.length, { compact: true })} · ${main.size}` : '—'} />
        <Stat label="Valves" value={irr.manifold ? 'placed' : '—'} />
      </div>

      <h4>Nozzle defaults</h4>
      <small className="muted">Typical manufacturer catalogue figures, not a spec — edit to match your nozzle chart. Spray / rotor GPM is for a full circle; part arcs scale with the arc.</small>
      {KINDS.map((k) => {
        const n = nozzleFor(irr, k);
        const set = (patch: Partial<typeof n>) => put({ nozzles: { ...irr.nozzles, [k]: { ...n, ...patch } } });
        return (
          <div className="row" key={k}>
            <Field label={`${HEAD_LABEL[k]} ${k === 'drip' ? 'radius' : 'throw'}`}>
              <LengthInput value={n.radius} min={1} onChange={(v) => set({ radius: v })} />
            </Field>
            {k === 'drip' ? (
              <>
                <Field label="GPH">
                  <NumberInput value={Math.round(n.gpm * 60 * 100) / 100} step={0.1} onChange={(v) => set({ gpm: v / 60 })} />
                </Field>
                <Field label="Spacing">
                  <LengthInput value={n.spacing ?? TYPICAL_NOZZLES.drip.spacing!} min={3} onChange={(v) => set({ spacing: v })} />
                </Field>
              </>
            ) : (
              <Field label="GPM 360°">
                <NumberInput value={n.gpm} step={0.1} onChange={(v) => set({ gpm: v })} />
              </Field>
            )}
          </div>
        );
      })}
      {irr.nozzles && (
        <button onClick={() => put({ nozzles: undefined })}>Reset to typical figures</button>
      )}

      {lines.length > 0 && (
        <>
          <h4>Parts</h4>
          <table className="mini">
            <tbody>
              {lines.map((l) => (
                <tr key={l.item} title={l.basis}>
                  <td>{l.item}</td>
                  <td className="num">
                    {l.qty} {l.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <small className="muted">Pipe sized to keep PVC under ~5 ft/s (common rule of thumb). Totals roll into the Estimate tab.</small>
        </>
      )}
    </aside>
  );
}
