import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import { DEFAULT_DEPTH, footprint, IMPERVIOUS, MATERIAL_LABEL, siteLines, siteSummary, SQFT } from '../calc/site.ts';
import { FORM_LABEL, PLANT_BY_ID, PLANTS, type PlantForm } from '../data/plants.ts';
import { Field, Stat } from '../editor/Inspector.tsx';
import { LengthInput } from '../editor/LengthInput.tsx';
import { PlanDrawing } from '../editor/PlanDrawing.tsx';
import { dist, orthoFrom, pointInPolygon, polygonArea, polygonCentroid, snapToGrid } from '../model/geometry.ts';
import type { Action } from '../model/store.ts';
import { EMPTY_SITE, uid, type Point, type Project, type SurfaceMaterial } from '../model/types.ts';
import { formatFtIn, formatSqFt } from '../model/units.ts';

// Site plan: lot outline + setbacks, hardscape / bed areas and plants, drawn around
// the house in the floor plan's own coordinates.

type SiteTool = 'select' | 'lot' | 'area' | 'plant';
type SiteSel = { kind: 'lot' } | { kind: 'area'; id: string } | { kind: 'plant'; id: string };
interface View {
  scale: number;
  ox: number;
  oy: number;
}
type Drag =
  | { kind: 'pan'; sx: number; sy: number; view: View }
  | { kind: 'plant'; id: string; grab: Point }
  | { kind: 'vertex'; target: 'lot' | string; index: number };

const TOOLS: { id: SiteTool; label: string; key: string; icon: string }[] = [
  { id: 'select', label: 'Select', key: 'v', icon: '↖' },
  { id: 'lot', label: 'Lot', key: 'l', icon: '⬠' },
  { id: 'area', label: 'Area', key: 'a', icon: '▨' },
  { id: 'plant', label: 'Plant', key: 'p', icon: '✿' },
];
const MATERIALS = Object.keys(MATERIAL_LABEL) as SurfaceMaterial[];
const FORMS = Object.keys(FORM_LABEL) as PlantForm[];
const GRID = 12;
const SNAP_PX = 10;
const ft = (n: number) => n * 12;

