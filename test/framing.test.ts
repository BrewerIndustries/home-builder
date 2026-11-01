import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frameWall, framingTakeoff, headerSizeFor, studLayout } from '../src/calc/framing.ts';
import { materialsList, studStock } from '../src/calc/materials.ts';
import { projectReducer, syncThickness } from '../src/model/store.ts';
import { box, door, project, wall, window_ } from './helpers.ts';

test('stud layout: 16" o.c. on a 12 ft wall is 10 studs', () => {
  // marks at 0.75, 16, 32 … 128, plus the end stud at 143.25
  const marks = studLayout(144, 16);
  assert.equal(marks.length, 10);
  assert.equal(marks[0], 0.75);
  assert.equal(marks.at(-1), 143.25);
});

test('plain wall: commons and plates', () => {
  const w = wall(0, 0, 144, 0);
  const f = frameWall(w, project([w]));
  assert.equal(f.common, 10);
  assert.equal(f.king + f.jack + f.cripple + f.corner, 0);
  assert.equal(f.plateLength, 144 * 3);
  assert.equal(f.studLength, 92.625);
});

test('door adds kings, jacks, a header and cripples; drops the studs it displaces', () => {
  const w = wall(0, 0, 144, 0);
  const f = frameWall(w, project([w], [door(w.id, 72)]));
  assert.equal(f.king, 2);
  assert.equal(f.jack, 2);
  assert.equal(f.headers.length, 1);
  assert.equal(f.headers[0].size, '2x8'); // 38" RO in a bearing wall
  assert.equal(f.headers[0].length, 41); // RO + one jack each side
  assert.ok(f.common < 10);
  // 82-1/2" RO + 7-1/4" header leaves 2-7/8" under a 92-5/8" stud → short cripples above.
  assert.ok(f.cripple >= 1);
});

test('wide openings get double jacks and bigger headers', () => {
  assert.equal(headerSizeFor(38, true), '2x8');
  assert.equal(headerSizeFor(74, true), '2x12');
  assert.equal(headerSizeFor(110, true), 'LVL');
  assert.equal(headerSizeFor(38, false), '2x4');
  const w = wall(0, 0, 240, 0);
  const f = frameWall(w, project([w], [door(w.id, 120, 72)]));
  assert.equal(f.jack, 4);
});

test('windows add sill plate and cripples below', () => {
  const w = wall(0, 0, 144, 0);
  const f = frameWall(w, project([w], [window_(w.id, 72)]));
  assert.equal(f.plateLength, 144 * 3 + 36.5);
  assert.ok(f.cripple >= 3);
});

test('corners are counted once per vertex', () => {
  const walls = box(240, 144);
  const t = framingTakeoff(project(walls));
  const corners = t.walls.reduce((s, f) => s + f.corner, 0);
  assert.equal(corners, 4); // one backer stud per corner → 3-stud corners
});

test('a wall teeing into another adds ladder backing to the through wall', () => {
  const walls = box(240, 144);
  const tee = wall(120, 0, 120, 144, 'interior');
  const t = framingTakeoff(project([...walls, tee]));
  const top = t.walls.find((f) => f.wallId === walls[0].id)!;
  const bottom = t.walls.find((f) => f.wallId === walls[2].id)!;
  assert.equal(top.corner - 1 >= 1 || top.corner >= 2, true);
  assert.ok(top.corner + bottom.corner >= 4);
});

test('drawing a room against the outline does not double the shared walls', () => {
  let p = project(box(240, 144));
  const inner = box(120, 144, 'interior'); // shares top, left, bottom with the outline
  p = projectReducer(p, { type: 'addWalls', walls: inner });
  assert.equal(p.walls.length, 4 + 1); // only the new partition at x = 120 is added
  assert.equal(p.walls.at(-1)!.kind, 'interior');
});

test('materials: studs bought as precuts, sheets from net area', () => {
  assert.equal(studStock(91.5), '92-5/8" precut');
  assert.equal(studStock(103.5), '104-5/8" precut');
  assert.equal(studStock(130), "12'");
  const walls = box(480, 360);
  const lines = materialsList(project(walls, [door(walls[0].id, 240)]));
  const osb = lines.find((l) => l.item.includes('OSB'))!;
  // 140 ft perimeter × 97-1/8" = 1133.1 sq ft − 20 sq ft door = 1113.1, +10% → 1224.4 / 32 = 38.3
  assert.equal(osb.qty, 39);
  assert.ok(lines.some((l) => l.item === 'Door 3068'));
});

test('per-wall stud size overrides the default and drives thickness', () => {
  const w = { ...wall(0, 0, 144, 0, 'interior'), stud: '2x6' as const };
  const f = frameWall(w, project([w]));
  assert.equal(f.studSize, '2x6');
  let p = project([wall(0, 0, 144, 0, 'interior')]);
  p = projectReducer(p, { type: 'updateWall', id: p.walls[0].id, patch: { stud: '2x8' } });
  p = syncThickness(p);
  assert.equal(p.walls[0].thickness, 8.25);
});
