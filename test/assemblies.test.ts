import assert from 'node:assert/strict';
import { test } from 'node:test';
import { roomClearSizes, wallDimLabels } from '../src/calc/faces.ts';
import { materialsList } from '../src/calc/materials.ts';
import { layerTakeoff } from '../src/calc/assemblyTakeoff.ts';
import { assemblyFor, assemblyThickness, DEFAULT_ASSEMBLIES, inchText, LEGACY_ASSEMBLIES, newProject } from '../src/model/assembly.ts';
import { historyReducer, initHistory, migrate } from '../src/model/store.ts';
import type { Project, WallLayer } from '../src/model/types.ts';
import { box, door, project, wall } from './helpers.ts';

const line = (p: Project, re: RegExp) => materialsList(p).find((l) => re.test(l.item));
const load = (p: Project) => historyReducer(initHistory(p), { type: 'load', project: p }).present;

test('old projects (no assembly data) keep the "+1 inch" thickness: 2x6 exterior 6-1/2", 2x4 interior 4-1/2"', () => {
  const old = project([...box(240, 144), wall(120, 0, 120, 144, 'interior')]);
  const p = load(migrate(old));
  assert.equal(p.assemblies, undefined);
  assert.equal(assemblyFor(p, p.walls[0]), LEGACY_ASSEMBLIES.exterior);
  assert.deepEqual(p.walls.map((w) => w.thickness), [6.5, 6.5, 6.5, 6.5, 4.5]);
  // Same estimate lines as before assemblies: 7/16" OSB outside, 1/2" drywall.
  assert.ok(line(p, /^7\/16" OSB wall sheathing/));
  assert.ok(line(p, /^1\/2" drywall, 4×8$/));
  assert.equal(line(p, /siding/), undefined);
});

test('new projects use the presets: drywall | studs | OSB | lap siding outside, drywall both sides inside', () => {
  const p = load({ ...newProject('t'), walls: [...box(240, 144), wall(120, 0, 120, 144, 'interior')] });
  // 1/2 + 5-1/2 + 7/16 + 5/16 = 6-3/4"; 1/2 + 3-1/2 + 1/2 = 4-1/2".
  assert.equal(p.walls[0].thickness, 6.75);
  assert.equal(p.walls[4].thickness, 4.5);
  assert.equal(inchText(6.75), '6-3/4"');
  // Outside dims grow by the siding; inside room sizes follow the finished faces.
  const top = p.walls[0];
  const out = wallDimLabels(p, 'outside').filter((l) => l.wall.id === top.id).map((l) => l.length);
  assert.deepEqual(out, [240 + 6.75]);
  const r = { id: 'r', name: 'R', type: 'bedroom' as const, points: [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 144 }, { x: 0, y: 144 }] };
  assert.deepEqual(roomClearSizes(p, r).map((s) => [s.width, s.depth]), [[120 - 6.75 / 2 - 4.5 / 2, 144 - 6.75]]);
  // Framing faces: the studs alone.
  const framed = { ...p, dimFaces: 'framing' as const };
  assert.deepEqual(roomClearSizes(framed, r).map((s) => [s.width, s.depth]), [[120 - 2.75 - 1.75, 144 - 5.5]]);
});

test('a wall can carry its own layers; thickness and the estimate follow them', () => {
  const p0 = { ...newProject('t'), walls: box(240, 144) };
  const stucco: WallLayer[] = [{ kind: 'drywall', thickness: 0.625 }, { kind: 'stud', thickness: 0 }, { kind: 'foam', thickness: 1, name: 'rigid foam' }, { kind: 'siding', thickness: 0.875, name: 'three-coat stucco' }];
  let h = historyReducer(initHistory(p0), { type: 'load', project: p0 });
  h = historyReducer(h, { type: 'updateWall', id: p0.walls[0].id, patch: { assembly: stucco } });
  const w = h.present.walls[0];
  assert.equal(w.thickness, 0.625 + 5.5 + 1 + 0.875);
  assert.equal(assemblyThickness(h.present, w), w.thickness);
  const items = materialsList(h.present).map((l) => l.item);
  assert.ok(items.includes('5/8" drywall, 4×8'));
  assert.ok(items.includes('1" rigid foam board, 4×8'));
  assert.ok(items.includes('7/8" three-coat stucco siding'));
  // Back to the project default.
  h = historyReducer(h, { type: 'updateWall', id: w.id, patch: { assembly: undefined } });
  assert.equal(h.present.walls[0].thickness, 6.75);
  // Changing the project default re-thicknesses every default wall.
  h = historyReducer(h, { type: 'setAssemblies', assemblies: { ...DEFAULT_ASSEMBLIES, exterior: LEGACY_ASSEMBLIES.exterior } });
  assert.deepEqual(h.present.walls.map((x) => x.thickness), [6.5, 6.5, 6.5, 6.5]);
});

test('estimate areas: drywall on both sides of partitions, one side outside; sheathing and siding net of openings', () => {
  const walls = [...box(240, 144), wall(120, 0, 120, 144, 'interior')];
  const p = { ...newProject('t'), walls, openings: [door(walls[0].id, 60)] };
  const h = 97.125;
  const ext = ((2 * (240 + 144)) * h - 36 * 80) / 144;
  const int = (144 * h) / 144;
  const t = layerTakeoff(p);
  const area = (kind: string) => t.filter((l) => l.kind === kind).reduce((s, l) => s + l.sqft, 0);
  assert.ok(Math.abs(area('drywall') - (ext + 2 * int)) < 1e-6);
  assert.ok(Math.abs(area('sheathing') - ext) < 1e-6);
  assert.ok(Math.abs(area('siding') - ext) < 1e-6);
  const siding = line(p, /fiber-cement lap siding/)!;
  assert.equal(siding.unit, 'squares');
  assert.equal(siding.qty, Math.ceil((ext * 1.1) / 100));
  assert.equal(siding.category, 'Siding');
});
