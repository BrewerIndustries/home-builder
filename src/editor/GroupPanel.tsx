import type { ReactNode } from 'react';
import type { AlignHow } from '../model/selection.ts';
import { AngleInput } from './LengthInput.tsx';

// Wall edits v6: the bar for a picked group (or a single room): turn, mirror
// (about its centre or a picked line), align, distribute, copy / paste, delete.

interface Props {
  /** How many items are picked; 1 = a single room (its turn and centre mirrors are in the Room panel). */
  count: number;
  /** Separately movable units (align needs 2, distribute 3). */
  units: number;
  /** Picking a mirror line: how many of its two points are in. */
  picking: number | null;
  canPaste: boolean;
  onTurn(deg: number): void;
  onMirror(axis: 'x' | 'y'): void;
  onMirrorLine(): void;
  onAlign(how: AlignHow): void;
  onDistribute(axis: 'x' | 'y'): void;
  onCopy(): void;
  onPaste(): void;
  onDelete(): void;
  onClear(): void;
  /** Extra rows for the picked items (e.g. the picked rooms' ceilings). */
  children?: ReactNode;
}

const ALIGN: [AlignHow, string, string][] = [
  ['left', '⇤', 'Align left edges'],
  ['centre', '⇹', 'Align centres (across)'],
  ['right', '⇥', 'Align right edges'],
  ['top', '⤒', 'Align top edges'],
  ['middle', '⇳', 'Align middles (down)'],
  ['bottom', '⤓', 'Align bottom edges'],
];

const ROW = { display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' } as const;

export function GroupPanel(p: Props) {
  const group = p.count > 1;
  if (p.picking !== null) {
    return (
      <div className="float-panel" style={{ top: 'auto', bottom: 44 }}>
        <div style={ROW}>
          <span>
            <strong>Mirror about a line:</strong> click its {p.picking ? 'second' : 'first'} point (snaps to wall ends and the grid; Shift = any angle).
          </span>
          <button onClick={p.onClear}>Cancel</button>
        </div>
      </div>
    );
  }
  return (
    <div className="float-panel" style={{ top: 'auto', bottom: 44, display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 'calc(100% - 24px)' }}>
      <div style={ROW}>
        <strong>{group ? `${p.count} picked` : 'Room'}</strong>
        {group && (
          <>
            <span className="muted small">Turn</span>
            <button onClick={() => p.onTurn(90)} title="Turn 90° anticlockwise about the group's centre">⟲ 90°</button>
            <button onClick={() => p.onTurn(-90)} title="Turn 90° clockwise">⟳ 90°</button>
            <button onClick={() => p.onTurn(15)} title="Turn 15° anticlockwise">⟲ 15°</button>
            <button onClick={() => p.onTurn(-15)} title="Turn 15° clockwise">⟳ 15°</button>
            <span title="Turn by an angle, anticlockwise" style={{ width: 64, display: 'inline-block' }}>
              <AngleInput key={p.count} value={0} onChange={(deg) => p.onTurn(deg > 180 ? deg - 360 : deg)} />
            </span>
            <span className="muted small">Mirror</span>
            <button onClick={() => p.onMirror('x')} title="Mirror left ↔ right about the group's centre">⇆</button>
            <button onClick={() => p.onMirror('y')} title="Mirror top ↔ bottom about the group's centre">⇅</button>
          </>
        )}
        <button onClick={p.onMirrorLine} title="Mirror about a line you pick: two clicks">Mirror about a line…</button>
      </div>
      {p.children}
      <div style={ROW}>
        {group && (
          <>
            <span className="muted small">Align</span>
            {ALIGN.map(([how, icon, title]) => (
              <button key={how} onClick={() => p.onAlign(how)} disabled={p.units < 2} title={title}>
                {icon}
              </button>
            ))}
            <span className="muted small">Distribute</span>
            <button onClick={() => p.onDistribute('x')} disabled={p.units < 3} title="Equal gaps across (three or more)">
              ⇿ across
            </button>
            <button onClick={() => p.onDistribute('y')} disabled={p.units < 3} title="Equal gaps down (three or more)">
              ↕ down
            </button>
          </>
        )}
        <button onClick={p.onCopy} title="Copy with its walls, doors, devices and contents (⌘C)">Copy</button>
        <button onClick={p.onPaste} disabled={!p.canPaste} title="Paste at the pointer (⌘V)">
          Paste
        </button>
        {group && (
          <>
            <button onClick={p.onDelete} title="Delete everything picked, rooms with their walls and contents (⌫)">Delete</button>
            <button onClick={p.onClear} title="Clear the pick (Esc)">Done</button>
          </>
        )}
      </div>
    </div>
  );
}