export function SiteView({ project, dispatch }: { project: Project; dispatch: Dispatch<Action> }) {
  const site = project.site ?? EMPTY_SITE;
  const [tool, setTool] = useState<SiteTool>(site.lot ? 'select' : 'lot');
  const [material, setMaterial] = useState<SurfaceMaterial>('pavers');
  const [species, setSpecies] = useState('crape-myrtle');
  const [sel, setSel] = useState<SiteSel | null>(null);
  const [draft, setDraft] = useState<Point[]>([]);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [shift, setShift] = useState(false);
  const [view, setView] = useState<View>({ scale: 0.4, ox: 60, oy: 60 });
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const toWorld = (sx: number, sy: number): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (sx - r.left - v.ox) / v.scale, y: (sy - r.top - v.oy) / v.scale };
  };

  const fit = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const { width, height } = svg.getBoundingClientRect();
    if (width < 200 || height < 200) return;
    const pts = [...(site.lot ?? []), ...project.walls.flatMap((w) => [w.a, w.b]), ...site.areas.flatMap((a) => a.points), ...site.plants.map((p) => p.at)];
    if (!pts.length) return;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs) - ft(10);
    const minY = Math.min(...ys) - ft(10);
    const w = Math.max(...xs) + ft(10) - minX;
    const h = Math.max(...ys) + ft(10) - minY;
    const scale = Math.max(0.03, Math.min((width - 60) / w, (height - 60) / h, 4));
    setView({ scale, ox: (width - w * scale) / 2 - minX * scale, oy: (height - h * scale) / 2 - minY * scale });
  }, [site, project.walls]);

  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current) {
      fitted.current = true;
      fit();
    }
  }, [fit]);

  useEffect(() => {
    const svg = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const cx = e.clientX - r.left;
        const cy = e.clientY - r.top;
        setView((v) => {
          const scale = Math.min(10, Math.max(0.02, v.scale * Math.exp(-e.deltaY * 0.01)));
          const k = scale / v.scale;
          return { scale, ox: cx - (cx - v.ox) * k, oy: cy - (cy - v.oy) * k };
        });
      } else setView((v) => ({ ...v, ox: v.ox - e.deltaX, oy: v.oy - e.deltaY }));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => setDraft([]), [tool]);

  // Snap to lot / area / house corners, else a 1 ft grid (orthogonal to the last point unless Shift).
  const corners = useMemo(() => [...(site.lot ?? []), ...site.areas.flatMap((a) => a.points), ...footprint(project).flat()], [site, project]);
  const snap = (raw: Point, origin?: Point): Point => {
    const tol = SNAP_PX / viewRef.current.scale;
    const near = corners.filter((c) => dist(c, raw) <= tol).sort((a, b) => dist(a, raw) - dist(b, raw))[0];
    if (near) return { ...near };
    let p = snapToGrid(raw, GRID);
    if (origin && !shift) p = orthoFrom(origin, p);
    return p;
  };

  function closeDraft(pts = draft) {
    if (pts.length < 3) return;
    if (tool === 'lot') {
      dispatch({ type: 'setSite', patch: { lot: pts, setbacks: pts.map(() => 0) } });
      setSel({ kind: 'lot' });
    } else if (tool === 'area') {
      const id = uid('a');
      dispatch({ type: 'addArea', area: { id, material, points: pts, depth: DEFAULT_DEPTH[material] } });
      setSel({ kind: 'area', id });
    }
    setDraft([]);
    if (tool === 'lot') setTool('select');
  }

  useEffect(() => {
    const isField = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShift(true);
      if (isField(e) || e.metaKey || e.ctrlKey) return;
      if (e.key === 'Escape') {
        if (draft.length) setDraft([]);
        else setSel(null);
      } else if (e.key === 'Enter') closeDraft();
      else if ((e.key === 'Delete' || e.key === 'Backspace') && draft.length) setDraft(draft.slice(0, -1));
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
        dispatch({ type: 'delete', ids: [sel.kind === 'lot' ? 'lot' : sel.id] });
        setSel(null);
      } else if (e.key === 'f') fit();
      else {
        const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
        if (t) setTool(t.id);
        else return;
      }
      e.preventDefault();
    };
    const up = (e: KeyboardEvent) => e.key === 'Shift' && setShift(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  });

  // Drop a stale selection after undo / delete.
  useEffect(() => {
    if (!sel) return;
    const ok = sel.kind === 'lot' ? !!site.lot : sel.kind === 'area' ? site.areas.some((a) => a.id === sel.id) : site.plants.some((p) => p.id === sel.id);
    if (!ok) setSel(null);
  }, [site, sel]);

  function hit(p: Point): SiteSel | null {
    const plants = site.plants
      .map((x) => ({ x, r: ((PLANT_BY_ID.get(x.species)?.spread ?? 3) * 12) / 2 }))
      .filter(({ x, r }) => dist(x.at, p) <= Math.max(r, 8 / viewRef.current.scale))
      .sort((a, b) => a.r - b.r);
    if (plants.length) return { kind: 'plant', id: plants[0].x.id };
    const area = [...site.areas].reverse().find((a) => pointInPolygon(p, a.points));
    if (area) return { kind: 'area', id: area.id };
    if (site.lot && pointInPolygon(p, site.lot)) return { kind: 'lot' };
    return null;
  }

  function selectedPoints(): { target: 'lot' | string; pts: Point[] } | null {
    if (sel?.kind === 'lot' && site.lot) return { target: 'lot', pts: site.lot };
    if (sel?.kind === 'area') {
      const a = site.areas.find((x) => x.id === sel.id);
      if (a) return { target: a.id, pts: a.points };
    }
    return null;
  }

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const raw = toWorld(e.clientX, e.clientY);
    if (e.button === 1 || e.button === 2) {
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, view };
      return;
    }
    if (tool === 'lot' || tool === 'area') {
      const p = snap(raw, draft.at(-1));
      if (draft.length >= 3 && dist(p, draft[0]) <= SNAP_PX / view.scale) closeDraft();
      else setDraft([...draft, p]);
      return;
    }
    if (tool === 'plant') {
      const id = uid('p');
      dispatch({ type: 'addPlant', plant: { id, species, at: snapToGrid(raw, 6) } });
      setSel({ kind: 'plant', id });
      return;
    }
    // Select: vertex of the selected outline first, then plants / areas / lot, else pan.
    const sp = selectedPoints();
    const vi = sp ? sp.pts.findIndex((v) => dist(v, raw) <= SNAP_PX / view.scale) : -1;
    if (sp && vi >= 0) {
      dispatch({ type: 'checkpoint' });
      drag.current = { kind: 'vertex', target: sp.target, index: vi };
      return;
    }
    const h = hit(raw);
    setSel(h);
    if (h?.kind === 'plant') {
      const pl = site.plants.find((x) => x.id === h.id)!;
      dispatch({ type: 'checkpoint' });
      drag.current = { kind: 'plant', id: h.id, grab: { x: raw.x - pl.at.x, y: raw.y - pl.at.y } };
    } else if (!h) drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, view };
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const raw = toWorld(e.clientX, e.clientY);
    const d = drag.current;
    if (!d) {
      setCursor(tool === 'lot' || tool === 'area' ? snap(raw, draft.at(-1)) : raw);
      return;
    }
    if (d.kind === 'pan') setView({ ...d.view, ox: d.view.ox + e.clientX - d.sx, oy: d.view.oy + e.clientY - d.sy });
    else if (d.kind === 'plant') dispatch({ type: 'updatePlant', id: d.id, patch: { at: snapToGrid({ x: raw.x - d.grab.x, y: raw.y - d.grab.y }, 6) }, transient: true });
    else {
      const p = snap(raw);
      if (d.target === 'lot' && site.lot) dispatch({ type: 'setSite', patch: { lot: site.lot.map((v, i) => (i === d.index ? p : v)) }, transient: true });
      else {
        const a = site.areas.find((x) => x.id === d.target);
        if (a) dispatch({ type: 'updateArea', id: a.id, patch: { points: a.points.map((v, i) => (i === d.index ? p : v)) }, transient: true });
      }
    }
  }

  const s = view.scale;
  const px = (n: number) => n / s;
  const summary = siteSummary(project);
  const poly = (pts: Point[]) => pts.map((p) => `${p.x},${p.y}`).join(' ');
  const sp = selectedPoints();

  return (
    <main className="workspace">
      <div className="toolbar">
        {TOOLS.map((t) => (
          <button key={t.id} className={tool === t.id ? 'active' : ''} onClick={() => setTool(t.id)} title={`${t.label} (${t.key.toUpperCase()})`}>
            <span className="icon">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
        <div className="spacer" />
        <button onClick={fit} title="Fit (F)">
          Fit
        </button>
      </div>
      <div className="canvas-wrap">
        <svg
          ref={svgRef}
          className="plan site"
          style={{ cursor: tool === 'select' ? 'default' : 'crosshair' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onPointerLeave={() => !drag.current && setCursor(null)}
          onDoubleClick={() => closeDraft(draft.slice(0, -1).length >= 3 ? draft.slice(0, -1) : draft)}
          onContextMenu={(e) => e.preventDefault()}
        >
          <g transform={`translate(${view.ox} ${view.oy}) scale(${s})`}>
            {site.lot && <polygon className={`lot ${sel?.kind === 'lot' ? 'selected' : ''}`} points={poly(site.lot)} strokeWidth={px(2)} />}
            {summary.buildable.length > 0 && <polygon className="envelope" points={poly(summary.buildable)} strokeWidth={px(1.5)} strokeDasharray={`${px(8)} ${px(5)}`} />}
            {site.lot &&
              site.setbacks.map((d, i) => {
                const a = site.lot![i];
                const b = site.lot![(i + 1) % site.lot!.length];
                if (!d || !b) return null;
                return (
                  <text key={i} x={(a.x + b.x) / 2} y={(a.y + b.y) / 2} fontSize={px(11)} textAnchor="middle" className="setback-label" dy={px(-5)}>
                    {i + 1}: {formatFtIn(d, { compact: true })}
                  </text>
                );
              })}
            {site.areas.map((a) => {
              const c = polygonCentroid(a.points);
              const on = sel?.kind === 'area' && sel.id === a.id;
              return (
                <g key={a.id}>
                  <polygon className={`area area-${a.material} ${on ? 'selected' : ''}`} points={poly(a.points)} strokeWidth={px(on ? 2.5 : 1)} />
                  {polygonArea(a.points) * s * s > 2500 && (
                    <text x={c.x} y={c.y} fontSize={px(11)} textAnchor="middle" className="area-label">
                      {MATERIAL_LABEL[a.material]} · {formatSqFt(polygonArea(a.points))}
                    </text>
                  )}
                </g>
              );
            })}
            <PlanDrawing project={project} px={px} wallDims={false} overallDims={false} outlets={false} />
            {site.plants.map((p) => {
              const spc = PLANT_BY_ID.get(p.species);
              const r = ((spc?.spread ?? 3) * 12) / 2;
              const on = sel?.kind === 'plant' && sel.id === p.id;
              return (
                <g key={p.id} className={`plant plant-${spc?.form ?? 'shrub'} ${on ? 'selected' : ''}`}>
                  <circle cx={p.at.x} cy={p.at.y} r={r} strokeWidth={px(on ? 2.5 : 1)} />
                  <circle cx={p.at.x} cy={p.at.y} r={px(2.5)} className="trunk" />
                  {r * s > 28 && (
                    <text x={p.at.x} y={p.at.y + px(14)} fontSize={px(10)} textAnchor="middle" className="plant-label">
                      {spc?.name}
                    </text>
                  )}
                </g>
              );
            })}
            {sp?.pts.map((v, i) => <rect key={i} className="handle" x={v.x - px(4)} y={v.y - px(4)} width={px(8)} height={px(8)} strokeWidth={px(1.5)} />)}
            {draft.length > 0 && (
              <g className="preview">
                <polyline points={poly(cursor ? [...draft, cursor] : draft)} fill="none" strokeWidth={px(2)} />
                {cursor && (
                  <text x={cursor.x + px(10)} y={cursor.y - px(10)} fontSize={px(12)} className="preview-label">
                    {formatFtIn(dist(draft.at(-1)!, cursor))}
                  </text>
                )}
              </g>
            )}
          </g>
        </svg>
        <div className="hint">
          {tool === 'lot' || tool === 'area'
            ? 'Click corners · click the first corner, double-click or Enter to close · Shift = any angle · Esc cancels'
            : tool === 'plant'
              ? `Click to plant ${PLANT_BY_ID.get(species)?.name} — circles show mature spread`
              : 'Click to select · drag plants or outline corners · drag empty space to pan · ⌘-scroll to zoom'}
        </div>
      </div>
      <SiteInspector
        project={project}
        dispatch={dispatch}
        sel={sel}
        setSel={setSel}
        tool={tool}
        material={material}
        setMaterial={setMaterial}
        species={species}
        setSpecies={setSpecies}
        onLotCreated={() => requestAnimationFrame(fit)}
      />
    </main>
  );
}

interface InspectorProps {
  project: Project;
  dispatch: Dispatch<Action>;
  sel: SiteSel | null;
  setSel(s: SiteSel | null): void;
  tool: SiteTool;
  material: SurfaceMaterial;
  setMaterial(m: SurfaceMaterial): void;
  species: string;
  setSpecies(id: string): void;
  onLotCreated(): void;
}

function SpeciesSelect({ value, onChange }: { value: string; onChange(id: string): void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {FORMS.map((f) => (
        <optgroup key={f} label={FORM_LABEL[f]}>
          {PLANTS.filter((p) => p.form === f).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function SpeciesFacts({ id }: { id: string }) {
  const p = PLANT_BY_ID.get(id);
  if (!p) return null;
  return (
    <div className="stat-grid">
      <Stat label="Mature size" value={`${p.height}' h × ${p.spread}' w`} />
      <Stat label="Zones" value={`${p.zones[0]}–${p.zones[1]}`} />
      <Stat label="Sun" value={p.sun.join(' / ')} />
      <Stat label="Water" value={p.water} />
    </div>
  );
}

function LotCreator({ project, dispatch, onCreated }: { project: Project; dispatch: Dispatch<Action>; onCreated(): void }) {
  const [w, setW] = useState(ft(80));
  const [d, setD] = useState(ft(120));
  function create() {
    // Centre the house side-to-side, 25 ft back from the top (front) edge.
    const fp = footprint(project).flat();
    const xs = fp.map((p) => p.x);
    const ys = fp.map((p) => p.y);
    const cx = fp.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : w / 2;
    const top = fp.length ? Math.min(...ys) - ft(30) : 0;
    const x0 = Math.round((cx - w / 2) / 12) * 12;
    const y0 = Math.round(top / 12) * 12;
    dispatch({
      type: 'setSite',
      patch: {
        lot: [
          { x: x0, y: y0 },
          { x: x0 + w, y: y0 },
          { x: x0 + w, y: y0 + d },
          { x: x0, y: y0 + d },
        ],
        setbacks: [ft(25), ft(5), ft(20), ft(5)],
      },
    });
    onCreated();
  }
  return (
    <>
      <h4>Quick rectangular lot</h4>
      <div className="row">
        <Field label="Width">
          <LengthInput value={w} min={ft(10)} onChange={setW} />
        </Field>
        <Field label="Depth">
          <LengthInput value={d} min={ft(10)} onChange={setD} />
        </Field>
      </div>
      <button onClick={create}>Create lot around the house</button>
      <small className="muted">Starts with 25' front, 20' rear and 5' side setbacks — replace them with your zoning's numbers. Or draw any shape with the Lot tool.</small>
    </>
  );
}

function SiteInspector({ project, dispatch, sel, setSel, tool, material, setMaterial, species, setSpecies, onLotCreated }: InspectorProps) {
  const site = project.site ?? EMPTY_SITE;
  const summary = siteSummary(project);
  const del = (id: string) => {
    dispatch({ type: 'delete', ids: [id] });
    setSel(null);
  };

  if (sel?.kind === 'plant') {
    const pl = site.plants.find((x) => x.id === sel.id);
    if (!pl) return null;
    const sp = PLANT_BY_ID.get(pl.species);
    return (
      <aside className="inspector">
        <h3>{sp?.name ?? 'Plant'}</h3>
        {sp && <div className="muted small">{sp.botanical}</div>}
        <Field label="Species">
          <SpeciesSelect value={pl.species} onChange={(id) => dispatch({ type: 'updatePlant', id: pl.id, patch: { species: id } })} />
        </Field>
        <SpeciesFacts id={pl.species} />
        <small className="muted">Typical landscape sizes; cultivar, climate and pruning change them.</small>
        <button className="danger" onClick={() => del(pl.id)}>
          Delete plant
        </button>
      </aside>
    );
  }

  if (sel?.kind === 'area') {
    const a = site.areas.find((x) => x.id === sel.id);
    if (!a) return null;
    const perim = a.points.reduce((s, p, i) => s + dist(p, a.points[(i + 1) % a.points.length]), 0);
    const lines = siteLines({ ...project, site: { ...site, areas: [a], plants: [] } }, project.framing.waste);
    return (
      <aside className="inspector">
        <h3>{MATERIAL_LABEL[a.material]}</h3>
        <Field label="Surface">
          <select value={a.material} onChange={(e) => {
            const m = e.target.value as SurfaceMaterial;
            dispatch({ type: 'updateArea', id: a.id, patch: { material: m, depth: DEFAULT_DEPTH[m] } });
          }}>
            {MATERIALS.map((m) => (
              <option key={m} value={m}>
                {MATERIAL_LABEL[m]}
              </option>
            ))}
          </select>
        </Field>
        {DEFAULT_DEPTH[a.material] > 0 && (
          <Field label="Depth">
            <LengthInput value={a.depth} min={0.5} onChange={(v) => dispatch({ type: 'updateArea', id: a.id, patch: { depth: v } })} />
          </Field>
        )}
        <div className="stat-grid">
          <Stat label="Area" value={formatSqFt(polygonArea(a.points))} />
          <Stat label="Perimeter" value={formatFtIn(perim, { compact: true })} />
          <Stat label="Pervious" value={IMPERVIOUS.has(a.material) || a.material === 'decking' ? 'no' : 'yes'} />
        </div>
        <h4>Takeoff</h4>
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
        <small className="muted">Drag the square handles to reshape. Totals roll into the Estimate tab.</small>
        <button className="danger" onClick={() => del(a.id)}>
          Delete area
        </button>
      </aside>
    );
  }

  if (sel?.kind === 'lot' && site.lot) {
    const lot = site.lot;
    return (
      <aside className="inspector">
        <h3>Lot</h3>
        <div className="stat-grid">
          <Stat label="Lot area" value={formatSqFt(summary.lotArea)} />
          <Stat label="Acres" value={(summary.lotArea / SQFT / 43560).toFixed(3)} />
        </div>
        <h4>Setbacks by edge</h4>
        {lot.map((a, i) => (
          <Field key={i} label={`Edge ${i + 1} · ${formatFtIn(dist(a, lot[(i + 1) % lot.length]), { compact: true })}`}>
            <LengthInput
              value={site.setbacks[i] ?? 0}
              onChange={(v) => dispatch({ type: 'setSite', patch: { setbacks: lot.map((_, j) => (j === i ? v : (site.setbacks[j] ?? 0))) } })}
            />
          </Field>
        ))}
        <small className="muted">Edge numbers are shown on the plan. The dashed line is the buildable envelope; setbacks come from your local zoning, not the IRC.</small>
        <button className="danger" onClick={() => del('lot')}>
          Delete lot
        </button>
      </aside>
    );
  }

  return (
    <aside className="inspector">
      {tool === 'area' && (
        <>
          <h3>New area</h3>
          <Field label="Surface">
            <select value={material} onChange={(e) => setMaterial(e.target.value as SurfaceMaterial)}>
              {MATERIALS.map((m) => (
                <option key={m} value={m}>
                  {MATERIAL_LABEL[m]}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
      {tool === 'plant' && (
        <>
          <h3>New plant</h3>
          <Field label="Species">
            <SpeciesSelect value={species} onChange={setSpecies} />
          </Field>
          <SpeciesFacts id={species} />
        </>
      )}
      <h3>Site</h3>
      <div className="stat-grid">
        <Stat label="Lot" value={site.lot ? formatSqFt(summary.lotArea) : '—'} />
        <Stat label="House footprint" value={formatSqFt(summary.footprintArea)} />
        <Stat label="Building coverage" value={site.lot ? `${(summary.coverage * 100).toFixed(1)}%` : '—'} />
        <Stat label="Impervious" value={site.lot ? `${(summary.impervious * 100).toFixed(1)}%` : '—'} />
        <Stat label="Plants" value={site.plants.length} />
        <Stat label="Areas" value={site.areas.length} />
      </div>
      <Field label="USDA hardiness zone" hint="Plants outside their zone range get flagged on the Code check tab.">
        <select value={site.zone ?? ''} onChange={(e) => dispatch({ type: 'setSite', patch: { zone: e.target.value ? Number(e.target.value) : undefined } })}>
          <option value="">Not set</option>
          {Array.from({ length: 11 }, (_, i) => i + 3).map((z) => (
            <option key={z} value={z}>
              Zone {z}
            </option>
          ))}
        </select>
      </Field>
      {!site.lot && <LotCreator project={project} dispatch={dispatch} onCreated={onLotCreated} />}
      {MATERIALS.some((m) => summary.hardscape[m] > 0) && (
        <>
          <h4>Surfaces</h4>
          <table className="mini">
            <tbody>
              {MATERIALS.filter((m) => summary.hardscape[m] > 0).map((m) => (
                <tr key={m}>
                  <td>{MATERIAL_LABEL[m]}</td>
                  <td className="num">{formatSqFt(summary.hardscape[m])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </aside>
  );
}
