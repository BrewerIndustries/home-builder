import assert from 'node:assert/strict';
import { test } from 'node:test';
import { roofCutPieces } from '../src/calc/cutlist.ts';
import { ircChecks } from '../src/calc/irc.ts';
import { materialsList } from '../src/calc/materials.ts';
import { buildScene } from '../src/calc/model3d.ts';
import { estimate } from '../src/calc/pricing.ts';
import { footprintRects, rectUnion, roofCalc, roofFaces, roofLines, roofPlan, ventPlan } from '../src/calc/roof.ts';
import { pointBounds } from '../src/calc/sheet.ts';
import { DEFAULT_ROOF, type Dormer, type Roof } from '../src/model/types.ts';
import { box, project, wall } from './helpers.ts';

const near = (a: number, b: number, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);
const poly = (pts: number[][]) => pts.map((p, i) => wall(p[0], p[1], pts[(i + 1) % pts.length][0], pts[(i + 1) % pts.length][1]));
// L: a 40' × 24' main block, a 20' wide wing running 20' down from its left end. 2x6 walls: 3.25" half-thickness.
const Lplan = (roof: Partial<Roof> = {}) => project(poly([[0, 0], [480, 0], [480, 288], [240, 288], [240, 528], [0, 528]]), [], { roof: { ...DEFAULT_ROOF, ...roof } });
// T: a 50' × 24' bar, a 20' stem centred under it.
const Tplan = (roof: Partial<Roof> = {}) =>
  project(poly([[0, 0], [600, 0], [600, 288], [420, 288], [420, 528], [180, 528], [180, 288], [0, 288]]), [], { roof: { ...DEFAULT_ROOF, ...roof } });

test('outline splits into rectangles, largest first', () => {
  assert.deepEqual(footprintRects(Lplan()), [
    { x0: 0, x1: 480, y0: 0, y1: 288 },
    { x0: 0, x1: 240, y0: 288, y1: 528 },
  ]);
  assert.equal(footprintRects(project(box(480, 360)))!.length, 1);
  // An angled wall: no split (v1 box roof).
  assert.equal(footprintRects(project([wall(0, 0, 100, 0), wall(100, 0, 50, 80), wall(50, 80, 0, 0)])), null);
  near(rectUnion([{ x0: 0, x1: 10, y0: 0, y1: 10 }, { x0: 5, x1: 15, y0: 0, y1: 10 }]).area, 150);
});

test('L plan: a wing off the main eave side, two valleys, the eave cut', () => {
  const c = roofCalc(Lplan())!;
  assert.equal(c.wings.length, 2);
  const [main, wing] = c.wings;
  assert.equal(main.alongX, true);
  assert.equal(wing.alongX, false);
  assert.equal(wing.side, 's');
  assert.equal(wing.valleys, true);
  near(wing.W, 246.5);
  near(wing.L, 240); // from the main wall face (y 291.25) to the wing's end (531.25)
  // Valleys: eave to ridge at equal pitch, run = half span + overhang on both axes.
  const run = 246.5 / 2 + 12;
  near(c.valleyLength, 2 * run * Math.sqrt(2 + 0.25));
  assert.equal(c.valleys, 2);
  // The wing ridge runs in half its span past the main wall; its gable end adds the rake.
  near(wing.ridgeLength, 240 + 12 + 246.5 / 2);
  // The main roof's south eave is cut by the wing plus its two overhangs.
  near(main.eaves.s!, 486.5 + 24 - (246.5 + 24));
  // Area: the overhung outline × slope factor, less than the v1 box roof.
  const box1 = roofCalc(Lplan({ perWing: false }))!;
  assert.equal(box1.wings.length, 1);
  assert.ok(c.area < box1.area);
  near(c.area, rectUnion([expandAll(main.rect, 12, 12), { x0: wing.rect.x0 - 12, x1: wing.rect.x1 + 12, y0: wing.rect.y0, y1: wing.rect.y1 + 12 }]).area * c.k);
  near(c.footprint, 486.5 * 294.5 + 246.5 * 240);
});

