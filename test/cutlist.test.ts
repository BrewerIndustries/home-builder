import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cutList, cutListCsv, cutPieces, KERF, packBoards, STOCK } from '../src/calc/cutlist.ts';
import { frameWall } from '../src/calc/framing.ts';
import { box, door, project, wall, window_ } from './helpers.ts';

const ft = (n: number) => `${n}"`;

test('plates longer than 16\' split into equal pieces; short walls give one piece each', () => {
  const p = project([wall(0, 0, 240, 0), wall(240, 0, 240, 120)]);
  const pieces = cutPieces(p);
  const w1 = pieces.filter((x) => x.label.startsWith('W1 '));
  assert.equal(w1.length, 6);
  assert.ok(w1.every((x) => x.length === 120));
  assert.deepEqual(w1.map((x) => x.label).slice(0, 2), ['W1 bottom plate 1/2', 'W1 bottom plate 2/2']);
  assert.deepEqual(pieces.filter((x) => x.label.startsWith('W2 ')).map((x) => x.length), [120, 120, 120]);
});

test('jacks, cripples, sills and header plies are cut pieces; full-height studs are not', () => {
  const w = wall(0, 0, 144, 0);
  const p = project([w], [door(w.id, 36), window_(w.id, 104)]);
  const f = frameWall(w, p);
  const pieces = cutPieces(p);
  const count = (re: RegExp) => pieces.filter((x) => re.test(x.label)).length;
  assert.equal(count(/jack$/), f.jack);
  assert.equal(count(/cripple$/), f.cripple);
  assert.equal(count(/sill$/), 1);
  assert.equal(count(/header$/), f.headers.reduce((t, h) => t + h.plies, 0));
  assert.equal(count(/common|king|corner/), 0);
  // Headers are grouped under their own size.
  assert.ok(pieces.filter((x) => /header$/.test(x.label)).every((x) => x.size === f.headers[0].size));
});

test('first-fit decreasing packs onto 16\' boards and trims each to the shortest stock that holds it', () => {
  const piece = (length: number) => ({ size: '2x4', length, label: 'x' });
  // 100 + 90 doesn't fit 192 with a kerf? 190.125 ≤ 192: one board, 16'.
  let b = packBoards([piece(100), piece(90)]);
  assert.equal(b.length, 1);
  assert.equal(b[0].stock, 192);
  assert.ok(Math.abs(b[0].offcut - (192 - 190 - KERF)) < 1e-9);
  // 100 + 92: 192.125 > 192 — two boards; the 92 goes on an 8'.
  b = packBoards([piece(100), piece(92)]);
  assert.deepEqual(b.map((x) => x.stock), [120, 96]);
  // An exact 16' piece takes a whole board with no kerf.
  assert.deepEqual(packBoards([piece(192)]).map((x) => [x.stock, x.offcut]), [[192, 0]]);
  // Many short pieces share boards.
  b = packBoards(Array.from({ length: 12 }, () => piece(30)));
  assert.equal(b.length, 2);
  assert.ok(b.every((x) => STOCK.includes(x.stock)));
  // A piece longer than 16' gets a 20' board.
  assert.deepEqual(packBoards([piece(200)]).map((x) => x.stock), [240]);
});

test('the cut list groups by size, counts boards per stock length and reports waste', () => {
  const walls = box(240, 144);
  const p = project(walls, [door(walls[0].id, 60), window_(walls[2].id, 120)]);
  const groups = cutList(p);
  assert.deepEqual(groups.map((g) => g.size).sort(), [...new Set(cutPieces(p).map((x) => x.size))].sort());
  for (const g of groups) {
    assert.equal(g.boards.reduce((t, b) => t + b.cuts.length, 0), g.pieces);
    assert.equal(g.byStock.reduce((t, s) => t + s.n, 0), g.boards.length);
    assert.equal(g.stockLength, g.boards.reduce((t, b) => t + b.stock, 0));
    assert.ok(g.wastePct >= 0 && g.wastePct < 50);
    // Every board holds its cuts.
    for (const b of g.boards) assert.ok(b.cuts.reduce((t, c) => t + c.length, 0) + KERF * (b.cuts.length - 1) <= b.stock + 1e-9);
  }
  const csv = cutListCsv(groups, ft);
  assert.match(csv.split('\n')[0], /^Size,Board,Stock,Cut,Length,Offcut$/);
  assert.equal(csv.trim().split('\n').length - 1, cutPieces(p).length);
  assert.equal(cutList(project([])).length, 0);
});
