import type { Dispatch } from 'react';
import { activeStorey, activeStoreyId, isMultiStorey, storeyElevation, storeyHeight, storeyList } from '../model/storeys.ts';
import type { Action } from '../model/store.ts';
import type { Project } from '../model/types.ts';
import { formatFtIn } from '../model/units.ts';
import { LengthInput } from './LengthInput.tsx';

// The floor switcher over the plan (Storeys v1): one button per storey, top
// floor first, and a menu for the active one — its name and floor-to-floor
// height — and adding a floor above, a basement below, or removing this one.

export function StoreyBar({ project, dispatch, onSwitch }: { project: Project; dispatch: Dispatch<Action>; onSwitch?(): void }) {
  const list = [...storeyList(project)].reverse();
  const cur = activeStorey(project);
  const multi = isMultiStorey(project);
  const go = (id: string) => {
    if (id === activeStoreyId(project)) return;
    dispatch({ type: 'storey', op: { op: 'switch', id } });
    onSwitch?.();
  };
  return (
    <div className="storey-bar">
      {multi && (
        <div className="seg" role="group" aria-label="Floor">
          {list.map((s) => (
            <button key={s.id} className={s.id === cur.id ? 'active' : ''} onClick={() => go(s.id)} title={`${s.name} — floor at ${formatFtIn(storeyElevation(project, s.id))}`}>
              {s.name.replace(/ floor$/i, '')}
            </button>
          ))}
        </div>
      )}
      <details className="menu">
        <summary title="Storeys: add a floor or basement, rename this one, set its floor-to-floor height">{multi ? '▾' : 'Floors ▾'}</summary>
        <div className="menu-body storey-menu">
          {multi && (
            <>
              <label>
                <span className="stat-label">Name</span>
                <input value={cur.name} onChange={(e) => dispatch({ type: 'storey', op: { op: 'update', id: cur.id, patch: { name: e.target.value } } })} />
              </label>
              <label title="Floor to floor: sets every stair's rise from this floor and stacks the floors in 3D">
                <span className="stat-label">Floor to floor{cur.height === undefined ? ' (estimated)' : ''}</span>
                <LengthInput value={storeyHeight(project, cur)} min={48} onChange={(v) => dispatch({ type: 'storey', op: { op: 'update', id: cur.id, patch: { height: v } } })} />
              </label>
              {cur.height !== undefined && (
                <button onClick={() => dispatch({ type: 'storey', op: { op: 'update', id: cur.id, patch: { height: undefined } } })}>Estimate from the walls</button>
              )}
            </>
          )}
          <button onClick={() => (dispatch({ type: 'storey', op: { op: 'add', dir: 1 } }), onSwitch?.())} title="A new top floor, starting with the exterior walls of the floor under it">
            Add a floor above
          </button>
          {!list.some((s) => s.level < 0) && (
            <button onClick={() => (dispatch({ type: 'storey', op: { op: 'add', dir: -1 } }), onSwitch?.())} title="A basement under the lowest floor; the foundation moves under it">
              Add a basement
            </button>
          )}
          {multi && (
            <button
              className="danger"
              onClick={() => {
                if (!confirm(`Delete the ${cur.name.toLowerCase()} and everything drawn on it?`)) return;
                dispatch({ type: 'storey', op: { op: 'remove', id: cur.id } });
                onSwitch?.();
              }}
            >
              Delete this floor
            </button>
          )}
        </div>
      </details>
    </div>
  );
}
