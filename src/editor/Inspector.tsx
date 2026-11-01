import type { Dispatch, ReactNode } from 'react';
import { ceilingInfo } from '../calc/ceilings.ts';
import { frameWall, studCount } from '../calc/framing.ts';
import { netClearOpening } from '../calc/irc.ts';
import { wallAreas } from '../calc/materials.ts';
import { polygonArea, wallLength } from '../model/geometry.ts';
import type { Action } from '../model/store.ts';
import {
  LUMBER_SIZES,
  studFor,
  type Ceiling,
  type CeilingType,
  type LumberSize,
  type OutletKind,
  type Project,
  type RoomType,
  type WindowStyle,
} from '../model/types.ts';
import { formatFtIn, formatSqFt } from '../model/units.ts';
import type { Hit } from './hitTest.ts';
import { LengthInput } from './LengthInput.tsx';
import type { Tool } from './PlanCanvas.tsx';

interface Props {
  project: Project;
  dispatch: Dispatch<Action>;
  selection: Hit | null;
  setSelection(h: Hit | null): void;
  setTool(t: Tool): void;
}

const ROOM_TYPES: RoomType[] = ['bedroom', 'living', 'kitchen', 'bath', 'hall', 'garage', 'utility', 'other'];
const CEILINGS: { value: CeilingType; label: string }[] = [
  { value: 'flat', label: 'Flat' },
  { value: 'vaulted', label: 'Vaulted (single slope)' },
  { value: 'cathedral', label: 'Cathedral (ridge)' },
  { value: 'tray', label: 'Tray' },
  { value: 'coffered', label: 'Coffered' },
];

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

