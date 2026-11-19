import { resetWidths, setCabinetType } from '../calc/cabinets.ts';
import { BASE_TYPES, cabinetLayout, hasUppers, UPPER_HEIGHTS, upperHeight, upperLayout } from '../calc/counters.ts';
import type { BaseCabinetType, Counter, Project } from '../model/types.ts';

/** The counter inspector's cabinet section (Counters v6): base cabinets with a type each, wall-cabinet height and layout, layout pricing. */
export function CabinetPanel({ project, c, up }: { project: Project; c: Counter; up: (patch: Partial<Counter>) => void }) {
  const base = cabinetLayout(project, c);
  const upper = upperLayout(project, c);
  const pinned = !!(c.cabinets?.base?.some(Boolean) || c.cabinets?.upper?.some(Boolean));
  return (
    <>
      <div className="field">
        <span>Base cabinets, start to end</span>
        <div className="row wrap small cabinet-list">
          {base.length === 0 && '—'}
          {base.map((k) =>
            k.kind === 'base' ? (
              <select
                key={k.s}
                value={k.type ?? 'standard'}
                title={`${Math.round(k.e - k.s)}" ${BASE_TYPES[k.type ?? 'standard'].name.toLowerCase()}`}
                onChange={(e) => up(setCabinetType(c, k.stretch!, k.index!, e.target.value as BaseCabinetType))}
              >
                {(Object.keys(BASE_TYPES) as BaseCabinetType[]).map((t) => (
                  <option key={t} value={t}>
                    {BASE_TYPES[t].prefix}
                    {Math.round(k.e - k.s)} · {BASE_TYPES[t].name.toLowerCase()}
                  </option>
                ))}
              </select>
            ) : (
              <span key={k.s} className="muted">
                {k.label}
              </span>
            ),
          )}
        </div>
      </div>
      {hasUppers(c) && (
        <div className="field">
          <span>Wall cabinets, start to end</span>
          <div className="row wrap small">
            <select value={upperHeight(c)} onChange={(e) => up({ upperHeight: Number(e.target.value) === 30 ? undefined : (Number(e.target.value) as 36 | 42) })} title="Wall-cabinet height; bottoms stay at 54&quot;">
              {UPPER_HEIGHTS.map((h) => (
                <option key={h} value={h}>
                  {h}" tall
                </option>
              ))}
            </select>
            <span className="cabinet-list">{upper.map((k) => k.label).join(' · ') || '—'}</span>
          </div>
        </div>
      )}
      <label className="link-row">
        <input type="checkbox" checked={!!c.cabinets} onChange={(e) => up({ cabinets: e.target.checked ? (c.cabinets ?? {}) : undefined })} /> Price cabinet by cabinet
        <span className="muted"> · {c.cabinets ? 'each cabinet its own estimate line' : 'off: priced by the linear foot (types and dragged widths turn it on)'}</span>
      </label>
      <p className="muted small">
        Drag a cabinet joint on the plan to resize the cabinets either side (3" steps, 9"–36").{' '}
        {pinned && (
          <button className="link" onClick={() => up(resetWidths(c))}>
            Back to stock widths
          </button>
        )}
      </p>
    </>
  );
}
