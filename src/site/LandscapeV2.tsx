import { useRef, useState, type Dispatch } from 'react';
import { bedFillPoints, distFromHouse, easementPolygon, fillBed, gradeRuns, wallTakeoff } from '../calc/landscape.ts';
import { azimuthOf, formatBearing, legsFromLot, runTraverse } from '../calc/survey.ts';
import { PLANT_BY_ID, REGION_LABEL, type NativeRegion } from '../data/plants.ts';
import { Field, Stat } from '../editor/Inspector.tsx';
import { LengthInput } from '../editor/LengthInput.tsx';
import { PdfImport } from '../editor/PdfImport.tsx';
import { dist, pointInPolygon, polygonCentroid } from '../model/geometry.ts';
import { openPdf } from '../model/imaging.ts';
import { readUnderlay } from '../model/persist.ts';
import type { Action } from '../model/store.ts';
import { EMPTY_SITE, uid, type Point, type Project, type Site, type SiteArea, type TraverseLeg, type Underlay } from '../model/types.ts';
import { formatFtIn, parseFtIn } from '../model/units.ts';
import { footprint } from '../calc/site.ts';

// Landscape v2 pieces of the Site tab: survey-call lots, the plat underlay,
// easements, retaining walls, spot grades and planting-bed fill. SiteView wires
// these in; all state lives in optional Site fields (old saves are untouched).

export type V2Sel = { kind: 'easement'; id: string } | { kind: 'wall'; id: string } | { kind: 'grade'; id: string };
type ListKey = 'easements' | 'retainingWalls' | 'grades';
const LIST: Record<V2Sel['kind'], ListKey> = { easement: 'easements', wall: 'retainingWalls', grade: 'grades' };

const ftDec = (inches: number) => `${(inches / 12).toFixed(2)}'`;
const site = (p: Project): Site => p.site ?? EMPTY_SITE;

/** Patch for changing one element of a v2 list. */
export function patchItem<K extends ListKey>(s: Site, key: K, id: string, patch: Partial<NonNullable<Site[K]>[number]>): Partial<Site> {
  return { [key]: (s[key] ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)) } as Partial<Site>;
}

export function deleteV2(s: Site, sel: V2Sel): Partial<Site> {
  const key = LIST[sel.kind];
  return { [key]: (s[key] ?? []).filter((x) => x.id !== sel.id) } as Partial<Site>;
}

export function existsV2(s: Site, sel: V2Sel): boolean {
  return (s[LIST[sel.kind]] ?? []).some((x) => x.id === sel.id);
}

/** Outline points that can be dragged for a selection (drawn easements, walls). */
export function v2Points(s: Site, sel: V2Sel): Point[] | null {
  if (sel.kind === 'easement') return s.easements?.find((e) => e.id === sel.id)?.points ?? null;
  if (sel.kind === 'wall') return s.retainingWalls?.find((w) => w.id === sel.id)?.points ?? null;
  return null;
}

export function moveV2Vertex(s: Site, sel: V2Sel, index: number, p: Point): Partial<Site> {
  const pts = v2Points(s, sel);
  if (!pts) return {};
  const points = pts.map((v, i) => (i === index ? p : v));
  return sel.kind === 'easement' ? patchItem(s, 'easements', sel.id, { points }) : patchItem(s, 'retainingWalls', sel.id, { points });
}

function distToPolyline(p: Point, pts: Point[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2));
    best = Math.min(best, dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }));
  }
  return best;
}

/** Grades and walls first (they're small), then easements. `tol` is in plan inches. */
export function hitV2(s: Site, p: Point, tol: number): V2Sel | null {
  const g = (s.grades ?? []).find((x) => dist(x.at, p) <= tol);
  if (g) return { kind: 'grade', id: g.id };
  const w = (s.retainingWalls ?? []).find((x) => distToPolyline(p, x.points) <= Math.max(tol, 8));
  if (w) return { kind: 'wall', id: w.id };
  const e = [...(s.easements ?? [])].reverse().find((x) => pointInPolygon(p, easementPolygon(x, s.lot)));
  if (e) return { kind: 'easement', id: e.id };
  return null;
}

