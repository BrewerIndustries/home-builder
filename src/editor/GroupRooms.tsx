import type { Dispatch } from 'react';
import { ceilingInfo } from '../calc/ceilings.ts';
import type { Action } from '../model/store.ts';
import type { CeilingType, Project, RoomType } from '../model/types.ts';
import { CEILINGS, ROOM_TYPES } from './Inspector.tsx';
import { LengthInput } from './LengthInput.tsx';

// Several rooms picked together: set their ceiling style, ceiling height and use
// in one go (one undo step). Mixed values show as "—" until you pick one.

const ROW = { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } as const;

export function GroupRooms({ project, dispatch, ids }: { project: Project; dispatch: Dispatch<Action>; ids: string[] }) {
  const rooms = project.rooms.filter((r) => ids.includes(r.id));
  if (!rooms.length) return null;
  const same = <T,>(xs: T[]) => (xs.every((x) => x === xs[0]) ? xs[0] : undefined);
  const style = same(rooms.map((r) => r.ceiling?.type ?? 'flat'));
  const use = same(rooms.map((r) => r.type));
  // The height each room's panel shows (its own height, or its wall height when blank).
  const heights = rooms.map((r) => (r.ceiling?.height ?? ceilingInfo(project, r).low));
  const height = same(heights.map((h) => Math.round(h * 100) / 100));
  const sloped = rooms.some((r) => r.ceiling?.type === 'vaulted' || r.ceiling?.type === 'cathedral');
  const all = rooms.map((r) => r.id);
  return (
    <div style={ROW}>
      <span className="muted small">
        {rooms.length} room{rooms.length > 1 ? 's' : ''} — ceiling
      </span>
      <select value={style ?? ''} onChange={(e) => dispatch({ type: 'updateRooms', ids: all, ceiling: { type: e.target.value as CeilingType } })} title="Ceiling style for every picked room">
        {style === undefined && <option value="">— mixed —</option>}
        {CEILINGS.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
      <span className="muted small">{sloped ? 'height (low side)' : 'height'}</span>
      <span style={{ width: 84, display: 'inline-block' }} title={height === undefined ? `Mixed (${rooms.length} rooms); type a height to set them all` : 'Ceiling height for every picked room'}>
        <LengthInput key={`${all.join()}|${height ?? 'mixed'}`} value={height ?? heights[0]} min={48} onChange={(v) => dispatch({ type: 'updateRooms', ids: all, ceiling: { height: v } })} />
      </span>
      {height === undefined && <span className="muted small">(mixed)</span>}
      <span className="muted small">use</span>
      <select value={use ?? ''} onChange={(e) => dispatch({ type: 'updateRooms', ids: all, patch: { type: e.target.value as RoomType } })} title="Use for every picked room">
        {use === undefined && <option value="">— mixed —</option>}
        {ROOM_TYPES.map((t) => (
          <option key={t} value={t}>
            {t[0].toUpperCase() + t.slice(1)}
          </option>
        ))}
      </select>
    </div>
  );
}
