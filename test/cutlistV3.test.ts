import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cutList, cutListCsv, cutPieces, floorCutPieces, fullCutList, KEEP_OFFCUT, keptOffcuts, PLATE_JOINT_OFFSET, plateJoints, platePieces, plateStuds, roofCutPieces } from '../src/calc/cutlist.ts';
import { frameWall } from '../src/calc/framing.ts';
import { floorLayout } from '../src/calc/floor.ts';
import { materialsList } from '../src/calc/materials.ts';
import { roofCalc, roofEdges } from '../src/calc/roof.ts';
import { DEFAULT_FOUNDATION, DEFAULT_ROOF, type Roof } from '../src/model/types.ts';
import { box, door, project, wall } from './helpers.ts';

const sum = (x: number[]) => x.reduce((t, y) => t + y, 0);
const on = (studs: number[], j: number) => studs.some((s) => Math.abs(s - j) < 1e-6);

test('plate joints land on stud centres, within stock, top offset ≥ 24" from the cap', () => {
  for (const len of [200, 240, 300, 384, 500, 700]) {
    for (const spacing of [16, 24] as const) {
      const w = wall(0, 0, len, 0);
      const p = project([w], [], {});
      const f = frameWall(w, { ...p, framing: { ...p.framing, studSpacing: spacing } });
      const studs = plateStuds(f);
      const pl = platePieces(len, undefined, studs);
      for (const k of ['bottom', 'top', 'cap'] as const) {
        assert.ok(Math.abs(sum(pl[k]) - len) < 1e-6, `${len}/${spacing} ${k} adds up`);
        assert.ok(pl[k].every((x) => x > 0 && x <= 192 + 1e-9), `${len}/${spacing} ${k} fits stock`);
        assert.ok(plateJoints(pl[k]).every((j) => on(studs, j)), `${len}/${spacing} ${k} joints on studs`);
      }
      assert.ok(plateJoints(pl.top).every((j) => plateJoints(pl.cap).every((c) => Math.abs(j - c) >= PLATE_JOINT_OFFSET - 1e-9)), `${len}/${spacing} offset`);
    }
  }
});

test('joints skip an opening: no full-height stud inside it to land on', () => {
  const w = wall(0, 0, 240, 0);
  const p = project([w], [door(w.id, 120, 72)]);
  const f = frameWall(w, p);
  const pl = platePieces(240, undefined, plateStuds(f));
  const [s, e] = [120 - 37, 120 + 37];
  for (const j of [...plateJoints(pl.cap), ...plateJoints(pl.top)]) assert.ok(j <= s || j >= e, `joint ${j} outside the door`);
  // cutPieces uses the same stud-landed split.
  const caps = cutPieces(p).filter((x) => /W1 cap plate/.test(x.label)).map((x) => x.length);
  assert.deepEqual(caps, pl.cap);
});

const rafters = (r: Partial<Roof> = {}) => project(box(480, 360), [], { roof: { ...DEFAULT_ROOF, framing: 'rafters', ...r } });

test('roof members: rafters, ridge, ceiling joists and fascia (trusses: fascia only)', () => {
  const p = rafters();
  const pieces = roofCutPieces(p);
  const c = roofCalc(p)!;
  const n = (re: RegExp) => pieces.filter((x) => re.test(x.label));
  assert.ok(n(/^rafter$/).length > 0 && n(/^rafter$/).every((x) => Math.abs(x.length - c.rafterLength) < 1e-6 && x.size === '2x8'));
  assert.ok(Math.abs(sum(n(/^ridge/).map((x) => x.length)) - c.ridgeLength) < 1e-6);
  assert.ok(n(/^ridge/).every((x) => x.size === '2x10' && x.length <= 192 + 1e-9));
  assert.ok(n(/ceiling joist/).length > 0);
  const fascia = n(/^fascia/);
  assert.ok(Math.abs(sum(fascia.map((x) => x.length)) - sum(roofEdges(c).map((e) => e.length))) < 1e-6);
  assert.ok(fascia.every((x) => x.size === '2x6' && x.length <= 192 + 1e-9));
  // Trusses come made; only the fascia is cut.
  const t = roofCutPieces(project(box(480, 360), [], { roof: DEFAULT_ROOF }));
  assert.ok(t.length > 0 && t.every((x) => /^fascia/.test(x.label)));
  // Hip roofs: four hip rafters.
  assert.equal(roofCutPieces(rafters({ type: 'hip' })).filter((x) => /hip rafter/.test(x.label)).length, 4);
  assert.equal(roofCutPieces(project(box(480, 360), [], { roof: { ...DEFAULT_ROOF, type: 'none' } })).length, 0);
});

test('floor members: rim by edge and a block per bay over each girder', () => {
  const p = project(box(480, 360), [], { foundation: { ...DEFAULT_FOUNDATION, type: 'crawl' } });
  const L = floorLayout(p)!;
  const pieces = floorCutPieces(p);
  const rim = pieces.filter((x) => /^rim/.test(x.label));
  assert.ok(Math.abs(sum(rim.map((x) => x.length)) - L.rimLength) < 1e-6);
  assert.ok(rim.every((x) => x.length <= 192 + 1e-9));
  const blocks = pieces.filter((x) => /block$/.test(x.label));
  assert.ok(blocks.length > 0 && blocks.every((x) => x.length === 16 - 1.5));
  assert.equal(floorCutPieces(project(box(480, 360))).length, 0); // slab
});

test('full cut list: walls, roof and floor sections; pricing still uses the walls only', () => {
  const p = project(box(480, 360), [], { roof: { ...DEFAULT_ROOF, framing: 'rafters' }, foundation: { ...DEFAULT_FOUNDATION, type: 'crawl' } });
  const groups = fullCutList(p);
  assert.deepEqual([...new Set(groups.map((g) => g.section))], ['Walls', 'Roof', 'Floor']);
  assert.deepEqual(cutList(p), groups.filter((g) => g.section === 'Walls'));
  const priced = materialsList({ ...p, framing: { ...p.framing, cutListEstimate: true } }).filter((l) => /^2x\d+ board, \d+'$/.test(l.item));
  assert.equal(sum(priced.map((l) => l.qty)), cutList(p).reduce((t, g) => t + g.boards.length, 0));
  const csv = cutListCsv(groups, (n) => `${n}`);
  assert.ok(csv.includes('\nRoof,') && csv.includes('\nFloor,'));
});

test('kept offcuts: every board offcut ≥ KEEP_OFFCUT, longest first within a size', () => {
  const p = project(box(480, 360), [], { roof: { ...DEFAULT_ROOF, framing: 'rafters' } });
  const groups = fullCutList(p);
  const kept = keptOffcuts(groups);
  assert.equal(kept.length, groups.reduce((t, g) => t + g.keep, 0));
  assert.ok(kept.every((k) => k.length >= KEEP_OFFCUT));
  for (let i = 1; i < kept.length; i++) if (kept[i].size === kept[i - 1].size) assert.ok(kept[i].length <= kept[i - 1].length);
});
