import type { Dispatch } from 'react';
import { DEFAULT_ASSEMBLIES, LAYER_PRODUCTS, LEGACY_ASSEMBLIES, assemblyFor, assemblyText, inchText, layerLabel, layersThickness, projectAssemblies, sameLayers } from '../model/assembly.ts';
import type { Action } from '../model/store.ts';
import { studFor, type LumberSize, type Project, type Wall, type WallLayer } from '../model/types.ts';
import { LengthInput } from './LengthInput.tsx';

// Edits one wall assembly: an ordered list of layers, first face to last
// (inside → outside on an exterior wall). Pick a product per layer, adjust its
// thickness, reorder, remove, or add a layer. The stud layer's depth always
// comes from the wall's stud size.

const productKey = (l: WallLayer) =>
  LAYER_PRODUCTS.find((p) => p.layer.kind === l.kind && (l.kind === 'stud' || (Math.abs(p.layer.thickness - l.thickness) < 1e-6 && (p.layer.name ?? '') === (l.name ?? ''))))?.key ?? '';

export function AssemblyEditor({ layers, stud, onChange, firstFace, lastFace }: { layers: WallLayer[]; stud: LumberSize; onChange(layers: WallLayer[]): void; firstFace: string; lastFace: string }) {
  const set = (i: number, l: WallLayer) => onChange(layers.map((x, j) => (j === i ? l : x)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...layers];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  return (
    <div className="assembly">
      <small className="muted">{firstFace}</small>
      {layers.map((l, i) => (
        <div className="row" key={i}>
          <select
            value={productKey(l)}
            title={layerLabel(l, stud)}
            onChange={(e) => {
              const p = LAYER_PRODUCTS.find((x) => x.key === e.target.value);
              if (p) set(i, { ...p.layer });
            }}
          >
            {!productKey(l) && <option value="">{layerLabel(l, stud)}</option>}
            {LAYER_PRODUCTS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.key === 'stud' ? `${stud} studs` : p.label}
              </option>
            ))}
          </select>
          {l.kind !== 'stud' && <LengthInput value={l.thickness} min={0} onChange={(v) => set(i, { ...l, thickness: v })} />}
          <button title="Move toward the first face" disabled={i === 0} onClick={() => move(i, -1)}>
            ↑
          </button>
          <button title="Move toward the last face" disabled={i === layers.length - 1} onClick={() => move(i, 1)}>
            ↓
          </button>
          <button title="Remove this layer" disabled={l.kind === 'stud' && layers.filter((x) => x.kind === 'stud').length === 1} onClick={() => onChange(layers.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <small className="muted">{lastFace}</small>
      <div className="row">
        <select
          value=""
          onChange={(e) => {
            const p = LAYER_PRODUCTS.find((x) => x.key === e.target.value);
            if (p) onChange([...layers, { ...p.layer }]);
          }}
        >
          <option value="">+ Add a layer (last face)…</option>
          {LAYER_PRODUCTS.filter((p) => p.key !== 'stud').map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <small className="muted">Total {inchText(layersThickness(layers, stud))} · common product thicknesses, not code values</small>
    </div>
  );
}

/** The wall panel's "Layers" section: this wall's stack, or the project default for its kind. */
export function WallLayersPanel({ project, wall, dispatch }: { project: Project; wall: Wall; dispatch: Dispatch<Action> }) {
  const stud = studFor(wall, project.framing);
  const own = !!wall.assembly;
  const ext = wall.kind === 'exterior';
  return (
    <div className="field">
      <span>Layers</span>
      <AssemblyEditor
        layers={assemblyFor(project, wall)}
        stud={stud}
        firstFace={ext ? 'Inside face (room side)' : 'One face'}
        lastFace={ext ? 'Outside face' : 'Other face'}
        onChange={(assembly) => dispatch({ type: 'updateWall', id: wall.id, patch: { assembly } })}
      />
      <small className="muted">
        {own ? 'This wall has its own layers. ' : `The project default for ${wall.kind} walls — editing makes them this wall's own. `}
        Faces, dimensions, clear sizes and the estimate follow the layers; the wall is drawn centred on its line.
      </small>
      {own && (
        <button className="link" onClick={() => dispatch({ type: 'updateWall', id: wall.id, patch: { assembly: undefined } })}>
          Back to the project default ({assemblyText(projectAssemblies(project)[wall.kind], stud)})
        </button>
      )}
    </div>
  );
}

/** Project defaults: one stack per wall kind; walls with their own layers keep them. */
export function ProjectLayersPanel({ project, dispatch }: { project: Project; dispatch: Dispatch<Action> }) {
  const a = projectAssemblies(project);
  const legacy = sameLayers(a.exterior, LEGACY_ASSEMBLIES.exterior) && sameLayers(a.interior, LEGACY_ASSEMBLIES.interior);
  const set = (kind: 'exterior' | 'interior', layers: WallLayer[]) => dispatch({ type: 'setAssemblies', assemblies: { ...a, [kind]: layers } });
  return (
    <>
      <h4>Wall layers</h4>
      <div className="field">
        <span>Exterior walls</span>
        <AssemblyEditor layers={a.exterior} stud={project.framing.exteriorStud} firstFace="Inside face (room side)" lastFace="Outside face" onChange={(l) => set('exterior', l)} />
      </div>
      <div className="field">
        <span>Interior walls</span>
        <AssemblyEditor layers={a.interior} stud={project.framing.interiorStud} firstFace="One face" lastFace="Other face" onChange={(l) => set('interior', l)} />
      </div>
      {legacy && (
        <p className="muted small">
          Saved before wall layers: these match the old "stud + 1 inch" rule (a 1/16" allowance keeps exterior walls where they were).{' '}
          <button className="link" onClick={() => dispatch({ type: 'setAssemblies', assemblies: DEFAULT_ASSEMBLIES })}>
            Use the current presets
          </button>{' '}
          (adds 5/16" fiber-cement lap siding outside, so exterior walls get thicker and dimensions move).
        </p>
      )}
    </>
  );
}
