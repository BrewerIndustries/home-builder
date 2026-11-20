import { useMemo, type Dispatch } from 'react';
import { applyRefit, describeRefit, refitAll, refitRoom, staleRooms } from '../calc/refit.ts';
import type { Action } from '../model/store.ts';
import type { Project, Room } from '../model/types.ts';

// Redefine rooms after walls are removed or added: re-trace a room from the
// walls round it (merging a neighbour whose wall is gone, or splitting off the
// part a new wall cut away), one room or every room at once. One undo step.

/** Room panel: shown when this room's outline no longer matches its walls. */
export function RoomRefitField({ project, dispatch, room }: { project: Project; dispatch: Dispatch<Action>; room: Room }) {
  const fit = useMemo(() => refitRoom(project, room.id), [project, room.id]);
  if (!fit) return null;
  if ('error' in fit) {
    return (
      <div className="field">
        <span>Walls changed</span>
        <small className="muted">The walls round this room no longer close (a wall is missing). Close the gap, then Re-fit — or draw the room again with the Room tool.</small>
      </div>
    );
  }
  if (!fit.changed) return null;
  return (
    <div className="field">
      <span>Walls changed</span>
      <small className="muted">This room's outline no longer matches the walls round it. Re-fit {describeRefit(fit)}.</small>
      <div className="row">
        <button onClick={() => dispatch({ type: 'setRooms', rooms: applyRefit(project, fit).rooms })} title="Trace this room from the walls as they are now (one undo step)">
          Re-fit to walls
        </button>
      </div>
    </div>
  );
}

/** Project panel: every room that no longer matches its walls, re-fitted in one go. */
export function RefitAllField({ project, dispatch }: { project: Project; dispatch: Dispatch<Action> }) {
  const stale = useMemo(() => staleRooms(project), [project]);
  if (!stale.length) return null;
  const open = stale.filter((s) => 'error' in s).length;
  const fixable = stale.length - open;
  return (
    <div className="field">
      <span>Rooms</span>
      <small className="muted">
        {fixable > 0 && `${fixable} room${fixable > 1 ? 's' : ''} no longer match${fixable > 1 ? '' : 'es'} the walls round ${fixable > 1 ? 'them' : 'it'}. `}
        {open > 0 && `${open} room${open > 1 ? 's have' : ' has'} a gap in ${open > 1 ? 'their' : 'its'} walls (left as drawn).`}
      </small>
      {fixable > 0 && (
        <div className="row">
          <button onClick={() => dispatch({ type: 'setRooms', rooms: refitAll(project).project.rooms })} title="Merge rooms whose dividing wall is gone, split rooms a new wall cuts through, and re-trace the rest (one undo step)">
            Re-fit all rooms to walls
          </button>
        </div>
      )}
    </div>
  );
}
