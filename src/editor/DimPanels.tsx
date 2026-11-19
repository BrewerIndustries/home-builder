import type { Dispatch } from 'react';
import { anchorTarget } from '../calc/faces.ts';
import { ordinateValues } from '../calc/ordinate.ts';
import type { Action } from '../model/store.ts';
import type { OrdinateDim, Project } from '../model/types.ts';
import { formatFtIn } from '../model/units.ts';
import { END_KINDS, lookOf, TEXT_SIZES, type DimEnds } from './dimLook.tsx';
import { Field } from './Inspector.tsx';

/** Plan settings: the dimension style — text size and end marks — on the plan and the print sheet. */
export function DimStyleFields({ project, dispatch }: { project: Project; dispatch: Dispatch<Action> }) {
  const look = lookOf(project);
  return (
    <>
      <Field label="Dimension text" hint="Every dimension's text, on the plan and the print sheet">
        <select value={look.text} onChange={(e) => dispatch({ type: 'setDimLook', patch: { text: Number(e.target.value) } })}>
          {TEXT_SIZES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Dimension ends" hint="The mark where a dimension line meets each point (angle arcs keep dots unless arrows; a running string's zero stays an open circle)">
        <select value={look.ends} onChange={(e) => dispatch({ type: 'setDimLook', patch: { ends: e.target.value as DimEnds } })}>
          {END_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}

/** A selected ordinate (baseline) dimension: its axis, each point's distance from the origin, what they follow. */
export function OrdinatePanel({ project, dispatch, d, onDelete }: { project: Project; dispatch: Dispatch<Action>; d: OrdinateDim; onDelete(): void }) {
  const offset = project.dimOffsets?.[d.id] ?? 0;
  const values = ordinateValues(d);
  const follows = (at: Parameters<typeof anchorTarget>[1]) => anchorTarget(project, at) ?? 'fixed';
  return (
    <aside className="inspector">
      <h3>Ordinate dimension</h3>
      <Field label="Measures" hint="Each point's distance from the origin along this axis">
        <select value={d.axis} onChange={(e) => dispatch({ type: 'updateOrdDim', id: d.id, patch: { axis: e.target.value as 'x' | 'y' } })}>
          <option value="x">Across the plan (left / right)</option>
          <option value="y">Up / down the plan</option>
        </select>
      </Field>
      <Field label="Origin" hint="Snapped to a wall end, opening, fixture, counter or room point, it follows it">
        <span>{follows(d.origin.at)}</span>
      </Field>
      <ol className="small">
        {d.pts.map((q, i) => (
          <li key={i}>
            {formatFtIn(values[i])} <span className="muted">· {follows(q.at)}</span>
          </li>
        ))}
      </ol>
      <p className="muted small">Drag it in or out; double-click it to put it back. Pick more points with the Dimension tool (Ordinate) to start another set.</p>
      {d.pts.length > 1 && <button onClick={() => dispatch({ type: 'updateOrdDim', id: d.id, patch: { pts: d.pts.slice(0, -1) } })}>Remove last point</button>}{' '}
      {offset !== 0 && <button onClick={() => dispatch({ type: 'setDimOffset', id: d.id, offset: 0 })}>Put it back</button>}{' '}
      <button className="danger" onClick={onDelete}>
        Delete ordinate dimension
      </button>
    </aside>
  );
}
