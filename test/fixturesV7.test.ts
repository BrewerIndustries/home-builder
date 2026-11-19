import assert from 'node:assert/strict';
import { test } from 'node:test';
import { doorLeaves } from '../src/calc/doors3d.ts';
import { frameWall } from '../src/calc/framing.ts';
import { basinCentres, basinReach, basinSpans, clearZones, furnitureChecks, furnitureLines, newFurniture } from '../src/calc/furniture.ts';
import { ircChecks } from '../src/calc/irc.ts';
import { materialsList } from '../src/calc/materials.ts';
import { buildScene } from '../src/calc/model3d.ts';
import { estimate } from '../src/calc/pricing.ts';
import { projectReducer } from '../src/model/store.ts';
import type { DoorOperation, FurnitureKind, Opening, Point, Project } from '../src/model/types.ts';
import { box, door, project, wall } from './helpers.ts';

const rect = (w: number, h: number): Point[] => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
function bath(w: number, h: number, items: [FurnitureKind, Point][] = []): Project {
  let p = project(box(w, h, 'interior'), [], { rooms: [{ id: 'R', name: 'Bath', type: 'bath', points: rect(w, h) }] });
  items.forEach(([kind, at], i) => {
    p = projectReducer(p, { type: 'addFurniture', item: newFurniture(p, kind, at, `f${i}`) });
  });
  return p;
}

test('a curbless walk-in shower: 24" clear in front of its open side, the P2708.1 size check unchanged', () => {
  const p = bath(120, 120);
  const s = { id: 's', kind: 'shower' as const, at: { x: 60, y: 60 }, rot: 0, w: 60, d: 36 };
  const cx = (pts: Point[]) => pts.reduce((t, q) => t + q.x, 0) / pts.length;
  const cy = (pts: Point[]) => pts.reduce((t, q) => t + q.y, 0) / pts.length;
  assert.ok(cy(clearZones({ ...s, walkIn: true })[0][1]) > 60 + 18);
  assert.ok(cx(clearZones({ ...s, walkIn: true, entry: 'left' })[0][1]) < 60 - 30);
  assert.ok(cx(clearZones({ ...s, walkIn: true, entry: 'right' })[0][1]) > 60 + 30);
  // Against the left wall with its open side to the left: blocked.
  const tight = { ...p, furniture: [{ ...s, at: { x: 2.25 + 30, y: 60 }, walkIn: true, entry: 'left' as const }] };
  const clear = (q: Project) => furnitureChecks(q).find((c) => c.rule.startsWith('Fixture clearances'))!;
  assert.equal(clear(tight).status, 'fail');
  assert.match(clear(tight).message, /walk-in/);
  assert.equal(clear({ ...tight, furniture: [{ ...tight.furniture[0], entry: 'right' }] }).status, 'pass');
  // P2708.1 still applies: 900 sq in and 30" each way.
  const size = (q: Project) => furnitureChecks(q).find((c) => c.section === 'P2708.1')!;
  assert.equal(size({ ...p, furniture: [{ ...s, walkIn: true, w: 28, d: 40 }] }).status, 'fail');
  assert.equal(size({ ...p, furniture: [{ ...s, walkIn: true }] }).status, 'pass');
});

test('a walk-in prices as its own line; a stall shower keeps the pan + door', () => {
  const p = bath(120, 120, [['shower', { x: 60, y: 30 }], ['shower', { x: 20, y: 90 }]]);
  const q = { ...p, furniture: [{ ...p.furniture[0], walkIn: true }, p.furniture[1]] };
  const lines = furnitureLines(q);
  const qty = (re: RegExp) => lines.find((l) => re.test(l.item))?.qty;
  assert.equal(qty(/^Curbless walk-in shower/), 1);
  assert.equal(qty(/^Shower pan \+ valve/), 1);
  assert.equal(qty(/^Plumbing rough-in/), 2);
  assert.equal(furnitureLines(p).find((l) => /^Curbless/.test(l.item)), undefined);
  assert.ok(estimate(lines).lines.every((l) => l.unitPrice > 0));
  // Flush in 3D.
  const shower = buildScene(q).boxes.filter((b) => b.kind === 'fixture').map((b) => b.size[1]).sort();
  assert.deepEqual(shower, [0.5, 4]);
});

function barnWall(hinge: 'a' | 'b') {
  const w = wall(0, 0, 240, 0, 'interior');
  const o: Opening = { ...door(w.id, 120), operation: 'barn', swing: { side: 1, hinge } };
  return { w, p: project([w], [o]) };
}

