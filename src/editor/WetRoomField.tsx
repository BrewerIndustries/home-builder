import { useMemo, type Dispatch } from 'react';
import { WET_FINISH_MIN, wetSummary } from '../calc/wetRoom.ts';
import type { Action } from '../model/store.ts';
import type { Project, Room, WetDrain } from '../model/types.ts';
import { formatFtIn } from '../model/units.ts';
import { LengthInput } from './LengthInput.tsx';

// Room panel: make a room or area a wet room — tiled floor and walls over a
// waterproofing membrane, floor sloped to a linear or centre drain, cement board
// in place of drywall behind the tile (calc/wetRoom.ts).

export function WetRoomField({ project, dispatch, room }: { project: Project; dispatch: Dispatch<Action>; room: Room }) {
  const s = useMemo(() => (room.wet ? wetSummary(project, room) : null), [project, room]);
  const set = (wet: Room['wet']) => dispatch({ type: 'updateRoom', id: room.id, patch: { wet } });
  const wet = room.wet;
  return (
    <div className="field">
      <span>Wet room</span>
      <label className="link-row">
        <input type="checkbox" checked={!!wet} onChange={(e) => set(e.target.checked ? { drain: 'linear' } : undefined)} /> Tiled and waterproofed, with a floor drain
      </label>
      {wet && (
        <>
          <div className="row">
            <select value={wet.drain} onChange={(e) => set({ ...wet, drain: e.target.value as WetDrain })} title="How the floor drains">
              <option value="linear">Linear drain</option>
              <option value="centre">Centre drain</option>
            </select>
            <select
              value={wet.tileHeight === undefined ? 'full' : 'set'}
              onChange={(e) => set({ ...wet, tileHeight: e.target.value === 'full' ? undefined : 84 })}
              title="How high the wall tile goes"
            >
              <option value="full">Tile full height</option>
              <option value="set">Tile to a height</option>
            </select>
          </div>
          {wet.tileHeight !== undefined && <LengthInput value={wet.tileHeight} min={12} onChange={(v) => set({ ...wet, tileHeight: v })} />}
          {s && (
            <small className="muted">
              {Math.round(s.floor)} sq ft floor + {Math.round(s.walls)} sq ft wall tile over membrane; cement board behind the wall tile in place of drywall; the floor slopes to the drain.
              {s.glassEdge > 0 && ` ${formatFtIn(s.glassEdge)} of it is closed by glass.`}
              {s.minHeight !== null && s.minHeight < WET_FINISH_MIN && ` Tile stops at ${formatFtIn(s.minHeight)} — R307.2 wants 6' 0" round a shower.`}
            </small>
          )}
        </>
      )}
    </div>
  );
}
