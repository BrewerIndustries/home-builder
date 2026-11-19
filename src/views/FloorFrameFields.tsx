import type { Dispatch } from 'react';
import { DEFAULT_IJOIST_DEPTH, depthLabel, EDGE_NAME, type FloorLayout, type FloorSpec } from '../calc/floor.ts';
import { foundationOf } from '../calc/foundation.ts';
import { Field } from '../editor/Inspector.tsx';
import { LengthInput } from '../editor/LengthInput.tsx';
import { activeStoreyId } from '../model/storeys.ts';
import type { Action } from '../model/store.ts';
import { JOIST_SIZES, type FloorEdge, type FloorFrame, type FloorInsulation, type Foundation, type JoistSize, type Project } from '../model/types.ts';

// Floor v2 inputs on the Framing tab, beside the floor framing plan. The joist
// type, size and spacing are the house's (kept on the foundation); direction,
// cantilevers and insulation belong to this floor — the lowest one's on the
// foundation, a storey's above it on that storey.

/** Common I-joist depths, as sold (pick what your supplier's series comes in). */
const IJOIST_DEPTHS = [9.5, 11.875, 14, 16];
const INSULATION: FloorInsulation[] = ['none', 'R-13', 'R-19', 'R-21', 'R-30', 'R-38'];
const EDGES: FloorEdge[] = ['n', 'e', 's', 'w'];

export function FloorFrameFields({ project, spec, layout, dispatch }: { project: Project; spec: FloorSpec; layout: FloorLayout; dispatch: Dispatch<Action> }) {
  const f = foundationOf(project);
  const house = f.floor ?? {};
  const setF = (patch: Partial<Foundation>) => dispatch({ type: 'setFoundation', patch });
  const setHouse = (patch: FloorFrame) => setF({ floor: { ...house, ...patch } });
  const id = activeStoreyId(project);
  const own: FloorFrame = spec.upper ? (project.storeys?.find((s) => s.id === id)?.floor ?? {}) : house;
  const setOwn = (patch: FloorFrame) => (spec.upper ? dispatch({ type: 'storey', op: { op: 'update', id, patch: { floor: { ...own, ...patch } } } }) : setHouse(patch));
  const crossing: FloorEdge[] = layout.alongX ? ['w', 'e'] : ['n', 's'];

  return (
    <div className="floor-fields">
      <div className="row">
        <Field label="Joists (every framed floor)">
          <select value={house.joistType ?? 'sawn'} onChange={(e) => setHouse({ joistType: e.target.value as FloorFrame['joistType'] })}>
            <option value="sawn">Sawn lumber</option>
            <option value="ijoist">I-joists</option>
          </select>
        </Field>
        {spec.ijoist ? (
          <>
            <Field label="I-joist series">
              <input defaultValue={house.iJoistSeries ?? ''} key={house.iJoistSeries ?? 'unset'} placeholder="as the maker lists it" onBlur={(e) => setHouse({ iJoistSeries: e.target.value.trim() || undefined })} />
            </Field>
            <Field label="Depth">
              <select value={house.iJoistDepth ?? DEFAULT_IJOIST_DEPTH} onChange={(e) => setHouse({ iJoistDepth: Number(e.target.value) })}>
                {IJOIST_DEPTHS.map((d) => (
                  <option key={d} value={d}>
                    {depthLabel(d)}
                  </option>
                ))}
              </select>
            </Field>
          </>
        ) : (
          <Field label="Size">
            <select value={f.joistSize} onChange={(e) => setF({ joistSize: e.target.value as JoistSize })}>
              {JOIST_SIZES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Spacing">
          <select value={f.joistSpacing} onChange={(e) => setF({ joistSpacing: Number(e.target.value) as Foundation['joistSpacing'] })}>
            {[12, 16, 19.2, 24].map((s) => (
              <option key={s} value={s}>
                {s}" o.c.
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="row">
        {spec.upper && (
          <Field label="Joists run (this floor)">
            <select value={own.joistDir ?? 'auto'} onChange={(e) => setOwn({ joistDir: e.target.value as FloorFrame['joistDir'] })}>
              <option value="auto">Across the short side</option>
              <option value="x">Left–right</option>
              <option value="y">Top–bottom</option>
            </select>
          </Field>
        )}
        {!spec.upper && layout.girders.length > 0 && (
          <Field label="Joists at the girders">
            <select value={house.flushGirders ? 'flush' : 'lap'} onChange={(e) => setHouse({ flushGirders: e.target.value === 'flush' || undefined })}>
              <option value="lap">Lapped on top</option>
              <option value="flush">Flush, in hangers</option>
            </select>
          </Field>
        )}
        <Field label="Insulation" hint={spec.upper ? 'between conditioned floors: only if you want it (sound)' : 'over a crawlspace / unconditioned space: R-value per your energy code'}>
          <select value={own.insulation ?? 'none'} onChange={(e) => setOwn({ insulation: e.target.value as FloorInsulation })}>
            {INSULATION.map((r) => (
              <option key={r} value={r}>
                {r === 'none' ? 'None' : `${r} batts`}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="row">
        {EDGES.filter((e) => crossing.includes(e) || (own.cantilever?.[e] ?? 0) > 0).map((e) => (
          <Field key={e} label={`Cantilever, ${EDGE_NAME[e]}`}>
            <LengthInput value={own.cantilever?.[e] ?? 0} min={0} onChange={(v) => setOwn({ cantilever: { ...own.cantilever, [e]: v || undefined } })} />
          </Field>
        ))}
      </div>
      <small className="muted">Cantilevers run the joists out past the support on the edges they cross. Members are laid out and counted, not sized — spans from the IRC R502.3 tables{spec.ijoist ? ' / the I-joist maker' : ''}.</small>
    </div>
  );
}
