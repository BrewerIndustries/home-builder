import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frameWall, pocketSpan, roughOpening, roughOpeningSpan } from '../src/calc/framing.ts';
import { doorSweeps, fixtureSchedule, furnitureChecks, furnitureLines, newFurniture, pocketChecks, showerArea } from '../src/calc/furniture.ts';
import { materialsList } from '../src/calc/materials.ts';
import { estimate } from '../src/calc/pricing.ts';
import type { Furniture, Opening, Project } from '../src/model/types.ts';
import { box, door, project, wall } from './helpers.ts';

const one = (o: Partial<Opening>, extra: Partial<Project> = {}) => {
  const w = wall(0, 0, 240, 0, 'interior');
  return { p: project([w], [{ ...door(w.id, 120, 30), ...o }], extra), w };
};

test('a pocket door is framed over the door and its pocket: one header, no studs in the pocket', () => {
  const { p, w } = one({ operation: 'pocket', swing: { side: 1, hinge: 'a' } });
  const o = p.openings[0];
  assert.deepEqual(pocketSpan(o), [75, 105]);
  assert.deepEqual(roughOpening(o), { width: 62, height: 82.5 });
  assert.deepEqual(roughOpeningSpan(o), [74, 136]);
  const f = frameWall(w, p);
  assert.deepEqual(f.openings.map((r) => [r.x, r.w]), [[74, 62]]);
  // No full-height stud anywhere in the rough opening (the pocket included).
  const studs = f.members.filter((m) => m.kind === 'common' || m.kind === 'king' || m.kind === 'jack');
  assert.ok(studs.every((m) => m.x + m.w <= 74 + 1e-9 || m.x >= 136 - 1e-9));
  assert.ok(f.members.some((m) => m.kind === 'header' && Math.abs(m.w - 65) < 1e-9));
  assert.ok(f.notes.some((n) => /pocket door at 120": rough opening 62" over the door and its pocket/.test(n)));
  // Hinge at b: the pocket's the other side.
  assert.deepEqual(roughOpeningSpan({ ...o, swing: { side: 1, hinge: 'b' } }), [104, 166]);
  // A plain door is unchanged.
  assert.deepEqual(roughOpeningSpan({ ...o, operation: undefined }), [104, 136]);
});

test('bypass and barn doors: no swing; a barn door needs its slide clear on its face', () => {
  const bypass = one({ operation: 'bypass' }).p;
  assert.deepEqual(doorSweeps(bypass, bypass.openings[0]), []);
  const outlet = (side: 1 | -1) => ({ id: 'o', wallId: '', offset: 90, side, kind: 'duplex' as const, height: 16, auto: false });
  const barn = (side: 1 | -1) => {
    const { p, w } = one({ operation: 'barn', swing: { side: 1, hinge: 'a' } });
    return { ...p, outlets: [{ ...outlet(side), wallId: w.id }] };
  };
  assert.deepEqual(doorSweeps(barn(1), barn(1).openings[0]), []);
  const hit = pocketChecks(barn(1))[0];
  assert.deepEqual([hit.rule, hit.status], ['Barn door slide clear', 'warn']);
  assert.match(hit.message, /its slide runs into a receptacle — slide it the other way/);
  // A receptacle on the other face isn't in the way of a barn door (it would be in a pocket).
  assert.equal(pocketChecks(barn(-1))[0].status, 'pass');
  const back = barn(-1);
  const pocket = { ...back, openings: back.openings.map((o) => ({ ...o, operation: 'pocket' as const })) };
  assert.equal(pocketChecks(pocket)[0].status, 'warn');
  // Hardware in the estimate.
  const item = (p: Project, name: string) => materialsList(p).find((l) => l.item === name)?.qty ?? 0;
  assert.equal(item(barn(1), 'Barn door track + hardware (allowance)'), 1);
  assert.equal(item(bypass, 'Bypass door track + hardware (allowance)'), 1);
  assert.ok(estimate(materialsList(barn(1)).filter((l) => /track/.test(l.item))).lines.every((l) => l.unitPrice > 0));
});

const fx = (kind: Furniture['kind'], w: number, d: number): Furniture => ({ id: kind, kind, at: { x: 100, y: 100 }, rot: 0, w, d });

test('corner and neo-angle showers: P2708.1 on the real floor area, 24" in front of the opening, a shower for R306.1', () => {
  assert.equal(showerArea(fx('neo-shower', 38, 38)), 38 * 38 - 98);
  assert.equal(showerArea(fx('corner-shower', 36, 36)), 1296);
  const size = (f: Furniture) => furnitureChecks(project(box(240, 240), [], { furniture: [f] })).find((c) => c.section === 'P2708.1')!;
  assert.deepEqual([size(fx('neo-shower', 38, 38)).status, size(fx('neo-shower', 38, 38)).message], ['pass', `neo-angle shower: 3' 2" × 3' 2" less the 1' 2" angled corner = 1346 sq in`]);
  // A 32" neo-angle is 1024 − 98 = 926: still fine; a 30" one is 802: too small though 30" each way.
  assert.equal(size(fx('neo-shower', 32, 32)).status, 'pass');
  assert.equal(size(fx('neo-shower', 30, 30)).status, 'fail');
  assert.equal(size(fx('corner-shower', 36, 36)).status, 'pass');
  // R306.1 counts either as the shower.
  const req = furnitureChecks(project(box(240, 240), [], { furniture: [fx('toilet', 20, 28), fx('lavatory', 30, 21), fx('corner-shower', 36, 36)] })).find((c) => c.section === 'R306.1')!;
  assert.equal(req.status, 'pass');
  // The neo-angle's clear space sits off its diagonal, out past the front-left corner.
  const clear = (extra: Furniture[]) => furnitureChecks(project(box(400, 400), [], { furniture: [{ ...fx('neo-shower', 38, 38), at: { x: 200, y: 200 } }, ...extra] })).find((c) => c.rule.startsWith('Fixture clearances'))!;
  assert.equal(clear([]).status, 'pass');
  assert.equal(clear([{ ...fx('water-heater', 20, 20), id: 'wh', at: { x: 178, y: 228 } }]).status, 'fail');
  assert.equal(clear([{ ...fx('water-heater', 20, 20), id: 'wh', at: { x: 240, y: 240 } }]).status, 'pass');
  // Scheduled as SH, priced.
  const p = project(box(240, 240), [], { furniture: [fx('neo-shower', 38, 38), { ...fx('corner-shower', 36, 36), id: 'c2' }, { ...fx('linen', 24, 18), id: 'lin' }] });
  assert.deepEqual(fixtureSchedule(p).map((r) => r.mark).sort(), ['SH-1', 'SH-2']);
  const lines = furnitureLines(p);
  assert.equal(lines.find((l) => l.item === 'Neo-angle shower base + valve + glass (allowance)')!.qty, 1);
  assert.equal(lines.find((l) => l.item === 'Shower pan + valve + door (allowance)')!.qty, 1);
  assert.equal(lines.find((l) => l.item === 'Linen cabinet / shelving unit (allowance)')!.qty, 1);
  assert.ok(estimate(lines).lines.every((l) => l.unitPrice > 0));
  assert.deepEqual([newFurniture(p, 'linen', { x: 100, y: 100 }, 'n').w, newFurniture(p, 'linen', { x: 100, y: 100 }, 'n').d], [24, 18]);
});