export function SiteUnderlayImage({ u }: { u?: Underlay }) {
  if (!u?.visible) return null;
  return <image href={u.src} x={u.x} y={u.y} width={u.pxWidth * u.scale} height={u.pxHeight * u.scale} opacity={u.opacity} preserveAspectRatio="none" style={{ pointerEvents: 'none' }} />;
}

/** Easements, walls, spot grades and grade runs, drawn in plan space. */
export function LandscapeLayers({ project, px, sel, print = false }: { project: Project; px(n: number): number; sel: V2Sel | null; print?: boolean }) {
  const s = site(project);
  const runs = gradeRuns(project);
  const on = (kind: V2Sel['kind'], id: string) => sel?.kind === kind && sel.id === id;
  return (
    <g className="landscape-v2">
      {(s.easements ?? []).map((e) => {
        const poly = easementPolygon(e, s.lot);
        if (poly.length < 3) return null;
        const c = polygonCentroid(poly);
        return (
          <g key={e.id} className={`easement ${on('easement', e.id) ? 'selected' : ''}`}>
            <polygon points={poly.map((p) => `${p.x},${p.y}`).join(' ')} strokeWidth={px(on('easement', e.id) ? 2.5 : 1.2)} strokeDasharray={`${px(6)} ${px(3)}`} />
            <text x={c.x} y={c.y} fontSize={px(10)} textAnchor="middle" className="easement-label">
              {e.label?.trim() || 'Easement'}
            </text>
          </g>
        );
      })}
      {(s.retainingWalls ?? []).map((w) => (
        <g key={w.id} className={`retaining ${on('wall', w.id) ? 'selected' : ''}`}>
          <polyline points={w.points.map((p) => `${p.x},${p.y}`).join(' ')} strokeWidth={Math.max(12, px(4))} fill="none" />
          {w.points.length >= 2 && (
            <text x={(w.points[0].x + w.points[1].x) / 2} y={(w.points[0].y + w.points[1].y) / 2 - px(9)} fontSize={px(10)} textAnchor="middle" className="area-label">
              Wall {formatFtIn(w.height, { compact: true })}
            </text>
          )}
        </g>
      ))}
      {runs.map((r) => (
        <line key={`${r.near.id}-${r.far.id}`} className={`grade-run ${r.ok ? 'ok' : 'bad'}`} x1={r.near.at.x} y1={r.near.at.y} x2={r.far.at.x} y2={r.far.at.y} strokeWidth={px(2)} markerEnd={print ? undefined : 'url(#grade-arrow)'} />
      ))}
      {(s.grades ?? []).map((g) => (
        <g key={g.id} className={`spot-grade ${on('grade', g.id) ? 'selected' : ''}`}>
          <path d={`M${g.at.x - px(5)} ${g.at.y}h${px(10)}M${g.at.x} ${g.at.y - px(5)}v${px(10)}`} strokeWidth={px(1.5)} />
          <text x={g.at.x + px(6)} y={g.at.y - px(4)} fontSize={px(10)} className="area-label">
            {ftDec(g.elev)}
          </text>
        </g>
      ))}
      <defs>
        <marker id="grade-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" className="grade-arrow" />
        </marker>
      </defs>
    </g>
  );
}

// ---------- inspectors ----------

