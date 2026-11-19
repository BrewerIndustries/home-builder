import type { Dispatch } from 'react';
import { applianceLabel, circuitOfDevice, circuits, GAS_CAPABLE, newCircuitKey, TYPICAL, type ApplianceKind } from '../calc/circuits.ts';
import { floorAboveGrade } from '../calc/outdoor.ts';
import type { Action } from '../model/store.ts';
import type { ApplianceSetting, Counter, Project } from '../model/types.ts';
import { formatFtIn } from '../model/units.ts';
import { LengthInput } from './LengthInput.tsx';

// Inspector pieces for branch circuits and appliance nameplates (see calc/circuits.ts).

type Props = { project: Project; dispatch: Dispatch<Action> };

const APPLIANCE_OF: Record<string, ApplianceKind | undefined> = {
  range: 'range', fridge: 'fridge', washer: 'washer', dryer: 'dryer', 'water-heater': 'water-heater', furnace: 'furnace', 'air-handler': 'air-handler',
  oven: 'oven', dishwasher: 'dishwasher',
};

/** Furniture / cutout kinds with electrical settings. */
export const hasApplianceFields = (kind: string) => !!APPLIANCE_OF[kind] || kind === 'kitchen-sink' || kind === 'sink';

/** Which branch circuit a device is on, with a pick to move it. */
export function CircuitField({ project, dispatch, deviceId }: Props & { deviceId: string }) {
  const cs = circuits(project);
  const cur = circuitOfDevice(cs, deviceId);
  const map = project.electrical?.circuitOf ?? {};
  const moved = map[deviceId];
  const set = (key: string) => {
    const next = { ...map };
    if (key === '') delete next[deviceId];
    else next[deviceId] = key === '__new' ? newCircuitKey(cs) : key;
    dispatch({ type: 'setElectrical', patch: { circuitOf: next } });
  };
  if (!cur && !moved) return null;
  return (
    <label className="field">
      <span>Circuit</span>
      <select value={moved && cs.some((c) => c.key === moved) ? moved : ''} onChange={(e) => set(e.target.value)}>
        <option value="">Auto{!moved && cur ? ` — ${cur.label}` : ''}</option>
        {cs.map((c) => (
          <option key={c.key} value={c.key}>
            {c.label} · {c.amps} A{c.poles === 2 ? ' 2P' : ''}
          </option>
        ))}
        <option value="__new">New circuit…</option>
      </select>
      <small className="muted">
        {cur ? `${cur.amps} A${cur.afci ? ' · AFCI' : ''}${cur.gfci ? ' · GFCI' : ''} · ${cur.devices.length} device${cur.devices.length === 1 ? '' : 's'}. ` : ''}
        Panel schedule and load calc on the Electrical tab.
      </small>
    </label>
  );
}