function expandAll(r: { x0: number; x1: number; y0: number; y1: number }, along: number, across: number) {
  return { x0: r.x0 - along, x1: r.x1 + along, y0: r.y0 - across, y1: r.y1 + across };
}

test('T plan, hip roof: the stem gets a hip end and two valleys', () => {
  const c = roofCalc(Tplan({ type: 'hip' }))!;
  assert.equal(c.wings.length, 2);
  assert.deepEqual(c.wings[1].ends, ['open', 'hip']);
  assert.equal(c.hips, 6);
  assert.equal(c.valleys, 2);
  const plan = roofPlan(Tplan({ type: 'hip' }))!;
  assert.equal(plan.valleys.length, 2);
  assert.equal(plan.hips.length, 6);
  assert.equal(plan.ridges.length, 2);
  // Valleys are at 45° in plan (equal pitch).
  for (const [a, b] of plan.valleys) near(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
});

test('a wing off a gable end butts the gable wall: no valleys', () => {
  // Main 40' × 24' (ridge along x), a 16'-wide, 12'-deep wing off the right gable wall.
  const p = project(poly([[0, 0], [480, 0], [480, 72], [624, 72], [624, 264], [480, 264], [480, 288], [0, 288]]), [], { roof: DEFAULT_ROOF });
  const c = roofCalc(p)!;
  assert.equal(c.wings[1].side, 'e');
  assert.equal(c.wings[1].valleys, false);
  assert.equal(c.valleys, 0);
  assert.deepEqual(c.wings[1].ends, ['butt', 'gable']);
});

test('rectangle and shed roofs are unchanged from v1', () => {
  const c = roofCalc(project(box(480, 360), [], { roof: DEFAULT_ROOF }))!;
  near(c.area, (486.5 + 24) * (366.5 + 24) * Math.sqrt(1.25));
  assert.equal(c.valleys, 0);
  const shed = roofCalc(Lplan({ type: 'shed', pitch: 2 }))!;
  assert.equal(shed.wings.length, 1);
});

test('3D: each wing gets its faces; the L has 2 + 2 main, 2 + 1 wing', () => {
  const faces = roofFaces(Lplan());
  assert.equal(faces.filter((f) => f.kind === 'roof').length, 4);
  assert.equal(faces.filter((f) => f.kind === 'gable').length, 3);
  assert.ok(buildScene(Lplan()).faces.some((f) => f.roofPart));
});

const withDormers = (dormers: Dormer[], framing: Roof['framing'] = 'rafters') => project(box(480, 360), [], { roof: { ...DEFAULT_ROOF, framing, dormers } });
const gableD: Dormer = { id: 'g', type: 'gable', side: 'a', at: 120, width: 60, height: 36, setback: 24, pitch: 8 };
const shedD: Dormer = { id: 's', type: 'shed', side: 'b', at: 300, width: 144, height: 36, setback: 24, pitch: 2 };

test('dormers: geometry and their own takeoff', () => {
  const base = roofCalc(withDormers([]))!;
  const c = roofCalc(withDormers([gableD, shedD]))!;
  assert.equal(c.dormers.length, 2);
  const [g, s] = c.dormers;
  // Gable dormer: cheek walls run back until the main roof reaches the dormer plate.
  near(g.depth, 36 / 0.5);
  near(g.cheekArea, 36 * 72);
  near(g.frontArea, 60 * 36 + (60 * 30 * (8 / 12)) / 2);
  assert.equal(g.valleys, 2);
  // Shed dormer: its flatter roof meets the main roof where the rises match.
  near(s.depth, 36 / (0.5 - 2 / 12));
  near(s.roofArea, 144 * s.depth * Math.sqrt(1 + (2 / 12) ** 2));
  near(s.hiddenArea, 144 * s.depth * Math.sqrt(1.25));
  near(c.area, base.area + g.roofArea - g.hiddenArea + s.roofArea - s.hiddenArea);
  assert.equal(c.valleys, 2);
  assert.equal(roofFaces(withDormers([gableD, shedD])).length, roofFaces(withDormers([])).length + g.faces.length + s.faces.length);
  const lines = roofLines(withDormers([gableD, shedD]), 0.1);
  for (const re of [/dormer rafter/, /dormer wall stud/, /dormer wall sheathing/, /^Step flashing/, /valley rafter/, /^Ice & water/]) assert.ok(lines.some((l) => re.test(l.item)), `${re}`);
  assert.ok(roofCutPieces(withDormers([gableD])).some((p) => /dormer 1 rafter/.test(p.label)));
  assert.ok(roofPlan(withDormers([gableD]))!.dormers[0].ridge);
});

test('dormers that cannot work are flagged', () => {
  const steep = roofCalc(withDormers([{ ...shedD, pitch: 8 }]))!;
  assert.equal(steep.dormers.length, 0);
  assert.ok(steep.notes.some((n) => /flatter/.test(n)));
  const tall = roofCalc(withDormers([{ ...gableD, height: 96 }]))!;
  assert.ok(tall.notes.some((n) => /past the main ridge/.test(n)));
  assert.ok(ircChecks(withDormers([{ ...gableD, height: 96 }])).some((x) => x.rule === 'Roof' && x.status === 'warn'));
});

test('R806.2 attic ventilation: 1/150, or 1/300 when the user says the exception is met; vents priced', () => {
  const p = project(box(480, 360), [], { roof: DEFAULT_ROOF });
  const c = roofCalc(p)!;
  near(c.vent.atticArea, 486.5 * 366.5);
  near(c.vent.required, (486.5 * 366.5) / 150);
  near(c.vent.exhaust + c.vent.intake, c.vent.required);
  const c300 = roofCalc(project(box(480, 360), [], { roof: { ...DEFAULT_ROOF, vent300: true } }))!;
  near(c300.vent.required, c.vent.required / 2);
  const vp = ventPlan(c);
  assert.ok(vp.provided >= c.vent.required - 1e-6);
  const lines = materialsList(p).filter((l) => /vent/i.test(l.item));
  assert.ok(lines.some((l) => /^Ridge vent/.test(l.item)));
  assert.ok(estimate(lines).lines.every((l) => l.unitPrice > 0));
  // A hip roof on a square plan has no ridge: louvers instead.
  const sq = roofCalc(project(box(360, 360), [], { roof: { ...DEFAULT_ROOF, type: 'hip' } }))!;
  assert.ok(ventPlan(sq).louvers > 0);
  // No overhang: edge intake vents.
  const flush = project(box(480, 360), [], { roof: { ...DEFAULT_ROOF, overhang: 0 } });
  assert.ok(roofLines(flush, 0.1).some((l) => /^Edge intake vent/.test(l.item)));
  const check = ircChecks(p).find((x) => x.section === 'R806.2');
  assert.equal(check?.status, 'pass');
  assert.equal(ircChecks(project(box(480, 360), [], { roof: { ...DEFAULT_ROOF, vent300: true } })).find((x) => x.section === 'R806.2')?.status, 'warn');
});

test('every roof line on an L with rafters and dormers has a sample price', () => {
  const p = project(Lplan().walls, [], { roof: { ...DEFAULT_ROOF, framing: 'rafters', dormers: [gableD] } });
  assert.ok(estimate(roofLines(p, 0.1)).lines.every((l) => l.unitPrice > 0));
  const t = project(Lplan().walls, [], { roof: { ...DEFAULT_ROOF, dormers: [gableD] } });
  assert.ok(estimate(roofLines(t, 0.1)).lines.every((l) => l.unitPrice > 0));
  assert.ok(roofLines(t, 0.1).some((l) => /^Valley truss set/.test(l.item)));
});

test('roof plan sheet bounds cover the overhung outline', () => {
  const plan = roofPlan(Lplan())!;
  const b = pointBounds(plan.outline.flat());
  near(b.x, -3.25 - 12);
  near(b.w, 486.5 + 24);
  near(b.h, 531.25 + 12 + 3.25 + 12);
});