export function Inspector({ project, dispatch, selection, setSelection, setTool }: Props) {
  const del = (id: string) => {
    dispatch({ type: 'delete', ids: [id] });
    setSelection(null);
  };

  if (selection?.kind === 'wall') {
    const w = project.walls.find((x) => x.id === selection.id);
    if (!w) return null;
    const f = frameWall(w, project);
    const def = w.kind === 'exterior' ? project.framing.exteriorStud : project.framing.interiorStud;
    return (
      <aside className="inspector">
        <h3>Wall W{project.walls.indexOf(w) + 1}</h3>
        <Field label="Type">
          <select value={w.kind} onChange={(e) => dispatch({ type: 'updateWall', id: w.id, patch: { kind: e.target.value as typeof w.kind } })}>
            <option value="exterior">Exterior (bearing)</option>
            <option value="interior">Interior (partition)</option>
          </select>
        </Field>
        <Field label="Studs" hint={`Finished thickness ${formatFtIn(w.thickness)}`}>
          <select
            value={w.stud ?? ''}
            onChange={(e) => dispatch({ type: 'updateWall', id: w.id, patch: { stud: (e.target.value || undefined) as LumberSize | undefined } })}
          >
            <option value="">Default for {w.kind} ({def})</option>
            {LUMBER_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Length">
          <LengthInput value={wallLength(w)} min={1} onChange={(v) => dispatch({ type: 'setWallLength', id: w.id, length: v })} />
        </Field>
        <Field label="Wall height" hint="Plate to plate. 97-1/8&quot; = standard 8' wall">
          <LengthInput value={w.height} min={24} onChange={(v) => dispatch({ type: 'updateWall', id: w.id, patch: { height: v } })} />
        </Field>
        <div className="stat-grid">
          <Stat label="Studs" value={studCount(f)} />
          <Stat label="Stud cut" value={formatFtIn(f.studLength)} />
          <Stat label="Headers" value={f.headers.map((h) => h.size).join(', ') || '—'} />
        </div>
        {f.notes.map((n) => (
          <p key={n} className="warn-text">
            {n}
          </p>
        ))}
        <button className="danger" onClick={() => del(w.id)}>
          Delete wall
        </button>
      </aside>
    );
  }

  if (selection?.kind === 'opening') {
    const o = project.openings.find((x) => x.id === selection.id);
    if (!o) return null;
    const up = (patch: Partial<typeof o>) => dispatch({ type: 'updateOpening', id: o.id, patch });
    const nc = o.kind === 'window' ? netClearOpening(o) : null;
    return (
      <aside className="inspector">
        <h3>{o.kind === 'door' ? 'Door' : 'Window'}</h3>
        <Field label="Width">
          <LengthInput value={o.width} min={12} onChange={(v) => up({ width: v })} />
        </Field>
        <Field label="Height">
          <LengthInput value={o.height} min={12} onChange={(v) => up({ height: v })} />
        </Field>
        {o.kind === 'window' && (
          <>
            <Field label="Sill height">
              <LengthInput value={o.sill} onChange={(v) => up({ sill: v })} />
            </Field>
            <Field label="Operation" hint={nc ? `Est. net clear ${(nc.area).toFixed(1)} sq ft (${formatFtIn(nc.width)} × ${formatFtIn(nc.height)})` : undefined}>
              <select value={o.style ?? 'single-hung'} onChange={(e) => up({ style: e.target.value as WindowStyle })}>
                <option value="single-hung">Single / double hung</option>
                <option value="slider">Slider</option>
                <option value="casement">Casement</option>
                <option value="fixed">Fixed</option>
              </select>
            </Field>
          </>
        )}
        <Field label="Centre from wall start">
          <LengthInput value={o.offset} onChange={(v) => up({ offset: v })} />
        </Field>
        {o.kind === 'door' && (
          <div className="row">
            <button onClick={() => up({ swing: { side: (o.swing?.side ?? 1) === 1 ? -1 : 1, hinge: o.swing?.hinge ?? 'a' } })}>Flip swing side</button>
            <button onClick={() => up({ swing: { side: o.swing?.side ?? 1, hinge: (o.swing?.hinge ?? 'a') === 'a' ? 'b' : 'a' } })}>Flip hinge</button>
          </div>
        )}
        <button className="danger" onClick={() => del(o.id)}>
          Delete {o.kind}
        </button>
      </aside>
    );
  }

  if (selection?.kind === 'outlet') {
    const o = project.outlets.find((x) => x.id === selection.id);
    if (!o) return null;
    const up = (patch: Partial<typeof o>) => dispatch({ type: 'updateOutlet', id: o.id, patch: { ...patch, auto: false } });
    return (
      <aside className="inspector">
        <h3>Receptacle {o.auto && <span className="badge">auto</span>}</h3>
        <Field label="Type">
          <select value={o.kind} onChange={(e) => up({ kind: e.target.value as OutletKind })}>
            <option value="duplex">Duplex 15A</option>
            <option value="gfci">GFCI 20A</option>
            <option value="dedicated">Dedicated 20A</option>
            <option value="240v">240V</option>
          </select>
        </Field>
        <Field label="Height to centre">
          <LengthInput value={o.height} onChange={(v) => up({ height: v })} />
        </Field>
        <button onClick={() => up({ side: o.side === 1 ? -1 : 1 })}>Move to other face of wall</button>
        <p className="muted small">Drag it along the wall to move it. Editing an auto-placed receptacle keeps it when you re-run auto-layout.</p>
        <button className="danger" onClick={() => del(o.id)}>
          Delete receptacle
        </button>
      </aside>
    );
  }

  if (selection?.kind === 'room') {
    const r = project.rooms.find((x) => x.id === selection.id);
    if (!r) return null;
    const c: Ceiling = r.ceiling ?? { type: 'flat' };
    const info = ceilingInfo(project, r);
    const setCeiling = (patch: Partial<Ceiling>) => dispatch({ type: 'updateRoom', id: r.id, patch: { ceiling: { ...c, ...patch } } });
    return (
      <aside className="inspector">
        <h3>Room</h3>
        <Field label="Name">
          <input value={r.name} onChange={(e) => dispatch({ type: 'updateRoom', id: r.id, patch: { name: e.target.value } })} />
        </Field>
        <Field label="Use" hint="Drives code checks and outlet layout">
          <select value={r.type} onChange={(e) => dispatch({ type: 'updateRoom', id: r.id, patch: { type: e.target.value as RoomType } })}>
            {ROOM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t[0].toUpperCase() + t.slice(1)}
              </option>
            ))}
          </select>
        </Field>
        <div className="stat-grid">
          <Stat label="Floor" value={formatSqFt(polygonArea(r.points))} />
          <Stat label="Ceiling surface" value={formatSqFt(info.surface)} />
        </div>
        <h4>Ceiling</h4>
        <Field label="Style">
          <select value={c.type} onChange={(e) => setCeiling({ type: e.target.value as CeilingType })}>
            {CEILINGS.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={c.type === 'vaulted' || c.type === 'cathedral' ? 'Low side height' : 'Ceiling height'} hint="Blank = wall height">
          <LengthInput value={c.height ?? info.low + (c.type === 'coffered' ? c.cofferDepth ?? 8 : 0)} min={48} onChange={(v) => setCeiling({ height: v })} />
        </Field>
        {(c.type === 'vaulted' || c.type === 'cathedral') && (
          <Field label={c.type === 'vaulted' ? 'High side height' : 'Ridge height'}>
            <LengthInput value={info.high} min={info.low} onChange={(v) => setCeiling({ peak: v })} />
          </Field>
        )}
        {c.type === 'tray' && (
          <>
            <Field label="Tray depth">
              <LengthInput value={c.trayDepth ?? 12} min={2} onChange={(v) => setCeiling({ trayDepth: v })} />
            </Field>
            <Field label="Inset from walls">
              <LengthInput value={c.trayInset ?? 24} min={6} onChange={(v) => setCeiling({ trayInset: v })} />
            </Field>
          </>
        )}
        {c.type === 'coffered' && (
          <>
            <Field label="Beam grid spacing">
              <LengthInput value={c.cofferSpacing ?? 48} min={24} onChange={(v) => setCeiling({ cofferSpacing: v })} />
            </Field>
            <Field label="Beam depth">
              <LengthInput value={c.cofferDepth ?? 8} min={2} onChange={(v) => setCeiling({ cofferDepth: v })} />
            </Field>
          </>
        )}
        <p className="muted small">{info.label}</p>
        <button className="danger" onClick={() => del(r.id)}>
          Delete room label (keeps walls)
        </button>
      </aside>
    );
  }

  // Nothing selected: project summary + defaults.
  const areas = wallAreas(project);
  const fr = project.framing;
  const u = project.underlay;
  const extLF = project.walls.filter((w) => w.kind === 'exterior').reduce((s, w) => s + wallLength(w), 0);
  return (
    <aside className="inspector">
      <h3>Project</h3>
      <div className="stat-grid">
        <Stat label="Floor area" value={`${Math.round(areas.floor).toLocaleString()} sq ft`} />
        <Stat label="Exterior walls" value={`${Math.round(extLF / 12)} LF`} />
        <Stat label="Rooms" value={project.rooms.length} />
        <Stat label="Receptacles" value={project.outlets.length} />
      </div>

      <h4>Wall defaults</h4>
      <Field label="Exterior studs">
        <select value={fr.exteriorStud} onChange={(e) => dispatch({ type: 'setFraming', patch: { exteriorStud: e.target.value as LumberSize } })}>
          {LUMBER_SIZES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </Field>
      <Field label="Interior studs">
        <select value={fr.interiorStud} onChange={(e) => dispatch({ type: 'setFraming', patch: { interiorStud: e.target.value as LumberSize } })}>
          {LUMBER_SIZES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </Field>
      <Field label="Stud spacing">
        <select value={fr.studSpacing} onChange={(e) => dispatch({ type: 'setFraming', patch: { studSpacing: Number(e.target.value) as 16 | 24 } })}>
          <option value={16}>16" o.c.</option>
          <option value={24}>24" o.c.</option>
        </select>
      </Field>
      <Field label="New wall height">
        <LengthInput value={fr.wallHeight} min={24} onChange={(v) => dispatch({ type: 'setFraming', patch: { wallHeight: v } })} />
      </Field>
      {project.walls.some((w) => w.height !== fr.wallHeight) && (
        <button
          onClick={() => {
            dispatch({ type: 'checkpoint' });
            for (const w of project.walls) dispatch({ type: 'updateWall', id: w.id, patch: { height: fr.wallHeight } });
          }}
        >
          Apply {formatFtIn(fr.wallHeight)} to every wall
        </button>
      )}
      <Field label="Waste allowance">
        <select value={fr.waste} onChange={(e) => dispatch({ type: 'setFraming', patch: { waste: Number(e.target.value) } })}>
          {[0, 0.05, 0.1, 0.15, 0.2].map((w) => (
            <option key={w} value={w}>
              {Math.round(w * 100)}%
            </option>
          ))}
        </select>
      </Field>
      <p className="muted small">Mixed walls? Select a wall to give it its own stud size or height.</p>
      {project.walls.some((w) => w.stud && w.stud !== (w.kind === 'exterior' ? fr.exteriorStud : fr.interiorStud)) && (
        <p className="muted small">
          {project.walls.filter((w) => w.stud).length} wall(s) override the default ({[...new Set(project.walls.map((w) => studFor(w, fr)))].join(', ')} in use).
        </p>
      )}

      {u && (
        <>
          <h4>Floorplan image</h4>
          <Field label={`Opacity ${Math.round(u.opacity * 100)}%`}>
            <input type="range" min={0.1} max={1} step={0.05} value={u.opacity} onChange={(e) => dispatch({ type: 'updateUnderlay', patch: { opacity: Number(e.target.value) }, transient: true })} />
          </Field>
          <div className="row">
            <button onClick={() => setTool('calibrate')}>Calibrate scale</button>
            <button onClick={() => setTool('moveImage')}>Move</button>
          </div>
          <div className="row">
            <button onClick={() => dispatch({ type: 'updateUnderlay', patch: { visible: !u.visible } })}>{u.visible ? 'Hide' : 'Show'}</button>
            <button className="danger" onClick={() => dispatch({ type: 'setUnderlay', underlay: undefined })}>
              Remove
            </button>
          </div>
        </>
      )}
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
