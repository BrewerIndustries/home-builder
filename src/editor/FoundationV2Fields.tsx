import type { Dispatch } from 'react';
import { foundationOf } from '../calc/foundation.ts';
import { DEFAULT_BASEMENT_HEIGHT, DEFAULT_PIER_PAD, DEFAULT_PIER_PAD_THICKNESS, interiorFootingSize, v2Of } from '../calc/foundationV2.ts';
import type { Action } from '../model/store.ts';
import type { Foundation, FoundationType, FoundationV2, Project, Wall } from '../model/types.ts';
import { Field } from './Inspector.tsx';
import { LengthInput } from './LengthInput.tsx';

// Foundation v2 inputs: basement walls, pier pads, interior bearing footings and
// the Table R403.1 look-up inputs. Lives beside the Foundation fields in the
// project panel; the bearing-footing tick lives on the wall panel.

type Set = (patch: Partial<Foundation>) => void;

/** Patch for switching foundation type: deepen the footing to suit and switch on the pad rebar allowance. */
export function foundationTypePatch(f: Foundation, type: FoundationType): Partial<Foundation> {
  const v = v2Of(f);
  if (type === 'crawl') return { type, footingDepth: Math.max(f.footingDepth, 24), v2: { ...v, pierBars: v.pierBars ?? 2 } };
  if (type === 'basement') {
    // Wall top about a foot above grade.
    const H = v.basementHeight ?? DEFAULT_BASEMENT_HEIGHT;
    return { type, footingDepth: Math.max(f.footingDepth, H + f.footingThickness - 12), v2: { ...v, pierBars: v.pierBars ?? 2, basementHeight: H } };
  }
  return { type };
}

function NumberInput({ value, placeholder, onChange }: { value?: number; placeholder?: string; onChange(v: number | undefined): void }) {
  return (
    <input
      type="number"
      min={0}
      defaultValue={value ?? ''}
      key={value ?? 'unset'}
      placeholder={placeholder}
      onBlur={(e) => {
        const n = Number(e.target.value);
        onChange(e.target.value.trim() === '' || !Number.isFinite(n) ? undefined : n);
      }}
    />
  );
}

export function FoundationV2Fields({ f, set }: { f: Foundation; set: Set }) {
  if (f.type === 'none') return null;
  const v = v2Of(f);
  const set2 = (patch: Partial<FoundationV2>) => set({ v2: { ...v, ...patch } });
  const wells = v.wells ?? { count: 0, width: 36, projection: 36, depth: 48 };
  const setWells = (patch: Partial<typeof wells>) => set2({ wells: { ...wells, ...patch } });
  return (
    <>
      {f.type === 'basement' && (
        <>
          <h4>Basement</h4>
          <div className="row">
            <Field label="Footing drain">
              <select value={v.footingDrain ? 'yes' : 'no'} onChange={(e) => set2({ footingDrain: e.target.value === 'yes' })}>
                <option value="no">None</option>
                <option value="yes">4" perforated (R405)</option>
              </select>
            </Field>
            <Field label="Wall coating">
              <select value={v.wallCoating ?? 'none'} onChange={(e) => set2({ wallCoating: e.target.value as FoundationV2['wallCoating'] })}>
                <option value="none">None</option>
                <option value="dampproof">Dampproofing</option>
                <option value="waterproof">Waterproofing</option>
              </select>
            </Field>
          </div>
          <div className="row">
            <Field label="Wall foam">
              <select value={String(v.wallFoam ?? 0)} onChange={(e) => set2({ wallFoam: Number(e.target.value) })}>
                <option value="0">None</option>
                {[1, 1.5, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}" board
                  </option>
                ))}
              </select>
            </Field>
            {!!v.wallFoam && (
              <Field label="Foam side">
                <select value={v.foamSide ?? 'interior'} onChange={(e) => set2({ foamSide: e.target.value as FoundationV2['foamSide'] })}>
                  <option value="interior">Inside</option>
                  <option value="exterior">Outside</option>
                </select>
              </Field>
            )}
          </div>
          <div className="row">
            <Field label="Window wells">
              <NumberInput value={wells.count} onChange={(n) => setWells({ count: Math.max(0, Math.round(n ?? 0)) })} />
            </Field>
            {wells.count > 0 && (
              <Field label="Well depth">
                <LengthInput value={wells.depth} min={1} onChange={(depth) => setWells({ depth })} />
              </Field>
            )}
          </div>
          {wells.count > 0 && (
            <div className="row">
              <Field label="Well width">
                <LengthInput value={wells.width} min={1} onChange={(width) => setWells({ width })} />
              </Field>
              <Field label="Projection">
                <LengthInput value={wells.projection} min={1} onChange={(projection) => setWells({ projection })} />
              </Field>
            </div>
          )}
          <small className="muted">Slab floor below, framed floor above on the girders. Wells aren't placed on the plan — enter how many basement windows get one.</small>
        </>
      )}
      {(f.type === 'crawl' || f.type === 'basement') && (
        <div className="row">
          <Field label="Pier pads">
            <LengthInput value={v.pierPad ?? DEFAULT_PIER_PAD} min={1} onChange={(pierPad) => set2({ pierPad })} />
          </Field>
          <Field label="Pad thick">
            <LengthInput value={v.pierPadThickness ?? DEFAULT_PIER_PAD_THICKNESS} min={1} onChange={(pierPadThickness) => set2({ pierPadThickness })} />
          </Field>
          <Field label="#4 bars each way">
            <select value={String(v.pierBars ?? 0)} onChange={(e) => set2({ pierBars: Number(e.target.value) })}>
              {[0, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n || 'None'}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      {!!v.bearingWalls?.length && (
        <div className="row">
          <Field label="Bearing footing width">
            <LengthInput value={interiorFootingSize(f).width} min={1} onChange={(interiorFootingWidth) => set2({ interiorFootingWidth })} />
          </Field>
          <Field label={f.type === 'slab' ? 'Depth below slab' : 'Thick'}>
            <LengthInput value={interiorFootingSize(f).thickness} min={1} onChange={(interiorFootingThickness) => set2({ interiorFootingThickness })} />
          </Field>
        </div>
      )}
      <div className="row">
        <Field label="Soil bearing (psf)">
          <NumberInput value={v.soilBearing} placeholder="e.g. from a soil report" onChange={(soilBearing) => set2({ soilBearing })} />
        </Field>
        <Field label="Storeys carried">
          <select value={String(v.storeys ?? '')} onChange={(e) => set2({ storeys: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">—</option>
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <small className="muted">Footing width is yours to set: look it up in IRC Table R403.1 for your soil, storeys and construction — the table isn't built in.</small>
    </>
  );
}

/** Wall panel: carry an interior wall on its own footing. */
export function BearingFootingField({ project, wall, dispatch }: { project: Project; wall: Wall; dispatch: Dispatch<Action> }) {
  const f = foundationOf(project);
  if (wall.kind !== 'interior' || f.type === 'none') return null;
  const v = v2Of(f);
  const ids = v.bearingWalls ?? [];
  const on = ids.includes(wall.id);
  return (
    <Field label="Bearing" hint={on ? `On its own ${f.type === 'slab' ? 'thickened-slab ' : ''}footing — size it under Foundation in the project panel` : 'Tick if this wall carries load down to a footing'}>
      <span>
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            const next = e.target.checked ? [...ids, wall.id] : ids.filter((id) => id !== wall.id);
            dispatch({ type: 'setFoundation', patch: { v2: { ...v, bearingWalls: next.length ? next : undefined } } });
          }}
        />{' '}
        Bearing wall — footing below
      </span>
    </Field>
  );
}