function NumberInput({ value, placeholder, onChange }: { value?: number; placeholder: string; onChange(v: number | undefined): void }) {
  return (
    <input
      key={value ?? ''}
      inputMode="numeric"
      defaultValue={value === undefined ? '' : String(value)}
      placeholder={placeholder}
      onBlur={(e) => {
        const n = Number(e.target.value);
        onChange(e.target.value.trim() === '' || !Number.isFinite(n) || n < 0 ? undefined : Math.round(n));
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

/** Nameplate, fuel and extras for an appliance symbol or counter cutout. */
export function ApplianceFields({ project, dispatch, id, kind, title }: Props & { id: string; kind: string; title?: string }) {
  const all = project.electrical?.appliances ?? {};
  const s = all[id] ?? {};
  const put = (key: string, patch: Partial<ApplianceSetting>) => {
    const next = { ...(all[key] ?? {}), ...patch };
    for (const k of Object.keys(next) as (keyof ApplianceSetting)[]) if (next[k] === undefined || next[k] === false) delete next[k];
    const appliances = { ...all, [key]: next };
    if (!Object.keys(next).length) delete appliances[key];
    dispatch({ type: 'setElectrical', patch: { appliances } });
  };
  const ak = APPLIANCE_OF[kind];
  const sink = kind === 'kitchen-sink' || kind === 'sink';
  const gas = !!ak && GAS_CAPABLE.has(ak) && !!s.gas;
  const typical = ak ? (gas ? (ak === 'furnace' ? 800 : 0) : TYPICAL[ak].va) : 0;
  return (
    <div className="field">
      <span>{title ?? 'Electrical'}</span>
      {ak && GAS_CAPABLE.has(ak) && (
        <label className="link-row">
          <input type="checkbox" checked={!!s.gas} onChange={(e) => put(id, { gas: e.target.checked || undefined })} /> Gas-fired
        </label>
      )}
      {ak && ak !== 'washer' && !(gas && typical === 0) && (
        <label className="link-row">
          Nameplate <NumberInput value={s.va} placeholder={`${typical} typical`} onChange={(va) => put(id, { va })} /> VA
        </label>
      )}
      {sink && (
        <label className="link-row">
          <input type="checkbox" checked={!!s.disposal} onChange={(e) => put(id, { disposal: e.target.checked || undefined })} /> Disposer under it
        </label>
      )}
      {sink && s.disposal && (
        <label className="link-row">
          Disposer <NumberInput value={all[`${id}:disposal`]?.va} placeholder={`${TYPICAL.disposal.va} typical`} onChange={(va) => put(`${id}:disposal`, { va })} /> VA
        </label>
      )}
      {ak === 'range' && (
        <label className="link-row">
          <input type="checkbox" checked={!!s.microwave} onChange={(e) => put(id, { microwave: e.target.checked || undefined })} /> Microwave-hood over it
        </label>
      )}
      {ak === 'range' && s.microwave && (
        <label className="link-row">
          Microwave <NumberInput value={all[`${id}:microwave`]?.va} placeholder={`${TYPICAL.microwave.va} typical`} onChange={(va) => put(`${id}:microwave`, { va })} /> VA
        </label>
      )}
      <small className="muted">
        {ak === 'washer'
          ? 'On the 20 A laundry circuit.'
          : gas && typical === 0
            ? 'Gas: no dedicated circuit; its igniter / vent plugs into a nearby receptacle.'
            : ak
              ? `Typical loads stand in until you type the nameplate (watts = VA). ${ak === 'range' || ak === 'oven' ? 'Cooking load is taken at nameplate (no Table 220.55 demand).' : ''}`
              : 'Tick a disposer to give it a dedicated circuit.'}
      </small>
    </div>
  );
}

/** Appliance settings for each cutout in a counter run. */
export function CounterAppliances({ project, dispatch, counter }: Props & { counter: Counter }) {
  const cuts = counter.cutouts.filter((k) => hasApplianceFields(k.kind));
  if (!cuts.length) return null;
  return (
    <>
      {cuts.map((k, i) => (
        <div key={k.id}>
          <ApplianceFields project={project} dispatch={dispatch} id={k.id} kind={k.kind} title={`${applianceLabel(k.kind)}${cuts.filter((x) => x.kind === k.kind).length > 1 ? ` ${i + 1}` : ''}`} />
          {k.kind !== 'sink' && <CircuitField project={project} dispatch={dispatch} deviceId={k.id} />}
        </div>
      ))}
    </>
  );
}

/** Project panel: the floor's height above grade (outdoor receptacle heights). */
export function ProjectElectricalFields({ project, dispatch }: Props) {
  const g = floorAboveGrade(project);
  return (
    <label className="field">
      <span>Floor above grade</span>
      <LengthInput value={g.height} onChange={(v) => dispatch({ type: 'setElectrical', patch: { floorAboveGrade: v } })} />
      <small className="muted">
        Outdoor receptacles must be within 6'-6" of grade (E3901.7).{' '}
        {g.from === 'set' ? (
          <button className="link" onClick={() => dispatch({ type: 'setElectrical', patch: { floorAboveGrade: undefined } })}>
            Use the foundation's
          </button>
        ) : g.from === 'foundation' ? (
          `${formatFtIn(g.height)} from the foundation.`
        ) : (
          'No foundation set — taken at grade.'
        )}
      </small>
    </label>
  );
}
