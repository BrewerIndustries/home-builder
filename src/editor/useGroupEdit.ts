import { useEffect, useRef, useState, type Dispatch } from 'react';
import type { Action } from '../model/store.ts';
import {
  alignUnits,
  boundsCentre,
  centreLine,
  clipBounds,
  clipSelection,
  copyGroup,
  groupBounds,
  groupMembers,
  liveItems,
  pasteClip,
  placeClip,
  selItems,
  type Clip,
  type GroupOp,
  type SelItem,
} from '../model/selection.ts';
import { uid, type Point, type Project } from '../model/types.ts';
import type { Hit } from './hitTest.ts';

// Wall edits v6, the canvas side: the picked group (two or more items; a single
// pick stays the ordinary selection), the copy clipboard, mirror-line picking,
// and the keys (⌘C / ⌘V, ⌫ for the group, Esc).

const GRID = 6;

interface Opts {
  project: Project;
  dispatch: Dispatch<Action>;
  selection: Hit | null;
  setSelection(h: Hit | null): void;
  active: boolean;
  /** Where the pointer is on the plan (pastes land there), if it's over the canvas. */
  pointer: Point | null;
  onMessage?(msg: string): void;
}

export function useGroupEdit({ project, dispatch, selection, setSelection, active, pointer, onMessage }: Opts) {
  const [raw, setGroup] = useState<SelItem[]>([]);
  const group = liveItems(project, raw);
  const [clip, setClip] = useState<{ clip: Clip; pasted: number } | null>(null);
  /** Picking a mirror line: the points picked so far (null = not picking). */
  const [mirrorPick, setMirrorPick] = useState<Point[] | null>(null);
  /** The picks a group edit acts on: the group, else the single selection. */
  const items: SelItem[] = group.length > 1 ? group : selItems(selection ? [selection] : []);
  const members = group.length > 1 ? groupMembers(project, group) : [];
  const bounds = group.length > 1 ? groupBounds(project, group) : null;

  /** Set the pick: two or more become the group; one is the ordinary selection. */
  function pick(next: SelItem[]) {
    if (next.length > 1) {
      setGroup(next);
      setSelection(null);
    } else {
      setGroup([]);
      setSelection(next[0] ?? null);
    }
  }

  const isMember = (h: Hit | null) => !!h && members.some((x) => x.kind === h.kind && x.id === h.id);

  function op(o: GroupOp, transient?: boolean) {
    if (items.length) dispatch({ type: 'groupEdit', sel: items, op: o, transient });
  }

  function mirror(axis: 'x' | 'y') {
    const b = groupBounds(project, items);
    if (b) op({ kind: 'mirror', ...centreLine(boundsCentre(b), axis) });
  }

  function copy() {
    const c = copyGroup(project, items);
    if (!c) return;
    setClip({ clip: c, pasted: 0 });
    onMessage?.(`Copied ${items.length > 1 ? `${items.length} items` : 'it'} with ${c.walls.length} wall${c.walls.length === 1 ? '' : 's'} — ⌘V pastes at the pointer.`);
  }

  function paste() {
    if (!clip) return;
    const b = clipBounds(clip.clip);
    if (!b) return;
    const c = boundsCentre(b);
    const n = clip.pasted + 1;
    // At the pointer (its centre on the 6" grid), else beside the original.
    const delta = pointer
      ? { x: Math.round(pointer.x / GRID) * GRID - Math.round(c.x / GRID) * GRID, y: Math.round(pointer.y / GRID) * GRID - Math.round(c.y / GRID) * GRID }
      : { x: Math.ceil((b.max.x - b.min.x + 24) / GRID) * GRID * n, y: 0 };
    const placed = placeClip(clip.clip, delta, uid);
    dispatch({ type: 'paste', clip: placed });
    setClip({ ...clip, pasted: n });
    pick(clipSelection(pasteClip(project, placed), placed));
  }

  function remove() {
    if (group.length < 2) return;
    dispatch({ type: 'delete', ids: members.map((x) => x.id) });
    pick([]);
  }

  /** A picked mirror-line point; the second one mirrors the picks. */
  function addMirrorPoint(p: Point) {
    const pts = [...(mirrorPick ?? []), p];
    if (pts.length < 2) {
      setMirrorPick(pts);
      return;
    }
    setMirrorPick(null);
    if (Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) < 1) return;
    op({ kind: 'mirror', a: pts[0], b: pts[1] });
    onMessage?.('Mirrored about the picked line — ⌘Z undoes it.');
  }

  // Keys. Bubble phase, after the canvas's own typed-value handling.
  const live = useRef({ copy, paste, remove, group, mirrorPick, items });
  live.current = { copy, paste, remove, group, mirrorPick, items };
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
      const l = live.current;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'c' && l.items.length) {
        l.copy();
        e.preventDefault();
      } else if (mod && e.key.toLowerCase() === 'v') {
        l.paste();
        e.preventDefault();
      } else if (!mod && (e.key === 'Delete' || e.key === 'Backspace') && l.group.length > 1) {
        l.remove();
        e.preventDefault();
      } else if (e.key === 'Escape') {
        if (l.mirrorPick) setMirrorPick(null);
        else if (l.group.length) setGroup([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  return {
    group,
    items,
    members,
    bounds,
    units: alignUnits(project, items).length,
    canPaste: !!clip,
    mirrorPick,
    setMirrorPick,
    pick,
    isMember,
    op,
    mirror,
    copy,
    paste,
    remove,
    addMirrorPoint,
    clear: () => {
      setMirrorPick(null);
      setGroup([]);
    },
  };
}
