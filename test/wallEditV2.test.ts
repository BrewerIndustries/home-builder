import assert from 'node:assert/strict';
import { test } from 'node:test';
import { snapWallMove, splitAt, wallSnapTargets } from '../src/model/wallEdit.ts';
import { box, door, project, wall } from './helpers.ts';

/** 240 × 144 box with an interior wall at x = 100 and another at x = 160. */
function plan() {
  const a = wall(100, 0, 100, 144, 'interior');
  const b = wall(160, 0, 160, 144, 'interior');
  return { p: project([...box(240, 144), a, b], [{ ...door(a.id, 72), id: 'd' }]), a, b };
}

test('a dragged wall snaps in line with a parallel wall', () => {
  const { p, a, b } = plan();
  const snap = wallSnapTargets(p, a);
  // Toward x = 160 the level grows or shrinks depending on the wall's normal; aim 58" toward b.
  const sign = Math.sign(snap.targets.find((t) => t.label.includes(`W${p.walls.indexOf(b) + 1}`))!.level - snap.start);
  const r = snapWallMove(snap, sign * 58, { tol: 4, grid: 6, square: true });
  assert.equal(r.perp, sign * 60);
  assert.match(r.label!, /in line with W6/);
});

test('flush with a thicker wall’s face; grid otherwise; Shift is free', () => {
  const { p, a } = plan();
  const snap = wallSnapTargets(p, a);
  // The 6-1/2" exterior walls at x = 0 and 240 are parallel too: flush faces are 1" in from their centrelines.
  const levels = snap.targets.map((t) => Math.abs(t.level));
  assert.ok(levels.includes(1) && levels.includes(239), JSON.stringify(levels));
  // Away from any wall: the 6" grid.
  const g = snapWallMove(snap, 22, { tol: 2, grid: 6, square: true });
  assert.equal(Math.abs(snap.start + g.perp) % 6, 0);
  assert.equal(g.label, null);
  assert.equal(snapWallMove(snap, 22.4, { tol: 2, grid: 6, square: true, free: true }).perp, 22);
});

test('split at a clicked point: whole inches, never through a door or at the very end', () => {
  const { p, a } = plan();
  assert.equal(splitAt(p, a, 30.4), 30);
  assert.equal(splitAt(p, a, 72), null); // door 54–90
  assert.equal(splitAt(p, a, 3), null);
});