export function V2Inspector({ project, dispatch, sel, onDelete }: { project: Project; dispatch: Dispatch<Action>; sel: V2Sel; onDelete(): void }) {
  const s = site(project);
  const set = (patch: Partial<Site>) => dispatch({ type: 'setSite', patch });
  if (sel.kind === 'easement') {
    const e = s.easements?.find((x) => x.id === sel.id);
    if (!e) return null;
    return (
      <aside className="inspector">
        <h3>Easement</h3>
        <Field label="Label">
          <input value={e.label ?? ''} placeholder="e.g. 10' utility easement" onChange={(ev) => set(patchItem(s, 'easements', e.id, { label: ev.target.value }))} />
        </Field>
        {e.edge !== undefined && (
          <Field label={`Width along edge ${e.edge + 1}`}>
            <LengthInput value={e.width ?? 0} min={1} onChange={(v) => set(patchItem(s, 'easements', e.id, { width: v }))} />
          </Field>
        )}
        <small className="muted">Copy easements from the recorded plat. Houses, hardscape, retaining walls and trees inside one are flagged on the Code check tab.</small>
        <button className="danger" onClick={onDelete}>
          Delete easement
        </button>
      </aside>
    );
  }
  if (sel.kind === 'wall') {
    const w = s.retainingWalls?.find((x) => x.id === sel.id);
    if (!w) return null;
    const t = wallTakeoff(w);
    return (
      <aside className="inspector">
        <h3>Retaining wall</h3>
        <Field label="Exposed height" hint="Above finished grade on the low side; one more course is buried.">
          <LengthInput value={w.height} min={4} onChange={(v) => set(patchItem(s, 'retainingWalls', w.id, { height: v }))} />
        </Field>
        <div className="stat-grid">
          <Stat label="Length" value={formatFtIn(t.length, { compact: true })} />
          <Stat label="Courses" value={t.courses} />
          <Stat label="Blocks" value={t.blocks} />
          <Stat label="Caps" value={t.caps} />
        </div>
        <small className="muted">Block counts assume an 8" × 18" face. Totals (with base, drainage stone and drain pipe) roll into the Estimate tab.</small>
        <button className="danger" onClick={onDelete}>
          Delete wall
        </button>
      </aside>
    );
  }
  const g = s.grades?.find((x) => x.id === sel.id);
  if (!g) return null;
  const d = distFromHouse(g.at, project);
  const runs = gradeRuns(project).filter((r) => r.near.id === g.id || r.far.id === g.id);
  return (
    <aside className="inspector">
      <h3>Spot grade</h3>
      <Field label="Elevation (decimal feet)" hint="Any datum (e.g. 100.00' at the slab), as long as every spot uses it.">
        <ElevInput value={g.elev} onChange={(v) => set(patchItem(s, 'grades', g.id, { elev: v }))} />
      </Field>
      <div className="stat-grid">
        <Stat label="From house" value={d.d === Infinity ? '—' : d.d === 0 ? 'inside' : formatFtIn(d.d, { compact: true })} />
        {runs.map((r) => (
          <Stat key={r.far.id + r.near.id} label="Fall in first 10 ft" value={`${r.fall.toFixed(1)}" ${r.ok ? '✓' : '✗'}`} />
        ))}
      </div>
      <small className="muted">IRC R401.3 wants the ground to fall at least 6" within the first 10 ft from the foundation. Put one spot by the wall and one about 10 ft straight out; the check assumes an even slope between them.</small>
      <button className="danger" onClick={onDelete}>
        Delete spot
      </button>
    </aside>
  );
}

