import assert from 'node:assert/strict';
import { test } from 'node:test';
import { basinReach, basinSpans, clearZones, furnitureLines, newFurniture } from '../src/calc/furniture.ts';
import { ircChecks } from '../src/calc/irc.ts';
import { estimate } from '../src/calc/pricing.ts';
import { projectReducer } from '../src/model/store.ts';
import type { FurnitureKind, Point, Project } from '../src/model/types.ts';
import { box, project } from './helpers.ts';

const rect = (w: number, h: number): Point[] => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
function bath(w: number, h: number, items: [FurnitureKind, Point][] = []): Project {
  let p = project(box(w, h, 'interior'), [], { rooms: [{ id: 'R', name: 'Bath', type: 'bath', points: rect(w, h) }] });
  items.forEach(([kind, at], i) => {
    p = projectReducer(p, { type: 'addFurniture', item: newFurniture(p, kind, at, `f${i}`) });
  });
  return p;
}
const reach = (p: Project) => ircChecks(p).filter((c) => c.rule.startsWith('Bathroom receptacle within 36'));

test('a double vanity checks each basin for a receptacle within 36" (E3901.6)', () => {
  let p = bath(180, 96, [['lavatory', { x: 90, y: 10 }]]);
  p = { ...p, furniture: [{ ...p.furniture[0], basins: 2, w: 96 }] };
  const lav = p.furniture[0];
  assert.deepEqual(basinSpans(lav), [[-48, 0], [0, 48]]);
  // A receptacle on the back wall at the far left end of the vanity: 0 from the left basin's half, 48" from the right's.
  const top = p.walls.find((w) => w.a.y === 0 && w.b.y === 0)!;
  const off = Math.min(top.a.x, top.b.x) === top.a.x ? 42 : 180 - 42;
  p = { ...p, outlets: [{ id: 'o', wallId: top.id, offset: off, side: 1, kind: 'gfci', height: 44, auto: false }] };
  const side = basinReach(p, lav, basinSpans(lav)[0]) === 0 || basinReach(p, lav, basinSpans(lav)[1]) === 0 ? p : { ...p, outlets: [{ ...p.outlets[0], side: -1 as const }] };
  const checks = reach(side);
  assert.equal(checks.length, 2);
  assert.deepEqual(checks.map((c) => c.status).sort(), ['fail', 'pass']);
  assert.ok(checks.every((c) => /\((left|right) basin\)/.test(c.message)));
  // One in the middle serves both.
  const mid = { ...side, outlets: [{ ...side.outlets[0], offset: 90 }] };
  assert.deepEqual(reach(mid).map((c) => c.status), ['pass', 'pass']);
  // A single vanity still gets one check, no basin label.
  const single = { ...mid, furniture: [{ ...lav, basins: undefined, w: 30 }] };
  assert.equal(reach(single).length, 1);
  assert.doesNotMatch(reach(single)[0].message, /basin\)/);
});

test('a double vanity prices as one cabinet with two faucets and roughs in two lavatories', () => {
  const p = bath(180, 96, [['lavatory', { x: 90, y: 10 }], ['toilet', { x: 20, y: 10 }]]);
  const dbl = { ...p, furniture: p.furniture.map((f) => (f.kind === 'lavatory' ? { ...f, basins: 2 as const, w: 60 } : f)) };
  const lines = furnitureLines(dbl);
  const qty = (re: RegExp) => lines.find((l) => re.test(l.item))?.qty;
  assert.equal(qty(/^Double vanity/), 1);
  assert.equal(qty(/^Vanity \+ lavatory faucet/), undefined);
  assert.equal(qty(/^Plumbing rough-in/), 3);
  assert.ok(estimate(lines).lines.every((l) => l.unitPrice > 0));
});

test('a mirrored neo-angle shower has its door, and the 24" in front of it, on the other corner', () => {
  const p = bath(120, 120, [['neo-shower', { x: 60, y: 60 }]]);
  const f = { ...p.furniture[0], at: { x: 60, y: 60 }, rot: 0 };
  const zone = (m: boolean) => clearZones({ ...f, mirror: m || undefined })[0][1];
  const cx = (pts: Point[]) => pts.reduce((t, q) => t + q.x, 0) / pts.length;
  assert.ok(cx(zone(false)) < 60);
  assert.ok(cx(zone(true)) > 60);
  // Mirror image about the centre line.
  assert.ok(Math.abs(cx(zone(false)) - 60 + (cx(zone(true)) - 60)) < 1e-9);
});
