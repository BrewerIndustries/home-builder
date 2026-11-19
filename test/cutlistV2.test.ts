import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cutList, cutPieces, PLATE_JOINT_OFFSET, platePieces } from '../src/calc/cutlist.ts';
import { materialsList } from '../src/calc/materials.ts';
import { estimate } from '../src/calc/pricing.ts';
import { box, door, project, wall, window_ } from './helpers.ts';

const joints = (p: number[]) => p.slice(0, -1).map((_, i) => p.slice(0, i + 1).reduce((t, x) => t + x, 0));
const clear = (a: number[], b: number[]) => joints(a).every((j) => joints(b).every((c) => Math.abs(j - c) >= PLATE_JOINT_OFFSET - 1e-9));

test('R602.3.2: top plate joints sit at least 24" from the cap plate joints', () => {
  // One piece: no joints.
  assert.deepEqual(platePieces(180), { bottom: [180], top: [180], cap: [180] });
  for (const len of [200, 240, 300, 380, 384, 500, 700]) {
    const p = platePieces(len);
    const sum = (x: number[]) => x.reduce((t, y) => t + y, 0);
    for (const k of ['bottom', 'top', 'cap'] as const) {
      assert.ok(Math.abs(sum(p[k]) - len) < 1e-6, `${len} ${k} adds up`);
      assert.ok(p[k].every((x) => x <= 192 + 1e-9 && x > 0), `${len} ${k} fits stock`);
    }
    assert.ok(clear(p.top, p.cap), `${len}: joints offset`);
  }
  // A 20' wall: cap 2 × 120, top 144 + 96.
  assert.deepEqual(platePieces(240).top, [144, 96]);
  // A 32' wall can't shift (16' + 24" won't fit a board), so the top plate takes three pieces.
  assert.equal(platePieces(384).top.length, 3);
});

test('the wall cut pieces carry the offset top plate', () => {
  const p = project([wall(0, 0, 240, 0)]);
  const top = cutPieces(p).filter((x) => /top plate/.test(x.label)).map((x) => x.length);
  assert.deepEqual(top, [144, 96]);
});

test('pricing from the cut list replaces plate and header LF, and drops jacks / cripples from the stud count', () => {
  const walls = box(240, 144);
  const base = project(walls, [door(walls[0].id, 60), window_(walls[2].id, 120)]);
  const before = materialsList(base);
  assert.ok(before.some((l) => /^2x\d+ plate, 16'$/.test(l.item)));
  const on = { ...base, framing: { ...base.framing, cutListEstimate: true } };
  const after = materialsList(on);
  assert.equal(after.some((l) => /^2x\d+ plate, 16'$/.test(l.item)), false);
  assert.equal(after.some((l) => / header stock/.test(l.item)), false);
  // Board lines match the cut list exactly, and every one is priced.
  const boards = after.filter((l) => / board, \d+'$/.test(l.item));
  const groups = cutList(on);
  assert.equal(boards.reduce((t, l) => t + l.qty, 0), groups.reduce((t, g) => t + g.boards.length, 0));
  assert.ok(estimate(boards).lines.every((l) => l.unitPrice > 0));
  // Studs: fewer (jacks and cripples now come off boards).
  const studs = (ls: typeof before) => ls.filter((l) => / stud, /.test(l.item)).reduce((t, l) => t + l.qty, 0);
  assert.ok(studs(after) < studs(before));
});