function ElevInput({ value, onChange }: { value: number; onChange(v: number): void }) {
  const [text, setText] = useState((value / 12).toFixed(2));
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setText((value / 12).toFixed(2));
  }
  const commit = () => {
    const v = Number(text.replace(/'/g, ''));
    if (Number.isFinite(v)) onChange(v * 12);
    else setText((value / 12).toFixed(2));
  };
  return <input inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />;
}

/** Extra controls on a selected hardscape / bed area: topsoil, edging and bed fill. */
export function AreaExtras({ project, dispatch, area, species }: { project: Project; dispatch: Dispatch<Action>; area: SiteArea; species: string }) {
  const s = site(project);
  const sp = PLANT_BY_ID.get(species);
  const filled = s.plants.filter((p) => p.bed === area.id);
  const preview = sp ? bedFillPoints(area.points, sp.spread * 12).length : 0;
  const plantable = area.material === 'mulch' || area.material === 'sod' || area.material === 'gravel';
  function fill() {
    if (!sp) return;
    const keep = s.plants.filter((p) => p.bed !== area.id);
    dispatch({ type: 'setSite', patch: { plants: [...keep, ...fillBed(area, species, () => uid('p'))] } });
  }
  return (
    <>
      {area.material !== 'pavers' && area.material !== 'concrete' && area.material !== 'decking' && (
        <Field label="Topsoil under it" hint="Spread before planting / sod; 0 for none.">
          <LengthInput value={area.topsoil ?? 0} onChange={(v) => dispatch({ type: 'updateArea', id: area.id, patch: { topsoil: v || undefined } })} />
        </Field>
      )}
      {area.material !== 'pavers' && (
        <label className="link-row">
          <input type="checkbox" checked={!!area.edging} onChange={(e) => dispatch({ type: 'updateArea', id: area.id, patch: { edging: e.target.checked || undefined } })} /> Edging around it
        </label>
      )}
      {plantable && (
        <>
          <h4>Fill bed with plants</h4>
          <small className="muted">
            Uses the species picked for the Plant tool ({sp?.name ?? '—'}): {preview} on a triangular grid at {sp ? `${sp.spread}'` : '—'} centres.
          </small>
          <div className="row">
            <button onClick={fill} disabled={!preview}>
              {filled.length ? 'Re-fill bed' : 'Fill bed'}
            </button>
            {filled.length > 0 && (
              <button onClick={() => dispatch({ type: 'delete', ids: filled.map((p) => p.id) })}>
                Clear {filled.length}
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}

// ---------- lot: bearings, survey calls, edge easements ----------

export function LotExtras({ project, dispatch, onTraverse }: { project: Project; dispatch: Dispatch<Action>; onTraverse(): void }) {
  const s = site(project);
  const lot = s.lot!;
  const [edge, setEdge] = useState(0);
  const [width, setWidth] = useState(120);
  function addEdgeEasement() {
    dispatch({ type: 'setSite', patch: { easements: [...(s.easements ?? []), { id: uid('e'), edge, width, label: `${formatFtIn(width, { compact: true })} utility easement` }] } });
  }
  return (
    <>
      <h4>Bearings</h4>
      <table className="mini">
        <tbody>
          {lot.map((a, i) => {
            const b = lot[(i + 1) % lot.length];
            return (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{formatBearing(azimuthOf(a, b))}</td>
                <td className="num">{ftDec(dist(a, b))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button onClick={onTraverse}>Edit as survey calls…</button>
      <h4>Easement along an edge</h4>
      <div className="row">
        <Field label="Edge">
          <select value={edge} onChange={(e) => setEdge(Number(e.target.value))}>
            {lot.map((_, i) => (
              <option key={i} value={i}>
                {i + 1}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Width">
          <LengthInput value={width} min={1} onChange={setWidth} />
        </Field>
      </div>
      <button onClick={addEdgeEasement}>Add easement strip</button>
      <small className="muted">Or draw any easement shape with the Easement tool.</small>
    </>
  );
}

const BLANK: TraverseLeg = { bearing: '', distance: 0 };

/** Enter a lot as survey calls (bearing + distance); shows the misclosure live. */
export function TraversePanel({ project, dispatch, onDone }: { project: Project; dispatch: Dispatch<Action>; onDone(): void }) {
  const s = site(project);
  const [legs, setLegs] = useState<TraverseLeg[]>(() => (s.lot ? (traverseMatches(s.traverse, s.lot) ? s.traverse! : legsFromLot(s.lot)) : [BLANK, BLANK, BLANK, BLANK]));
  const [dText, setDText] = useState<string[]>(() => legs.map((l) => (l.distance ? (l.distance / 12).toFixed(2) : '')));
  const t = runTraverse(legs);
  const complete = legs.length >= 3 && t.badLeg < 0;
  const set = (i: number, patch: Partial<TraverseLeg>) => setLegs(legs.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  function apply() {
    if (!complete) return;
    // Keep an existing lot's first corner; otherwise centre the lot on the house.
    let start = s.lot?.[0];
    if (!start) {
      const c0 = polygonCentroid(t.points);
      const fp = footprint(project).flat();
      const xs = fp.map((p) => p.x);
      const ys = fp.map((p) => p.y);
      const hc = fp.length ? { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 } : c0;
      start = { x: Math.round(hc.x - c0.x), y: Math.round(hc.y - c0.y) };
    }
    const lot = runTraverse(legs, start).points;
    const setbacks = lot.map((_, i) => s.setbacks[i] ?? 0);
    dispatch({ type: 'setSite', patch: { lot, setbacks, traverse: legs } });
    onDone();
  }

  return (
    <aside className="inspector">
      <h3>Lot from survey calls</h3>
      <small className="muted">One call per lot line, clockwise or anticlockwise from the point of beginning, as written on the plat: bearing like N 45°30'00" E (or N45-30-00E), distance in decimal feet.</small>
      <table className="mini traverse">
        <tbody>
          {legs.map((l, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>
                <input className={l.bearing && t.badLeg === i ? 'invalid' : undefined} value={l.bearing} placeholder="N 0°00'00&quot; E" onChange={(e) => set(i, { bearing: e.target.value })} />
              </td>
              <td>
                <input
                  inputMode="decimal"
                  value={dText[i] ?? ''}
                  placeholder="ft"
                  onChange={(e) => {
                    setDText(dText.map((d, j) => (j === i ? e.target.value : d)));
                    const v = parseFloat(e.target.value);
                    set(i, { distance: Number.isFinite(v) && v > 0 ? v * 12 : 0 });
                  }}
                />
              </td>
              <td>
                <button
                  className="link"
                  title="Remove call"
                  onClick={() => {
                    setLegs(legs.filter((_, j) => j !== i));
                    setDText(dText.filter((_, j) => j !== i));
                  }}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        onClick={() => {
          setLegs([...legs, BLANK]);
          setDText([...dText, '']);
        }}
      >
        Add call
      </button>
      <div className="stat-grid">
        <Stat label="Perimeter" value={ftDec(t.perimeter)} />
        <Stat label="Misclosure" value={complete ? ftDec(t.error) : '—'} />
        <Stat label="Precision" value={complete ? (t.precision === Infinity ? 'closes' : `1 : ${Math.round(t.precision).toLocaleString()}`) : '—'} />
        <Stat label="Area" value={complete && t.points.length >= 3 ? `${Math.round(Math.abs(shoelace(t.points)) / 144).toLocaleString()} sq ft` : '—'} />
      </div>
      {complete && t.error > 6 && <small className="warn-text">The calls miss closing by {formatFtIn(t.error)} — check for a typo; the last line will be drawn straight back to the start.</small>}
      <div className="row">
        <button className="primary" onClick={apply} disabled={!complete}>
          {s.lot ? 'Replace lot' : 'Create lot'}
        </button>
        <button onClick={onDone}>Cancel</button>
      </div>
    </aside>
  );
}

/** The stored calls still describe the lot (corners not dragged since)? */
function traverseMatches(legs: TraverseLeg[] | undefined, lot: Point[]): boolean {
  if (!legs || legs.length !== lot.length) return false;
  const pts = runTraverse(legs, lot[0]).points;
  return pts.length === lot.length && pts.every((p, i) => dist(p, lot[i]) < 1);
}

function shoelace(pts: Point[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) a += pts[i].x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * pts[i].y;
  return a / 2;
}

// ---------- site-wide: region, plat underlay ----------

export function SiteExtras({
  project,
  dispatch,
  centre,
  onCalibrate,
  onMoveImage,
  onTraverse,
}: {
  project: Project;
  dispatch: Dispatch<Action>;
  centre(): Point;
  onCalibrate(): void;
  onMoveImage(): void;
  onTraverse(): void;
}) {
  const s = site(project);
  const u = s.underlay;
  const [pdf, setPdf] = useState<{ doc: Awaited<ReturnType<typeof openPdf>>; at: Point } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const setU = (patch: Partial<Underlay>) => u && dispatch({ type: 'setSite', patch: { underlay: { ...u, ...patch } } });

  async function load(file?: File) {
    if (!file) return;
    setErr(null);
    try {
      const at = centre();
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) setPdf({ doc: await openPdf(file), at });
      else {
        dispatch({ type: 'setSite', patch: { underlay: await readUnderlay(file, at) } });
        onCalibrate();
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <>
      <Field label="Native-plant region" hint="Natives for the region get a ★ in the plant list.">
        <select value={s.region ?? ''} onChange={(e) => dispatch({ type: 'setSite', patch: { region: (e.target.value || undefined) as NativeRegion | undefined } })}>
          <option value="">Not set</option>
          {(Object.keys(REGION_LABEL) as NativeRegion[]).map((r) => (
            <option key={r} value={r}>
              {REGION_LABEL[r]}
            </option>
          ))}
        </select>
      </Field>
      {!s.lot && <button onClick={onTraverse}>Lot from survey calls…</button>}
      <h4>Plat / aerial underlay</h4>
      {err && <small className="warn-text">{err}</small>}
      <button onClick={() => file.current?.click()} title="A plat, survey or aerial photo to trace the lot over">
        {u ? 'Replace image…' : 'Import image or PDF…'}
      </button>
      <input ref={file} type="file" accept="image/*,application/pdf,.pdf" hidden onChange={(e) => (load(e.target.files?.[0]), (e.target.value = ''))} />
      {u && (
        <>
          <Field label="Opacity">
            <input type="range" min={0.1} max={1} step={0.05} value={u.opacity} onChange={(e) => setU({ opacity: Number(e.target.value) })} />
          </Field>
          <label className="link-row">
            <input type="checkbox" checked={u.visible} onChange={(e) => setU({ visible: e.target.checked })} /> Show image
          </label>
          <div className="row">
            <button onClick={onCalibrate}>Calibrate</button>
            <button onClick={onMoveImage}>Move</button>
            <button className="danger" onClick={() => dispatch({ type: 'setSite', patch: { underlay: undefined } })}>
              Remove
            </button>
          </div>
        </>
      )}
      {pdf && (
        <PdfImport
          doc={pdf.doc}
          at={pdf.at}
          onClose={() => setPdf(null)}
          onImport={(underlay, calibrated) => {
            dispatch({ type: 'setSite', patch: { underlay } });
            setPdf(null);
            if (!calibrated) onCalibrate();
          }}
        />
      )}
    </>
  );
}

/** Two clicks on the image + the real distance between them → true scale. */
export function CalibratePanel({ project, dispatch, points, onDone }: { project: Project; dispatch: Dispatch<Action>; points: Point[]; onDone(): void }) {
  const u = site(project).underlay;
  const [text, setText] = useState('');
  function apply() {
    const real = parseFtIn(text);
    if (!u || points.length !== 2 || !real) return;
    const measured = dist(points[0], points[1]);
    if (measured < 0.01) return;
    const k = real / measured;
    const a = points[0];
    dispatch({ type: 'setSite', patch: { underlay: { ...u, scale: u.scale * k, x: a.x + (u.x - a.x) * k, y: a.y + (u.y - a.y) * k } } });
    onDone();
  }
  return (
    <aside className="inspector">
      <h3>Calibrate underlay</h3>
      <small className="muted">Click both ends of a line whose length you know (a lot line on the plat, a scale bar).</small>
      <div className="stat-grid">
        <Stat label="Points" value={`${points.length} / 2`} />
        {points.length === 2 && <Stat label="Measures now" value={formatFtIn(dist(points[0], points[1]), { compact: true })} />}
      </div>
      {points.length === 2 && (
        <Field label="Real length">
          <input autoFocus value={text} placeholder={`e.g. 120'`} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply()} />
        </Field>
      )}
      <div className="row">
        <button className="primary" onClick={apply} disabled={points.length !== 2 || !parseFtIn(text)}>
          Apply
        </button>
        <button onClick={onDone}>Cancel</button>
      </div>
    </aside>
  );
}