test("a barn door's slide gets solid blocking in the framing elevation and the takeoff", () => {
  const { w, p } = barnWall('a');
  const f = frameWall(w, p);
  const blocks = f.members.filter((m) => m.kind === 'blocking');
  assert.equal(blocks.length, 1);
  const [b] = blocks;
  // From a door width past the hinge-end jamb (102 − 36 = 66) to the header's end, at the header's height.
  assert.equal(b.x, 66);
  const header = f.members.find((m) => m.kind === 'header')!;
  assert.ok(Math.abs(b.x + b.w - header.x) < 1e-9);
  assert.equal(b.y, header.y);
  assert.equal(b.h, 3.5);
  // Slides the other way: on the other side of the door.
  const bw = barnWall('b');
  const other = frameWall(bw.w, bw.p).members.find((m) => m.kind === 'blocking')!;
  assert.ok(other.x > 120 && Math.abs(other.x + other.w - 174) < 1e-9);
  // Counted (and priced) in the materials list; a swing door gets none, and stud counts don't change.
  const line = materialsList(p).find((l) => l.item === 'Barn door track blocking, 2x4')!;
  assert.equal(line.qty, Math.ceil(b.w / 12));
  assert.ok(estimate([line]).lines[0].unitPrice > 0);
  const swing = project([w], [door(w.id, 120)]);
  assert.equal(frameWall(w, swing).members.filter((m) => m.kind === 'blocking').length, 0);
  assert.equal(materialsList(swing).find((l) => /blocking/.test(l.item)), undefined);
  assert.equal(frameWall(w, swing).common, f.common);
});

test('3D door leaves by operation', () => {
  const w = wall(0, 0, 240, 0, 'interior');
  const leaves = (operation: DoorOperation, width = 36) => doorLeaves(project([w], [{ ...door(w.id, 120, width), operation, swing: { side: 1, hinge: 'a' } }]), project([w], [{ ...door(w.id, 120, width), operation, swing: { side: 1, hinge: 'a' } }]).openings[0]);
  assert.equal(leaves('swing').length, 1);
  assert.equal(leaves('double', 60).length, 2);
  assert.equal(leaves('pocket').length, 1);
  assert.equal(leaves('bypass', 60).length, 2);
  assert.equal(leaves('bifold', 30).length, 2);
  assert.equal(leaves('bifold', 60).length, 4);
  assert.equal(leaves('barn').length, 2);
  assert.ok(leaves('swing').every((b) => b.kind === 'door'));
  // A swing leaf stands open square to the wall (along y), the door's width out, the door's height tall.
  const [s] = leaves('swing');
  assert.equal(Math.round(s.size[0]), 36);
  assert.equal(s.size[1], 80);
  assert.ok(Math.abs(Math.abs(Math.sin(s.rotY)) - 1) < 1e-9);
  // A pocket door sits in the wall line; a barn door slides on its face over the slide (66–102).
  const [pk] = leaves('pocket');
  assert.equal(pk.c[2], 0);
  const [slab, track] = leaves('barn');
  assert.ok(Math.abs(slab.c[0] - 84) < 1e-9 && Math.abs(slab.c[2]) > 2.25);
  assert.ok(Math.abs(track.size[0] - 72) < 1e-9 && track.c[1] > 80);
  // In the scene; a garage door stays an opening.
  assert.equal(buildScene(project([w], [door(w.id, 120)])).boxes.filter((b) => b.kind === 'door').length, 1);
  assert.equal(buildScene(project([w], [door(w.id, 120, 96, 84)])).boxes.filter((b) => b.kind === 'door').length, 0);
});

const reach = (p: Project) => ircChecks(p).filter((c) => c.rule.startsWith('Bathroom receptacle within 36'));

test('double vanity basins move, and each is checked from where it really is', () => {
  const p = bath(180, 96, [['lavatory', { x: 90, y: 10 }]]);
  const lav = { ...p.furniture[0], basins: 2 as const, w: 96 };
  // Unplaced: halves, as before.
  assert.deepEqual(basinCentres(lav), [-24, 24]);
  assert.deepEqual(basinSpans(lav), [[-48, 0], [0, 48]]);
  // Placed: each span is the basin's own bowl; kept on the top and a bowl apart.
  const moved = { ...lav, basinAt: [-36, 30] as [number, number] };
  assert.deepEqual(basinSpans(moved), [[-45, -27], [21, 39]]);
  assert.deepEqual(basinCentres({ ...lav, basinAt: [-60, 60] }), [-39, 39]);
  assert.deepEqual(basinCentres({ ...lav, basinAt: [5, 0] }), [-6.5, 11.5]);
  // A receptacle on the back wall 20" past the vanity's right end: the default right half is served; pull the right basin far left and it isn't.
  const top = p.walls.find((w) => w.a.y === 0 && w.b.y === 0)!;
  const along = (x: number) => (Math.min(top.a.x, top.b.x) === top.a.x ? x - top.a.x : top.a.x - x);
  const at = lav.at.x;
  let q: Project = { ...p, furniture: [lav], outlets: [{ id: 'o', wallId: top.id, offset: along(at + 48 + 20), side: 1, kind: 'gfci', height: 44, auto: false }] };
  if (!Number.isFinite(basinReach(q, lav)) || basinReach(q, lav) > 100) q = { ...q, outlets: [{ ...q.outlets[0], side: -1 }] };
  assert.deepEqual(reach(q).map((c) => c.status), ['fail', 'pass']);
  const far = { ...q, furniture: [{ ...lav, basinAt: [-40, -15] as [number, number] }] };
  assert.deepEqual(reach(far).map((c) => c.status), ['fail', 'fail']);
});
